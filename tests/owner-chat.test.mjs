import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {OwnerChat,ownerChatPrompt,ownerChatText,ownerChatContext,ownerChatOptions} from '../assets/owner-chat.mjs';
import {evaluateOwnerChat,ownerChatEnding} from '../assets/owner-chat-score.mjs';
import {ConversationMemory,conversationScope} from '../assets/conversation-memory.mjs';
const root=path.resolve(import.meta.dirname,'../build/owner-chat-tests');fs.mkdirSync(root,{recursive:true});
const owner='123456',bot='654321',minute=60000,c={owner,enabled:true,proactiveEnabled:true,proactiveQuota:0};
function setup(){let now=Date.parse('2026-11-22T03:00:00Z');const dir=fs.mkdtempSync(path.join(root,'case-'));
 const store=new OwnerChat(dir,{now:()=>now,zone:'Asia/Shanghai'}),runtime={connected:true,hasKey:true,turns:Array.from({length:4},(_,i)=>({user:'我喜欢研究怎么做面条，今天又试了汤底',at:now-(4-i)*60*minute}))};
 return {store,dir,runtime,now:()=>now,advance:n=>now+=n*minute,observe:(text='你好',extra={})=>{store.observe({post_type:'message',message_type:'private',self_id:bot,user_id:owner,message:[{type:'text',data:{text}}],...extra},c,bot);if(!extra.user_id&&!extra.message_type)runtime.turns.push({user:text,at:now});}};
}
const part=(s,label)=>s.components.find(x=>x.label.startsWith(label))?.points;

test('local score uses time, category, distinct sessions and freshness; timer alone earns no unlimited points',()=>{
 const x=setup();x.observe();x.advance(46);const good=x.store.assessment(c,bot,x.runtime);assert.ok(good.eligible);assert.equal(good.category,'interest');assert.equal(part(good,'使用程度'),12);
 const burst={...x.runtime,turns:Array.from({length:100},(_,i)=>({user:'我喜欢做面条',at:x.now()-minute-i*1000}))};
 assert.equal(part(x.store.assessment(c,bot,burst),'使用程度'),0);
 const noon=evaluateOwnerChat({now:x.now(),clock:{minutes:720},...x.runtime,activity:x.now()-60*minute});
 const night=evaluateOwnerChat({now:x.now(),clock:{minutes:120},...x.runtime,activity:x.now()-60*minute});assert.equal(part(noon,'当前时段')-part(night,'当前时段'),42);assert.equal(part(noon,'周末时段'),3);
 const lookup={...x.runtime,turns:x.runtime.turns.map(t=>({...t,user:'帮我查询一下天气是什么'}))};assert.ok(x.store.assessment(c,bot,lookup).score<good.score);
 const trivial={...x.runtime,turns:[{user:'你好',at:x.now()-minute}]};assert.equal(x.store.assessment(c,bot,trivial).eligible,false);
 x.advance(5*24*60);assert.equal(x.store.assessment(c,bot,x.runtime).eligible,false);
});

test('low score does not reserve a model attempt and score reads have no delivery side effects',()=>{
 const x=setup();x.observe();x.advance(46);const low={...x.runtime,turns:[{user:'帮我查一下汇率是多少',at:x.now()-60*minute}]};
 for(let i=0;i<20;i++)assert.equal(x.store.due(c,bot,low),null);
 assert.equal(x.store.entry(owner,bot).attempts,0);assert.equal(x.store.entry(owner,bot).last,0);assert.equal(x.store.assessment(c,bot,low).ready,true);
 assert.equal(x.store.due({...c,proactiveThreshold:95},bot,x.runtime),null);assert.ok(x.store.due({...c,proactiveThreshold:45},bot,x.runtime));
});

test('only owner receives; switches, online, idle and startup buffer still apply',()=>{
 const x=setup();x.observe();assert.equal(x.store.due(c,bot,x.runtime),null);x.advance(46);assert.equal(x.store.due(c,bot,x.runtime).slot,'lunch');
 for(const cfg of [{...c,enabled:false},{...c,proactiveEnabled:false},{...c,owner:bot}])assert.equal(x.store.due(cfg,bot,x.runtime),null);
 for(const rt of [{...x.runtime,connected:false},{...x.runtime,hasKey:false},{...x.runtime,busy:true},{...x.runtime,previousReplyAt:x.now()-minute}])assert.equal(x.store.due(c,bot,rt),null);
 assert.equal(x.store.due({...c,owner:'987654'},bot,x.runtime),null);
});

