import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ConversationMemory,conversationScope,preference,memoryTerms,reinforceTopics,topicStrength,localDigest,eventCandidate} from '../assets/conversation-memory.mjs';
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
 assert.match(loaded.context(s,c,full),/第4[0-9]次/);assert.ok(!loaded.context(s,c,full).includes('我爱吃白饭'),'recent preference already exists in the sent history');assert.match(JSON.stringify(requestHistory(full,c)),/我爱吃白饭/);
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
 assert.ok(!context.includes('下周三'),'unrelated summary is not injected into a specific new topic');assert.match(context,/新增话题1[01]/);
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

test('repeated words gain bounded local familiarity across time, not same-message spam, and decay when unused',()=>{
 const start=Date.now()-60*86400000,one=reinforceTopics([],'白饭 白饭 白饭',start);
 assert.equal(one.find(t=>t.term==='白饭').count,1);
 const spam=reinforceTopics(one,'白饭',start+500);assert.deepEqual(spam,one);
 const later=reinforceTopics(spam,'白饭',start+86400000),entry=later.find(t=>t.term==='白饭');assert.equal(entry.count,2);assert.ok(entry.strength>2);
 assert.ok(topicStrength(entry,start+61*86400000)<topicStrength(entry,start+86400000));
 let many=later;for(let i=2;i<50;i++)many=reinforceTopics(many,'白饭',start+i*86400000);assert.ok(many.every(t=>t.strength<=20));
 assert.ok(memoryTerms('聊聊科比和篮球').includes('科比'));assert.ok(memoryTerms('Man, what can I say?').includes('man'));
});

test('familiarity excludes quoted/forwarded content and secrets and never turns mentions into likes',()=>{
 const now=Date.now()-1000;
 for(const value of ['他说白饭很好','引用：白饭','“白饭”是台词','https://example.com/白饭','API Key sk-synthetic','＃搜索 白饭','[CQ:reply,id=3]白饭'])assert.deepEqual(reinforceTopics([],value,now),[],value);
 const store=new ConversationMemory(directory()),s=scope();store.commit(s,'不想吃白饭','助手很喜欢巧克力',c);
 assert.ok(store.record(s).topics.some(t=>t.term==='白饭'));assert.equal(store.record(s).notes.length,0);assert.ok(!store.record(s).topics.some(t=>t.term==='巧克力'));
 const called=reinforceTopics([],'@deepseek 今天吃白饭',now);assert.ok(called.some(t=>t.term==='白饭'));
});

test('reinforcement ranks existing relevant excerpts without adding token-hungry topic lists or unrelated favorites',()=>{
 const now=Date.now(),topics=reinforceTopics(reinforceTopics([],'白饭',now-86400000),'白饭',now);
 const turns=[{user:'白饭',assistant:'相关旧事'},{user:'青菜',assistant:'相关新事'}];
 assert.match(localDigest(turns,20,'白饭 青菜',topics),/白饭/);assert.match(localDigest(turns,20,'青菜',topics),/青菜/);
 assert.ok(localDigest(turns,20,'白饭 青菜',topics).length<=20);
 const store=new ConversationMemory(directory()),s=scope();store.note(s,'白饭搭配清淡菜肴');for(let i=0;i<8;i++)store.note(s,'其他事情'+i);
 store.records[s.id].topics=topics;
 const context=store.context(s,c,[],'白饭怎么搭配');assert.match(context,/白饭搭配清淡菜肴/);assert.ok(!context.includes('strength'));assert.ok(!context.includes('count'));assert.match(context,/常提不等于喜欢/);
 assert.equal(store.record(s).notes.length,9);
});

test('explicit correction wins over frequent older preference and ranked memory remains inspectable and removable',()=>{
 const store=new ConversationMemory(directory()),s=scope();store.commit(s,'我喜欢白饭','知道了',c);
 store.commit(s,'现在我不喜欢白饭','按新的来',c);
 assert.deepEqual(store.record(s).notes.map(n=>n.content),['现在我不喜欢白饭']);
 assert.ok(!store.context(s,{...c,compressionEnabled:false},[],'白饭').includes('\n我喜欢白饭'));
 const item=store.record(s).notes[0];store.removeNote(s.id,item.id,c.owner,'765432');assert.equal(store.context(s,{...c,compressionEnabled:false},[],'白饭'),'');
});

test('weighted memory survives encrypted reload, remains isolated, bounded, optional and clears with history',()=>{
 const dir=directory(),store=new ConversationMemory(dir,'weighted-test-key'),s=scope(),now=Date.now();store.commit(s,'白饭','知道了',c);
 store.records[s.id].topics=reinforceTopics(reinforceTopics([],'白饭',now-86400000),'白饭',now);store.save();
 const loaded=new ConversationMemory(dir,'weighted-test-key');assert.equal(loaded.record(s).topics.find(t=>t.term==='白饭').count,2);
 assert.ok(!fs.readFileSync(loaded.file,'utf8').includes('白饭'));assert.equal(loaded.list(c.owner,'765432')[0].topics[0].term,'白饭');
 const other=conversationScope(c,{...event,user_id:555555},'765432');assert.equal(loaded.record(other).topics.length,0);
 const before=JSON.stringify(loaded.record(s).topics);loaded.commit(s,'青菜','回复',{...c,memoryReinforcement:false});assert.equal(JSON.stringify(loaded.record(s).topics),before);
 let topics=[];for(let i=0;i<200;i++)topics=reinforceTopics(topics,'topic'+i,now);assert.ok(topics.length<=128);
 loaded.end(s);assert.equal(loaded.record(s).topics.length,0);
});

