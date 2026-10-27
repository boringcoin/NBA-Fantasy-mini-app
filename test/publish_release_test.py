import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("publish_release", Path(__file__).resolve().parents[1] / "scripts/publish-release.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublishSafety(unittest.TestCase):
    def execute(self, *, existing=None, missing=False, wrong_size=False, event="push"):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            root.mkdir()
            (root / "package.json").write_text(json.dumps({"version": "2.0.1"}))
            artifacts = root / "artifacts"
            artifacts.mkdir()
            for suffix in ("mac-arm64.dmg", "mac-x64.dmg", "win-x64.exe"):
                (artifacts / ("ThunderFantasy-2.0.1-" + suffix)).write_bytes(b"synthetic installer")
            output = root.parent / "outputs/ThunderFantasy-2.0.1"
            output.mkdir(parents=True)
            names = ["ThunderFantasy-2.0.1-" + name + ".zip" for name in ("Mac-Apple", "Mac-Intel", "Windows-x64", "Source")]
            names += ["SHA256SUMS.txt", "README_zh-CN.md", "VALIDATION.txt"]
            assets = []
            for name in names:
                content = ("synthetic " + name).encode()
                (output / name).write_bytes(content)
                assets.append({"name": name, "size": len(content), "digest": "sha256:" + hashlib.sha256(content).hexdigest()})
            for original, public_name in (("使用说明.md", "README_zh-CN.md"), ("验证记录.txt", "VALIDATION.txt")):
                (output / original).write_bytes((output / public_name).read_bytes())
            if missing:
                assets.pop()
            if wrong_size:
                assets[0]["size"] += 1
            calls, queries = [], [0]
            def fake_gh(*args, **kwargs):
                calls.append(args)
                if args[:2] == ("release", "view"):
                    queries[0] += 1
                    if queries[0] == 1:
                        if existing is None:
                            return subprocess.CompletedProcess(args, 1, "", "HTTP 404")
                        return subprocess.CompletedProcess(args, 0, json.dumps({"isDraft":existing["draft"], "body":existing["body"]}), "")
                    return subprocess.CompletedProcess(args, 0, json.dumps({"apiUrl":"https://api.github.com/repos/example/project/releases/123"}), "")
                if args[0] == "api":
                    self.assertEqual(args[1],"https://api.github.com/repos/example/project/releases/123")
                    return subprocess.CompletedProcess(args, 0, json.dumps({"assets": assets, "html_url": "https://github.com/example/project/releases/tag/v2.0.1"}), "")
                return subprocess.CompletedProcess(args, 0, "", "")
            environment = {"GITHUB_REF_NAME": "v2.0.1", "GITHUB_REPOSITORY": "example/project", "GITHUB_SHA": "a" * 40, "GITHUB_EVENT_NAME": event, "GITHUB_REF": "refs/tags/v2.0.1"}
            error = None
            with patch.object(publisher, "__file__", str(root / "scripts/publish-release.py")), patch.object(publisher, "gh", fake_gh), patch.object(publisher.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)), patch.dict(os.environ, environment), patch.object(sys, "argv", ["publish-release.py", "--artifacts", str(artifacts)]):
                try:
                    publisher.main()
                except RuntimeError as caught:
                    error = str(caught)
            return calls, error

    def test_all_seven_assets_are_verified_before_draft_is_published(self):
        calls, error = self.execute()
        self.assertIsNone(error)
        self.assertEqual(sum(call[:2] == ("release", "upload") for call in calls), 7)
        self.assertIn("--draft", next(call for call in calls if call[:2] == ("release", "create")))
        self.assertEqual(calls[-1][:2], ("release", "edit"))
        self.assertIn("--draft=false", calls[-1])

    def test_existing_published_or_unrelated_draft_release_is_never_overwritten(self):
        for existing in ({"draft": False, "body": ""}, {"draft": True, "body": "another user's draft"}):
            calls, error = self.execute(existing=existing)
            self.assertIn("not a resumable draft", error)
            self.assertFalse(any(call[:2] in (("release", "upload"),("release", "edit"),("release", "create")) for call in calls))

    def test_missing_or_corrupt_asset_keeps_release_a_draft(self):
        for options in ({"missing": True}, {"wrong_size": True}):
            calls, error = self.execute(**options)
            self.assertIsNotNone(error)
            self.assertFalse(any(call[:2] == ("release", "edit") for call in calls))

    def test_only_the_same_commit_draft_can_be_resumed(self):
        calls, error = self.execute(existing={"draft": True, "body": "<!-- thunder-fantasy-release:" + "a" * 40 + " -->"})
        self.assertIsNone(error)
        self.assertFalse(any(call[:2] == ("release", "create") for call in calls))
        self.assertEqual(calls[-1][:2], ("release", "edit"))

    def test_manual_workflow_runs_cannot_publish(self):
        calls, error = self.execute(event="workflow_dispatch")
        self.assertIn("explicit version-tag push", error)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
