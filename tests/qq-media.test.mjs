import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {QQStickers,RecentOwnerStickers,collectionRequest,QzonePosts,mediaCommand,qqImage} from '../assets/qq-media.mjs';
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


test('natural collection requests are explicit actions, not quotes, negation or discussions',()=>{
  for(const text of ['收藏这个','收藏一下','存一下这个表情','这个表情帮我收藏一下','把刚才的表情收藏起来','收下这张','这个你存着以后用','帮我存一下这个表情','能不能收藏这个表情？','@deepseek 请把这个表情收藏一下吧'])assert.equal(collectionRequest(text),true,text);
  for(const text of ['不要收藏这个','这个不用收藏','怎么收藏这个表情','有人说收藏一下','他说收藏这个','我喜欢收藏表情','收藏这个是什么功能','“收藏这个”','发条说说：收藏这个','转发给别人收藏','不允许收藏'])assert.equal(collectionRequest(text),false,text);
  assert.equal(mediaCommand(event('收藏这个',999999),'123456'),null);
  assert.equal(mediaCommand(event('收藏这个',123456,{message_type:'group'}),'123456').action,'collect');
  assert.equal(mediaCommand(event('开启自动收藏表情'),'123456').action,'collectionHelp');
});

test('recent owner images expire and cannot cross chats, owners or accounts; replies select only owned images',()=>{
  const cache=new RecentOwnerStickers(),owner='123456';
  const img=(id,url='first')=>({...event('',123456),post_type:'message',message_id:id,message:[{type:'image',data:{url:'https://qpic.cn/'+url}}]});
  const ask={...img(2),message:[]};
  cache.remember(img(1),owner,1000);
  cache.remember({...img(3,'other'),user_id:999999},owner,1001);
  assert.equal(cache.select(ask,owner,1002).message[0].data.url,'https://qpic.cn/first');
  assert.throws(()=>cache.select({...ask,user_id:999999},owner,1002),/只有主人/);
  assert.throws(()=>cache.select({...ask,message_type:'group',group_id:42},owner,1002),/先在当前聊天/);
  cache.remember(img(4,'second'),owner,1003);
  assert.equal(cache.select({...ask,message:[{type:'reply',data:{id:1}}]},owner,1004).message[0].data.url,'https://qpic.cn/first');
  assert.throws(()=>cache.select({...ask,message:[{type:'reply',data:{id:3}}]},owner,1004),/先在当前聊天/);
  assert.throws(()=>cache.select(ask,owner,301003),/先在当前聊天/);
  cache.remember(img(5),owner,302000);
  assert.throws(()=>cache.select({...ask,self_id:888888},owner,302001),/先在当前聊天/);
  assert.throws(()=>cache.select(ask,owner,302002),/先在当前聊天/);
  cache.remember(img(6),owner,302003);cache.clear();
  assert.throws(()=>cache.select(ask,owner,302004),/先在当前聊天/);
  const multi=img(7);multi.message.push({type:'image',data:{url:'https://qpic.cn/another'}});
  assert.throws(()=>cache.select(multi,owner,302005),/多张/);
  assert.throws(()=>cache.select({...ask,message:[{type:'image',data:{url:'file:///secret'}}]},owner,302005),/不可读取/);
});

test('collection downloads only the selected QQ image and deduplicates; cancellation never mutates QQ',async()=>{
  const fetcher=globalThis.fetch,calls=[];globalThis.fetch=async()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});
  try{
    const stickers=new QQStickers(async(action,params)=>{calls.push({action,params});return {status:'ok',retcode:0,data:{emoji_id:'synthetic'}};});stickers.reset('765432');
    const img={message:[{type:'image',data:{url:'https://qpic.cn/selected'}}]};
    assert.match(await stickers.collect(img),/已保存/);assert.equal(calls.length,1);assert.equal(calls[0].action,'add_custom_face');assert.equal(calls[0].params.file,'base64://AQID');
    assert.match(await stickers.collect(img),/不重复/);assert.equal(calls.length,1);
    await assert.rejects(()=>stickers.collect({message:[{type:'image',data:{url:'https://qpic.cn/cancel'}}]},{stillCurrent:()=>false}),/取消/);assert.equal(calls.length,1);
  }finally{globalThis.fetch=fetcher;}
});
