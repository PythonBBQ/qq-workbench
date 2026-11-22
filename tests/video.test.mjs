import {test} from 'node:test';import assert from 'node:assert/strict';
import {sampledVideo,qqVideo,qqVideoSegments,qqVideoEvent,videoLimits,videoBudget,videoBatches,observeVideo,samplingPlan} from '../assets/video.mjs';
import fs from 'node:fs';import path from 'node:path';
import {decodeClip,downloadClip} from '../assets/video-decoder.mjs';
const data={durationSeconds:12,frames:[{seconds:2,url:'data:image/jpeg;base64,AQID'}]};
function contactSheet(duration=120){const span=duration,count=Math.ceil(span);return {sampling:'1fps-contact-sheet-v1',durationSeconds:duration,sampledSeconds:span,frameCount:count,frames:Array.from({length:Math.ceil(count/8)},(_,i)=>({seconds:i*8,timestamps:Array.from({length:Math.min(8,count-i*8)},(_,j)=>i*8+j),url:data.frames[0].url}))};}
function denseSample(duration,fps){const count=Math.ceil(duration*fps);return {sampling:'fps-contact-sheet-v2',fps,durationSeconds:duration,sampledSeconds:duration,frameCount:count,frames:Array.from({length:Math.ceil(count/8)},(_,i)=>({seconds:i*8/fps,timestamps:Array.from({length:Math.min(8,count-i*8)},(_,j)=>(i*8+j)/fps),url:data.frames[0].url}))};}

test('video input and serialized screenshot requests have separate configurable MB limits',async()=>{
 assert.equal(videoLimits().inputMB,256);assert.equal(videoLimits().requestMB,4);assert.equal(videoLimits({videoInputMB:512,videoRequestMB:1}).inputBytes,512*1024*1024);
 assert.equal(videoLimits({videoInputMB:-1,videoRequestMB:'8'}).requestMB,4);
 const sample=denseSample(120,1);for(const frame of sample.frames)frame.url='data:image/jpeg;base64,'+'A'.repeat(180000);
 sample.audio={status:'ok',segments:[{start:110,end:120,text:'末尾对白'}]};
 const video={...sampledVideo(sample),requestMB:1},batches=videoBatches(video);
 assert.ok(batches.length>1);assert.equal(batches[0].startSeconds,0);assert.equal(batches.at(-1).endSeconds,120);
 assert.equal(batches.reduce((n,b)=>n+b.budget.images,0),15);
 for(let i=0;i<batches.length;i++){const b=batches[i];assert.ok(b.budget.requestBytes<1024*1024);assert.ok(b.budget.estimatedTokens<100000);if(i)assert.equal(b.startSeconds,batches[i-1].endSeconds);}
 assert.match(JSON.stringify(batches.at(-1).messages),/末尾对白/);
 assert.throws(()=>videoBudget([{content:'文'.repeat(24000)},{content:Array(15).fill({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+'A'.repeat(180000)}})}],1000,1),/1MB/);
 let reads=0;const result=await qqVideo({message:[{type:'file',data:{name:'large.mp4',size:65*1024*1024,url:'https://gchat.qpic.cn/file'}}]},'token',async(_,options)=>{reads++;assert.equal(JSON.parse(options.body).inputMB,256);return Response.json(denseSample(1,1));},null,null,{videoRequestMB:2});assert.equal(reads,1);assert.equal(result.requestMB,2);
});

