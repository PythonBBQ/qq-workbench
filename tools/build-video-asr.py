"""Bundle pinned ARM64 local speech recognition; never upload user audio."""
from pathlib import Path
import gzip,hashlib,io,json,os,tarfile,urllib.request

root=Path(__file__).resolve().parents[1]
lock=json.loads((root/'tools/asr-lock.json').read_text(encoding='utf-8'))
cache=Path(os.environ.get('QQWB_ASR_CACHE',str(root.parent/'research/android/asr')))
cache.mkdir(parents=True,exist_ok=True)

def obtain(item,folder=cache):
    path=folder/item['filename'];path.parent.mkdir(parents=True,exist_ok=True)
    if not path.exists() or hashlib.file_digest(path.open('rb'),'sha256').hexdigest()!=item['sha256']:
        temporary=path.with_suffix(path.suffix+'.download')
        try:
            with urllib.request.urlopen(urllib.request.Request(item['url'],headers={'User-Agent':'QQWorkbench-build'}),timeout=40) as stream,temporary.open('wb') as out:
                while data:=stream.read(512*1024):out.write(data)
            assert hashlib.file_digest(temporary.open('rb'),'sha256').hexdigest()==item['sha256'],'ASR dependency digest mismatch'
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return path

files={}
with tarfile.open(obtain(lock['runtime'])) as archive:
    for member in archive.getmembers():
        relative=member.name.split('/',1)[-1]
        if member.isfile() and (relative in ['bin/sherpa-onnx-offline','bin/sherpa-onnx-offline-audio-tagging'] or relative.startswith('lib/')):
            files[relative]=(archive.extractfile(member).read(),0o700 if relative.startswith('bin/') else 0o600)
assert 'bin/sherpa-onnx-offline' in files and 'lib/libonnxruntime.so' in files
for item in lock['model']['files']:
    files['model/'+item['filename']]=(obtain(item,cache/'model').read_bytes(),0o600)
for item in lock['tagger']['files']:
    files['tagger/'+item['filename']]=(obtain(item,cache/'tagger').read_bytes(),0o600)
for item in lock['licenses']:
    data=obtain(item).read_bytes()
    (root/'assets/licenses'/item['filename']).write_bytes(data)
    files['licenses/'+item['filename']]=(data,0o600)
files['UPSTREAM.json']=((root/'tools/asr-lock.json').read_bytes(),0o600)
asset=root/'assets/video-asr.tar.gz'
with asset.open('wb') as raw,gzip.GzipFile(fileobj=raw,mode='wb',mtime=0,filename='') as gz,tarfile.open(fileobj=gz,mode='w') as archive:
    for name,(data,mode) in sorted(files.items()):
        member=tarfile.TarInfo(name);member.size=len(data);member.mode=mode
        archive.addfile(member,io.BytesIO(data))
print(json.dumps({'localVideoASR':lock['model']['name'],'files':len(files),'bytes':asset.stat().st_size,'sha256':hashlib.file_digest(asset.open('rb'),'sha256').hexdigest()}))
