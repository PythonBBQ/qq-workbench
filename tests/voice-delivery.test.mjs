import test from 'node:test';import assert from 'node:assert/strict';
import {splitVoiceMessages,prepareSpeech} from '../assets/voice-delivery.mjs';
import {voiceDecision,speechPlan,speechDeliveryFilter} from '../assets/voice.mjs';
const text='今天先不用着急，我们可以把事情一件一件做好。等你休息好了，再来想想明天的安排，也不用一次说完。'.repeat(7);
const confirmed=r=>r?.status==='ok';
const receipt={status:'ok',data:{message_id:12}};

test('speech partitions preserve all text, punctuation, English words and surrogate pairs before synthesis',()=>{
 for(const value of [text,'English sentences stay together. '.repeat(40),'没有标点也要保留内容'.repeat(50),'今天😀你好。'.repeat(60)]){const parts=splitVoiceMessages(value);assert.equal(parts.join(''),value.trim());assert.ok(parts.length>1);assert.ok(parts.every(p=>p.length>0&&p.length<=260));assert.ok(parts.every(p=>!/[\uD800-\uDBFF]$/.test(p)&&!/[\uDC00-\uDFFF]/.test(p[0])));}
 assert.deepEqual(splitVoiceMessages('准备好了。'),['准备好了。']);assert.deepEqual(splitVoiceMessages(''),[]);
});

test('small trailing sentences never merge past the native 240 UTF-16 character limit',()=>{
 for(const value of ['a'.repeat(239)+' hello.', '𠀀'.repeat(121)+'。', 'a'.repeat(238)+'𠀀𠀀。', 'a'.repeat(235)+' 继续说完。']){
  const parts=splitVoiceMessages(value);assert.equal(parts.join(''),value);
  assert.ok(parts.every(part=>part.length<=240),parts.map(part=>part.length).join(','));
 }
});
test('long speech is lazy, each acknowledged before the next synthesis, with one cleanup per segment',async()=>{
 const seen=[];let generated=0,acked=0,cleaned=0;
 const batch=prepareSpeech({},text,{},async(c,part)=>{assert.equal(generated,acked);generated++;seen.push(part);return {segment:{type:'record',data:{file:String(generated)}},info:{part:generated},cleanup(){cleaned++;}};});
 assert.equal(generated,0);const r=await batch.deliver({confirmed,send:async message=>{assert.equal(message.length,1);assert.equal(message[0].type,'record');acked++;return receipt;}});
 assert.equal(r,receipt);assert.equal(seen.join(''),text);assert.equal(cleaned,generated);assert.equal(batch.acceptedVoiceCount,generated);assert.equal(batch.info.part,generated);
 await assert.rejects(()=>batch.deliver({confirmed,send:async()=>{throw Error('should not resend');}}),/不自动重复/);
});

