import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {qqImage,ok} from './qq-media.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {feiyuSpeech} from './feiyu-voice.mjs';
import {describeVoicePreferences} from './voice-memory.mjs';
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
export function voicePrompt(c,{preferences={},explicit=false,format='auto'}={}){
  if(!c.voiceEnabled)return '';
  if(format==='text')return '\n[回复形式]本条使用文字，开头加[[text]]，随后直接自然回应。保留必要细节和可复制内容，不加语音动作或合成说明。';
  const preference=Math.max(0,Math.min(100,Number(c.voicePreference??35)));
  const policy=c.voiceMode||(c.voiceAlways?'always':'smart');
  const selection=explicit?'本条明确要求语音，可朗读内容选语音。':policy==='request'?'仅本条明确要求才选语音。':policy==='always'?'可朗读内容优先语音。':preference===0?'除非对方明确要求，否则用文字。':preference<35?'以文字为主，适合时偶尔语音。':preference<70?'文字与语音自然混合；安慰、亲近闲聊可语音。':'轻松闲聊偏向语音。';
  // Pace is applied by the local synthesizer; don't spend model input describing it.
  const {pace,...languagePreferences}=preferences,remembered=describeVoicePreferences(languagePreferences);
  return '\n[回复形式]结合当前话题、情绪和上下文选择。'+selection+'不方便听、代码链接、数字清单和长解释用文字；群聊克制。开头只加[[text]]或[[voice:neutral]]，语音的neutral可换happy/gentle/shy/sad/serious；随后直接给正文，不解释标记。'+
    (c.voiceNatural===false?'':'文字先回应重点，短段落，保留准确细节；语音像当面接话，一到三句、通常20到90字，关键答案不省略，长解释改文字。短句用正常标点停顿；开心轻快，安慰温和，严肃直接。少套话、复述、反问和重复称呼；不堆语气词、不机械撒娇。不写动作旁白、笑声呼吸标签、SSML或表情，不拉长拼音或滥用省略号；必要英文数字照常。')+
    (remembered?'说话偏好：'+remembered+'；本条明确要求优先。':'')+
    '只写要说的话，不宣称已发送，不冒充真人，不编造现实活动。';
}
export function voiceFormatHint(text,c,context={}){
  const decision=voiceDecision(text,c,{reply:'本条回复',...context});
  if(decision.explicit)return 'voice';
  if(!c.voiceEnabled||c.voiceMode==='request'||Number(c.voicePreference??35)===0||['本条要求文字','近期不方便听语音','本会话记住了优先文字','主动接话使用文字','所选QQ音色仅支持群聊'].includes(decision.reason))return 'text';
  return 'auto';
}
export function extractVoiceChoice(value){const text=String(value||''),match=text.match(/^\s*\[\[(voice(?::(neutral|happy|gentle|shy|sad|serious))?|text)\]\]\s*/i);return {text:text.replace(/^\s*\[\[(?:voice(?::(?:neutral|happy|gentle|shy|sad|serious))?|text)\]\]\s*/i,'').replace(/\[\[(?:voice(?::[^\]\n]{1,40})?|text)\]\]/gi,'').trim(),choice:match?match[1].toLowerCase().startsWith('voice'):null,emotion:match?.[2]?.toLowerCase()||'neutral'};}

