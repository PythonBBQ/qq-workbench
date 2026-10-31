import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';
import {AccountInstances,instanceLayout,validateInstance} from '../assets/account-instances.mjs';
import {voiceDecision,voicePrompt,extractVoiceChoice,synthesize} from '../assets/voice.mjs';import {DeliveryRecovery} from '../assets/delivery-recovery.mjs';import {oneBotConfig,SnowLumaBridge} from '../assets/snowluma-bridge.mjs';
const profile=slot=>({slot,name:'测试'+slot,bot:String(765430+slot),owner:'123456',apiUrl:'https://model.example/v1',model:'sample',apiKey:'synthetic-api-'+slot,speechKey:'synthetic-voice-'+slot,speechProvider:'android',voiceMode:'smart',voiceEnabled:true});
test('three isolated slots have distinct homes, runtime sockets, displays and all ports',()=>{
  for(const key of ['directory','home','runtime','display','port','wsPort','snowPort','webPort','vncPort'])assert.equal(new Set([1,2,3].map(s=>instanceLayout(s)[key])).size,3,key);
  assert.throws(()=>instanceLayout(0));assert.throws(()=>instanceLayout(4));
  const config=oneBotConfig({networks:{}},'synthetic',13003);assert.equal(config.networks.wsServers[0].port,13003);
  assert.equal(new SnowLumaBridge({slot:2}).home,instanceLayout(2).home);
  assert.throws(()=>validateInstance({...profile(1),bot:'123456'}));assert.throws(()=>validateInstance({...profile(1),apiKey:''}));assert.throws(()=>validateInstance({...profile(1),apiUrl:'https://u:p@model.example'}));
  assert.throws(()=>validateInstance({...profile(1),visionMode:'separate',visionUrl:'https://vision.example',visionModel:'v',visionKey:''}));
});
test('two instances keep credentials off disk and status, use independent auth and preserve each other on stop',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qqwb-multi-'));const launches=[];let manager;
  try{
    manager=new AccountInstances({root,source:'/opt/qq-workbench',token:'parent-auth-test',nativeToken:'native-auth-test',profiles:[profile(1),profile(2)],environment:{PATH:'/usr/bin'},spawnChild:(command,args,options)=>{const child=new EventEmitter();child.exitCode=null;child.kill=()=>{child.exitCode=0;child.emit('exit',0);};launches.push({command,args,options,child});return child;},fetcher:async(url,options)=>{const slot=Number(new URL(url).port)-13482;assert.equal(options.headers.Authorization,'Bearer '+manager.tokens.get(slot));if(url.endsWith('/shutdown')){const child=manager.children.get(slot);child.exitCode=0;child.emit('exit',0);}return Response.json({connected:true,identity:profile(slot).bot,summary:'在线',recentText:'private text must not escape'});}});
    manager.start(1);manager.start(2);manager.start(1);assert.equal(launches.length,2);
    assert.equal(launches[0].options.env.DEEPSEEK_API_KEY,'synthetic-api-1');assert.equal(launches[1].options.env.DEEPSEEK_API_KEY,'synthetic-api-2');assert.notEqual(launches[0].options.env.WORKBENCH_TOKEN,launches[1].options.env.WORKBENCH_TOKEN);assert.notEqual(launches[0].options.env.WORKBENCH_MEMORY_KEY,launches[1].options.env.WORKBENCH_MEMORY_KEY);
    for(const slot of [1,2]){const disk=fs.readFileSync(path.join(instanceLayout(slot,root).directory,'settings.json'),'utf8');assert.ok(!disk.includes('synthetic-'));assert.equal(JSON.parse(disk).expectedBot,profile(slot).bot);}
    const publicState=JSON.stringify(await manager.list());assert.ok(!publicState.includes('synthetic-'));assert.ok(!publicState.includes('private text'));
    assert.throws(()=>manager.configure([{...profile(1),apiKey:'changed'},profile(2)]),/停止/);
    assert.throws(()=>manager.configure([profile(1),{...profile(2),bot:profile(1).bot}]),/重复/);
    await manager.stop(1);assert.equal(manager.children.has(1),false);assert.equal(manager.children.has(2),true);await manager.stop(2);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('an existing primary account cannot be started in a second slot',()=>{
  const p=profile(1),manager=new AccountInstances({profiles:[p],primaryBot:()=>p.bot});assert.throws(()=>manager.start(1),/重复登录/);
});
test('smart voice respects explicit text, recent context, copyable content, groups and cooldown without a model call',()=>{
  const c={voiceEnabled:true,voiceMode:'smart',speechProvider:'android'},context={reply:'主人，晚安，好好休息。',event:{message_type:'private'}};
  assert.equal(voiceDecision('晚安',c,context).voice,true);
  assert.equal(voiceDecision('你好',c,context).voice,false);
  for(const text of ['用语音回复','语音说说','发条语音','来段语音','说句话听听','听听你的声音'])assert.equal(voiceDecision(text,c,context).voice,true,text);
  assert.equal(voiceDecision('不要语音，打字回复',{...c,voiceAlways:true,voiceMode:'always'},context).voice,false);
  assert.equal(voiceDecision('晚安',c,{...context,reply:'请复制代码 ```x```'}).voice,false);
  assert.equal(voiceDecision('晚安',c,{...context,history:[{role:'user',content:'我在开会，不方便听语音'}]}).voice,false);
  assert.equal(voiceDecision('用语音回复',c,{...context,history:[{role:'user',content:'别用语音'}]}).voice,true);
  assert.equal(voiceDecision('晚安',c,{...context,event:{message_type:'group'}}).voice,false);
  assert.equal(voiceDecision('你好',c,{...context,event:{message_type:'private',message:[{type:'record'}]}}).voice,true);
  assert.equal(voiceDecision('晚安',c,{...context,lastVoiceAt:1000,now:2000}).voice,false);
  assert.equal(voiceDecision('晚安',c,{...context,mode:'ambient'}).voice,false);
  assert.equal(voiceDecision('晚安',{...c,voiceMode:'request'},context).voice,false);
});
test('system TTS is authenticated by its caller, converted once, and temporary files are cleaned',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qqwb-speech-'));let calls=0;
  try{const wav=Buffer.alloc(128);wav.write('RIFF');
    const audio=await synthesize({speechProvider:'android'},'主人，晚安。',{directory:root,native:async(route,data)=>{calls++;assert.equal(route,'synthesize');assert.equal(data.text,'主人，晚安。');return {ok:true,audio:wav.toString('base64')};},convert:async(binary,args)=>{assert.equal(binary,'/usr/bin/ffmpeg');fs.writeFileSync(args.at(-1),Buffer.concat([Buffer.from('ID3'),Buffer.alloc(100)]));}});
    assert.equal(calls,1);assert.equal(fs.readdirSync(root).length,1);audio.cleanup();assert.equal(fs.readdirSync(root).length,0);
    await assert.rejects(()=>synthesize({speechProvider:'android'},'x',{directory:root,native:async()=>({ok:false,message:'系统缺少语言数据'})}),/语言/);
    await assert.rejects(()=>synthesize({speechProvider:'android'},'x',{directory:root,native:async()=>({ok:true,audio:wav.toString('base64')}),convert:async()=>{throw new Error('ffmpeg failed');}}),/转换/);assert.equal(fs.readdirSync(root).length,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('unknown receipts protect only their conversation; resume requires time and a fresh connection check, never replay',()=>{
  let now=1000;const recovery=new DeliveryRecovery({now:()=>now}),one={message_type:'private',user_id:123456},other={message_type:'private',user_id:765432};
  recovery.fail(one);assert.equal(recovery.allowed(one,true,1001),false);assert.equal(recovery.allowed(other,true,1001),true);
  now=32000;assert.equal(recovery.allowed(one,true,999),false);assert.equal(recovery.allowed(one,false,32000),false);assert.equal(recovery.allowed(one,true,32000),true);
  recovery.fail(one);now+=30001;assert.equal(recovery.allowed(one,true,now),false);now+=30000;assert.equal(recovery.allowed(one,true,now),true);recovery.success(one);assert.equal(recovery.state().count,0);
});

test('the same chat completion chooses voice contextually; text preference and local guardrails still win',()=>{
 const c={voiceEnabled:true,voiceMode:'smart'},ctx={reply:'辛苦啦，先歇一歇吧。',event:{message_type:'private'}};
 assert.match(voicePrompt(c),/结合当前话题/);assert.equal(voicePrompt({voiceEnabled:false}),'');assert.equal(voicePrompt({...c,voiceMode:'request'}),'');
 const chosen=extractVoiceChoice('[[voice]] 辛苦啦，先歇一歇吧。');assert.equal(chosen.choice,true);assert.equal(chosen.text,'辛苦啦，先歇一歇吧。');
 assert.equal(voiceDecision('今天累坏了',c,{...ctx,modelChoice:true}).voice,true);assert.equal(voiceDecision('晚安',c,{...ctx,modelChoice:false}).voice,false);
 assert.equal(voiceDecision('今天累坏了',c,{...ctx,modelChoice:true,reply:'看这里 https://example.com'}).voice,false);assert.equal(voiceDecision('文字回复',c,{...ctx,modelChoice:true}).voice,false);
 assert.equal(voiceDecision('今天累坏了',{...c,voicePreference:0},{...ctx,modelChoice:true}).voice,false);assert.equal(extractVoiceChoice('[[text]] 好的').choice,false);assert.equal(extractVoiceChoice('普通正文').choice,null);
 assert.equal(voiceDecision('今天累坏了',c,{...ctx,modelChoice:true,history:[{role:'user',content:'别用语音'},{role:'user',content:'继续语音'}]}).voice,true,'latest explicit preference replaces an older refusal');
});
