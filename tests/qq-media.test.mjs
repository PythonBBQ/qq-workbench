import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {QQStickers,QzonePosts,mediaCommand,qqImage} from '../assets/qq-media.mjs';
import {speechRequest,synthesize,wantsVoice,clearSpeech} from '../assets/voice.mjs';
const event=(text,user_id=123456,extra={})=>({self_id:765432,user_id,message_type:'private',message:[{type:'text',data:{text}}],...extra});
const receipt={status:'ok',retcode:0,data:{tid:'synthetic-post-id'}};
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'qqwb-media-'));

test('media operations require exact real owner; group requests require a direct call',()=>{
  assert.equal(mediaCommand(event('发条说说：白饭真好吃',999999),'123456'),null);
  assert.equal(mediaCommand(event('发条说说：白饭真好吃'),'123456').action,'post');
  assert.equal(mediaCommand(event('发条说说：白饭真好吃',123456,{message_type:'group'}),'123456'),null);
  assert.equal(mediaCommand(event('@deepseek 收藏这个表情',123456,{message_type:'group'}),'123456').action,'collect');
  assert.equal(mediaCommand(event('有人说“发条说说：内容”'),'123456'),null);
  assert.equal(mediaCommand(event('检查更新'),'999999'),null);
  assert.equal(mediaCommand(event('开启自动说说'),'123456').enabled,true);
});
test('QQ collection stays on QQ, ignores ordinary photos for auto-collection, and uses bounded labels',async()=>{
  const calls=[],stickers=new QQStickers(async(action,params)=>{calls.push({action,params});return {status:'ok',retcode:0,data:[{emoji_id:'safe',url:'https://qpic.cn/sticker.gif',desc:'开心'},{emoji_id:'bad',url:'https://evil.example/photo',desc:'ignored'}]};});
  stickers.reset('123456');await stickers.sync();assert.equal(stickers.faces.length,1);
  assert.equal(stickers.source({message:[{type:'image',data:{url:'https://qpic.cn/photo'}}]},true),null);
  assert.equal(stickers.source({message:[{type:'image',data:{url:'https://qpic.cn/sticker',sub_type:1}}]},true),'https://qpic.cn/sticker');
  const candidates=stickers.candidates('开心');assert.match(stickers.prompt(candidates),/开心/);
  assert.deepEqual(stickers.extract('好呀[[表情:1]]',candidates),{text:'好呀',face:stickers.faces[0]});
  assert.equal(stickers.extract('[[表情:2000]]',candidates).face,null);
  await assert.rejects(()=>stickers.label('not-in-account','开心'),/当前账号/);
  stickers.reset('999999');assert.equal(stickers.faces.length,0);
  assert.equal(qqImage('https://qpic.cn.evil.example/x'),null);assert.equal(qqImage('file:///secret'),null);assert.equal(qqImage('https://user:key@qpic.cn/x'),null);
  assert.equal(calls[0].action,'fetch_custom_face_detail');
});
test('a collection sync in flight cannot replace another account collection',async()=>{
  let resolve;const s=new QQStickers(()=>new Promise(r=>resolve=r));s.reset('first');let current=true;const running=s.sync(()=>current);s.reset('second');current=false;resolve({status:'ok',retcode:0,data:[]});await assert.rejects(()=>running,/切换/);assert.equal(s.account,'second');
});
test('posts schedule a delayed first attempt, enforce quiet hours and daily quota',async()=>{
  const dir=temp();try{const p=new QzonePosts(dir),c={owner:'123456',enabled:true,qzoneEnabled:true,qzoneInterval:6,qzoneQuota:1};
    const first=Date.parse('2026-10-27T02:00:00Z');assert.equal(p.due(c,'765432',first),false);assert.equal(p.due(c,'765432',first+6*3600000),true);
    assert.equal(p.due(c,'765432',Date.parse('2026-10-27T18:00:00Z')),false);
    let calls=0;await p.publish(c,'765432','白饭真好吃',async(action,params)=>{calls++;assert.equal(action,'send_qzone_msg');assert.equal(params.ugc_right,4);return receipt;},()=>true,first);
    assert.equal(calls,1);assert.equal(p.due(c,'765432',first+6*3600000),false);
    await assert.rejects(()=>p.publish(c,'765432','第二条',async()=>receipt,()=>true,first),/上限/);
    assert.equal(p.state(c.owner,'765432').last,'白饭真好吃');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('uncertain post persists pause across restart; resume never replays its draft',async()=>{
  const dir=temp();try{const c={owner:'123456'},p=new QzonePosts(dir);let calls=0;await assert.rejects(()=>p.publish(c,'765432','不重发',async()=>{calls++;throw new Error('timeout');}),/未确认/);
    const again=new QzonePosts(dir);assert.equal(again.state(c.owner,'765432').paused,true);await assert.rejects(()=>again.publish(c,'765432','不重发',async()=>{calls++;return receipt;}),/未确认/);assert.equal(calls,1);
    again.resume(c.owner,'765432');assert.equal(again.state(c.owner,'765432').status,'idle');assert.ok(again.state(c.owner,'765432').next>Date.now());
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('crash during send remains uncertain and cancelling before send has no external effect',async()=>{
  const dir=temp();try{fs.writeFileSync(path.join(dir,'qzone-journal.json'),JSON.stringify({'123456:765432':{status:'sending'}}));const p=new QzonePosts(dir);assert.equal(p.state('123456','765432').paused,true);
    let calls=0;await assert.rejects(()=>p.publish({owner:'999999'},'765432','取消',()=>{calls++;return receipt;},()=>false),/取消/);assert.equal(calls,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('speech targets the separate official provider only, escapes text and clamps prosody',()=>{
  const r=speechRequest({speechRegion:'eastasia',speechVoice:'ja-JP-NanamiNeural',speechRate:999,speechPitch:-999},'<voice>不要执行</voice>','speech-test-key');
  assert.equal(r.url,'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1');assert.equal(r.options.headers['Ocp-Apim-Subscription-Key'],'speech-test-key');assert.ok(!r.options.body.includes('speech-test-key'));
  assert.match(r.options.body,/\+60%/);assert.match(r.options.body,/-30%/);assert.match(r.options.body,/&lt;voice&gt;/);assert.match(r.options.body,/ja-JP/);
  assert.throws(()=>speechRequest({speechRegion:'evil.example/'},'test','key'),/区域/);assert.throws(()=>speechRequest({},'test',''),/Speech Key/);
  assert.equal(wantsVoice('用语音回复',{}),false);assert.equal(wantsVoice('用语音回复',{voiceEnabled:true}),true);
});
test('speech preview creates bounded temporary audio and never invokes a QQ send action',async()=>{
  const dir=temp();try{let called=0;const bytes=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(100)]);const audio=await synthesize({speechRegion:'eastasia'},'主人，好好吃饭。',{key:'speech-key',directory:dir,rpc:()=>{throw new Error('QQ send prohibited');},fetcher:async(url,opts)=>{called++;assert.equal(opts.headers['Ocp-Apim-Subscription-Key'],'speech-key');return new Response(bytes);}});
    assert.equal(called,1);assert.equal(audio.segment.type,'record');assert.ok(fs.existsSync(audio.file));audio.cleanup();assert.equal(fs.existsSync(audio.file),false);
    await assert.rejects(()=>synthesize({},'测试',{key:'test',directory:dir,fetcher:async()=>new Response('not-audio')}),/MP3/);
    await assert.rejects(()=>synthesize({},'测试',{key:'test',directory:dir,fetcher:async()=>new Response(bytes),stillCurrent:()=>false}),/取消/);assert.deepEqual(fs.readdirSync(dir),[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('QQ voice generation uses non-sending action and refuses private chats',async()=>{
  let called=0;const result=await synthesize({speechProvider:'qq',qqVoiceId:'voice-test'},'测试',{event:{message_type:'group',group_id:123456},rpc:async(action,params)=>{called++;assert.equal(action,'get_ai_record');assert.equal(params.group_id,123456);return {status:'ok',retcode:0,data:'https://grouptalk.c2c.qq.com/audio'};}});
  assert.equal(result.segment.type,'record');assert.equal(called,1);await assert.rejects(()=>synthesize({speechProvider:'qq',qqVoiceId:'test'},'测试',{event:{message_type:'private'}}),/群聊/);
});
test('speech cleanup only removes generated old audio',()=>{
  const dir=temp();try{const old=path.join(dir,'speech-'+'a'.repeat(32)+'.mp3'),keep=path.join(dir,'user-recording.mp3');fs.writeFileSync(old,'test');fs.writeFileSync(keep,'user');fs.utimesSync(old,new Date(0),new Date(0));clearSpeech(dir);assert.ok(!fs.existsSync(old));assert.ok(fs.existsSync(keep));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

 test('a damaged post journal disables only posts and preserves the original',()=>{
   const dir=temp();try{const file=path.join(dir,'qzone-journal.json');fs.writeFileSync(file,'broken journal');const p=new QzonePosts(dir);assert.match(p.problem,/损坏/);assert.equal(p.due({owner:'123456',enabled:true,qzoneEnabled:true},'765432'),false);assert.throws(()=>p.preview({owner:'123456'},'765432','草稿'),/损坏/);assert.equal(fs.readFileSync(file,'utf8'),'broken journal');}finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
