import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {evaluateOwnerChat} from '../assets/owner-chat-score.mjs';
import {OwnerChat,ownerChatClock} from '../assets/owner-chat.mjs';
const minute=60000,now=Date.parse('2026-11-23T15:00:00Z');
const part=(s,label)=>s.components.find(c=>c.label.startsWith(label))?.points;
const evaluate=(turns,extra={})=>evaluateOwnerChat({now,clock:ownerChatClock(now,'UTC'),activity:now-90*minute,interval:2*minute,turns,...extra});
const turn=(user,age=90)=>({user,at:now-age*minute});
function store(){let at=now;const parent=path.resolve(import.meta.dirname,'../build/owner-chat-tests');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'correction-'));return {dir,chat:new OwnerChat(dir,{now:()=>at,zone:'UTC'}),advance:n=>at+=n*minute};}
const c={owner:'123456',enabled:true,proactiveEnabled:true,proactiveInterval:2,proactiveIdle:2,proactiveQuota:0},bot='654321';

test('one meaningful daytime interest or daily topic can reach the default threshold, without timer-only or query messages doing so',()=>{
  for(const text of ['我喜欢玩原神游戏','我今天下班去散步']){
    const score=evaluate([turn(text)]);assert.ok(score.eligible,`${text}: ${score.score}`);assert.equal(score.threshold,60);
  }
  assert.equal(evaluate([turn('帮我查一下今天汇率')]).eligible,false);
  assert.equal(evaluate([]).eligible,false);
});

test('short meaningful Chinese messages count as evidence while greetings and acknowledgements do not',()=>{
  for(const text of ['想你了','喜欢游戏','在做饭'])assert.equal(evaluate([turn(text)]).candidates.length,1,text);
  for(const text of ['你好','嗯','好的','收到','谢谢'])assert.equal(evaluate([turn(text)]).candidates.length,0,text);
  assert.equal(evaluate([turn('我喜欢电影“流浪地球”')]).candidates.length,1);
  assert.equal(evaluate([turn('他说：我喜欢电影“流浪地球”')]).candidates.length,0);
  assert.equal(evaluate([turn('睡觉了',120),turn('想你了',60)]).components.find(c=>c.label.endsWith('结束语')).points,0);
});

test('same topic identity survives elaboration so exact-topic repetition remains measurable',()=>{
  const first=turn('我喜欢玩原神游戏',180),initial=evaluate([first]);
  const later=evaluate([first,turn('原神的地图最近解锁了一个新区域')],{state:{recent:[{at:now-30*minute,category:initial.category,topicKey:initial.topicKey}]}});
  assert.equal(later.candidates.length,1);assert.equal(later.topicKey,initial.topicKey);
  assert.ok(part(later,'近期相同话题')<0);
});

test('pending plan keeps its original appointment time after a follow-up without a time expression',()=>{
  const s=evaluate([turn('今天下午三点去面试',180),turn('面试的材料我还在准备',90)]);
  assert.equal(s.candidates.length,1);assert.equal(part(s,'安排时间相关性'),12);
});

test('no-response and recent-contact points do not count the same contact twice',()=>{
  const s=evaluate([turn('我喜欢玩原神游戏')],{state:{last:now-30*minute,unanswered:1}});
  assert.ok(part(s,'未回复压力')<0);assert.equal(part(s,'刚联系过'),0);
});

test('meal themes are not a hidden daily ban; real duplicate text still expires after 24 hours',()=>{
  const x=store(),plan={owner:c.owner,bot,interval:2*minute,category:'daily',slot:'lunch'};
  x.chat.sent(plan,'主人，午饭想吃什么呀？');x.advance(4*60);
  assert.equal(x.chat.duplicate(plan,'晚饭想吃啥呢？'),false);
  assert.equal(x.chat.duplicate(plan,'主人，午饭想吃什么呀？'),true);
  x.advance(21*60);assert.equal(x.chat.duplicate(plan,'主人，午饭想吃什么呀？'),false);
});

test('score inspection exposes the actual draft outcome and cooldown rather than only a passing score',()=>{
  const x=store(),runtime={connected:true,hasKey:true,turns:[turn('我喜欢玩原神游戏')],previousUserAt:now-90*minute};
  x.advance(11);const plan=x.chat.due(c,bot,runtime);assert.ok(plan);x.chat.reserve(plan,c);
  assert.equal(typeof x.chat.finish,'function');x.chat.finish(plan,'model_skip');
  const result=x.chat.assessment(c,bot,runtime);assert.equal(result.shouldGenerate,false);assert.equal(result.lastDecision.status,'model_skip');
  assert.match(result.reason,/模型.*跳过/);assert.ok(result.earliestCheckAt>result.at);
  const loaded=new OwnerChat(x.dir,{now:()=>result.at,zone:'UTC'});
  assert.equal(loaded.assessment(c,bot,runtime).lastDecision.status,'model_skip');
  assert.doesNotMatch(fs.readFileSync(x.chat.file,'utf8'),/原神/);
});

test('changing score preferences invalidates an in-flight draft made with the former policy',()=>{
  const x=store(),runtime={connected:true,hasKey:true,turns:[turn('我喜欢玩原神游戏')],previousUserAt:now-90*minute};
  x.advance(11);const plan=x.chat.due(c,bot,runtime);assert.ok(plan);
  assert.equal(x.chat.current(plan,c,bot),true);
  assert.equal(x.chat.current(plan,{...c,proactiveThreshold:95},bot),false);
  assert.equal(x.chat.current(plan,{...c,proactiveWeights:{interest:-15}},bot),false);
});
