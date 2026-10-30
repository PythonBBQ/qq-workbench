import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {CodexJobs,assistantMention,codexText} from '../assets/codex-jobs.mjs';
const worker='1234567890abcdef1234567890abcdef',owner='123456',bot='654321';
function fixture(t){const base=path.resolve(import.meta.dirname,'../build/codex-tests');fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(path.join(base,'case-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new CodexJobs(dir);return {dir,store};}
const input=(id='one')=>({id,event:{user_id:owner,self_id:bot,message_type:'private'},prompt:'请完成任务',context:'背景',scope:{id:'test'}});
test('mentions support Chinese adjacency, first explicit addressee, and reject emails and lookalikes',()=>{
 assert.equal(assistantMention('@CoDeX优化')[1].toLowerCase(),'codex');assert.equal(codexText('@codex做任务'),'做任务');
 for(const s of ['hello@codex.com','@codexx','x@codex','@@codex'])assert.equal(assistantMention(s),null);
 assert.equal(assistantMention('@deepseek 解释 @codex')[1],'deepseek');
});
test('offline and non-owner requests never become tasks; duplicate events run once',t=>{
 const {store}=fixture(t);assert.throws(()=>store.enqueue(input(),owner,bot),/未连接/);store.heartbeat(worker);
 assert.throws(()=>store.enqueue({...input(),event:{...input().event,user_id:'999999'}},owner,bot),/只有/);
 store.enqueue(input(),owner,bot);store.enqueue(input(),owner,bot);assert.equal(store.jobs.length,1);
 const job=store.claim(worker,owner,bot);assert.equal(job.prompt,'请完成任务');assert.equal(store.claim(worker,owner,bot),null);
 assert.throws(()=>store.complete({id:job.id,lease:'wrong',status:'completed',text:'结果'},owner,bot));
 const result={id:job.id,lease:job.lease,status:'completed',text:'真实结果',usage:{prompt_tokens:100,completion_tokens:10}};
 assert.equal(store.complete(result,owner,bot).recorded,true);assert.equal(store.complete(result,owner,bot).recorded,undefined);
 store.delivery(job.id,'delivering');store.delivery(job.id,'accepted');assert.equal(store.ready(owner,bot).length,0);
});
test('owner changes, expired queued tasks and restarts cannot replay tasks or uncertain sends',t=>{
 const {store,dir}=fixture(t);store.heartbeat(worker);const now=Date.now();store.enqueue(input(),owner,bot,now-900001);assert.equal(store.claim(worker,owner,bot),null);
 store.enqueue(input('two'),owner,bot);const job=store.claim(worker,owner,bot);const reloaded=new CodexJobs(dir);assert.equal(reloaded.jobs.find(j=>j.id===job.id).status,'interrupted');assert.equal(reloaded.claim(worker,owner,bot),null);
 store.complete({id:job.id,lease:job.lease,status:'blocked',text:'需要信息'},owner,bot);store.delivery(job.id,'delivering');assert.equal(new CodexJobs(dir).jobs.find(j=>j.id===job.id).status,'uncertain');
 store.enqueue(input('three'),owner,bot);store.reconcile('999999',bot);assert.equal(store.jobs.at(-1).status,'cancelled');
 assert.throws(()=>store.complete({id:job.id,lease:job.lease,status:'completed',text:'旧结果'},'999999',bot));
});
