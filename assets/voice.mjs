import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {qqImage,ok} from './qq-media.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {feiyuSpeech} from './feiyu-voice.mjs';
const execute=promisify(execFile);
export const FEMALE_VOICES=[
  ['zh-CN-XiaoxiaoNeural','晓晓 · 普通话','zh-CN'],['zh-CN-XiaoyiNeural','晓伊 · 普通话','zh-CN'],
  ['zh-TW-HsiaoChenNeural','曉臻 · 台湾国语','zh-TW'],['zh-HK-HiuMaanNeural','曉曼 · 粤语','zh-HK'],
  ['ja-JP-NanamiNeural','七海 · 日语','ja-JP'],['ko-KR-SunHiNeural','善熙 · 韩语','ko-KR']
];
const xml=s=>String(s).replace(/[<>&'\"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
const clamp=(n,min,max,otherwise)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Number(n))):otherwise;
export function speechRequest(c,text,key,emotion='neutral'){
  const voice=FEMALE_VOICES.find(v=>v[0]===c.speechVoice)||FEMALE_VOICES[0],region=String(c.speechRegion||'eastasia');
  if(!/^[a-z][a-z0-9]{1,30}$/.test(region))throw new Error('请填写正确的 Azure 区域，如 eastasia');
  if(!key)throw new Error('微软语音需要单独填写 Azure Speech Key');
  const rate=clamp(c.speechRate,-40,60,0),pitch=clamp(c.speechPitch,-30,30,0),signed=n=>(n>=0?'+':'')+n+'%';
  const style=voice[0]==='zh-CN-XiaoxiaoNeural'?({happy:'cheerful',gentle:'gentle',shy:'gentle',sad:'sad',serious:'serious'})[emotion]:null,spoken=`<prosody rate="${signed(rate)}" pitch="${signed(pitch)}">${xml(text)}</prosody>`;
  return {url:`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,options:{method:'POST',redirect:'error',headers:{'Ocp-Apim-Subscription-Key':key,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'audio-24khz-48kbitrate-mono-mp3','User-Agent':'QQWorkbench'},body:`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${voice[2]}"><voice name="${voice[0]}">${style?'<mstts:express-as style="'+style+'" styledegree="0.7">'+spoken+'</mstts:express-as>':spoken}</voice></speak>`,signal:AbortSignal.timeout(30000),networkTimeoutMs:30000}};
}
export function voicePrompt(c){
  if(!c.voiceEnabled||(c.voiceMode||(c.voiceAlways?'always':'smart'))!=='smart')return '';
  const preference=Math.max(0,Math.min(100,Number(c.voicePreference??35)));
  return '\n[本条回复形式，由工作台处理标记，不向用户解释]结合当前话题、对方情绪、最近对话和你将回答的内容判断文字或语音。'+(preference===0?'除非对方明确要求，否则用文字。':preference<35?'以文字为主，适合时偶尔语音。':preference<70?'文字与语音自然混合；安慰、亲近闲聊可语音。':'轻松闲聊偏向语音。')+'代码、链接、数字清单、长解释及不方便听时用文字；群聊克制。语气选自然、开心、温柔、害羞、难过或认真；不要为了标签刻意改变内容。正文开头只加[[voice:neutral]]、[[voice:happy]]、[[voice:gentle]]、[[voice:shy]]、[[voice:sad]]、[[voice:serious]]或[[text]]，后面直接给回复；语音只写可朗读正文，不宣称已发送。旧回复的语音能力自述不代表当前状态。';
}
export function extractVoiceChoice(value){const text=String(value||''),match=text.match(/^\s*\[\[(voice(?::(neutral|happy|gentle|shy|sad|serious))?|text)\]\]\s*/i);return {text:text.replace(/^\s*\[\[(?:voice(?::(?:neutral|happy|gentle|shy|sad|serious))?|text)\]\]\s*/i,'').replace(/\[\[(?:voice(?::[^\]\n]{1,40})?|text)\]\]/gi,'').trim(),choice:match?match[1].toLowerCase().startsWith('voice'):null,emotion:match?.[2]?.toLowerCase()||'neutral'};}

