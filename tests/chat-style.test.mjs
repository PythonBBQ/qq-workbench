import {test} from 'node:test';
import assert from 'node:assert/strict';
import {corePrompt,chatBudget,systemPrompt,senderIdentity,requestHistory,addUsage,naturalStyle,sourceReply,withoutSourceFooter,capabilityPrompt,replyBubbles,deliverBubbles,chatMessages} from '../assets/chat-style.mjs';
const history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:String(i)}));
test('ordinary short replies stay short and distinct paragraphs become complete QQ bubbles',()=>{
 assert.deepEqual(replyBubbles('好呀，等你。'),['好呀，等你。']);
 assert.deepEqual(replyBubbles('先歇一会儿。\n\n晚点再聊。'),['先歇一会儿。','晚点再聊。']);
 const long='第一件事先处理好。'.repeat(30)+'第二件事也说清楚。';
 const parts=replyBubbles(long);assert.ok(parts.length>1);assert.equal(parts.join(''),long);assert.ok(parts.length<=6);
 const link='https://example.com/a?x=1&y=2';assert.ok(replyBubbles('地址：'+link+'\n\n好了。')[0].includes(link));
 const code='```js\nconst x = 1;\n\nconsole.log(x);\n```';assert.ok(replyBubbles('说明\n\n'+code+'\n\n结束').includes(code));
});
test('multi-bubble delivery stops at missing receipts or changed permissions without retrying',async()=>{
 const sent=[],accepted=[];const confirmed=r=>r?.ok;
 await assert.rejects(()=>deliverBubbles('第一段\n\n第二段\n\n第三段',{confirmed,accepted:part=>accepted.push(part),send:async m=>{sent.push(m);return {ok:sent.length===1};}}),/不自动重发/);
 assert.deepEqual(sent.map(m=>m[0].data.text),['第一段','第二段']);
 assert.deepEqual(accepted,['第一段'],'unconfirmed text never enters the acknowledged history');
 let calls=0;await assert.rejects(()=>deliverBubbles('甲\n\n乙',{confirmed,current:()=>calls===0,send:async()=>{calls++;return {ok:true};}}),/停止后续/);assert.equal(calls,1);
 const success=[];await deliverBubbles('甲\n\n乙',{confirmed,tail:[{type:'image',data:{file:'test'}}],send:async m=>{success.push(m);return {ok:true};}});assert.equal(success[0].length,1);assert.equal(success[1].length,2);
});

