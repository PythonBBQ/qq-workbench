"""Build local, traceable character references and Chinese bridge recordings.

Reference conditioning is not fine-tuning. Original source audio is never sent
to a remote service; desktop synthesis uses the authenticated loopback gateway.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import time
import urllib.request
import wave
import zipfile

ROOT=Path(__file__).resolve().parents[1]
WORKSPACE=ROOT.parents[1]
SOURCES={
    'neutral':['e5d0ceb189faaf97','c5208f13a2388c39','b05b03fdca5ff3c9','9757089964bf9677','4361cba3aec607e6','c09029aabda37eaa'],
    'happy':['44bce89fc8c0ef83','f53b1aea784118e6','365f65aff90ddc48','8dbf5327e5bb7ce8','8d4e9ebdf2804448','33fce838205bb29e'],
    'gentle':['b427a1d1d43548f0','d749944ed90e6576','a840e482416e1b4d','d758cf906940bcde','e10a84689398b4c5','9a91095b5f4b567c','08faeb9da0ed35de','d749944ed90e6576'],
    'shy':['8bf0fbbec0f73561','1a275498ba6cdaa5','d246f372ebb3c3db','1ff3d25d2afdf042','0f4427b08681a434','6fa75097feb79070','1a275498ba6cdaa5','08faeb9da0ed35de'],
    'sad':['c9b8142d080e87a7','3575243733b88097','d246f372ebb3c3db','f51471b6822c4be6','66a15d38a1cd8624','188c518f48094882'],
    'serious':['2459ccf6918d776f','718fadc3e8f92bf6','d749944ed90e6576','48c84dd04ba04d6b','3d510a516817d927','a36856a666fbac5a'],
}
TEXTS={
    'neutral':['我在这里呢，今天想聊些什么？','嗯，我听着呢，你慢慢说就好。','今天也要好好吃饭，别又忙到忘记啦。','你回来啦，今天过得怎么样？','今天比平常回来得早呢，要先休息一下吗？','那我先过去啦，我们等一下再聊吧。'],
    'happy':['太好啦，今天有好多好吃的，我好开心呀！','太好啦，今天做得很顺利，我现在特别开心。','诶，你也想尝一口吗？那就分你一点点吧。','太棒了，这下终于可以好好庆祝啦！','嘿嘿，别担心，我早就把东西准备好啦。','今天一起玩一会儿吧，难得有空呢。'],
    'gentle':['先别着急，我就在这里，慢慢听你说。','嗯，今天辛苦啦，先坐下来休息一会儿吧。','没关系的，我们一起慢慢想办法，好不好？','休息也很重要呀，不用一直勉强自己。','嗯，出门的时候记得注意安全。','嗯，闭上眼睛，慢慢放松，今天就安心休息吧。','嗯，今天的事情先放一边，慢慢呼吸就好。','别着急，我在这里陪你，安心睡个好觉吧。'],
    'shy':['嗯，你这样夸我，我有一点不好意思啦。','诶，真的有那么好吗？我还想再认真做好一点。','啊，先别一直盯着我嘛，我会有点紧张的。','真拿你没办法，那就再陪你一会儿吧。','也不是不愿意帮你，下次记得早点告诉我嘛。','嗯，我知道啦，我会认真记住的。','嗯，你说的话我听见啦，先让我想一想。','你今天已经很努力啦，先安心休息一下吧。'],
    'sad':['唉，今天有一点难过，你能陪我一会儿吗？','嗯，我知道啦，只是心里还有一点舍不得。','没关系，我想先安静一会儿，等一下再告诉你。','好像没有准备齐全，今天只能换个办法了。','唉，想到刚才那件事情，还是有点没精神。','有一点困了，让我稍微休息一下就好。'],
    'serious':['这件事需要认真对待，我们一步一步处理。','先等一下，这里还有一个细节需要确认。','嗯，我会认真听，请把刚才的情况再说清楚。','你还好吗？先别动，我们看看有没有受伤。','有些事情需要说清楚，我们先把问题解决。','这是很重要的事情，答应我，一定要认真对待。'],
}
TAGS={0:[],1:['question'],2:['comfort']}

def sha(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def save(path,data):
    temp=path.with_suffix('.next.json');temp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(path)

def prepare(args):
    import numpy as np
    import soundfile as sf
    catalogue=json.loads((args.source/'catalogue.json').read_text(encoding='utf-8'))
    items={r['id']:r for r in catalogue['recordings']}
    transcripts=json.loads((args.source/'sensevoice-transcripts.json').read_text(encoding='utf-8'))
    folder=args.runtime/'reference-profiles/character-daily';folder.mkdir(parents=True,exist_ok=True)
    profile={'schema':1,'voice':'character-daily','name':'日常角色 · 原声多情态','emotionAlpha':.65,
             'kind':'cross-language-reference-conditioning-not-training','sourceArchiveSHA256':catalogue['archiveSHA256'],
             'speaker':None,'emotions':{}}
    prepared={}
    for mood,ids in SOURCES.items():
        profile['emotions'][mood]=[]
        for ident in ids:
            row=items[ident]
            if ident not in prepared:
                x,rate=sf.read(args.source/row['wav'],dtype='float32')
                # Preserve soft onsets, breaths, and internal pauses. Only near-
                # zero outer padding is cut, with 80ms safety margin and 3ms fade.
                block=max(1,rate//100);levels=np.array([np.sqrt(np.mean(x[i:i+block]**2)) for i in range(0,len(x),block)])
                voiced=np.flatnonzero(levels>10**(-50/20))
                if len(voiced)==0:raise ValueError('Empty voice recording')
                lo=max(0,int(voiced[0]*block-.08*rate));hi=min(len(x),int((voiced[-1]+1)*block+.08*rate))
                x=x[lo:hi].copy();x-=float(np.mean(x))
                rms=float(np.sqrt(np.mean(x*x)));peak=float(np.max(np.abs(x)))
                gain=min(10**(3/20),max(10**(-6/20),10**(-23/20)/rms),.86/max(peak,.001))
                x*=gain;fade=min(int(.003*rate),len(x)//4);x[:fade]*=np.linspace(0,1,fade);x[-fade:]*=np.linspace(1,0,fade)
                target=folder/(ident+'.wav');sf.write(target,x,rate,subtype='PCM_16')
                prepared[ident]={'file':target.name,'bytes':target.stat().st_size,'sha256':sha(target),
                    'seconds':round(len(x)/rate,4),'original':row['original'],'originalSHA256':row['sourceSHA256'],
                    'transcript':transcripts[ident]['text'],'transcriptStatus':'automatic-Japanese-content-screen',
                    'cropSeconds':[round(lo/rate,4),round(hi/rate,4)],'gainDb':round(20*np.log10(gain),3)}
            profile['emotions'][mood].append(prepared[ident])
    profile['speaker']=prepared[SOURCES['neutral'][0]]
    save(folder/'manifest.json',profile)
    save(args.output/'source-selection.json',{'profile':profile,'selectedUniqueRecordings':len(prepared),
         'exclusions':'Only everyday food, greetings, concern, and game dialogue are selected. No sexual scenes, gasps, or explicit recordings.',
         'moodLabels':'shy/sad are approximate expression labels, not an ASR ground-truth or a newly trained emotion model.'})
    print(json.dumps({'profile':str(folder),'uniqueRecordings':len(prepared),'references':sum(len(v) for v in profile['emotions'].values())},ensure_ascii=False),flush=True)

def render(args):
    key=(args.runtime/'gateway-key.local.txt').read_text().strip()
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    def request(route,data=None):
        return opener.open(urllib.request.Request('http://127.0.0.1:9880'+route,
            data=json.dumps(data,ensure_ascii=False).encode() if data is not None else None,
            headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'}),timeout=20)
    record_path=args.output/'generation.json'
    records=json.loads(record_path.read_text(encoding='utf-8')) if record_path.is_file() else {}
    profile=json.loads((args.runtime/'reference-profiles/character-daily/manifest.json').read_text(encoding='utf-8'))
    for mood,phrases in TEXTS.items():
        if args.mood and mood not in args.mood:continue
        for variant,text in enumerate(phrases):
            ident=mood+'-'+str(variant);target=args.output/(ident+'.wav')
            signature={'speaker':profile['speaker']['sha256'],'emotion':profile['emotions'][mood][variant]['sha256'],'alpha':profile['emotionAlpha'],'text':text,'variant':variant}
            saved=records.get(ident,{})
            if saved.get('signature')==signature and target.is_file() and saved.get('sha256')==sha(target):continue
            start=time.monotonic()
            if saved.get('status')=='submitting':raise RuntimeError('Submission result uncertain; inspect local job before retrying')
            if saved.get('job') and saved.get('status') in ('queued','running') and saved.get('signature')==signature:
                job=saved['job']
            else:
                records[ident]={'status':'submitting','signature':signature};save(record_path,records)
                with request('/v1/speech',{'voice':'character-daily','emotion':mood,'variant':variant,'text':text}) as response:job=json.load(response)['id']
                records[ident].update(status='queued',job=job);save(record_path,records)
            deadline=time.monotonic()+660
            while True:
                with request('/v1/jobs/'+job) as response:state=json.load(response)
                if state['status'] not in ('queued','running'):break
                if time.monotonic()>deadline:raise TimeoutError('Character synthesis still running, not resubmitted')
                time.sleep(2)
            if state['status']!='success':
                records[ident].update(status='failed',error=state.get('error'));save(record_path,records);raise RuntimeError('Character synthesis failed: '+ident)
            with request('/v1/jobs/'+job+'/audio') as response:data=response.read(24*1024**2+1)
            if len(data)>24*1024**2:raise ValueError('Speech output too large')
            target.write_bytes(data)
            with wave.open(str(target)) as w:seconds=w.getnframes()/w.getframerate()
            records[ident].update(status='success',file=target.name,text=text,sha256=sha(target),seconds=round(seconds,4),elapsedSeconds=round(time.monotonic()-start,2))
            save(record_path,records)
            print(json.dumps({'sample':ident,'seconds':round(seconds,2),'elapsedSeconds':records[ident]['elapsedSeconds']},ensure_ascii=False),flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=('prepare','render'))
    p.add_argument('--source',type=Path,required=True);p.add_argument('--runtime',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--mood',nargs='*')
    args=p.parse_args()
    for name in ('source','runtime','output'):
        value=getattr(args,name).resolve();value.relative_to(WORKSPACE);setattr(args,name,value)
    args.output.mkdir(parents=True,exist_ok=True)
    if os.name=='nt':
        import ctypes
        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(),0x4000)
    (prepare if args.action=='prepare' else render)(args)

if __name__=='__main__':main()
