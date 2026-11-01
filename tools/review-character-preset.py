"""Offline transcript and acoustic checks; not a perceptual quality score."""
import argparse
from difflib import SequenceMatcher
import hashlib
import json
import os
from pathlib import Path
import re

def norm(s):
    # Chinese ASR may return traditional forms. Convert script only, never
    # replace mistaken words with the expected transcript.
    if os.name=='nt':
        import ctypes
        buffer=ctypes.create_unicode_buffer(len(s)*2+16)
        if ctypes.windll.kernel32.LCMapStringEx('zh-CN',0x02000000,s,len(s),buffer,len(buffer),None,None,0):s=buffer.value
    return ''.join(c.lower() for c in s if c.isalnum())

def tail_content(s):return re.sub('[呀啊啦了呢吧嘛呐哇哟儿]+$','',s)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--source',type=Path,required=True);p.add_argument('--model',type=Path,required=True)
    args=p.parse_args();root=Path(__file__).resolve().parents[3]
    out=args.output.resolve();out.relative_to(root)
    os.environ.update(OMP_NUM_THREADS='4',MKL_NUM_THREADS='4')
    if os.name=='nt':
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(),0x4000)
    import numpy as np
    import soundfile as sf
    import librosa
    import pyworld
    import torch
    import whisper
    torch.set_num_threads(4)
    model=whisper.load_model(str(args.model),device='cuda' if torch.cuda.is_available() else 'cpu')
    generation=json.loads((out/'generation.json').read_text(encoding='utf-8'))
    target=out/'content-review.json';saved=json.loads(target.read_text(encoding='utf-8')) if target.exists() else {'kind':'transcription-and-acoustics-not-perceptual-quality','samples':{}}
    for ident,row in generation.items():
        if row.get('status')!='success':continue
        file=out/row['file'];digest=hashlib.sha256(file.read_bytes()).hexdigest()
        if saved['samples'].get(ident,{}).get('sha256')==digest:
            entry=saved['samples'][ident];expected,actual=norm(row['text']),norm(entry['asr']);entry.update(similarity=round(SequenceMatcher(None,expected,actual).ratio(),4),tailPresent=expected[-4:] in actual,tailContentPresent=tail_content(expected)[-4:] in tail_content(actual));continue
        x,rate=sf.read(file,dtype='float32');mono=np.mean(x,axis=1) if x.ndim==2 else x
        pcm=librosa.resample(mono,orig_sr=rate,target_sr=16000)
        result=model.transcribe(pcm,language='zh',condition_on_previous_text=False,temperature=0,fp16=torch.cuda.is_available(),verbose=None)
        expected,actual=norm(row['text']),norm(result['text'])
        pitch,times=pyworld.dio(mono.astype('float64'),rate,f0_floor=100,f0_ceil=700,frame_period=10)
        pitch=pyworld.stonemask(mono.astype('float64'),pitch,times,rate);voiced=pitch[pitch>0]
        levels=np.array([np.sqrt(np.mean(mono[i:i+max(1,rate//100)]**2)) for i in range(0,len(mono),max(1,rate//100))])
        active=np.flatnonzero(levels>.003)
        entry={'text':row['text'],'asr':result['text'].strip(),'similarity':round(SequenceMatcher(None,expected,actual).ratio(),4),'tailPresent':expected[-4:] in actual,'tailContentPresent':tail_content(expected)[-4:] in tail_content(actual),
               'sha256':digest,'seconds':round(len(mono)/rate,4),'rmsDb':round(20*np.log10(max(float(np.sqrt(np.mean(mono**2))),1e-9)),2),
               'peak':round(float(np.max(np.abs(mono))),5),'clippingFraction':float(np.mean(np.abs(mono)>.999)),
               'pitchMedianHz':round(float(np.median(voiced)),1) if len(voiced) else None,
               'pitchIqrHz':round(float(np.percentile(voiced,75)-np.percentile(voiced,25)),1) if len(voiced) else None,
               'headQuietMs':int(active[0]*10) if len(active) else None,'tailQuietMs':int((len(levels)-1-active[-1])*10) if len(active) else None}
        saved['samples'][ident]=entry;target.write_text(json.dumps(saved,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'sample':ident,**entry},ensure_ascii=False),flush=True)
    sources={};selection=json.loads((out/'source-selection.json').read_text(encoding='utf-8'))['profile']
    for mood,refs in selection['emotions'].items():
        for ref in refs:
            ident=ref['originalSHA256'][:16]
            if ident in sources:continue
            mono,rate=sf.read(args.source/'wav'/(ident+'.wav'),dtype='float64')
            pitch,times=pyworld.dio(mono,rate,f0_floor=100,f0_ceil=700,frame_period=10);pitch=pyworld.stonemask(mono,pitch,times,rate);voiced=pitch[pitch>0]
            sources[ident]={'original':ref['original'],'pitchMedianHz':round(float(np.median(voiced)),1) if len(voiced) else None,'pitchIqrHz':round(float(np.percentile(voiced,75)-np.percentile(voiced,25)),1) if len(voiced) else None}
    saved['sourceAcoustics']=sources
    saved['limitations']='ASR can confuse particles; pitch cannot establish identity or naturalness. Original listening and generated examples are provided for user comparison. No model weights trained.'
    target.write_text(json.dumps(saved,ensure_ascii=False,indent=2),encoding='utf-8')

if __name__=='__main__':main()
