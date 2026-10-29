from pathlib import Path
import subprocess,zipfile,sys,os
sys.stdout.reconfigure(encoding="utf-8",errors="replace")
sys.stderr.reconfigure(encoding="utf-8",errors="replace")
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from adb_device import select_device
tool=root.parent/'research/android/toolchain'
java=Path(os.environ.get('QQWB_JAVA_BIN','D:/STM32CubeMX/jre/bin'))
sdk=tool/'platform-35_r02/android-35/android.jar'
bt=tool/'build-tools_r35_windows/android-15'
out=root/'build/native-settings-check'
classes=out/'classes';dex=out/'dex'
classes.mkdir(parents=True,exist_ok=True);dex.mkdir(exist_ok=True)
def run(*args):
    result=subprocess.run([str(a) for a in args],capture_output=True,text=True,encoding='utf-8',errors='replace')
    if result.returncode:print(result.stdout,result.stderr);result.check_returncode()
    return result
from tools.shizuku_deps import sdk_jars
shizuku_jars=sdk_jars(root)
sources=list((root/'src').rglob('*.java'))+[root/'tests/NativeSettingsCheck.java',root/'tests/PhotoBackgroundCheck.java',root/'tests/CharacterCardCheck.java',root/'tests/VideoFramesCheck.java',root/'tests/PythonBootstrapCheck.java',root/'tests/NavigationUpdateCheck.java',root/'tests/InstalledUpdateCheck.java',root/'tests/UnixTextCheck.java',root/'tests/UsageAgreementCheck.java']
if '--relay-profiles' in sys.argv:sources.append(root/'tests/RelayProfilesCheck.java')
if '--device-tools' in sys.argv:sources.append(root/'tests/DeviceRuntimeCheck.java')
print(run(java/'javac.exe','-encoding','UTF-8','-source','8','-target','8','-Xlint:-options','-bootclasspath',str(bt/'core-lambda-stubs.jar')+';'+str(sdk),'-classpath',';'.join(map(str,shizuku_jars)),'-d',classes,*sources).stderr)
jar=out/'classes.jar'
with zipfile.ZipFile(jar,'w') as z:
    for p in classes.rglob('*.class'):z.write(p,p.relative_to(classes).as_posix())
run(java/'java.exe','-Xmx1024m','-cp',bt/'lib/d8.jar','com.android.tools.r8.D8','--min-api','30','--lib',sdk,'--output',dex,jar,*shizuku_jars)
check=out/'check.jar'
with zipfile.ZipFile(check,'w') as z:z.write(dex/'classes.dex','classes.dex')
adb=tool/'platform-tools/adb.exe'
if '--compile-only' in sys.argv:
    print('QQWB_NATIVE_COMPILE_OK: all production Java and native checks compiled; device execution skipped')
    sys.exit(0)
SERIAL=select_device(adb)
remote='/data/local/tmp/qqwb-native-settings-check.jar'
run(adb,'-s',SERIAL,'shell',f'if [ -f {remote} ]; then chmod 644 {remote}; fi')
print(run(adb,'-s',SERIAL,'push',check,remote).stdout)
# Xiaomi shell media services differ from the installed Application context.
# Opt in for this diagnostic; FFmpeg decoding is verified separately.
tests=['NativeSettingsCheck','PhotoBackgroundCheck','CharacterCardCheck','PythonBootstrapCheck','NavigationUpdateCheck','UnixTextCheck','UsageAgreementCheck']
if '--native-video' in sys.argv:tests.append('VideoFramesCheck')
else:print('Native video shell probe NOT RUN: requires real Application context; use FFmpeg device verification')
for test in tests:
    result=run(adb,'-s',SERIAL,'shell',f'CLASSPATH={remote} app_process /system/bin cn.qqworkbench.assistant.{test}')
    print(result.stdout,result.stderr)
    if 'QQWB_' not in result.stdout:raise RuntimeError('Native check did not confirm success')
if '--repair-python' in sys.argv:
    run(adb,'-s',SERIAL,'shell','chmod','444',remote)
    fixed=run(adb,'-s',SERIAL,'shell',f'run-as cn.qqworkbench.assistant sh -c "CLASSPATH={remote} app_process /system/bin cn.qqworkbench.assistant.PythonBootstrapCheck --repair-app"')
    print(fixed.stdout,fixed.stderr)
if '--relay-profiles' in sys.argv:
    # Android 14+ requires immutable dex input when running as a target-SDK-35 app UID.
    run(adb,'-s',SERIAL,'shell','chmod','444',remote)
    extra=' --bridge' if '--bridge' in sys.argv else ''
    diagnostic=run(adb,'-s',SERIAL,'shell',f'run-as cn.qqworkbench.assistant sh -c "CLASSPATH={remote} app_process /system/bin cn.qqworkbench.assistant.RelayProfilesCheck --test{extra}"')
    print(diagnostic.stdout,diagnostic.stderr)

if '--device-tools' in sys.argv:
    run(adb,'-s',SERIAL,'shell','chmod','444',remote)
    result=run(adb,'-s',SERIAL,'shell',f'run-as cn.qqworkbench.assistant sh -c "CLASSPATH={remote} app_process /system/bin cn.qqworkbench.assistant.DeviceRuntimeCheck"')
    print(result.stdout,result.stderr)
    if 'QQWB_DEVICE_RUNTIME_OK' not in result.stdout:raise RuntimeError('Device tools integration check did not confirm success')
