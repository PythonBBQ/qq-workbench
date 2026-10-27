export function sampledVideo(data){
  if(!data||!Number.isFinite(data.durationSeconds)||data.durationSeconds<=0||data.durationSeconds>600||!Array.isArray(data.frames)||!data.frames.length||data.frames.length>4)throw new Error('视频抽帧数据不可用');
  let size=0;const content=[];
  for(const frame of data.frames){
    if(typeof frame.url!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(frame.url)||!Number.isFinite(frame.seconds)||frame.seconds<0||frame.seconds>data.durationSeconds)throw new Error('视频帧格式无效');
    size+=frame.url.length;if(size>2200000)throw new Error('视频画面超过上限');
    content.push({type:'text',text:'第 '+frame.seconds.toFixed(1)+' 秒的抽样画面'}, {type:'image_url',image_url:{url:frame.url,detail:'low'}});
  }
  return {parts:content,scope:'本次视频长 '+data.durationSeconds.toFixed(1)+' 秒，仅查看 '+data.frames.length+' 张抽样画面；未听取音轨、未读取字幕，不能声称看完全部视频。'};
}
export async function qqVideo(event,token,fetcher=fetch,fallback=null){
  const segment=(Array.isArray(event.message)?event.message:[]).find(p=>p.type==='video');if(!segment)return null;
  const value=segment.data?.url;if(typeof value!=='string')throw new Error('QQ未提供可读取的视频地址，请在工作台选择本机视频');
  const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port&&!['443'].includes(url.port)||!['qq.com','qq.com.cn','qpic.cn','gtimg.cn'].some(h=>url.hostname===h||url.hostname.endsWith('.'+h)))throw new Error('QQ视频地址不受支持，请在工作台选择本机视频');
  try{
    const r=await fetcher('http://127.0.0.1:13481/video-frames',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({url:url.href}),signal:AbortSignal.timeout(70000)});
    if(!r.ok)throw new Error('视频暂时无法读取，可能过大、链接失效或编码不支持');return sampledVideo(await r.json());
  }catch(e){if(!fallback)throw e;return sampledVideo(await fallback(url.href));}
}
