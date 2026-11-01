"""Prepare traceable 16 kHz inputs from completed reference or tablet jobs."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[1]
WORKSPACE=ROOT.parents[1]

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--selection',type=Path)
    a=p.parse_args()
    for field in ('source','output'):
        value=getattr(a,field).resolve();value.relative_to(WORKSPACE);setattr(a,field,value)
    a.output.mkdir(parents=True,exist_ok=True);(a.output/'asr').mkdir(exist_ok=True)
    ffmpeg=ROOT.parent/'research/android/voice-runtime/bin/ffmpeg.exe'
    if (a.source/'generation.json').is_file():
        rows=json.loads((a.source/'generation.json').read_text(encoding='utf-8'))
    else:
        report=json.loads((a.source/'review.json').read_text(encoding='utf-8'))
        rows={r['sample']:{'status':'success','text':r['request']['text'],'file':r['sample']+'.wav'} for r in report['samples'] if not r.get('originalAcknowledgment')}
    generation={};catalogue=[]
    for key,row in rows.items():
        if row.get('status')!='success':continue
        src=(a.source/row['file']).resolve();src.relative_to(WORKSPACE)
        digest=hashlib.sha256(src.read_bytes()).hexdigest();ident=hashlib.sha256(key.encode()).hexdigest()[:16]
        dest=a.output/(key+'.wav')
        if src!=dest:shutil.copyfile(src,dest)
        subprocess.run([str(ffmpeg),'-nostdin','-y','-v','error','-threads','1','-i',str(src),'-ac','1','-ar','16000',str(a.output/'asr'/(ident+'.wav'))],check=True)
        generation[key]={'status':'success','text':row['text'],'file':dest.name,'sha256':digest}
        catalogue.append({'id':ident,'sample':key,'text':row['text'],'audioSHA256':digest})
    for name,data in [('catalogue.json',{'recordings':catalogue}),('generation.json',generation)]:
        (a.output/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    if a.selection:shutil.copyfile(a.selection,a.output/'source-selection.json')
    print(json.dumps({'prepared':len(generation),'output':str(a.output)},ensure_ascii=False))

if __name__=='__main__':main()
