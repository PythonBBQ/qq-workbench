import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide,adminCommand} from '../assets/assistant.mjs';
const config={owner:'123456',enabled:true,others:true,rate:100,ambientEnabled:true,interests:'白饭，游戏',ambientCooldown:90};
const event=(text,extra={})=>({post_type:'message',message_type:'group',self_id:765432,user_id:999999,group_id:42,message:[{type:'text',data:{text}}],...extra});
test('interest replies require relevant topics and do not create an unsolicited continuous session',()=>{
  const sessions=new Map(),activity=new Map();
  assert.equal(decide(event('最近这个游戏不错'),config,sessions,100000,()=>0,activity),'ambient');
  assert.equal(sessions.size,0);assert.equal(decide(event('顺便问一下？'),config,sessions,100001,()=>0,activity),'ignore');
  assert.equal(decide(event('游戏好玩'),config,sessions,100002,()=>0,activity),'ignore');
  assert.equal(decide(event('白饭要配什么'),config,sessions,191000,()=>0,activity),'ambient');
});
test('passive cooldown is shared within a group, isolated across groups, and owner mention bypasses it',()=>{
  const activity=new Map(),sessions=new Map();
  decide(event('游戏'),config,sessions,1000,()=>0,activity);
  assert.equal(decide(event('白饭',{user_id:777777}),config,sessions,1001,()=>0,activity),'ignore');
  assert.equal(decide(event('白饭',{group_id:43}),config,sessions,1001,()=>0,activity),'ambient');
  assert.equal(decide(event('@deepseek 白饭',{user_id:123456}),{...config,rate:0},sessions,1001,()=>.99,activity),'reply');
});
test('interest replies respect switches, allowed senders, participation and messages directed elsewhere',()=>{
  for(const c of [{...config,ambientEnabled:false},{...config,others:false},{...config,enabled:false},{...config,rate:0}])assert.equal(decide(event('游戏'),c,new Map(),1000,()=>0),'ignore');
  const e=event('游戏');e.message.push({type:'at',data:{qq:'888888'}});assert.equal(decide(e,config,new Map(),1000,()=>0),'ignore');
});
test('only owner invokes management commands, even with other-user chat enabled',()=>{
  for(const command of ['#sl','#SL','#sl config','#nc','#napcat','#status','#config','#restart','/stop']){
    assert.equal(adminCommand(event(command)),true);
    assert.equal(decide(event(command),config,new Map()),'ignore');
    assert.equal(decide(event(command,{user_id:123456}),{...config,enabled:false},new Map()),'admin');
  }
  assert.equal(adminCommand(event('聊聊 #sl 是什么意思')),false);
  assert.equal(adminCommand(event('#slogan')),false);
  assert.equal(decide(event('@codex 做任务',{message_type:'private'}),config,new Map()),'ignore');
});
