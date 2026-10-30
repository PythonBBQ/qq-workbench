import {test} from 'node:test';import assert from 'node:assert/strict';
import {biliReference,biliVideoIntent,biliFollowup,biliStateContext,biliFailureReply,biliSearchQuery,searchBiliVideo,readBiliSearchFrames,biliMediaUrl,resolveBiliVideo,readBiliFrames} from '../assets/bili-video.mjs';
const bv='BV1Umxc6JEdD',link='https://www.bilibili.com/video/'+bv;
const resolve=async()=>[{address:'93.184.216.34'}];
function sample(seconds=120){return {sampling:'1fps-contact-sheet-v1',durationSeconds:seconds,sampledSeconds:seconds,frameCount:seconds,frames:Array.from({length:Math.ceil(seconds/8)},(_,i)=>({seconds:i*8,timestamps:Array.from({length:Math.min(8,seconds-i*8)},(_,j)=>i*8+j),url:'data:image/jpeg;base64,AQID'}))};}
function mock({duration=120,preview=false,code=0,nativeFail=false}={}){
 const requests=[];
 return {requests,fetcher:async(url,options={})=>{
  requests.push({url,options});const u=new URL(url);
  if(u.hostname==='b23.tv')return new Response('',{status:302,headers:{location:link+'?p=2'}});
  if(u.hostname==='api.bilibili.com'&&u.pathname.endsWith('/view'))return Response.json({code,data:{bvid:bv,title:'Synthetic video',duration,pages:[{page:1,cid:100,duration},{page:2,cid:200,duration}]}});
  if(u.hostname==='api.bilibili.com'&&u.pathname.endsWith('/playurl'))return Response.json({code:0,data:{is_preview:preview,dash:{video:[{baseUrl:'https://video.bilivideo.com/high.mp4',bandwidth:5000000},{baseUrl:'https://video.bilivideo.com/low.mp4?token=SIGNED-NOT-FOR-MODEL',bandwidth:100000,backupUrl:['https://backup.bilivideo.com/low.mp4']}]}}});
  if(u.origin==='http://127.0.0.1:13481')return nativeFail?Response.json({message:'B站视频下载受限'},{status:502}):Response.json(sample(duration));
  throw new Error('Unexpected request');
 }};
}
test('BV and links trigger real video reading; follow-up references are limited to recent user messages in this conversation',()=>{
 assert.equal(biliReference(bv+'看看这个哔站视频'),link);assert.equal(biliReference('https://evil.test/'+bv),link);assert.equal(biliReference('https://www.bilibili.com.evil.test/video/test'),null);
 assert.equal(biliVideoIntent(bv+'看看这个哔站视频').url,link);assert.equal(biliVideoIntent('看完视频',{history:[{role:'user',content:bv}]}).fromHistory,true);
 assert.equal(biliVideoIntent('看完视频',{history:[{role:'assistant',content:bv}]}),null);assert.equal(biliVideoIntent('看完视频',{history:[]}),null);
 for(const text of ['只查简介 '+bv,'不要看视频 '+bv,'别联网 '+bv])assert.equal(biliVideoIntent(text),null);
 assert.equal(biliVideoIntent(link,{automatic:false}),null);assert.ok(biliVideoIntent('看这个视频 '+link,{automatic:false}));
 assert.equal(biliVideoIntent('',{cards:[{url:link}]}).url,link);
});
test('named Bili topics always search afresh before considering any historical video; only referential followups may resume',()=>{
 const history=[{role:'user',content:link}];
 for(const s of ['哔站看看愚鸟渡渡视频','哔站搜索看看愚鸟渡渡视频','B站搜索 愚鸟渡渡的视频','在哔哩哔哩搜一下愚鸟渡渡视频看看']){
  const intent=biliVideoIntent(s,{history});assert.equal(intent.kind,'search',s);assert.equal(intent.query,'愚鸟渡渡',s);assert.equal(intent.url,undefined);assert.equal(intent.fromHistory,false);
 }
 assert.equal(biliVideoIntent('看看其他作者的搞笑视频',{history}).kind,'search');
 assert.equal(biliVideoIntent('搜索看看愚鸟渡渡视频',{history}).query,'愚鸟渡渡');
 assert.equal(biliVideoIntent('搜索看看这个视频',{history}),null);
 assert.equal(biliVideoIntent('继续看刚才那个视频',{history}).url,link);
 assert.equal(biliVideoIntent('B站只查简介 愚鸟渡渡',{history}),null);
 assert.equal(biliSearchQuery('B站看看这个视频'),'');
});
test('fresh search chooses a relevant bounded video and never falls back to a previously supplied BV',async()=>{
 const m=mock(),requests=[];
 const fetcher=async(url,options)=>{requests.push({url,options});if(url.includes('/search/type'))return Response.json({code:0,data:{result:[{bvid:'BV1GJ411x7h7',title:'不相关的旧视频',author:'other',duration:'01:22'},{bvid:bv,title:'<em>愚鸟渡渡</em> 的新作品',author:'愚鸟渡渡',duration:'02:00'}]}});return m.fetcher(url,options);};
 const video=await readBiliSearchFrames('愚鸟渡渡','token',fetcher,{resolve,cookie:'SESSDATA=synthetic'});
 assert.equal(video.search.bvid,bv);assert.equal(video.search.query,'愚鸟渡渡');assert.match(video.scope,/本次新搜索/);assert.equal(requests.filter(r=>r.url.includes('search_type=video')).length,1);assert.ok(!requests.some(r=>r.url.includes('/view')&&r.url.includes('BV1GJ411x7h7')));assert.equal(video.frameCount,120);
 const next=await searchBiliVideo('愚鸟渡渡',fetcher,{resolve});assert.equal(requests.filter(r=>r.url.includes('search_type=video')).length,2,'explicit searches have no stale video/result cache');
 assert.equal(next.title,'愚鸟渡渡 的新作品');
 const unavailable=async(url)=>{if(url.includes('/search/type'))return Response.json({code:-412});return new Response('<html>no results</html>',{headers:{'content-type':'text/html'}});};
 await assert.rejects(()=>searchBiliVideo('不存在的主题',unavailable,{resolve}),/B站搜索暂不可用/);
});
test('Bili low-quality video selection uses only its own cookie, validates public media hosts and keeps signed media URLs out of model scope',async()=>{
 const {fetcher,requests}=mock();const result=await readBiliFrames(link,'internal-token',fetcher,{cookie:'SESSDATA=synthetic',resolve});
 assert.equal(result.frameCount,120);assert.equal(result.sheets,15);assert.match(result.scope,/作品：Synthetic video/);assert.ok(!result.scope.includes('SIGNED-NOT-FOR-MODEL'));
 for(const request of requests.filter(r=>new URL(r.url).hostname==='api.bilibili.com')){assert.equal(request.options.headers.Cookie,'SESSDATA=synthetic');assert.equal(request.options.headers.Authorization,undefined);}
 const native=requests.find(r=>r.url.startsWith('http:'));const data=JSON.parse(native.options.body);assert.equal(data.source,'bilibili');assert.match(data.url,/low\.mp4/);assert.ok(!native.options.body.includes('SESSDATA'));assert.equal(native.options.headers.Authorization,'Bearer internal-token');
 for(const url of ['https://bilivideo.com.evil.test/a','https://user:pass@video.bilivideo.com/a','http://video.bilivideo.com/a','https://video.bilivideo.com:8443/a'])assert.throws(()=>biliMediaUrl(url));
 await assert.rejects(()=>resolveBiliVideo(link,fetcher,{resolve:async()=>[{address:'127.0.0.1'}]}),/安全访问/);
});
test('short links retain selected page; previews, excess duration, missing media and login failures never become successful video observations',async()=>{
 const {fetcher,requests}=mock();const r=await resolveBiliVideo('https://b23.tv/test',fetcher,{resolve,cookie:'SESSDATA=synthetic'});assert.equal(r.part,2);assert.equal(requests[0].options.headers,undefined);assert.match(requests.find(r=>r.url.includes('playurl')).url,/cid=200/);
 for(const [settings,error] of [[{duration:601},/10分钟/],[{preview:true},/预览/],[{code:-101},/重新登录/]]){const m=mock(settings);await assert.rejects(()=>readBiliFrames(link,'token',m.fetcher,{resolve}),error);assert.ok(!m.requests.some(r=>r.url.startsWith('http:')));}
 const failed=mock({nativeFail:true});await assert.rejects(()=>readBiliFrames(link,'token',failed.fetcher,{resolve}),/下载受限/);
 await assert.rejects(()=>resolveBiliVideo('https://evil.test/',fetcher,{resolve}),/只读取B站/);
 await assert.rejects(()=>resolveBiliVideo(link,fetcher,{resolve,cookie:'a\r\nb'}),/登录资料无效/);
});
test('native bounded download hands a generated identifier to the isolated decoder and requires matching full duration',async()=>{
 const m=mock();let decodes=0;
 const fetcher=async(url,options)=>url.startsWith('http:')?Response.json({clip:'clip-'+'a'.repeat(32)+'.bin'}):m.fetcher(url,options);
 const video=await readBiliFrames(link,'token',fetcher,{resolve,decode:async id=>{assert.match(id,/^clip-a{32}\.bin$/);decodes++;return sample();}});assert.equal(video.frameCount,120);assert.equal(decodes,1);
 await assert.rejects(()=>readBiliFrames(link,'token',fetcher,{resolve,decode:async()=>sample(60)}),/时长与分P不一致/);
});

