"""Publish test bundles from successful builds of this exact version tag.

Runs on GitHub's release job with its short-lived repository-scoped token.
Never reads local browser credentials or publishes an existing user's report.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def gh(*args, check=True):
    return subprocess.run(["gh", *args], check=check, capture_output=True, text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", required=True, type=Path)
    args = parser.parse_args()
    project = Path(__file__).resolve().parents[1]
    version = json.loads((project / "package.json").read_text(encoding="utf-8"))["version"]
    tag, repo, revision = (os.environ.get(k, "") for k in ("GITHUB_REF_NAME", "GITHUB_REPOSITORY", "GITHUB_SHA"))
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or tag != "v" + version:
        raise RuntimeError("Release tag must equal v plus package.json version")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise RuntimeError("Invalid GitHub repository or revision")
    if os.environ.get("GITHUB_EVENT_NAME") != "push" or os.environ.get("GITHUB_REF") != "refs/tags/" + tag:
        raise RuntimeError("Publishing is allowed only for an explicit version-tag push")
    artifacts = args.artifacts.resolve()
    variants = [("mac", "mac-arm64.dmg"), ("mac", "mac-x64.dmg"), ("windows", "win-x64.exe")]
    for folder, suffix in variants:
        name = "ThunderFantasy-{}-{}".format(version, suffix)
        matches = list(artifacts.rglob(name))
        if len(matches) != 1 or matches[0].is_symlink() or not matches[0].is_file():
            raise RuntimeError("Exactly one installer required: " + name)
        target = project / "release" / folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(matches[0], target)
    verification = project / "release/verification.txt"
    verification.write_text(
        "GitHub Actions 构建验证\n\n"
        "版本：{}\n提交：{}\n".format(tag, revision)
        + "三个原生运行环境（Mac Apple、Mac Intel、Windows x64）的自动化测试、"
        "使用合成数据的应用启动及独立导出检查均成功后，才执行此发布任务。\n"
        "这不代表新用户真实 Yahoo 登录和同步已验证。安装包没有开发者身份签名或 Apple 公证。\n",
        encoding="utf-8",
    )
    subprocess.run([sys.executable, str(project / "scripts/package-delivery.py"), "--verification", str(verification)], cwd=project, check=True)
    output = project.parent / "outputs" / ("ThunderFantasy-" + version)
    expected = {"ThunderFantasy-{}-{}.zip".format(version, x) for x in ("Mac-Apple", "Mac-Intel", "Windows-x64", "Source")}
    # Release attachment names use ASCII for consistent URLs across clients.
    for original, public_name in (("使用说明.md", "README_zh-CN.md"), ("验证记录.txt", "VALIDATION.txt")):
        shutil.copyfile(output / original, output / public_name)
    expected.update(("SHA256SUMS.txt", "README_zh-CN.md", "VALIDATION.txt"))
    files = [output / name for name in sorted(expected)]
    if any(not file.is_file() or file.is_symlink() for file in files):
        raise RuntimeError("Missing release asset")
    marker = "<!-- thunder-fantasy-release:{} -->".format(revision)
    description = (
        "Thunder Fantasy {} 通用测试版\n\n".format(version)
        + "按系统下载完整 ZIP，里面包含安装程序、Yahoo 浏览器同步扩展和使用说明。\n\n"
        + "安装后在浏览器登录自己的 Yahoo，配对桌面应用，再从 My Team 页面导入自己的球队。"
        "支持多联盟切换、分类战力和对战分析，以及 HTML、Excel、图片独立导出。\n\n"
        + "Mac 支持 macOS 13+；Windows 支持 Windows 10/11 x64。"
        "安装包未做发布者身份签名或 Apple 公证，系统可能提示未经验证的开发者。\n\n"
        + "应用与 Yahoo 标签页需要保持打开。安装包不包含开发者个人账号、联盟数据或配对凭证。"
        "请先用于测试，真实 Yahoo 同步仍需使用者验证。\n\n"
        + "SHA256SUMS.txt 可用于核对下载文件完整性。\n\n" + marker + "\n"
    )
    notes = project / "release/release-notes.md"
    notes.write_text(description, encoding="utf-8")
    route = "repos/{}/releases/tags/{}".format(repo, tag)
    existing = gh("api", route, check=False)
    if existing.returncode == 0:
        release = json.loads(existing.stdout)
        if not release.get("draft") or marker not in release.get("body", ""):
            raise RuntimeError("Release exists and is not a resumable draft from this exact commit")
    else:
        # Only a missing release allows creation; authentication and service failures do not.
        if "404" not in existing.stderr:
            raise RuntimeError("Cannot inspect release: " + existing.stderr)
        gh("release", "create", tag, "--repo", repo, "--verify-tag", "--draft", "--prerelease", "--title", "Thunder Fantasy {} 测试版".format(version), "--notes-file", str(notes))
    for file in files:
        gh("release", "upload", tag, str(file), "--repo", repo, "--clobber")
    release = json.loads(gh("api", route).stdout)
    remote = {asset["name"]: asset for asset in release["assets"]}
    if set(remote) != expected:
        raise RuntimeError("Release asset list does not match the complete bundle")
    for file in files:
        if remote[file.name]["size"] != file.stat().st_size:
            raise RuntimeError("Release asset size mismatch: " + file.name)
        digest = remote[file.name].get("digest")
        if digest:
            checksum = hashlib.sha256(file.read_bytes()).hexdigest()
            if digest != "sha256:" + checksum:
                raise RuntimeError("Release asset checksum mismatch: " + file.name)
    gh("release", "edit", tag, "--repo", repo, "--draft=false", "--prerelease")
    print("Published complete test release: https://github.com/{}/releases/tag/{}".format(repo, tag))


if __name__ == "__main__":
    main()
