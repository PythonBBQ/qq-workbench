"""Publish a locally verified, same-signed APK; never upload credentials or signing keys."""
import argparse,hashlib,json,os,re,shutil,subprocess
from pathlib import Path

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--repo',default='PythonBBQ/qq-workbench')
parser.add_argument('--notes',type=Path,required=True)
parser.add_argument('--gh',default=shutil.which('gh') or str(root.parent/'research/android/toolchain/github-cli/gh.exe'))
args=parser.parse_args()
manifest=(root/'AndroidManifest.xml').read_text(encoding='utf-8')
version=re.search(r'android:versionName="([^"]+)"',manifest).group(1)
tag='v'+version.removesuffix('-preview')
receipt=json.loads((root/'build/build-receipt.json').read_text(encoding='utf-8'))
apk=Path(receipt['output']['apk'])
actual=hashlib.file_digest(apk.open('rb'),'sha256').hexdigest()
assert actual==receipt['output']['sha256'],'APK changed since build verification'
release=root/'build/release-upload';release.mkdir(exist_ok=True)
target=release/'QQWorkbench-Android.apk';shutil.copyfile(apk,target)
(release/'SHA256SUMS.txt').write_text(actual+'  '+target.name+'\n',encoding='ascii')
env=dict(os.environ)
env.setdefault('GH_CONFIG_DIR',str(root/'build/github-auth'))
cmd=[args.gh,'release','create',tag,str(target),str(release/'SHA256SUMS.txt'),'--repo',args.repo,'--title','七丘 QQ 工作台 '+version,'--notes-file',str(args.notes)]
subprocess.run(cmd,env=env,check=True)
print(json.dumps({'tag':tag,'repo':args.repo,'sha256':actual,'published':True}))
