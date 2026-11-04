import test from 'node:test';
import assert from 'node:assert/strict';
import {ReplyTasks} from '../assets/delivery-recovery.mjs';

test('a permanently stalled dependency releases the queue and late continuations cannot send',async()=>{
  const tasks=new ReplyTasks();let finish,lateSend=false;
  const first=tasks.run(async()=>{tasks.phase('等待模型回复');await tasks.wait(new Promise(r=>{finish=r;}));tasks.check();lateSend=true;},{timeoutMs:35});
  await assert.rejects(first,/超时|时限/);assert.equal(tasks.state().active,false);
  assert.equal(await tasks.run(async()=>{tasks.check();return '下一条成功';}), '下一条成功');
  finish();await new Promise(r=>setTimeout(r,20));assert.equal(lateSend,false);
});

test('pause cancels a fetch even if the transport ignores AbortSignal; unrelated health work survives',async()=>{
  const tasks=new ReplyTasks();let signal,resolve,after=false;
  const fetch=tasks.fetch(async(_url,options)=>{signal=options.signal;return new Promise(r=>{resolve=r;});});
  const task=tasks.run(async()=>{await fetch('https://example.com');after=true;});
  await new Promise(r=>setTimeout(r,10));tasks.cancel('主人暂停回复');
  await assert.rejects(task,/主人暂停/);assert.equal(signal.aborted,true);
  resolve(new Response('late'));await new Promise(r=>setTimeout(r,10));assert.equal(after,false);
  assert.equal(await tasks.wait(Promise.resolve('健康检查正常')),'健康检查正常');
});

test('a body parser that never returns is bounded and a successful next task starts cleanly',async()=>{
  const tasks=new ReplyTasks();
  await assert.rejects(tasks.run(async()=>{tasks.phase('读取模型响应');await tasks.wait(new Promise(()=>{}),20);},{timeoutMs:500}),/读取模型响应等待超时/);
  await tasks.run(async()=>{tasks.phase('发送QQ回复');assert.equal(tasks.state().phase,'发送QQ回复');});
  assert.equal(tasks.state().active,false);
});
