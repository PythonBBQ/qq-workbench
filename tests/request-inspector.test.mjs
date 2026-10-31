import test from 'node:test';import assert from 'node:assert/strict';import {RequestInspector} from '../assets/request-inspector.mjs';
test('outgoing preview preserves roles and selected memory, hides credentials and image bytes, and cannot leak across instances',()=>{
  const one=new RequestInspector({secrets:()=>['synthetic-private-key']}),two=new RequestInspector();
  const id=one.capture('https://relay.example/v1/chat/completions',{headers:{Authorization:'Bearer synthetic-private-key'},body:JSON.stringify({model:'sample',messages:[{role:'system',content:'身份与记忆：喜欢白饭'},{role:'user',content:[{type:'text',text:'晚安 synthetic-private-key sk-abc123abc123abc123'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,private-image-bytes'}}]}],max_tokens:600})},'chat');
  const result=JSON.stringify(one.get(id));assert.match(result,/喜欢白饭/);assert.match(result,/晚安/);assert.ok(!result.includes('synthetic-private-key'));assert.ok(!result.includes('sk-abc'));assert.ok(!result.includes('private-image-bytes'));assert.equal(one.get(id).images,1);assert.equal(one.list()[0].body,undefined);assert.equal(two.list().length,0);assert.throws(()=>two.get(id));one.finish(id,false);assert.equal(one.get(id).status,'failed');one.clear();assert.throws(()=>one.get(id));
});
test('Responses request inspection records actual input format, bounds recent records and marks truncation',()=>{
  const p=new RequestInspector({limit:2,maxChars:30});for(let n=0;n<3;n++)p.capture('https://model.example/v1/responses',{body:JSON.stringify({model:'test',input:[{role:'user',content:[{type:'input_text',text:'x'.repeat(200)}]}]})},'vision');
  assert.equal(p.list().length,2);const entry=p.get(p.list()[0].id);assert.equal(entry.protocol,'responses');assert.equal(entry.truncated,true);assert.ok(JSON.stringify(entry.body).length<500);assert.ok(Array.isArray(entry.body.input));
});