test('1/2/4fps cover fractional seconds and full ten minutes with bounded requests and aligned audio',async()=>{
 for(const fps of [1,2,4]){
  for(const duration of [0.1,1.1,120.25,600]){
   const sample=denseSample(duration,fps),plan=samplingPlan(duration,fps),video=sampledVideo(sample),batches=videoBatches(video);
   assert.equal(video.frameCount,Math.ceil(duration*fps));assert.equal(batches.length,plan.batches);assert.equal(batches.at(-1).endSeconds,duration);
   assert.deepEqual(sample.frames.flatMap(v=>v.timestamps),Array.from({length:video.frameCount},(_,i)=>i/fps));
   for(let i=0;i<batches.length;i++){assert.ok(batches[i].budget.images<=15);assert.ok(batches[i].budget.estimatedTokens<100000);assert.equal(batches[i].startSeconds,i*120/fps);}
  }
  const sample=denseSample(600,fps);sample.audio={status:'ok',segments:Array.from({length:20},(_,i)=>({start:i*30,end:(i+1)*30,text:'对白-'+i+'-结束'}))};
  const batches=videoBatches(sampledVideo(sample));assert.equal(batches.length,5*fps);
  assert.match(JSON.stringify(batches[0].messages),/对白-0-结束/);assert.ok(!JSON.stringify(batches[0].messages).includes('对白-'+(4/fps)+'-结束'));
  assert.match(JSON.stringify(batches.at(-1).messages),/对白-19-结束/);
  const result=await observeVideo(sampledVideo(sample),'概括',async()=> '文'.repeat(5000));
  assert.match(result.text,new RegExp((600-120/fps)+'—600秒'));assert.ok(result.text.length<20000);
 }
 for(const fps of [0,3,8,'2',null,NaN]){assert.throws(()=>samplingPlan(10,fps));assert.throws(()=>sampledVideo(denseSample(1,fps)));}
 const broken=denseSample(2,4);broken.frames[0].timestamps[1]=1;assert.throws(()=>sampledVideo(broken));
 assert.throws(()=>sampledVideo({...contactSheet(1),fps:4}));assert.throws(()=>sampledVideo({...data,sampling:'unknown'}));
});
test('two-minute video keeps every one-second sample in 15 low-detail contact sheets below planning budget',()=>{
 const sample=contactSheet(),result=sampledVideo(sample);
 assert.equal(result.frameCount,120);assert.equal(result.sheets,15);assert.equal(result.parts.filter(p=>p.type==='image_url'&&p.image_url.detail==='low').length,15);
 assert.match(result.parts.at(-2).text,/112、113、114、115、116、117、118、119/);assert.match(result.scope,/每秒抽取1帧/);
 const budget=videoBudget([{content:'文'.repeat(24000)},{content:result.parts.filter(p=>p.type==='image_url')}],1800);assert.equal(budget.estimatedTokens,70800);assert.ok(budget.estimatedTokens<100000);
 assert.match(sampledVideo(contactSheet(300)).scope,/分析全时段/);assert.equal(sampledVideo(contactSheet(1.1)).frameCount,2);
 for(const changed of [{...sample,frameCount:119},{...sample,frames:sample.frames.slice(1)},{...sample,sampledSeconds:119},{...sample,frames:[{...sample.frames[0],timestamps:[0,1,2,3,4,5,6,8]},...sample.frames.slice(1)]}])assert.throws(()=>sampledVideo(changed));
 assert.throws(()=>videoBudget([{content:'文'.repeat(24001)}]),/预算/);assert.throws(()=>videoBudget([{content:Array(16).fill(result.parts[1])}]),/预算/);
});
test('ten-minute videos cover 600 seconds in five bounded sequential model requests without silently dropping the end',async()=>{
 const video=sampledVideo(contactSheet(600)),batches=videoBatches(video,'解释完整视频');assert.equal(video.frameCount,600);assert.equal(video.sheets,75);assert.equal(batches.length,5);
 for(const batch of batches){assert.equal(batch.budget.images,15);assert.ok(batch.budget.estimatedTokens<100000);}
 let calls=0;const result=await observeVideo(video,'解释完整视频',async(messages,max,index,total)=>{assert.equal(index,calls++);assert.equal(total,5);assert.equal(max,1000);return '测试第'+index+'段';});
 assert.equal(calls,5);assert.match(result.text,/480—600秒/);assert.match(batches.at(-1).messages.at(-1).content.at(-2).text,/592、593、594、595、596、597、598、599/);
 calls=0;await assert.rejects(()=>observeVideo(video,'test',async()=>{calls++;if(calls===2)throw new Error('synthetic unavailable');return 'ok';}),/synthetic unavailable/);assert.equal(calls,2);
 assert.throws(()=>sampledVideo(contactSheet(601)));assert.throws(()=>sampledVideo({...contactSheet(600),sampledSeconds:120}));
});
test('sampled video has truthful visual-only scope and validates bounded frame data',()=>{
 const result=sampledVideo(data);assert.equal(result.parts[1].type,'image_url');assert.match(result.scope,/未听取音轨/);
 for(const input of [{...data,durationSeconds:700},{...data,frames:Array(5).fill(data.frames[0])},{...data,frames:[{seconds:1,url:'https://example.com/photo'}]},{...data,frames:[{seconds:20,url:data.frames[0].url}]}])assert.throws(()=>sampledVideo(input));
});