test('creator questions stay conversational and corrections reuse the actual scoped query',()=>{
 const state={query:'愚鸟渡渡',mode:'topic',status:'failed',reason:'没有匹配视频'};
 for(const text of ['是找的作者吗？','看看是找的作者吗？','你是按标题找的吗？','为什么没搜到？']){
  assert.equal(biliFollowup(text,state)?.kind,'discuss',text);assert.equal(biliVideoIntent(text,{state}),null,text);
 }
 assert.equal(biliVideoIntent('是找的作者吗？'),null);
 for(const text of ['我是说UP主','不是，是作者','找那个作者的视频']){
  const intent=biliVideoIntent(text,{state});assert.equal(intent?.query,'愚鸟渡渡',text);assert.equal(intent?.mode,'creator',text);
 }
 assert.equal(biliVideoIntent('我是说UP主'),null,'no cross-conversation query borrowing');
 assert.equal(biliVideoIntent('B站看看UP主愚鸟渡渡的视频').query,'愚鸟渡渡');
 assert.equal(biliVideoIntent('B站看看愚鸟渡渡这个UP主的视频').mode,'creator');
 assert.equal(biliVideoIntent('再试试',{state}).query,'愚鸟渡渡');
 assert.match(biliStateContext(state),/mode.*topic/);
});
test('exact creator search picks that UID works, never a similarly named author or a topic title',async()=>{
 const requests=[];
 const fetcher=async(url,options)=>{requests.push({url,options});return Response.json({code:0,data:{result:url.includes('search_type=bili_user')?[
  {uname:'-愚鸟渡渡-',mid:2,res:[{bvid:'BV1GJ411x7h7',title:'错误作者',duration:'1:00'}]},
  {uname:'愚鸟渡渡',mid:1,res:[{bvid:bv,title:'感受！我的痛苦！！！',duration:'0:43'}]}
 ]:[{bvid:'BV1GJ411x7h7',title:'愚鸟渡渡人物介绍',author:'另一个人',mid:2,duration:'02:00'}]}});};
 const item=await searchBiliVideo('愚鸟渡渡',fetcher,{cookie:'SESSDATA=private',resolve,mode:'creator'});
 assert.equal(item.bvid,bv);assert.equal(item.author,'愚鸟渡渡');assert.equal(item.mid,'1');assert.equal(item.mode,'creator');
 assert.ok(requests.every(r=>!r.options.headers.Cookie),'public discovery does not inherit personalized ranking');
 const empty=async url=>Response.json({code:0,data:{result:url.includes('search_type=bili_user')?[{uname:'妹存在感',mid:3,res:[]}]:[{bvid:bv,title:'妹存在感X的视频',author:'妹存在感X',mid:4,duration:'1:00'}]}});
 await assert.rejects(()=>searchBiliVideo('妹存在感',empty,{resolve,mode:'creator'}),error=>error.code==='creator-empty'&&error.details.author==='妹存在感');
 const answer=biliFailureReply({query:'妹存在感'},new Error('generic'));
 assert.ok(!answer.includes('主人，'));assert.ok(!answer.includes('旧视频'));
});
test('highlight markup and punctuation do not discard real matches; weak unrelated overlap is excluded',async()=>{
 const fetcher=async()=>Response.json({code:0,data:{result:[{bvid:bv,title:'<em>愚鸟</em>·渡渡的新视频',duration:'1:20',author:'测试作者'}]}});
 assert.equal((await searchBiliVideo('愚鸟渡渡',fetcher,{resolve,mode:'topic'})).bvid,bv);
 const unrelated=async url=>url.includes('/search/type')?Response.json({code:0,data:{result:[{bvid:bv,title:'渡渡与其他故事',duration:'1:20'}]}}):new Response('<html>none</html>');
 await assert.rejects(()=>searchBiliVideo('愚鸟渡渡',unrelated,{resolve,mode:'topic'}),error=>error.code==='no-match');
});

