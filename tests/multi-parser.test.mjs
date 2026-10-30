import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PLATFORMS,platformFor,shareUrl,sharedLinks,shareCards,cardText,readShare,parserRequest,shareImageParts} from '../assets/multi-parser.mjs';
import {LearningStore} from '../assets/learning.mjs';
const resolve=async()=>[{address:'93.184.216.34'}];
const options={resolve};
const html=text=>new Response(text,{headers:{'content-type':'text/html; charset=utf-8'}});
const contextDir=()=>{const parent=path.resolve(import.meta.dirname,'../build/multi-parser-tests');fs.mkdirSync(parent,{recursive:true});return fs.mkdtempSync(path.join(parent,'case-'));};

test('shared URLs normalize supported HTTP, trim Chinese punctuation and reject deceptive/private addresses',()=>{
 assert.equal(PLATFORMS.length,13);assert.equal(platformFor('https://api.bilibili.com/').id,'bilibili');
 assert.equal(platformFor('https://bilibili.com.evil.test/'),null);
 assert.deepEqual(sharedLinks('看看 http://b23.tv/a。 https://mp.weixin.qq.com/s/ab！'),['https://b23.tv/a','https://mp.weixin.qq.com/s/ab']);
 for(const u of ['file:///private','https://127.0.0.1/','https://10.0.0.1/','https://u:p@b23.tv/x','https://b23.tv:8443/x'])assert.throws(()=>shareUrl(u));
});

test('QQ JSON/XML cards extract only public fields and cannot leak card tokens into chat',()=>{
 const raw=JSON.stringify({app:'com.tencent.structmsg',token:'NEVER-SEND',meta:{news:{title:'红烧肉',desc:'好吃',jumpUrl:'https://www.bilibili.com/video/BV1GJ411x7h7',preview:'https://i0.hdslb.com/cover.jpg',token:'SECRET',uin:123456}}});
 const cards=shareCards({message:[{type:'json',data:{data:raw}}]});
 assert.equal(cards[0].title,'红烧肉');assert.equal(cards[0].url,'https://www.bilibili.com/video/BV1GJ411x7h7');
 assert.ok(!JSON.stringify(cards).includes('SECRET'));assert.ok(!JSON.stringify(cards).includes('123456'));assert.ok(!cardText(cards).includes('NEVER-SEND'));
 const xml=shareCards({message:[{type:'xml',data:{data:'<msg url="https://mp.weixin.qq.com/s/ab?a=1&amp;b=2"><title>公开文章</title></msg>'}}]});assert.match(xml[0].url,/a=1&b=2/);
 assert.deepEqual(shareCards({message:[{type:'json',data:{data:'{"meta":{"news":{"jumpUrl":"https://127.0.0.1/x"}}}'}}]}),[]);
 assert.deepEqual(shareCards({message:[{type:'json',data:{data:'x'.repeat(65537)}}]}),[]);
});

test('parser transport restricts redirects, DNS, write actions and credentials',async()=>{
 const platform=platformFor('https://b23.tv/x');let count=0;
 const request={fetch:1,url:'https://api.bilibili.com/x/web-interface/view',method:'GET',headers:{Cookie:'SESSDATA=synthetic',Authorization:'MODEL-SECRET'},body:''};
 const r=await parserRequest(request,platform,async(u,o)=>{count++;assert.equal(o.headers.Authorization,undefined);assert.equal(o.headers.Cookie,'SESSDATA=synthetic');assert.equal(o.redirect,'manual');return Response.json({code:0});},resolve);
 assert.equal(r.status,200);assert.equal(count,1);
 await assert.rejects(()=>parserRequest(request,platform,async()=>html('no'),async()=>[{address:'127.0.0.1'}]),/内网/);
 await assert.rejects(()=>parserRequest({...request,method:'POST'},platform,async()=>html('no'),resolve),/只允许/);
 await assert.rejects(()=>parserRequest(request,platform,async()=>new Response('',{status:302,headers:{location:'https://other.example/steal'}}),resolve),/不支持/);
 await assert.rejects(()=>parserRequest(request,platform,async()=>new Response('x'.repeat(4*1024*1024+1)),resolve),/4MB/);
});

test('actual bundled Bilibili parser uses metadata once, keeps cover and never downloads video',async()=>{
 let count=0;
 const items=await readShare('https://www.bilibili.com/video/BV1GJ411x7h7',async(u,o)=>{
  count++;assert.match(u,/web-interface\/view/);assert.equal(o.headers.authorization,undefined);
  return Response.json({code:0,data:{title:'一碗白饭',bvid:'BV1GJ411x7h7',owner:{name:'厨师'},desc:'公开做饭简介',cid:1,pic:'https://i0.hdslb.com/test.jpg'}});
 },options);
 assert.equal(count,1);assert.equal(items[0].title,'一碗白饭');assert.match(items[0].content,/公开做饭简介/);assert.match(items[0].content,/未观看视频/);assert.equal(items[0].images.length,1);
});