export function voiceDecision(text,c,{reply='',event={},history=[],lastVoiceAt=0,now=Date.now(),mode='reply',modelChoice=null}={}){
  const refuse=/(?:不要|别|不用|关闭|停止|不方便听|不能听).{0,6}(?:语音|声音)|(?:文字|打字)回[复答]|(?:在开会|在上课|不方便听)/;
  const ask=/(?:用语音|语音回[复答]|语音说说|语音聊聊|说给我听|读给我听|继续语音|(?:想听|听听)你的声音|(?:发|来)(?:一)?[条段个]?语音|说句(?:话)?(?:给我)?听听|用声音回[复答])/;
  if(!c.voiceEnabled)return {voice:false,reason:'语音未开启'};
  if(refuse.test(text))return {voice:false,reason:'本条要求文字'};
  if(ask.test(text))return {voice:true,explicit:true,reason:'本条明确要求语音'};
  const policy=c.voiceMode|| (c.voiceAlways?'always':'smart');
  if(policy==='request')return {voice:false,reason:'仅在要求时语音'};
  const recentTurns=history.filter(m=>m.role==='user').slice(-4).map(m=>typeof m.content==='string'?m.content:''),recent=recentTurns.join('\n');
  const preference=recentTurns.slice().reverse().find(value=>refuse.test(value)||ask.test(value));
  if(preference&&refuse.test(preference))return {voice:false,reason:'近期不方便听语音'};
  if(/```|https?:\/\/|(?:\b[A-Z]:\\|\/[a-z]+\/)|\|.+\||(?:API.?Key|验证码|密码|命令|代码|端口|配置步骤)/i.test(reply)||speechText(reply).length>220)return {voice:false,reason:'内容适合阅读或复制'};
  if(!reply.trim())return {voice:false,reason:'没有可朗读内容'};
  if(c.speechProvider==='qq'&&event.message_type!=='group')return {voice:false,reason:'所选QQ音色仅支持群聊'};
  if(policy==='always')return {voice:true,reason:'优先语音'};
  if(mode==='ambient')return {voice:false,reason:'主动接话使用文字'};
  if(lastVoiceAt&&now-lastVoiceAt<Math.max(20,Math.min(180,Number(c.voiceCooldown)||45))*1000)return {voice:false,reason:'避免连续发语音'};
  if(Number(c.voicePreference??35)===0)return {voice:false,reason:'语音倾向设为仅文字'};
  if(modelChoice===false)return {voice:false,reason:'聊天模型结合上下文选择文字'};
  if(modelChoice===true)return {voice:true,reason:'聊天模型结合上下文选择语音'};
  const incoming=(Array.isArray(event.message)?event.message:[]).some(s=>s.type==='record');
  if(event.message_type==='group'&&!incoming)return {voice:false,reason:'群聊默认安静回复'};
  if(incoming||/晚安|早安|早上好|安慰|鼓励|哄哄|陪陪|想你|好难过|好开心|睡不着/.test(text)||ask.test(recent))return {voice:true,reason:incoming?'回应对方语音':'简短陪伴聊天适合语音'};
  return {voice:false,reason:'本次优先文字'};
}
export function wantsVoice(text,c,context={}){return voiceDecision(text,c,context).voice;}
export function speechText(text){return String(text||'').replace(/https?:\/\/\S+/g,'链接见文字').replace(/```[\s\S]*?```/g,'代码见文字').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/[*#`]/g,'').trim();}
export async function synthesize(c,text,{key='',feiyuKey='',emotion='neutral',event={},rpc,fetcher=fetch,directory,stillCurrent=()=>true,native,convert=execute}={}){
  const value=speechText(text);if(!value||value.length>1200)throw new Error('语音限1200字，长回复继续使用文字');
  if(c.speechProvider==='android'||c.speechProvider==='feiyu'||c.speechProvider==='zipvoice'){
    let bytes,info=null;
    if(c.speechProvider==='feiyu')bytes=(await feiyuSpeech(c,value,{key:feiyuKey,emotion,fetcher,stillCurrent})).bytes;
    else{
      if(!native)throw new Error('系统语音接口尚未就绪');
      const adjustments=c.speechProvider==='zipvoice'||c.voiceEmotion===false?[0,0]:({happy:[6,3],gentle:[-7,-2],shy:[-9,1],sad:[-10,-3],serious:[-4,-2]})[emotion]||[0,0];
      const result=await native('synthesize',{provider:c.speechProvider,text:value,voice:c.androidVoice||'',language:c.speechLanguage||'zh-CN',emotion:c.voiceEmotion===false?'neutral':emotion,steps:c.zipVoiceSteps===8?8:4,rate:clamp(Number(c.speechRate||0)+adjustments[0],-40,60,0),pitch:clamp(Number(c.speechPitch||0)+adjustments[1],-30,30,0)});
      bytes=Buffer.from(result.audio||'','base64');
      if(c.speechProvider==='zipvoice')info={provider:'zipvoice',referenceMood:result.referenceMood||'neutral',referenceSource:result.referenceSource||'unknown',elapsedMs:result.elapsedMs||0};
      if(!result.ok||bytes.length<44||bytes.length>6*1024*1024||bytes.subarray(0,4).toString()!=='RIFF')throw new Error(result.message||'系统语音合成未完成');
    }
    if(!stillCurrent())throw new Error('语音已取消');
    fs.mkdirSync(directory,{recursive:true,mode:0o700});const base=path.join(directory,'speech-'+crypto.randomBytes(16).toString('hex')),wav=base+'.wav',file=base+'.mp3';
    try{fs.writeFileSync(wav,bytes,{mode:0o600});await convert('/usr/bin/ffmpeg',['-v','error','-nostdin','-threads','1','-i',wav,'-t','150','-ac','1','-ar','24000','-b:a','48k',file],{timeout:30000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
      if(!fs.existsSync(file)||fs.statSync(file).size<64||!stillCurrent())throw new Error('语音转换未完成或已取消');
      fs.chmodSync(file,0o600);return {segment:{type:'record',data:{file:'file://'+file}},file,info,cleanup:()=>{try{fs.unlinkSync(file);}catch{}}};
    }catch(e){try{fs.unlinkSync(file);}catch{}throw new Error(e.message==='语音转换未完成或已取消'?e.message:'语音音频转换未完成，请检查解码组件');}finally{try{fs.unlinkSync(wav);}catch{}}
  }
  if(c.speechProvider==='qq'){
    if(value.length>260)throw new Error('QQ群音色限260字，请使用系统语音或Azure');
    if(event.message_type!=='group'||!c.qqVoiceId)throw new Error('QQ 语音需要先选择群内音色，仅支持群聊');
    const r=await rpc('get_ai_record',{group_id:event.group_id,character:String(c.qqVoiceId).slice(0,200),text:value,chat_type:1});
    const url=qqImage(typeof r.data==='string'?r.data:r.data?.url);
    if(!ok(r)||!url)throw new Error('QQ 语音生成未完成');
    if(!stillCurrent())throw new Error('语音已取消');return {segment:{type:'record',data:{file:url}},cleanup:()=>{}};
  }
  const request=speechRequest(c,value,key,c.voiceEmotion===false?'neutral':emotion),r=await fetcher(request.url,request.options);
  if(!r.ok)throw new Error([401,403].includes(r.status)?'语音鉴权失败，请检查 Azure 区域和 Speech Key':`语音服务暂不可用（${r.status}）`);
  const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>2*1024*1024)throw new Error('语音响应过大');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);if(bytes.length<64||!(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224))throw new Error('语音服务未返回有效 MP3');
  if(!stillCurrent())throw new Error('语音已取消');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'speech-'+crypto.randomBytes(16).toString('hex')+'.mp3');fs.writeFileSync(file,bytes,{mode:0o600});
  return {segment:{type:'record',data:{file:'file://'+file}},file,cleanup:()=>{try{fs.unlinkSync(file);}catch{}}};
}
export function clearSpeech(directory,now=Date.now()){
  if(!fs.existsSync(directory))return;for(const name of fs.readdirSync(directory))if(/^speech-[a-f0-9]{32}\.(?:mp3|wav)$/.test(name)){const f=path.join(directory,name);if(!fs.lstatSync(f).isSymbolicLink()&&now-fs.statSync(f).mtimeMs>3600000)fs.unlinkSync(f);}
}
