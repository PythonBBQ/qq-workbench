import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const valid=value=>/^[1-9][0-9]{4,11}$/.test(String(value));
export function moderationCommand(event,owner){
 if(!['group','private'].includes(event.message_type)||String(event.user_id)!==String(owner))return null;
 const segments=Array.isArray(event.message)?event.message:[],ats=segments.filter(s=>s.type==='at').map(s=>String(s.data?.qq));
 let text=(segments.length?segments.filter(s=>s.type==='text').map(s=>s.data?.text||'').join(''):String(event.raw_message||'')).replace(/^\s*@deepseek\b\s*/i,'').trim();
 if(/^(?:查看)?拉黑列表[。！!\s]*$/.test(text))return {action:'list'};
 const m=text.match(/^(解除拉黑|取消拉黑|拉黑)(?:\s*([1-9][0-9]{4,11}))?[。！!\s]*$/);if(!m)return null;
 const targets=[...new Set([...ats.filter(id=>id!==String(event.self_id)),...(m[2]?[m[2]]:[])])];
 if(targets.length!==1||!valid(targets[0])||targets[0]===String(owner)||targets[0]===String(event.self_id))return {action:'invalid'};
 return {action:m[1]==='拉黑'?'block':'unblock',target:targets[0]};
}
export class GroupModeration{
 constructor(directory){this.file=path.join(directory,'group-ignore.json');this.rows={};this.problem='';
  try{if(fs.statSync(this.file).size>256000)throw new Error();const data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(data.version!==1||!data.rows||Array.isArray(data.rows))throw new Error();
   for(const [k,v] of Object.entries(data.rows).slice(-200)){if(!/^[a-f0-9]{32}$/.test(k)||!valid(v.owner)||!valid(v.bot)||!(valid(v.group)||v.group==='private')||!Array.isArray(v.users))throw new Error();this.rows[k]={owner:String(v.owner),bot:String(v.bot),group:String(v.group),users:[...new Set(v.users.map(String).filter(valid))].slice(0,100)};}
  }catch(e){if(e.code!=='ENOENT')this.problem='群聊拉黑记录不可读，自动回复暂停，请在本机检查原文件';}
 }
 key(owner,bot,group){return crypto.createHash('sha256').update(JSON.stringify([String(owner),String(bot),String(group)])).digest('hex').slice(0,32);}
 blocked(event,owner,bot){if(!['group','private'].includes(event.message_type)||String(event.user_id)===String(owner))return false;if(this.problem)return true;return (this.rows[this.key(owner,bot,event.message_type==='private'?'private':event.group_id)]?.users||[]).includes(String(event.user_id));}
 list(owner,bot){return Object.values(this.rows).filter(r=>r.owner===String(owner)&&r.bot===String(bot)).map(r=>({...r,users:[...r.users]}));}
 change(owner,bot,group,target,block){
  if(this.problem)throw new Error(this.problem);if(![owner,bot,target].every(valid)||!(valid(group)||group==='private')||String(target)===String(owner)||String(target)===String(bot))throw new Error('请选择主人和机器人以外的QQ号');
  const key=this.key(owner,bot,group),old=this.rows[key]||{owner:String(owner),bot:String(bot),group:String(group),users:[]};
  const users=old.users.filter(id=>id!==String(target));if(block)users.push(String(target));
  if(users.length>100||(!this.rows[key]&&Object.keys(this.rows).length>=200))throw new Error('群聊拉黑记录已达容量限制');
  const next={...this.rows};if(users.length)next[key]={...old,users};else delete next[key];
  fs.writeFileSync(this.file+'.tmp',JSON.stringify({version:1,rows:next}),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);this.rows=next;
 }
}

// Private sub_type and sender metadata do not prove friendship. Only a successful
// friend-list RPC for the current bot allows private traffic; failures fail closed.
export class PrivateFriends{
 constructor(rpc,now=Date.now){this.rpc=rpc;this.now=now;this.reset();}
 reset(){this.revision=(this.revision||0)+1;this.bot='';this.users=new Set();this.at=-Infinity;this.flight=null;}
 cached(event,bot){return event.message_type!=='private'||(String(bot)===this.bot&&this.now()-this.at<15000&&this.users.has(String(event.user_id)));}
 async allowed(event,bot,force=false){
  if(event.message_type!=='private')return event.message_type==='group';
  if(!valid(bot)||!valid(event.user_id))return false;
  if(this.bot!==String(bot)){this.reset();this.bot=String(bot);}
  if(!force&&this.now()-this.at<15000)return this.cached(event,bot);
  if(!this.flight){
   const revision=this.revision;
   const flight=(async()=>{
    try{const r=await this.rpc('get_friend_list',{},8000);if(r?.status!=='ok'||Number(r.retcode)!==0||!Array.isArray(r.data)||r.data.length>50000||r.data.some(v=>!valid(v?.user_id)))throw new Error('Friend list unavailable');
     if(this.revision===revision){this.users=new Set(r.data.map(v=>String(v.user_id)));this.at=this.now();}
    }catch{if(this.revision===revision){this.users.clear();this.at=this.now()-14000;}}
   })();this.flight=flight;flight.finally(()=>{if(this.flight===flight)this.flight=null;});
  }
  await this.flight;return this.cached(event,bot);
 }
}
