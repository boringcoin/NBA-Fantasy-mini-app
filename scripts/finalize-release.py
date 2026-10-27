"""Finish an owned release draft only after its original platform builds succeeded."""
import json
import os
from pathlib import Path
import re
import subprocess


def gh(*args):
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("GitHub command failed: " + result.stderr.strip())
    return result.stdout


def main():
    trigger, repo = os.environ.get("GITHUB_REF_NAME", ""), os.environ.get("GITHUB_REPOSITORY", "")
    if os.environ.get("GITHUB_EVENT_NAME") != "push" or not re.fullmatch(r"publish-v\d+\.\d+\.\d+", trigger):
        raise RuntimeError("An explicit publish-vVERSION tag is required")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise RuntimeError("Invalid repository")
    tag = trigger[len("publish-"):]
    version = tag[1:]
    root = Path(__file__).resolve().parents[1]
    if json.loads((root / "package.json").read_text())["version"] != version:
        raise RuntimeError("Package and publication tag must match")
    revision = subprocess.check_output(["git", "rev-parse", tag + "^{commit}"], text=True).strip()
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise RuntimeError("Invalid source tag")
    runs = json.loads(gh("api", "repos/{}/actions/runs?event=push&per_page=100".format(repo)))["workflow_runs"]
    candidates = [r for r in runs if r["head_sha"] == revision and r["head_branch"] == tag and r["path"] == ".github/workflows/build.yml"]
    if not candidates:
        raise RuntimeError("No build run for the exact source tag")
    run = max(candidates, key=lambda r:r["run_attempt"])
    jobs = json.loads(gh("api", "repos/{}/actions/runs/{}/jobs?per_page=100".format(repo, run["id"])))["jobs"]
    required = {"Mac-Apple-arm64", "Windows-x64", "Browser extension and instructions"}
    successful = {j["name"] for j in jobs if j["status"] == "completed" and j["conclusion"] == "success"}
    if not required <= successful:
        raise RuntimeError("All original platform builds must have passed")
    metadata = json.loads(gh("release", "view", tag, "--repo", repo, "--json", "apiUrl,isDraft,body"))
    if not metadata["isDraft"] or "<!-- thunder-fantasy-release:{} -->".format(revision) not in metadata["body"]:
        raise RuntimeError("Only the draft generated from the verified source commit can be finalized")
    location = metadata["apiUrl"]
    if not re.fullmatch(r"https://api\.github\.com/repos/" + re.escape(repo) + r"/releases/\d+", location):
        raise RuntimeError("Invalid draft location")
    release = json.loads(gh("api", location))
    assets = {a["name"]:a for a in release["assets"]}
    zip_names = {"ThunderFantasy-{}-{}.zip".format(version, name) for name in ("Mac-Apple", "Windows-x64", "Source")}
    expected = zip_names | {"README_zh-CN.md", "VALIDATION.txt", "SHA256SUMS.txt"}
    if set(assets) != expected or any(a["state"] != "uploaded" or a["size"] <= 0 for a in assets.values()):
        raise RuntimeError("Draft does not contain all six completed assets")
    checksum_location = assets["SHA256SUMS.txt"]["url"]
    if not re.fullmatch(r"https://api\.github\.com/repos/" + re.escape(repo) + r"/releases/assets/\d+", checksum_location):
        raise RuntimeError("Invalid checksum asset location")
    checksums = gh("api", checksum_location, "-H", "Accept: application/octet-stream")
    rows = dict((name, checksum) for checksum, name in (row.split("  ", 1) for row in checksums.strip().splitlines()))
    if set(rows) != zip_names:
        raise RuntimeError("Checksum list does not cover all three bundles")
    for name in zip_names:
        if not re.fullmatch(r"[0-9a-f]{64}", rows[name]) or assets[name].get("digest") != "sha256:" + rows[name]:
            raise RuntimeError("Uploaded bundle checksum mismatch: " + name)
    gh("release", "edit", tag, "--repo", repo, "--draft=false", "--prerelease")
    print("Published verified release: https://github.com/{}/releases/tag/{}".format(repo, tag))


if __name__ == "__main__":
    main()
