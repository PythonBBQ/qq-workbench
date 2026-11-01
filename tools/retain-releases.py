"""Keep the current full baseline and latest patch (or the two newest full releases).

Prints the concrete plan by default. --apply removes Release assets, never source tags.
"""
import argparse,json,os,re,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--repo',default='PythonBBQ/qq-workbench');a=p.parse_args()
gh=root.parent/'research/android/toolchain/github-cli/gh.exe';env=dict(os.environ);env.setdefault('GH_CONFIG_DIR',str(root/'build/github-auth'));env.setdefault('GODEBUG','http2client=0')
def call(*args):return subprocess.check_output([str(gh),*args],env=env,encoding='utf-8',timeout=120)
values=json.loads(call('api',f'repos/{a.repo}/releases?per_page=100'))
public=[r for r in values if not r['draft'] and re.fullmatch(r'v\d+\.\d+\.\d+',r['tag_name'])]
public.sort(key=lambda r:tuple(map(int,r['tag_name'][1:].split('.'))),reverse=True)
keep={r['id'] for r in public[:2]}
if public:
    tag=public[0]['tag_name'];major,minor,patch=map(int,tag[1:].split('.'))
    if major>=1 and patch:
        foundation=next((r for r in public if r['tag_name']==f'v{major}.{minor}.0'),None)
        if foundation is None:raise RuntimeError('Full baseline missing; refusing retention')
        keep={public[0]['id'],foundation['id']}
remove=[r for r in public if r['id'] not in keep]
print(json.dumps({'keep':[r['tag_name'] for r in public if r['id'] in keep],'remove':[r['tag_name'] for r in remove],'apply':a.apply}))
if a.apply:
    for release in remove:call('release','delete',release['tag_name'],'--repo',a.repo,'--yes')
