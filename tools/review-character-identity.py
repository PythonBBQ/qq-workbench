"""Local speaker-embedding diagnostics; never a human likeness/quality score."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
WORKSPACE=ROOT.parents[1]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--tablet',type=Path,required=True);p.add_argument('--name',default='speaker-diagnostics')
    a=p.parse_args();out=a.output.resolve();out.relative_to(WORKSPACE);tablet=a.tablet.resolve();tablet.relative_to(out)
    if not a.name.replace('-','').isalnum() or len(a.name)>64:raise ValueError('Invalid diagnostic report name')
    runtime=ROOT.parent/'research/android/voice-runtime';studio=ROOT.parent/'research/android/indextts2-studio-snapshot'
    os.environ.update(OMP_NUM_THREADS='4',MKL_NUM_THREADS='4',TEMP=str(WORKSPACE/'tmp'),TMP=str(WORKSPACE/'tmp'))
    if os.name=='nt':
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(),0x4000)
    sys.path.insert(0,str(studio))
    import librosa
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio
    from indextts.s2mel.modules.campplus.DTDNN import CAMPPlus
    torch.set_num_threads(4)
    model=CAMPPlus(feat_dim=80,embedding_size=192)
    weights=runtime/'models/IndexTTS-2/hf_cache/campplus_cn_common.bin'
    model.load_state_dict(torch.load(weights,map_location='cpu',weights_only=True));model.eval()
    cache={}
    def embedding(file):
        digest=hashlib.sha256(file.read_bytes()).hexdigest()
        if digest in cache:return cache[digest],digest
        x,rate=sf.read(file,dtype='float32');x=np.mean(x,axis=1) if x.ndim==2 else x
        pcm=librosa.resample(x,orig_sr=rate,target_sr=16000)
        feat=torchaudio.compliance.kaldi.fbank(torch.tensor(pcm).unsqueeze(0),num_mel_bins=80,dither=0,sample_frequency=16000)
        feat-=feat.mean(dim=0,keepdim=True)
        with torch.inference_mode():v=model(feat.unsqueeze(0)).squeeze(0)
        v=torch.nn.functional.normalize(v,dim=0);cache[digest]=v
        return v,digest
    profile=json.loads((out/'source-selection.json').read_text(encoding='utf-8'))['profile'];references={row['file'] for refs in profile['emotions'].values() for row in refs}
    original=[]
    for name in sorted(references):
        v,digest=embedding(out/'originals'/name);original.append((name,v,digest))
    centroid=torch.nn.functional.normalize(torch.stack([v for _,v,_ in original]).mean(dim=0),dim=0)
    source_scores=[{'file':name,'sha256':digest,'centroidCosine':round(float(v@centroid),4)} for name,v,digest in original]
    samples={}
    generation=json.loads((out/'generation.json').read_text(encoding='utf-8'))
    for key,row in generation.items():
        v,digest=embedding(out/row['file']);samples['reference/'+key]={'sha256':digest,'originalCentroidCosine':round(float(v@centroid),4)}
    report=json.loads((tablet/'review.json').read_text(encoding='utf-8'))
    for row in report['samples']:
        if row.get('originalAcknowledgment'):continue
        v,digest=embedding(tablet/(row['sample']+'.wav'));samples['tablet/'+row['sample']]={'sha256':digest,'originalCentroidCosine':round(float(v@centroid),4)}
    result={'kind':'speaker-embedding-diagnostics-not-listening-quality','model':'existing local CAMPPlus-192','modelSHA256':hashlib.sha256(weights.read_bytes()).hexdigest(),'uniqueOriginals':len(original),'sourceScores':source_scores,'samples':samples,'limitations':'Cosine is model-dependent and affected by language, emotion, recording and short duration. Not a likeness percentage, MOS, trained voice improvement or replacement for listening.'}
    (out/(a.name+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'originals':len(original),'samples':len(samples),'originalMedian':round(float(np.median([r['centroidCosine'] for r in source_scores])),4),'referenceMedian':round(float(np.median([r['originalCentroidCosine'] for k,r in samples.items() if k.startswith('reference/')])),4),'tabletMedian':round(float(np.median([r['originalCentroidCosine'] for k,r in samples.items() if k.startswith('tablet/')])),4)},ensure_ascii=False))

if __name__=='__main__':main()
