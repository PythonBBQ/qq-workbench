"""Reproducible small Java shell using official Android tools; no Gradle/global SDK writes."""
from pathlib import Path
import hashlib, json, os, secrets, shutil, subprocess, zipfile, tarfile

ROOT = Path(__file__).resolve().parent
RESEARCH = ROOT.parent / 'research/android'
TOOLS = RESEARCH / 'toolchain/build-tools_r35_windows/android-15'
ANDROID = RESEARCH / 'toolchain/platform-35_r02/android-35/android.jar'
JAVA = Path(os.environ.get('QQWB_JAVA_BIN', 'D:/STM32CubeMX/jre/bin'))
APK_SOURCE = Path(os.environ.get('QQWB_DSHA_APK', str(RESEARCH/'releases/DSHA-pinned.apk')))
if not APK_SOURCE.exists():
    APK_SOURCE = Path('C:/Users/Administrator/Downloads/DSHA.apk.1')
BUILD = ROOT / 'build'
ASSETS = ROOT / 'assets'
OUT = ROOT.parents[1] / 'Exports/七丘QQ工作台-安卓预览版.apk'

def sha(p):
    with open(p, 'rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def run(*args):
    subprocess.run([str(a) for a in args], cwd=ROOT, check=True)

BUILD.mkdir(exist_ok=True)
OUT.parent.mkdir(exist_ok=True)
import sys
run(sys.executable, ROOT/'tools/build-multi-parser.py')
run(sys.executable, ROOT/'tools/build-video-asr.py')
# A Windows checkout must not ship CRLF shell scripts into the Linux container.
for script in ASSETS.glob('*.sh'):
    if b'\r' in script.read_bytes():
        raise ValueError('Shell asset must use LF line endings: '+script.name)
bash=shutil.which('bash') or next((str(p) for p in [Path('C:/Program Files/Git/bin/bash.exe'),Path('D:/Git/bin/bash.exe')] if p.exists()),None)
if bash:
    for script in ASSETS.glob('*.sh'):run(bash,'-n',script)
assert sha(APK_SOURCE) == '1fedf883d431af658d89c28b86d85974cc1d11b74e0c5d46ef3d3cf8650b1961'
notices = ASSETS / 'licenses'
notices.mkdir(exist_ok=True)
for p in (RESEARCH/'DSHA-upstream/app/src/main/assets/licenses').glob('*.txt'):
    if p.name in ('proot-COPYING.txt','GPL-3.0.txt','LGPL-3.0.txt','MPL-2.0.txt'):shutil.copyfile(p,notices/p.name)
shutil.copyfile(RESEARCH/'DSHA-upstream/THIRD_PARTY_NOTICES.md',notices/'DSHA-UPSTREAM-NOTICES.md')
for origin, label in [(RESEARCH/'DSHA-upstream/LICENSE','DSHA-MIT.txt'), (RESEARCH/'snow-source/SnowLuma-main/LICENSE','SnowLuma-LICENSE.txt'), (RESEARCH/'SnowLuma-arm64/EULA.md','SnowLuma-EULA.md'), (RESEARCH/'SnowLuma-arm64/PRIVACY.md','SnowLuma-PRIVACY.md')]:
    shutil.copyfile(origin, notices / label)
snow_bridge=RESEARCH/'releases/SnowLuma-v1.14.22-linux-arm64-lite.tar.gz'
assert sha(snow_bridge)=='c394af290c2fe3f88a31fc2a6b1dc43f432a80ee4b6d767d92d1e0be74a7e0d5'
shutil.copyfile(snow_bridge,ASSETS/'snowluma-bridge.tar.gz')
with tarfile.open(snow_bridge) as archive:
    for name in ['EULA.md','PRIVACY.md']:
        (notices/('SnowLuma-1.14.22-'+name)).write_bytes(archive.extractfile('./'+name).read())
# The original archive remains in research/releases for rollback. It is not
# bundled or launched by this release.
for old_asset in ['napcat.zip','napcat-setup.py','napcat-bridge.mjs']:
    target=ASSETS/old_asset
    if target.exists():
        backup=BUILD/'napcat-source-backup'/old_asset
        backup.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(target,backup)
        target.unlink()

native = BUILD / 'native/arm64-v8a'
native.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(APK_SOURCE) as z:
    for name in ['offline-rootfs.bin', 'glibc-python.bin', 'python-support.bin']:
        target = ASSETS/name
        if not target.exists() or target.stat().st_size != z.getinfo('assets/'+name).file_size:
            with z.open('assets/'+name) as a, open(target, 'wb') as b: shutil.copyfileobj(a,b)
    assert sha(ASSETS/'offline-rootfs.bin') == z.read('assets/offline-rootfs.sha256').decode().strip()
    for name in ['libproot.so','libprootloader.so','libtalloc.so','libandroidshmem.so']:
        (native/name).write_bytes(z.read('lib/arm64-v8a/'+name))
for origin, name in [(RESEARCH/'releases/SnowLuma-v2.2.0-linux-arm64.tar.gz','snowluma.tar.gz'),(RESEARCH/'releases/linuxqq_3.2.34-53644_arm64.deb','linuxqq.deb')]:
    if not (ASSETS/name).exists() or sha(ASSETS/name)!=sha(origin):shutil.copyfile(origin,ASSETS/name)
assert sha(ASSETS/'linuxqq.deb')=='181b895cb573548e396e54bb0548cca92ffdc1b1a4b018fa4551bb062385fdca'
local_native=json.loads((ASSETS/'snow-preload-build.json').read_text(encoding='utf-8'))
assert sha(ROOT/local_native['source'])==local_native['sourceSha256'], 'Rebuild the Linux preload loader after editing its source'
assert sha(ASSETS/'snow-preload-loader.bin')==local_native['binarySha256']
from tools.zipvoice_deps import sdk_jars as voice_jars, bundle as voice_bundle
voice_bundle(ROOT)
python_files=set()
for name in ['glibc-python.bin','python-support.bin']:
    with tarfile.open(ASSETS/name) as archive:
        for member in archive:
            if member.isfile() and member.size>0 and (member.name.startswith('usr/lib/') or member.name=='usr/bin/python3.12'):python_files.add(member.name)
(ASSETS/'python-runtime-files.json').write_text(json.dumps(sorted(python_files)),encoding='utf-8')
receipt={'schema':1,'sources':{'DSHA':{'commit':'8362bba747fcf84c19e436c3dbb594a0fc388a67','url':'https://github.com/DSH-APP/DSHA','apkSha256':sha(APK_SOURCE)},'SnowLuma':{'version':'2.2.0','url':'https://github.com/SnowLuma/SnowLuma/releases/tag/v2.2.0','sha256':sha(ASSETS/'snowluma.tar.gz')},'LinuxQQ':{'version':'3.2.34-53644','sha256':sha(ASSETS/'linuxqq.deb')}},'assets':{p.name:sha(p) for p in ASSETS.iterdir() if p.is_file()}}
receipt['sources']['SnowLuma']['role']='Node.js runtime only; 2.2.0 native bridge is not loaded'
receipt['sources']['SnowLumaBridge']={'version':'1.14.22','url':'https://github.com/SnowLuma/SnowLuma/releases/tag/v1.14.22','sha256':sha(ASSETS/'snowluma-bridge.tar.gz')}
(ASSETS/'asset-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
classes=BUILD/'classes'
classes.mkdir(exist_ok=True)
sources=sorted((ROOT/'src').rglob('*.java'))
from tools.shizuku_deps import sdk_jars
shizuku_jars=sdk_jars(ROOT)
shizuku_jars+=voice_jars(ROOT,native)
# Compile Java library calls against Android, not the host JDK (e.g. Files.writeString is absent even on API 35).
run(JAVA/'javac.exe','-encoding','UTF-8','-source','8','-target','8','-Xlint:-options','-bootclasspath',str(TOOLS/'core-lambda-stubs.jar')+os.pathsep+str(ANDROID),'-classpath',os.pathsep.join(map(str,shizuku_jars)),'-d',classes,*sources)
jar=BUILD/'classes.jar'
with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as z:
    for p in classes.rglob('*.class'):z.write(p,p.relative_to(classes).as_posix())
dex=BUILD/'dex'
dex.mkdir(exist_ok=True)
run(JAVA/'java.exe','-Xmx1024m','-cp',TOOLS/'lib/d8.jar','com.android.tools.r8.D8','--min-api','30','--lib',ANDROID,'--output',dex,jar,*shizuku_jars)
unsigned=BUILD/'unsigned.apk'
run(TOOLS/'aapt.exe','package','-f','-M',ROOT/'AndroidManifest.xml','-S',ROOT/'res','-I',ANDROID,'-F',unsigned)
with zipfile.ZipFile(unsigned,'a') as z:
    # aapt transparently expands *.gz and removes the suffix; preserve pinned assets verbatim.
    for p in sorted(ASSETS.rglob('*')):
        if p.is_file():z.write(p,'assets/'+p.relative_to(ASSETS).as_posix(),compress_type=zipfile.ZIP_STORED)
    z.write(dex/'classes.dex','classes.dex',compress_type=zipfile.ZIP_DEFLATED)
    for p in native.iterdir():z.write(p,'lib/arm64-v8a/'+p.name,compress_type=zipfile.ZIP_STORED)
aligned=BUILD/'aligned.apk'
run(TOOLS/'zipalign.exe','-f','-p','4',unsigned,aligned)
keystore=BUILD/'development-signing.p12'
password=BUILD/'signing-password.txt'
if not keystore.exists():
    password.write_text(secrets.token_urlsafe(36),encoding='ascii')
    run(JAVA/'keytool.exe','-genkeypair','-keystore',keystore,'-storetype','PKCS12','-alias','qqworkbench','-keyalg','RSA','-keysize','3072','-validity','3650','-dname','CN=Qiqiu Workbench Local Preview','-storepass:file',password,'-keypass:file',password)
run(JAVA/'java.exe','-jar',TOOLS/'lib/apksigner.jar','sign','--ks',keystore,'--ks-key-alias','qqworkbench','--ks-pass','file:'+str(password),'--out',OUT,aligned)
run(JAVA/'java.exe','-jar',TOOLS/'lib/apksigner.jar','verify','--print-certs',OUT)
run(TOOLS/'zipalign.exe','-c','-p','4',OUT)
with zipfile.ZipFile(OUT) as z:
    for p in sorted(ASSETS.rglob('*')):
        if p.is_file():
            with z.open('assets/'+p.relative_to(ASSETS).as_posix()) as f:actual=hashlib.file_digest(f,'sha256').hexdigest()
            assert actual==sha(p), f'Packaged asset mismatch: {p.name}'
receipt['output']={'apk':str(OUT),'sha256':sha(OUT),'bytes':OUT.stat().st_size}
(BUILD/'build-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(receipt['output'],ensure_ascii=False))