test('unanswered contact is a decaying penalty, not a latch; sending again works across restart without an owner reply',()=>{
 const x=setup();x.observe();x.advance(46);let p=x.store.due(c,bot,x.runtime);x.store.reserve(p,c);x.store.sent(p,'想到你喜欢的那款游戏了。');
 x.advance(181);assert.equal(x.store.due(c,bot,x.runtime),null);assert.ok(part(x.store.assessment(c,bot,x.runtime),'未回复压力')<0);
 x.advance(240);const loaded=new OwnerChat(x.dir,{now:x.now,zone:'Asia/Shanghai'});x.advance(11);p=loaded.due(c,bot,x.runtime);assert.ok(p);assert.equal(p.unanswered,1);
 loaded.reserve(p,c);loaded.sent(p,'面条汤底试试加点菌菇怎么样。');assert.equal(loaded.entry(owner,bot).unanswered,2);
 assert.ok(!fs.readFileSync(loaded.file,'utf8').includes('面条'));x.advance(2);assert.equal(loaded.due(c,bot,x.runtime),null);
 x.observe('我回来了');assert.equal(x.store.entry(owner,bot).unanswered,0);
});

test('sleep, busy and farewell deduct points and recover with time or a return message',()=>{
 for(const [away,back,prefix] of [['晚安','我醒了','睡觉'],['我忙了','我忙完了','忙碌'],['先这样','我回来了','聊天结束']]){
  const x=setup();x.observe();x.advance(46);const before=x.store.assessment(c,bot,x.runtime);x.observe(away);x.advance(3);
  const after=x.store.assessment(c,bot,x.runtime);assert.ok(after.score<before.score);assert.ok(part(after,prefix)<0);assert.equal(after.eligible,false);
  x.advance(30);assert.ok(part(x.store.assessment(c,bot,x.runtime),prefix)>part(after,prefix));
  x.observe(back);x.advance(46);assert.equal(part(x.store.assessment(c,bot,x.runtime),prefix)||0,0);assert.ok(x.store.due(c,bot,x.runtime));
 }
 const nap=setup();nap.observe('我午睡一会');assert.equal(nap.store.entry(owner,bot).snoozeSpan,120*minute);
 for(const text of ['昨晚我说晚安太早了','别误会，我不是要说晚安','我没午睡，聊会儿','晚安这首歌很好听','我睡了个午觉，现在精神了'])assert.equal(ownerChatEnding(text),null);
 for(const text of ['睡觉了','那我先睡了，晚安','我去睡觉'])assert.equal(ownerChatEnding(text)?.reason,'sleep');
 const awake=setup();awake.observe('睡觉了');awake.advance(10);awake.observe('我想继续聊聊做面条');awake.advance(46);assert.equal(part(awake.store.assessment(c,bot,awake.runtime),'睡觉')||0,0);
});

test('manual do not disturb and configured quiet hours remain explicit user controls',()=>{
 const x=setup();x.observe('不要主动找我');x.advance(46);x.observe('我回来了');x.advance(46);assert.equal(x.store.due(c,bot,x.runtime),null);
 x.observe('可以主动找我了');x.advance(46);assert.ok(x.store.due(c,bot,x.runtime));
 assert.equal(x.store.due({...c,proactiveQuietStart:8,proactiveQuietEnd:15},bot,x.runtime),null);
 assert.equal(x.store.due({...c,proactiveQuietStart:8,proactiveQuietEnd:8},bot,x.runtime),null);
});

test('completed topics lose points and assistant assertions never increase topic usage',()=>{
 const x=setup();x.observe();x.advance(46);const before=x.store.assessment(c,bot,x.runtime);
 const done={...x.runtime,turns:[...x.runtime.turns,{user:'面条做完了，不用再问',assistant:'这肯定是你最喜欢的爱好',at:x.now()-minute}]};
 const after=x.store.assessment(c,bot,done);assert.equal(part(after,'话题已结束'),-28);assert.equal(after.eligible,false);
 const onlyAssistant={...x.runtime,turns:[{user:'你好',assistant:'我猜你喜欢游戏、音乐，想我了吧',at:x.now()-minute}]};assert.equal(x.store.assessment(c,bot,onlyAssistant).eligible,false);
 assert.ok(before.score>after.score);
});

test('changing owner, switches and new real messages invalidate pending drafts',()=>{
 const x=setup();x.observe();x.advance(46);const p=x.store.due(c,bot,x.runtime);x.store.reserve(p,c);assert.ok(x.store.current(p,c,bot));
 assert.equal(x.store.current(p,{...c,proactiveEnabled:false},bot),false);assert.equal(x.store.current(p,{...c,owner:'999999'},bot),false);
 x.observe('等一下');assert.equal(x.store.current(p,c,bot),false);
});

test('skip cooldown and finite daily delivery/attempt quotas are preserved',()=>{
 const x=setup(),cfg={...c,proactiveQuota:1};x.observe();x.advance(46);let p=x.store.due(cfg,bot,x.runtime);x.store.reserve(p,cfg);
 assert.equal(x.store.entry(owner,bot).count,0);x.advance(29);assert.equal(x.store.due(cfg,bot,x.runtime),null);x.advance(2);p=x.store.due(cfg,bot,x.runtime);assert.ok(p);x.store.reserve(p,cfg);
 x.advance(61);assert.equal(x.store.due(cfg,bot,x.runtime),null);
 const y=setup();y.observe();y.advance(46);p=y.store.due(cfg,bot,y.runtime);y.store.reserve(p,cfg);y.store.sent(p,'一条消息');y.advance(7*60);assert.equal(y.store.due(cfg,bot,y.runtime),null);
});

