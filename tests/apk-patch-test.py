from pathlib import Path
import hashlib,importlib.util,json,sys,tempfile,unittest,zipfile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('patch',ROOT/'tools/apk_patch.py');patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)

def fixtures(root):
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    for name,text in [('base','before'),('target','after')]:
        with zipfile.ZipFile(root/(name+'.apk'),'w',zipfile.ZIP_DEFLATED) as z:
            z.writestr('classes.dex',text*100);z.writestr('assets/model.bin',bytes(range(256))*4096)
    result=patch.build(root/'base.apk',root/'target.apk',root/'valid.qqpatch','v1.0.1')
    with zipfile.ZipFile(root/'valid.qqpatch') as z:manifest=json.loads(z.read('manifest.json'));data=z.read('payload.bin')
    cases={
        'wrong-base':lambda m:m.update(baseSha256='0'*64),
        'wrong-target':lambda m:m.update(targetSha256='0'*64),
        'oversize':lambda m:m.update(targetBytes=patch.LIMIT+1),
        'out-of-bounds':lambda m:m.update(ops=[{'kind':'copy','offset':-1,'length':m['targetBytes']}]),
        'float-length':lambda m:m['ops'][0].update(length=1.5),
        'unknown-op':lambda m:m['ops'][0].update(kind='execute'),
        'missing-op':lambda m:m.update(ops=[]),
    }
    for name,mutate in cases.items():
        m=json.loads(json.dumps(manifest));mutate(m)
        with zipfile.ZipFile(root/(name+'.qqpatch'),'w',zipfile.ZIP_DEFLATED) as z:z.writestr('manifest.json',json.dumps(m));z.writestr('payload.bin',data)
    with zipfile.ZipFile(root/'truncated.qqpatch','w') as z:z.writestr('manifest.json',json.dumps(manifest));z.writestr('payload.bin',data[:-1])
    return result

class PatchTest(unittest.TestCase):
    def test_exact_reconstruction_and_smaller_download(self):
        with tempfile.TemporaryDirectory() as d:
            r=fixtures(d);p=Path(d);patch.apply(p/'base.apk',p/'valid.qqpatch',p/'rebuilt.apk');self.assertEqual(patch.sha(p/'rebuilt.apk'),patch.sha(p/'target.apk'));self.assertLess(r['patchBytes'],r['targetBytes']);self.assertGreater(r['copiedBytes'],1000)
    def test_corrupt_inputs_rejected_without_output(self):
        with tempfile.TemporaryDirectory() as d:
            fixtures(d);p=Path(d)
            for candidate in p.glob('*.qqpatch'):
                if candidate.name=='valid.qqpatch':continue
                with self.subTest(candidate=candidate.name):
                    with self.assertRaises((ValueError,KeyError,zipfile.BadZipFile)):patch.apply(p/'base.apk',candidate,p/'rebuilt.apk')
                    self.assertFalse((p/'rebuilt.apk').exists());self.assertFalse((p/'rebuilt.apk.partial').exists())
    def test_reject_input_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            fixtures(d);p=Path(d)
            with self.assertRaises(ValueError):patch.apply(p/'base.apk',p/'valid.qqpatch',p/'base.apk')

if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--fixtures':print(json.dumps(fixtures(sys.argv[2]),indent=2))
    else:unittest.main()
