import {test} from 'node:test';
import assert from 'node:assert/strict';
import {androidFetch} from '../assets/native-network.mjs';
test('Android networking preserves exact target and scoped headers, never passes local token upstream',async()=>{
  const calls=[];const fetcher=androidFetch(async(url,options)=>{calls.push({url,options});return Response.json({status:200,headers:{'Content-Type':'application/json'},body:Buffer.from('{"ok":true}').toString('base64')});},'local-secret');
  const response=await fetcher('https://relay.example/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer provider-key','Content-Type':'application/json'},body:'{"model":"demo"}'});
  assert.deepEqual(await response.json(),{ok:true});assert.equal(calls[0].url,'http://127.0.0.1:13481/fetch');
  const body=JSON.parse(calls[0].options.body);assert.equal(body.url,'https://relay.example/v1/chat/completions');assert.equal(body.headers.authorization,'Bearer provider-key');assert.ok(!calls[0].options.body.includes('local-secret'));
  assert.equal(calls[0].options.headers.Authorization,'Bearer local-secret');
  await fetcher('https://example.com',{networkTimeoutMs:2500});assert.equal(JSON.parse(calls[1].options.body).timeoutMs,2500);
});
test('native HTTP errors are responses, network failures are useful and never replay requests',async()=>{
  let calls=0;const fetcher=androidFetch(async()=>{calls++;return Response.json({error:'timeout'},{status:502});},'local-secret');
  await assert.rejects(()=>fetcher('https://relay.example/v1'),/连接超时/);assert.equal(calls,1);
  const redirect=androidFetch(async()=>Response.json({status:302,headers:{Location:'https://other.example'},body:''}),'local-secret');
  await assert.rejects(()=>redirect('https://relay.example',{redirect:'error'}),/跳转/);
});
