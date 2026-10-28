import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QzoneClient} from '../assets/qzone-client.mjs';
const cookies='uin=o765432; p_uin=o765432; p_skey=synthetic-private-cookie';
function client(fetcher,extra={}){return new QzoneClient(async a=>{assert.equal(a,'get_cookies');return {status:'ok',retcode:0,data:{cookies}};},()=> '765432',{fetcher,...extra});}
test('native Qzone reads accept authenticated empty null lists, reject missing and foreign responses',async()=>{
  let calls=0;const q=client(async(url,o)=>{calls++;assert.equal(new URL(url).hostname,'user.qzone.qq.com');assert.equal(o.headers.Cookie,cookies);assert.equal(o.redirect,'error');assert.equal(o.method,'GET');return Response.json({code:0,total:0,msglist:null,logininfo:{uin:765432}});});
  assert.deepEqual((await q.request('get_qzone_msg_list')).data,{total:0,msglist:[]});assert.equal(calls,1);
  for(const data of [{code:0,total:0},{code:0,total:0,msglist:null,logininfo:{uin:111111}},{code:-3,total:0,msglist:[]},{code:0,total:1,msglist:null,logininfo:{uin:765432}}])await assert.rejects(()=>client(async()=>Response.json(data)).request('get_qzone_msg_list'));
});
test('Qzone text posts use configured visibility and real receipts, never retry a write',async()=>{
  let calls=0;const q=client(async(url,o)=>{calls++;assert.match(url,/emotion_cgi_publish_v6/);const body=new URLSearchParams(o.body);assert.equal(body.get('con'),'白饭真香');assert.equal(body.get('ugc_right'),'4');assert.equal(body.get('hostuin'),'765432');assert.equal(o.method,'POST');return Response.json({code:0,t1_tid:'synthetic-tid',t1_time:'123'});});
  assert.equal((await q.request('send_qzone_msg',{content:'白饭真香',ugc_right:4})).data.tid,'synthetic-tid');assert.equal(calls,1);
  for(const result of [{code:0},{code:-10000},null]){calls=0;await assert.rejects(()=>client(async()=>{calls++;if(result===null)throw new Error('timeout');return Response.json(result);}).request('send_qzone_msg',{content:'白饭真香',ugc_right:4}));assert.equal(calls,1);}
});
test('account switch during cookie acquisition cannot reach Qzone HTTPS or reuse another account cookie',async()=>{
  let bot='765432',requests=0;const q=new QzoneClient(async()=>{bot='999999';return {status:'ok',retcode:0,data:{cookies}};},()=>bot,{fetcher:async()=>{requests++;throw new Error('must not fetch');}});
  await assert.rejects(()=>q.request('send_qzone_msg',{content:'取消',ugc_right:4}));assert.equal(requests,0);
});

test('read-only fallback selects a working Tencent gateway; the following POST is never replayed elsewhere',async()=>{
  const calls=[];const q=client(async(url,o)=>{calls.push({host:new URL(url).hostname,method:o.method});if(o.method==='POST')throw new Error('timeout after write');if(new URL(url).hostname==='user.qzone.qq.com')throw new Error('network');return Response.json({code:0,total:0,msglist:[]});});
  await q.request('get_qzone_msg_list');await assert.rejects(()=>q.request('send_qzone_msg',{content:'唯一一次',ugc_right:4}));assert.deepEqual(calls,[{host:'user.qzone.qq.com',method:'GET'},{host:'h5.qzone.qq.com',method:'GET'},{host:'h5.qzone.qq.com',method:'POST'}]);
});
