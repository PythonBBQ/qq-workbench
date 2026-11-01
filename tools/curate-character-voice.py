"""Prepare a bounded everyday-speech catalogue from a user-owned voice archive.

Only explicitly selected daily-scene filenames are extracted. A catalogue is
not permission to publish recordings, nor a trained model. Human review is still
required before a recording becomes a reference or a short-response sample.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import tarfile
import time
import zipfile

WORKSPACE = Path(__file__).resolve().parents[3]
ALLOW = re.compile(r'^(?:kitchen_ImoutoCooking(?:\d+|_InstantNoodles\d+|_start|_beforeResult|_failedDish|_successfulDish|_goodStuff\d+|_mashIngredient\d*|_stirVigorously)|genkan_GachaIsBadCivilization\d+|genkan_event_sis_\d+[A-Z]?|prologue_sis_\d+[A-Z]?|load_event_sis\d+|(?:save|load)_sis_SE\d*|sis_room_ImoutoWatchAnime\d+(?:_\d+)?|ImoutoRoom_eatWatermelon\d+|USAUSA\d+)\.ogg$')

def write_json(path, data):
    temp = path.with_suffix('.next.json')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)

def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def extract(args):
    import numpy as np
    import soundfile as sf
    rows = []
    for sub in ('source', 'wav', 'asr'):
        (args.output / sub).mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.archive) as archive:
        entries = archive.infolist()
        if len(entries) > 5000 or sum(i.file_size for i in entries) > 2 * 1024**3:
            raise ValueError('Archive exceeds bounded input size')
        seen = set()
        for info in entries:
            path = PurePosixPath(info.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in info.filename or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError('Unsafe archive entry')
            if not ALLOW.fullmatch(path.name):
                continue
            if path.name in seen or info.file_size > 8 * 1024**2:
                raise ValueError('Duplicate or oversized selected recording')
            seen.add(path.name)
            data = archive.read(info)
            original_hash = hashlib.sha256(data).hexdigest()
            ident = original_hash[:16]
            source = args.output / 'source' / (ident + '.ogg')
            source.write_bytes(data)
            pcm = args.output / 'wav' / (ident + '.wav')
            if not pcm.is_file():
                subprocess.run([str(args.ffmpeg), '-nostdin', '-y', '-v', 'error', '-threads', '1', '-i', str(source), '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', str(pcm)], check=True)
            samples, rate = sf.read(pcm, dtype='float32')
            seconds = len(samples) / rate
            peak = float(np.max(np.abs(samples)))
            rms = float(np.sqrt(np.mean(samples**2)))
            if not .1 <= seconds <= 90 or rms < .0001:
                continue
            asr = args.output / 'asr' / (ident + '.wav')
            if not asr.is_file():
                subprocess.run([str(args.ffmpeg), '-nostdin', '-y', '-v', 'error', '-threads', '1', '-i', str(pcm), '-ar', '16000', str(asr)], check=True)
            rows.append({'id': ident, 'original': info.filename, 'sourceSHA256': original_hash,
                         'wav': str(pcm.relative_to(args.output)), 'seconds': round(seconds, 4),
                         'peak': round(peak, 5), 'rms': round(rms, 5),
                         'clippingFraction': float(np.mean(np.abs(samples) > .999)),
                         'status': 'pending-content-review'})
    result = {'schema': 1, 'kind': 'everyday-candidate-catalogue-not-training',
              'archiveSHA256': digest(args.archive), 'archiveEntries': len(entries),
              'selection': 'Explicit everyday-scene whitelist; transcripts require review.', 'recordings': rows}
    write_json(args.output / 'catalogue.json', result)
    print(json.dumps({'selected': len(rows), 'totalSeconds': round(sum(r['seconds'] for r in rows), 1), 'output': str(args.output)}, ensure_ascii=False), flush=True)

def transcribe(args):
    import torch
    import whisper
    torch.set_num_threads(4)
    catalogue = json.loads((args.output / 'catalogue.json').read_text(encoding='utf-8'))
    recordings = catalogue['recordings']
    if args.selection:
        selection = json.loads(args.selection.read_text(encoding='utf-8'))['profile']
        ids = {Path(r['file']).stem for v in selection['emotions'].values() for r in v}
        ids.update(['e10a84689398b4c5','17b1d22107f0970a','eb095160febe56c2','a7367d2183c4dcd7','9a91095b5f4b567c','49ef4c2060a694c6','c8362e5f6dc2ea56'])
        recordings = [r for r in recordings if r['id'] in ids]
    target = args.output / 'whisper-transcripts.json'
    rows = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {}
    model = whisper.load_model(args.model, device='cuda' if torch.cuda.is_available() else 'cpu', download_root=str(args.output / 'asr-models'))
    started = time.monotonic()
    for item in recordings:
        ident = item['id']
        if ident in rows:
            continue
        import soundfile as sf
        pcm, rate = sf.read(args.output / 'asr' / (ident + '.wav'), dtype='float32')
        if rate != 16000:raise ValueError('ASR requires 16 kHz PCM')
        result = model.transcribe(pcm, language='ja',
                                  condition_on_previous_text=False, word_timestamps=True, temperature=0,
                                  fp16=torch.cuda.is_available(), verbose=None)
        rows[ident] = {'text': result['text'].strip(), 'language': result['language'],
                       'segments': result['segments'], 'sourceSHA256': item['sourceSHA256']}
        write_json(target, rows)
        print(json.dumps({'done': len(rows), 'of': len(recordings), 'id': ident,
                          'original': item['original'], 'text': rows[ident]['text'],
                          'elapsed': round(time.monotonic()-started)}, ensure_ascii=False), flush=True)

def tablet_asr(args):
    root = Path(__file__).resolve().parents[1]
    adb = root.parent / 'research/android/toolchain/platform-tools/adb.exe'
    catalogue = json.loads((args.output / 'catalogue.json').read_text(encoding='utf-8'))
    archive = args.output / 'asr-input.tar'
    with tarfile.open(archive, 'w') as tar:
        for row in catalogue['recordings']:
            tar.add(args.output / 'asr' / (row['id'] + '.wav'), arcname=row['id'] + '.wav')
    subprocess.run([str(adb), '-s', args.serial, 'push', str(archive), '/data/local/tmp/qqwb-character-asr.tar'], check=True)
    physical = '/data/user/0/cn.qqworkbench.assistant/files/linux/rootfs/opt/qq-workbench/character-daily-asr'
    command = shlex.join(['run-as', 'cn.qqworkbench.assistant', 'sh', '-c',
                         'mkdir -p ' + physical + ' && cd ' + physical + ' && tar -xf /data/local/tmp/qqwb-character-asr.tar'])
    subprocess.run([str(adb), '-s', args.serial, 'shell', command], check=True)
    binary = '/opt/qq-workbench/asr/bin/sherpa-onnx-offline'
    inputs = ['/opt/qq-workbench/character-daily-asr/' + r['id'] + '.wav' for r in catalogue['recordings']]
    base_command = ['env', 'LD_LIBRARY_PATH=/opt/qq-workbench/asr/lib', binary,
                         '--tokens=/opt/qq-workbench/asr/model/tokens.txt',
                         '--sense-voice-model=/opt/qq-workbench/asr/model/model.int8.onnx',
                         '--sense-voice-language=auto', '--sense-voice-use-itn=1', '--num-threads=2', '--debug=0']
    start = time.monotonic()
    log = args.output / 'sensevoice-output.log'
    with log.open('w', encoding='utf-8') as output:
        for offset in range(0, len(inputs), 8):
            # adb shell merges output streams. Keep native diagnostic writes out
            # of JSON; otherwise a long token array can be interleaved mid-line.
            command = shlex.join(base_command + inputs[offset:offset+8]) + ' 2>/tmp/character-asr-diagnostics.log'
            subprocess.run([str(Path(os.sys.executable)), str(root / 'device_container.py'), '--accelerated', command],
                           stdout=output, stderr=subprocess.STDOUT, check=True, timeout=150)
            output.flush()
            print(json.dumps({'asrCompleted': min(offset+8, len(inputs)), 'of': len(inputs)}, ensure_ascii=False), flush=True)
    rows = {}
    recognized = []
    for line in log.read_text(encoding='utf-8', errors='replace').splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict) and 'text' in row:
            recognized.append(row)
    if len(recognized) != len(catalogue['recordings']):
        raise RuntimeError('ASR did not return every selected recording')
    for item, row in zip(catalogue['recordings'], recognized):
        rows[item['id']] = row
    write_json(args.output / 'sensevoice-transcripts.json', rows)
    print(json.dumps({'transcripts': len(rows), 'seconds': round(time.monotonic()-start), 'log': str(log)}, ensure_ascii=False), flush=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=('extract', 'transcribe', 'tablet-asr'))
    p.add_argument('--archive', type=Path)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--ffmpeg', type=Path)
    p.add_argument('--model', default='small')
    p.add_argument('--serial', default='1987aee5')
    p.add_argument('--selection', type=Path)
    args = p.parse_args()
    args.output = args.output.resolve()
    args.output.relative_to(WORKSPACE)
    args.output.mkdir(parents=True, exist_ok=True)
    if os.name == 'nt':
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)
    os.environ.setdefault('OMP_NUM_THREADS', '4')
    os.environ.setdefault('MKL_NUM_THREADS', '4')
    {'extract': extract, 'transcribe': transcribe, 'tablet-asr': tablet_asr}[args.action](args)

if __name__ == '__main__':
    main()
