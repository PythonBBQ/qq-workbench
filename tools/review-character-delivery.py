"""Measure real MP3 delivery duration, clipping and the final playback margin."""
import argparse
import json
from pathlib import Path
import subprocess
import wave
import numpy as np

ROOT=Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    a.output=a.output.resolve();a.output.relative_to(ROOT.parents[1])
    receipt=json.loads((a.output/'delivery-receipt.json').read_text(encoding='utf-8'));ffmpeg=ROOT.parent/'research/android/voice-runtime/bin/ffmpeg.exe'
    rows=[]
    for row in receipt['samples']:
        with wave.open(row['input'],'rb') as w:seconds=w.getnframes()/w.getframerate()
        decoded=subprocess.run([str(ffmpeg),'-v','error','-nostdin','-threads','1','-i',row['output'],'-ac','1','-ar','24000','-f','f32le','pipe:1'],check=True,stdout=subprocess.PIPE)
        x=np.frombuffer(decoded.stdout,dtype='<f4');rate=24000;actual=len(x)/rate
        tail=x[-int(rate*1.4):];rms=float(np.sqrt(np.mean(tail**2)));peak=float(np.max(np.abs(x)))
        assert 1.48<=actual-seconds<=1.62,(row['sample'],seconds,actual)
        assert rms<.0001,(row['sample'],'Non-silent playback margin',rms)
        assert np.isfinite(x).all() and peak<.99,(row['sample'],'Clipping',peak)
        active=x[:int(seconds*rate)];active_rms=float(np.sqrt(np.mean(active**2)))
        rows.append({'sample':row['sample'],'soft':row['soft'],'sourceSeconds':seconds,'deliveredSeconds':actual,'addedSeconds':round(actual-seconds,4),'last1.4SecondsRMS':rms,'peak':peak,'speechRMS':active_rms})
    report={'samples':len(rows),'verifiedTailSeconds':1.4,'requestedPaddingSeconds':1.5,'allDurationsPreserved':True,'noSampleClipping':True,'qqMessagesSent':0,'measurements':rows}
    (a.output/'audio-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='measurements'},ensure_ascii=False))

if __name__=='__main__':main()
