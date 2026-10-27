import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ConversationMemory,conversationScope,preference} from '../assets/conversation-memory.mjs';
import {worldContext,requestHistory} from '../assets/chat-style.mjs';
const base=path.resolve(import.meta.dirname,'../build/memory-tests');fs.mkdirSync(base,{recursive:true});
const directory=()=>fs.mkdtempSync(path.join(base,'case-'));
const c={owner:'123456',characterName:'鲸鱼',persona:'白饭',worldBook:'白饭|爱吃白饭',contextTurns:2};
const event={user_id:123456,message_type:'private'};
const scope=()=>conversationScope(c,event,'765432');
test('long conversation persists across restarts with bounded recent context and old facts, no media persistence',()=>{
 const dir=directory(),store=new ConversationMemory(dir),s=scope();
 for(let i=0;i<50;i++)store.commit(s,'第'+i+'次计划：周末做饭','第'+i+'次回答',c);
 store.commit(s,'记住：我爱吃白饭','记住啦',c);
 const loaded=new ConversationMemory(dir);assert.equal(loaded.history(s,c).length,102);
 const full=loaded.history(s,c);assert.equal(requestHistory(full,c).length,4);
 assert.match(loaded.context(s,c,full),/第4[0-9]次/);assert.match(loaded.context(s,c,full),/我爱吃白饭/);
 assert.equal(loaded.history(s,{...c,memoryEnabled:false}).length,0);
 assert.ok(!fs.readFileSync(store.file,'utf8').includes('image_url'));
});
test('scopes separate owners, bot accounts, users, private/groups and role/world changes',()=>{
 const first=scope().id;
 for(const alternative of [conversationScope({...c,owner:'654321'},event,'765432'),conversationScope(c,event,'765433'),conversationScope(c,{...event,user_id:555555},'765432'),conversationScope(c,{...event,message_type:'group',group_id:12},'765432'),conversationScope({...c,persona:'新角色'},event,'765432'),conversationScope({...c,worldBook:'不同背景'},event,'765432')])assert.notEqual(alternative.id,first);
 const store=new ConversationMemory(directory());store.commit(scope(),'私密计划','知道了',c);
 assert.equal(store.list('654321','765432').length,0);assert.equal(store.history(conversationScope(c,{...event,user_id:555555},'765432'),c).length,0);
});
test('compression is opt-in, bounded to one call per 12 rounds, and cannot resurrect forgotten history',async()=>{
 const store=new ConversationMemory(directory()),s=scope();for(let i=0;i<16;i++)store.commit(s,'用户'+i,'回答'+i,c);
 let calls=0;const compressor=async value=>{calls++;assert.ok(value.length<12500);return '旧对话摘要'};
 assert.equal(await store.compress(s,c,compressor),false);assert.equal(calls,0);
 const config={...c,compressionMode:'model'};assert.equal(await store.compress(s,config,compressor),true);assert.equal(calls,1);
 for(let i=0;i<11;i++)store.commit(s,'新增'+i,'回答',c);assert.equal(await store.compress(s,config,compressor),false);assert.equal(calls,1);
 store.commit(s,'达到阈值','回答',c);assert.equal(await store.compress(s,config,compressor),true);assert.equal(calls,2);
 for(let i=0;i<12;i++)store.commit(s,'新增','回答',c);
 let release;const pending=store.compress(s,config,()=>new Promise(r=>release=r));store.forget(s.id,c.owner,'765432');release('不应恢复');assert.equal(await pending,false);assert.equal(new ConversationMemory(path.dirname(store.file)).list(c.owner,'765432').length,0);
});
test('explicit preferences are inspectable/removable, ending clears dialogue only, exports own samples only',()=>{
 assert.equal(preference('你喜欢什么菜'),'');assert.equal(preference('记住：不爱吃辣'),'不爱吃辣');
 const store=new ConversationMemory(directory()),s=scope();store.commit(s,'记住：喜欢白饭','好呀',c);
 const other=conversationScope(c,{...event,user_id:555555},'765432');store.commit(other,'别人的内容','回复',c);
 const rows=store.export(c.owner,'765432').split('\n').map(JSON.parse);assert.equal(rows.length,1);assert.equal(rows[0].messages[0].content,'记住：喜欢白饭');
 const id=store.list(c.owner,'765432').find(r=>r.id===s.id).notes[0].id;store.removeNote(s.id,id,c.owner,'765432');assert.equal(store.record(s).notes.length,0);
 store.note(s,'回答简短');store.end(s);assert.equal(store.history(s,c).length,0);assert.equal(store.record(s).notes.length,1);
 store.clear(c.owner,'765432');assert.equal(store.list(c.owner,'765432').length,0);
});
test('storage limits and corruption do not grow indefinitely or overwrite damaged files',()=>{
 const store=new ConversationMemory(directory());const s=scope();for(let i=0;i<200;i++)store.commit(s,'x'.repeat(4000),'y'.repeat(7000),c);
 assert.equal(store.record(s).turns.length,120);assert.ok(fs.statSync(store.file).size<2*1024*1024);
 const file=path.join(directory(),'conversation-memory.json');fs.writeFileSync(file,'broken original');const corrupt=new ConversationMemory(path.dirname(file));corrupt.commit(s,'new','answer',c);assert.ok(corrupt.problem);assert.equal(fs.readFileSync(file,'utf8'),'broken original');
});
test('keyword world book only injects relevant entries within a budget',()=>{
 const config={worldBook:'白饭,米饭 | 鲸鱼喜欢一碗白饭\n宇宙 | 正在太空旅行\n无分隔符'};
 assert.match(worldContext(config,'今天吃米饭'),/一碗白饭/);assert.ok(!worldContext(config,'今天吃米饭').includes('太空'));
 assert.equal(worldContext(config,'天气怎么样'),'');assert.match(worldContext(config,'宇宙很大'),/太空/);
});
test('persisted conversations can be encrypted and wrong keys never overwrite the original',()=>{
 const dir=directory(),store=new ConversationMemory(dir,'test-private-memory-key');store.commit(scope(),'唯一的私人偏好','知道了',c);
 const bytes=fs.readFileSync(store.file,'utf8');assert.ok(!bytes.includes('唯一的私人偏好'));assert.equal(JSON.parse(bytes).encrypted,true);
 assert.equal(new ConversationMemory(dir,'test-private-memory-key').history(scope(),c)[0].content,'唯一的私人偏好');
 const wrong=new ConversationMemory(dir,'wrong-key');assert.ok(wrong.problem);wrong.commit(scope(),'不应覆盖','错误',c);assert.equal(fs.readFileSync(store.file,'utf8'),bytes);
});

