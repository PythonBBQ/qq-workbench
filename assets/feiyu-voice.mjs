// Independent implementation of the documented Feiyu Voice Service HTTP protocol.
// No upstream plugin source, voice weights, recordings or server are bundled.
export function feiyuBase(value){
  let url;try{url=new URL(value);}catch{throw new Error('请填写肥鱼声音服务地址');}
  const host=url.hostname,parts=host.split('.'),ipv4=parts.length===4&&parts.every(v=>/^\d{1,3}$/.test(v)&&Number(v)<=255),privateIp=ipv4&&(parts[0]==='10'||parts[0]==='192'&&parts[1]==='168'||parts[0]==='172'&&Number(parts[1])>=16&&Number(parts[1])<=31),local=['127.0.0.1','localhost','[::1]'].includes(host);
  if((url.protocol!=='https:'&&!(url.protocol==='http:'&&(local||privateIp)))||url.username||url.password||url.search||url.hash)throw new Error('肥鱼服务需HTTPS，或本机/局域网HTTP地址，不含账号和查询参数');
  return url.href.replace(/\/$/,'');
}
async function boundedJson(response){const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>65536)throw new Error('肥鱼服务返回信息过大');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('肥鱼服务未返回有效任务信息');}}
export async function feiyuSpeech(config,text,{key,fetcher=fetch,stillCurrent=()=>true,now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeout=55000,emotion='neutral'}={}){
  const base=feiyuBase(config.feiyuUrl||'');if(!key)throw new Error('请为肥鱼声音服务单独填写Key');
  const started=now(),deadline=started+Math.min(55000,timeout),style=config.feiyuStyle==='gentle'?'gentle':config.feiyuStyle==='cute'?'cute':['gentle','shy','sad','serious'].includes(emotion)?'gentle':'cute';
  async function request(route,data){if(!stillCurrent())throw new Error('语音已取消');if(now()>=deadline)throw new Error('肥鱼语音等待超时，本次用文字，不重复提交');let response;try{response=await fetcher(base+route,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)}),redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-now()))),networkTimeoutMs:Math.max(500,Math.min(15000,deadline-now()))});}catch{throw new Error('肥鱼声音服务连接失败，请检查服务地址、网络和运行状态');}if(!response.ok)throw new Error([401,403].includes(response.status)?'肥鱼声音服务鉴权失败，请检查单独的Key':'肥鱼声音服务未完成（HTTP '+response.status+'）');return response;}
  // Submission is attempted once: a lost ACK must not create a duplicate GPU job.
  const task=await boundedJson(await request('/v1/speech',{voice:String(config.feiyuVoice||'feiyu').slice(0,60),text,style}));
  if(!/^[0-9a-f]{32}$/.test(task.id||''))throw new Error('肥鱼服务返回的任务编号无效');
  while(now()<deadline){const state=await boundedJson(await request('/v1/jobs/'+task.id));
    if(state.status==='success'){
      const response=await request('/v1/jobs/'+task.id+'/audio'),chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>6*1024*1024)throw new Error('肥鱼语音音频过大');chunks.push(chunk);}const bytes=Buffer.concat(chunks);if(bytes.length<44||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE')throw new Error('肥鱼服务没有返回有效WAV');if(!stillCurrent())throw new Error('语音已取消');return {bytes,style};
    }
    if(['failed','interrupted','cancelled'].includes(state.status))throw new Error('肥鱼语音任务失败或中断，请检查声音服务日志');
    if(!['queued','running'].includes(state.status))throw new Error('肥鱼语音任务状态无效');await wait(Math.min(1200,Math.max(0,deadline-now())));
  }throw new Error('肥鱼语音等待超时，本次用文字，不重复提交');
}
