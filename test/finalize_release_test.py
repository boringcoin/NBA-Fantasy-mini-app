import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("finalize_release",Path(__file__).resolve().parents[1]/"scripts/finalize-release.py")
finalizer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(finalizer)


class FinalizeSafety(unittest.TestCase):
    def execute(self,failed_build=False,bad_digest=False,published=False):
        calls=[]
        names=["ThunderFantasy-2.0.2-"+label+".zip" for label in ("Mac-Apple","Mac-Intel","Windows-x64","Source")]
        checks={name:hashlib.sha256(name.encode()).hexdigest() for name in names}
        names += ["SHA256SUMS.txt","README_zh-CN.md","VALIDATION.txt"]
        assets=[{"name":name,"state":"uploaded","size":1000,"digest":"sha256:"+checks.get(name,"0"*64),"url":"https://api.github.com/repos/example/project/releases/assets/"+str(i)} for i,name in enumerate(names,1)]
        if bad_digest:assets[0]["digest"]="sha256:"+"0"*64
        def fake_gh(*args):
            calls.append(args)
            if args[:2]==("release","view"):
                return json.dumps({"apiUrl":"https://api.github.com/repos/example/project/releases/123","isDraft":not published,"body":"<!-- thunder-fantasy-release:"+"a"*40+" -->"})
            if args[0]=="api":
                route=args[1]
                if "actions/runs?" in route:
                    return json.dumps({"workflow_runs":[{"id":1,"head_sha":"a"*40,"head_branch":"v2.0.2","path":".github/workflows/build.yml","run_attempt":1}]})
                if route.endswith("/jobs?per_page=100"):
                    names=["Mac-Apple-arm64","Mac-Intel-x64","Windows-x64","Browser extension and instructions"]
                    return json.dumps({"jobs":[{"name":name,"status":"completed","conclusion":"failure" if failed_build and name=="Windows-x64" else "success"} for name in names]})
                if route.endswith("/releases/123"):return json.dumps({"assets":assets})
                if "/releases/assets/" in route:return "\n".join(checksum+"  "+name for name,checksum in checks.items())
            return ""
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/"package.json").write_text('{"version":"2.0.2"}')
            env={"GITHUB_REF_NAME":"publish-v2.0.2","GITHUB_REPOSITORY":"example/project","GITHUB_EVENT_NAME":"push"}
            error=None
            with patch.object(finalizer,"__file__",str(root/"scripts/finalize-release.py")),patch.object(finalizer,"gh",fake_gh),patch.object(finalizer.subprocess,"check_output",return_value="a"*40+"\n"),patch.dict(os.environ,env):
                try:finalizer.main()
                except RuntimeError as caught:error=str(caught)
            return calls,error

    def test_verified_builds_and_matching_digests_publish_the_owned_draft(self):
        calls,error=self.execute();self.assertIsNone(error);self.assertEqual(calls[-1][:2],("release","edit"))

    def test_any_failed_platform_build_prevents_publication(self):
        calls,error=self.execute(failed_build=True);self.assertIn("builds must have passed",error);self.assertFalse(any(c[:2]==("release","edit") for c in calls))

    def test_incorrect_download_hash_prevents_publication(self):
        calls,error=self.execute(bad_digest=True);self.assertIn("checksum mismatch",error);self.assertFalse(any(c[:2]==("release","edit") for c in calls))

    def test_existing_public_release_is_never_modified(self):
        calls,error=self.execute(published=True);self.assertIn("Only the draft",error);self.assertFalse(any(c[:2]==("release","edit") for c in calls))


if __name__=="__main__":unittest.main()
