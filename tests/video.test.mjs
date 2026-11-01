import {test} from 'node:test';import assert from 'node:assert/strict';
import {sampledVideo,qqVideo,videoBudget,videoBatches,observeVideo,samplingPlan} from '../assets/video.mjs';
import fs from 'node:fs';import path from 'node:path';
import {decodeClip,downloadClip} from '../assets/video-decoder.mjs';
const data={durationSeconds:12,frames:[{seconds:2,url:'data:image/jpeg;base64,AQID'}]};
function contactSheet(duration=120){const span=duration,count=Math.ceil(span);return {sampling:'1fps-contact-sheet-v1',durationSeconds:duration,sampledSeconds:span,frameCount:count,frames:Array.from({length:Math.ceil(count/8)},(_,i)=>({seconds:i*8,timestamps:Array.from({length:Math.min(8,count-i*8)},(_,j)=>i*8+j),url:data.frames[0].url}))};}
function denseSample(duration,fps){const count=Math.ceil(duration*fps);return {sampling:'fps-contact-sheet-v2',fps,durationSeconds:duration,sampledSeconds:duration,frameCount:count,frames:Array.from({length:Math.ceil(count/8)},(_,i)=>({seconds:i*8/fps,timestamps:Array.from({length:Math.min(8,count-i*8)},(_,j)=>(i*8+j)/fps),url:data.frames[0].url}))};}

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
 await assert.rejects(()=>qqVideo({message:[{type:'video',data:{url:'http://gchat.qpic.cn/test.mp4'}}]},'token',null,fallback));assert.equal(calls,1);
});

test('compatibility decoder refuses path escape, empty/oversized clips, and removes failed downloads',async()=>{
 const base=path.resolve(import.meta.dirname,'../build/video-tests');fs.mkdirSync(base,{recursive:true});
 const work=fs.mkdtempSync(path.join(base,'case-')),dir=path.join(work,'video-imports');fs.mkdirSync(dir);
 const clip=path.join(dir,'clip-'+'a'.repeat(32)+'.bin'),outside=path.join(work,'outside.bin');fs.writeFileSync(clip,'');fs.writeFileSync(outside,'synthetic');
 await assert.rejects(()=>decodeClip(outside,work),/路径无效/);await assert.rejects(()=>decodeClip(clip,work),/大小/);
 const fd=fs.openSync(clip,'w');fs.ftruncateSync(fd,32*1024*1024+1);fs.closeSync(fd);await assert.rejects(()=>decodeClip(clip,work),/大小/);fs.unlinkSync(clip);
 await assert.rejects(()=>downloadClip('https://gchat.qpic.cn/video',async()=>new Response(new Uint8Array(7*1024*1024+1)),work),/7MB/);
 assert.deepEqual(fs.readdirSync(dir),[]);fs.unlinkSync(outside);
});
test('QQ video never sends model credentials to media hosts and rejects arbitrary downloads',async()=>{
 const event={message:[{type:'video',data:{url:'https://gchat.qpic.cn/test.mp4'}}]};let calls=0;
 const result=await qqVideo(event,'local-token',async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:13481/video-frames');assert.equal(options.headers.Authorization,'Bearer local-token');assert.equal(JSON.parse(options.body).url,event.message[0].data.url);return Response.json(data);});assert.equal(calls,1);assert.equal(result.parts.length,2);
 await assert.rejects(()=>qqVideo({message:[{type:'video',data:{url:'https://evil.test/file'}}]},'local-token',()=>{throw new Error('unexpected fetch');}),/不受支持/);
});