test('QQ native decoding failure uses a bounded fallback only for validated media hosts',async()=>{
 let calls=0;const event={message:[{type:'video',data:{url:'https://gchat.qpic.cn/test.mp4'}}]};
 const fallback=async url=>{calls++;assert.equal(url,event.message[0].data.url);return data;};
 assert.equal((await qqVideo(event,'token',async()=>{throw new Error('native unavailable');},fallback)).parts.length,2);
 assert.equal(calls,1);
 await assert.rejects(()=>qqVideo({message:[{type:'video',data:{url:'http://gchat.qpic.cn:8080/test.mp4'}}]},'token',null,fallback));assert.equal(calls,1);
});

test('compatibility decoder refuses path escape, empty/oversized clips, and removes failed downloads',async()=>{
 const base=path.resolve(import.meta.dirname,'../build/video-tests');fs.mkdirSync(base,{recursive:true});
 const work=fs.mkdtempSync(path.join(base,'case-')),dir=path.join(work,'video-imports');fs.mkdirSync(dir);
 const clip=path.join(dir,'clip-'+'a'.repeat(32)+'.bin'),outside=path.join(work,'outside.bin');fs.writeFileSync(clip,'');fs.writeFileSync(outside,'synthetic');
 await assert.rejects(()=>decodeClip(outside,work),/路径无效/);await assert.rejects(()=>decodeClip(clip,work),/大小/);
 const fd=fs.openSync(clip,'w');fs.ftruncateSync(fd,32*1024*1024+1);fs.closeSync(fd);await assert.rejects(()=>decodeClip(clip,work,1,{videoInputMB:32}),/大小/);fs.unlinkSync(clip);
 await assert.rejects(()=>downloadClip('https://gchat.qpic.cn/video',async()=>new Response(new Uint8Array(32*1024*1024+1)),work,1,{videoInputMB:32}),/32MB/);
 await assert.rejects(()=>downloadClip('https://gchat.qpic.cn/video',async()=>new Response('small',{headers:{'content-length':String(32*1024*1024+1)}}),work,1,{videoInputMB:32}),/32MB/);
 assert.deepEqual(fs.readdirSync(dir),[]);fs.unlinkSync(outside);
});
test('video files resolve through the correct QQ API and reuse decoding, audio, and frame rate',async()=>{
 for(const group of [false,true]){
  const event={message_type:group?'group':'private',group_id:42,user_id:123456,message:[{type:'file',data:{file:'片段.MOV',file_id:'uuid',file_hash:'hash',busid:102}}]};
  const result=await qqVideo(event,'local-token',async(url,options)=>{assert.equal(JSON.parse(options.body).url,'https://gchat.qpic.cn/file?key=SECRET');return Response.json({clip:'clip-'+'a'.repeat(32)+'.bin'});},null,async()=>({...denseSample(2,4),audio:{status:'ok',segments:[{start:0,end:2,text:'视频对白'}]}}),{rpc:async(action,params)=>{
   assert.equal(action,group?'get_group_file_url':'get_private_file_url');assert.deepEqual(params,group?{group_id:42,file_id:'uuid',busid:102}:{user_id:123456,file_id:'uuid',file_hash:'hash'});
   return {status:'ok',retcode:0,data:{url:'http://gchat.qpic.cn/file?key=SECRET'}};
  }});
  assert.equal(result.fps,4);assert.equal(result.frameCount,8);assert.match(result.audioText,/视频对白/);assert.equal(result.title,'QQ视频附件');assert.ok(!JSON.stringify(result).includes('SECRET'));
 }
 for(const name of ['x.mp4','x.mkv','x.webm','x.3gp','x.m2ts'])assert.equal(qqVideoSegments({message:[{type:'file',data:{name}}]}).length,1);
 for(const name of ['x.mp4.exe','x.pdf','x.mp3'])assert.equal(qqVideoSegments({message:[{type:'file',data:{name}}]}).length,0);
 const notice={post_type:'notice',notice_type:'group_upload',self_id:5,group_id:42,user_id:9,time:123,file:{id:'uuid',name:'x.mp4',size:120,busid:102}};
 const converted=qqVideoEvent(notice);assert.equal(converted.post_type,'message');assert.equal(converted.message_type,'group');assert.equal(converted.user_id,9);assert.equal(converted.message[0].data.file_id,'uuid');assert.equal(qqVideoEvent({...notice,file:{id:'pdf',name:'x.pdf'}}).post_type,'notice');
});
test('video size, bad URLs, decoder failures and cancellation do not trigger repeated downloads',async()=>{
 const event={message:[{type:'file',data:{name:'x.mp4',url:'https://gchat.qpic.cn/video'}}]};let downloads=0,fallbacks=0;
 const fetcher=async()=>{downloads++;return Response.json({clip:'clip-'+'b'.repeat(32)+'.bin'});},fallback=async()=>{fallbacks++;return data;};
 await assert.rejects(()=>qqVideo(event,'token',fetcher,fallback,async()=>{throw new Error('仅支持10分钟以内的视频');}),/10分钟/);assert.equal(downloads,1);assert.equal(fallbacks,0);
 event.message[0].data.file_size=256*1024*1024+1;await assert.rejects(()=>qqVideo(event,'token',fetcher,fallback),/256MB/);assert.equal(downloads,1);delete event.message[0].data.file_size;
 await assert.rejects(()=>qqVideo(event,'token',async()=>Response.json({message:'视频超过32MB，请裁剪'},{status:502}),fallback),/32MB/);assert.equal(fallbacks,0);
 await assert.rejects(()=>qqVideo(event,'token',async()=>{throw new DOMException('cancelled','AbortError');},fallback),/cancelled/);assert.equal(fallbacks,0);
 for(const url of ['https://qpic.cn.evil.test/video','https://u:p@qpic.cn/video','http://127.0.0.1/video','https://qpic.cn:8080/video'])await assert.rejects(()=>qqVideo({message:[{type:'video',data:{url}}]},'token',fetcher,fallback),/不受支持/);
 assert.equal(downloads,1);
});
test('private-file public IP downloads require a QQ RPC receipt and never accept local addresses',async()=>{
 const event={message_type:'private',user_id:123456,message:[{type:'file',data:{name:'x.mp4',file_id:'uuid',url:'http://8.8.8.8:8080/file'}}]};let native=0,downloads=0;
 const fetcher=async()=>{native++;throw new Error('must use bounded file downloader');};
 const fallback=async url=>{downloads++;assert.equal(url,'http://93.184.216.34:8080/file');return data;};
 await assert.rejects(()=>qqVideo(event,'token',fetcher,fallback),/不受支持/);assert.equal(downloads,0);
 const result=await qqVideo(event,'token',fetcher,fallback,null,{rpc:async()=>({status:'ok',retcode:0,data:{url:'http://93.184.216.34:8080/file'}})});assert.equal(result.parts.length,2);assert.equal(native,0);assert.equal(downloads,1);
 for(const url of ['http://127.0.0.1/file','http://192.168.1.1/file','http://169.254.169.254/file','http://[::1]/file'])await assert.rejects(()=>qqVideo(event,'token',fetcher,fallback,null,{rpc:async()=>({status:'ok',retcode:0,data:{url}})}),/不受支持/);
 assert.equal(downloads,1);
});
test('QQ video never sends model credentials to media hosts and rejects arbitrary downloads',async()=>{
 const event={message:[{type:'video',data:{url:'https://gchat.qpic.cn/test.mp4'}}]};let calls=0;
 const result=await qqVideo(event,'local-token',async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:13481/video-frames');assert.equal(options.headers.Authorization,'Bearer local-token');assert.equal(JSON.parse(options.body).url,event.message[0].data.url);return Response.json(data);});assert.equal(calls,1);assert.equal(result.parts.length,2);
 await assert.rejects(()=>qqVideo({message:[{type:'video',data:{url:'https://evil.test/file'}}]},'local-token',()=>{throw new Error('unexpected fetch');}),/不受支持/);
});
