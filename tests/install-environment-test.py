"""Execute the actual installer in a scratch filesystem with stub package commands."""
from pathlib import Path
import os,subprocess,tempfile,unittest,sys,json,shlex
root=Path(__file__).resolve().parents[1];bash=Path('C:/Program Files/Git/bin/bash.exe')
def path(p):return p.resolve().as_posix()
class Installer(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=root/'build');self.work=Path(self.temp.name);self.bin=self.work/'bin';self.bin.mkdir();self.state=self.work/'state';self.state.mkdir()
        self.etc=self.work/'apt.conf';self.etc.mkdir();self.qq=self.work/'qq';self.qq.write_text('#!/bin/bash\nexit 0\n');self.qq.chmod(0o755)
        self.config=self.work/'settings.json';self.config.write_text('{"synthetic":"preserved"}');(self.work/'.deps-v1').touch()
        helper='''import json,sys
from pathlib import Path
p=Path(__file__).parent/'state';missing=not (p/'healthy').exists()
print(json.dumps({'schema':1,'ok':not missing,'checks':[],'packages':['websockify'] if missing else []}))
sys.exit(2 if missing else 0)
'''
        (self.work/'environment-check.py').write_text(helper)
        self.stub('apt-get','printf "%s\\n" "$*" >> "$QQWB_TEST_STATE/apt-calls"\nif [ -f "$QQWB_TEST_STATE/fail" ]; then echo "Temporary failure resolving test.invalid" >&2; exit 1; fi\nif [ "$1" = install ]; then touch "$QQWB_TEST_STATE/healthy"; fi')
        for cmd in ['flock','dpkg','ffmpeg','ffprobe']:self.stub(cmd,'exit 0')
        self.stub('dpkg-deb','exit 71');self.stub('timeout','shift; exec "$@"')
        self.stub('node','exit 0')
        self.py=shlex.quote(path(Path(sys.executable)))
        source=(root/'assets/install.sh').read_text(encoding='utf-8').replace('/opt/qq-workbench',shlex.quote(path(self.work))).replace('/usr/bin/python3',self.py).replace('/opt/QQ/qq',shlex.quote(path(self.qq))).replace('/etc/apt/apt.conf.d',shlex.quote(path(self.etc))).replace('/opt/snowluma/node','node')
        source=source.replace('mkdir -p /tmp /dev/shm /run /var/lib/apt/lists/partial','true').replace('chmod 1777 /tmp','true')
        self.script=self.work/'install.sh';self.script.write_text(source,encoding='utf-8',newline='\n')
    def stub(self,name,source):
        p=self.bin/name;p.write_text('#!/bin/bash\n'+source+'\n',encoding='utf-8',newline='\n');p.chmod(0o755)
    def tearDown(self):self.temp.cleanup()
    def call(self,*args):
        env=dict(os.environ);env['PATH']=path(self.bin)+';C:/Program Files/Git/usr/bin;C:/Program Files/Git/bin;'+env.get('PATH','');env['QQWB_TEST_STATE']=path(self.state)
        return subprocess.run([str(bash),path(self.script),*args],cwd=self.work,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
    def test_marker_does_not_hide_missing_component_and_repair_rechecks(self):
        r=self.call();self.assertEqual(r.returncode,0,r.stdout+r.stderr);calls=(self.state/'apt-calls').read_text();self.assertIn('--reinstall websockify',calls);self.assertNotIn('--reinstall python3',calls);self.assertTrue(json.loads((self.work/'environment-status.json').read_text())['ok']);self.assertEqual(self.config.read_text(),'{"synthetic":"preserved"}')
    def test_healthy_install_never_downloads(self):
        (self.state/'healthy').touch();r=self.call();self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertFalse((self.state/'apt-calls').exists())
    def test_network_failure_is_reported_and_no_false_success(self):
        (self.state/'fail').touch();r=self.call();self.assertNotEqual(r.returncode,0);self.assertIn('域名无法解析',r.stdout);self.assertFalse(json.loads((self.work/'environment-status.json').read_text())['ok']);self.assertEqual(self.config.read_text(),'{"synthetic":"preserved"}')
    def test_check_only_has_no_package_operations(self):
        r=self.call('--check-only');self.assertEqual(r.returncode,2);self.assertFalse((self.state/'apt-calls').exists())
    def test_unknown_package_is_never_installed(self):
        p=self.work/'environment-check.py';p.write_text(p.read_text().replace("['websockify']","['unexpected-package']"));r=self.call();self.assertNotEqual(r.returncode,0);self.assertIn('未知软件包',r.stdout);self.assertFalse((self.state/'apt-calls').exists())
    def test_broken_checker_bootstraps_fixed_package_list_and_rechecks(self):
        p=self.work/'environment-check.py';p.write_text(p.read_text().replace('print(json.dumps',"if missing:raise ImportError('synthetic missing module')\nprint(json.dumps"));r=self.call();self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertIn('--reinstall python3', (self.state/'apt-calls').read_text());self.assertTrue(json.loads((self.work/'environment-status.json').read_text())['ok'])
if __name__=='__main__':unittest.main()
