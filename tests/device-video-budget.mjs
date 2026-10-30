// Synthetic media only. Isolated from live settings, credentials, conversations and QQ.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {decodeClip} from './video-decoder.mjs';import {sampledVideo,videoBatches} from './video.mjs';
const work=path.dirname(fileURLToPath(import.meta.url));assert.equal(path.basename(work),'video-budget-tests');
const directory=path.join(work,'video-imports');fs.mkdirSync(directory,{recursive:true});
const results=[];
for(const seconds of [1.1,120,121.1,600]){
 const clip=path.join(directory,'clip-'+'3'.repeat(32)+'.bin');fs.copyFileSync(path.join(work,'synthetic-'+seconds+'.mp4'),clip);
 const start=Date.now();
 try{
  const sample=await decodeClip(clip,work),video=sampledVideo(sample),batches=videoBatches(video,'概括完整时段');
  assert.equal(sample.frameCount,Math.ceil(seconds));assert.equal(sample.frames.length,Math.ceil(seconds/8));assert.equal(batches.length,Math.ceil(seconds/120));
  assert.deepEqual(sample.frames.flatMap(f=>f.timestamps),Array.from({length:Math.ceil(seconds)},(_,i)=>i));
  const bytes=sample.frames.reduce((n,f)=>n+Buffer.from(f.url.split(',')[1],'base64').length,0);assert.ok(bytes<15000000);
  const image=path.join(directory,'probe.jpg');fs.writeFileSync(image,Buffer.from(sample.frames[0].url.split(',')[1],'base64'));
  const dimensions=JSON.parse(execFileSync('/usr/bin/ffprobe',['-v','error','-show_entries','stream=width,height','-of','json',image],{timeout:12000})).streams[0];fs.unlinkSync(image);assert.equal(dimensions.width,1024);assert.equal(dimensions.height,288);
  results.push({seconds,frames:sample.frameCount,sheets:sample.frames.length,batches:batches.length,jpegBytes:bytes,maxBatchEstimatedTokens:Math.max(...batches.map(b=>b.budget.estimatedTokens)),decodeMs:Date.now()-start});
 }finally{fs.rmSync(clip,{force:true});}
 assert.deepEqual(fs.readdirSync(directory),[]);
}
const report={results,completeOneSecondCoverage:true,temporaryFilesRemaining:0,paidModelCalls:0,qqMessagesSent:0};
fs.writeFileSync(path.join(work,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
