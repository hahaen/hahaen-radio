import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release", Path(__file__).with_name("release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ArtifactSafety(unittest.TestCase):
    def test_rejects_native_runtime_dependency(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "dependency").write_bytes(b"\x7fELFbinary")
            with self.assertRaises(ValueError):
                release.portable(root)

    def test_rejects_secret_and_escaping_link(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / ".env.production").write_text("private")
            with self.assertRaises(ValueError):
                release.portable(root)
            (root / ".env.production").unlink()
            (root / "escape").symlink_to(root.parent)
            with self.assertRaises(ValueError):
                release.portable(root)

    def test_portable_relative_dependency_link(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "runtime.js").write_text("export default 1")
            (root / "module.js").symlink_to("runtime.js")
            release.portable(root)

    def test_migration_gate_binds_names_and_contents(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "migration.sql").write_text("SELECT 1")
            before = release.migration_hash(root)
            (root / "migration.sql").rename(root / "renamed.sql")
            self.assertNotEqual(before, release.migration_hash(root))
            before = release.migration_hash(root)
            (root / "renamed.sql").write_text("SELECT 2")
            self.assertNotEqual(before, release.migration_hash(root))


class DeploymentWithoutBackups(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="radio-upload.", dir="/tmp")
        self.addCleanup(self.temporary.cleanup)
        self.incoming = Path(self.temporary.name)
        self.base = self.incoming / "runtime"
        self.base.mkdir()
        (self.base / "compose.yaml").write_text("old compose")
        (self.base / "release.env").write_text("HAEN_API_IMAGE=old-api\nHAEN_JOBS_IMAGE=old-jobs\n")
        (self.base / "migrations.sha256").write_text("same schema\n")
        (self.base / "latest-release.txt").write_text("last successful release")
        self.web = self.base / "web/current"
        self.web.mkdir(parents=True)
        (self.web / "index.html").write_text("old page")
        (self.incoming / "web").mkdir()
        (self.incoming / "web/index.html").write_text("new page /radio/assets/")
        (self.incoming / "compose.yaml").write_text("new compose")
        (self.incoming / "migrations.sha256").write_text("same schema\n")
        self.bin = self.incoming / "bin"
        self.bin.mkdir()
        helper = self.bin / "mock.py"
        helper.write_text("#!" + sys.executable + "\n" + '''
import json, os, pathlib, subprocess, sys
command = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["COMMAND_LOG"], "a") as log:
    log.write(json.dumps([command, *args]) + "\\n")
if command == "docker":
    if "migration" in args and "status" in args:
        print(json.dumps({"event": "migration_status", "pending": []}))
    elif args[0] == "inspect":
        if "image.revision" in args[2]:
            print("b" * 40 if os.environ.get("STALE_REVISION") else "a" * 40)
        elif "Health.Status" in args[2]:
            print("unhealthy" if os.environ.get("FAIL_HEALTH") else "healthy")
        elif "State.Status" in args[2]:
            print("exited 1" if os.environ.get("FAIL_JOBS") else "running 0")
        else:
            print("old-image")
    elif args[0] == "compose" and "up" in args and os.environ.get("FAIL_UP"):
        sys.exit(7)
elif command == "curl":
    if os.environ.get("FAIL_PROBE") or (os.environ.get("FAIL_PAGE") and args[-1].endswith("/radio/")):
        sys.exit(22)
    print("old page /radio/assets/" if os.environ.get("STALE_PAGE") else "new page /radio/assets/", end="")
elif command == "date":
    print("2026-10-25T20:00:00+08:00" if args == ["-Is"] else "1234567890")
elif command == "sed":
    path = pathlib.Path(args[-1])
    key = args[1].split("^")[1].split("=")[0]
    path.write_text("".join(line for line in path.read_text().splitlines(True) if not line.startswith(key + "=")))
elif command == "cp":
    if os.environ.get("FAIL_STAGE") and args[1].endswith("/web/."):
        sys.exit(8)
    sys.exit(subprocess.call(["/bin/cp", *args]))
''')
        helper.chmod(0o700)
        for command in ("docker", "curl", "flock", "date", "sed", "cp", "sleep"):
            (self.bin / command).symlink_to(helper.name)
        self.log = self.incoming / "commands.jsonl"

    def deploy(self, scope="frontend", **flags):
        if scope not in ("frontend", "all"):
            shutil.rmtree(self.incoming / "web")
        source = Path(__file__).with_name("deploy.sh").read_text()
        source = source.replace("base=/home/hahaen/hahaen-radio", 'base="' + str(self.base) + '"')
        return subprocess.run(
            ["bash", "-s", "--", "radio", scope, "a" * 40, str(self.incoming)],
            input=source, text=True, capture_output=True,
            env={**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                 "COMMAND_LOG": str(self.log), **flags},
        )

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def assert_no_backups(self):
        self.assertEqual(list(self.incoming.glob("previous*")), [])
        self.assertEqual(list((self.base / "web").glob(".incoming.*")), [])

    def test_frontend_success_replaces_without_backup(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.web / "index.html").read_text(), "new page /radio/assets/")
        self.assertIn("a" * 40, (self.base / "latest-release.txt").read_text())
        self.assertIn("Release result frontend: SUCCESS", result.stdout)
        self.assertIn("Release result radio-api: NOT_REQUESTED", result.stdout)
        self.assert_no_backups()

    def test_probe_failure_keeps_new_page_and_last_success(self):
        result = self.deploy(FAIL_PROBE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no previous version", result.stderr)
        self.assertIn("Release result frontend: UNVERIFIED", result.stdout)
        self.assertEqual((self.web / "index.html").read_text(), "new page /radio/assets/")
        self.assertEqual((self.base / "latest-release.txt").read_text(), "last successful release")
        self.assert_no_backups()

    def test_staging_failure_leaves_live_page_intact(self):
        result = self.deploy(FAIL_STAGE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.web / "index.html").read_text(), "old page")
        self.assertIn("Release result frontend: NOT_COMPLETED", result.stdout)
        self.assert_no_backups()

    def test_container_failure_does_not_restore_old_configuration(self):
        result = self.deploy("api", FAIL_UP="1")
        self.assertNotEqual(result.returncode, 0)
        ups = [args for args in self.commands() if args[0] == "docker" and "up" in args]
        self.assertEqual(len(ups), 1)
        self.assertIn("Release result radio-api: UNVERIFIED", result.stdout)
        config = (self.base / "release.env").read_text()
        self.assertIn("HAEN_API_IMAGE=hahaen/radio-runtime:" + "a" * 40, config)
        self.assertIn("HAEN_JOBS_IMAGE=old-jobs", config)
        self.assertEqual((self.base / "compose.yaml").read_text(), "new compose")
        self.assertEqual((self.base / "latest-release.txt").read_text(), "last successful release")
        self.assert_no_backups()

    def test_api_success_cleans_unused_image(self):
        result = self.deploy("api")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(["docker", "image", "rm", "old-image"], self.commands())
        self.assertIn("Release result frontend: NOT_REQUESTED", result.stdout)
        self.assert_no_backups()

    def test_all_success_reports_every_component(self):
        result = self.deploy("all")
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ("frontend", "radio-api", "radio-jobs"):
            self.assertIn("Release result " + name + ": SUCCESS", result.stdout)
        self.assert_no_backups()

    def test_page_probe_failure_reports_backend_success(self):
        result = self.deploy("all", FAIL_PAGE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Release result frontend: UNVERIFIED", result.stdout)
        for name in ("radio-api", "radio-jobs"):
            self.assertIn("Release result " + name + ": SUCCESS", result.stdout)
        self.assertEqual((self.base / "latest-release.txt").read_text(), "last successful release")
        self.assert_no_backups()

    def test_migration_mismatch_does_not_change_runtime(self):
        (self.incoming / "migrations.sha256").write_text("different schema\n")
        result = self.deploy("api")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("up" in args for args in self.commands()))
        self.assertIn("HAEN_API_IMAGE=old-api", (self.base / "release.env").read_text())
        self.assertEqual((self.web / "index.html").read_text(), "old page")
        self.assert_no_backups()

    def test_stale_container_revision_is_not_success(self):
        result = self.deploy("api", STALE_REVISION="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Release result radio-api: UNVERIFIED", result.stdout)
        self.assertEqual((self.base / "latest-release.txt").read_text(), "last successful release")

    def test_stale_public_page_is_not_success(self):
        result = self.deploy(STALE_PAGE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Release result frontend: UNVERIFIED", result.stdout)
        self.assertEqual((self.base / "latest-release.txt").read_text(), "last successful release")

    def test_unhealthy_api_is_not_success(self):
        result = self.deploy("api", FAIL_HEALTH="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("API health check failed", result.stderr)
        self.assertIn("Release result radio-api: UNVERIFIED", result.stdout)

    def test_failed_jobs_are_not_success(self):
        result = self.deploy("all", FAIL_JOBS="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Jobs health check failed", result.stderr)
        self.assertIn("Release result radio-jobs: UNVERIFIED", result.stdout)
        self.assertIn("Release result frontend: NOT_COMPLETED", result.stdout)


if __name__ == "__main__":
    unittest.main()