test('actual WeChat parser reads article body and ordered images, not scripts',async()=>{
 const items=await readShare('https://mp.weixin.qq.com/s/abcd',async()=>html('<h1 id="activity-name">白饭研究</h1><a id="js_name">作者</a><div id="js_content"><p>米饭与美食的公开文章正文。</p><script>PRIVATE-SCRIPT</script><img data-src="https://mmbiz.qpic.cn/a.jpg"/></div>'),options);
 assert.equal(items[0].title,'白饭研究');assert.match(items[0].content,/公开文章正文/);assert.ok(!items[0].content.includes('PRIVATE-SCRIPT'));assert.equal(items[0].images[0],'https://mmbiz.qpic.cn/a.jpg');
});

test('actual Xiaohongshu parser extracts note text and images with domain-scoped cookies',async()=>{
 const state={note:{noteDetailMap:{abc123:{note:{title:'晚饭',desc:'今晚吃红烧肉和白饭',user:{nickname:'厨师'},type:'normal',imageList:[{urlDefault:'https://sns-img-qc.xhscdn.com/a.jpg'}]}}}}};
 let count=0;
 const items=await readShare('https://www.xiaohongshu.com/explore/abc123',async(u,o)=>{count++;assert.match(o.headers.cookie,/a1=synthetic/);assert.ok(!Object.values(o.headers).some(v=>String(v).includes('OTHER-SITE')));return html('<script>window.__INITIAL_STATE__='+JSON.stringify(state)+'</script>');},{...options,cookies:{redbook_cookies:'a1=synthetic',bilibili_cookies:'SESSDATA=OTHER-SITE'}});
 assert.equal(count,1);assert.equal(items[0].title,'晚饭');assert.match(items[0].content,/红烧肉/);assert.equal(items[0].images.length,1);
});

test('actual GitHub parser supplies public repository metadata and its official card',async()=>{
 const items=await readShare('https://github.com/example/public-repo',async()=>html('<meta property="og:title" content="example/public-repo"><meta property="og:description" content="公开项目简介"><meta property="og:image" content="https://opengraph.githubassets.com/a/example/public-repo">'),options);
 assert.equal(items[0].title,'example/public-repo');assert.match(items[0].content,/公开项目简介/);assert.equal(items[0].images.length,1);
 await assert.rejects(()=>readShare('https://github.com/example/public-repo/issues/1',async()=>{throw Error('must not fetch');},options),/失败/);
});

test('source images become bounded visual inputs without cookies or model API keys',async()=>{
 const items=[{platform:'redbook',url:'https://www.xiaohongshu.com/explore/a',images:['https://sns-img.xhscdn.com/a.jpg','https://evil.test/x','https://sns-img.xhscdn.com/b.jpg']}];
 let calls=0;
 const parts=await shareImageParts(items,async(u,o)=>{calls++;assert.deepEqual(Object.keys(o.headers),['Referer']);return new Response(new Uint8Array([1,2]),{headers:{'content-type':'image/jpeg'}});},'low',resolve);
 assert.equal(calls,1);assert.equal(parts.length,1);assert.match(parts[0].image_url.url,/^data:image\/jpeg;base64,/);
 const failed=await shareImageParts(items,async()=>new Response('x'.repeat(3*1024*1024+1),{headers:{'content-type':'image/jpeg'}}),'low',resolve);assert.deepEqual(failed,[]);
});

test('disabled/failed parsing, missing runtime and private redirects never claim success or save old results',async()=>{
 const store=new LearningStore(contextDir(),async()=>new Response('',{status:403}),options);
 const url='https://www.bilibili.com/video/BV1GJ411x7h7';
 assert.equal(await store.context(url,{enabled:false}),'');
 const failed=await store.context(url,{owner:true,remember:true});assert.match(failed,/不得声称读取成功/);assert.equal(store.list().length,0);
 await assert.rejects(()=>readShare('https://www.pixiv.net/artworks/123',async()=>{throw Error('no network');},options),/未开启/);
 await assert.rejects(()=>readShare(url,async()=>html(''),{...options,runtime:path.join(contextDir(),'missing')}),/未就绪/);
 await assert.rejects(()=>readShare('https://b23.tv/short',async()=>new Response('',{status:302,headers:{location:'https://127.0.0.1/private'}}),options),/失败/);
});

test('share cards use the same learning cache and public sources without an extra planning model call',async()=>{
 let calls=0,plans=0,sourceItems=[];
 const store=new LearningStore(contextDir(),async()=>{calls++;return Response.json({code:0,data:{title:'白饭',owner:{name:'厨师'},desc:'介绍'}});},options);
 const cards=[{url:'https://www.bilibili.com/video/BV1GJ411x7h7',title:'白饭',preview:'',metadata:{}}];
 const opts={cards,owner:true,remember:true,onSources:i=>sourceItems=i,planner:()=>{plans++;throw Error('no model');}};
 assert.match(await store.context(cardText(cards),opts),/低可信网页/);await store.context(cardText(cards),opts);
 assert.equal(plans,0);assert.equal(calls,1);assert.equal(sourceItems.length,1);assert.equal(store.list().length,1);
});
