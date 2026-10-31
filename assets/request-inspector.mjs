import crypto from 'node:crypto';

/** A bounded, process-local view of the actual outgoing JSON, without headers. */
export class RequestInspector {
  constructor({secrets=()=>[],limit=20,maxChars=64000}={}){this.secrets=secrets;this.limit=limit;this.maxChars=maxChars;this.entries=[];}
  capture(endpoint,options,category){
    const secretValues=this.secrets().filter(s=>typeof s==='string'&&s.length>=4).sort((a,b)=>b.length-a.length);
    let left=this.maxChars,truncated=false,images=0;
    const clean=value=>{let text=String(value);for(const secret of secretValues)text=text.split(secret).join('[密钥已隐藏]');text=text.replace(/sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+/g,'[密钥已隐藏]').replace(/((?:SESSDATA|p_skey|bili_jct|api[_-]?key|password)\s*[=:]\s*)[^\s;，。]+/gi,'$1[已隐藏]');if(text.length>left){text=text.slice(0,left)+'\n[本次预览达到文字上限，余下省略]';truncated=true;}left=Math.max(0,left-text.length);return text;};
    const walk=(value,depth=0)=>{
      if(depth>12||left<=0){truncated=true;return '[预览省略]';}
      if(typeof value==='string')return /^data:|^base64:\/\//.test(value)?'[二进制数据省略]':clean(value);
      if(Array.isArray(value))return value.map(v=>walk(v,depth+1));
      if(value&&typeof value==='object'){
        if(['image_url','input_image'].includes(value.type)){images++;return {type:value.type,image:'[图片数据与签名链接省略]',detail:value.detail||value.image_url?.detail||'auto'};}
        return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/authorization|api.?key|cookie|password/i.test(k)?'[密钥已隐藏]':walk(v,depth+1)]));
      }return value;
    };
    let source;try{source=JSON.parse(options.body);}catch{return null;}
    const body=walk(source),entry={id:crypto.randomBytes(12).toString('hex'),at:Date.now(),category,model:clean(source.model||''),host:new URL(endpoint).hostname,protocol:new URL(endpoint).pathname.endsWith('/responses')?'responses':'chat',status:'sending',images,truncated,body};
    this.entries.push(entry);if(this.entries.length>this.limit)this.entries.shift();return entry.id;
  }
  finish(id,ok){const entry=this.entries.find(e=>e.id===id);if(entry)entry.status=ok?'completed':'failed';}
  list(){return this.entries.slice().reverse().map(({body,...meta})=>meta);}
  get(id){const entry=this.entries.find(e=>e.id===id);if(!entry)throw new Error('本次输入记录已过期或已清除');return entry;}
  clear(){this.entries=[];}
}
