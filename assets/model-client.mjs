// Compatible model transport. No retries for authentication, quota or network failures.
export function completionUrl(base,protocol='chat'){
 const u=new URL(String(base).trim());
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new Error('模型 API 地址须为 HTTPS，且不含账号、查询参数或片段');
 const suffix=protocol==='responses'?'/responses':'/chat/completions';
 let route=u.pathname.replace(/\/+$/,'').replace(/\/(?:chat\/completions|responses|models)$/,'');
 u.pathname=route+suffix;return u.href;
}
function outputText(value){
 if(typeof value==='string')return value;
 return Array.isArray(value)?value.filter(p=>p?.type==='text'||p?.type==='output_text').map(p=>typeof p.text==='string'?p.text:'').join(''):'';
}
function extract(data,protocol){
 if(protocol==='responses')return typeof data.output_text==='string'?data.output_text:(data.output||[]).filter(p=>p.type==='message').map(p=>outputText(p.content)).join('');
 return outputText(data.choices?.[0]?.message?.content);
}
function responsesBody(body){
 const {messages,max_tokens,...rest}=body;delete rest.thinking;
 return {...rest,max_output_tokens:max_tokens,input:messages.map(m=>({role:m.role,content:typeof m.content==='string'?m.content:m.content.map(p=>p.type==='image_url'?{type:'input_image',image_url:p.image_url.url,detail:p.image_url.detail||'auto'}:{type:m.role==='assistant'?'output_text':'input_text',text:p.text||''})}))};
}
async function payload(response){
 const raw=await response.text();if(raw.length>2*1024*1024)throw new Error('模型响应超过2MB上限');
 if(/text\/event-stream/i.test(response.headers.get('content-type')||'')||raw.trimStart().startsWith('data:')){
  let text='',usage,finish='';
  for(const line of raw.split(/\r?\n/)){if(!line.startsWith('data:'))continue;const value=line.slice(5).trim();if(!value||value==='[DONE]')continue;
   let part;try{part=JSON.parse(value);}catch{continue;}
   if(part.error)throw new Error('中转站在返回过程中报错，请检查模型权限或额度');
   if(part.type==='response.output_text.delta')text+=part.delta||'';
   else text+=outputText(part.choices?.[0]?.delta?.content);
   if(part.usage)usage=part.usage;if(part.response?.usage)usage=part.response.usage;
   finish=part.choices?.[0]?.finish_reason||finish;
  }
  return {choices:[{message:{content:text},finish_reason:finish}],output_text:text,usage};
 }
 try{return JSON.parse(raw);}catch{throw new Error('模型没有返回JSON或兼容事件流，请检查地址是否为API而非站点首页');}
}
function apiError(status,data){
 const value=String(data?.error?.code||data?.error?.type||data?.code||'')+' '+String(data?.error?.message||data?.message||'');
 const reason=/quota|credit|balance|余额|额度|欠费/i.test(value)?'服务商额度或余额不足':/context.length|context_length|too many tokens|上下文/i.test(value)?'上下文超限，请降低上下文用量':/model.*(?:not found|not exist|denied|permission|support)|模型.*(?:权限|不存在|不支持)/i.test(value)?'所选模型不存在、没有权限或该接口不支持':({400:'请求参数或接口协议不兼容',401:'API Key无效或未获授权',403:'服务商拒绝访问，请检查分组和模型权限',404:'聊天地址或模型名称不存在',405:'聊天接口路径不兼容',429:'额度不足或请求过于频繁'}[status]||'服务商暂时不可用');
 return new Error('模型接口 HTTP '+status+' · '+reason);
}
export async function callModel({url,key,body,protocol='chat',fetcher=fetch,timeout=90000,onUsage=()=>{}}){
 if(!['chat','responses'].includes(protocol))throw new Error('请选择Chat Completions或Responses协议');
 const signal=AbortSignal.timeout(timeout);let endpoint=completionUrl(url,protocol),request={...body,stream:false},pathRetried=false,paramRetried=false;
 if(new URL(url).origin==='https://api.deepseek.com'&&protocol==='chat')request.thinking={type:'disabled'};
 if(protocol==='responses')request=responsesBody(request);
 while(true){
  let response,data;
  try{response=await fetcher(endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify(request),redirect:'error',signal,networkTimeoutMs:timeout});}
  catch(e){throw new Error(String(e.message).startsWith('安卓网络')?e.message:signal.aborted?'模型请求超时，请检查服务商速度、VPN和模型响应预算':'模型网络连接失败，请检查VPN分流及中转站地址');}
  if(!response.ok){
   try{data=await payload(response);}catch{data={};}
   // Only a root endpoint can acquire /v1; never guess a different host or rewrite custom prefixes.
   if(!pathRetried&&[404,405].includes(response.status)&&new URL(endpoint).pathname===(protocol==='responses'?'/responses':'/chat/completions')){const next=new URL(endpoint);next.pathname='/v1'+next.pathname;endpoint=next.href;pathRetried=true;continue;}
   const error=String(data?.error?.message||data?.message||'');
   if(protocol==='chat'&&!paramRetried&&[400,422].includes(response.status)&&/max_tokens/i.test(error)&&/max_completion_tokens/i.test(error)){
    request.max_completion_tokens=request.max_tokens;delete request.max_tokens;paramRetried=true;continue;
   }
   throw apiError(response.status,data);
  }
  data=await payload(response);onUsage(data.usage?{...data.usage,prompt_tokens:data.usage.prompt_tokens??data.usage.input_tokens,completion_tokens:data.usage.completion_tokens??data.usage.output_tokens}:{});
  const answer=extract(data,protocol);
  if(typeof answer==='string'&&answer.trim())return answer;
  const choice=data.choices?.[0];
  if(choice?.message?.refusal)throw new Error('服务商拒绝了本次内容，未向QQ发送回复');
  if(choice?.finish_reason==='length'||data.status==='incomplete'||choice?.message?.reasoning_content)throw new Error('模型只返回思考或耗尽回复预算，未返回正文；请换非思考模型或增加回复Token');
  if(data.error)throw apiError(response.status,data);
  throw new Error('模型返回空正文；请核对卡片协议和模型能力');
 }
}
