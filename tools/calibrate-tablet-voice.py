"""Compare desktop teacher speech with offline tablet generation; never sends QQ.

No training or automatic voice replacement. Keeps the current reference profile,
saves an A/B corpus and checks transcripts before recommending segmentation.
"""
import argparse
import base64
from difflib import SequenceMatcher
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import time
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parents[1]
SAMPLES = {
    'short': '主人，今天的天气不错，我们出门走走吧。',
    'sentence': '你刚刚已经说得很清楚了，我会认真听，也会记住你想要的表达方式。',
    'paragraph': '先别着急，我们把最重要的一件事做好。剩下的可以慢慢来，不用一下子把所有事情都扛在自己身上。',
    'long': '今天先把最重要的事情做好，剩下的可以慢慢来，不用一下子把所有事情都扛在自己身上。你刚刚已经说得很清楚了，我会认真听，也会记住你想要的表达方式。',
}


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def norm(text):
    return ''.join(c.lower() for c in text if c.isalnum())


def dump(path, value):
    temp = path.with_suffix('.next.json')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temp.replace(path)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--serial', required=True)
    p.add_argument('--teacher', choices=('feiyu-index', 'feiyu-index-rvc'), default='feiyu-index-rvc')
    p.add_argument('--skip-teacher', action='store_true')
    args = p.parse_args()
    out, runtime = args.output.resolve(), args.runtime.resolve()
    if not out.is_relative_to(WORKSPACE) or not runtime.is_relative_to(WORKSPACE):
        raise ValueError('Keep calibration and models in the workspace')
    out.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location('android_worker', ROOT / 'tools/android-codex-worker.py')
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    d = worker.Device(ROOT.parent / 'research/android/toolchain/platform-tools/adb.exe', args.serial, 18768)
    d.connect()
    d.run('forward', 'tcp:18769', 'tcp:13481')
    app_config = json.loads(d.run('exec-out', 'run-as', worker.PACKAGE, 'cat', 'files/settings.json'))
    voice_record = d.run('exec-out', 'run-as', worker.PACKAGE, 'cat', 'files/voice-references/slot-0/pack.json')
    voice_hash = hashlib.sha256(voice_record).hexdigest()
    if json.loads(voice_record).get('engine') != 'feiyu-index-rvc':
        raise ValueError('The user-selected first voice pack must remain installed')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    key = (runtime / 'gateway-key.local.txt').read_text().strip()
    state_file = out / 'generation.json'
    records = json.loads(state_file.read_text(encoding='utf-8')) if state_file.exists() else {}

    def request(url, payload, token, timeout=15):
        req = urllib.request.Request(url, data=json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None,
                                     headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
        return opener.open(req, timeout=timeout)

    for name, text in SAMPLES.items():
        if args.skip_teacher:
            break
        sample = 'teacher-' + name
        target = out / (sample + '.wav')
        saved = records.get(sample, {})
        if saved.get('sha256') and target.is_file() and sha(target) == saved['sha256']:
            continue
        if saved.get('status') == 'submitting':
            raise RuntimeError('Previous submission result unknown; inspect local gateway before resubmitting')
        start = time.monotonic()
        if saved.get('job'):
            job = saved['job']
        else:
            records[sample] = {'status': 'submitting', 'text': text, 'engine': args.teacher}
            dump(state_file, records)
            with request('http://127.0.0.1:9880/v1/speech', {'text': text, 'voice': args.teacher,
                          'style': 'gentle', 'emotion': 'gentle'}, key) as response:
                job = json.load(response)['id']
            records[sample].update(status='submitted', job=job)
            dump(state_file, records)
        deadline = time.monotonic() + 660
        while True:
            with request('http://127.0.0.1:9880/v1/jobs/' + job, None, key) as response:
                status = json.load(response)
            if status['status'] not in ('running', 'queued'):
                break
            if time.monotonic() > deadline:
                raise TimeoutError('Teacher still running; saved job ID, no resubmission')
            time.sleep(2)
        if status['status'] != 'success':
            raise RuntimeError('Teacher failed: ' + name)
        with request('http://127.0.0.1:9880/v1/jobs/' + job + '/audio', None, key) as response:
            data = response.read(24 * 1024**2 + 1)
        if len(data) > 24 * 1024**2:
            raise ValueError('Teacher audio exceeds size limit')
        target.write_bytes(data)
        records[sample].update(status='success', file=target.name, sha256=sha(target),
                               elapsedSeconds=round(time.monotonic() - start, 2))
        dump(state_file, records)
        print(json.dumps({'sample': sample, **records[sample]}, ensure_ascii=False), flush=True)

    for name, text in SAMPLES.items():
        for variant, steps, phrasing in [('baseline', 4, True), ('whole', 4, False), ('eight', 8, True)]:
            sample = name + '-' + variant
            target = out / (sample + '.wav')
            payload = {'provider': 'zipvoice', 'slot': 0, 'text': text, 'emotion': 'gentle',
                       'steps': steps, 'requestedSteps': steps, 'rate': app_config.get('speechRate', 0), 'phrasing': phrasing}
            saved = records.get(sample, {})
            if (target.is_file() and saved.get('request') == payload and saved.get('referenceSHA256') == voice_hash
                    and saved.get('sha256') == sha(target)):
                continue
            start = time.monotonic()
            with request('http://127.0.0.1:18769/speech/synthesize', payload, d.token, 145) as response:
                result = json.load(response)
            if not result.get('ok'):
                raise RuntimeError('Tablet synthesis failed: ' + str(result.get('message', 'unknown')))
            target.write_bytes(base64.b64decode(result.pop('audio')))
            with wave.open(str(target)) as wav:
                seconds = wav.getnframes() / wav.getframerate()
            records[sample] = {**result, 'text': text, 'file': target.name, 'request': payload,
                               'referenceSHA256': voice_hash, 'sha256': sha(target), 'seconds': round(seconds, 3),
                               'elapsedSeconds': round(time.monotonic() - start, 3)}
            dump(state_file, records)
            print(json.dumps({'sample': sample, 'elapsedSeconds': records[sample]['elapsedSeconds'],
                              'segments': result.get('segments'), 'seconds': seconds}, ensure_ascii=False), flush=True)

    linux = '/opt/qq-workbench/teacher-voice-calibration'
    remote = '/data/user/0/' + worker.PACKAGE + '/files/linux/rootfs' + linux
    d.run('shell', shlex.join(['run-as', worker.PACKAGE, 'mkdir', '-p', remote]))
    samples = []
    ffmpeg = runtime / 'bin/ffmpeg.exe'
    for name, row in records.items():
        if row.get('status') == 'submitting' or not row.get('file'):
            continue
        src = out / row['file']
        target = out / (name + '-16k.wav')
        subprocess.run([str(ffmpeg), '-nostdin', '-y', '-v', 'error', '-i', str(src),
                        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', str(target)], check=True)
        d.run('push', str(target), '/data/local/tmp/qqwb-calibrate-' + name + '.wav')
        d.run('shell', shlex.join(['run-as', worker.PACKAGE, 'cp', '/data/local/tmp/qqwb-calibrate-' + name + '.wav', remote + '/' + name + '.wav']))
        samples.append(name)
    cmd = 'env LD_LIBRARY_PATH=/opt/qq-workbench/asr/lib /opt/qq-workbench/asr/bin/sherpa-onnx-offline --tokens=/opt/qq-workbench/asr/model/tokens.txt --sense-voice-model=/opt/qq-workbench/asr/model/model.int8.onnx --sense-voice-language=auto --sense-voice-use-itn=1 --num-threads=2 --debug=0 ' + ' '.join(linux + '/' + name + '.wav' for name in samples)
    result = subprocess.run([sys.executable, '-X', 'utf8', str(ROOT / 'device_container.py'), '--accelerated', cmd],
                            cwd=ROOT, capture_output=True, text=True, encoding='utf-8', timeout=240)
    (out / 'asr.log').write_text(result.stdout + '\n' + result.stderr, encoding='utf-8')
    result.check_returncode()
    recognized = []
    for line in result.stdout.splitlines():
        try:
            row = json.loads(line)
            if isinstance(row, dict) and 'text' in row:
                recognized.append(row)
        except ValueError:
            pass
    if len(samples) != len(recognized):
        raise RuntimeError('ASR did not return all calibration samples')
    review = []
    for name, transcript in zip(samples, recognized):
        row = records[name]
        expected, actual = norm(row['text']), norm(transcript['text'])
        review.append({'sample': name, 'text': row['text'], 'asr': transcript['text'],
                       'similarity': round(SequenceMatcher(None, expected, actual).ratio(), 4),
                       'tailPresent': expected[-4:] in actual, 'elapsedSeconds': row.get('elapsedSeconds'),
                       'durationMs': row.get('durationMs'), 'segments': row.get('segments'), 'transcript': transcript})
    unchanged = voice_record == d.run('exec-out', 'run-as', worker.PACKAGE, 'cat', 'files/voice-references/slot-0/pack.json')
    report = {'scope': 'Teacher-guided calibration, not training or model distillation; ASR is a content check, not a naturalness rating',
              'voiceReferenceUnchanged': unchanged, 'paidModelCalls': 0, 'qqMessagesSent': 0,
              'samples': review, 'qqConnectedAfter': d.api('/state')['connected']}
    dump(out / 'review.json', report)
    if not unchanged:
        raise RuntimeError('Reference profile changed during calibration')
    print(json.dumps({'completed': len(review), 'referenceUnchanged': unchanged,
                      'contentFailures': [r['sample'] for r in review if not r['tailPresent'] or r['similarity'] < .9]}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
