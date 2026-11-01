"""ZIP-entry aware APK delta. Reconstructs the exact signed APK, never hot-loads code.

Usage: apk_patch.py BASE.apk TARGET.apk OUTPUT.qqpatch [--version 1.0.1]
"""
from pathlib import Path
import argparse,hashlib,json,struct,zipfile,tempfile,shutil

LIMIT=1900*1024**2
def sha(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def spans(path):
    with zipfile.ZipFile(path) as z,Path(path).open('rb') as stream:
        for i in sorted(z.infolist(),key=lambda i:i.header_offset):
            stream.seek(i.header_offset);h=stream.read(30)
            if h[:4]!=b'PK\x03\x04':raise ValueError('Invalid local ZIP header')
            a,b=struct.unpack_from('<HH',h,26);offset=i.header_offset+30+a+b
            stream.seek(offset);remaining=i.compress_size;digest=hashlib.sha256()
            while remaining:
                data=stream.read(min(1024**2,remaining))
                if not data:raise ValueError('Truncated APK')
                digest.update(data);remaining-=len(data)
            yield (i.filename,digest.hexdigest(),i.compress_size),offset,i.compress_size

def copy_n(source,out,length):
    while length:
        data=source.read(min(length,1024**2))
        if not data:raise ValueError('Truncated data')
        out.write(data);length-=len(data)

def build(base,target,output,version):
    base,target,output=map(Path,(base,target,output))
    if output.resolve() in [base.resolve(),target.resolve()]:raise ValueError('Output overwrites input')
    if not all(0<p.stat().st_size<=LIMIT for p in [base,target]):raise ValueError('APK size out of range')
    old={key:(offset,length) for key,offset,length in spans(base)};ops=[];position=0;copied=0
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as tmp:
        payload=Path(tmp)/'payload'
        with target.open('rb') as source,payload.open('wb') as literals:
            def literal(length):
                if length:copy_n(source,literals,length);ops.append({'kind':'data','length':length})
            for key,offset,length in spans(target):
                if key not in old or length<128:continue
                source.seek(position);literal(offset-position)
                origin,size=old[key];ops.append({'kind':'copy','offset':origin,'length':size});copied+=size;position=offset+length
            source.seek(position);literal(target.stat().st_size-position)
        record={'schema':1,'format':'qqwb-apk-delta-v1','version':version,'baseSha256':sha(base),'baseBytes':base.stat().st_size,'targetSha256':sha(target),'targetBytes':target.stat().st_size,'payloadBytes':payload.stat().st_size,'ops':ops}
        temp=output.with_suffix(output.suffix+'.partial')
        with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            z.writestr('manifest.json',json.dumps(record,separators=(',',':')).encode());z.write(payload,'payload.bin')
        temp.replace(output)
    return {**{k:v for k,v in record.items() if k!='ops'},'copiedBytes':copied,'patchBytes':output.stat().st_size,'patchSha256':sha(output)}

def apply(base,patch,output):
    base,patch,output=map(Path,(base,patch,output))
    if output.resolve() in [base.resolve(),patch.resolve()]:raise ValueError('Output overwrites input')
    temp=output.with_suffix(output.suffix+'.partial')
    try:
        with zipfile.ZipFile(patch) as z:
            if set(z.namelist())!={'manifest.json','payload.bin'} or len(z.namelist())!=2:raise ValueError('Invalid delta entries')
            if z.getinfo('manifest.json').file_size>4*1024**2:raise ValueError('Oversize manifest')
            m=json.loads(z.read('manifest.json'))
            if m['format']!='qqwb-apk-delta-v1' or m['schema']!=1 or len(m['ops'])>100000:raise ValueError('Invalid delta')
            if sha(base)!=m['baseSha256'] or base.stat().st_size!=m['baseBytes']:raise ValueError('Base APK mismatch')
            if not 0<m['targetBytes']<=LIMIT or not 0<=m['payloadBytes']<=m['targetBytes']:raise ValueError('Target size out of range')
            if z.getinfo('payload.bin').file_size!=m['payloadBytes']:raise ValueError('Payload size mismatch')
            total=0;data_bytes=0
            with base.open('rb') as source,z.open('payload.bin') as payload,temp.open('wb') as out:
                for op in m['ops']:
                    n=op['length']
                    if type(n)!=int or n<=0 or n>m['targetBytes']-total:raise ValueError('Invalid operation length')
                    if op['kind']=='copy':
                        offset=op['offset']
                        if type(offset)!=int or offset<0 or n>m['baseBytes']-offset:raise ValueError('Copy out of bounds')
                        source.seek(offset);copy_n(source,out,n)
                    elif op['kind']=='data':copy_n(payload,out,n);data_bytes+=n
                    else:raise ValueError('Unknown operation')
                    total+=n
                if total!=m['targetBytes'] or data_bytes!=m['payloadBytes'] or payload.read(1):raise ValueError('Size mismatch')
            if sha(temp)!=m['targetSha256']:raise ValueError('Target hash mismatch')
        temp.replace(output)
    finally:temp.unlink(missing_ok=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('base',type=Path);p.add_argument('target',type=Path);p.add_argument('output',type=Path);p.add_argument('--version',required=True);a=p.parse_args()
    result=build(a.base,a.target,a.output,a.version)
    reconstructed=a.output.with_suffix('.verified.apk')
    try:apply(a.base,a.output,reconstructed);assert sha(reconstructed)==sha(a.target)
    finally:reconstructed.unlink(missing_ok=True)
    print(json.dumps(result,indent=2))