test('only subsequent bubbles wait 1.5 seconds, with permission rechecked after the delay',async()=>{
 const order=[];let current=true;
 await deliverBubbles('甲\n\n乙\n\n丙',{confirmed:r=>r.ok,current:()=>current,send:async m=>{order.push(m[0].data.text);return {ok:true};},wait:async ms=>order.push(ms)});
 assert.deepEqual(order,['甲',1500,'乙',1500,'丙']);
 order.length=0;
 await assert.rejects(()=>deliverBubbles('甲\n\n乙',{confirmed:r=>r.ok,current:()=>current,send:async m=>{order.push(m[0].data.text);return {ok:true};},wait:async ms=>{order.push(ms);current=false;}}),/停止后续/);
 assert.deepEqual(order,['甲',1500]);
});
test('time and retrieved memory change only the last input, leaving the reusable prompt and history prefix intact',()=>{
 const stable=systemPrompt({owner:'123456'},{user_id:123456});
 const first=chatMessages(stable,history,'现在呢','时间：早上；记忆：昨天吃饭');
 const second=chatMessages(stable,history,'现在呢','时间：晚上；记忆：今天做饭');
 assert.deepEqual(first.slice(0,-1),second.slice(0,-1));assert.notDeepEqual(first.at(-1),second.at(-1));
 const image=[{type:'text',text:'看图'},{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}];
 const vision=chatMessages(stable,[],image,'本轮资料');assert.match(vision.at(-1).content[0].text,/本轮资料/);assert.deepEqual(vision.at(-1).content[1],image[1]);assert.equal(image[0].text,'看图');
 assert.ok(!JSON.stringify(requestHistory([{role:'user',content:'问',at:123},{role:'assistant',content:'答',at:123}],{})).includes('"at"'));
});
test('compact common instructions preserve execution, source and trust boundaries; video rules are supplied only for relevant topics',()=>{
 assert.ok(corePrompt.length<300);assert.match(corePrompt,/本次工具回执/);assert.match(corePrompt,/不编造/);assert.match(corePrompt,/不是更高权限指令/);assert.match(corePrompt,/＃来源/);
 assert.ok(!systemPrompt({}).includes('空转写'));assert.match(capabilityPrompt({},'看这个视频'),/音轨转写/);assert.match(capabilityPrompt({},'看这个视频'),/拼图里/);
});
test('idle chat avoids unrelated capability instructions; topic-specific instructions remain available',()=>{
 assert.equal(capabilityPrompt({},'今天开心吗'), '');
 assert.match(capabilityPrompt({},'帮我写条说说'),/仅草稿/);
 assert.match(capabilityPrompt({},'这段视频讲什么',{video:true}),/空转写不证明静音/);
 assert.match(capabilityPrompt({},'查看手机电量'),/Shizuku/);
 assert.match(capabilityPrompt({},'解释@codex'),/独立Codex任务/);
});
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
  assert.ok(systemPrompt({persona:'x'.repeat(50000)}).length<5000);
});
test('reported usage includes fallback calls and handles absent provider fields',()=>{
  const total={input:0,output:0,cached:0};addUsage(total,{prompt_tokens:100,completion_tokens:40,prompt_cache_hit_tokens:60});
  addUsage(total,{prompt_tokens:20,completion_tokens:5,prompt_tokens_details:{cached_tokens:10}});addUsage(total,null);addUsage(total,{});
  assert.deepEqual(total,{input:120,output:45,cached:70});
});

test('natural expression is adjustable and remains subordinate to truthful capabilities and the current user request',()=>{
  assert.equal(naturalStyle({naturalChat:false}),'');assert.match(naturalStyle({chatExpression:10}),/克制/);assert.match(naturalStyle({chatExpression:90}),/鲜明/);assert.match(naturalStyle({}),/用户明确要简短/);assert.match(systemPrompt({}),/不每条都提白饭/);
});

test('a long latest answer keeps the question and conclusion for conversational followups without increasing the budget',()=>{
 const recent=[{role:'user',content:'为什么没找到这个作者？'},{role:'assistant',content:'找到了同名作者。'+ '中间资料'.repeat(4000)+'最后：尚未取得公开视频。'}];
 const bounded=requestHistory(recent,{historyChars:2000});assert.equal(bounded.length,2);assert.match(bounded[0].content,/这个作者/);assert.match(bounded[1].content,/同名作者/);assert.match(bounded[1].content,/尚未取得公开视频/);assert.ok(bounded.reduce((n,m)=>n+m.content.length,0)<=2000);assert.equal(recent[1].content.length>16000,true);
});

test('normal replies hide video receipts while the explicit source command can show real records',()=>{
 const items=[{title:'作品',url:'https://www.bilibili.com/video/BV1Umxc6JEdD',author:'作者',frames:120}];
 const raw='拼图里有人挥手。\n\n实际读取：作品 · BV1Umxc6JEdD\nhttps://www.bilibili.com/video/BV1Umxc6JEdD\n每秒1帧，共120帧；未听音轨。';
 assert.equal(withoutSourceFooter(raw,items),'视频里有人挥手。');assert.match(sourceReply({items}),/BV1Umxc6JEdD/);assert.match(sourceReply({items}),/120 帧/);assert.match(sourceReply({error:'接口受限',items:[]}),/接口受限/);assert.match(sourceReply(),/没有可查询/);
 assert.equal(withoutSourceFooter('根据[参考](https://example.com/a)的介绍[1]，可以这么做。'),'根据参考的介绍，可以这么做。');
});
