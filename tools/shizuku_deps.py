"""Pinned MIT Shizuku SDK; downloaded only when absent, hashes verified on every build."""
from pathlib import Path
import hashlib,json,urllib.request,zipfile

def sdk_jars(root):
    root=Path(root);out=root/'build/shizuku-sdk';out.mkdir(parents=True,exist_ok=True)
    record=json.loads((root/'tools/shizuku-sdk.json').read_text(encoding='utf-8'))
    jars=[]
    for item in record['artifacts']:
        archive=out/(item['name']+'-'+record['version']+'.aar') if item.get('format')!='jar' else out/(item['name']+'-1.3.0.jar')
        if not archive.exists():
            with urllib.request.urlopen(item['url'],timeout=45) as response:data=response.read(4*1024*1024)
            assert hashlib.sha256(data).hexdigest()==item['sha256'],'Shizuku download checksum mismatch'
            archive.write_bytes(data)
        assert hashlib.sha256(archive.read_bytes()).hexdigest()==item['sha256'],'Shizuku archive checksum mismatch'
        if item.get('format')=='jar':data=archive.read_bytes()
        else:
            with zipfile.ZipFile(archive) as source:data=source.read('classes.jar')
        assert hashlib.sha256(data).hexdigest()==item['jarSha256'],'Shizuku classes checksum mismatch'
        jar=out/(item['name']+'.jar');jar.write_bytes(data);jars.append(jar)
    return jars
