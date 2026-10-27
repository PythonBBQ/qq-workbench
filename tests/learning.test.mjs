import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {biliUrl,readBili,searchBili,learningIntent,LearningStore} from '../assets/learning.mjs';
const data={bvid:'BV1GJ411x7h7',title:'红烧肉搭配白饭',owner:{name:'厨师'},desc:'公开的红烧肉制作介绍'};
test('Bili reader restricts hosts, scheme and redirect targets; no credentials sent',async()=>{
  for(const value of ['http://www.bilibili.com/video/BV1GJ411x7h7','https://bilibili.com.evil.test/','https://api.deepseek.com/','https://u:pass@b23.tv/x','https://b23.tv:8443/x','https://127.0.0.1/'])assert.throws(()=>biliUrl(value));
  await assert.rejects(()=>readBili('https://b23.tv/short',async()=>new Response('',{status:302,headers:{location:'https://127.0.0.1/secret'}})),/只读取/);
  let calls=0;const items=await readBili('https://b23.tv/short',async(u,options)=>{calls++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,undefined);if(calls===1)return new Response('',{status:302,headers:{location:'https://www.bilibili.com/video/BV1GJ411x7h7?p=1'}});assert.match(u,/api.bilibili.com\/x\/web-interface\/view\?bvid=/);return Response.json({code:0,data});});
  assert.equal(calls,2);assert.equal(items[0].title,data.title);assert.match(items[0].content,/未读取视频画面/);
});
test('site restrictions, invalid pages and response size fail honestly',async()=>{
  await assert.rejects(()=>readBili('https://www.bilibili.com/video/BV1GJ411x7h7',async()=>new Response('',{status:412})),/HTTP 412/);
  await assert.rejects(()=>readBili('https://www.bilibili.com/video/BV1GJ411x7h7',async()=>Response.json({code:-403})),/受限/);
  await assert.rejects(()=>readBili('https://www.bilibili.com/video/BV1GJ411x7h7',async()=>new Response('x'.repeat(1024*1024+1))),/上限/);
  await assert.rejects(()=>readBili('https://www.bilibili.com/read/cv123',async()=>{throw new Error('should not fetch');}),/页面类型/);
});
test('search results have bounded titles and scope; intents are explicit',async()=>{
  const items=await searchBili('红烧肉',async(u)=>{assert.equal(new URL(u).searchParams.get('keyword'),'红烧肉');return Response.json({code:0,data:{result:Array(8).fill({...data,title:'<em>红烧肉</em>',author:'厨师',description:'简介'})}});});assert.equal(items.length,3);assert.equal(items[0].title,'红烧肉');
  assert.deepEqual(learningIntent('去B站学习 红烧肉'),{kind:'search',value:'红烧肉'});assert.equal(learningIntent('今天做红烧肉'),null);assert.deepEqual(learningIntent('看看 https://b23.tv/abc。'),{kind:'read',value:'https://b23.tv/abc'});
});
test('only owner can remember from chat; bounded persisted notes, related retrieval and cache',async()=>{
  const root=path.resolve(import.meta.dirname,'../build/learning-tests');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'case-'));let calls=0;
  const store=new LearningStore(dir,async()=>{calls++;return Response.json({code:0,data});});const text='https://www.bilibili.com/video/BV1GJ411x7h7';
  assert.equal(await store.context(text,{enabled:false}),'');assert.equal(calls,0);
  await store.context(text,{owner:false,remember:true});assert.equal(store.list().length,0);
  assert.match(await store.context(text,{owner:true,remember:true}),/低可信/);assert.equal(store.list().length,1);assert.equal(calls,1);
  assert.equal(store.related('红烧肉配白饭').length,1);assert.equal(store.related('完全无关的天文学').length,0);
  const reloaded=new LearningStore(dir);assert.equal(reloaded.list().length,1);
  for(let i=0;i<40;i++)store.save([{...data,url:'https://www.bilibili.com/video/BV1GJ411x7h7?p='+i,content:'x'.repeat(5000)}]);assert.equal(store.list().length,30);assert.equal(store.list()[0].content.length,1400);assert.ok(store.related('红烧肉').length<=2);store.remove('all');assert.equal(new LearningStore(dir).list().length,0);
});
test('network failure informs model without claiming successful learning',async()=>{
  const root=path.resolve(import.meta.dirname,'../build/learning-tests');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'case-'));const store=new LearningStore(dir,async()=>new Response('',{status:412}));assert.match(await store.context('去B站学习 做饭',{owner:true,remember:true}),/不得声称读取成功/);assert.equal(store.list().length,0);
});

test('failed fresh search cannot masquerade as an old note and cancellation never saves results',async()=>{
 const root=path.resolve(import.meta.dirname,'../build/learning-tests');fs.mkdirSync(root,{recursive:true});
 const store=new LearningStore(fs.mkdtempSync(path.join(root,'case-')),async()=>{throw new Error('offline');});
 store.save([{title:'DeepSeek旧版本',url:'https://example.com/old',content:'一条旧笔记'}]);
 const result=await store.context('去搜一下DeepSeek最新版本');assert.match(result,/不得用旧笔记冒充/);assert.ok(!result.includes('一条旧笔记'));
 let current=true;store.lookup=async()=>{current=false;return [{title:'应该丢弃的结果',url:'https://example.com/discard',content:'公开资料'}];};
 assert.equal(await store.context('联网看看DeepSeek',{owner:true,remember:true,stillCurrent:()=>current}),'');assert.equal(store.list().length,1);
});

test('simultaneous identical public reads share one request and later calls reuse the cache',async()=>{
 const root=path.resolve(import.meta.dirname,'../build/learning-tests');fs.mkdirSync(root,{recursive:true});let calls=0,release;
 const store=new LearningStore(fs.mkdtempSync(path.join(root,'case-')),async()=>{calls++;await new Promise(r=>release=r);return Response.json({code:0,data});});
 const intent={kind:'read',value:'https://www.bilibili.com/video/BV1GJ411x7h7'};
 const first=store.lookup(intent),second=store.lookup(intent);assert.equal(calls,1);release();assert.deepEqual(await first,await second);
 await store.lookup(intent);assert.equal(calls,1);assert.equal(store.inFlight.size,0);
 const cached=store.cache.get(intent.kind+':'+intent.value);cached.at=Date.now()-10000;
 const context=await store.context(intent.value);assert.match(context,/复用短时缓存，未重新请求网站/);assert.ok(context.includes(new Date(cached.at).toISOString()));assert.equal(calls,1);
});
