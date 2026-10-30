"""Build the offline, pinned parser-only runtime; no AstrBot server is installed."""
from pathlib import Path
import hashlib, io, json, tarfile, urllib.request, zipfile

root = Path(__file__).resolve().parents[1]
lock = json.loads((root / 'tools/multi-parser-lock.json').read_text(encoding='utf-8'))
provenance=json.loads((root/'parser-runtime/UPSTREAM.json').read_text(encoding='utf-8'))
for name,entry in provenance['files'].items():
    assert hashlib.sha256((root/'parser-runtime/qqwb_multi'/name).read_bytes()).hexdigest()==entry['sha256'], 'Parser source digest mismatch: '+name
license_target=root/'assets/licenses/MultiParser-MIT.txt'
license_target.parent.mkdir(parents=True,exist_ok=True)
license_target.write_bytes((root/'parser-runtime/LICENSE-upstream.txt').read_bytes())
cache = root / 'build/multi-parser-wheels'
cache.mkdir(parents=True, exist_ok=True)
members = {}
for file in sorted((root / 'parser-runtime').rglob('*')):
    if file.is_file() and '__pycache__' not in file.parts and not file.name.endswith('.pyc'):
        members[file.relative_to(root / 'parser-runtime').as_posix()] = file.read_bytes()
for wheel in lock['wheels']:
    target = cache / wheel['filename']
    if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != wheel['sha256']:
        data = urllib.request.urlopen(wheel['url'], timeout=40).read()
        assert hashlib.sha256(data).hexdigest() == wheel['sha256'], 'Dependency digest mismatch'
        target.write_bytes(data)
    with zipfile.ZipFile(target) as archive:
        for entry in archive.infolist():
            if entry.is_dir():
                continue
            assert not entry.filename.startswith('/') and '..' not in Path(entry.filename).parts
            members['deps/' + entry.filename] = archive.read(entry)
members['dependency-lock.json'] = (root / 'tools/multi-parser-lock.json').read_bytes()
target = root / 'assets/multi-parser.tar.gz'
# Deterministic tar and gzip metadata keeps packaged code verifiable.
import gzip
with target.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, filename='') as gz:
    with tarfile.open(fileobj=gz, mode='w') as archive:
        for name, data in sorted(members.items()):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o600
            archive.addfile(info, io.BytesIO(data))
digest = hashlib.sha256(target.read_bytes()).hexdigest()
(root / 'assets/multi-parser.sha256').write_text(digest + '\n', encoding='ascii')
print(json.dumps({'multiParser': lock['upstream'], 'files': len(members), 'bytes': target.stat().st_size, 'sha256': digest}))
