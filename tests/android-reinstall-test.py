from pathlib import Path
import importlib.util
import io
import subprocess
import tarfile
import tempfile
import unittest

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('reinstall', root/'tools/android-reinstall.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

DUMP = '''Packages:
  Package [cn.qqworkbench.assistant] (abc):
    versionCode=10008 minSdk=30 targetSdk=35
    versionName=1.0.8
    User 0: ceDataInode=-1 installed=false hidden=false stopped=true notLaunched=true
    User 10: ceDataInode=0 installed=true hidden=false stopped=true notLaunched=true
Queries:
  User 0:
    unrelated: installed=true versionCode=90000
'''


class ReinstallCheck(unittest.TestCase):
    def test_complete_uninstall_is_preview_only_by_default(self):
        report={'users':[{'user':0,'installed':True},{'user':10,'installed':True}]}
        def call(*args,**kw):raise AssertionError('preview mutated device')
        plan=m.uninstall_all(call,['adb'],report,Path('unused'))
        self.assertFalse(plan['applied']);self.assertEqual(plan['installedUsers'],[0,10])

    def test_unknown_space_blocks_complete_uninstall(self):
        with tempfile.TemporaryDirectory() as d:
            def call(*args,**kw):raise AssertionError('unknown space mutated device')
            with self.assertRaises(RuntimeError):m.uninstall_all(call,['adb'],{'users':[{'user':10,'installed':None}]},Path(d),True)

    def test_unreadable_used_space_blocks_complete_uninstall(self):
        with tempfile.TemporaryDirectory() as d:
            calls=[]
            def call(*args,**kw):
                calls.append(args)
                if 'force-stop' in args:return ''
                return subprocess.CompletedProcess(args,1,b'Permission denied',b'')
            with self.assertRaises(RuntimeError):m.uninstall_all(call,['adb'],{'users':[{'user':10,'installed':True,'notLaunched':False}]},Path(d),True)
            self.assertFalse(any('uninstall' in args for args in calls))

    def test_clone_is_not_misread_as_clean_uninstall_with_windows_newlines(self):
        record = m.package_record(DUMP.replace('\n', '\r\r\n'))
        self.assertEqual(record['versionCode'], 10008)
        self.assertFalse(record['users'][0]['installed'])
        self.assertTrue(record['users'][10]['installed'])
        reason = m.diagnosis(record, 0)
        self.assertIn('当前空间已卸载', reason)
        self.assertIn('用户 10', reason)
        self.assertIn('保留数据降级', reason)

    def test_unknown_and_permission_errors_are_not_called_uninstalled(self):
        for text in ['', 'Permission Denial', 'random unexpected format']:
            with self.assertRaises(RuntimeError): m.package_record(text)
        self.assertIsNone(m.package_record('Unable to find package: '+m.PACKAGE)['versionCode'])
        self.assertIn('没有该应用', m.diagnosis(m.package_record('Unable to find package: '+m.PACKAGE), 0))

    def test_package_matching_is_exact(self):
        self.assertFalse(m.listed('package:'+m.PACKAGE+'.other'))
        self.assertTrue(m.listed('package:'+m.PACKAGE+'\r\r\n'))

    def test_inspection_checks_every_user_without_changing_anything(self):
        calls = []
        def call(*args, **kwargs):
            calls.append(args)
            if args[-1] == 'get-current-user': return '0'
            if args[-2:] == ('list', 'users'): return 'UserInfo{0:owner:1}\nUserInfo{10:system_clone:2}'
            if args[-3:] == ('dumpsys', 'package', m.PACKAGE): return DUMP
            output = b'package:'+m.PACKAGE.encode() if '10' in args else b''
            return subprocess.CompletedProcess(args, 0, stdout=output, stderr=b'')
        report = m.inspect(call, ['adb', '-s', 'synthetic'])
        self.assertFalse(report['users'][0]['installed'])
        self.assertTrue(report['users'][1]['installed'])
        self.assertTrue(all('uninstall' not in c and 'remove-user' not in c and 'install' not in c for c in calls))

    def test_portable_backup_contains_memory_and_voice_and_rejects_links(self):
        for malicious in [False, True]:
            with tempfile.TemporaryDirectory() as tmp:
                buf = io.BytesIO()
                with tarfile.open(fileobj=buf, mode='w') as archive:
                    for name in ['shared_prefs/vault.xml', 'files/linux/rootfs/opt/qq-workbench/conversation-memory.json', 'files/voice-references/slot-0/neutral.json']:
                        data = b'synthetic-encrypted-data';info = tarfile.TarInfo(name);info.size=len(data)
                        archive.addfile(info, io.BytesIO(data))
                    if malicious:
                        info=tarfile.TarInfo('shared_prefs/escape');info.type=tarfile.SYMTYPE;info.linkname='/outside'
                        archive.addfile(info)
                def call(*args, **kwargs):
                    if 'ls' in args:
                        name = args[-1]
                        exists = name in ['shared_prefs', 'files/linux/rootfs/opt/qq-workbench/conversation-memory.json', 'files/voice-references/slot-0']
                        return subprocess.CompletedProcess(args, 0 if exists else 1, stdout=(name+'\n').encode() if exists else b'', stderr=b'')
                    return subprocess.CompletedProcess(args, 0, stdout=buf.getvalue(), stderr=b'')
                if malicious:
                    with self.assertRaises(RuntimeError): m.snapshot(call, ['adb'], '0', Path(tmp))
                    self.assertFalse((Path(tmp)/'portable-data.private.tar').exists())
                else:
                    hashes=m.snapshot(call, ['adb'], '0', Path(tmp))
                    self.assertEqual(len(hashes), 3)
                    self.assertTrue(any('conversation-memory' in p for p in hashes))


if __name__ == '__main__': unittest.main()