test('author disambiguation accepts a short choice or UID without borrowing another scope',async()=>{
 const candidates=[{name:'同名作者',mid:'1'},{name:'同名作者',mid:'2'}],state={query:'同名作者',candidates};
 for(const text of ['第二个','UID 2'])assert.equal(biliVideoIntent(text,{state}).creatorMid,'2');
 assert.equal(biliVideoIntent('第二个'),null);
 const fetcher=async url=>Response.json({code:0,data:{result:url.includes('bili_user')?candidates.map(v=>({uname:v.name,mid:v.mid,res:[{bvid:v.mid==='2'?bv:'BV1GJ411x7h7',title:'作品',duration:'0:30'}]})):[]}});
 await assert.rejects(()=>searchBiliVideo('同名作者',fetcher,{resolve,mode:'creator'}),e=>e.code==='creator-ambiguous'&&e.details.candidates.length===2);
 assert.equal((await searchBiliVideo('同名作者',fetcher,{resolve,mode:'creator',creatorMid:'2'})).bvid,bv);
 assert.equal(biliVideoIntent('按主题搜',{state}).mode,'topic');
});

test('ordinary Bili searches always mean video content; UP lookup requires an explicit request',async()=>{
 for(const text of ['哔站看看愚鸟渡渡视频','逼站搜索愚鸟渡渡','B站搜愚鸟渡渡'])assert.equal(biliVideoIntent(text).mode,'topic',text);
 for(const text of ['搜up 愚鸟渡渡','逼站搜up 愚鸟渡渡','找UP主 愚鸟渡渡','B站找作者愚鸟渡渡的视频']){
  const intent=biliVideoIntent(text);assert.equal(intent?.mode,'creator',text);assert.equal(intent.query,'愚鸟渡渡',text);
 }
 let users=0;
 const fetcher=async url=>{if(url.includes('bili_user'))users++;return Response.json({code:0,data:{result:[{bvid:bv,title:'愚鸟渡渡游戏剧情',author:'剧情讲解作者',duration:'1:00'}]}});};
 const result=await searchBiliVideo('愚鸟渡渡',fetcher,{resolve});assert.equal(result.mode,'topic');assert.equal(result.author,'剧情讲解作者');assert.equal(users,0,'never silently reinterpret a topic as an UP nickname');
});

