"""Verify bundled Ubuntu packages and preserve dpkg metadata and user settings."""
import hashlib, json, re, subprocess, sys
from pathlib import Path

def plan(bundle, lock, required, installed, compare):
    selected = []
    for item in lock['packages']:
        name = item['file']; package = item['package']; version = item['version']
        if not re.fullmatch(r'[A-Za-z0-9.+_:~%-]+\.deb', name) or not re.fullmatch(r'[a-z0-9][a-z0-9+.-]+', package):
            raise ValueError('Invalid pinned package')
        target = bundle/name
        if target.is_symlink() or not target.is_file() or target.stat().st_size != item['bytes']:
            raise ValueError('Bundled package missing: '+package)
        with target.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
                raise ValueError('Bundled package checksum mismatch: '+package)
        status, current = installed.get(package, ('not-installed',''))
        # An updated device is never downgraded to the APK's pinned packages.
        if current and current != version and compare(current, version) > 0: continue
        if status != 'installed' or current != version or package in required:
            selected.append((package, target))
    return selected

def main():
    work = Path('/opt/qq-workbench'); bundle = work/'qq-environment'
    lock = json.loads((work/'qq-environment-lock.json').read_text())
    if lock['schema'] != 1 or lock['architecture'] != 'arm64': raise ValueError('Invalid package lock')
    try: required = set(json.loads((work/'environment-status.json').read_text())['packages'])
    except (OSError, ValueError, KeyError): required = {'python3','python3-minimal','python3.12','libpython3.12-stdlib'}
    print('QQWB:正在校验内置离线组件，无需网络下载…', flush=True)
    result = subprocess.run(['dpkg-query','-W','-f=${binary:Package}\t${db:Status-Status}\t${Version}\n'], capture_output=True, text=True, check=True)
    installed = {}
    for row in result.stdout.splitlines():
        values = row.split('\t')
        if len(values) == 3: installed[values[0].split(':')[0]] = (values[1],values[2])
    def compare(a,b):
        return 1 if subprocess.run(['dpkg','--compare-versions',a,'gt',b]).returncode == 0 else -1
    selected = plan(bundle,lock,required,installed,compare)
    if not selected: return
    print('QQWB:正在安装 '+str(len(selected))+' 个内置组件；账号和设置保留…', flush=True)
    with (work/'environment-offline.log').open('a') as log:
        # Noble's python3-minimal Pre-Depends on a configured python3.12-minimal;
        # python3 in turn Pre-Depends on python3-minimal. Alphabetical bulk unpack
        # cannot satisfy these. Seed that fixed chain before unpacking the rest.
        pending = dict(selected)
        for names in [('libexpat1','libpython3.12-minimal','python3.12-minimal'),('python3-minimal',)]:
            seed = [(name,pending.pop(name)) for name in names if name in pending]
            if not seed: continue
            subprocess.run(['dpkg','--force-confold','--unpack',*[str(p) for _,p in seed]], stdout=log, stderr=log, check=True)
            subprocess.run(['dpkg','--force-confold','--configure',*[name for name,_ in seed]], stdout=log, stderr=log, check=True)
        if pending:
            subprocess.run(['dpkg','--force-confold','--unpack',*[str(p) for p in pending.values()]], stdout=log, stderr=log, check=True)
            print('QQWB:离线组件已展开，正在完成配置及字体缓存…', flush=True)
            subprocess.run(['dpkg','--force-confold','--configure',*pending], stdout=log, stderr=log, check=True)
    print('QQWB:内置组件安装结束，正在复检实际环境…', flush=True)

if __name__ == '__main__':
    try: main()
    except Exception as error:
        # This helper receives no credentials and only reads build-pinned package paths.
        print('QQWB:内置组件未全部完成，继续检查联网补齐路径', flush=True)
        print('Offline package operation failed: '+type(error).__name__+((' exit='+str(error.returncode)) if isinstance(error,subprocess.CalledProcessError) else ': '+str(error)), file=sys.stderr)
        raise SystemExit(1)
