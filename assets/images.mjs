// Images stay in conversation context; background photos never enter this module.
export function visionTarget(config,chatKey,visionKey='') {
  const mode=config.visionMode||'auto';
  if(mode==='chat')return {url:config.apiUrl,model:config.model,key:chatKey,direct:true};
  if(mode==='separate'||config.visionMode==null&&config.visionUrl&&config.visionModel){
    if(!config.visionUrl||!config.visionModel)return null;
    let same=false;try{same=new URL(config.apiUrl).origin===new URL(config.visionUrl).origin;}catch{}
    const key=visionKey||(same?chatKey:'');
    return key?{url:config.visionUrl,model:config.visionModel,key,direct:false}:null;
  }
  let official=false;try{official=new URL(config.apiUrl).origin==='https://api.deepseek.com';}catch{}
  if(official)return {url:config.apiUrl,model:'deepseek-flash',key:chatKey,direct:true};
  return null;
}
export function contextText(content){return typeof content==='string'?content:(content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');}
export async function imageParts(event,fetcher=fetch,detail='low'){
  const parts=[];
  for(const image of (Array.isArray(event.message)?event.message:[]).filter(x=>x.type==='image').slice(0,2)){
    try{
      const raw=image.data?.url;if(typeof raw!=='string')continue;
      const u=new URL(raw);
      if(u.protocol!=='https:'||u.username||u.password||u.port&&!['443'].includes(u.port)||!['qq.com','qq.com.cn','qpic.cn','qlogo.cn','gtimg.cn'].some(host=>u.hostname===host||u.hostname.endsWith('.'+host)))continue;
      const response=await fetcher(u,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)continue;
      const type=response.headers.get('content-type')?.split(';')[0].trim();if(!['image/jpeg','image/png','image/webp','image/gif'].includes(type))continue;
      const reader=response.body.getReader(),chunks=[];let total=0;
      try{while(true){const r=await reader.read();if(r.done)break;total+=r.value.length;if(total>6*1024*1024)throw new Error('图片超过6MB');chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}
      if(total)parts.push({type:'image_url',image_url:{url:`data:${type};base64,${Buffer.concat(chunks).toString('base64')}`,detail:detail==='low'?'low':'auto'}});
    }catch{/* A failed image must not discard the user's accompanying text. */}
  }
  return parts;
}
export function trimImageHistory(history,maxBytes=16*1024*1024){
  let images=0,bytes=0;
  return [...history].reverse().map(message=>{
    if(!Array.isArray(message.content))return message;
    const content=message.content.filter(part=>{
      if(part.type!=='image_url')return true;
      const size=Buffer.byteLength(part.image_url.url);if(images>=2||bytes+size>maxBytes)return false;
      images++;bytes+=size;return true;
    });
    return {...message,content:content.length?content:'（此前发来过图片）'};
  }).reverse();
}
export function limitContextImages(contexts,maxBytes=24*1024*1024){
  let remaining=maxBytes;
  for(const key of [...contexts.keys()].reverse()){
    const history=trimImageHistory(contexts.get(key),Math.max(0,remaining));
    contexts.set(key,history);
    for(const m of history)if(Array.isArray(m.content))for(const part of m.content)if(part.type==='image_url')remaining-=Buffer.byteLength(part.image_url.url);
  }
}
