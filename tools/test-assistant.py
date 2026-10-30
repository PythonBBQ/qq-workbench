"""Prepare the same offline parsers used by Android, then run isolated Node tests."""
from pathlib import Path
import argparse, os, shutil, subprocess, sys, tarfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--node', default=shutil.which('node'))
args = parser.parse_args()
if not args.node:
    parser.error('Node.js 24 is required; pass --node /path/to/node')
subprocess.run([sys.executable, str(root/'tools/build-multi-parser.py')], cwd=root, check=True)
runtime = root/'build/multi-parser-host'
runtime.mkdir(parents=True, exist_ok=True)
with tarfile.open(root/'assets/multi-parser.tar.gz') as archive:
    archive.extractall(runtime, filter='data')
env = dict(os.environ, QQWB_PARSER_RUNTIME=str(runtime), QQWB_PARSER_PYTHON=sys.executable)
result = subprocess.run([args.node, '--test', *map(str, sorted((root/'tests').glob('*.test.mjs')))], cwd=root, env=env)
sys.exit(result.returncode)
