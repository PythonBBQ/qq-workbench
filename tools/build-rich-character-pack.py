"""Package reviewed audio conditioning; no checkpoints or executable content."""
import argparse
import hashlib
import html
import json
from pathlib import Path
import shutil
import subprocess
import zipfile
from difflib import SequenceMatcher
from importlib.util import spec_from_file_location, module_from_spec

ROOT=Path(__file__).resolve().parents[1]
WORKSPACE=ROOT.parents[1]
_spec=spec_from_file_location('voice_review',Path(__file__).with_name('review-character-preset.py'))
_review=module_from_spec(_spec);_spec.loader.exec_module(_review)
MOODS=['neutral','happy','gentle','shy','sad','serious']
LABELS=dict(zip(MOODS,['自然','开心','温柔','害羞与犹豫','失落','认真']))
TAGS={
 'neutral':[['question'],['calm'],['calm'],['question'],['question'],['calm']],
 'happy':[['bright'],['bright'],['question'],['bright'],['playful'],['playful']],
 'gentle':[['comfort'],['comfort'],['comfort','question'],['comfort'],['calm'],['soft'],['soft'],['soft']],
 'shy':[['hesitant'],['hesitant','question'],['hesitant'],['playful'],['hesitant'],['calm'],['hesitant'],['soft']],
 'sad':[['question'],['calm'],['calm'],['calm'],['calm'],['calm']],
 'serious':[['calm'],['calm'],['calm'],['question'],['calm'],['calm']],
}
# These are verified, everyday utterances with a pause before the next word.
# No syllable is cut out of a longer word and relabelled as an interjection.
ACKS=[
 {'id':'hmm-confirm','source':'e10a84689398b4c5','start':0.,'end':.88,'text':'嗯','aliases':['嗯'],'moods':['neutral','gentle','shy'],'meaning':'轻声答应；源台词开头的うん'},
 {'id':'eh-question','source':'a7367d2183c4dcd7','start':0.,'end':.46,'text':'诶？','aliases':['诶？','欸？','诶?','欸?'],'moods':['neutral','happy','shy','serious'],'meaning':'疑问；源台词开头的え？'},
 {'id':'ah-bright','source':'17b1d22107f0970a','start':0.,'end':.3799,'text':'啊','aliases':['啊','啊！'],'moods':['happy','neutral'],'meaning':'做饭时注意到结果的短回应'},
 {'id':'ah-soft','source':'9a91095b5f4b567c','start':0.,'end':.72,'text':'啊','aliases':['啊','啊。'],'moods':['gentle','shy'],'meaning':'看到对方睡醒时的轻声回应'},
 {'id':'laugh-gentle','source':'9a91095b5f4b567c','start':1.50,'end':2.72,'text':'嘿嘿','aliases':['嘿嘿','嘻嘻'],'moods':['shy','gentle'],'meaning':'起床问候中的轻笑；不用于讽刺'},
 {'id':'laugh-happy','source':'49ef4c2060a694c6','start':0.,'end':1.3598,'text':'嘿嘿','aliases':['嘿嘿','嘿嘿嘿'],'moods':['happy'],'meaning':'做饭成功时的笑声'},
 {'id':'laugh-pleased','source':'c8362e5f6dc2ea56','start':0.,'end':1.25,'text':'嘻嘻','aliases':['嘻嘻','嘿嘿'],'moods':['happy','shy'],'meaning':'看到食材时的轻笑'},
 {'id':'ah-realize','source':'c9b8142d080e87a7','start':0.,'end':.64,'text':'啊','aliases':['啊','啊。'],'moods':['neutral','sad'],'meaning':'注意到错过动画时间的短回应'},
 {'id':'u-disappointed','source':'3575243733b88097','start':0.,'end':1.08,'text':'呜','aliases':['呜','呜呜'],'moods':['sad'],'meaning':'错过动画时懊恼的うう；不用于声称哭泣'},
]
# Two ASR passes establish particles and this one substitution in the actual
# rendered audio. Keep the original synthesis request in generation.json.
TRANSCRIPTS={
 'neutral-2':'今天也要好好吃饭，别又忙到忘记了。',
 'neutral-3':'你回来啦，今天过得怎么样？',
 'neutral-5':'那我先过去了，我们等一下再聊吧。',
 'shy-0':'嗯，你这样夸我，我有一点不好意思了。',
 'happy-0':'太好了，今天有好多好吃的，我好开心呀！',
 'happy-5':'今天一起玩一会吧，难得有空呢。',
 'gentle-1':'嗯，今天辛苦了，先坐下来休息一会吧。',
 'sad-1':'嗯，我知道啦，其实心里还有一点舍不得。',
 'shy-5':'嗯，我知道了，我会认真记住的。',
 'shy-7':'你今天已经很努力了，先安心休息一下吧。',
}
# Two held-out sentences at 4/8 steps exposed occasional word loss in these
# references. Use the individually checked settings instead of mood-wide guidance.
GUIDANCE_OVERRIDES={'gentle-6':1,'shy-2':3}

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def save(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--source',type=Path,required=True);p.add_argument('--runtime',type=Path,required=True);p.add_argument('--second-asr',type=Path,required=True);p.add_argument('--bundle',action='store_true')
    args=p.parse_args()
    for name in ('output','source','runtime','second_asr'):
        target=getattr(args,name).resolve();target.relative_to(WORKSPACE);setattr(args,name,target)
    import numpy as np
    import soundfile as sf
    out=args.output;payload=out/'preset';payload.mkdir(exist_ok=True);originals=out/'originals';originals.mkdir(exist_ok=True)
    generation=json.loads((out/'generation.json').read_text(encoding='utf-8'))
    profile=json.loads((out/'source-selection.json').read_text(encoding='utf-8'))['profile']
    review=json.loads((out/'content-review.json').read_text(encoding='utf-8'))
    checked=json.loads((args.second_asr/'catalogue.json').read_text(encoding='utf-8'))['recordings'];second=json.loads((args.second_asr/'sensevoice-transcripts.json').read_text(encoding='utf-8'))
    checks={r['sample']:second[r['id']] for r in checked}
    manifest={'schema':2,'type':'qq-workbench-voice-references','id':'character-daily','name':'日常角色 · 原声多情态',
              'engine':'IndexTTS2-original-cross-language-to-ZipVoice','references':{},'variants':{},'acknowledgments':[],
              'sourceArchiveSHA256':json.loads((args.source/'catalogue.json').read_text(encoding='utf-8'))['archiveSHA256'],
              'scope':'Multi-emotion Chinese reference recordings and original short responses; no new model weights trained.',
              'language':'zh-CN speech; original Japanese interjections retained only for matching short utterances and explicitly written openings',
              'distribution':'Local user-supplied recording preset; do not include source recordings in public code releases.'}
    audit={'kind':'reviewed-audio-reference-conditioning','references':{},'acknowledgments':[],'weightsTrained':False}
    ffmpeg=args.runtime/'bin/ffmpeg.exe'
    for mood in MOODS:
        manifest['variants'][mood]=[]
        for i in range(len(profile['emotions'][mood])):
            ident=mood+'-'+str(i);row=generation[ident];proof=review['samples'][ident]
            second_similarity=SequenceMatcher(None,_review.norm(row['text']),_review.norm(checks.get(ident,{}).get('text',''))).ratio()
            if row['status']!='success' or row['sha256']!=sha(out/row['file']) or proof['sha256']!=row['sha256'] or max(proof['similarity'],second_similarity)<.85 or proof['clippingFraction']>.001 or ident not in checks:
                raise ValueError('Reference did not pass content/acoustic review: '+ident)
            name=mood+('' if i==0 else '-'+str(i))+'.wav';target=payload/name
            subprocess.run([str(ffmpeg),'-nostdin','-y','-v','error','-i',str(out/row['file']),'-ar','24000','-ac','1','-c:a','pcm_s16le',str(target)],check=True)
            x,rate=sf.read(target,dtype='float32');seconds=len(x)/rate
            if not 1<=seconds<=10 or np.max(np.abs(x))>.999:raise ValueError('Invalid tablet reference')
            entry={'file':name,'text':TRANSCRIPTS.get(ident,row['text']),'bytes':target.stat().st_size,'sha256':sha(target),'seconds':round(seconds,4),'tags':TAGS[mood][i],'guidanceScale':GUIDANCE_OVERRIDES.get(ident,1 if mood in ('sad','serious') else 2)}
            if i==0:manifest['references'][mood]=entry
            else:manifest['variants'][mood].append(entry)
            audit['references'][ident]={'synthesisRequest':row['text'],'referenceText':entry['text'],'whisper':proof['asr'],'senseVoice':checks[ident]['text'],'senseVoiceSimilarity':round(second_similarity,4),'audioSHA256':entry['sha256'],'guidanceScale':entry['guidanceScale'],'completeContentReviewed':True}
    source_rows={r['id']:r for r in json.loads((args.source/'catalogue.json').read_text(encoding='utf-8'))['recordings']}
    for row in ACKS:
        src=source_rows[row['source']];x,rate=sf.read(args.source/src['wav'],dtype='float32');lo=int(row['start']*rate);hi=min(len(x),round(row['end']*rate));x=x[lo:hi].copy()
        if not .18<=len(x)/rate<=2.5:raise ValueError('Invalid original interjection crop')
        # Bound loudness correction to +3 dB; keep the pitch and timing intact.
        x-=np.mean(x);gain=min(10**(3/20),max(10**(-6/20),10**(-23/20)/max(float(np.sqrt(np.mean(x*x))),.0001)),.86/max(float(np.max(np.abs(x))),.0001));x*=gain
        fade=min(int(.003*rate),len(x)//4);x[:fade]*=np.linspace(0,1,fade);x[-fade:]*=np.linspace(1,0,fade)
        name='ack-'+row['id']+'.wav';file=payload/name;sf.write(file,x,rate,subtype='PCM_16')
        entry={k:row[k] for k in ('id','text','aliases','moods')};entry.update(file=name,bytes=file.stat().st_size,sha256=sha(file),seconds=round(len(x)/rate,4));manifest['acknowledgments'].append(entry)
        audit['acknowledgments'].append({**row,'original':src['original'],'originalSHA256':src['sourceSHA256'],'fileSHA256':sha(file),'gainDb':round(20*np.log10(gain),3),'pitchShift':0,'timeStretch':False})
    copied=set()
    for mood,refs in profile['emotions'].items():
        for row in refs:
            if row['file'] not in copied:shutil.copyfile(args.runtime/'reference-profiles/character-daily'/row['file'],originals/row['file']);copied.add(row['file'])
    save(payload/'manifest.json',manifest);save(out/'preset-audit.json',audit)
    count=sum(1+len(manifest['variants'][m]) for m in MOODS)
    notice=f'用户提供录音的本地角色预设。\n{count}段中文参考通过原声跨语言条件生成，{len(ACKS)}段短回应保留原录音。\n未重新训练模型权重；娇羞等为表达标签，中文自由合成的还原度仍需试听。\n睡前轻声为低强度参考近似，不是独立耳语或ASMR模型。\n仅供用户本地使用；原录音权利不因本预设而转移，不随公开源码发布。\n导入只替换所选账号的声音，原参考目录自动保留备份。\n'
    (payload/'NOTICE.txt').write_text(notice,encoding='utf-8')
    pack=out/'Character-Daily-Rich-Preset.zip'
    with zipfile.ZipFile(pack,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for file in sorted(payload.iterdir()):
            entry=zipfile.ZipInfo(file.name,date_time=(2026,11,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;z.writestr(entry,file.read_bytes())
    if pack.stat().st_size>12*1024**2:raise ValueError('Preset exceeds Android import size limit')
    if args.bundle:shutil.copyfile(pack,ROOT/'assets/character-daily-references.zip')
    save(out/'package-receipt.json',{'package':pack.name,'bytes':pack.stat().st_size,'sha256':sha(pack),'references':count,'originalAcknowledgments':len(ACKS),'weightsTrained':False,'originalFeiyuDefaultReplaced':False})
    cards=[]
    for mood in MOODS:
        refs=profile['emotions'][mood]
        for i in range(len(refs)):
            row=generation[mood+'-'+str(i)];cards.append('<article><h2>'+html.escape(LABELS[mood])+' '+str(i+1)+'</h2><p>'+html.escape(row['text'])+'</p><label>原声语气参考</label><audio controls preload="none" src="originals/'+refs[i]['file']+'"></audio><label>电脑跨语言合成</label><audio controls preload="none" src="'+row['file']+'"></audio></article>')
    for row in ACKS:cards.append('<article><h2>原声短回应 · '+html.escape(row['text'])+'</h2><p>'+html.escape(row['meaning'])+'</p><audio controls preload="none" src="preset/ack-'+row['id']+'.wav"></audio></article>')
    page='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>新角色声音对比</title><style>body{background:#f4f2ef;color:#27262b;font:16px system-ui;margin:24px auto;max-width:1100px;padding:0 16px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}article{background:white;border-radius:18px;padding:18px}h2{font-size:18px}audio{width:100%;margin:8px 0 16px}label{display:block;color:#625968;font-size:14px}</style><h1>新角色 · 原声与中文对比</h1><p>'+str(count)+'个中文参考，'+str(len(ACKS))+'个独立原声短回应。参考克隆并非重新训练；先试听，再选择是否替换某个账号的声音。轻声放松是参考近似，非专用耳语模型。</p><main>'+''.join(cards)+'</main>'
    (out/'试听对比.html').write_text(page,encoding='utf-8')
    print(json.dumps({'pack':str(pack),'bytes':pack.stat().st_size,'references':count,'originalAcknowledgments':len(ACKS),'bundled':args.bundle},ensure_ascii=False))

if __name__=='__main__':main()
