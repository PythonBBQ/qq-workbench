import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {evaluateOwnerChat,ownerChatTiming} from '../assets/owner-chat-score.mjs';
import {OwnerChat,ownerChatClock,ownerChatContext,ownerChatPrompt} from '../assets/owner-chat.mjs';
const minute=60000,day=1440*minute,now=Date.parse('2026-11-22T12:00:00Z');
const score=(turns,extra={})=>evaluateOwnerChat({now,clock:ownerChatClock(now,'UTC'),activity:now-60*minute,turns,...extra});
const points=(candidate,prefix)=>candidate.components.find(c=>c.label.startsWith(prefix))?.points;
const turn=(user,age=60)=>({user,at:now-age*minute});

test('finishing noodles does not close a separate game topic or suppress its score',()=>{
  const result=score([turn('我喜欢做面条，研究汤底',240),turn('我喜欢原神游戏，研究地图',180),turn('面条做完了，不用再问',60)]);
  const noodles=result.candidates.find(c=>c.topic.includes('面条')),game=result.candidates.find(c=>c.topic.includes('原神'));
  assert.equal(noodles.status,'completed');assert.equal(points(noodles,'话题已结束'),-28);
  assert.equal(game.status,'open');assert.equal(points(game,'话题已结束'),0);assert.equal(result.topic,game.topic);
  const declined=score([turn('我喜欢游戏',180),turn('我不喜欢游戏了，不想聊',60)]);
  assert.equal(points(declined,'明确不想聊'),-80);assert.equal(declined.eligible,false);
  const unrelated=score([turn('我喜欢玩原神游戏',180),turn('工作搞定了',60)]);
  assert.equal(unrelated.candidates.find(c=>c.topic.includes('原神')).status,'open');
});

test('a shorthand completion attaches to its current topic and negated completion remains open',()=>{
  const done=score([turn('我准备做面条，想试试新汤底',75),turn('已经做完了，不用再问',60)]);
  assert.equal(done.candidates.length,1);assert.equal(done.status,'completed');
  const resumed=score([turn('我准备做面条，想试试新汤底',180),turn('我喜欢玩原神游戏',150),turn('面条汤底我还在熬',90),turn('这个已经做完了，不用再问',60)]);
  assert.equal(resumed.candidates.find(c=>c.topic.includes('这个')).status,'completed');
  assert.equal(resumed.candidates.find(c=>c.topic.includes('原神')).status,'open');
  const pending=score([turn('面条还没做完呢，汤底正在熬',60)]);
  assert.equal(pending.status,'open');assert.equal(points(pending,'未完话题'),8);
  const personal=score([turn('我最近心情很难过',75),turn('我现在好多了，心情好多了',60)]);
  assert.equal(personal.status,'completed');
});

test('topic usage follows category sessions but candidate content stays on the selected concrete topic',()=>{
  const result=score([turn('我喜欢做面条',240),turn('我喜欢玩原神游戏',180),turn('原神这个游戏的地图挺有意思',60)]);
  assert.equal(result.candidates.length,2);
  for(const candidate of result.candidates)assert.equal(points(candidate,'使用程度'),8);
  assert.equal(result.evidenceAts.length,2);
  const context=ownerChatContext([
    {role:'user',content:'我喜欢玩原神游戏',at:now-180*minute},
    {role:'user',content:'原神这个游戏的地图挺有意思',at:now-60*minute}
  ],result);
  assert.match(context,/原神/);assert.match(ownerChatPrompt(result),/本地评估通过的话题类型/);
});

test('frequent chat hours learn from at least three local days, not rapid repeated messages',()=>{
  const habits=[1,2,3,4].map(n=>({user:'我喜欢玩原神游戏',at:now-n*day}));
  const near=score(habits),far=evaluateOwnerChat({now:now+8*60*minute,clock:ownerChatClock(now+8*60*minute,'UTC'),turns:habits,activity:now-day});
  assert.equal(near.habit.learned,true);assert.equal(points(near,'常聊时段'),8);assert.equal(points(far,'常聊时段'),-3);
  const burst=score(Array.from({length:40},(_,i)=>turn('我喜欢玩原神游戏',60+i/60)));
  assert.equal(burst.habit.learned,false);assert.equal(points(burst,'常聊时段'),0);assert.equal(points(burst,'使用程度'),0);
  assert.equal(score(habits.map(t=>({...t,partial:true}))).candidates.length,0);
  const zoneNow=Date.parse('2026-11-22T16:30:00Z'),zoned=evaluateOwnerChat({now:zoneNow,clock:ownerChatClock(zoneNow,'Asia/Tokyo'),activity:zoneNow-day,turns:[1,2,3,4].map(n=>({user:'我喜欢玩原神游戏',at:zoneNow-n*day}))});
  assert.equal(zoned.stamp,'2026-11-23 01:30');assert.equal(zoned.habit.learned,true);assert.equal(points(zoned,'周末时段'),0);
});

