"""Check native adaptation against the real bundled upstream ELF, without QQ."""
from pathlib import Path
import argparse, os, shutil, subprocess, tarfile, tempfile

ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--bundle',type=Path,required=True)
p.add_argument('--node',default=shutil.which('node'))
a=p.parse_args()
if not a.node:raise RuntimeError('Node.js is required for SnowLuma regression checks')
work=ROOT/'build/maintenance-host';work.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(dir=work) as scratch:
    fixture=Path(scratch)/'native.so'
    with tarfile.open(a.bundle,'r:gz') as archive:
        matches=[m for m in archive.getmembers() if m.name.removeprefix('./')=='native/snowluma-linux-arm64.so']
        if len(matches)!=1 or not matches[0].isfile() or matches[0].size>1048576:
            raise RuntimeError('Expected one bounded upstream SnowLuma ARM64 library')
        fixture.write_bytes(archive.extractfile(matches[0]).read())
    subprocess.run([a.node,'--test','tests/snowluma.test.mjs','tests/snow-native-layout.test.mjs'],
                   cwd=ROOT,env={**os.environ,'QQWB_SNOW_NATIVE_FIXTURE':str(fixture)},check=True)
print('QQWB_SNOW_NATIVE_LAYOUT_OK',flush=True)
