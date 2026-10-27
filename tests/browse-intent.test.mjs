import {test} from 'node:test';import assert from 'node:assert/strict';
import {naturalBrowseIntent,browseCandidate} from '../assets/browse-intent.mjs';
const history=[{role:'user',content:'DeepSeek 的新版本有什么变化？'},{role:'assistant',content:'我需要查一下最新资料。'}];
test('natural search instructions work without a rigid browser-search command',async()=>{
 for(const [message,expected] of [['去搜一下DeepSeek最新版本','DeepSeek最新版本'],['帮我查查红烧肉做法','红烧肉做法'],['联网看看米饭怎么煮','米饭怎么煮'],['用浏览器搜索 白饭的做法','白饭的做法'],['DeepSeek最新版本，联网看看','DeepSeek最新版本'],['上网查一下小米平板参数','小米平板参数'],['搜DeepSeek','DeepSeek']]){
  const result=await naturalBrowseIntent(message);assert.equal(result?.kind,'web-browse',message);assert.equal(result?.value,expected,message);
 }
 assert.match((await naturalBrowseIntent('搜索“DeepSeek”新版本')).value,/DeepSeek/);
});
test('elliptical followups use only scoped user history and ask for topic when absent',async()=>{
 for(const text of ['再查一下','联网看看','那你去搜一下','继续搜搜']){
  assert.match((await naturalBrowseIntent(text,{history})).value,/DeepSeek/);
  assert.deepEqual(await naturalBrowseIntent(text),{kind:'clarify',value:''});
 }
 assert.deepEqual(await naturalBrowseIntent('联网看看',{history:[{role:'assistant',content:'不要拿助手猜测当作用户主题'}]}),{kind:'clarify',value:''});
 let calls=0;assert.match((await naturalBrowseIntent('那你再查一下',{history:[...history,{role:'user',content:'谢谢'}],planner:async()=>{calls++;throw new Error('should not call');}})).value,/DeepSeek/);assert.equal(calls,0);
});
test('ordinary chat, negated browsing, quoted examples and credential-bearing searches make no request',async()=>{
 let calls=0;const planner=async()=>{calls++;return '{"search":true,"query":"test"}';};
 for(const message of ['今天想吃什么','最近我好难过','不要联网，直接回答','不用搜了','关闭联网功能','解释“联网看看”是什么意思','搜索是什么意思','“去搜一下最新新闻”','帮我搜索 api_key=synthetic-secret-value'])assert.equal(await naturalBrowseIntent(message,{planner}),null,message);
 assert.equal(calls,0);
});
test('semantic planner handles current facts, can decline casual chat and falls back for incompatible relays',async()=>{
 let calls=0;const planner=async messages=>{calls++;assert.match(messages[0].content,/联网检索路由器/);return '{"search":true,"query":"DeepSeek 最新发布版本"}';};
 const result=await naturalBrowseIntent('那它现在最新的是什么',{history,planner});assert.equal(result.value,'DeepSeek 最新发布版本');assert.equal(calls,1);
 assert.equal(await naturalBrowseIntent('最新消息让人焦虑',{planner:async()=>'{"search":false,"query":""}'}),null);
 assert.equal(await naturalBrowseIntent('DeepSeek最新版本是什么',{automatic:false,planner}),null);
 assert.match((await naturalBrowseIntent('再查一下',{history,planner:async()=>{throw new Error('unsupported');}})).value,/DeepSeek/);
 assert.equal(browseCandidate('联网看看',{automatic:false}).explicit,true);
 assert.equal((await naturalBrowseIntent('那它当前版本支持什么，联网查一下',{history,planner:async()=>'{"search":true,"query":"api_key=do-not-leak"}'})).kind,'clarify');
});
