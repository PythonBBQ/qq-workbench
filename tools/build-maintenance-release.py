"""Compile maintained sources and verify retained runtime/model assets byte-for-byte.

No model downloads, user settings, signing secrets or test hooks are embedded.
The ordinary build.py remains the full upstream-asset build entry point.
"""
from pathlib import Path
import argparse,copy,ctypes,hashlib,json,os,shutil,subprocess,sys,tempfile,zipfile

ROOT=Path(__file__).resolve().parents[1]
VERIFIED_BASES={
    'c3db3c16e5b8bf7f3f33646467b23b6cf93512294042e2f34f4d2dfd114ab29e':'1.1.0 / 11000',
    # Installed and verified on PHU110; retains the accepted voice reference pack.
    '61095698ce370c985bdd7506e879d9aba6825ea423ba69f4d6914c85bd31f96d':'1.0.10 / 10035',
    'de4df9417af9ba3113d30953299581d0446c366592938a0bbe3e3c444e80d147':'1.0.7',
    # Locally verified maintenance build; its runtime and voice assets were
    # checked byte-for-byte against the original 1.0.7 base (build receipt).
    '28f2854061a3c79a3e4345077bf708e340ddd26ef333e9363a18769241d0f95f':'1.0.9 / 10015',
}

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
    base_sha=digest(args.base)
    if base_sha not in VERIFIED_BASES:raise ValueError('Requires an exact verified maintenance base APK; no filename-based trust')
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
        unsigned=scratch/'unsigned.apk';changes={};preserved={};repacked={}
        # Android extracts these libraries on install. Compression changes only
        # the download representation; every expanded runtime byte is verified below.
        extract_native='android:extractNativeLibs="true"' in (ROOT/'AndroidManifest.xml').read_text(encoding='utf-8')
        with zipfile.ZipFile(args.base) as old,zipfile.ZipFile(resources) as res,zipfile.ZipFile(unsigned,'w') as z:
            replacements={'classes.dex':(dex/'classes.dex').read_bytes(),'AndroidManifest.xml':res.read('AndroidManifest.xml')}
            for file in (ROOT/'assets').rglob('*'):
                name='assets/'+file.relative_to(ROOT/'assets').as_posix()
                if file.is_file() and (name in old.namelist() or name in {'assets/qq-login-keyboard.js','assets/owner-chat.mjs','assets/owner-chat-score.mjs'}) and name!='assets/asset-receipt.json':
                    content=file.read_bytes()
                    if file.suffix=='.sh' and b'\r' in content:raise ValueError('Shell source must use LF: '+name)
                    if name not in old.namelist() or hashlib.sha256(content).digest()!=hashlib.sha256(old.read(name)).digest():replacements[name]=content
            receipt=json.loads(old.read('assets/asset-receipt.json'))
            for name,content in replacements.items():
                if name.startswith('assets/'):receipt['assets'][name[7:]]=hashlib.sha256(content).hexdigest()
            replacements['assets/asset-receipt.json']=json.dumps(receipt,ensure_ascii=False,indent=2).encode()
            for entry in old.infolist():
                if entry.filename.startswith('META-INF/'):continue
                source_entry=entry
                if extract_native and entry.filename.startswith('lib/') and entry.filename.endswith('.so') and entry.compress_type==zipfile.ZIP_STORED:
                    entry=copy.copy(entry);entry.compress_type=zipfile.ZIP_DEFLATED;entry._compresslevel=6
                    repacked[entry.filename]={'uncompressedBytes':entry.file_size}
                if entry.filename in replacements:z.writestr(entry,replacements[entry.filename]);changes[entry.filename]=hashlib.sha256(replacements[entry.filename]).hexdigest()
                else:
                    with old.open(source_entry) as incoming,z.open(entry,'w') as target:shutil.copyfileobj(incoming,target,8*1024*1024)
                    preserved[entry.filename]=None
            for name in sorted(set(replacements)-set(old.namelist())):
                z.writestr(name,replacements[name],compress_type=zipfile.ZIP_DEFLATED);changes[name]=hashlib.sha256(replacements[name]).hexdigest()
        aligned=scratch/'aligned.apk';run(bt/'zipalign.exe','-f','-p','4',unsigned,aligned)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        run(java/'java.exe','-jar',bt/'lib/apksigner.jar','sign','--ks',args.keystore,'--ks-key-alias','qqworkbench','--ks-pass','file:'+str(args.password_file),'--out',args.output,aligned)
        run(java/'java.exe','-jar',bt/'lib/apksigner.jar','verify','--print-certs',args.output);run(bt/'zipalign.exe','-c','-p','4',args.output)
        with zipfile.ZipFile(args.base) as old,zipfile.ZipFile(args.output) as new:
            for name in preserved:
                with old.open(name) as a,new.open(name) as b:
                    if hashlib.file_digest(a,'sha256').digest()!=hashlib.file_digest(b,'sha256').digest():raise ValueError('Preserved asset changed: '+name)
            for name,info in repacked.items():info['compressedBytes']=new.getinfo(name).compress_size
        voice_changes={name:sha for name,sha in changes.items() if name.startswith('assets/') and ('references' in name or 'models' in name or name.endswith('.onnx'))}
        runtime_changes={name:sha for name,sha in changes.items() if name.startswith('lib/') or name.startswith('assets/') and (name.endswith(('.tar.gz','.tar.xz','.so','.onnx')) or 'models' in name)}
        receipt={'base':{'version':VERIFIED_BASES[base_sha],'sha256':base_sha},'output':{'apk':str(args.output.resolve()),'bytes':args.output.stat().st_size,'sha256':digest(args.output)},'changedEntries':changes,'preservedVoiceAndRuntime':not voice_changes and not runtime_changes,'preservedModelsAndRuntime':not runtime_changes,'changedVoiceAssets':voice_changes,'losslessNativeCompression':repacked}
        (ROOT/'build/build-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(receipt,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
