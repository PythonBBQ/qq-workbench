import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {ConversationMemory,conversationScope} from '../assets/conversation-memory.mjs';
import {styleFeedback,applyReflection} from '../assets/personality-growth.mjs';
const root=path.resolve(import.meta.dirname,'../build/growth-tests');fs.mkdirSync(root,{recursive:true});
const directory=()=>fs.mkdtempSync(path.join(root,'case-'));const config={owner:'123456',persona:'鲸鱼娘，爱吃白饭',characterName:'鲸鱼娘'};
const scope=(c=config,event={message_type:'private',user_id:123456})=>conversationScope(c,event,'765432');
test('confirmed dialogue feedback gradually adjusts bounded style, persists encrypted, and quoted instructions do not train style',()=>{
 const dir=directory(),store=new ConversationMemory(dir,'synthetic-key'),s=scope();
 for(let i=0;i<9;i++)store.commit(s,'请温柔一点，回答简短一点','好的',config);
 assert.equal(store.record(s).growth.scores.warmth,4);assert.equal(store.record(s).growth.scores.detail,-4);assert.equal(store.record(s).growth.familiarity,9);
 assert.deepEqual(styleFeedback('解释“温柔一点”是什么意思'),{});assert.deepEqual(styleFeedback('不要温柔一点'),{});
 assert.deepEqual(styleFeedback('我今天要温柔一点'),{});assert.deepEqual(styleFeedback('不想你太温柔一点'),{});
 assert.equal(styleFeedback('别总反问').initiative,-1);
 const loaded=new ConversationMemory(dir,'synthetic-key');assert.equal(loaded.record(s).growth.scores.warmth,4);assert.ok(!fs.readFileSync(store.file,'utf8').includes('warmth'));
 assert.match(loaded.growthContext(s,config),/更温柔/);assert.equal(loaded.growthContext(s,{...config,growthEnabled:false}),'');
});
test('growth is isolated by owner/person/role/group; lock, reset and memory deletion cannot alter base persona',()=>{
 const store=new ConversationMemory(directory()),s=scope();store.commit(s,'说话活泼一点','好的',config);const base=config.persona;
 for(const other of [scope({...config,owner:'999999'}),scope({...config,persona:'不同角色'}),scope(config,{message_type:'private',user_id:888888}),scope(config,{message_type:'group',group_id:54321,user_id:123456})])assert.equal(store.record(other).growth,undefined);
 store.updateGrowth(s.id,config.owner,s.bot,s.role,{locked:true});store.commit(s,'请简短一点','好的',config);assert.equal(store.record(s).growth.scores.detail,0);assert.equal(store.record(s).growth.turns,1);
 assert.throws(()=>store.updateGrowth(s.id,'999999',s.bot,s.role,{reset:true}));
 store.updateGrowth(s.id,config.owner,s.bot,s.role,{reset:true});assert.equal(store.record(s).growth.turns,0);assert.equal(store.record(s).turns.length,2);assert.equal(config.persona,base);
 store.commit(s,'请温柔一点','好',config);store.end(s);assert.equal(store.record(s).growth.scores.warmth,1);store.forget(s.id,config.owner,s.bot);assert.equal(store.growthList(config.owner,s.bot,s.role).length,0);
});
test('model reflection requires repeated real user evidence, accepts dimensions only, and late results cannot resurrect reset growth',async()=>{
 const store=new ConversationMemory(directory()),s=scope(),c={...config,growthReflection:true};
 for(let i=0;i<12;i++)store.commit(s,(i<2?'我喜欢幽默，':'其他话题')+i,'助手自己说温柔不算证据',c);
 let calls=0;assert.equal(await store.reflectGrowth(s,c,async()=>{calls++;return JSON.stringify({adjustments:{playfulness:{direction:1,evidence:'我喜欢幽默'},warmth:{direction:1,evidence:'助手自己说温柔'},owner:{direction:1,evidence:'我喜欢幽默'}}});}),true);
 assert.equal(store.record(s).growth.scores.playfulness,1);assert.equal(store.record(s).growth.scores.warmth,0);assert.ok(!('owner' in store.record(s).growth.scores));
 assert.equal(await store.reflectGrowth(s,c,async()=>{calls++;return '{}';}),false);assert.equal(calls,1);
 for(let i=0;i<12;i++)store.commit(s,'继续聊'+i,'回复',c);
 let release;const pending=store.reflectGrowth(s,c,()=>new Promise(r=>release=r));store.updateGrowth(s.id,c.owner,s.bot,s.role,{reset:true});release('{"adjustments":{}}');assert.equal(await pending,false);assert.equal(store.record(s).growth.turns,0);
 const rejected=applyReflection({},'{"adjustments":{"warmth":{"direction":1,"evidence":"同一句"}}}',[{user:'同一句'},{user:'同一句'}]);assert.equal(rejected.scores.warmth,0);
});
test('reflection failures count against the interval; disabling growth makes no extra model call',async()=>{
 const store=new ConversationMemory(directory()),s=scope(),c={...config,growthReflection:true};for(let i=0;i<12;i++)store.commit(s,'普通聊天'+i,'回复',c);
 let calls=0;const fail=async()=>{calls++;throw new Error('offline');};await assert.rejects(()=>store.reflectGrowth(s,c,fail));
 assert.equal(await store.reflectGrowth(s,c,fail),false);assert.equal(calls,1);
 for(let i=0;i<12;i++)store.commit(s,'之后'+i,'回复',c);assert.equal(await store.reflectGrowth(s,{...c,growthEnabled:false},fail),false);assert.equal(calls,1);
});
