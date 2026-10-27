import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {GroupModeration,moderationCommand} from '../assets/group-moderation.mjs';
const root=path.resolve(import.meta.dirname,'../build/moderation-tests');fs.mkdirSync(root,{recursive:true});
const event={post_type:'message',message_type:'group',group_id:54321,self_id:765432,user_id:123456,message:[{type:'text',data:{text:'@deepseek 拉黑 '}},{type:'at',data:{qq:'888888'}}]};
test('only the real owner may manage one other group member; all/self/owner targets rejected',()=>{
 assert.deepEqual(moderationCommand(event,'123456'),{action:'block',target:'888888'});assert.equal(moderationCommand({...event,user_id:888888},'123456'),null);
 assert.equal(moderationCommand({...event,message_type:'private'},'123456'),null);
 for(const qq of ['all','123456','765432'])assert.equal(moderationCommand({...event,message:[event.message[0],{type:'at',data:{qq}}]},'123456').action,'invalid');
 assert.equal(moderationCommand({...event,message:[{type:'text',data:{text:'解除拉黑 888888'}}]},'123456').action,'unblock');
 assert.equal(moderationCommand({...event,message:[{type:'text',data:{text:'拉黑列表'}}]},'123456').action,'list');
 assert.equal(moderationCommand({...event,message:[{type:'text',data:{text:'他说“拉黑888888”'}}]},'123456'),null);
});
test('group ignore survives restart and isolates owners, bots, groups; unblocking does not force reply',()=>{
 const dir=fs.mkdtempSync(path.join(root,'case-')),store=new GroupModeration(dir);store.change('123456','765432','54321','888888',true);
 const blocked={...event,user_id:888888};assert.equal(store.blocked(blocked,'123456','765432'),true);
 assert.equal(new GroupModeration(dir).blocked(blocked,'123456','765432'),true);
 assert.equal(store.blocked({...blocked,group_id:54322},'123456','765432'),false);assert.equal(store.blocked({...blocked,message_type:'private'},'123456','765432'),false);
 assert.equal(store.blocked(blocked,'123457','765432'),false);assert.equal(store.blocked(blocked,'123456','765433'),false);
 assert.throws(()=>store.change('123456','765432','54321','123456',true));store.change('123456','765432','54321','888888',false);assert.equal(store.blocked(blocked,'123456','765432'),false);
});
