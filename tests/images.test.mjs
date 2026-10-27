import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visionTarget,imageParts,contextText,trimImageHistory,limitContextImages} from '../assets/images.mjs';
const official={apiUrl:'https://api.deepseek.com/v1',model:'deepseek-chat'};
test('official image requests reuse the existing Key with the documented vision model',()=>{
  assert.deepEqual(visionTarget(official,'chat-key'),{url:official.apiUrl,model:'deepseek-flash',key:'chat-key',direct:true});
  assert.equal(visionTarget({...official,model:'deepseek-v4-pro'},'key').model,'deepseek-flash');
});
test('custom gateways require an explicit capability selection and preserve the selected model',()=>{
  const c={apiUrl:'https://gateway.example/v1',model:'my-image-model'};
  assert.equal(visionTarget(c,'key'),null);
  assert.deepEqual(visionTarget({...c,visionMode:'chat'},'key'),{url:c.apiUrl,model:c.model,key:'key',direct:true});
});
test('a separate vision service never receives the chat Key across origins',()=>{
  const c={...official,visionUrl:'https://vision.example/v1',visionModel:'vision',visionMode:'separate'};
  assert.equal(visionTarget(c,'private-chat-key'),null);
  assert.equal(visionTarget(c,'private-chat-key','vision-key').key,'vision-key');
  assert.equal(visionTarget({...c,visionUrl:official.apiUrl},'chat-key').key,'chat-key');
});
const event=urls=>({message:urls.map(url=>({type:'image',data:{url}}))});
test('image downloads carry no API credentials, reject untrusted hosts and do not follow redirects',async()=>{
  let calls=0;
  const parts=await imageParts(event(['https://multimedia.nt.qq.com.cn/a','https://qq.com.evil.example/a']),async(url,options)=>{
    calls++;assert.equal(options.headers,undefined);assert.equal(options.redirect,'error');
    return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png; charset=binary'}});
  });
  assert.equal(calls,1);assert.equal(parts.length,1);assert.equal(parts[0].image_url.url,'data:image/png;base64,AQID');
});
test('bad responses and oversized pictures leave accompanying text usable',async()=>{
  assert.deepEqual(await imageParts(event(['https://qpic.cn/a']),async()=>{throw new Error('offline');}),[]);
  assert.deepEqual(await imageParts(event(['https://qpic.cn/a']),async()=>new Response('HTML',{headers:{'content-type':'text/html'}})),[]);
  assert.deepEqual(await imageParts(event(['https://qpic.cn/a']),async()=>new Response(new Uint8Array(6*1024*1024+1),{headers:{'content-type':'image/png'}})),[]);
});
const picture=size=>({type:'image_url',image_url:{url:'data:image/png;base64,'+'a'.repeat(size)}});
const turn=(text,size)=>({role:'user',content:[{type:'text',text},picture(size)]});
test('follow-up history keeps recent pictures and conversational text within memory limits',()=>{
  const h=trimImageHistory([turn('第一张',100),{role:'assistant',content:'上次的回答'},turn('第二张',100),turn('第三张',100)]);
  assert.equal(h[0].content.filter(p=>p.type==='image_url').length,0);
  assert.equal(h[2].content.filter(p=>p.type==='image_url').length,1);
  assert.equal(contextText(h[0].content),'第一张');
  const contexts=new Map([['old',[turn('旧会话',100)]],['new',[turn('新会话',100)]]]);
  limitContextImages(contexts,150);
  assert.equal(contexts.get('old')[0].content.length,1);
  assert.equal(contexts.get('new')[0].content.length,2);
});
