import {test} from 'node:test';import assert from 'node:assert/strict';
import {callModel,completionUrl} from '../assets/model-client.mjs';
const body={model:'test-model',messages:[{role:'user',content:'你好'}],max_tokens:600};
test('relay endpoint paths accept full chat/responses/models routes without duplication',()=>{
 for(const url of ['https://relay.example/v1','https://relay.example/v1/models','https://relay.example/v1/chat/completions','https://relay.example/v1/responses']){
  assert.equal(completionUrl(url),'https://relay.example/v1/chat/completions');assert.equal(completionUrl(url,'responses'),'https://relay.example/v1/responses');
 }
 for(const url of ['http://relay.example','https://user:secret@relay.example','https://relay.example?key=secret'])assert.throws(()=>completionUrl(url));
});
test('only missing root paths gain v1 and token field incompatibility is retried once on same origin',async()=>{
 const calls=[];const result=await callModel({url:'https://relay.example',key:'synthetic',body,fetcher:async(url,o)=>{
  const b=JSON.parse(o.body);calls.push({url,b});assert.equal(o.headers.Authorization,'Bearer synthetic');assert.equal(o.redirect,'error');
  if(calls.length===1)return Response.json({error:{message:'not found'}},{status:404});
  if(calls.length===2)return Response.json({error:{message:'Unsupported max_tokens; use max_completion_tokens'}},{status:400});
  return Response.json({choices:[{message:{content:[{type:'text',text:'已连接'}]}}]});
 }});assert.equal(result,'已连接');assert.equal(calls.length,3);assert.equal(calls[2].url,'https://relay.example/v1/chat/completions');assert.equal(calls[2].b.max_completion_tokens,600);assert.ok(!('max_tokens' in calls[2].b));
 let n=0;await assert.rejects(()=>callModel({url:'https://relay.example/custom',key:'synthetic',body,fetcher:async()=>{n++;return Response.json({},{status:404});}}),/404/);assert.equal(n,1);
});
test('authentication, quota and network failures never retry or expose upstream secrets',async()=>{
 for(const status of [401,403,429]){let calls=0;await assert.rejects(()=>callModel({url:'https://relay.example',key:'secret-never-print',body,fetcher:async()=>{calls++;return Response.json({error:{message:'credit secret-never-print'}},{status});}}),e=>!e.message.includes('secret-never-print')&&e.message.includes('HTTP'));assert.equal(calls,1);}
 let calls=0;await assert.rejects(()=>callModel({url:'https://relay.example',key:'synthetic',body,fetcher:async()=>{calls++;throw new Error('upstream secret');}}),/网络连接失败/);assert.equal(calls,1);
});
test('Responses maps text/image inputs and output usage while SSE compatibility does not expose reasoning',async()=>{
 let usage;const result=await callModel({url:'https://relay.example/v1',key:'synthetic',protocol:'responses',body:{...body,messages:[{role:'system',content:'规则'},{role:'user',content:[{type:'text',text:'图片'},{type:'image_url',image_url:{url:'data:image/png;base64,AQID',detail:'low'}}]}]},onUsage:v=>usage=v,fetcher:async(url,o)=>{
  assert.match(url,/v1\/responses$/);const b=JSON.parse(o.body);assert.equal(b.max_output_tokens,600);assert.ok(!('messages' in b));assert.equal(b.input[1].content[1].type,'input_image');
  return Response.json({output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text:'看到了'}]}],usage:{input_tokens:12,output_tokens:3}});
 }});assert.equal(result,'看到了');assert.equal(usage.prompt_tokens,12);
 const streamed=await callModel({url:'https://relay.example/v1',key:'synthetic',body,fetcher:async()=>new Response('data: {"choices":[{"delta":{"reasoning_content":"不要作为回答"}}]}\n\ndata: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n',{headers:{'content-type':'text/event-stream'}})});assert.equal(streamed,'你好');
 await assert.rejects(()=>callModel({url:'https://relay.example/v1',key:'synthetic',body,fetcher:async()=>Response.json({choices:[{message:{reasoning_content:'隐藏推理'},finish_reason:'length'}]})}),/只返回思考/);
});
