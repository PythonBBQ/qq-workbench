import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {GroupModeration,moderationCommand,PrivateFriends} from '../assets/group-moderation.mjs';
const root=path.resolve(import.meta.dirname,'../build/moderation-tests');fs.mkdirSync(root,{recursive:true});
const event={post_type:'message',message_type:'group',group_id:54321,self_id:765432,user_id:123456,message:[{type:'text',data:{text:'@deepseek 拉黑 '}},{type:'at',data:{qq:'888888'}}]};
test('only the real owner may manage one other group member; all/self/owner targets rejected',()=>{
 assert.deepEqual(moderationCommand(event,'123456'),{action:'block',target:'888888'});assert.equal(moderationCommand({...event,user_id:888888},'123456'),null);
 assert.equal(moderationCommand({...event,message_type:'private'},'123456').action,'block');
 for(const qq of ['all','123456','765432'])assert.equal(moderationCommand({...event,message:[event.message[0],{type:'at',data:{qq}}]},'123456').action,'invalid');
 assert.equal(moderationCommand({...event,message:[{type:'text',data:{text:'解除拉黑 888888'}}]},'123456').action,'unblock');
 assert.equal(moderationCommand({...event,message:[{type:'text',data:{text:'拉黑列表'}}]},'123456').action,'list');
 assert.equal(moderationCommand({...event,message:[{type:'text',data:{text:'他说“拉黑888888”'}}]},'123456'),null);
});

test('private ignore persists independently of groups and follows the current owner and bot',()=>{
 const dir=fs.mkdtempSync(path.join(root,'private-')),store=new GroupModeration(dir),pm={...event,message_type:'private',user_id:888888};
 store.change('123456','765432','private','888888',true);
 assert.equal(new GroupModeration(dir).blocked(pm,'123456','765432'),true);
 assert.equal(store.blocked({...pm,message_type:'group'},'123456','765432'),false);
 assert.equal(store.blocked(pm,'123457','765432'),false);assert.equal(store.blocked(pm,'123456','765433'),false);
 store.change('123456','765432','private','888888',false);assert.equal(store.blocked(pm,'123456','765432'),false);
});

test('private admission uses confirmed friend list, coalesces calls, refreshes deletes, and fails closed',async()=>{
 let now=0,calls=0,reply={status:'ok',retcode:0,data:[{user_id:888888}]};
 const friends=new PrivateFriends(async action=>{assert.equal(action,'get_friend_list');calls++;return reply;},()=>now),pm={...event,message_type:'private',user_id:888888};
 assert.deepEqual(await Promise.all([friends.allowed(pm,'765432'),friends.allowed(pm,'765432')]),[true,true]);assert.equal(calls,1);
 assert.equal(await friends.allowed({...pm,user_id:777777,sub_type:'friend'},'765432'),false);
 reply={status:'ok',retcode:0,data:[]};assert.equal(await friends.allowed(pm,'765432',true),false);
 for(const bad of [{status:'failed',retcode:1,data:[{user_id:888888}]},{status:'ok',retcode:0,data:{}},{status:'ok',retcode:0,data:[{}]}]){reply=bad;now+=16000;assert.equal(await friends.allowed(pm,'765432'),false);}
 reply={status:'ok',retcode:0,data:[{user_id:888888}]};now+=16000;assert.equal(await friends.allowed(pm,'765432'),true);
 friends.reset();assert.equal(friends.cached(pm,'765432'),false);assert.equal(await friends.allowed(event,'765432'),true);
});

test('an obsolete in-flight friend response cannot authorize a different account or reset connection',async()=>{
 let resolve;const friends=new PrivateFriends(()=>new Promise(r=>resolve=r)),pm={...event,message_type:'private',user_id:888888};
 const pending=friends.allowed(pm,'765432');friends.reset();resolve({status:'ok',retcode:0,data:[{user_id:888888}]});assert.equal(await pending,false);
});
test('group ignore survives restart and isolates owners, bots, groups; unblocking does not force reply',()=>{
 const dir=fs.mkdtempSync(path.join(root,'case-')),store=new GroupModeration(dir);store.change('123456','765432','54321','888888',true);
 const blocked={...event,user_id:888888};assert.equal(store.blocked(blocked,'123456','765432'),true);
 assert.equal(new GroupModeration(dir).blocked(blocked,'123456','765432'),true);
 assert.equal(store.blocked({...blocked,group_id:54322},'123456','765432'),false);assert.equal(store.blocked({...blocked,message_type:'private'},'123456','765432'),false);
 assert.equal(store.blocked(blocked,'123457','765432'),false);assert.equal(store.blocked(blocked,'123456','765433'),false);
 assert.throws(()=>store.change('123456','765432','54321','123456',true));store.change('123456','765432','54321','888888',false);assert.equal(store.blocked(blocked,'123456','765432'),false);
});
