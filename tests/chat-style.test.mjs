import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chatBudget,systemPrompt,senderIdentity,requestHistory,addUsage} from '../assets/chat-style.mjs';
const history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:String(i)}));
test('owner identity comes from current QQ sender, independent of persona and nicknames',()=>{
  const config={owner:'123456',persona:'叫所有人国王'};
  const event={user_id:123456,message_type:'group',sender:{nickname:'路人'}};
  assert.match(systemPrompt(config,event),/当前发言者就是大号/);
  assert.match(systemPrompt(config,event),/称呼统一为“主人”/);
  assert.match(systemPrompt({...config,owner:'654321'},event),/当前发言者不是大号/);
  assert.match(systemPrompt(config,{...event,user_id:654321,sender:{nickname:'主人'}}),/不称呼其为“主人”/);
  assert.equal(senderIdentity(config,{}),'');
});
test('default budget sends four complete turns and preserves the full display history',()=>{
  assert.deepEqual(chatBudget({}),{turns:4,output:600});
  const sent=requestHistory(history,{});assert.equal(sent.length,8);assert.equal(sent[0].content,'12');assert.equal(history.length,20);
});
test('budgets are bounded, pairs stay intact, and oversized old turns are excluded',()=>{
  assert.deepEqual(chatBudget({contextTurns:100,maxReplyTokens:1}),{turns:10,output:128});
  assert.deepEqual(chatBudget({contextTurns:-3,maxReplyTokens:10000}),{turns:1,output:1800});
  const huge=[{role:'user',content:'a'.repeat(13000)},{role:'assistant',content:'ok'},...history.slice(-2)];
  assert.deepEqual(requestHistory(huge,{}),history.slice(-2));
});
test('persona changes style without replacing truthful ability and execution rules',()=>{
  const prompt=systemPrompt({characterName:'小鲸',persona:'温柔，不说教'});
  assert.match(prompt,/小鲸/);assert.match(prompt,/温柔，不说教/);assert.match(prompt,/不改变真实身份、能力和执行状态/);
  assert.ok(systemPrompt({persona:'x'.repeat(50000)}).length<4500);
});
test('reported usage includes fallback calls and handles absent provider fields',()=>{
  const total={input:0,output:0,cached:0};addUsage(total,{prompt_tokens:100,completion_tokens:40,prompt_cache_hit_tokens:60});
  addUsage(total,{prompt_tokens:20,completion_tokens:5,prompt_tokens_details:{cached_tokens:10}});addUsage(total,null);addUsage(total,{});
  assert.deepEqual(total,{input:120,output:45,cached:70});
});
