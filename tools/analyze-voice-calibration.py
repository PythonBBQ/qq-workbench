"""Measure teacher/tablet pauses and content; no perceptual quality claims."""
import argparse
from array import array
import json
import math
from pathlib import Path
from statistics import median
import wave


def silence_intervals(path):
    with wave.open(str(path)) as wav:
        if wav.getsampwidth() != 2 or wav.getnchannels() != 1:
            raise ValueError('Use canonical 16-bit mono evaluation files')
        rate = wav.getframerate()
        data = array('h', wav.readframes(wav.getnframes()))
    block = max(1, rate // 100)
    rms = [math.sqrt(sum(x * x for x in data[i:i+block]) / len(data[i:i+block])) / 32768
           for i in range(0, len(data), block)]
    # Absolute -44 dB threshold; report as a measurement, not a ground-truth VAD.
    threshold = 10 ** (-44 / 20)
    intervals, start = [], None
    for i, level in enumerate(rms + [1.]):
        if level < threshold:
            if start is None:
                start = i
        elif start is not None:
            if i-start >= 5:
                intervals.append((start * .01, min(i * .01, len(data) / rate)))
            start = None
    return intervals, len(data) / rate


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory', type=Path, required=True)
    args = p.parse_args()
    review = json.loads((args.directory / 'review.json').read_text(encoding='utf-8'))
    rows, teacher_pauses = [], []
    for sample in review['samples']:
        name = sample['sample']
        intervals, duration = silence_intervals(args.directory / (name + '-16k.wav'))
        times = sample['transcript'].get('timestamps', [])
        tokens = sample['transcript'].get('tokens', [])
        pauses = []
        for i, token in enumerate(tokens):
            if token not in ('，', ',', '。', '.', '？', '?', '！', '!') or i < 1 or i+1 >= len(times):
                continue
            lo, hi = times[i-1], times[i+1]
            matching = [(a, b) for a, b in intervals if a >= lo and b <= hi + .08]
            if not matching:
                continue
            start, end = max(matching, key=lambda x: x[1]-x[0])
            pauses.append({'punctuation': token, 'milliseconds': round((end-start)*1000),
                           'start': round(start, 3), 'end': round(end, 3)})
        if name.startswith('teacher-') and sample['similarity'] >= .9 and sample['tailPresent']:
            teacher_pauses.extend(pauses)
        rows.append({k: v for k, v in sample.items() if k != 'transcript'} | {
            'seconds': round(duration, 3), 'internalSilencesMs': [round((b-a)*1000) for a, b in intervals if a > .1 and b < duration-.1],
            'punctuationPauses': pauses})
    comma = [p['milliseconds'] for p in teacher_pauses if p['punctuation'] in ('，', ',')]
    sentence = [p['milliseconds'] for p in teacher_pauses if p['punctuation'] in ('。', '.', '？', '?', '！', '!')]
    report = {'kind': 'local-rhythm-calibration-not-model-training',
              'teacherCommaMedianMs': median(comma) if comma else None,
              'teacherSentenceMedianMs': median(sentence) if sentence else None,
              'teacherMatchedPauses': len(teacher_pauses),
              'referenceUnchanged': review['voiceReferenceUnchanged'],
              'limitations': 'Small calibration set; ASR and amplitude threshold are approximate. User listening is required for naturalness. No automatic weight or voice replacement.',
              'samples': rows}
    (args.directory / 'analysis.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
