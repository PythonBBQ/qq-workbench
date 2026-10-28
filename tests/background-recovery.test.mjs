import {test} from 'node:test';
import assert from 'node:assert/strict';
import {socketDeadline} from '../assets/snowluma-bridge.mjs';

test('a stuck CONNECTING socket expires once, releasing the reconnect path',()=>{
  const socket=new EventTarget();socket.readyState=0;let fire,cancelled=0,timeouts=0;
  socketDeadline(socket,()=>{timeouts++;},{milliseconds:123,schedule:(f,ms)=>{assert.equal(ms,123);fire=f;return 1;},cancel:()=>cancelled++});
  fire();fire();assert.equal(timeouts,1);assert.equal(cancelled,1);
});
test('open, error, close and replacement all cancel the handshake watchdog',()=>{
  for(const type of ['open','error','close','replace']){
    const socket=new EventTarget();socket.readyState=0;let fire,timeouts=0,cancelled=0;
    const cleanup=socketDeadline(socket,()=>timeouts++,{schedule:f=>{fire=f;return 1;},cancel:()=>cancelled++});
    if(type==='replace')cleanup();else socket.dispatchEvent(new Event(type));
    fire();cleanup();assert.equal(timeouts,0,type);assert.equal(cancelled,1,type);
  }
});
