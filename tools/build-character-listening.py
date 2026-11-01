"""Build a local listening comparison from verified reference and tablet files."""
import argparse
import html
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
MOODS={'neutral':'自然','happy':'开心','gentle':'温柔与睡前轻声','shy':'害羞与犹豫','sad':'失落','serious':'认真'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--tablet',type=Path,required=True)
    a=p.parse_args();out=a.output.resolve();out.relative_to(ROOT.parents[1]);tablet=a.tablet.resolve();tablet.relative_to(out)
    load=lambda path:json.loads(path.read_text(encoding='utf-8'))
    manifest=load(out/'preset/manifest.json');generation=load(out/'generation.json');profile=load(out/'source-selection.json')['profile'];report=load(tablet/'review.json');samples={r['sample']:r for r in report['samples']}
    def audio(path):
        if not path.is_file():return '<p class="muted">尚无此项实测</p>'
        return '<audio controls preload="none" src="'+html.escape(path.relative_to(out).as_posix(),quote=True)+'"></audio>'
    def label(text):return '<label>'+html.escape(text)+'</label>'
    delivery=out/'实际发送音频'
    def delivered(name):
        file=delivery/(name+'.mp3')
        return file if file.is_file() else tablet/(name+'.wav')
    cards=[]
    for mood,title in MOODS.items():
        for i,ref in enumerate(profile['emotions'][mood]):
            ident=mood+'-'+str(i);native=mood+'-v'+str(i)+'-4';row=samples.get(native);data=manifest['references'][mood] if i==0 else manifest['variants'][mood][i-1]
            style=' · 睡前轻声' if 'soft' in data.get('tags',[]) else ''
            body='<h2>'+title+' '+str(i+1)+style+'</h2>'+label('原录音中的语气')+audio(out/'originals'/ref['file'])
            body+=label('电脑合成的中文参考')+'<p>'+html.escape(data['text'])+'</p>'+audio(out/generation[ident]['file'])
            if row:
                body+=label('平板新句 · 4步 · '+str(round(row['elapsedMs']/1000,2))+'秒合成')+'<p>'+html.escape(row['request']['text'])+'</p>'+audio(delivered(native))
                body+=label('另一句平板实测')+audio(delivered(mood+'-v'+str(i)+'-4b'))
            if i==0:body+=label('相同新句 · 8步对照（更慢，不保证更好）')+audio(delivered(mood+'-v0-8'))
            cards.append('<article data-kind="'+mood+'">'+body+'</article>')
    for row in manifest['acknowledgments']:
        cards.append('<article data-kind="original"><h2>原声短回应 · '+html.escape(row['text'])+'</h2><p>直接保留原录音，仅独立语气词或文字中已有的开头匹配时使用。</p>'+audio(out/'preset'/row['file'])+'</article>')
    import numpy as np
    import soundfile as sf
    def montage(paths,name):
        pieces=[];index=[]
        for file,title in paths:
            if file.suffix=='.mp3':
                pcm=subprocess.run([str(ROOT.parent/'research/android/voice-runtime/bin/ffmpeg.exe'),'-nostdin','-v','error','-threads','1','-i',str(file),'-ac','1','-ar','24000','-f','f32le','pipe:1'],check=True,stdout=subprocess.PIPE).stdout
                x=np.frombuffer(pcm,dtype='<f4');rate=24000
            else:x,rate=sf.read(file,dtype='float32')
            assert rate==24000 and x.ndim==1
            pieces.append(x)
            if file.suffix!='.mp3':pieces.append(np.zeros(16800,dtype='float32'))
            index.append(title)
        wav=out/(name+'.wav');mp3=out/(name+'.mp3');sf.write(wav,np.concatenate(pieces),24000,subtype='PCM_16')
        subprocess.run([str(ROOT.parent/'research/android/voice-runtime/bin/ffmpeg.exe'),'-nostdin','-y','-v','error','-threads','1','-i',str(wav),'-c:a','libmp3lame','-b:a','128k',str(mp3)],check=True)
        return mp3,index
    choices=[('neutral-v0-4','自然'),('happy-v1-4','开心'),('shy-v0-4','害羞'),('shy-v3-4','轻微撒娇'),('shy-v6-4','犹豫'),('gentle-v5-4','轻声放松1'),('gentle-v6-4','轻声放松2'),('gentle-v7-4','睡前陪伴'),('auto-soft-shy-4','害羞轻声')]
    preview,order=montage([(delivered(name),title) for name,title in choices],'平板多情态试听')
    original,original_order=montage([(out/'preset'/r['file'],r['id']) for r in manifest['acknowledgments']],'原声语气词试听')
    (out/'listening-order.json').write_text(json.dumps({'tablet':order,'original':original_order},ensure_ascii=False,indent=2),encoding='utf-8')
    buttons='<button class="active" data-filter="all">全部</button>'+''.join('<button data-filter="'+m+'">'+t+'</button>' for m,t in {**MOODS,'original':'原声语气词'}.items())
    page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>新角色声音试听</title>
<style>body{background:#f5f2f0;color:#302d35;font:16px system-ui;max-width:1180px;margin:32px auto;padding:0 18px;line-height:1.65}h1{font-size:30px}h2{font-size:19px;margin:0 0 12px}p{margin:6px 0 14px}header,.intro{background:white;border-radius:20px;padding:24px;margin-bottom:20px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}article{background:white;border-radius:18px;padding:20px}audio{display:block;width:100%;margin:7px 0 18px}label,.muted{color:#746b7b;font-size:13px}nav{position:sticky;top:0;z-index:2;background:#f5f2f0ed;backdrop-filter:blur(8px);padding:12px 0;display:flex;gap:8px;flex-wrap:wrap}button{border:1px solid #d4cbd9;background:white;color:#53485d;border-radius:22px;padding:8px 15px;cursor:pointer}button.active{background:#655077;color:white;border-color:#655077}[hidden]{display:none}</style>'''
    page+='<header><h1>新角色 · 原声多情态</h1><p>'+str(len(profile['emotions']['gentle'])+sum(len(v) for k,v in profile['emotions'].items() if k!='gentle'))+'段中文参考，'+str(len(manifest['acknowledgments']))+'段原声短回应。先听精选，再对照原录音。</p><p>通过录音参考克隆，未重新训练权重。害羞、睡前轻声为参考近似，非专用耳语或ASMR模型；音色还原和自然度请以实际试听为准。</p></header>'
    page+='<section class="intro"><h2>平板实际合成 · 精选试听</h2><p>新句试听经过实际发送路径处理：保留完整尾音，校正音量，整条结束后追加1.5秒空白。轻声保留较低音量。此处未发送QQ消息。</p><p>'+html.escape(' → '.join(order))+'</p>'+audio(preview)+'<h2>原声语气词</h2>'+audio(original)+'<p>语气词来自日语原录音；用于独立短回应及正文已有的语气词开头，不随机加词。多语种发音仍可能略有差异。</p></section><nav>'+buttons+'</nav><main>'+''.join(cards)+'</main>'
    page+='''<script>document.querySelectorAll('button[data-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('article').forEach(x=>x.hidden=b.dataset.filter!=='all'&&b.dataset.filter!==x.dataset.kind);}));document.addEventListener('play',e=>{if(e.target.tagName==='AUDIO')document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause();});},true);</script></html>'''
    (out/'试听对比.html').write_text(page,encoding='utf-8')
    print(json.dumps({'preview':str(preview),'page':str(out/'试听对比.html'),'tabletComparisons':sum(1 for s in samples if '-v' in s),'originalResponses':len(manifest['acknowledgments'])},ensure_ascii=False))

if __name__=='__main__':main()
