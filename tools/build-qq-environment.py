"""Bundle only SHA256-pinned Ubuntu packages, never a live rootfs or user data."""
from pathlib import Path
import gzip, hashlib, io, json, os, re, tarfile, time, urllib.request

root = Path(__file__).resolve().parents[1]
lockfile = root/'tools/qq-environment-lock.json'
lock = json.loads(lockfile.read_text(encoding='utf-8'))
notices = root/'assets/licenses'
notices.mkdir(parents=True, exist_ok=True)
(notices/'UBUNTU-PACKAGES.json').write_bytes(lockfile.read_bytes())
cache = Path(os.environ.get('QQWB_ENV_CACHE', str(root.parent/'research/android/releases/qq-environment-ubuntu24.04-arm64-20261101')))
cache.mkdir(parents=True, exist_ok=True)
asset = root/'assets/qq-environment.tar.gz'
receipt = root/'build/qq-environment-receipt.json'
digest = lambda p: hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()
locksha = digest(lockfile)
if asset.exists() and receipt.exists():
    previous = json.loads(receipt.read_text(encoding='utf-8'))
    if previous.get('lockSha256') == locksha and previous.get('sha256') == digest(asset):
        print(json.dumps(previous)); raise SystemExit(0)
assert lock['schema'] == 1 and lock['architecture'] == 'arm64'
names = set()
for item in lock['packages']:
    name = item['file']
    assert re.fullmatch(r'[A-Za-z0-9.+_:~%-]+\.deb', name) and name not in names
    assert item['architecture'] in ('arm64', 'all') and re.fullmatch(r'[a-f0-9]{64}', item['sha256'])
    upstream_name = re.sub(r'_\d+%3a', '_', name, flags=re.I)
    assert item['url'].startswith('https://ports.ubuntu.com/ubuntu-ports/pool/') and item['url'].endswith('/'+upstream_name)
    names.add(name); target = cache/name
    valid = lambda: target.is_file() and target.stat().st_size == item['bytes'] and digest(target) == item['sha256']
    if not valid():
        temporary = target.with_suffix('.partial')
        for attempt in range(3):
            try:
                with urllib.request.urlopen(item['url'], timeout=60) as response, temporary.open('wb') as out:
                    size = 0
                    while chunk := response.read(512*1024):
                        size += len(chunk)
                        if size > item['bytes']: raise ValueError('Package exceeds pinned size')
                        out.write(chunk)
                assert temporary.stat().st_size == item['bytes'] and digest(temporary) == item['sha256']
                temporary.replace(target); break
            except Exception:
                if attempt == 2: raise
                time.sleep(2)
            finally: temporary.unlink(missing_ok=True)
    assert valid(), 'Ubuntu package digest mismatch: '+name
temporary = asset.with_suffix('.partial')
with temporary.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, filename='', compresslevel=1) as gz, tarfile.open(fileobj=gz, mode='w', format=tarfile.USTAR_FORMAT) as archive:
    for item in sorted(lock['packages'], key=lambda x: x['file']):
        path = cache/item['file']; info = tarfile.TarInfo(item['file']); info.size = path.stat().st_size; info.mode = 0o600
        with path.open('rb') as stream: archive.addfile(info, stream)
    data = lockfile.read_bytes(); info = tarfile.TarInfo('UPSTREAM.json'); info.size = len(data); info.mode = 0o600
    archive.addfile(info, io.BytesIO(data))
temporary.replace(asset)
result = dict(schema=1, lockSha256=locksha, sha256=digest(asset), bytes=asset.stat().st_size, packages=len(names), userDataIncluded=False)
receipt.parent.mkdir(exist_ok=True); receipt.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result))
