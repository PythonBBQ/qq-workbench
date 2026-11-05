import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pageVideos,readWeb} from '../assets/web-learning.mjs';
import {webVideoIntent,readWebVideo,samplingPlan} from '../assets/video.mjs';
import {androidFetch} from '../assets/native-network.mjs';
import {biliVideoIntent} from '../assets/bili-video.mjs';
import {LearningStore} from '../assets/learning.mjs';

const resolve=async()=>[{address:'93.184.216.34'}];
const page='https://example.com/article';
const response=source=>new Response(source,{headers:{'content-type':'text/html'}});
const sample={sampling:'fps-contact-sheet-v2',fps:2,durationSeconds:1,sampledSeconds:1,frameCount:2,frames:[{timestamps:[0,.5],url:'data:image/jpeg;base64,AQID'}],audio:{status:'ok',segments:[{start:0,end:1,text:'这是本机转写的对白'}]}};

test('webpage video discovery handles relative sources, OG metadata, VideoObject and embedded Bili, excluding scripts and private resources',()=>{
  assert.deepEqual(pageVideos('<video poster="cover.jpg"><source src="/film.webm?a=1&amp;b=2"></video><meta content="https://cdn.example/film.mp4" property="og:video:secure_url">',page),[
    {url:'https://example.com/film.webm?a=1&b=2',kind:'file'},{url:'https://cdn.example/film.mp4',kind:'file'}]);
  const result=pageVideos('<script>"<video src=\'https://bad.example/ad.mp4\'></video>"</script><!-- <video src="https://bad.example/comment.mp4"></video> --><video src="https://127.0.0.1/secret.mp4"></video><script type="application/ld+json">{"@graph":[{"@type":"VideoObject","contentUrl":"/real.mp4"}]}</script><iframe src="https://player.bilibili.com/player.html?bvid=BV1GJ411x7h7"></iframe>',page);
  assert.deepEqual(result,[{url:'https://example.com/real.mp4',kind:'file'},{url:'https://www.bilibili.com/video/BV1GJ411x7h7',kind:'bilibili'}]);
  assert.equal(pageVideos('<iframe src="https://player.bilibili.com.evil.example/player.html?bvid=BV1GJ411x7h7"></iframe>',page).length,0);
  assert.equal(pageVideos('<video src="/live.m3u8"></video>',page)[0].kind,'stream');
});

test('video-only pages and direct media links remain unobserved until actual video decode, without streaming media into the text reader',async()=>{
  const [item]=await readWeb(page,async()=>response('<title>短片</title><video src="/movie.mp4"></video>'),resolve);
  assert.equal(item.videos[0].url,'https://example.com/movie.mp4');assert.match(item.content,/不代表已看视频/);
  let cancelled=false;
  const [direct]=await readWeb('https://example.com/media',async(_,options)=>{assert.equal(options.mediaProbe,true);return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'video/mp4'}});},resolve);
  assert.equal(cancelled,true);assert.equal(direct.videos[0].url,'https://example.com/media');assert.match(direct.content,/尚未读取画面/);
  await assert.rejects(()=>readWeb(page,async()=>response('<title>Just a moment...</title><video src="/trap.mp4"></video>'),resolve),/访问验证/);
});

test('web video intent respects automatic mode, text-only requests, opt-out and single-video bounds',()=>{
  const items=[{title:'示例短片',url:page,videos:[{url:'https://cdn.example/clip.mp4',kind:'file'},{url:'https://cdn.example/other.mp4',kind:'file'}]}];
  assert.equal(webVideoIntent(page,{items}).count,2);
  assert.equal(webVideoIntent(page,{items,automatic:false}),null);
  assert.equal(webVideoIntent('看看这个网页的视频',{items,automatic:false}).reference,page);
  for(const text of ['不要看视频 '+page,'只看正文 '+page,'只查标题 '+page,'今日天气如何'])assert.equal(webVideoIntent(text,{items}),null,text);
});

test('web media download only uses authenticated local decoder and retains bounded frames, actual transcript and safe source',async()=>{
  const calls=[];let decoded=false;
  const result=await readWebVideo({url:'https://cdn.example/movie.mp4?signature=PRIVATE',title:'例子',reference:page},'local-token',async(url,options)=>{calls.push({url,options});return Response.json({clip:'clip-'+('a'.repeat(32))+'.bin'});},{resolve,decode:async()=>{decoded=true;return sample;}});
  assert.ok(decoded);assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:13481/video-frames');assert.equal(JSON.parse(calls[0].options.body).source,'web');assert.equal(calls[0].options.headers.Authorization,'Bearer local-token');
  assert.equal(result.frameCount,2);assert.equal(result.fps,2);assert.match(result.audioText,/本机转写的对白/);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.equal(result.reference,page);
  assert.equal(samplingPlan(600,4).batches,20);
});

test('failed, private, unsupported stream and malformed decoded videos cannot become successful observations',async()=>{
  const intent={url:'https://cdn.example/movie.mp4',reference:page};let calls=0;
  const request=async()=>{calls++;return Response.json({},{status:403});};
  await assert.rejects(()=>readWebVideo(intent,'token',request,{resolve:async()=>[{address:'192.168.1.9'}]}),/内网/);assert.equal(calls,0);
  await assert.rejects(()=>readWebVideo({...intent,kind:'stream'},'token',request,{resolve}),/分段流/);assert.equal(calls,0);
  await assert.rejects(()=>readWebVideo(intent,'token',request,{resolve}),/未读取画面/);
  await assert.rejects(()=>readWebVideo(intent,'token',async()=>Response.json({clip:'../../settings.json'}),{resolve,decode:async()=>sample}),/解码组件/);
  await assert.rejects(()=>readWebVideo(intent,'token',async()=>Response.json({...sample,frameCount:1}),{resolve}),/抽帧数据不完整/);
});

test('Android media probes return response headers without treating video bytes as webpage text',async()=>{
  let body;
  const fetcher=androidFetch(async(_,options)=>{body=JSON.parse(options.body);return Response.json({status:200,headers:{'Content-Type':'video/mp4'},body:''});},'native-secret');
  const [item]=await readWeb('https://cdn.example/large.mp4',fetcher,resolve);
  assert.equal(body.mediaProbe,true);assert.equal(body.headers.authorization,undefined);assert.equal(item.videos[0].kind,'file');
});

test('webpage-video followups do not reuse an older Bili video or search its unrelated topic',async()=>{
  const history=[{role:'user',content:'https://www.bilibili.com/video/BV1GJ411x7h7'},{role:'user',content:page}];
  const store=new LearningStore('build/web-video-intent-test');
  for(const text of ['看看这个视频','这个视频说了什么','看完视频']){
    assert.equal(biliVideoIntent(text,{history}),null,text);
    assert.equal((await store.plan(text,{history})).value,page,text);
  }
  assert.equal((await store.plan('这个视频说了什么',{history:[]})).kind,'page-clarify');
});