test('slow full precision model splits replies before inference and preserves every character',async()=>{
 for(const steps of [16,32]){
  const seen=[];let cleaned=0;const input='先休息一会吧，今天的事情可以慢慢说。等你准备好了，我再把后面的安排说给你听。'.repeat(3);
  const batch=prepareSpeech({speechProvider:'zipvoice',zipVoiceModel:'full',zipVoiceSteps:steps},input,{},async(c,part)=>{seen.push(part);return {segment:{type:'record'},cleanup(){cleaned++;}};});
  await batch.deliver({confirmed,send:async()=>receipt});assert.equal(seen.join(''),input);assert.ok(seen.every(v=>v.length<=(steps===32?24:36)));assert.equal(cleaned,seen.length);
 }
});
test('uncertain send stops subsequent synthesis and sends, cleans audio, and never falls back to duplicate text',async()=>{
 let synthesized=0,sends=0,cleaned=0;const batch=prepareSpeech({},text,{},async()=>{synthesized++;return {segment:{type:'record'},cleanup(){cleaned++;}};});
 await assert.rejects(()=>batch.deliver({confirmed,send:async()=>{sends++;return sends===1?receipt:{status:'timeout'};}}),/不确定/);
 assert.equal(synthesized,2);assert.equal(sends,2);assert.equal(cleaned,2);assert.equal(batch.acceptedVoiceCount,1);assert.equal(batch.fallback,false);
});
test('a synthesis failure sends only the unread suffix as text after earlier voice acknowledgements',async()=>{
 let generated=0,heard='',fallback='';const parts=splitVoiceMessages(text);
 const batch=prepareSpeech({},text,{},async(c,part)=>{if(++generated===2)throw Error('synthesis failed');heard+=part;return {segment:{type:'record'},cleanup(){}};});
 await batch.deliver({confirmed,send:async message=>{if(message[0].type==='text')fallback+=message[0].data.text;return receipt;}});
 assert.equal(heard,parts[0]);assert.equal(heard+fallback,text);assert.equal(batch.acceptedVoiceCount,1);assert.equal(batch.fallback,true);assert.equal(generated,2);
});
test('failed initial synthesis falls back to the full text without losing long replies',async()=>{
 let sent='';const batch=prepareSpeech({},text,{},async()=>{throw Error('offline');});await batch.deliver({confirmed,send:async message=>{assert.equal(message[0].type,'text');sent+=message[0].data.text;return receipt;}});assert.equal(sent,text);assert.equal(batch.acceptedVoiceCount,0);
});
test('account changes during generation clean the pending audio and prevent further sends',async()=>{
 let current=true,sends=0,cleaned=0;const batch=prepareSpeech({},text,{},async()=>{current=false;return {segment:{type:'record'},cleanup(){cleaned++;}};});await assert.rejects(()=>batch.deliver({confirmed,current:()=>current,send:async()=>{sends++;return receipt;}}),/会话已变化/);assert.equal(sends,0);assert.equal(cleaned,1);
});
test('a thrown QQ send error is never treated as synthesis failure or retried',async()=>{
 let sends=0;const batch=prepareSpeech({},text,{},async()=>({segment:{type:'record'},cleanup(){}}));await assert.rejects(()=>batch.deliver({confirmed,send:async()=>{sends++;throw Error('socket timeout');}}),/socket timeout/);assert.equal(sends,1);assert.equal(batch.fallback,false);
});

test('an unsent synthesized segment waits for transport recovery without regenerating it',async()=>{
 let online=true,generated=0,cleaned=0,sends=0,accepted='';
 const batch=prepareSpeech({},'先坐下来慢慢说。',{},async()=>{generated++;online=false;return {segment:{type:'record'},cleanup(){cleaned++;}};});
 await batch.deliver({confirmed,ready:async()=>{if(!online){await new Promise(r=>setTimeout(r,10));online=true;}},send:async()=>{assert.equal(online,true);sends++;return receipt;},accepted:part=>accepted+=part});
 assert.equal(generated,1);assert.equal(sends,1);assert.equal(cleaned,1);assert.equal(accepted,'先坐下来慢慢说。');assert.equal(batch.uncertain,false);
});

test('cancel or connection wait before send never creates an uncertain delivery',async()=>{
 for(const code of ['VOICE_SESSION_CHANGED','VOICE_CONNECTION_WAIT']){
  let readyCount=0,sends=0,cleaned=0;
  const batch=prepareSpeech({},'先坐下来慢慢说。',{},async()=>({segment:{type:'record'},cleanup(){cleaned++;}}));
  await assert.rejects(()=>batch.deliver({confirmed,ready:async()=>{if(++readyCount===2)throw Object.assign(Error('stopped before send'),{code});},send:async()=>{sends++;return receipt;}}),e=>e.code===code);
  assert.equal(batch.uncertain,false);assert.equal(sends,0);assert.equal(cleaned,1);
 }
});

