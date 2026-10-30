import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import dns from 'node:dns/promises';
import {webUrl,publicAddress,readWeb,htmlText} from './web-learning.mjs';

export const PLATFORMS=[
 {id:'bilibili',name:'B站',hosts:['bilibili.com','b23.tv','bili2233.cn'],images:['hdslb.com'],cookie:'bilibili_cookies'},
 {id:'douyin',name:'抖音',hosts:['douyin.com','iesdouyin.com','amemv.com','jinritemai.com','ttwid.bytedance.com'],images:['douyinpic.com','douyincdn.com','byteimg.com','pstatp.com','bytedance.com','ecombdimg.com'],cookie:'douyin_cookies'},
 {id:'fanqie',name:'番茄小说',hosts:['changdunovel.com','fanqienovel.com'],images:['byteimg.com','fanqienovel.com','changdunovel.com']},
 {id:'redbook',name:'小红书',hosts:['xiaohongshu.com','xiaohongshu.cn','xhslink.com','xhslink.cn'],images:['xhscdn.com','xiaohongshu.com'],cookie:'redbook_cookies'},
 {id:'tieba',name:'贴吧',hosts:['tieba.baidu.com','tiebac.baidu.com'],images:['bdimg.com','baidu.com','bdstatic.com','bcebos.com'],cookie:'tieba_cookies'},
 {id:'weibo',name:'微博',hosts:['weibo.com','weibo.cn','sina.com.cn','sina.cn'],images:['sinaimg.cn','sinaimg.com'],cookie:'weibo_cookies'},
 {id:'wechat',name:'微信',hosts:['mp.weixin.qq.com','weixin.qq.com','channels.weixin.qq.com','yuanbao.tencent.com'],images:['qpic.cn','qlogo.cn','finder.video.qq.com'],cookie:'wechat_yuanbao_cookies'},
 {id:'xiaoheihe',name:'小黑盒',hosts:['xiaoheihe.cn','heybox.com','heybox.cn'],images:['max-c.com','xiaoheihe.cn'],cookie:'xiaoheihe_cookies'},
 {id:'zhihu',name:'知乎',hosts:['zhihu.com','zhihu.com.cn'],images:['zhimg.com'],cookie:'zhihu_cookies'},
 {id:'github',name:'GitHub',hosts:['github.com'],images:['opengraph.githubassets.com','repository-images.githubusercontent.com']},
 {id:'qqchannel',name:'腾讯频道',hosts:['pd.qq.com'],images:['qpic.cn','photo.store.qq.com','gtimg.cn','myqcloud.com','qcloud.com']},
 {id:'qzone',name:'QQ空间分享',hosts:['qzone.qq.com'],images:['qpic.cn','photo.store.qq.com','gtimg.cn']},
 {id:'pixiv',name:'Pixiv',hosts:['pixiv.net'],images:['pximg.net'],optional:true}
];
const matches=(host,domains)=>domains.some(d=>host===d||host.endsWith('.'+d));
export const platformFor=value=>{try{const u=new URL(value);return PLATFORMS.find(p=>matches(u.hostname,p.hosts))||null;}catch{return null;}};
export function shareUrl(value){
 let s=String(value||'').replace(/&amp;/g,'&').trim().replace(/[.,;，。；、!！?？)）\]】]+$/g,'');
 if(s.startsWith('//'))s='https:'+s;
 if(s.startsWith('http://')&&platformFor(s))s='https://'+s.slice(7);
 if(s.length>8192)throw new Error('分享链接过长');
 return webUrl(s).href;
}
export function sharedLinks(text){
 const out=[];
 for(const m of String(text).slice(0,12000).matchAll(/https?:\/\/[^\s<>"'「」]+/gi))try{const u=shareUrl(m[0]);if(!out.includes(u))out.push(u);if(out.length===2)break;}catch{}
 return out;
}
export function shareCards(event){
 const cards=[];
 for(const s of (Array.isArray(event?.message)?event.message:[]).slice(0,32)){
  if(!['json','xml'].includes(s.type))continue;
  const raw=s.data?.data;if(typeof raw!=='string'||raw.length>65536)continue;
  let url='',title='',preview='',metadata={};
  if(s.type==='json')try{
   const data=JSON.parse(raw),meta=data?.meta;if(!meta||typeof meta!=='object')continue;
   for(const item of Object.values(meta).slice(0,8)){
    if(!item||typeof item!=='object')continue;
    const candidate=item.qqdocurl||item.jumpUrl||item.contentJumpUrl||item.url||'';
    if(typeof candidate!=='string'||!/^https?:\/\//.test(candidate))continue;
    url=candidate;title=item.title||item.desc||data.prompt||'';preview=item.preview||item.image||item.cover||'';
    const feed=item.feed||item;const feedId=feed.feed_id||feed.feedId||feed.id;
    if(typeof feedId==='string'&&/^B_[A-Za-z0-9_-]{1,190}$/.test(feedId))metadata={feed_id:feedId};
    break;
   }
  }catch{continue;}
  else{
   url=raw.match(/\burl\s*=\s*["'](https?:\/\/[^"']+)["']/i)?.[1]||'';
   title=htmlText(raw.match(/<title\b[^>]*>([^]*?)<\/title>/i)?.[1],160);
   preview=raw.match(/<picture\b[^>]*cover\s*=\s*["']([^"']+)["']/i)?.[1]||'';
  }
  try{url=shareUrl(url);}catch{continue;}
  try{preview=shareUrl(preview);}catch{preview='';}
  if(!cards.some(c=>c.url===url))cards.push({url,title:htmlText(typeof title==='string'?title:'',160),preview,metadata});
  if(cards.length===2)break;
 }
 return cards;
}
export const cardText=cards=>cards.map(c=>'（分享'+(c.title?'：'+c.title:'链接')+'）\n'+c.url).join('\n');

export async function parserRequest(request,platform,fetcher=fetch,resolve=host=>dns.lookup(host,{all:true}),signal){
 const url=shareUrl(request.url);
 if(!matches(new URL(url).hostname,platform.hosts))throw new Error('平台跳转到不支持的地址');
 const ips=await resolve(new URL(url).hostname);if(!ips.length||ips.some(ip=>!publicAddress(ip.address)))throw new Error('平台域名指向内网，未读取');
 if(!['GET','POST'].includes(request.method)||typeof request.body!=='string'||request.body.length>65536)throw new Error('平台请求无效');
 // Only the QQ channel's public detail endpoint needs a read-only POST.
 if(request.method==='POST'&&!(platform.id==='qqchannel'&&new URL(url).pathname.endsWith('/GetFeedDetail'))&&!(platform.id==='douyin'&&new URL(url).hostname==='ttwid.bytedance.com'&&new URL(url).pathname==='/ttwid/union/register/'))throw new Error('解析器只允许读取公开内容');
 const headers={};
 for(const [k,v] of Object.entries(request.headers||{}))if(['accept','accept-language','user-agent','referer','origin','content-type','cookie','x-requested-with','x-oidb','x-qq-client-appid'].includes(k.toLowerCase())&&typeof v==='string'&&!/[\r\n]/.test(v))headers[k]=v;
 const response=await fetcher(url,{method:request.method,headers,...(request.method==='POST'?{body:request.body}:{}),redirect:'manual',credentials:'omit',signal,networkTimeoutMs:8000});
 const reader=response.body?.getReader(),chunks=[];let bytes=0;
 if(reader)try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>4*1024*1024)throw new Error('平台资料超过4MB');chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 // Reject private redirects before the next parser request, even on Android.
 const location=response.headers.get('location');if(location){const next=shareUrl(new URL(location,url).href);if(!matches(new URL(next).hostname,platform.hosts))throw new Error('平台跳转到不支持的地址');}
 return {id:request.fetch,status:response.status,headers:Object.fromEntries([...response.headers].filter(([k])=>['content-type','location','set-cookie'].includes(k))),body:Buffer.concat(chunks).toString('base64')};
}

export async function readShare(value,fetcher=fetch,options={}){
 const url=shareUrl(value),platform=platformFor(url);
 if(!platform)return readWeb(url,fetcher,options.resolve,options);
 if(platform.optional&&options.pixiv!==true)throw new Error('Pixiv解析未开启，请在联网设置中开启后读取公开插画');
 const runtime=options.runtime||process.env.QQWB_PARSER_RUNTIME||path.join(path.dirname(fileURLToPath(import.meta.url)),'parser');
 const python=options.python||process.env.QQWB_PARSER_PYTHON||'/usr/bin/python3';
 const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(25000),...(options.signal?[options.signal]:[])]);
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(python,['-I','-B',path.join(runtime,'worker.py')],{cwd:runtime,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{PATH:process.env.PATH||'',LANG:'C.UTF-8',PYTHONIOENCODING:'utf-8'}});
  let buffer='',finished=false,calls=0;
  const finish=(error,value)=>{if(finished)return;finished=true;signal.removeEventListener('abort',abort);child.stdin.destroy();child.kill();error?reject(error):resolve(value);};
  const abort=()=>finish(new Error('平台解析超时或已取消，未读取完整内容'));
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted){abort();return;}
  child.on('error',()=>finish(new Error('多平台解析组件未就绪，请重新启动本地服务')));
  child.stdin.on('error',()=>finish(new Error('多平台解析组件已退出')));
  child.on('close',()=>{if(!finished)finish(new Error('多平台解析未完成'));});
  child.stdout.on('data',chunk=>{
   buffer+=chunk.toString('utf8');if(buffer.length>100000){finish(new Error('平台解析结果超过上限'));return;}
   while(buffer.includes('\n')){
    const at=buffer.indexOf('\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+1);let data;
    try{data=JSON.parse(line);}catch{finish(new Error('平台解析响应无效'));return;}
    if(data.result){finish(null,data.result);return;}
    if(data.error){finish(new Error('平台资料读取失败，可能需要登录、链接失效或站点限制访问；未读取完整内容。'));return;}
    if(!Number.isInteger(data.fetch)||++calls>12){finish(new Error('平台请求超过上限'));return;}
    void parserRequest(data,platform,fetcher,options.resolve,signal).then(r=>{if(!finished)child.stdin.write(JSON.stringify(r)+'\n');},()=>{if(!finished)child.stdin.write(JSON.stringify({id:data.fetch,error:true})+'\n');});
   }
  });
  const cookies=platform.cookie?{[platform.cookie]:String(options.cookies?.[platform.cookie]||'').slice(0,8192)}:{};
  child.stdin.write(JSON.stringify({platform:platform.id,text:url,cards:(options.cards||[]).filter(c=>c.url===url).slice(0,2),cookies})+'\n');
 });
 controller.abort();
 const content='平台：'+platform.name+(result.author?'\n作者：'+htmlText(result.author,100):'')+'\n'+htmlText(result.content,3000)+'\n资料范围：作品标题、公开正文/简介与可用配图；未观看视频、未听音轨，不能据封面编造完整视频内容。';
 const images=(Array.isArray(result.images)?result.images:[]).flatMap(raw=>{try{const u=shareUrl(String(raw).replace(/^http:\/\//,'https://'));return matches(new URL(u).hostname,platform.images)?[u]:[];}catch{return [];}}).slice(0,2);
 if(!String(result.content||'').trim()&&!result.title&&!images.length)throw new Error('没有读取到可用的作品内容');
 return [{title:htmlText(result.title,160)||platform.name+'分享内容',url,content,images,platform:platform.id}];
}

export async function shareImageParts(items,fetcher=fetch,detail='low',resolve=host=>dns.lookup(host,{all:true})){
 const parts=[];
 for(const item of items.slice(0,2)){
  const platform=PLATFORMS.find(p=>p.id===item.platform);if(!platform)continue;
  for(const raw of (item.images||[]).slice(0,2))try{
   if(parts.length===2)return parts;let url=shareUrl(raw);const signal=AbortSignal.timeout(8000);
   for(let redirects=0;redirects<3;redirects++){
    if(!matches(new URL(url).hostname,platform.images))throw 0;
    const ips=await resolve(new URL(url).hostname);if(!ips.length||ips.some(ip=>!publicAddress(ip.address)))throw 0;
    const r=await fetcher(url,{headers:{Referer:item.url},redirect:'manual',credentials:'omit',signal,networkTimeoutMs:8000});
    if([301,302,303,307,308].includes(r.status)){await r.body?.cancel();url=shareUrl(new URL(r.headers.get('location'),url).href);continue;}
    const type=r.headers.get('content-type')?.split(';')[0].trim();
    if(!r.ok||!['image/jpeg','image/png','image/webp','image/gif'].includes(type)){await r.body?.cancel();break;}
    const reader=r.body.getReader(),chunks=[];let bytes=0;
    try{while(true){const n=await reader.read();if(n.done)break;bytes+=n.value.length;if(bytes>3*1024*1024)throw 0;chunks.push(n.value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    if(bytes)parts.push({type:'image_url',image_url:{url:'data:'+type+';base64,'+Buffer.concat(chunks).toString('base64'),detail:detail==='low'?'low':'auto'}});
    break;
   }
  }catch{/* Text remains usable when a source image cannot be downloaded. */}
 }
 return parts;
}
