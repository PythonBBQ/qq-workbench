"""Run bounded, no-model synthetic video decoding inside the installed container."""
from pathlib import Path
import hashlib, json, shlex, subprocess, sys

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from adb_device import select_device
adb=root.parent/'research/android/toolchain/platform-tools/adb.exe'
serial=select_device(adb)
base='/data/user/0/cn.qqworkbench.assistant/files/linux/rootfs/opt/qq-workbench/video-budget-tests'
ffmpeg=root.parent/'research/android/video-test-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'
out=root/'build/video-budget';out.mkdir(parents=True,exist_ok=True)

def shell(*args,data=None):
    p=subprocess.run([str(adb),'-s',serial,'shell',shlex.join(['run-as','cn.qqworkbench.assistant',*args])],input=data,capture_output=True,check=True)
    return p.stdout

shell('mkdir','-p',base)
for p in [root/'assets/video-decoder.mjs',root/'assets/video.mjs',root/'tests/device-video-budget.mjs']:
    shell('sh','-c','cat > '+shlex.quote(base+'/'+p.name),data=p.read_bytes())
for seconds in [1.1,120,121.1,600]:
    clip=out/('synthetic-'+str(seconds)+'.mp4')
    subprocess.run([str(ffmpeg),'-v','error','-nostdin','-y','-threads','1','-f','lavfi','-i','testsrc2=size=320x180:rate=10','-t',str(seconds),'-c:v','libx264','-threads','1','-preset','ultrafast','-crf','30','-g','20',str(clip)],check=True)
    remote='/data/local/tmp/qqwb-budget-'+str(seconds)+'.mp4'
    subprocess.run([str(adb),'-s',serial,'push',str(clip),remote],check=True,capture_output=True)
    shell('cp',remote,base+'/'+clip.name)
    assert shell('sha256sum',base+'/'+clip.name).decode().split()[0]==hashlib.sha256(clip.read_bytes()).hexdigest()
subprocess.run([sys.executable,'-X','utf8',str(root/'device_container.py'),'--accelerated','/opt/snowluma/node /opt/qq-workbench/video-budget-tests/device-video-budget.mjs'],check=True)
report=json.loads(shell('cat',base+'/verification.json'))
(out/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