test('unlimited has no daily or meal cap; two-minute interval changes apply immediately',()=>{
 const x=setup(),slow={...c,proactiveInterval:180,proactiveIdle:2},fast={...slow,proactiveInterval:2};x.observe();x.advance(11);
 x.store.entry(owner,bot).attempts=100;let p=x.store.due(slow,bot,x.runtime);assert.ok(p);x.store.reserve(p,slow);x.advance(2);assert.ok(x.store.due(fast,bot,x.runtime));
 const r=x.store.entry(owner,bot);r.count=100;r.slots=['lunch'];assert.ok(x.store.due(fast,bot,x.runtime));
 assert.equal(ownerChatOptions({proactiveInterval:0,proactiveIdle:1,proactiveQuota:0}).interval,2*minute);assert.equal(ownerChatOptions({proactiveQuota:'0'}).quota,0);assert.equal(ownerChatOptions({}).threshold,60);
});

test('other users and groups cannot reset state; malformed persistent state retains existing stop behavior',()=>{
 const x=setup();x.observe('你好',{user_id:'999999'});x.observe('你好',{message_type:'group'});x.advance(46);assert.equal(x.store.due(c,bot,x.runtime),null);
 fs.writeFileSync(x.store.file,'broken');const loaded=new OwnerChat(x.dir,{now:x.now});assert.ok(loaded.problem);assert.equal(loaded.due(c,bot,x.runtime),null);
});

test('unknown send counts as contact and is not a retry; repeated texts are deduplicated',()=>{
 const x=setup();x.observe();x.advance(46);const p=x.store.due(c,bot,x.runtime);x.store.reserve(p,c);x.store.sent(p,'主人，午饭吃什么呀？',{uncertain:true});
 assert.equal(x.store.entry(owner,bot).unanswered,1);assert.equal(x.store.due(c,bot,x.runtime),null);
 const reload=new OwnerChat(x.dir,{now:x.now,zone:'Asia/Shanghai'});assert.ok(reload.duplicate(p,'主人，午饭吃什么呀？'));
 assert.equal(reload.duplicate(p,'晚饭想吃啥呢？'),false,'meal category alone must not ban a different meal');
 assert.equal(reload.duplicate(p,'刚才想到你聊的那个游戏，可以换个打法试试。'),false);
 x.advance(25*60);assert.equal(reload.duplicate(p,'午饭吃啥呀？'),false);
});

test('generated response format and dated context include selected evidence without fabricating new user messages',()=>{
 assert.equal(ownerChatText('{"skip":true}'),'');assert.equal(ownerChatText('非结构文字'),'');assert.equal(ownerChatText('{"text":"主人，好久不聊面条了。"}'),'主人，好久不聊面条了。');
 const at=Date.parse('2026-11-22T04:00:00Z'),plan={at,stamp:'12:00',slot:'lunch',label:'兴趣闲聊',unanswered:1,evidenceAt:at-2*24*60*minute};
 const history=[{role:'user',content:'我喜欢做面条',at:plan.evidenceAt},...Array.from({length:6},(_,i)=>({role:'user',content:'近期对话'+i,at:at-(6-i)*minute})),{role:'user',content:'过期计划',at:at-8*24*60*minute},{role:'user',content:'未来记录',at:at+minute}];
 const value=ownerChatContext(history,plan,{zone:'Asia/Shanghai',initiated:[{content:'面条做得怎么样',at:at-30*minute}]});
 assert.match(value,/2026-11-20 12:00 主人：我喜欢做面条/);assert.match(value,/助手主动/);assert.doesNotMatch(value,/过期计划|未来记录/);
 assert.match(ownerChatPrompt(plan),/不追问上一条/);assert.match(ownerChatPrompt(plan),/不能假定主人没吃饭/);
});

test('initiated memory is assistant-only and clearing memory leaves no topic to score',()=>{
 const x=setup(),scope=conversationScope(c,{message_type:'private',user_id:owner},bot),memory=new ConversationMemory(x.dir,'test-memory-key');
 memory.commit(scope,'我喜欢面条','记住啦',c);memory.commitInitiated(scope,'主人，今天午饭想吃面吗？',c);
 const restored=new ConversationMemory(x.dir,'test-memory-key');assert.equal(restored.history(scope,c).at(-1).role,'assistant');assert.equal(restored.record(scope).turns.length,1);
 assert.equal(restored.export(owner,bot).split('\n').length,1);assert.ok(!fs.readFileSync(restored.file,'utf8').includes('午饭'));
 restored.clearHistory(owner,bot);x.observe();x.advance(46);assert.equal(x.store.due(c,bot,{...x.runtime,turns:restored.record(scope).turns}),null);
});