export function voiceDecision(text,c,{reply='',event={},history=[],lastVoiceAt=0,now=Date.now(),mode='reply',modelChoice=null,preferences={}}={}){
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
  if(preferences.delivery==='text')return {voice:false,reason:'本会话记住了优先文字'};
  if(/```|https?:\/\/|(?:\b[A-Z]:\\|\/[a-z]+\/)|\|.+\||(?:API.?Key|验证码|密码|命令|代码|端口|配置步骤)/i.test(reply)||speechText(reply).length>220)return {voice:false,reason:'内容适合阅读或复制'};
  if(!reply.trim())return {voice:false,reason:'没有可朗读内容'};
  if(c.speechProvider==='qq'&&event.message_type!=='group')return {voice:false,reason:'所选QQ音色仅支持群聊'};
  if(policy==='always')return {voice:true,reason:'优先语音'};
  if(mode==='ambient')return {voice:false,reason:'主动接话使用文字'};
  if(lastVoiceAt&&now-lastVoiceAt<Math.max(20,Math.min(180,Number(c.voiceCooldown)||45))*1000)return {voice:false,reason:'避免连续发语音'};
  if(Number(c.voicePreference??35)===0)return {voice:false,reason:'语音倾向设为仅文字'};
  if(preferences.delivery==='voice'&&event.message_type!=='group')return {voice:true,reason:'本会话记住了适合时优先语音'};
  if(modelChoice===false)return {voice:false,reason:'聊天模型结合上下文选择文字'};
  if(modelChoice===true)return {voice:true,reason:'聊天模型结合上下文选择语音'};
  const incoming=(Array.isArray(event.message)?event.message:[]).some(s=>s.type==='record');
  if(event.message_type==='group'&&!incoming)return {voice:false,reason:'群聊默认安静回复'};
  if(incoming||/晚安|早安|早上好|安慰|鼓励|哄哄|陪陪|想你|好难过|好开心|睡不着/.test(text)||ask.test(recent))return {voice:true,reason:incoming?'回应对方语音':'简短陪伴聊天适合语音'};
  return {voice:false,reason:'本次优先文字'};
}
export function wantsVoice(text,c,context={}){return voiceDecision(text,c,context).voice;}
export function speechText(text){return String(text||'').replace(/```[\s\S]*?```/g,'代码见文字').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/https?:\/\/\S+/g,'链接见文字').replace(/\[\[(?:voice(?::[^\]\n]+)?|text)\]\]/gi,'').replace(/<[^>]{0,160}>/g,'').replace(/[（(【\[]\s*(?:轻声|轻笑|微笑|害羞|停顿|叹气|笑着|温柔地|撒娇|吸气|呼气)[^）)】\]\n]{0,12}[）)】\]]/g,'').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'').replace(/[*#`]/g,'').replace(/\.{3,}|…{2,}/g,'，').replace(/[!！]{2,}/g,'！').replace(/[?？]{2,}/g,'？').replace(/[,，]{2,}/g,'，').replace(/\n+/g,'。').replace(/([。！？])。/g,'$1').replace(/\s+/g,' ').trim();}
export function speechPlan(text,c={},emotion='neutral'){
  let value=speechText(text);
  // Conservative spoken forms; identifiers, versions and ordinary numbers are left intact.
  value=value.replace(/(-?\d+(?:\.\d+)?)\s*%/g,(_,n)=>'百分之'+n.replace(/^-/,'负')).replace(/(-?\d+(?:\.\d+)?)\s*℃/g,(_,n)=>n.replace(/^-/,'零下')+'摄氏度');
  return {text:value,emotion:['neutral','happy','gentle','shy','sad','serious'].includes(emotion)?emotion:'neutral',phrasing:c.voiceNatural!==false};
}
export function splitSpeechFallback(input){
  const text=String(input||'').trim();if(text.length<30)return [text];
  const middle=text.length/2,min=text.length*.25,max=text.length*.8;
  const nearest=points=>points.filter(i=>i>=min&&i<=max).sort((a,b)=>Math.abs(a-middle)-Math.abs(b-middle))[0];
  let index=nearest([...text.matchAll(/[。！？!?；;]\s*|\n+/g)].map(m=>m.index+m[0].length));
  if(index===undefined)index=nearest([...text.matchAll(/[,，、：:]\s*|\s+/g)].map(m=>m.index+m[0].length));
  if(index===undefined)index=nearest([...text.matchAll(/(?:然后|另外|不过|所以|但是|接下来|同时)/g)].map(m=>m.index));
  if(index===undefined){if(/^[\x00-\x7f]*$/.test(text))return [text];const units=Array.from(text);index=units.slice(0,Math.ceil(units.length/2)).join('').length;}
  const first=text.slice(0,index).trim(),second=text.slice(index).trim();return first&&second?[first,second]:[text];
}
export async function synthesize(c,text,{key='',feiyuKey='',emotion='neutral',event={},rpc,fetcher=fetch,directory,stillCurrent=()=>true,native,convert=execute}={}){
  const plan=speechPlan(text,c,emotion),value=plan.text;emotion=plan.emotion;if(!value||value.length>1200)throw new Error('语音限1200字，长回复继续使用文字');
  if(c.speechProvider==='android'||c.speechProvider==='feiyu'||c.speechProvider==='zipvoice'){
    let bytes,info=null;
    if(c.speechProvider==='feiyu')bytes=(await feiyuSpeech(c,value,{key:feiyuKey,emotion,fetcher,stillCurrent})).bytes;
    else{
      if(!native)throw new Error('系统语音接口尚未就绪');
      const adjustments=c.speechProvider==='zipvoice'||c.voiceEmotion===false?[0,0]:({happy:[6,3],gentle:[-7,-2],shy:[-9,1],sad:[-10,-3],serious:[-4,-2]})[emotion]||[0,0];
      const requestedSteps=c.zipVoiceSteps===8?8:4,steps=c.speechProvider==='zipvoice'&&c.zipVoiceAdaptive!==false&&value.length>60?4:requestedSteps;
      const result=await native('synthesize',{provider:c.speechProvider,text:value,phrasing:plan.phrasing,voice:c.androidVoice||'',language:c.speechLanguage||'zh-CN',emotion:c.voiceEmotion===false?'neutral':emotion,steps,requestedSteps,rate:clamp(Number(c.speechRate||0)+adjustments[0],-40,60,0),pitch:clamp(Number(c.speechPitch||0)+adjustments[1],-30,30,0)});
      bytes=Buffer.from(result.audio||'','base64');
      if(c.speechProvider==='zipvoice')info={provider:'zipvoice',referenceMood:result.referenceMood||'neutral',referenceSource:result.referenceSource||'unknown',elapsedMs:result.elapsedMs||0};
      if(c.speechProvider==='zipvoice'&&result.segments!==undefined){
        if(!Number.isInteger(result.segments)||result.segments<1||result.segments!==result.completedSegments)throw new Error('语音分段未全部完成，本次使用文字');
        info={...info,segments:result.segments,completedSegments:result.completedSegments,durationMs:result.durationMs||0,characters:result.characters||0,phraseTarget:result.phraseTarget||0,phraseLengths:Array.isArray(result.phraseLengths)?result.phraseLengths:[]};
      }
      if(c.speechProvider==='zipvoice'&&Number.isInteger(result.steps))info={...info,steps:result.steps,requestedSteps:result.requestedSteps||result.steps};
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
