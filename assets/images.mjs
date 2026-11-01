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
const commonFaces={0:'惊讶',1:'撇嘴',2:'色',3:'发呆',4:'得意',5:'流泪',6:'害羞',7:'闭嘴',8:'睡',9:'大哭',10:'尴尬',11:'发怒',12:'调皮',13:'呲牙',14:'微笑',15:'难过',16:'酷',18:'抓狂',19:'吐',20:'偷笑',21:'可爱',22:'白眼',23:'傲慢',24:'饥饿',25:'困',26:'惊恐',27:'流汗',28:'憨笑',29:'悠闲',30:'奋斗',31:'咒骂',32:'疑问',33:'嘘',34:'晕',36:'衰',39:'再见',49:'拥抱',76:'赞',96:'冷汗',97:'擦汗',99:'鼓掌',100:'糗大了'};
const faceLabel=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f\[\]<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,48):'';
export class QQFaces{
  constructor(rpc){this.rpc=rpc;this.reset();}
  reset(){this.bot='';this.cache=new Map();this.revision=(this.revision||0)+1;}
  async label(id,bot){
    if(!/^\d{1,5}$/.test(String(id)))return '';
    if(this.bot!==String(bot)){this.reset();this.bot=String(bot);}
    id=String(Number(id));const now=Date.now(),cached=this.cache.get(id);if(cached&&cached.until>now)return cached.value;
    const revision=this.revision;
    const value=(async()=>{let name='';try{const r=await this.rpc('fetch_face_entity',{face_id:Number(id),refresh:false},2500);if(r?.status==='ok'&&Number(r.retcode)===0)name=faceLabel(r.data?.q_des)||faceLabel(r.data?.emoji_name_alias?.[0]);}catch{}
      return name||commonFaces[id]||'';
    })();
    if(this.cache.size>=256)this.cache.delete(this.cache.keys().next().value);
    this.cache.set(id,{value,until:now+3600000});
    const result=await value;if(revision!==this.revision)return '';if(!result)this.cache.set(id,{value:Promise.resolve(''),until:now+60000});return result;
  }
  async describe(event,bot){
    const segments=Array.isArray(event.message)?event.message:[];
    let count=0;const parts=await Promise.all(segments.slice(0,64).map(async part=>{
      if(part.type==='text')return String(part.data?.text||'').slice(0,6000);
      if(part.type==='face'&&count++<8){const id=part.data?.id,label=await this.label(id,bot);return label?'〔QQ表情：'+label+'〕':'〔QQ内置表情，名称未读取，不能猜测具体含义〕';}
      if(part.type==='mface'||part.type==='image'&&part.data?.emoji_id){const label=faceLabel(part.data?.summary)||faceLabel(part.data?.text);return label?'〔QQ表情包标签：'+label+'〕':'〔发来了QQ表情包〕';}
      return '';
    }));
    return {hasFaces:segments.some(p=>['face','mface'].includes(p.type)||p.type==='image'&&p.data?.emoji_id),text:parts.join('').trim()};
  }
}
export function imageSegments(event){
  return (Array.isArray(event.message)?event.message:[]).filter(x=>['image','mface'].includes(x.type)).map(x=>{
    if(x.data?.url)return x;
    const id=String(x.data?.emoji_id||'');return {...x,data:{...x.data,url:/^[a-f0-9]{32}$/i.test(id)?'https://gxh.vip.qq.com/club/item/parcel/item/'+id.slice(0,2)+'/'+id+'/raw300.gif':undefined}};
  });
}
export async function imageParts(event,fetcher=fetch,detail='low'){
  const parts=[];
  for(const image of imageSegments(event).slice(0,2)){
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
