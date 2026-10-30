import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const terminal=new Set(['accepted','uncertain','cancelled','interrupted']);
const same=(job,owner,bot)=>job.owner===String(owner)&&job.bot===String(bot);
export function assistantMention(text){return /(?<![a-z0-9_@])@(codex|deepseek)(?![a-z0-9_])/i.exec(String(text));}
export function codexText(text){return String(text||'').replace(/(?<![a-z0-9_@])@(codex|deepseek)(?![a-z0-9_])/ig,'').trim();}
export class CodexJobs{
  constructor(directory){
    this.file=path.join(directory,'codex-jobs.json');this.jobs=[];this.worker='';this.seen=0;this.problem='';
    try{const data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(data.version!==1||!Array.isArray(data.jobs))throw new Error();this.jobs=data.jobs;
      for(const job of this.jobs){if(job.status==='running')job.status='interrupted';if(job.status==='delivering')job.status='uncertain';}
      this.save();
    }catch(e){if(e.code!=='ENOENT')this.problem='Codex任务记录不可读，请检查诊断；原文件保留';}
  }
  save(){if(this.problem)throw new Error(this.problem);fs.writeFileSync(this.file+'.next',JSON.stringify({version:1,jobs:this.jobs}),{mode:0o600});fs.renameSync(this.file+'.next',this.file);}
  online(now=Date.now()){return !!this.worker&&now-this.seen<20000;}
  heartbeat(worker,now=Date.now()){
    if(!/^[a-f0-9-]{16,64}$/.test(worker))throw new Error('Invalid worker');
    if(this.online(now)&&this.worker!==worker)throw new Error('另一电脑执行端正在连接');
    if(this.worker!==worker){let changed=false;for(const job of this.jobs)if(job.status==='running'&&job.worker!==worker){job.status='interrupted';changed=true;}if(changed)this.save();}
    this.worker=worker;this.seen=now;
  }
  state(){return {online:this.online(),pending:this.jobs.filter(j=>!terminal.has(j.status)).length,problem:this.problem};}
  enqueue({id,event,prompt,context,scope},owner,bot,now=Date.now()){
    if(String(event.user_id)!==String(owner)||String(event.self_id)!==String(bot))throw new Error('只有当前主人可以派发任务');
    const previous=this.jobs.find(j=>j.id===id);if(previous)return previous;
    if(this.problem)throw new Error(this.problem);
    if(!this.online(now))throw new Error('电脑 Codex 执行端未连接，这次任务没有开始。请保持电脑及设备连接，连接后重新发送 @codex。');
    if(!prompt.trim())throw new Error('请在 @codex 后写下任务。');
    if(this.jobs.filter(j=>!terminal.has(j.status)).length>=20)throw new Error('Codex排队已满，请等当前任务完成');
    this.jobs=this.jobs.filter(j=>!terminal.has(j.status)||now-j.created<7*86400000).slice(-79);
    const job={id,owner:String(owner),bot:String(bot),event:{user_id:event.user_id,self_id:event.self_id,message_type:event.message_type,group_id:event.group_id},scope,prompt:prompt.slice(0,6000),context:String(context||'').slice(-4000),created:now,status:'queued'};
    this.jobs.push(job);this.save();return job;
  }
  reconcile(owner,bot,now=Date.now()){
    let changed=false;for(const j of this.jobs)if(!terminal.has(j.status)&&(!same(j,owner,bot)||j.status==='queued'&&now-j.created>900000)){
      j.status='cancelled';changed=true;
    }if(changed)this.save();
  }
  claim(worker,owner,bot){
    this.heartbeat(worker);this.reconcile(owner,bot);
    // A running task is never reclaimed automatically, including worker restarts.
    if(this.jobs.some(j=>j.status==='running'))return null;
    const job=this.jobs.find(j=>j.status==='queued'&&same(j,owner,bot));if(!job)return null;
    job.status='running';job.lease=crypto.randomBytes(24).toString('hex');job.worker=worker;job.started=Date.now();this.save();return {...job};
  }
  complete({id,lease,status,text,usage},owner,bot){
    const job=this.jobs.find(j=>j.id===id);
    if(!job||!same(job,owner,bot)||typeof lease!=='string'||lease!==job.lease)throw new Error('任务身份已变化，结果未投递');
    if(job.status!=='running')return {status:job.status};
    if(!['completed','blocked','failed'].includes(status)||typeof text!=='string'||!text.trim()||text.length>12000)throw new Error('Invalid task result');
    const counts={};for(const key of ['prompt_tokens','completion_tokens','prompt_cache_hit_tokens'])if(Number.isSafeInteger(usage?.[key])&&usage[key]>=0)counts[key]=usage[key];
    job.result={status,text:text.slice(0,6000),usage:counts};job.status='completed';job.finished=Date.now();this.save();return {status:job.status,recorded:true};
  }
  ready(owner,bot){this.reconcile(owner,bot);return this.jobs.filter(j=>j.status==='completed'&&same(j,owner,bot));}
  delivery(id,status){const j=this.jobs.find(j=>j.id===id);if(!j)return;
    if(status==='delivering'&&j.status!=='completed')throw new Error('结果不可重复投递');
    j.status=status;this.save();
  }
}
