"""Inventory only known QQWB test artifacts; archive before optional cleanup."""
from pathlib import Path
import subprocess,json,re,hashlib,sys,tarfile
ROOT=Path(__file__).resolve().parents[1]
ADB=ROOT.parent/'research/android/toolchain/platform-tools/adb.exe'
SERIAL='1987aee5'; PKG='cn.qqworkbench.assistant'
OUT=ROOT/'build/tablet-storage-20261102'; OUT.mkdir(parents=True,exist_ok=True)
WORK='files/linux/rootfs/opt/qq-workbench'
def run(*args,timeout=120):
    p=subprocess.run([str(ADB),'-s',SERIAL,*args],capture_output=True,timeout=timeout);p.check_returncode();return p.stdout
def app(*args):return run('exec-out','run-as',PKG,*args)
def ls(p):return app('ls','-1',p).decode().splitlines()
plan=[]
for base,pattern in [('files',r'(?:full-voice-probe-|voice-preset-probe-).+'),('files/voice-references',r'slot-[0-3]\.backup-[a-f0-9-]{36}'),(WORK,r'(?:voice-(?:quality-|tablet-|intimate-|soft-|user-soft-|selected-p01-).+|(?:six-local-|six-reference-|ssr-reference-|ssr-source-|ssr-v2-|speech-validation-|teacher-voice-|ready-validation-).+|character-daily-asr|bili-video-tests|evolution-tests|natural-browse-tests|next-version-tests|search-speed-tests|video-budget-tests|startup-smoke|snow-integration-test|snow-recovery-test|snow-probe|napcat|napcat-probe.zip|napcat.zip|qq332.deb|SnowLuma-v[0-9.]+-linux-arm64-lite.tar.gz|device-(?!tools\.).+|native-probe.cjs|session-probe.sh|qq-direct-probe.log|snow-recheck-screen.bgra)')]:
    for name in ls(base):
        if re.fullmatch(pattern,name):
            p=base+'/'+name
            # All candidates are explicit children of these three known directories.
            size=int(app('du','-sk',p).decode().split()[0])*1024
            plan.append({'path':p,'bytes':size})
downloads=[]
for name in ['QQWorkbench-Android-preview.apk','QQWorkbench-Android-preview.zip','TIM-4.1.0-official.apk','Feiyu-SSR-V2.zip','Feiyu-V1-Restore.zip']:
    p='/sdcard/Download/'+name
    try:size=int(run('shell','stat','-c','%s',p).decode().strip())
    except subprocess.CalledProcessError:continue
    downloads.append({'path':p,'bytes':size})
report={'appArtifacts':plan,'oldDownloads':downloads,'candidateBytes':sum(p['bytes'] for p in plan+downloads),'cleanup':False}
(OUT/'inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'artifacts':len(plan),'downloads':len(downloads),'candidateMiB':round(report['candidateBytes']/1048576,1)}),flush=True)
if '--clean' not in sys.argv:sys.exit(0)
archive=OUT/'app-test-artifacts.tar'
with archive.open('wb') as out:
    result=subprocess.run([str(ADB),'-s',SERIAL,'exec-out','run-as',PKG,'tar','-cf','-',*[p['path'] for p in plan]],stdout=out,stderr=subprocess.PIPE,timeout=600)
    result.check_returncode()
with tarfile.open(archive) as tar:
    names=tar.getnames()
    for p in plan:
        assert any(n.rstrip('/')==p['path'] or n.startswith(p['path']+'/') for n in names),p['path']
for p in downloads:
    target=OUT/Path(p['path']).name
    run('pull',p['path'],str(target),timeout=180)
    assert target.stat().st_size==p['bytes']
    remote=run('shell','sha256sum',p['path']).decode().split()[0]
    assert hashlib.file_digest(target.open('rb'),'sha256').hexdigest()==remote
    p['backupSha256']=remote
# No shell-built deletion commands, no wildcard expansion, no rootfs traversal.
for p in plan:app('rm','-rf','--',p['path'])
for p in downloads:run('shell','rm','--',p['path'])
report['cleanup']=True;report['archiveBytes']=archive.stat().st_size
(OUT/'cleanup-receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('Archived and removed explicit test artifacts and obsolete downloads.',flush=True)
