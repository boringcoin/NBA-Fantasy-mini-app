"""Create a small GitHub-ready source ZIP using an explicit allowlist.

Run with Python 3 from any directory. This does not initialize or publish Git.
Only the project source is included; personal data and build caches are excluded.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import re


ROOT_FILES = ("package.json", "package-lock.json", ".gitignore", "README.md", "使用说明.md")
DIRECTORIES = {
    "app": {".js", ".cjs", ".html", ".css"},
    "core": {".cjs"},
    "extension": {".js", ".json", ".html"},
    "scripts": {".cjs", ".py"},
    "test": {".cjs"},
    ".github/workflows": {".yml", ".yaml"},
}
ASSETS = ("assets/report.html", "assets/Thunder.icns", "assets/icon.ico", "assets/icon.png")
BLOCKED_PARTS = {"node_modules", "release", ".runtime-cache", ".smoke", ".git",
                 "__pycache__", "outputs", "profiles", "userdata", ".env"}
BLOCKED_FILES = {"settings.json", "settings.json.tmp", "snapshot.json", "snapshots.json",
                 "credentials.json", "pairing.json", ".ds_store"}


def source_files(project):
    files = []
    for relative in ROOT_FILES + ASSETS:
        file = project / relative
        if not file.is_file() or file.is_symlink():
            raise RuntimeError("源文件缺失或是符号链接：" + relative)
        files.append(file)
    for relative, extensions in DIRECTORIES.items():
        directory = project / relative
        if not directory.is_dir() or directory.is_symlink():
            raise RuntimeError("源码目录缺失或是符号链接：" + relative)
        for file in directory.rglob("*"):
            rel = file.relative_to(project)
            if file.is_symlink():
                raise RuntimeError("源码包不接受符号链接：" + str(rel))
            if any(part.lower() in BLOCKED_PARTS for part in rel.parts):
                continue
            if file.is_file() and file.suffix in extensions and file.name.lower() not in BLOCKED_FILES:
                files.append(file)
    return sorted(set(files))


def main():
    project = Path(__file__).resolve().parents[1]
    version = json.loads((project / "package.json").read_text(encoding="utf-8"))["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise RuntimeError("package.json 版本号格式无效")
    files = source_files(project)
    root = "ThunderFantasy-" + version + "-Source"
    destination = project.parent / "outputs" / ("ThunderFantasy-" + version)
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / (root + ".zip")
    temporary = target.with_suffix(".zip.tmp")
    try:
        with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for source in files:
                archive.write(source, root + "/" + source.relative_to(project).as_posix())
        with ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise RuntimeError("源码包 CRC 校验失败")
            expected = {root + "/" + source.relative_to(project).as_posix() for source in files}
            if set(archive.namelist()) != expected:
                raise RuntimeError("源码包文件清单不一致")
        temporary.replace(target)
    finally:
        if temporary.exists():
            temporary.unlink()
    hashes = []
    for file in sorted(destination.glob("*.zip")):
        digest = hashlib.sha256()
        with file.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        hashes.append("{}  {}".format(digest.hexdigest(), file.name))
    (destination / "SHA256SUMS.txt").write_text("\n".join(hashes) + "\n", encoding="utf-8")
    print("已生成并校验源码：{} · {} 文件 · {:.1f} KiB".format(target.name, len(files), target.stat().st_size / 1024))
    print("将源码包解压后的文件提交到 GitHub 仓库；大型安装包和转发包放到 GitHub Releases。")


if __name__ == "__main__":
    main()