test('mentioning authors as a video topic does not enable author lookup; author-only matches cannot replace video content',async()=>{
 const intent=biliVideoIntent('B站搜索关于作者的纪录片');assert.equal(intent.mode,'topic');assert.equal(intent.query,'作者的纪录片');
 const fetcher=async url=>url.includes('/search/type')?Response.json({code:0,data:{result:[{bvid:bv,title:'今天吃什么',author:'愚鸟渡渡',duration:'0:30'}]}}):new Response('<html>none</html>');
 await assert.rejects(()=>searchBiliVideo('愚鸟渡渡',fetcher,{resolve}),e=>e.code==='no-match');
});
test('a valid configured Bili login is attempted once if public search fails, with no forwarding to other sites',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{calls.push({url,options});return options.headers.Cookie?Response.json({code:0,data:{result:[{bvid:bv,title:'愚鸟渡渡新视频',duration:'0:43'}]}}):Response.json({code:-101});};
 const result=await searchBiliVideo('愚鸟渡渡',fetcher,{resolve,cookie:'SESSDATA=synthetic'});assert.equal(result.mode,'topic');assert.match(result.method,/使用已配置B站登录/);assert.equal(calls.length,2);assert.equal(calls[0].options.headers.Cookie,undefined);assert.equal(calls[1].options.headers.Cookie,'SESSDATA=synthetic');assert.ok(calls.every(c=>new URL(c.url).hostname==='api.bilibili.com'));
});

test('separate DASH audio is transcribed locally and only text joins the video evidence',async()=>{
 const m=mock();let audioCalls=0;
 const fetcher=async(url,options)=>{
  if(url.includes('playurl'))return Response.json({code:0,data:{dash:{video:[{baseUrl:'https://video.bilivideo.com/video.mp4',bandwidth:100000}],audio:[{baseUrl:'https://video.bilivideo.com/speech.m4a?token=PRIVATE',bandwidth:64000}]}}});
  return m.fetcher(url,options);
 };
 const result=await readBiliFrames(link,'token',fetcher,{resolve,audio:async url=>{assert.match(url,/speech.m4a/);audioCalls++;return {status:'ok',segments:[{start:0,end:30,text:'视频里的对白'}]};}});
 assert.equal(audioCalls,1);assert.match(result.audioText,/视频里的对白/);assert.match(result.scope,/本地转写音轨/);assert.ok(!JSON.stringify(result).includes('token=PRIVATE'));
});

test('BGM followups use the current video audio state and do not trigger a new topic search',()=>{
 const state={query:'音乐',title:'自由之塔',audio:{status:'unintelligible',signal:'present',tags:[{name:'Music',confidence:.98}],tagWindows:3}};
 for(const text of ['听听这个视频BGM','听一下刚才的背景音乐','这段视频有声音吗','怎么没声音']){assert.equal(biliFollowup(text,state).kind,'audio',text);assert.equal(biliVideoIntent(text,{state}),null,text);}
 assert.match(biliStateContext(state),/Music 98%/);assert.match(biliStateContext(state),/优先于旧助手的猜测/);
 assert.equal(biliVideoIntent('听听这个视频BGM',{history:[{role:'user',content:link}]}).url,link);assert.equal(biliVideoIntent('听听这个视频BGM',{history:[{role:'assistant',content:link}]}),null);
 assert.equal(biliVideoIntent('B站看看新的主题视频',{state}).mode,'topic');
});
