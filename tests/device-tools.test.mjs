import {test} from 'node:test';import assert from 'node:assert/strict';
import {deviceRequest,runDeviceTask,validDeviceOperation} from '../assets/device-tools.mjs';
const event={user_id:123456,self_id:765432,message_type:'private',message_id:1};
const task=overrides=>({request:deviceRequest('查看手机电量'),event,config:{owner:'123456',deviceToolsEnabled:true},stillCurrent:()=>true,planner:()=>{throw new Error('not needed');},execute:async()=>({ok:true,output:'battery 80%'}),...overrides});
test('device intents never treat negation, quotes or arbitrary shell as executable commands',()=>{
  assert.equal(deviceRequest('查看手机电量').operations[0].action,'battery');
  assert.equal(deviceRequest('adb shell: wm size').operations[0].action,'display');
  assert.equal(deviceRequest('adb shell: input tap 5 6').operations[0].y,6);
  assert.equal(deviceRequest('打开B站').operations[0].package,'tv.danmaku.bili');
  for(const text of ['别打开B站','不要查看手机电量','怎么查看手机电量','“打开B站”','有人说打开B站'])assert.equal(deviceRequest(text),null,text);
  for(const text of ['adb shell: rm -rf /data','adb shell: wm size; cat /secret'])assert.equal(deviceRequest(text).unsupported,true);
  assert.equal(validDeviceOperation({action:'tap',x:-1,y:3}),false);assert.equal(validDeviceOperation({action:'launch',package:'com.example;reboot'}),false);
});
test('only the current real owner may use an enabled capability; direct tasks make no model call',async()=>{
  let count=0;assert.match(await runDeviceTask(task({execute:async()=>{count++;return {ok:true,output:'battery 80%'};}})),/80%/);assert.equal(count,1);
  assert.match(await runDeviceTask(task({event:{...event,user_id:999999}})),/只有主人/);
  assert.match(await runDeviceTask(task({config:{owner:'123456',deviceToolsEnabled:false}})),/尚未开启/);
});
test('a planned batch validates every action before running; failure and owner switch stop later actions',async()=>{
  let count=0;const request={plan:'用adb读取状态并回桌面'};
  const planner=async()=>JSON.stringify({operations:[{action:'battery'},{action:'key',key:'home'}]});
  assert.match(await runDeviceTask(task({request,planner,execute:async()=>{count++;return {ok:false,message:'未确认，不重试'};}})),/未确认/);assert.equal(count,1);
  count=0;await runDeviceTask(task({request,planner:async()=>JSON.stringify({operations:[{action:'battery'},{action:'shell',command:'secret'}]}),execute:async()=>{count++;}}));assert.equal(count,0);
  let current=true;count=0;await runDeviceTask(task({request,planner,stillCurrent:()=>current,execute:async()=>{count++;current=false;return {ok:true};}}));assert.equal(count,1);
});
test('action identifiers are stable for retries and cannot collide between conversations',async()=>{
  const ids=[];const run=ev=>runDeviceTask(task({event:ev,execute:async r=>{ids.push(r.id);return {ok:true};}}));
  await run(event);await run(event);await run({...event,message_type:'group',group_id:222222});assert.equal(ids[0],ids[1]);assert.notEqual(ids[0],ids[2]);assert.match(ids[0],/^[a-f0-9]{64}$/);
});
