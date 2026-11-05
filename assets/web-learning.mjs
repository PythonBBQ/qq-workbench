import dns from 'node:dns/promises';
import net from 'node:net';

export function publicAddress(ip){
  const s=ip.toLowerCase().replace(/^::ffff:/,'');
  if(net.isIPv4(s)){const [a,b]=s.split('.').map(Number);return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a>=224);}
  return net.isIPv6(s)&&s!=='::'&&s!=='::1'&&!/^(?:fc|fd|fe[89ab]|ff)/.test(s);
}
export function webUrl(value){
  let u;try{u=new URL(value);}catch{throw new Error('请填写公开 HTTPS 网页链接');}
  const host=u.hostname.replace(/^\[|\]$/g,'');
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||host==='localhost'||host.endsWith('.local')||host.endsWith('.localhost')||!host.includes('.')||net.isIP(host)&&!publicAddress(host))throw new Error('只读取公开 HTTPS 网页，不访问本机或内网');
  u.hash=''; // Page anchors are local browser positions, not another resource.
  return u;
}
export const htmlText=(value,limit=4000)=>String(value||'').replace(/<!--[^]*?-->/g,' ').replace(/<(script|style|noscript|svg|nav|footer|header)\b[^>]*>[^]*?<\/\1\s*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}).replace(/&(nbsp|amp|lt|gt|quot|apos);/g,(_,k)=>({nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[k])).replace(/\s+/g,' ').trim().slice(0,limit);
async function bounded(operation,signal){
  signal.throwIfAborted();let abort;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});})]);}
  finally{if(abort)signal.removeEventListener('abort',abort);}
}
async function html(value,fetcher,resolve,{signal:outer,timeoutMs=8000}={}){
  let u=webUrl(value);const signal=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(outer?[outer]:[])]);
  for(let i=0;i<4;i++){
    const addresses=await bounded(()=>resolve(u.hostname),signal);if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error('网页域名解析到内网地址，未读取');
    const r=await bounded(()=>fetcher(u.href,{headers:{Accept:'text/html,application/xhtml+xml','User-Agent':'Mozilla/5.0 (compatible; QiqiuWorkbench/0.1.17)'},redirect:'manual',credentials:'omit',signal,networkTimeoutMs:timeoutMs}),signal);
    if([301,302,303,307,308].includes(r.status)){await r.body?.cancel();const to=r.headers.get('location');if(!to)throw new Error('网页跳转缺少地址');u=webUrl(new URL(to,u).href);continue;}
    if(!r.ok)throw new Error('网页暂不可读（HTTP '+r.status+'），未绕过网站限制');
    if(!/text\/html|application\/xhtml\+xml|text\/plain/i.test(r.headers.get('content-type')||'')){await r.body?.cancel();throw new Error('仅支持公开网页文字，不下载附件或视频');}
    const chunks=[];let size=0;
    if(!r.body)throw new Error('网页返回空内容');
    const reader=r.body.getReader();
    try{while(true){const {value:chunk,done}=await bounded(()=>reader.read(),signal);if(done)break;size+=chunk.length;if(size>1024*1024)throw new Error('网页超过 1MB 读取上限');chunks.push(chunk);}}
    finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
    const bytes=Buffer.concat(chunks),encoding=(r.headers.get('content-type')||'').match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]||bytes.subarray(0,4096).toString('ascii').match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]||'utf-8';
    let source;try{source=new TextDecoder(encoding).decode(bytes);}catch{source=bytes.toString('utf8');}
    return {url:u.href,source};
  }throw new Error('网页跳转次数过多');
}
const resolver=host=>dns.lookup(host,{all:true});
function pageExcerpt(text,question,limit=3200){
  if(text.length<=limit)return text;
  if(/后半(?:部分|段)?|后面的?(?:内容|部分|段落)|结尾|末尾|最后(?:一段|部分|章节)/.test(String(question||'')))return text.slice(0,400)+'\n（中间部分省略）\n'+text.slice(-(limit-450));
  const query=String(question||'').replace(/https?:\/\/\S+|www\.\S+/gi,'').replace(/这个|网页|文章|页面|里面|内容|什么|一下|帮我|看看|总结|概括|重新|读取/g,'');
  const terms=[...new Set([...(query.toLowerCase().match(/[a-z0-9_-]{3,}/g)||[]),...(query.match(/[\u3400-\u9fff]{2,}/g)||[]).flatMap(word=>Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2)))])].slice(0,60);
  const windows=[];
  for(let at=0;at<text.length;at+=700){const body=text.slice(at,at+900),lower=body.toLowerCase(),score=terms.reduce((n,term)=>n+(lower.includes(term)?1:0),0);if(score)windows.push({at,score});}
  const selected=windows.sort((a,b)=>b.score-a.score||a.at-b.at).slice(0,2).sort((a,b)=>a.at-b.at);
  if(!selected.length)return text.slice(0,limit);
  const ranges=[{at:0,end:500},...selected.map(w=>({at:w.at,end:Math.min(text.length,w.at+900)}))],merged=[];
  for(const range of ranges){const last=merged.at(-1);if(last&&range.at<=last.end)last.end=Math.max(last.end,range.end);else merged.push(range);}
  return merged.map(range=>text.slice(range.at,range.end)).join('\n（中间部分省略）\n').slice(0,limit);
}
export async function readWeb(value,fetcher=fetch,resolve=resolver,options={}){
  const {url,source}=await html(value,fetcher,resolve,options);
  const title=htmlText(source.match(/<title\b[^>]*>([^]*?)<\/title>/i)?.[1],160)||new URL(url).hostname;
  const main=source.match(/<(?:article|main)\b[^>]*>([^]*?)<\/(?:article|main)>/i)?.[1]||source;
  const body=htmlText(main,60000);if(body.length<30)throw new Error('网页没有可读取的正文，可能需要登录或浏览器脚本');
  if(/^(?:just a moment|access denied|attention required|安全验证|访问验证|人机验证|登录后继续)[.!！。\s]*$/i.test(title))throw new Error('网页要求登录或访问验证，未读取到文章正文');
  const content=pageExcerpt(body,options.question),truncated=body.length>content.length;
  return [{title,url,content:'资料范围：公开网页正文摘录；未执行网页脚本，未登录网站。'+(truncated?'正文较长，本次按问题选择部分段落，不代表全文。':'')+'\n'+content}];
}
export function searchResults(source,engineUrl){
  const pattern=new URL(engineUrl).hostname.endsWith('duckduckgo.com')?
    /<div\b[^>]*class=["'][^"']*result results_links[^"']*["'][^>]*>([^]*?)(?=<div\b[^>]*class=["'][^"']*result results_links|$)/gi:
    /<li\b[^>]*class=["'][^"']*b_algo[^"']*["'][^>]*>([^]*?)<\/li>/gi;
  const items=[];
  for(const match of source.matchAll(pattern))try{
    const block=match[1],heading=block.match(/<h2\b[^>]*>([^]*?)<\/h2>/i)?.[1]||block;
    const anchors=[...heading.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([^]*?)<\/a>/gi)];
    const anchor=anchors.find(a=>/result__a/.test(a[0]))||anchors[0];
    if(!anchor)continue;let target=htmlText(anchor[1],2048),parsed=new URL(target,engineUrl);
    if(parsed.hostname==='duckduckgo.com'||parsed.hostname.endsWith('.duckduckgo.com'))target=parsed.searchParams.get('uddg')||target;
    else if((parsed.hostname==='bing.com'||parsed.hostname.endsWith('.bing.com'))&&parsed.pathname==='/ck/a'){
      const encoded=parsed.searchParams.get('u')||'';target=encoded.startsWith('a1')?Buffer.from(encoded.slice(2),'base64url').toString('utf8'):target;
    }
    const dest=webUrl(target),title=htmlText(anchor[2],160);
    if(!title||dest.hostname==='bing.com'||dest.hostname.endsWith('.bing.com')||dest.hostname==='duckduckgo.com'||dest.hostname.endsWith('.duckduckgo.com')||items.some(n=>n.url===dest.href))continue;
    items.push({title,url:dest.href,content:'资料范围：搜索结果摘要，未读取目标网页全文。\n'+htmlText(block,1000)});
    if(items.length===3)break;
  }catch{/* A malformed or non-HTTPS result must not discard other results. */}
  return items;
}
export async function searchWeb(query,fetcher=fetch,resolve=resolver,options={}){
  const term=String(query).trim().slice(0,120);if(!term)throw new Error('请填写网页搜索主题');
  const engines=['https://cn.bing.com/search?q='+encodeURIComponent(term),'https://html.duckduckgo.com/html/?q='+encodeURIComponent(term)];
  const stop=new AbortController(),signal=AbortSignal.any([stop.signal,AbortSignal.timeout(options.timeoutMs||7000),...(options.signal?[options.signal]:[])]);
  const search=async url=>{const page=await html(url,fetcher,resolve,{signal,timeoutMs:options.timeoutMs||7000}),items=searchResults(page.source,page.url);if(!items.length)throw new Error('empty results');return items;};
  let timer;
  try{
    // Hedge only a slow/failing primary. Fast searches avoid a second request.
    const primary=search(engines[0]);let startBackup;
    const fallback=new Promise(resolve=>{startBackup=resolve;timer=setTimeout(resolve,650);});
    void primary.catch(()=>startBackup());
    return await Promise.any([primary,fallback.then(()=>{signal.throwIfAborted();return search(engines[1]);})]);
  }catch{throw new Error('公开网页搜索暂不可用；可在浏览器搜索后粘贴 HTTPS 链接读取');}
  finally{clearTimeout(timer);stop.abort();}
}
export async function browseWeb(query,fetcher=fetch,resolve=resolver){
  const signal=AbortSignal.timeout(12000);
  const items=await searchWeb(query,fetcher,resolve,{signal});
  // Read two sources in parallel once. Keep their snippets if a site requires
  // scripts/login or refuses the request; never describe snippets as full text.
  const pages=await Promise.allSettled(items.slice(0,2).map(n=>readWeb(n.url,fetcher,resolve,{signal,timeoutMs:2500})));
  return items.map((item,i)=>pages[i]?.status==='fulfilled'?{...pages[i].value[0],searchTitle:item.title}:{...item,content:item.content+'\n目标网页正文未读取，本条仅供搜索摘要参考。'});
}
