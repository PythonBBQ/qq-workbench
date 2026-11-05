import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {LearningStore} from '../assets/learning.mjs';
import {readWeb} from '../assets/web-learning.mjs';
import {sharedLinks} from '../assets/multi-parser.mjs';
import {parseShortcut} from '../assets/shortcuts.mjs';

const resolve=async()=>[{address:'93.184.216.34'}];
const page=body=>new Response('<title>部署文档</title><main>'+body+'</main>',{headers:{'content-type':'text/html; charset=utf-8'}});
function store(fetcher){const root=path.resolve(import.meta.dirname,'../build/web-pages-tests');fs.mkdirSync(root,{recursive:true});return new LearningStore(fs.mkdtempSync(path.join(root,'case-')),fetcher,{resolve});}
const history=url=>[{role:'user',content:'看看 '+url},{role:'assistant',content:'这是一篇部署说明。'}];

test('provided links handle Chinese punctuation and www; hash browsing retains the actual question',()=>{
 assert.deepEqual(sharedLinks('看https://example.com/guide，说明安装步骤。还有www.example.org/docs。'),['https://example.com/guide','https://www.example.org/docs']);
 const result=parseShortcut({message_type:'private',message:[{type:'text',data:{text:'#浏览 www.example.org/docs 安装步骤是什么'}}]});
 assert.match(result.event.message[0].data.text,/安装步骤是什么/);assert.equal(result.operation,undefined);
});

test('long provided pages select relevant later paragraphs without a second model call or pretending to read the full page',async()=>{
 const body='这是前面的普通介绍。'.repeat(650)+'安装步骤：先安装 DENO_TARGET，然后运行部署命令。'+'这是后面的普通说明。'.repeat(200);
 const [item]=await readWeb('https://example.com/guide',async()=>page(body),resolve,{question:'安装步骤是什么'});
 assert.match(item.content,/DENO_TARGET/);assert.match(item.content,/不代表全文/);assert.ok(item.content.length<3400);
 const learning=store(async()=>page(body));let plans=0;
 const context=await learning.context('https://example.com/guide，安装步骤是什么',{planner:()=>{plans++;throw Error('no planning call');}});
 assert.match(context,/DENO_TARGET/);assert.equal(plans,0);assert.ok(context.length<7000);
 const [ending]=await readWeb('https://example.com/guide',async()=>page(body+' ENDING_ONLY'),resolve,{question:'这个网页结尾说了什么'});
 assert.match(ending.content,/ENDING_ONLY/);
});

test('page followups only resolve the current conversation, prefer the newest URL and do not browse ordinary chat',async()=>{
 const calls=[];const learning=store(async url=>{calls.push(url);return page('这是当前页面的部署说明和安装注意事项。'.repeat(8));});
 await learning.context('这篇文章的安装步骤呢',{history:history('https://example.com/one')});
 await learning.context('这篇文章的安装步骤呢',{history:history('https://example.com/two')});
 assert.deepEqual(calls,['https://example.com/one','https://example.com/two']);
 const missing=await learning.context('这个网页讲了什么',{history:[]});assert.match(missing,/发来网址/);assert.equal(calls.length,2);
 assert.equal(await learning.plan('总结一下',{history:[],automatic:false}),null);
 await learning.context('今天天气不错，想去散步',{history:history('https://example.com/one'),automatic:false});assert.equal(calls.length,2);
 await learning.context('不要浏览这个网页 https://example.com/one',{history:[]});assert.equal(calls.length,2);
});

test('refresh bypasses prior page cache; a failed new page cannot borrow old content',async()=>{
 let calls=0,fail=false;
 const learning=store(async()=>{calls++;return fail?new Response('',{status:403}):page('这是页面第'+calls+'次读取到的可靠公开资料。'.repeat(8));});
 const text='https://example.com/one';await learning.context(text);await learning.context(text);assert.equal(calls,1);
 const refreshed=await learning.context('重新读取这个网页',{history:history(text)});assert.equal(calls,2);assert.match(refreshed,/本次已读取/);
 fail=true;
 const failed=await learning.context('看看 https://example.com/new');assert.match(failed,/403/);assert.ok(!failed.includes('可靠公开资料'));
 const followup=await learning.context('这篇文章讲了什么',{history:history('https://example.com/new')});assert.match(followup,/联网失败/);assert.ok(!followup.includes('可靠公开资料'));
});

test('two supplied pages are read separately and a denied page is clearly distinguished from the successful page',async()=>{
 const calls=[];const learning=store(async url=>{calls.push(url);return url.endsWith('/blocked')?new Response('',{status:403}):page('这是唯一成功读取的网页正文资料。'.repeat(8));});let sources;
 const context=await learning.context('对比 https://example.com/blocked 和 https://example.com/open',{onSources:items=>sources=items});
 assert.equal(calls.length,2);assert.match(context,/部分网页未读到正文/);assert.match(context,/唯一成功读取/);
 assert.equal(sources.length,1);assert.equal(sources[0].url,'https://example.com/open');
});

test('legacy Chinese encoding decodes without replacement characters and verification pages are not article evidence',async()=>{
 const bytes=Buffer.concat([Buffer.from('<title>GBK</title><main>'),Buffer.from([0xc4,0xe3,0xba,0xc3]),Buffer.from(' readable public page content '.repeat(5)+' </main>')]);
 const [item]=await readWeb('https://example.com/gbk',async()=>new Response(bytes,{headers:{'content-type':'text/html; charset=gbk'}}),resolve);
 assert.match(item.content,/你好/);assert.ok(!item.content.includes('�'));
 await assert.rejects(()=>readWeb('https://example.com/verify',async()=>new Response('<title>Just a moment...</title><main>'+('Checking your browser. '.repeat(5))+'</main>',{headers:{'content-type':'text/html'}}),resolve),/访问验证/);
});
