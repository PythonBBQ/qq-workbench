"""Use a tablet's unchanged voice to compare only old/new pause stitching."""
import argparse
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT=Path(__file__).resolve().parents[1]


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--serial',required=True)
    p.add_argument('--java-bin',type=Path,required=True)
    args=p.parse_args()
    out=args.output.resolve()
    if not out.is_relative_to(ROOT.parents[1]):raise ValueError('Keep A/B output in workspace')
    out.mkdir(parents=True,exist_ok=True)
    classes=ROOT/'build/speech-rhythm-check'
    classes.mkdir(parents=True,exist_ok=True)
    java=args.java_bin/'java.exe';javac=args.java_bin/'javac.exe'
    subprocess.run([str(javac),'-encoding','UTF-8','-d',str(classes),str(ROOT/'src/cn/qqworkbench/assistant/SpeechPhrasing.java'),str(ROOT/'tests/SpeechRhythmRender.java')],check=True)
    text='今天先把最重要的事情做好，剩下的可以慢慢来，不用一下子把所有事情都扛在自己身上。你刚刚已经说得很清楚了，我会认真听，也会记住你想要的表达方式。'
    raw_plan=subprocess.check_output([str(java),'-Dfile.encoding=UTF-8','-Dsun.stdout.encoding=UTF-8','-cp',str(classes),'cn.qqworkbench.assistant.SpeechRhythmRender','plan',text])
    try:plan=raw_plan.decode('utf-8').splitlines()
    except UnicodeDecodeError:plan=raw_plan.decode('gbk').splitlines()
    if ''.join(plan)!=text:raise ValueError('Phrase planning changed text')
    (out/'phrases.txt').write_text('\n'.join(plan),encoding='utf-8')
    spec=importlib.util.spec_from_file_location('worker',ROOT/'tools/android-codex-worker.py');worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
    d=worker.Device(ROOT.parent/'research/android/toolchain/platform-tools/adb.exe',args.serial,18768);d.connect();d.run('forward','tcp:18769','tcp:13481')
    before=d.run('exec-out','run-as',worker.PACKAGE,'cat','files/voice-references/slot-0/pack.json')
    if json.loads(before).get('engine')!='feiyu-index-rvc':raise ValueError('First voice must remain installed')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    records=[]
    for i,phrase in enumerate(plan):
        request={'provider':'zipvoice','slot':0,'text':phrase,'emotion':'gentle','steps':4,'requestedSteps':4,'rate':-30,'phrasing':False}
        target=out/('chunk-'+str(i)+'.wav');record=target.with_suffix('.json')
        if target.is_file() and record.is_file() and json.loads(record.read_text(encoding='utf-8')).get('request')==request:
            result=json.loads(record.read_text(encoding='utf-8'))
        else:
            req=urllib.request.Request('http://127.0.0.1:18769/speech/synthesize',data=json.dumps(request).encode(),headers={'Authorization':'Bearer '+d.token,'Content-Type':'application/json'})
            with opener.open(req,timeout=145) as response:result=json.load(response)
            if not result.get('ok'):raise RuntimeError('Native voice generation failed')
            target.write_bytes(base64.b64decode(result.pop('audio')))
            result['request']=request;record.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        records.append(result)
    rendered=subprocess.check_output([str(java),'-cp',str(classes),'cn.qqworkbench.assistant.SpeechRhythmRender',str(out)],text=True,encoding='utf-8')
    report=json.loads(rendered);report.update(referenceUnchanged=before==d.run('exec-out','run-as',worker.PACKAGE,'cat','files/voice-references/slot-0/pack.json'),
        paidModelCalls=0,qqMessagesSent=0,phrases=plan)
    if not report['referenceUnchanged']:raise RuntimeError('Reference changed during A/B')
    (out/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':main()
