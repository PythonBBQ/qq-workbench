"""Pinned native Android TTS runtime and an offline, minimal model bundle."""
from pathlib import Path
import hashlib,json,urllib.request,zipfile,tarfile,shutil

def digest(path):
    with open(path,'rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def download(item,target):
    if target.exists() and digest(target)==item['sha256']:return
    temp=target.with_suffix(target.suffix+'.partial')
    with urllib.request.urlopen(urllib.request.Request(item['url'],headers={'User-Agent':'QQWorkbench-build'}),timeout=60) as response,temp.open('wb') as stream:shutil.copyfileobj(response,stream)
    if digest(temp)!=item['sha256']:raise ValueError('ZipVoice dependency checksum mismatch: '+target.name)
    temp.replace(target)

def sdk_jars(root,native=None):
    root=Path(root);out=root/'build/zipvoice-deps';out.mkdir(parents=True,exist_ok=True)
    lock=json.loads((root/'tools/zipvoice-deps.json').read_text(encoding='utf-8'))
    aar=out/'sherpa-onnx-static-link-onnxruntime-2.0.1.aar';download(lock['aar'],aar)
    with zipfile.ZipFile(aar) as source:
        jar=out/'sherpa-onnx.jar';jar.write_bytes(source.read('classes.jar'))
        if native is not None:(Path(native)/'libsherpa-onnx-jni.so').write_bytes(source.read('jni/arm64-v8a/libsherpa-onnx-jni.so'))
    kotlin=lock['kotlin'];stdlib=out/'kotlin-stdlib.jar';download(kotlin,stdlib)
    return [jar,stdlib]

def bundle(root):
    root=Path(root);out=root/'build/zipvoice-deps';out.mkdir(parents=True,exist_ok=True)
    lock=json.loads((root/'tools/zipvoice-deps.json').read_text(encoding='utf-8'))
    for item in lock['models']:download(item,out/item['name'])
    files={}
    with tarfile.open(out/lock['models'][0]['name']) as source:
        for member in source.getmembers():
            name=Path(member.name).name
            if name in ['encoder.int8.onnx','decoder.int8.onnx','tokens.txt','lexicon.txt'] and member.isfile():files[name]=source.extractfile(member).read()
    for name in ['vocos_24khz.onnx','lexicon-en-us.txt']:files[name]=(out/name).read_bytes()
    assert len(files)==6
    manifest={'schema':1,'engine':'ZipVoice-Distill INT8','runtime':'sherpa-onnx '+lock['version'],'files':{name:{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in sorted(files.items())}}
    target=root/'assets/zipvoice-models.zip';manifest_path=root/'assets/zipvoice-models.json'
    value=json.dumps(manifest,ensure_ascii=False,indent=2)+'\n'
    if not target.exists() or not manifest_path.exists() or manifest_path.read_text(encoding='utf-8')!=value:
        with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for name,data in sorted(files.items()):
                info=zipfile.ZipInfo(name,date_time=(2026,10,31,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,data)
    manifest_path.write_text(value,encoding='utf-8',newline='\n')
    return manifest
