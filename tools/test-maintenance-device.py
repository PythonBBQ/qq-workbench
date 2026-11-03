"""Opt-in real-app regression; only synthetic targets are imported, live data is read-only.

Requires the maintenance release already installed and a same-signed test APK.
Briefly stops the runtime. Does not log credentials or send QQ messages.
"""
from pathlib import Path
import argparse,ctypes,os,subprocess,sys,tempfile,zipfile

root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
for name in ['cache-root','toolchain','java-bin','keystore','password-file']:p.add_argument('--'+name,type=Path,required=True)
p.add_argument('--serial',required=True);a=p.parse_args()
if os.name=='nt':
    k=ctypes.WinDLL('kernel32',use_last_error=True);k.GetCurrentProcess.restype=ctypes.c_void_p;k.SetProcessAffinityMask.argtypes=[ctypes.c_void_p,ctypes.c_size_t];k.SetPriorityClass.argtypes=[ctypes.c_void_p,ctypes.c_uint]
    k.SetProcessAffinityMask(k.GetCurrentProcess(),255);k.SetPriorityClass(k.GetCurrentProcess(),0x4000)
sys.path.insert(0,str(root));from tools.shizuku_deps import sdk_jars
from tools.zipvoice_deps import sdk_jars as voice_jars
jars=sdk_jars(a.cache_root)+voice_jars(a.cache_root);bt=a.toolchain/'build-tools_r35_windows/android-15';sdk=a.toolchain/'platform-35_r02/android-35/android.jar'
adb=[a.toolchain/'platform-tools/adb.exe','-s',a.serial]
def run(*parts,timeout=120):
    result=subprocess.run(list(map(str,parts)),check=True,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout)
    return result.stdout
work=root/'build/maintenance-device';work.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(dir=work) as temp:
    temp=Path(temp);classes=temp/'classes';classes.mkdir();dex=temp/'dex';dex.mkdir()
    tests=[root/'tests'/n for n in ['BackupInstrumentation.java','MigrationCheck.java','MigrationDeviceCheck.java']]
    run(a.java_bin/'javac.exe','-encoding','UTF-8','-source','8','-target','8','-Xlint:-options','-bootclasspath',str(bt/'core-lambda-stubs.jar')+os.pathsep+str(sdk),'-classpath',os.pathsep.join(map(str,jars)),'-d',classes,*sorted((root/'src').rglob('*.java')),*tests)
    jar=temp/'tests.jar'
    with zipfile.ZipFile(jar,'w') as z:
        for file in classes.rglob('*.class'):
            name=file.relative_to(classes).as_posix()
            if name.startswith('cn/qqworkbench/backupcheck/') or name.startswith('cn/qqworkbench/assistant/MigrationCheck') or name.startswith('cn/qqworkbench/assistant/MigrationDeviceCheck'):z.write(file,name)
    run(a.java_bin/'java.exe','-cp',bt/'lib/d8.jar','com.android.tools.r8.D8','--min-api','30','--lib',sdk,'--output',dex,jar)
    manifest=temp/'AndroidManifest.xml';manifest.write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="cn.qqworkbench.backupcheck"><uses-sdk android:minSdkVersion="30" android:targetSdkVersion="35"/><instrumentation android:name=".BackupInstrumentation" android:targetPackage="cn.qqworkbench.assistant"/><application android:label="Maintenance regression" android:hasCode="true"/></manifest>')
    run(bt/'aapt.exe','package','-f','-M',manifest,'-I',sdk,'-F',temp/'unsigned.apk')
    with zipfile.ZipFile(temp/'unsigned.apk','a') as z:z.write(dex/'classes.dex','classes.dex')
    run(bt/'zipalign.exe','-f','4',temp/'unsigned.apk',temp/'aligned.apk')
    run(a.java_bin/'java.exe','-jar',bt/'lib/apksigner.jar','sign','--ks',a.keystore,'--ks-key-alias','qqworkbench','--ks-pass','file:'+str(a.password_file),'--out',temp/'check.apk',temp/'aligned.apk')
    print(run(*adb,'install','-r','--user','0',temp/'check.apk'),flush=True)
    try:
        result=run(*adb,'shell','am','instrument','-w','cn.qqworkbench.backupcheck/.BackupInstrumentation',timeout=240)
        (work/'receipt.txt').write_text(result,encoding='utf-8');print(result,flush=True)
        if 'result=QQWB_BACKUP_LOCK_OK' not in result or 'INSTRUMENTATION_CODE: -1' not in result:raise RuntimeError('Device maintenance check did not confirm success')
    finally:print(run(*adb,'uninstall','cn.qqworkbench.backupcheck'),flush=True)
