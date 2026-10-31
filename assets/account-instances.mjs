import {feiyuBase} from './feiyu-voice.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
export function instanceLayout(slot,root='/opt/qq-workbench'){
  if(!Number.isInteger(slot)||slot<1||slot>3)throw new Error('最多新增3个账号实例');
  return {slot,directory:path.join(root,'instances','slot-'+slot),port:13482+slot,wsPort:13001+slot,snowPort:15099+slot,display:17+slot,vncPort:15917+slot,webPort:16080+slot,home:'/root/.local/share/qqwb-snow-'+slot,runtime:'/tmp/qqwb-runtime-'+slot};
}
export function validateInstance(p){
  const layout=instanceLayout(p?.slot);if(!/^[1-9][0-9]{4,11}$/.test(String(p.bot))||!/^[1-9][0-9]{4,11}$/.test(String(p.owner))||String(p.bot)===String(p.owner))throw new Error('请分别填写机器人QQ和大号QQ');
  if(typeof p.apiKey!=='string'||!p.apiKey.trim()||p.apiKey.length>4096)throw new Error('请为此账号单独配置API Key');
  const u=new URL(p.apiUrl);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search)throw new Error('模型需使用HTTPS地址');
  if(typeof p.model!=='string'||!p.model.trim()||p.model.length>200||!['chat','responses'].includes(p.apiProtocol||'chat'))throw new Error('模型配置不完整');
  if(!['auto','chat','separate'].includes(p.visionMode||'auto'))throw new Error('视觉模式无效');
  if(p.visionMode==='separate'){const v=new URL(p.visionUrl);if(v.protocol!=='https:'||v.username||v.password||v.search||v.hash||!p.visionModel||!p.visionKey?.trim())throw new Error('单独视觉服务需HTTPS地址、模型和自己的Key');}
  if(!['android','azure','qq','feiyu','zipvoice'].includes(p.speechProvider||'android')||!['smart','request','always'].includes(p.voiceMode||'smart'))throw new Error('语音配置无效');
  if((p.visionKey||'').length>4096||(p.speechKey||'').length>4096||(p.feiyuKey||'').length>4096)throw new Error('密钥过长');
  if(p.speechProvider==='feiyu'){feiyuBase(p.feiyuUrl);if(!p.feiyuKey?.trim())throw new Error('请为此账号配置肥鱼服务自己的Key');}
  return {...p,slot:layout.slot,bot:String(p.bot),owner:String(p.owner),name:String(p.name||'账号'+p.slot).slice(0,60)};
}
const settingKeys=['owner','apiUrl','model','apiProtocol','visionMode','visionUrl','visionModel','voiceEnabled','voiceAlways','voiceMode','voicePreference','voiceCooldown','voiceEmotion','zipVoiceSteps','feiyuUrl','feiyuVoice','feiyuStyle','androidVoice','speechLanguage','speechProvider','speechVoice','speechRegion','speechRate','speechPitch','qqVoiceId','qqVoiceGroup','others','rate','persona','characterName','contextTurns','maxReplyTokens'];
export class AccountInstances{
  constructor({root,source,token,nativeToken,profiles=[],spawnChild=spawn,fetcher=fetch,environment=process.env,primaryBot=()=>''}={}){
    this.primaryBot=primaryBot;this.root=root;this.source=source;this.token=token;this.nativeToken=nativeToken||token;this.profiles=new Map();this.children=new Map();this.tokens=new Map();this.problems=new Map();this.spawnChild=spawnChild;this.fetcher=fetcher;this.environment=environment;
    this.configure(profiles);
  }
  configure(profiles){
    if(!Array.isArray(profiles)||profiles.length>3)throw new Error('最多新增3个账号实例');
    const valid=profiles.map(validateInstance);if(new Set(valid.map(p=>p.slot)).size!==valid.length||new Set(valid.map(p=>p.bot)).size!==valid.length)throw new Error('账号或槽位不能重复');
    for(const p of valid){const prev=this.profiles.get(p.slot);if(this.children.has(p.slot)&&JSON.stringify(prev)!==JSON.stringify(p))throw new Error('请先停止此账号再修改配置');}
    for(const slot of this.children.keys())if(!valid.some(p=>p.slot===slot))throw new Error('请先停止账号');
    this.profiles=new Map(valid.map(p=>[p.slot,p]));
  }
  start(slot){
    const p=this.profiles.get(Number(slot));if(!p)throw new Error('请先保存此账号配置');
    if(p.bot===String(this.primaryBot()))throw new Error('此QQ已连接原账号实例，请勿重复登录');
    if(this.children.has(p.slot))return {message:'此账号实例已经运行'};
    const l=instanceLayout(p.slot,this.root);fs.mkdirSync(l.directory,{recursive:true,mode:0o700});
    let c={};try{c=JSON.parse(fs.readFileSync(path.join(l.directory,'settings.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('账号配置不可读，原文件保留');}
    for(const k of settingKeys)if(p[k]!==undefined)c[k]=p[k];
    c.expectedBot=p.bot;c.enabled=p.enabled!==false;c.autoPost=false;c.deviceToolsEnabled=false;
    fs.writeFileSync(path.join(l.directory,'settings.json'),JSON.stringify(c),{mode:0o600});
    const secret=crypto.randomBytes(32).toString('hex');this.tokens.set(p.slot,secret);this.problems.delete(p.slot);
    const env={...this.environment,WORKBENCH_TOKEN:secret,QQWB_NATIVE_TOKEN:this.nativeToken,QQWB_INSTANCE_SLOT:String(p.slot),QQWB_EXPECTED_BOT:p.bot,
      DEEPSEEK_API_KEY:p.apiKey,VISION_API_KEY:p.visionKey||'',SPEECH_API_KEY:p.speechKey||'',FEIYU_API_KEY:p.feiyuKey||'',QQWB_SITE_COOKIES:'',QQWB_ACCOUNT_PROFILES:'',
      WORKBENCH_MEMORY_KEY:crypto.createHmac('sha256',this.token).update('memory-slot-'+p.slot).digest('hex')};
    const child=this.spawnChild('/bin/bash',[path.join(this.source,'instance-session.sh'),String(p.slot)],{env,stdio:['ignore','ignore','ignore']});this.children.set(p.slot,child);
    const done=()=>{if(this.children.get(p.slot)===child){this.children.delete(p.slot);this.tokens.delete(p.slot);this.problems.set(p.slot,'实例已停止，登录数据保留');}};child.on('error',done);child.on('exit',done);
    return {message:'正在打开此账号的独立QQ登录窗口'};
  }
  async call(slot,route,data){
    const l=instanceLayout(Number(slot),this.root),token=this.tokens.get(l.slot);if(!token)throw new Error('账号实例尚未启动');
    const r=await this.fetcher('http://127.0.0.1:'+l.port+route,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(route.startsWith('/voice/')?75000:12000)});
    if(!r.ok)throw new Error('账号本地服务尚未就绪');return r.json();
  }
  async list(){return Promise.all([...this.profiles.values()].map(async p=>{let state=null;if(this.children.has(p.slot))try{state=await this.call(p.slot,'/state');}catch{}
    return {slot:p.slot,name:p.name,bot:p.bot,owner:p.owner,model:p.model,configured:!!p.apiKey,running:this.children.has(p.slot),webPort:instanceLayout(p.slot).webPort,connected:state?.connected===true,identity:state?.identity||'',voice:state?.voice||null,message:state?.summary?.split('\n')[0]||this.problems.get(p.slot)||'尚未启动',usage:state?.usage||null};}));}
  async stop(slot){
    slot=Number(slot);const child=this.children.get(slot);if(!child)return {message:'此账号已经停止，登录与配置保留'};
    let timer;const exited=new Promise(resolve=>{if(child.exitCode!=null||child.signalCode!=null)return resolve(true);child.once('exit',()=>resolve(true));});
    try{await this.call(slot,'/shutdown',{});}catch{}
    const ended=await Promise.race([exited,new Promise(resolve=>timer=setTimeout(()=>resolve(false),8000))]);clearTimeout(timer);
    if(!ended){child.kill('SIGTERM');throw new Error('实例正在退出，请稍后检查，未重复启动');}
    return {message:'已停止此账号，登录和配置保留'};
  }
  async stopAll(){await Promise.allSettled([...this.children.keys()].map(slot=>this.stop(slot)));}
}
