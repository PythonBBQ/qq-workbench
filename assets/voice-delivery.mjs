import {synthesize,splitSpeechFallback} from './voice.mjs';

// Split before synthesis. Keep punctuation and the exact original order; no LLM call.
export function splitVoiceMessages(input,{target=72,limit=100,tailAllowance=16}={}){
  const text=String(input||'').trim();if(!text)return [];
  const units=Array.from(text),weight=ch=>/[\x00-\x7f]/.test(ch)?0.3:1;
  const result=[];let offset=0;
  while(offset<units.length){
    let end=offset,size=0,strong=-1,weak=-1;
    while(end<units.length&&size+weight(units[end])<=limit&&end-offset<240){size+=weight(units[end]);end++;if(size>=target*.55){if(/[。！？!?；;\n]/.test(units[end-1]))strong=end;else if(/[,，、：:\s]/.test(units[end-1]))weak=end;}if(size>=target&&strong>offset)break;}
    if(end===units.length){result.push(units.slice(offset).join(''));break;}
    const stop=strong>offset?strong:weak>offset?weak:Math.max(end,offset+1);result.push(units.slice(offset,stop).join(''));offset=stop;
  }
  // Avoid sending a tiny final sentence by itself, within a bounded final utterance.
  if(result.length>1&&Array.from(result.at(-1)).reduce((n,ch)=>n+weight(ch),0)<16){const tail=result.at(-2)+result.at(-1);if(Array.from(tail).reduce((n,ch)=>n+weight(ch),0)<=limit+tailAllowance&&tail.length<=260)result.splice(-2,2,tail);}
  return result;
}

/** One send per chunk, after previous acknowledgement. Never retry an uncertain send. */
export function prepareSpeech(c,text,options={},generate=synthesize){
  const full=c.speechProvider==='zipvoice'&&c.zipVoiceModel==='full',limit=c.zipVoiceSteps===32||c.zipVoiceDeliveryPreset==='t02-t06'?24:36;
  const parts=splitVoiceMessages(text,full?{target:limit-8,limit,tailAllowance:0}:{});if(!parts.length)throw new Error('没有可朗读的文字');
  let used=false;
  const batch={info:null,acceptedVoiceCount:0,fallback:false,cleanup(){},async deliver({send,confirmed,current=()=>true,progress=()=>{}}){
    if(used)throw new Error('本次语音已处理，不自动重复发送');used=true;let result;
    for(let i=0;i<parts.length;i++){
      if(!current())throw new Error('会话已变化，剩余语音已取消');let audio;
      progress({phase:'synthesizing',part:i+1,total:parts.length});
      try{audio=await generate(c,parts[i],options);}catch(error){
        if(!current())throw new Error('会话已变化，剩余语音已取消');
        batch.fallback=true;progress({phase:'fallback',part:i+1,total:parts.length,error:error.message});
        for(const rest of splitSpeechFallback(parts.slice(i).join(''))){if(!current())throw new Error('会话已变化，剩余文字已取消');result=await send([{type:'text',data:{text:rest}}]);if(!confirmed(result))throw new Error('QQ剩余文字发送结果不确定，不自动重发');}
        return result;
      }
      try{if(!current())throw new Error('会话已变化，剩余语音已取消');progress({phase:'sending',part:i+1,total:parts.length});result=await send([audio.segment]);if(!confirmed(result))throw new Error('QQ分段语音发送结果不确定，已停止后续发送，不自动重发');batch.acceptedVoiceCount++;batch.info=audio.info||null;}finally{audio.cleanup();}
    }
    return result;
  }};return batch;
}
