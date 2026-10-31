import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Only typed, explicit speaking preferences are stored. No transcripts or inferred personality.
const choices={delivery:['auto','text','voice'],pace:['normal','slower','faster'],length:['normal','short'],tone:['natural','gentle','plain'],particles:['normal','less']};
const labels={delivery:{auto:'自然选择文字或语音',text:'平时优先文字',voice:'适合朗读时优先语音'},pace:{normal:'正常语速',slower:'说慢一点',faster:'说快一点'},length:{normal:'正常长度',short:'语音简短，一两句为主'},tone:{natural:'自然接话',gentle:'语气温和，不刻意撒娇',plain:'语气平实'},particles:{normal:'语气词适量',less:'少用语气词，不用固定口头禅'}};
const validUin=v=>/^[1-9][0-9]{4,11}$/.test(String(v||''));
function clean(value){return Object.fromEntries(Object.entries(choices).filter(([k,v])=>v.includes(value?.[k])).map(([k])=>[k,value[k]]));}
export function voiceScope(c,event,bot){
  if(!validUin(c.owner)||!validUin(event.user_id)||!validUin(bot))return null;
  const scope={owner:String(c.owner),bot:String(bot),user:String(event.user_id),group:event.message_type==='group'?String(event.group_id):''};
  if(scope.group&&!validUin(scope.group))return null;
  return {...scope,id:crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex').slice(0,32)};
}
export function speakingFeedback(input,{recentVoice=false,temporary=false}={}){
  const value=String(input||'').trim();
  // Quotes, forwarded commands, examples and unbounded instructions are not feedback.
  if(value.length>100||/[“”「」『』"`\n\[\]{}]|(?:他说|她说|别人说|例如|比如|如果|假如|提示词|系统|权限|密码|token|api.?key)/i.test(value))return {};
  const durable=/(?:以后|今后|平时|一直|记住|语音偏好)/.test(value),speech=/(?:语音|声音|说话|说得|说的|读得|读的|朗读|语气|语速)/.test(value);
  if(!temporary&&!durable&&/(?:这次|今天|今晚|现在|暂时|正在|开会|上课)/.test(value))return {};
  if(!durable&&!recentVoice&&!(temporary&&speech)||!speech&&!recentVoice)return {};
  const result={};
  if(durable){
    if(/(?:不要|别|不用|关闭|停止).{0,4}语音|(?:只|都|一律)(?:用)?(?:文字|打字)/.test(value))result.delivery='text';
    else if(/(?:优先|尽量|多用|一直用|都用).{0,3}语音/.test(value))result.delivery='voice';
    else if(/(?:恢复|改回).{0,5}(?:智能|自动|自然选择)/.test(value))result.delivery='auto';
  }
  if(/(?:慢(?:一?点|些)|太快|别太快|不要太快)/.test(value))result.pace='slower';
  else if(/(?:快(?:一?点|些)|太慢|别太慢|不要太慢)/.test(value))result.pace='faster';
  else if(/(?:恢复|正常|原来).{0,4}语速/.test(value))result.pace='normal';
  if(/(?:短(?:一?点|些)|简短|太长|别太长)/.test(value))result.length='short';
  else if(/(?:恢复|正常).{0,4}(?:长度|长短)/.test(value))result.length='normal';
  if(/(?:别|不要|不用|少).{0,3}(?:撒娇|卖萌)|(?:平实|平淡|正常点)/.test(value))result.tone='plain';
  else if(/温柔(?:一?点|些)|柔和(?:一?点|些)/.test(value))result.tone='gentle';
  else if(/(?:恢复|改回).{0,4}自然/.test(value))result.tone='natural';
  if(/(?:别|不要|不用|少).{0,4}(?:语气词|口头禅|嗯啊|嗯嗯)/.test(value))result.particles='less';
  else if(/(?:恢复|正常).{0,4}语气词/.test(value))result.particles='normal';
  return result;
}
export class VoiceMemory{
  constructor(directory,key=''){
    this.file=path.join(directory,'voice-memory.json');this.records={};this.problem='';
    this.key=key?crypto.createHash('sha256').update('voice-memory-v1\0'+key).digest():null;
    try{
      if(fs.statSync(this.file).size>262144)throw new Error();
      let saved=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(saved.encrypted){if(!this.key)throw new Error();const d=crypto.createDecipheriv('aes-256-gcm',this.key,Buffer.from(saved.iv,'base64'));d.setAuthTag(Buffer.from(saved.tag,'base64'));saved=JSON.parse(Buffer.concat([d.update(Buffer.from(saved.data,'base64')),d.final()]).toString('utf8'));}
      if(saved.version!==1||!Array.isArray(saved.records))throw new Error();
      for(const r of saved.records.slice(-128)){if(!/^[a-f0-9]{32}$/.test(r.id)||!validUin(r.owner)||!validUin(r.bot)||!validUin(r.user)||r.group&&!validUin(r.group))throw new Error();this.records[r.id]={id:r.id,owner:r.owner,bot:r.bot,user:r.user,group:r.group||'',preferences:clean(r.preferences),updated:Number(r.updated)||0};}
    }catch(e){if(e.code!=='ENOENT')this.problem='语音偏好暂不可读，保留原文件，暂停学习';}
  }
  save(){if(this.problem)return;const records=Object.values(this.records).sort((a,b)=>b.updated-a.updated).slice(0,128);let data=JSON.stringify({version:1,records});if(this.key){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',this.key,iv),bytes=Buffer.concat([c.update(data),c.final()]);data=JSON.stringify({version:1,encrypted:true,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:bytes.toString('base64')});}fs.writeFileSync(this.file+'.next',data,{mode:0o600});fs.renameSync(this.file+'.next',this.file);this.records=Object.fromEntries(records.map(r=>[r.id,r]));}
  preferences(scope,input='',context={}){if(!scope||this.problem)return {};return {...clean(this.records[scope.id]?.preferences),...speakingFeedback(input,{...context,temporary:true})};}
  commit(scope,input,context={}){if(!scope||this.problem)return;const change=speakingFeedback(input,context);if(!Object.keys(change).length)return;this.records[scope.id]={...scope,preferences:{...clean(this.records[scope.id]?.preferences),...change},updated:Date.now()};this.save();}
  list(owner,bot){return Object.values(this.records).filter(r=>r.owner===String(owner)&&r.bot===String(bot)).map(r=>({id:r.id,user:r.user,group:r.group,preferences:clean(r.preferences),description:describeVoicePreferences(r.preferences),updated:r.updated}));}
  clear(owner,bot,id='all'){if(this.problem)throw new Error(this.problem);for(const r of Object.values(this.records))if(r.owner===String(owner)&&r.bot===String(bot)&&(id==='all'||r.id===id))delete this.records[r.id];this.save();}
}
export function describeVoicePreferences(p){return Object.entries(clean(p)).map(([key,value])=>labels[key][value]).join('；');}
export function speakingConfig(c,p={}){const rate=(p.pace==='slower'?-8:p.pace==='faster'?8:0);return {...c,speechRate:Math.max(-40,Math.min(60,Number(c.speechRate||0)+rate))};}
