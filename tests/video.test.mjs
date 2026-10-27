import {test} from 'node:test';import assert from 'node:assert/strict';
import {sampledVideo,qqVideo} from '../assets/video.mjs';
import fs from 'node:fs';import path from 'node:path';
import {decodeClip,downloadClip} from '../assets/video-decoder.mjs';
const data={durationSeconds:12,frames:[{seconds:2,url:'data:image/jpeg;base64,AQID'}]};
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