test('retrieval finds old relevant facts even after the smaller media cache and summary coverage advance',async()=>{
 const store=new ConversationMemory(directory()),s=scope();
 for(let i=0;i<100;i++)store.commit(s,i===9?'火星行程安排在下周三':'聊点别的'+i,'知道了'+i,c);
 const smaller=store.history(s,c).slice(-120);
 assert.match(store.context(s,c,smaller,'火星行程'),/下周三/);
 await store.compress(s,{...c,compressionMode:'model'},async()=> '火星行程安排在下周三');
 for(let i=0;i<14;i++)store.commit(s,'之后新增话题'+i,'回复',c);
 const context=store.context(s,c,store.history(s,c).slice(-120),'新增话题13');
 assert.match(context,/下周三/);assert.match(context,/新增话题1[01]/);
});

test('local overflow keeps bounded older excerpts across restart and clears them on chat end',()=>{
 const dir=directory(),store=new ConversationMemory(dir),s=scope();
 for(let i=0;i<132;i++)store.commit(s,i===2?'木星计划定在下周五':'旧消息'+i,'回答',c);
 const loaded=new ConversationMemory(dir),full=loaded.history(s,c);
 assert.equal(full.length,240);assert.match(loaded.context(s,c,full,'木星计划'),/下周五/);
 assert.ok(loaded.record(s).archive.length<=24);assert.match(loaded.list(c.owner,'765432')[0].archive,/木星/);
 loaded.end(s);assert.equal(loaded.record(s).archive.length,0);assert.equal(loaded.context(s,c,[]),'');
});

test('failed optional summaries do not repeatedly spend tokens on every message',async()=>{
 const store=new ConversationMemory(directory()),s=scope(),config={...c,compressionMode:'model'};
 for(let i=0;i<16;i++)store.commit(s,'消息'+i,'回答',config);
 let calls=0;const fail=async()=>{calls++;throw new Error('test network failure');};
 await assert.rejects(()=>store.compress(s,config,fail));
 for(let i=0;i<11;i++){store.commit(s,'继续聊'+i,'回答',config);assert.equal(await store.compress(s,config,fail),false);}
 assert.equal(calls,1);store.commit(s,'第12轮','回答',config);await assert.rejects(()=>store.compress(s,config,fail));assert.equal(calls,2);
});
