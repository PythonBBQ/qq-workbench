import test from 'node:test';import assert from 'node:assert/strict';
import {feiyuSpeech,feiyuBase} from '../assets/feiyu-voice.mjs';import {extractVoiceChoice,speechRequest,synthesize} from '../assets/voice.mjs';
const id='a'.repeat(32),c={feiyuUrl:'https://voice.example/service',feiyuStyle:'auto'};
const wav=()=>{const b=Buffer.alloc(100);b.write('RIFF');b.write('WAVE',8);return b;};
test('Feiyu protocol submits once, waits for real success, uses its own key and downloads same-origin WAV',async()=>{
  const calls=[];let polls=0,now=0;
  const result=await feiyuSpeech(c,'主人，辛苦了。',{key:'synthetic-feiyu-key',emotion:'gentle',now:()=>now,wait:async ms=>{now+=ms;},fetcher:async(url,options)=>{calls.push({url,options});assert.equal(options.headers.Authorization,'Bearer synthetic-feiyu-key');assert.ok(url.startsWith('https://voice.example/service/v1/'));assert.equal(options.redirect,'error');if(url.endsWith('/speech')){assert.deepEqual(JSON.parse(options.body),{voice:'feiyu',text:'主人，辛苦了。',style:'gentle'});return Response.json({id},{status:202});}if(url.endsWith('/audio'))return new Response(wav());return Response.json({status:++polls===1?'running':'success'});}});
  assert.equal(result.style,'gentle');assert.equal(result.bytes.length,100);assert.equal(calls.filter(v=>v.options.method==='POST').length,1);assert.equal(polls,2);
});
test('invalid jobs, lost submission ACK, redirects, credentials errors and failed jobs never trigger a second submission',async()=>{
  for(const behavior of ['lost','bad-id','failed','auth','redirect']){let posts=0;await assert.rejects(()=>feiyuSpeech(c,'测试',{key:'synthetic-key',fetcher:async(url,options)=>{if(options.method==='POST')posts++;if(behavior==='lost')throw new Error('private-key');if(behavior==='auth')return new Response('',{status:401});if(behavior==='redirect')return new Response('',{status:302});if(url.endsWith('/speech'))return Response.json({id:behavior==='bad-id'?'../../other':id},{status:202});return Response.json({status:'failed',error:'private server path'});}}));assert.equal(posts,1,behavior);}
  for(const url of ['http://public.example','file:///etc/passwd','https://u:p@voice.example','https://voice.example?key=abc'])assert.throws(()=>feiyuBase(url));
  assert.equal(feiyuBase('http://192.168.1.5:9880/'),'http://192.168.1.5:9880');assert.equal(feiyuBase('http://127.0.0.1:9880'),'http://127.0.0.1:9880');
});
test('cancelled or timed out voice jobs do not download audio, post twice or claim completed synthesis',async()=>{
  let now=0,posts=0;await assert.rejects(()=>feiyuSpeech(c,'测试',{key:'synthetic',timeout:5,now:()=>now,wait:async ms=>{now+=ms;},fetcher:async(url,options)=>{if(options.method==='POST'){posts++;return Response.json({id});}return Response.json({status:'queued'});}}),/超时/);assert.equal(posts,1);
  await assert.rejects(()=>feiyuSpeech(c,'测试',{key:'synthetic',stillCurrent:()=>false}),/取消/);
});
test('emotion markers never reach speech, memory text or QQ text; voice engine capabilities are explicit',async()=>{
  const chosen=extractVoiceChoice('[[voice:shy]] 主人，别逗啦。');assert.equal(chosen.choice,true);assert.equal(chosen.emotion,'shy');assert.equal(chosen.text,'主人，别逗啦。');assert.equal(extractVoiceChoice('[[text]]收到').text,'收到');
  const xml=speechRequest({speechVoice:'zh-CN-XiaoxiaoNeural'},'你好','test-key','happy').options.body;assert.match(xml,/mstts:express-as style="cheerful"/);assert.match(xml,/styledegree="0.7"/);
  assert.ok(!speechRequest({speechVoice:'ja-JP-NanamiNeural'},'test','test-key','happy').options.body.includes('express-as style='));
  let request;await assert.rejects(()=>synthesize({speechProvider:'android'},'你好',{emotion:'gentle',native:async(route,data)=>{request=data;return {ok:false,message:'测试终止'};}}));assert.equal(request.rate,-7);assert.equal(request.pitch,-2);
});