test('plans refer to their original local day and explicit hour, never a moving tomorrow',()=>{
  const recorded=Date.parse('2026-11-21T12:00:00Z');
  assert.equal(ownerChatTiming('我明天下午三点半去面试',recorded).at,Date.parse('2026-11-22T15:30:00Z'));
  assert.equal(ownerChatTiming('下周一上午九点面试',recorded).at,Date.parse('2026-11-23T09:00:00Z'));
  assert.equal(ownerChatTiming('周日晚上8点开会',recorded).at,Date.parse('2026-11-22T20:00:00Z'));
  assert.equal(ownerChatTiming('我明早九点面试',recorded,9*60*minute).at,Date.parse('2026-11-22T00:00:00Z'));
  assert.equal(ownerChatTiming('等会想做面条',recorded),null);
  assert.equal(ownerChatTiming('今天晚上十二点看电影',recorded).at,Date.parse('2026-11-22T00:00:00Z'));
  assert.equal(ownerChatTiming('明天凌晨十二点出发',recorded).at,Date.parse('2026-11-22T00:00:00Z'));
  assert.equal(ownerChatTiming('明天25点去面试',recorded),null);
  const plans=[{user:'明天下午一点去面试',at:recorded}],near=score(plans);
  assert.equal(points(near,'安排时间相关性'),12);
  const later=evaluateOwnerChat({now:now+day,clock:ownerChatClock(now+day,'UTC'),activity:recorded,turns:plans});
  assert.equal(points(later,'安排时间相关性'),-18);
  assert.match(near.recommendation,/不把计划当成已经发生/);
});

test('category preference adjustments are explicit and cannot alter replies or generate on inspection',()=>{
  const history=[turn('我喜欢做面条',60)],base=score(history),higher=score(history,{weights:{interest:15}}),lower=score(history,{weights:{interest:-15}});
  assert.equal(higher.score-base.score,15);assert.equal(base.score-lower.score,15);
  assert.equal(score(history,{weights:{interest:100}}).score,higher.score);
  assert.equal(higher.policy.categories.find(c=>c.id==='interest').points,24);
  assert.equal(higher.policy.timeBands.reduce((sum,b)=>sum+b.to-b.from,0),24);
});

test('response history gives small smoothed points, while recent pending messages are not marked ignored early',()=>{
  const history=[turn('我喜欢做面条',60)],feedback=Array.from({length:4},(_,i)=>({category:'interest',at:now-(i+1)*day,repliedAt:now-(i+1)*day+10*minute,quality:1}));
  assert.ok(points(score(history,{state:{feedback}}),'此类主动反馈')>0);
  const ignored=feedback.map(f=>({...f,repliedAt:0,quality:0}));assert.ok(points(score(history,{state:{feedback:ignored}}),'此类主动反馈')<0);
  const pending=[{category:'interest',at:now-10*minute,repliedAt:0,quality:0}];assert.equal(points(score(history,{state:{feedback:pending}}),'此类主动反馈'),0);
  assert.equal(points(score(history,{state:{feedback:feedback.map(f=>({...f,category:'help'}))}}),'此类主动反馈'),0);
  assert.ok(Math.abs(points(score(history,{state:{feedback:ignored}}),'此类主动反馈'))<=8);
});

test('actual owner reply credits only the latest confirmed contact, with persistent metadata and no plaintext',()=>{
  const parent=path.resolve(import.meta.dirname,'../build/owner-chat-tests');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'feedback-'));
  let at=now;const store=new OwnerChat(dir,{now:()=>at,zone:'UTC'}),c={owner:'123456',enabled:true,proactiveEnabled:true},bot='654321',plan={owner:c.owner,bot,category:'interest',topicKey:'a'.repeat(24),interval:2*minute,slot:'followup'};
  store.sent(plan,'面条汤底想起了一个新做法');at+=10*minute;
  store.observe({post_type:'message',message_type:'private',user_id:c.owner,self_id:bot,message:[{type:'text',data:{text:'好主意，我准备明天试试看'}}]},c,bot);
  assert.equal(store.entry(c.owner,bot).feedback[0].quality,1);
  const loaded=new OwnerChat(dir,{now:()=>at,zone:'UTC'});assert.equal(loaded.entry(c.owner,bot).feedback[0].repliedAt,at);assert.equal(loaded.entry(c.owner,bot).recent[0].topicKey,plan.topicKey);
  assert.doesNotMatch(fs.readFileSync(store.file,'utf8'),/面条|明天|做法/);
  at+=10*minute;store.sent(plan,'另一条新想法');at+=10*minute;store.sent(plan,'发送不确定',{uncertain:true});at+=minute;
  store.observe({post_type:'message',message_type:'private',user_id:c.owner,self_id:bot,message:[{type:'text',data:{text:'刚才我在忙着处理事情'}}]},c,bot);
  assert.equal(store.entry(c.owner,bot).feedback[1].repliedAt,0,'an uncertain latest send cannot attribute a reply to an older contact');
});
