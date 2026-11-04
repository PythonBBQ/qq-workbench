"""Render short non-explicit expression comparisons using existing on-device references.

Reads credentials only into memory. No settings writes, reference imports or QQ sends.
"""
from pathlib import Path
import argparse,base64,hashlib,json,subprocess,time,urllib.request

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--adb',type=Path,required=True);p.add_argument('--serial',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    a.output.mkdir(parents=True,exist_ok=True)
    def adb(*parts,check=True):return subprocess.run([str(a.adb),'-s',a.serial,*parts],capture_output=True,check=check,timeout=20).stdout
    package='cn.qqworkbench.assistant';token=None
    for line in adb('shell','ps','-A','-o','PID,NAME').decode().splitlines():
        cols=line.split()
        if len(cols)!=2 or cols[1]!='node':continue
        if b'/opt/qq-workbench/assistant.mjs\0' not in adb('shell','run-as',package,'cat','/proc/'+cols[0]+'/cmdline',check=False):continue
        env=adb('shell','run-as',package,'cat','/proc/'+cols[0]+'/environ',check=False)
        token=next((s[16:].decode() for s in env.split(b'\0') if s.startswith(b'WORKBENCH_TOKEN=')),None)
        if token:break
    if not token:raise RuntimeError('No authenticated assistant')
    snapshots={}
    for name in ['neutral','gentle','shy']:
        raw=adb('shell','run-as',package,'cat','files/voice-references/slot-0/'+name+'.json');snapshots[name]=hashlib.sha256(raw).hexdigest()
    port=adb('forward','tcp:0','tcp:13481').decode().strip();rows=[]
    # Same non-explicit text isolates reference/speed differences from wording.
    text='嗯，你靠近一点。我还有句话，只想说给你听。'
    samples=[('A-原轻声参考','shy',1,-5),('B-原音色害羞','shy',0,-5),('C-原音色轻柔','shy',0,-3),('D-日常音色对照','neutral',0,0)]
    try:
        for label,mood,variant,rate in samples:
            file=a.output/(label+'.wav');meta=a.output/(label+'.json')
            if file.is_file() and meta.is_file():rows.append(json.loads(meta.read_text(encoding='utf-8')));continue
            request={'provider':'zipvoice','slot':0,'text':text,'emotion':mood,'referenceVariant':variant,'modelQuality':'full','steps':16,'requestedSteps':16,'rate':rate,'pitch':0,'phrasing':True,'skipOriginalOpening':True,'skipOriginalAcknowledgment':True}
            req=urllib.request.Request('http://127.0.0.1:'+port+'/speech/synthesize',data=json.dumps(request,ensure_ascii=False).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
            start=time.monotonic();print(json.dumps({'phase':'synthesizing','sample':label},ensure_ascii=False),flush=True)
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req,timeout=145) as response:result=json.load(response)
            if not result.get('ok'):raise RuntimeError(result.get('message','Synthesis failed'))
            audio=base64.b64decode(result.pop('audio'));assert audio[:4]==b'RIFF';file.write_bytes(audio)
            row={'sample':label,'text':text,'request':request,'elapsedSeconds':round(time.monotonic()-start,2),'sha256':hashlib.sha256(audio).hexdigest(),'result':result};meta.write_text(json.dumps(row,ensure_ascii=False,indent=2),encoding='utf-8');rows.append(row)
            print(json.dumps({'phase':'completed','sample':label,'elapsedSeconds':row['elapsedSeconds']},ensure_ascii=False),flush=True)
    finally:adb('forward','--remove','tcp:'+port,check=False)
    for name,digest in snapshots.items():
        assert hashlib.sha256(adb('shell','run-as',package,'cat','files/voice-references/slot-0/'+name+'.json')).hexdigest()==digest,'Reference changed during comparison'
    (a.output/'receipt.json').write_text(json.dumps({'referencesUnchanged':True,'qqMessagesSent':0,'samples':rows},ensure_ascii=False,indent=2),encoding='utf-8')
if __name__=='__main__':main()
