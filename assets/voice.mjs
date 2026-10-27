import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {qqImage,ok} from './qq-media.mjs';
export const FEMALE_VOICES=[
  ['zh-CN-XiaoxiaoNeural','晓晓 · 普通话','zh-CN'],['zh-CN-XiaoyiNeural','晓伊 · 普通话','zh-CN'],
  ['zh-TW-HsiaoChenNeural','曉臻 · 台湾国语','zh-TW'],['zh-HK-HiuMaanNeural','曉曼 · 粤语','zh-HK'],
  ['ja-JP-NanamiNeural','七海 · 日语','ja-JP'],['ko-KR-SunHiNeural','善熙 · 韩语','ko-KR']
];
const xml=s=>String(s).replace(/[<>&'\"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
const clamp=(n,min,max,otherwise)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Number(n))):otherwise;
export function speechRequest(c,text,key){
  const voice=FEMALE_VOICES.find(v=>v[0]===c.speechVoice)||FEMALE_VOICES[0],region=String(c.speechRegion||'eastasia');
  if(!/^[a-z][a-z0-9]{1,30}$/.test(region))throw new Error('请填写正确的 Azure 区域，如 eastasia');
  if(!key)throw new Error('微软语音需要单独填写 Azure Speech Key');
  const rate=clamp(c.speechRate,-40,60,0),pitch=clamp(c.speechPitch,-30,30,0),signed=n=>(n>=0?'+':'')+n+'%';
  return {url:`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,options:{method:'POST',redirect:'error',headers:{'Ocp-Apim-Subscription-Key':key,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'audio-24khz-48kbitrate-mono-mp3','User-Agent':'QQWorkbench'},body:`<speak version="1.0" xml:lang="${voice[2]}"><voice name="${voice[0]}"><prosody rate="${signed(rate)}" pitch="${signed(pitch)}">${xml(text)}</prosody></voice></speak>`,signal:AbortSignal.timeout(30000),networkTimeoutMs:30000}};
}
export function wantsVoice(text,c){return c.voiceEnabled===true&&(c.voiceAlways===true||/(?:用语音|语音回[复答]|说给我听|读给我听)/.test(text));}
export async function synthesize(c,text,{key='',event={},rpc,fetcher=fetch,directory,stillCurrent=()=>true}={}){
  const value=String(text).trim();if(!value||value.length>260)throw new Error('语音限260字，长回复继续使用文字');
  if(c.speechProvider==='qq'){
    if(event.message_type!=='group'||!c.qqVoiceId)throw new Error('QQ 语音需要先选择群内音色，仅支持群聊');
    const r=await rpc('get_ai_record',{group_id:event.group_id,character:String(c.qqVoiceId).slice(0,200),text:value,chat_type:1});
    const url=qqImage(typeof r.data==='string'?r.data:r.data?.url);
    if(!ok(r)||!url)throw new Error('QQ 语音生成未完成');
    if(!stillCurrent())throw new Error('语音已取消');return {segment:{type:'record',data:{file:url}},cleanup:()=>{}};
  }
  const request=speechRequest(c,value,key),r=await fetcher(request.url,request.options);
  if(!r.ok)throw new Error([401,403].includes(r.status)?'语音鉴权失败，请检查 Azure 区域和 Speech Key':`语音服务暂不可用（${r.status}）`);
  const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>2*1024*1024)throw new Error('语音响应过大');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);if(bytes.length<64||!(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224))throw new Error('语音服务未返回有效 MP3');
  if(!stillCurrent())throw new Error('语音已取消');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'speech-'+crypto.randomBytes(16).toString('hex')+'.mp3');fs.writeFileSync(file,bytes,{mode:0o600});
  return {segment:{type:'record',data:{file:'file://'+file}},file,cleanup:()=>{try{fs.unlinkSync(file);}catch{}}};
}
export function clearSpeech(directory,now=Date.now()){
  if(!fs.existsSync(directory))return;for(const name of fs.readdirSync(directory))if(/^speech-[a-f0-9]{32}\.mp3$/.test(name)){const f=path.join(directory,name);if(!fs.lstatSync(f).isSymbolicLink()&&now-fs.statSync(f).mtimeMs>3600000)fs.unlinkSync(f);}
}
