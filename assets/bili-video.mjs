import {contextText} from './images.mjs';
import {browsingDeclined} from './browse-intent.mjs';
import {publicAddress,webUrl,htmlText,searchWeb} from './web-learning.mjs';
import {sampledVideo} from './video.mjs';
import dns from 'node:dns/promises';

const bvidPattern=/BV[0-9A-Za-z]{10}(?![0-9A-Za-z])/;
const pageHosts=new Set(['bilibili.com','www.bilibili.com','m.bilibili.com','b23.tv','www.b23.tv','bili2233.cn']);
const mediaDomains=['bilivideo.com','bilivideo.cn','bilivideo.net'];
export function biliReference(text){
  const s=String(text||'').slice(0,12000);
  for(const m of s.matchAll(/https?:\/\/[^\s<>"'「」]+/gi))try{
    const u=webUrl(m[0].replace(/[，。；、!！?？)）\]】]+$/g,''));
    if(pageHosts.has(u.hostname)&&(/^\/video\/(BV[0-9a-zA-Z]{10}|av\d+)(?:\/|$)/.test(u.pathname)||['b23.tv','www.b23.tv','bili2233.cn'].includes(u.hostname)))return u.href;
  }catch{}
  const bv=s.match(bvidPattern)?.[0];return bv?'https://www.bilibili.com/video/'+bv:null;
}
export function biliVideoIntent(text,{history=[],cards=[],automatic=true}={}){
  const s=String(text||'');
  if(browsingDeclined(s)||/(?:不要|不用|别|无需).{0,8}(?:看|读|下载).{0,5}视频|(?:只|仅)(?:看|读|要|查|搜索|搜)?(?:一下)?(?:标题|简介|封面|资料|链接)/.test(s))return null;
  const wants=/(?:继续看|接着看|看(?:这个|那个|一下这个)?视频|看这个|看完|看一看|看看|看下|看一下|观看|读懂|看懂|理解|分析|总结|概括|讲解|学习|读视频|视频内容|发生了什么|讲了什么)/.test(s);
  const current=biliReference(s)||cards.map(c=>biliReference(c.url)).find(Boolean);
  if(current&&(wants||automatic&&s.length<180))return {url:current,fromHistory:false};
  if(current)return null;
  const followup=s.replace(/^@(?:deepseek|codex)\s*/i,'').trim();
  const referenceOnly=/^(?:(?:请|你|帮我|麻烦|再|继续|接着|刚才|上面|这个|那个|这段|那段|的|把|在|B站|bilibili|哔站|哔哩哔哩|看完|观看|看懂|分析|总结|概括|看看|看下|看一下|看|视频|全部|完整|内容|一下|下|吧|呀|啊)|[\s，,。.!！?？：:])+$/i.test(followup);
  const recent=history.filter(m=>m.role==='user').slice(-6);
  const inBiliConversation=recent.some(m=>biliReference(contextText(m.content))||/(?:B站|bilibili|哔站|哔哩哔哩)/i.test(contextText(m.content)));
  const search=referenceOnly?'':biliSearchQuery(s)||(inBiliConversation&&wants&&/视频/.test(s)?biliSearchQuery('B站 '+s):'');
  if(search)return {kind:'search',query:search,fromHistory:false};
  // A new named topic must never borrow an unrelated historical BV.
  // Only an entirely referential follow-up may use the previous video link.
  if(referenceOnly&&wants&&!/(?:搜索|搜|找)/.test(followup)){
    // Only this conversation's recent user messages can supply a missing link.
    for(const m of history.filter(m=>m.role==='user').slice(-6).reverse()){
      const url=biliReference(contextText(m.content));if(url)return {url,fromHistory:true};
    }
  }
  return null;
}
export function biliSearchQuery(text){
  const s=String(text||'').replace(/^@(?:deepseek|codex)\s*/i,'').trim();
  if(browsingDeclined(s)||!/(?:B站|bilibili|哔站|哔哩哔哩)/i.test(s)||!/(?:搜索|搜|找|看看|看下|看一下|观看|看.*视频|总结.*视频|分析.*视频)/.test(s))return '';
  if(/(?:只|仅).{0,4}(?:简介|标题|封面)/.test(s))return '';
  const q=s.replace(/(?:B站|bilibili|哔站|哔哩哔哩)/ig,' ').trim().replace(/^(?:(?:请|帮我|麻烦|你|到|在|去|上|给我|再|重新|搜索|搜一搜|搜一下|搜下|搜|找一个|找个|找一下|找|看看|看一看|看一下|看下|看|观看|分析|总结|概括)\s*)+/,'').replace(/(?:的)?(?:相关)?(?:一个|一些|几个)?(?:视频|短片|片段)(?:来)?(?:看看|看一下|看下|看|分析|总结|学习)?[。！!？?,，\s]*$/,'').replace(/^(?:关于|有关)\s*/,'').replace(/[“”「」『』"']/g,'').trim().slice(0,80);
  if(!q||/^(?:(?:再|重新|继续|这个|那个|刚才|上面|这段|那段|的|视频|内容|全部|完整|一下|下|吧|呀|啊)|\s)+$/.test(q))return '';
  return q;
}
function searchItem(v){
  if(!/^BV[0-9A-Za-z]{10}$/.test(v?.bvid||''))return null;
  const time=String(v.duration||'').split(':').map(Number);const duration=time.length===2?time[0]*60+time[1]:time.length===3?time[0]*3600+time[1]*60+time[2]:Number(v.duration);
  if(!Number.isFinite(duration)||duration<=0||duration>600)return null;
  return {bvid:v.bvid,url:'https://www.bilibili.com/video/'+v.bvid,title:htmlText(v.title,160),author:htmlText(v.author,80),description:htmlText(v.description,400),duration};
}
export async function searchBiliVideo(query,fetcher=fetch,{cookie='',signal:outer,resolve=host=>dns.lookup(host,{all:true}),exclude=[]}={}){
  const term=String(query||'').trim().slice(0,80);if(!term)throw new Error('请告诉我要搜索的视频主题');
  if(typeof cookie!=='string'||cookie.length>8192||/[\r\n]/.test(cookie))throw new Error('B站登录资料无效');
  const signal=AbortSignal.any([AbortSignal.timeout(25000),...(outer?[outer]:[])]);let items=[],method='B站搜索',primaryFailure='';
  try{
    const data=await readJson('https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&page_size=10&order=totalrank&keyword='+encodeURIComponent(term),fetcher,cookie,signal);
    items=(Array.isArray(data?.result)?data.result:[]).slice(0,10).map(searchItem).filter(Boolean);
  }catch(error){primaryFailure=error.message;}
  if(!items.length){
    // Real fresh search only. Never replace a failed search with a stored BV.
    try{
      const results=await searchWeb(term+' 视频 site:bilibili.com/video/',fetcher,resolve,{signal,timeoutMs:6500});method='公开网页检索B站';
      items=results.flatMap(item=>{try{const u=webUrl(item.url);if(!['www.bilibili.com','bilibili.com','m.bilibili.com'].includes(u.hostname))return [];const bv=u.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1];return bv?[{bvid:bv,url:'https://www.bilibili.com/video/'+bv,title:htmlText(item.title,160),author:'',description:htmlText(item.content,400),duration:null}]:[];}catch{return [];}});
    }catch{}
  }
  const terms=[term,...term.match(/[a-zA-Z0-9]{2,}|[\u3400-\u9fff]{2,}/g)||[]];
  const score=item=>terms.reduce((n,t)=>n+((item.title+' '+item.author+' '+item.description).toLowerCase().includes(t.toLowerCase())?t.length:0),0);
  items=items.filter(v=>!exclude.includes(v.bvid)&&score(v)>0).map((v,index)=>({...v,index,score:score(v)})).sort((a,b)=>b.score-a.score||a.index-b.index);
  if(!items.length)throw new Error((primaryFailure?'B站搜索未成功且网页搜索未找到匹配结果':'没有找到与“'+term+'”匹配的10分钟以内视频')+'；本次没有选用历史视频。可换关键词、登录B站或发送具体BV号');
  const picked=items[0];return {...picked,query:term,method,resultCount:items.length,searchedAt:new Date().toISOString()};
}
export async function readBiliSearchFrames(query,token,fetcher=fetch,options={}){
  options.onStatus?.('正在重新搜索B站视频：'+query);
  const selected=await searchBiliVideo(query,fetcher,options);
  options.onStatus?.('本次搜索选中：'+selected.title+' · '+selected.bvid);
  const video=await readBiliFrames(selected.url,token,fetcher,options);
  return {...video,search:selected,scope:'本次新搜索“'+selected.query+'”，来源：'+selected.method+'，时间：'+selected.searchedAt+'\n'+video.scope};
}
export function biliMediaUrl(value){
  const u=webUrl(value);
  if(!mediaDomains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))throw new Error('B站返回了不支持的媒体地址，未下载');
  return u.href;
}
async function readJson(url,fetcher,cookie,signal){
  const headers={Accept:'application/json','User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'};
  if(cookie)headers.Cookie=cookie;
  const r=await fetcher(url,{headers,redirect:'error',credentials:'omit',signal,networkTimeoutMs:12000});
  if(!r.ok){await r.body?.cancel();throw new Error('B站接口暂不可用（HTTP '+r.status+'），请检查B站登录状态或稍后重试');}
  let bytes=0;const chunks=[];for await(const chunk of r.body||[]){bytes+=chunk.length;if(bytes>1024*1024)throw new Error('B站接口资料超过上限');chunks.push(chunk);}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('B站未返回有效资料，请检查网络或站点验证');}
  if(data.code!==0){
    if([-101,-400,-403,-412,62002,62012].includes(data.code))throw new Error('B站登录失效、权限受限或需要官方验证，请在能力→联网→登录B站中重新登录；未取得视频画面');
    throw new Error('B站未提供这个视频的可读资料，未取得视频画面');
  }
  return data.data;
}
export async function resolveBiliVideo(value,fetcher=fetch,{cookie='',signal:outer,resolve=host=>dns.lookup(host,{all:true})}={}){
  if(typeof cookie!=='string'||cookie.length>8192||/[\r\n]/.test(cookie))throw new Error('B站登录资料无效');
  const signal=AbortSignal.any([AbortSignal.timeout(40000),...(outer?[outer]:[])]);
  let url=webUrl(value);
  for(let i=0;['b23.tv','www.b23.tv','bili2233.cn'].includes(url.hostname);i++){
    if(i>=3)throw new Error('B站短链接跳转过多');
    const r=await fetcher(url.href,{redirect:'manual',credentials:'omit',signal,networkTimeoutMs:8000});await r.body?.cancel();
    if(![301,302,303,307,308].includes(r.status)||!r.headers.get('location'))throw new Error('B站短链接暂时无法解析');
    url=webUrl(new URL(r.headers.get('location'),url).href);if(!pageHosts.has(url.hostname))throw new Error('B站短链接跳转到其他网站，未读取');
  }
  if(!pageHosts.has(url.hostname))throw new Error('只读取B站视频链接或BV号');
  const match=url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)(?:\/|$)/);if(!match)throw new Error('请选择普通B站视频，暂不支持直播、付费影视或课程');
  const id=match[1],query=id.startsWith('BV')?'bvid='+id:'aid='+id.slice(2);
  const info=await readJson('https://api.bilibili.com/x/web-interface/view?'+query,fetcher,cookie,signal);
  if(!info||!/^BV[0-9A-Za-z]{10}$/.test(info.bvid||'')||info.rights?.is_stein_gate===1)throw new Error('该视频暂不支持完整画面读取');
  const p=Number(url.searchParams.get('p')||1);if(!Number.isInteger(p)||p<1||p>1000)throw new Error('B站分P编号无效');
  const page=info.pages?.find(v=>v.page===p)||(!info.pages?.length&&p===1?{cid:info.cid,duration:info.duration}:null);
  if(!page||!Number.isSafeInteger(Number(page.cid))||Number(page.cid)<=0)throw new Error('没有找到这个分P的视频内容');
  const duration=Number(page.duration||info.duration);if(!Number.isFinite(duration)||duration<=0||duration>600)throw new Error('目前只分析10分钟以内的视频分P，请选择较短片段');
  const play=await readJson('https://api.bilibili.com/x/player/playurl?bvid='+info.bvid+'&cid='+page.cid+'&qn=16&fnval=16&fnver=0&fourk=0',fetcher,cookie,signal);
  if(play?.is_preview||play?.need_login||play?.need_vip)throw new Error('B站只返回了预览或需要额外权限，本次不把试看当作完整视频');
  const dash=(play?.dash?.video||[]).filter(v=>typeof(v.baseUrl||v.base_url)==='string').sort((a,b)=>Number(a.bandwidth||Infinity)-Number(b.bandwidth||Infinity));
  let candidates=[];
  if(dash.length){const track=dash[0];if(Number(track.bandwidth)>0&&Number(track.bandwidth)*duration/8>32*1024*1024)throw new Error('最低画质视频仍超过32MB，请导入裁剪后的本机片段');candidates=[track.baseUrl||track.base_url,...(track.backupUrl||track.backup_url||[])];}
  else if(play?.durl?.length===1){const track=play.durl[0];if(Number(track.size)>32*1024*1024)throw new Error('B站视频超过32MB，请导入裁剪后的本机片段');candidates=[track.url,...(track.backup_url||[])];}
  else throw new Error('B站暂未提供可读取的完整低清视频地址，请登录后重试；未看到视频画面');
  const urls=[];
  for(const raw of candidates)try{const media=biliMediaUrl(raw);const ips=await resolve(new URL(media).hostname);if(!ips.length||ips.some(v=>!publicAddress(v.address)))continue;if(!urls.includes(media))urls.push(media);if(urls.length===2)break;}catch{}
  if(!urls.length)throw new Error('B站媒体地址不可安全访问，未下载视频');
  return {urls,url:'https://www.bilibili.com/video/'+info.bvid+(p>1?'?p='+p:''),bvid:info.bvid,durationSeconds:duration,title:String(info.title||'B站视频').replace(/[\u0000-\u001f]/g,' ').slice(0,160),part:p};
}
export async function readBiliFrames(reference,token,fetcher=fetch,options={}){
  const resolved=await resolveBiliVideo(reference,fetcher,options);options.onStatus?.('已取得B站视频，正在下载最低画质画面并每秒抽帧');
  let failure;
  for(const url of resolved.urls){
    let sample;
    try{
      const r=await fetcher('http://127.0.0.1:13481/video-frames',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({url,source:'bilibili'}),signal:AbortSignal.timeout(510000)});
      if(!r.ok){const error=await r.json().catch(()=>({}));throw new Error(error.message||'B站画面下载或解码未完成');}sample=await r.json();
      if(typeof sample.clip==='string'){
        if(!/^clip-[a-f0-9]{32}\.bin$/.test(sample.clip)||!options.decode)throw new Error('B站兼容解码组件未就绪');
        sample=await options.decode(sample.clip);
      }
    }catch(error){
      if(options.fallback)try{sample=await options.fallback(url);}catch{failure=error;continue;}else{failure=error;continue;}
    }
    const video=sampledVideo(sample);
    if(!video.frameCount||Math.abs(sample.durationSeconds-resolved.durationSeconds)>Math.max(2,resolved.durationSeconds*.02))throw new Error('B站实际下载时长与分P不一致，未作为完整视频分析');
    return {...video,scope:'来源：'+resolved.url+'\n作品：'+resolved.title+'（第'+resolved.part+'P）\n'+video.scope,reference:resolved.url,title:resolved.title,bvid:resolved.bvid};
  }
  throw failure||new Error('B站视频暂不可读，请检查B站登录状态');
}