test('specific recall does not fill the prompt with unrelated or duplicate excerpts',()=>{
 const duplicate={user:'白饭搭配青菜',assistant:'清淡一点'};
 const turns=[duplicate,{user:'篮球比赛明天开始',assistant:'知道了'},duplicate];
 const digest=localDigest(turns,1800,'白饭搭配');assert.equal((digest.match(/清淡一点/g)||[]).length,1);assert.ok(!digest.includes('篮球'));
 assert.equal(localDigest(turns,1800,'火星旅行'),'');assert.match(localDigest(turns,1800,''),/篮球/);
});

test('event capture separates clear user plans from preferences, quotes, instructions, secrets and questions',()=>{
 for(const value of ['我明天去医院复查','记住：医院复查改到周五','我已经完成考试报名','@deepseek 我下周去超市','记住：下周三考试'])assert.ok(eventCandidate(value),value);
 for(const value of ['我喜欢周末吃白饭','记住：我喜欢周末吃白饭','记住：以后回复简短一点','他说我明天去医院复查','“我明天去医院复查”','如果我明天去医院复查','你明天去医院复查','我明天去医院复查吗？','提醒我明天去医院','我明天去医院，密码是synthetic','#指令'])assert.equal(eventCandidate(value),'',value);
});

test('dated events survive recent-history overflow and encrypted restarts and recall only when relevant',()=>{
 const dir=directory(),store=new ConversationMemory(dir,'event-test-key'),s=scope(),before=process.env.QQWB_TIME_ZONE;
 try{process.env.QQWB_TIME_ZONE='Asia/Tokyo';store.commit(s,'记住：我明天去医院复查','知道了',c);}finally{if(before===undefined)delete process.env.QQWB_TIME_ZONE;else process.env.QQWB_TIME_ZONE=before;}
 for(let i=0;i<150;i++)store.commit(s,'其他聊天'+i,'回复',c);
 const loaded=new ConversationMemory(dir,'event-test-key'),r=loaded.record(s);assert.equal(r.events.length,1);assert.equal(r.events[0].zone,'Asia/Tokyo');assert.equal(r.notes.length,0);
 assert.ok(!fs.readFileSync(loaded.file,'utf8').includes('医院'));const context=loaded.context(s,c,loaded.history(s,c),'医院复查');assert.match(context,/事件时间线/);assert.match(context,/Asia\/Tokyo/);assert.match(context,/明天.*相对当时日期/);assert.match(context,/我明天去医院复查/);
 assert.ok(!loaded.context(s,{...c,compressionEnabled:false},[],'晚饭吃什么').includes('医院'));assert.equal(loaded.context(s,{...c,eventMemory:false,compressionEnabled:false},[],'医院复查'),'');
 const other=conversationScope(c,{...event,user_id:555555},'765432');assert.equal(loaded.record(other).events.length,0);
});

test('event correction is chronological user evidence, bounded, inspectable and individually deletable',()=>{
 const store=new ConversationMemory(directory()),s=scope();store.commit(s,'记住：医院复查安排在周三','好',c);store.commit(s,'记住：医院复查改到周五','好',c);
 const context=store.context(s,{...c,compressionEnabled:false},[],'医院复查');assert.ok(context.indexOf('安排在周三')<context.indexOf('改到周五'));assert.match(context,/最新纠正优先/);assert.match(context,/不是提醒任务或助手已执行凭据/);
 const first=store.list(c.owner,'765432')[0].events[0];assert.throws(()=>store.removeEvent(s.id,first.id,'wrong-owner','765432'));assert.equal(store.record(s).events.length,2);
 store.removeEvent(s.id,first.id,c.owner,'765432');assert.equal(store.record(s).events.length,1);
 store.commit(s,'记住：医院复查改到周五','好',c);assert.equal(store.record(s).events.length,1);assert.equal(store.record(s).events[0].mentions,2);
 for(let i=0;i<100;i++)store.commit(s,'记住：周三出差计划'+i,'好',c);assert.equal(store.record(s).events.length,64);
 const many=store.context(s,{...c,compressionEnabled:false},[],'出差计划');assert.ok(many.length<1100);
});

test('events have explicit disable and clearing behavior and do not consume the preference or old-excerpt budgets',()=>{
 const store=new ConversationMemory(directory()),s=scope();store.commit(s,'我明天去医院复查','好',{...c,eventMemory:false});assert.equal(store.record(s).events.length,0);
 store.commit(s,'记住：我喜欢白饭','好',c);store.commit(s,'我明天去医院复查','好',c);store.end(s);
 assert.equal(store.record(s).notes.length,1);assert.equal(store.record(s).events.length,1);assert.equal(store.history(s,c).length,0);
 store.clearHistory(c.owner,'765432');assert.equal(store.record(s).events.length,0);assert.equal(store.record(s).notes.length,1);
});

test('pre-layered memory migrates without backfilling inferred events or changing prior preferences',()=>{
 const dir=directory(),store=new ConversationMemory(dir),s=scope();store.note(s,'我喜欢白饭');delete store.records[s.id].events;store.save();
 const loaded=new ConversationMemory(dir);assert.equal(loaded.problem,'');assert.deepEqual(loaded.record(s).events,[]);assert.equal(loaded.record(s).notes[0].content,'我喜欢白饭');
});
