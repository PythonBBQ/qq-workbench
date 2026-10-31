"""Resume interrupted drafts; publish only after checking both remote asset hashes."""
import argparse,datetime,hashlib,json,os,re,shutil,subprocess,time,urllib.request
from pathlib import Path

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--repo',default='PythonBBQ/qq-workbench')
parser.add_argument('--notes',type=Path,required=True)
parser.add_argument('--gh',default=shutil.which('gh') or str(root.parent/'research/android/toolchain/github-cli/gh.exe'))
parser.add_argument('--upload-attempts',type=int,default=3)
parser.add_argument('--upload-timeout',type=int,default=3600)
args=parser.parse_args()
if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',args.repo):parser.error('Invalid repository')
if not 1<=args.upload_attempts<=5 or not 60<=args.upload_timeout<=7200:parser.error('Invalid upload limits')
manifest=(root/'AndroidManifest.xml').read_text(encoding='utf-8')
version=re.search(r'android:versionName="([^"]+)"',manifest).group(1)
tag='v'+version.removesuffix('-preview')
receipt=json.loads((root/'build/build-receipt.json').read_text(encoding='utf-8'))
apk=Path(receipt['output']['apk'])
def sha(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
actual=sha(apk)
assert actual==receipt['output']['sha256'],'APK changed since build verification'
release=root/('build/release-upload-'+tag[1:]);release.mkdir(exist_ok=True)
target=release/'QQWorkbench-Android.apk'
if not target.exists() or sha(target)!=actual:shutil.copyfile(apk,target)
sums=release/'SHA256SUMS.txt';sums.write_text(actual+'  '+target.name+'\n',encoding='ascii')
env=dict(os.environ)
env.setdefault('GH_CONFIG_DIR',str(root/'build/github-auth'))
env.setdefault('GODEBUG','http2client=0')
for protocol,proxy in urllib.request.getproxies().items():
    if protocol in ('http','https'):env.setdefault(protocol.upper()+'_PROXY',proxy)

def gh(*parts):return subprocess.check_output([args.gh,*map(str,parts)],env=env,encoding='utf-8',timeout=120)
def api(path):return json.loads(gh('api','repos/'+args.repo+'/'+path))
def phase(name,**fields):
    record=dict(phase=name,version=version,sha256=actual,at=datetime.datetime.now().isoformat(),**fields)
    (root/('build/publish-status-'+tag[1:]+'.json')).write_text(json.dumps(record,indent=2),encoding='utf-8')
    print(json.dumps(record,ensure_ascii=False),flush=True)
def find_release():
    # Drafts without a public tag cannot be read via /releases/tags/TAG.
    page=1
    while True:
        values=api('releases?per_page=100&page='+str(page))
        for value in values:
            if value['tag_name']==tag:return value
        if len(values)<100:return None
        page+=1
def verify(info):
    assets={asset['name']:asset for asset in info['assets']}
    for path in (target,sums):
        asset=assets.get(path.name,{})
        if asset.get('state')!='uploaded' or asset.get('size')!=path.stat().st_size or asset.get('digest')!='sha256:'+sha(path):
            raise RuntimeError('Remote asset incomplete: '+path.name)

try:
    head=api('commits/main')['sha'];info=find_release()
    if info and not info['draft']:
        verify(info);phase('published',url=info['html_url'],alreadyPublic=True)
    else:
        if info is None:
            gh('release','create',tag,'--repo',args.repo,'--target',head,'--title','七丘 QQ 工作台 '+version,'--draft','--notes-file',args.notes.resolve(strict=True))
            info=find_release()
        if info is None or not info['draft'] or info['target_commitish']!=head:raise RuntimeError('Draft target does not match main; left unpublished')
        upload_url=info['upload_url'].split('{')[0]
        if not re.fullmatch(r'https://uploads\.github\.com/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/[0-9]+/assets',upload_url):raise RuntimeError('Invalid upload URL')
        for path in (target,sums):
            for attempt in range(1,args.upload_attempts+1):
                info=find_release()
                if info is None or not info['draft']:raise RuntimeError('Draft state changed')
                asset=next((a for a in info['assets'] if a['name']==path.name),None)
                if asset:
                    if asset.get('state')=='uploaded' and asset.get('size')==path.stat().st_size and asset.get('digest')=='sha256:'+sha(path):break
                    gh('api','--method','DELETE','repos/'+args.repo+'/releases/assets/'+str(asset['id']))
                phase('uploading',asset=path.name,bytes=path.stat().st_size,attempt=attempt,commit=head)
                # Keep credentials out of command arguments, files and logs.
                token=gh('auth','token').strip()
                config='header = "Authorization: Bearer '+token+'"\nheader = "Content-Type: application/octet-stream"\n'
                progress=release/(path.name+'.upload-progress.log')
                with (release/(path.name+'.upload-response.json')).open('wb') as output,progress.open('wb') as log:
                    result=subprocess.run([shutil.which('curl.exe') or shutil.which('curl') or 'curl','--config','-','--request','POST',
                        '--upload-file',str(path),'--url',upload_url+'?name='+path.name,'--fail-with-body','--connect-timeout','30',
                        '--max-time',str(args.upload_timeout),'--speed-limit','1024','--speed-time','120'],
                        input=config.encode(),env=env,stdout=output,stderr=log,timeout=args.upload_timeout+30)
                if result.returncode==0:break
                if attempt==args.upload_attempts:raise RuntimeError('Upload incomplete; draft retained. See '+str(progress))
                time.sleep(3)
        info=find_release();verify(info)
        if api('commits/main')['sha']!=head:raise RuntimeError('Source changed during upload; draft retained')
        phase('publishing',commit=head)
        gh('release','edit',tag,'--repo',args.repo,'--draft=false','--latest','--notes-file',args.notes.resolve(strict=True),'--title','七丘 QQ 工作台 '+version)
        latest=api('releases/latest')
        if latest['tag_name']!=tag or latest['draft']:raise RuntimeError('Public latest release not confirmed')
        verify(latest)
        phase('published',commit=head,url=latest['html_url'],download=next(a['browser_download_url'] for a in latest['assets'] if a['name']==target.name))
except Exception:
    phase('failed_not_confirmed_published',message='Draft retained; rerun to resume. Do not publish missing assets manually.')
    raise
