import importlib.util
from pathlib import Path
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


if __name__ == "__main__":
    unittest.main()
