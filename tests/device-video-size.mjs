// Synthetic local media only: no network, QQ messages or model calls.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {decodeClip} from '/opt/qq-workbench/video-decoder.mjs';
import {sampledVideo,videoBatches} from '/opt/qq-workbench/video.mjs';
const work='/opt/qq-workbench/video-size-tests-20261122';
const directory=path.join(work,'video-imports');fs.mkdirSync(directory,{recursive:true});
const clip=path.join(directory,'clip-'+'d'.repeat(32)+'.bin');
execFileSync('/usr/bin/ffmpeg',['-v','error','-nostdin','-y','-threads','1','-filter_threads','1','-f','lavfi','-i','testsrc2=size=256x144:rate=4:duration=4.1,noise=alls=65:allf=t+u','-an','-c:v','mpeg4','-threads','1','-q:v','2','-f','mp4',clip],{timeout:45000});
// Real MP4 structure followed by padding: exercise the old 32MB boundary
// without generating or reading any user media.
fs.truncateSync(clip,40*1024*1024);
const results=[];
try{
 for(const fps of [1,2,4]){
  const start=Date.now(),sample=await decodeClip(clip,work,fps,{videoInputMB:256,videoRequestMB:1});
  const video={...sampledVideo(sample),requestMB:1},batches=videoBatches(video);
  assert.equal(sample.frameCount,Math.ceil(sample.durationSeconds*fps));
  assert.equal(batches.at(-1).endSeconds,sample.durationSeconds);
  assert.ok(batches.every(b=>b.budget.requestBytes<1024*1024));
  assert.ok(sample.frames.every(f=>Buffer.from(f.url.split(',')[1],'base64').length<=Math.floor((1024*1024-65536)/15*3/4)));
  results.push({fps,durationSeconds:sample.durationSeconds,inputBytes:fs.statSync(clip).size,frameCount:sample.frameCount,jpegBytes:sample.frames.reduce((n,f)=>n+Buffer.from(f.url.split(',')[1],'base64').length,0),requestBytes:batches.map(b=>b.budget.requestBytes),decodeMs:Date.now()-start,audio:sample.audio?.status});
 }
 await assert.rejects(()=>decodeClip(clip,work,1,{videoInputMB:32}),/32MB/);
}finally{fs.unlinkSync(clip);}
assert.deepEqual(fs.readdirSync(directory),[]);
const result={results,paidModelCalls:0,qqMessagesSent:0,temporaryMediaRemaining:0};
fs.writeFileSync(path.join(work,'verification.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
