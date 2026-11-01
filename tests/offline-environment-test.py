"""Verify integrity gates and no-downgrade selection without touching host packages."""
from pathlib import Path
import hashlib, importlib.util, tempfile, unittest
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('offline', root/'assets/offline-environment.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class OfflinePackages(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=root/'build'); self.bundle = Path(self.temp.name)
        data = b'synthetic package'; (self.bundle/'example_2_arm64.deb').write_bytes(data)
        self.lock = {'packages':[dict(file='example_2_arm64.deb',package='example',version='2',bytes=len(data),sha256=hashlib.sha256(data).hexdigest())]}
    def tearDown(self): self.temp.cleanup()
    def plan(self, installed=None, required=()):
        return m.plan(self.bundle,self.lock,set(required),installed or {},lambda a,b: (int(a)>int(b))-(int(a)<int(b)))
    def test_absent_or_incomplete_package_selected(self):
        self.assertEqual(len(self.plan()),1); self.assertEqual(len(self.plan({'example':('unpacked','2')})),1)
    def test_healthy_same_version_skipped_but_missing_required_reinstalled(self):
        self.assertEqual(self.plan({'example':('installed','2')}),[])
        self.assertEqual(len(self.plan({'example':('installed','2')},['example'])),1)
    def test_newer_never_downgraded(self):
        self.assertEqual(self.plan({'example':('installed','3')},['example']),[])
        self.assertEqual(len(self.plan({'example':('installed','1')})),1)
    def test_checksum_failure_stops_before_plan_can_be_applied(self):
        path=self.bundle/'example_2_arm64.deb'; path.write_bytes(b'synthetic packagE')
        with self.assertRaisesRegex(ValueError,'checksum'): self.plan()
    def test_missing_and_path_escape_rejected(self):
        (self.bundle/'example_2_arm64.deb').unlink()
        with self.assertRaisesRegex(ValueError,'missing'): self.plan()
        self.lock['packages'][0]['file']='../example.deb'
        with self.assertRaisesRegex(ValueError,'Invalid'): self.plan()
if __name__ == '__main__': unittest.main()
