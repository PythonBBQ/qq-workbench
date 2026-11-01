"""Verify the production delivery filter on the tablet's actual FFmpeg."""
import argparse
import importlib.util
import json
from pathlib import Path
import shlex
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--delivery',type=Path,required=True);a=p.parse_args()
    for key in ['output','delivery']:
        value=getattr(a,key).resolve();value.relative_to(ROOT.parents[1]);setattr(a,key,value)
    a.output.mkdir(parents=True,exist_ok=True)
    spec=importlib.util.spec_from_file_location('worker',ROOT/'tools/android-codex-worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
    d=w.Device(ROOT.parent/'research/android/toolchain/platform-tools/adb.exe','1987aee5',18768);d.connect()
    before=d.run('exec-out','run-as',w.PACKAGE,'cat','files/settings.json')
    data=json.loads((a.delivery/'delivery-receipt.json').read_text(encoding='utf-8'));selection=[next(r for r in data['samples'] if not r['soft'] and '-v' in r['sample']),next(r for r in data['samples'] if r['soft'])]
    physical='/data/user/0/'+w.PACKAGE+'/files/linux/rootfs/tmp/qqwb-tail-delivery-check'
    d.run('shell','run-as',w.PACKAGE,'mkdir','-p',physical)
    rows=[]
    try:
        for i,row in enumerate(selection):
            stage='/data/local/tmp/qqwb-tail-delivery-'+str(i)+'.wav';d.run('push',row['input'],stage)
            d.run('shell','run-as',w.PACKAGE,'cp',stage,physical+'/'+str(i)+'.wav')
            cmd=shlex.join(['/usr/bin/ffmpeg','-v','error','-nostdin','-y','-threads','1','-i','/tmp/qqwb-tail-delivery-check/'+str(i)+'.wav','-af',row['filter'],'-ac','1','-ar','24000','-b:a','48k','/tmp/qqwb-tail-delivery-check/'+str(i)+'.mp3'])
            subprocess.run([sys.executable,str(ROOT/'device_container.py'),'--accelerated',cmd],check=True,timeout=90)
            dest=a.output/(row['sample']+'.mp3');dest.write_bytes(d.run('exec-out','run-as',w.PACKAGE,'cat',physical+'/'+str(i)+'.mp3'))
            rows.append({**row,'output':str(dest)})
    finally:
        # Remove only individually named temporary test files, never recurse.
        for i in range(2):
            for suffix in ['wav','mp3']:d.run('shell','run-as',w.PACKAGE,'rm','-f',physical+'/'+str(i)+'.'+suffix)
            d.run('shell','rm','-f','/data/local/tmp/qqwb-tail-delivery-'+str(i)+'.wav')
        d.run('shell','run-as',w.PACKAGE,'rmdir',physical)
    assert before==d.run('exec-out','run-as',w.PACKAGE,'cat','files/settings.json')
    receipt={'scope':'tablet-ffmpeg-real-delivery','liveSettingsUnchanged':True,'qqMessagesSent':0,'samples':rows}
    (a.output/'delivery-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'samples':len(rows),'liveSettingsUnchanged':True,'qqMessagesSent':0}))

if __name__=='__main__':main()
