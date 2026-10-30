import {test} from 'node:test';import assert from 'node:assert/strict';
import {biliReference,biliVideoIntent,biliMediaUrl,resolveBiliVideo,readBiliFrames} from '../assets/bili-video.mjs';
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
