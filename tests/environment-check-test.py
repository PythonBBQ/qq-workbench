from pathlib import Path
import importlib.util,subprocess,tempfile,unittest
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('environment',root/'assets/environment-check.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class EnvironmentCheck(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.calls=[];self.broken=set()
        for file in ['usr/share/novnc/vnc.html','opt/QQ/qq','opt/snowluma/node']:
            p=self.root/file;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('synthetic',encoding='utf-8');p.chmod(0o755)
    def tearDown(self):self.temp.cleanup()
    def which(self,name):return None if name in self.broken else '/usr/bin/'+name
    def fake_run(self,args,**kwargs):
        self.calls.append(args);code=0;out=''
        if args[0]=='ldd' and 'libraries' in self.broken:out='libgtk.so => not found'
        if '-c' in args and 'import websockify' in args[-1] and 'websockify' in self.broken:code=1
        if '-c' in args and 'import encodings,json' in args[-1] and 'stdlib' in self.broken:code=1
        if '--version' in args and 'node' in self.broken:raise subprocess.TimeoutExpired(args,12)
        return subprocess.CompletedProcess(args,code,stdout=out,stderr='')
    def inspect(self):return m.inspect(self.root,self.which,self.fake_run)
    def test_healthy_does_not_request_downloads(self):
        r=self.inspect();self.assertTrue(r['ok']);self.assertEqual(r['packages'],[]);self.assertEqual(len(r['checks']),9)
    def test_missing_module_is_detected_even_with_old_install_marker(self):
        (self.root/'.deps-v1').touch();self.broken.add('websockify');r=self.inspect();self.assertFalse(r['ok']);self.assertEqual(r['packages'],['websockify'])
    def test_library_stdlib_and_graphics_repairs_are_bounded(self):
        self.broken.update(['libraries','stdlib','Xvfb','x11vnc']);r=self.inspect();self.assertFalse(r['ok']);self.assertIn('python3',r['packages']);self.assertIn('xvfb',r['packages']);self.assertIn('libgtk-3-0',r['packages']);self.assertEqual(len(r['packages']),len(set(r['packages'])))
    def test_missing_qq_and_node_are_not_claimed_healthy(self):
        (self.root/'opt/QQ/qq').unlink();self.broken.add('node');r=self.inspect();self.assertFalse(r['ok']);self.assertEqual({c['id'] for c in r['checks'] if not c['ok']},{'qq','qq-libraries','node'})
    def test_missing_web_files_are_different_from_graphics(self):
        (self.root/'usr/share/novnc/vnc.html').unlink();r=self.inspect();self.assertEqual(r['packages'],['novnc']);self.assertFalse(r['ok'])

if __name__=='__main__':unittest.main()