test('only acknowledged voice prefixes enter partial memory after a later unconfirmed send',async()=>{
 const accepted=[];let sends=0;
 const batch=prepareSpeech({},text,{},async()=>({segment:{type:'record'},cleanup(){}}));
 await assert.rejects(()=>batch.deliver({confirmed,send:async()=>++sends===1?receipt:{status:'timeout'},accepted:part=>accepted.push(part)}),/不确定/);
 assert.deepEqual(accepted,[splitVoiceMessages(text)[0]]);assert.equal(batch.uncertain,true);assert.equal(sends,2);
});
test('long answers can retain selected voice while copyable technical content remains text',()=>{
 assert.equal(voiceDecision('继续说',{voiceEnabled:true,voiceMode:'always'},{reply:text}).voice,true);assert.equal(voiceDecision('继续说',{voiceEnabled:true,voiceMode:'smart'},{reply:text,modelChoice:true}).voice,true);assert.equal(voiceDecision('继续说',{voiceEnabled:true,voiceMode:'always'},{reply:'https://example.com'}).voice,false);
});
test('fixed emotional preset overrides the model mood and pitch processing preserves tempo and the ending margin',()=>{
 assert.equal(speechPlan('你好',{voiceEmotionPreset:'shy'},'happy').emotion,'shy');assert.equal(speechPlan('你好',{voiceEmotionPreset:'invalid'},'happy').emotion,'happy');
 for(const pitch of [-30,30]){const filter=speechDeliveryFilter(false,pitch);assert.match(filter,/asetrate=/);assert.match(filter,/atempo=/);assert.ok(filter.endsWith('apad=pad_dur=1.5'));assert.ok(!filter.includes('silenceremove'));}
 assert.ok(!speechDeliveryFilter(false,0).includes('asetrate'));
});

test('all bubbles share the whole-answer delivery and retain acknowledged per-part reference evidence',async()=>{
 const input='先坐下来，我们把今天的事情说清楚。'.repeat(4)+'闭上眼睛，安心睡吧。';
 const options={emotion:'sad',event:{raw_message:'陪我聊聊'}};
 const original=structuredClone(options);const seen=[];
 const batch=prepareSpeech({speechProvider:'zipvoice',zipVoiceModel:'full',zipVoiceSteps:16},input,options,async(c,part,request)=>{
  seen.push({part,style:request.deliveryStyle,mood:request.emotion});
  return {segment:{type:'record'},info:{referenceMood:'gentle',referenceVariant:0,deliveryStyle:request.deliveryStyle,elapsedMs:seen.length*100},cleanup(){}};
 });
 await batch.deliver({confirmed,send:async()=>receipt});
 assert.ok(seen.length>1);assert.equal(seen.map(v=>v.part).join(''),input);
 assert.ok(seen.every(v=>v.style==='soft'&&v.mood==='sad'));
 assert.deepEqual(options,original,'caller options remain unchanged');
 assert.equal(batch.info.parts.length,seen.length);assert.equal(batch.info.elapsedMs,seen.length*100);
 assert.deepEqual(batch.info.parts.map(v=>v.part),seen.map((_,i)=>i+1));
 assert.ok(batch.info.parts.every(v=>v.referenceVariant===0&&v.referenceMood==='gentle'));
});

test('explicit whole-answer delivery is preserved and unconfirmed bubbles never enter accepted metadata',async()=>{
 const options={deliveryStyle:'normal'};let generated=0,sends=0;
 const batch=prepareSpeech({},text,options,async(c,part,request)=>{
  assert.equal(request.deliveryStyle,'normal');generated++;
  return {segment:{type:'record'},info:{referenceMood:'sad',referenceVariant:0,elapsedMs:generated*10},cleanup(){}};
 });
 await assert.rejects(()=>batch.deliver({confirmed,send:async()=>++sends===1?receipt:{status:'timeout'}}),/不确定/);
 assert.equal(generated,2);assert.equal(batch.info.parts.length,1);assert.equal(batch.info.parts[0].part,1);assert.equal(batch.info.elapsedMs,10);
 assert.deepEqual(options,{deliveryStyle:'normal'});
});
