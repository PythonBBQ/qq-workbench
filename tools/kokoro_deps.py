"""Pinned Apache-2.0 Kokoro Chinese/English model, bundled without user data."""
from pathlib import Path
import hashlib,json,tarfile,zipfile
from tools.zipvoice_deps import download

SOURCE={"name":"kokoro-int8-multi-lang-v1_1.tar.bz2","url":"https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2","sha256":"259c9c8bc906d6078e4e0570421885dabb68b539c2f970fcbb890a58eeaf3e9c"}

def bundle(root):
    root=Path(root);cache=root/'build/kokoro-deps';cache.mkdir(parents=True,exist_ok=True)
    archive=cache/SOURCE['name'];download(SOURCE,archive)
    target=root/'assets/kokoro-models.zip';manifest=root/'assets/kokoro-models.json'
    if target.exists() and manifest.exists():
        record=json.loads(manifest.read_text(encoding='utf-8'))
        if record.get('sourceSha256')==SOURCE['sha256']:return record
    files={}
    with tarfile.open(archive) as source,zipfile.ZipFile(target.with_suffix('.partial'),'w',zipfile.ZIP_DEFLATED,compresslevel=6) as out:
        for member in source:
            if not member.isfile():continue
            name=member.name.split('/',1)[1]
            if name.startswith('/') or '..' in Path(name).parts:raise ValueError('Unsafe model entry')
            data=source.extractfile(member).read()
            info=zipfile.ZipInfo(name,date_time=(2026,11,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;out.writestr(info,data)
            files[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
            if name=='LICENSE':(root/'assets/licenses/Kokoro-Apache-2.0.txt').write_bytes(data)
    target.with_suffix('.partial').replace(target)
    record={'schema':1,'engine':'Kokoro v1.1-zh INT8','sourceSha256':SOURCE['sha256'],'source':SOURCE['url'],'files':files}
    manifest.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return record
