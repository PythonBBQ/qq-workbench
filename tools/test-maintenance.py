"""Compile production sources and run migration/update regressions without QQ or API calls."""
from pathlib import Path
import argparse,ctypes,importlib.util,os,subprocess,sys,tempfile

root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser()
for name in ['cache-root','toolchain','java-bin','json-jar']:p.add_argument('--'+name,type=Path,required=True)
a=p.parse_args()
if os.name=='nt':
    k=ctypes.WinDLL('kernel32',use_last_error=True);k.GetCurrentProcess.restype=ctypes.c_void_p;k.SetProcessAffinityMask.argtypes=[ctypes.c_void_p,ctypes.c_size_t];k.SetPriorityClass.argtypes=[ctypes.c_void_p,ctypes.c_uint]
    k.SetProcessAffinityMask(k.GetCurrentProcess(),255);k.SetPriorityClass(k.GetCurrentProcess(),0x4000)
sys.path.insert(0,str(root));from tools.shizuku_deps import sdk_jars
from tools.zipvoice_deps import sdk_jars as voice_jars
jars=sdk_jars(a.cache_root)+voice_jars(a.cache_root)
sdk=a.toolchain/'platform-35_r02/android-35/android.jar';bt=a.toolchain/'build-tools_r35_windows/android-15'
tests=['UpdatePlanCheck','RuntimeOwnershipCheck','MigrationCheck','ResumableDownloadCheck','ApkPatchCheck','UpdateFeedCheck','VoiceExpressionPolicyCheck','WebVideoPolicyCheck']
work=root/'build/maintenance-host';work.mkdir(parents=True,exist_ok=True)
def run(*parts):subprocess.run(list(map(str,parts)),check=True,cwd=root)
with tempfile.TemporaryDirectory(dir=work) as temp:
    temp=Path(temp);classes=temp/'classes';classes.mkdir()
    run(a.java_bin/'javac.exe','-encoding','UTF-8','-source','8','-target','8','-Xlint:-options','-bootclasspath',str(bt/'core-lambda-stubs.jar')+os.pathsep+str(sdk),'-classpath',os.pathsep.join(map(str,jars)),'-d',classes,*sorted((root/'src').rglob('*.java')),*[root/'tests'/(name+'.java') for name in tests])
    spec=importlib.util.spec_from_file_location('fixtures',root/'tests/apk-patch-test.py');fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures);fixtures.fixtures(temp/'patches')
    for name in tests:
        run(a.java_bin/'java.exe','-cp',os.pathsep.join(map(str,[a.json_jar,classes,sdk,*jars])),'cn.qqworkbench.assistant.'+name,temp/'patches' if name=='ApkPatchCheck' else temp,*(['--skip-host-symlink'] if name=='MigrationCheck' and os.name=='nt' else []))
run(sys.executable,root/'tests/android-reinstall-test.py');run(sys.executable,root/'tests/apk-patch-test.py')
print('QQWB_MAINTENANCE_HOST_OK',flush=True)
