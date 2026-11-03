"""Compile maintained sources, preserve the exact signed 1.0.7 runtime/voice assets.

No model downloads, user settings, signing secrets or test hooks are embedded.
The ordinary build.py remains the full upstream-asset build entry point.
"""
from pathlib import Path
import argparse,ctypes,hashlib,json,os,shutil,subprocess,sys,tempfile,zipfile

ROOT=Path(__file__).resolve().parents[1]
BASE_SHA='de4df9417af9ba3113d30953299581d0446c366592938a0bbe3e3c444e80d147'

def digest(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['base','cache-root','toolchain','java-bin','keystore','password-file','output']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--compile-only',action='store_true')
    args=p.parse_args()
    if os.name=='nt':
        kernel=ctypes.WinDLL('kernel32',use_last_error=True);kernel.GetCurrentProcess.restype=ctypes.c_void_p
        kernel.GetProcessAffinityMask.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_size_t),ctypes.POINTER(ctypes.c_size_t)]
        kernel.SetProcessAffinityMask.argtypes=[ctypes.c_void_p,ctypes.c_size_t];kernel.SetPriorityClass.argtypes=[ctypes.c_void_p,ctypes.c_uint]
        handle=kernel.GetCurrentProcess();allowed=ctypes.c_size_t();system=ctypes.c_size_t()
        if not kernel.GetProcessAffinityMask(handle,ctypes.byref(allowed),ctypes.byref(system)):raise ctypes.WinError(ctypes.get_last_error())
        mask=sum(1<<i for i in [n for n in range(64) if allowed.value&(1<<n)][:8])
        if not kernel.SetProcessAffinityMask(handle,mask) or not kernel.SetPriorityClass(handle,0x4000):raise ctypes.WinError(ctypes.get_last_error())
    assert digest(args.base)==BASE_SHA,'Requires the verified official 1.0.7 base APK'
    out=ROOT/'build/maintenance-release';out.mkdir(parents=True,exist_ok=True)
    bt=args.toolchain/'build-tools_r35_windows/android-15';sdk=args.toolchain/'platform-35_r02/android-35/android.jar';java=args.java_bin
    def run(*parts):subprocess.run(list(map(str,parts)),check=True,cwd=ROOT)
    sys.path.insert(0,str(ROOT));from tools.shizuku_deps import sdk_jars
    from tools.zipvoice_deps import sdk_jars as voice_jars
    jars=sdk_jars(args.cache_root)+voice_jars(args.cache_root)
    with tempfile.TemporaryDirectory(prefix='compile-',dir=out) as scratch:
        scratch=Path(scratch);classes=scratch/'classes';classes.mkdir();dex=scratch/'dex';dex.mkdir()
        run(java/'javac.exe','-encoding','UTF-8','-source','8','-target','8','-Xlint:-options','-bootclasspath',str(bt/'core-lambda-stubs.jar')+os.pathsep+str(sdk),'-classpath',os.pathsep.join(map(str,jars)),'-d',classes,*sorted((ROOT/'src').rglob('*.java')))
        jar=scratch/'classes.jar'
        with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as z:
            for file in classes.rglob('*.class'):z.write(file,file.relative_to(classes).as_posix())
        run(java/'java.exe','-Xmx1024m','-cp',bt/'lib/d8.jar','com.android.tools.r8.D8','--min-api','30','--lib',sdk,'--output',dex,jar,*jars)
        if args.compile_only:print('QQWB_MAINTENANCE_COMPILE_OK');return
        resources=scratch/'resources.apk';run(bt/'aapt.exe','package','-f','-M',ROOT/'AndroidManifest.xml','-S',ROOT/'res','-I',sdk,'-F',resources)
        unsigned=scratch/'unsigned.apk';changes={};preserved={}
        with zipfile.ZipFile(args.base) as old,zipfile.ZipFile(resources) as res,zipfile.ZipFile(unsigned,'w') as z:
            replacements={'classes.dex':(dex/'classes.dex').read_bytes(),'AndroidManifest.xml':res.read('AndroidManifest.xml')}
            for file in (ROOT/'assets').rglob('*'):
                name='assets/'+file.relative_to(ROOT/'assets').as_posix()
                if file.is_file() and name in old.namelist() and name!='assets/asset-receipt.json':
                    content=file.read_bytes()
                    if file.suffix=='.sh' and b'\r' in content:raise ValueError('Shell source must use LF: '+name)
                    if hashlib.sha256(content).digest()!=hashlib.sha256(old.read(name)).digest():replacements[name]=content
            receipt=json.loads(old.read('assets/asset-receipt.json'))
            for name,content in replacements.items():
                if name.startswith('assets/'):receipt['assets'][name[7:]]=hashlib.sha256(content).hexdigest()
            replacements['assets/asset-receipt.json']=json.dumps(receipt,ensure_ascii=False,indent=2).encode()
            for entry in old.infolist():
                if entry.filename.startswith('META-INF/'):continue
                if entry.filename in replacements:z.writestr(entry,replacements[entry.filename]);changes[entry.filename]=hashlib.sha256(replacements[entry.filename]).hexdigest()
                else:
                    with old.open(entry) as incoming,z.open(entry,'w') as target:shutil.copyfileobj(incoming,target,8*1024*1024)
                    preserved[entry.filename]=None
        aligned=scratch/'aligned.apk';run(bt/'zipalign.exe','-f','-p','4',unsigned,aligned)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        run(java/'java.exe','-jar',bt/'lib/apksigner.jar','sign','--ks',args.keystore,'--ks-key-alias','qqworkbench','--ks-pass','file:'+str(args.password_file),'--out',args.output,aligned)
        run(java/'java.exe','-jar',bt/'lib/apksigner.jar','verify','--print-certs',args.output);run(bt/'zipalign.exe','-c','-p','4',args.output)
        with zipfile.ZipFile(args.base) as old,zipfile.ZipFile(args.output) as new:
            for name in preserved:
                with old.open(name) as a,new.open(name) as b:
                    if hashlib.file_digest(a,'sha256').digest()!=hashlib.file_digest(b,'sha256').digest():raise ValueError('Preserved asset changed: '+name)
        receipt={'base':{'version':'1.0.7','sha256':BASE_SHA},'output':{'apk':str(args.output.resolve()),'bytes':args.output.stat().st_size,'sha256':digest(args.output)},'changedEntries':changes,'preservedVoiceAndRuntime':True}
        (ROOT/'build/build-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(receipt,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
