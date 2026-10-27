"""Compile our small Linux compatibility loader in the authorized private Ubuntu.

Requires gcc installed there; does not change upstream SnowLuma native binaries.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
ADB=ROOT.parent/'research/android/toolchain/platform-tools/adb.exe'
PACKAGE='cn.qqworkbench.assistant'
source=ROOT/'native-runtime/snow-preload.c'
def adb(*args,**kw):return subprocess.run([str(ADB),'-s','1987aee5',*args],check=True,**kw)
adb('push',str(source),'/data/local/tmp/qqwb-snow-preload.c')
adb('shell','run-as',PACKAGE,'cp','/data/local/tmp/qqwb-snow-preload.c','files/linux/rootfs/opt/qq-workbench/snow-preload-loader.c')
subprocess.run([sys.executable,'-X','utf8',str(ROOT/'device_container.py'),'gcc -shared -fPIC -O2 -nostdlib -o /opt/qq-workbench/snow-preload-loader.so.next /opt/qq-workbench/snow-preload-loader.c && mv /opt/qq-workbench/snow-preload-loader.so.next /opt/qq-workbench/snow-preload-loader.so'],check=True)
binary=adb('exec-out','run-as',PACKAGE,'cat','files/linux/rootfs/opt/qq-workbench/snow-preload-loader.so',stdout=subprocess.PIPE).stdout
assert binary[:6]==b'\x7fELF\x02\x01' and int.from_bytes(binary[18:20],'little')==183
(ROOT/'assets/snow-preload-loader.bin').write_bytes(binary)
receipt={'source':'native-runtime/snow-preload.c','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'binarySha256':hashlib.sha256(binary).hexdigest(),'target':'Linux AArch64 glibc','compiler':'Ubuntu GCC 13.3.0','flags':['-shared','-fPIC','-O2','-nostdlib']}
(ROOT/'assets/snow-preload-build.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
print(json.dumps(receipt))
