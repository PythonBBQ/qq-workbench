import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fork} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {OwnerChat} from '../assets/owner-chat.mjs';
import {ConversationMemory,conversationScope} from '../assets/conversation-memory.mjs';

for(const scenario of ['send','held','low','repeat','skip','invalid','duplicate','failure']){const held=scenario==='held',outcome={skip:'model_skip',invalid:'invalid',duplicate:'duplicate',failure:'failed'}[scenario];test(outcome?'production draft outcome '+outcome+' is visible with no QQ send and no silent retry':scenario==='low'?'low score never invokes the model or sends; read-only inspection explains why':scenario==='repeat'?'unanswered proactive chat can send again at a later scored opportunity':held?'a real owner message cancels an in-flight proactive draft without a late send':'scheduler generates once, sends only to owner, records assistant-only history and yields to normal chat',async()=>{
 const root=path.resolve(import.meta.dirname,'..'),parent=path.join(root,'build/owner-chat-flow');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'case-'));
 for(const file of fs.readdirSync(path.join(root,'assets')).filter(f=>f.endsWith('.mjs')))fs.copyFileSync(path.join(root,'assets',file),path.join(dir,file));
 const now=Date.parse('2026-11-22T12:00:00Z'),hour=12;const c={owner:'123456',enabled:true,proactiveEnabled:true,proactiveQuietStart:23,proactiveQuietEnd:8,apiUrl:'https://model.invalid',model:'mock',memoryEnabled:true};
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify(c));const proactive=new OwnerChat(dir,{now:()=>now-7*3600000});if(scenario==='duplicate')proactive.sent({owner:c.owner,bot:'654321',category:'interest',interval:180*60000},'主人，昨天说的面条，后来做得怎么样啦？');proactive.entry(c.owner,'654321').activity=now-3600000;proactive.save();
 const memory=new ConversationMemory(dir),scope=conversationScope(c,{message_type:'private',user_id:c.owner},'654321');for(let i=0;i<(scenario==='low'?1:4);i++){memory.commit(scope,scenario==='low'?'你好':'我昨天在研究怎么做面条','可以从汤底试起',c);memory.record(scope).turns.at(-1).at=now-(4-i)*3600000;}memory.save();
 fs.writeFileSync(path.join(dir,'mock.mjs'),`
 import {SnowLumaBridge} from './snowluma-bridge.mjs';import {OwnerChat} from './owner-chat.mjs';import {ConversationMemory} from './conversation-memory.mjs';import http from 'node:http';
 let offset=0;const actualNow=Date.now,boot=actualNow();Date.now=()=>Date.parse('2026-11-22T12:00:00Z')+offset+(actualNow()-boot);
 const commit=ConversationMemory.prototype.commitInitiated;ConversationMemory.prototype.commitInitiated=function(...args){const result=commit.apply(this,args);process.send({committed:true});return result;};
 const listen=http.Server.prototype.listen;http.Server.prototype.listen=function(port,...args){return listen.call(this,port===13480?13489:port,...args);};
 const original=OwnerChat.prototype.due;OwnerChat.prototype.due=function(...args){this.started=Date.now()-11*60000;return original.apply(this,args);};
 const finish=OwnerChat.prototype.finish;OwnerChat.prototype.finish=function(...args){const result=finish.apply(this,args);if(result)process.send({decision:args[1]});return result;};
 const interval=globalThis.setInterval;globalThis.setInterval=(fn,ms,...a)=>interval(fn,ms===5000?40:ms,...a);
 SnowLumaBridge.prototype.start=function(){};SnowLumaBridge.prototype.stop=async function(){};SnowLumaBridge.prototype.remember=async function(){};
 SnowLumaBridge.prototype.state=async()=>({status:{isLogin:true},info:{uin:'654321'}});
 let proactiveCalls=0;let socket;globalThis.WebSocket=class extends EventTarget{static OPEN=1;static CONNECTING=0;constructor(){super();socket=this;this.readyState=0;setImmediate(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}receive(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}send(raw){const d=JSON.parse(raw);let data=d.action==='get_login_info'?{user_id:654321}:d.action==='get_status'?{online:true}:d.action==='get_friend_list'?[{user_id:123456}]:{message_id:Date.now()};if(d.action==='send_private_msg')process.send({sent:d.params});setImmediate(()=>this.receive({echo:d.echo,status:'ok',retcode:0,data}));}close(){this.readyState=3;}};
 process.on('message',m=>{if(m.advance)offset+=m.advance;if(m.event)socket.receive(m.event);});
 globalThis.fetch=async(url,request)=>{if(!String(url).startsWith('https://model.invalid'))throw new Error('Real network denied');const body=JSON.parse(request.body);process.send({model:body});const active=body.messages.at(-1).content.includes('工作台主动聊天任务');if(active&&process.env.OWNER_CHAT_HOLD==='1')await new Promise(resolve=>{const release=m=>{if(m.release){process.off('message',release);resolve();}};process.on('message',release);});if(active&&process.env.OWNER_CHAT_OUTCOME==='failure')throw new Error('Mock model unavailable');if(active&&['skip','invalid'].includes(process.env.OWNER_CHAT_OUTCOME))return Response.json({choices:[{message:{content:process.env.OWNER_CHAT_OUTCOME==='skip'?JSON.stringify({skip:true}):'not valid JSON'}}]});return Response.json({choices:[{message:{content:active?JSON.stringify({text:++proactiveCalls===1?'主人，昨天说的面条，后来做得怎么样啦？':'我想到面条汤底可以换成菌菇口味，鲜一点也很适合你。'}):'那我们接着聊面条吧。'}}],usage:{prompt_tokens:100,completion_tokens:20}});};
 `);
 const token='test-owner-chat-no-real-network-123456789',sent=[],models=[],decisions=[];let log='',committed=false;
 const child=fork(path.join(dir,'assistant.mjs'),[],{execArgv:['--import',pathToFileURL(path.join(dir,'mock.mjs')).href],env:{...process.env,WORKBENCH_TOKEN:token,DEEPSEEK_API_KEY:'mock-key',QQWB_INSTANCE_SLOT:'0',QQWB_TIME_ZONE:'UTC',OWNER_CHAT_HOLD:held?'1':'0',OWNER_CHAT_OUTCOME:scenario},stdio:['ignore','pipe','pipe','ipc']});
 child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);child.on('message',m=>{if(m.decision)decisions.push(m.decision);if(m.sent)sent.push(m.sent);if(m.model)models.push(m.model);if(m.committed)committed=true;});
 const until=async fn=>{const end=Date.now()+8000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw new Error(log);};
 try{
  if(outcome){await until(()=>decisions.includes(outcome));const response=await fetch('http://127.0.0.1:13489/owner-chat/state',{headers:{Authorization:'Bearer '+token}});const snapshot=await response.json();assert.equal(snapshot.lastDecision.status,outcome);assert.equal(snapshot.shouldGenerate,false);assert.ok(snapshot.earliestCheckAt>snapshot.at);await new Promise(r=>setTimeout(r,650));assert.equal(sent.length,0);assert.equal(models.length,1);return;}
  if(scenario==='low'){await new Promise(r=>setTimeout(r,1600));const response=await fetch('http://127.0.0.1:13489/owner-chat/state',{headers:{Authorization:'Bearer '+token}});const score=await response.json();assert.equal(score.eligible,false);assert.equal(score.category,'');assert.equal(models.length,0);assert.equal(sent.length,0);return;}
  if(held){
   await until(()=>models.length===1);assert.equal(sent.length,0);
   child.send({event:{post_type:'message',message_type:'private',sub_type:'friend',self_id:654321,user_id:123456,time:Math.floor(now/1000),message_id:501,message:[{type:'text',data:{text:'我回来了，面条做好了'}}]}});
   await until(()=>sent.length===1);assert.match(sent[0].message[0].data.text,/接着聊/);assert.equal(models.length,2);
   child.send({release:true});await new Promise(r=>setTimeout(r,650));assert.equal(sent.length,1);assert.ok(decisions.includes('cancelled'));
   const stored=new ConversationMemory(dir);assert.equal(stored.record(scope).initiated?.length||0,0);
   return;
  }
  await until(()=>sent.length===1);assert.equal(String(sent[0].user_id),c.owner);assert.match(JSON.stringify(models[0].messages),/研究怎么做面条/);
  assert.match(models[0].messages.at(-1).content,/\d{4}-\d\d-\d\d \d\d:\d\d 主人：/);
  // Wait for production commit before opening the file; polling a read handle
  // can itself prevent atomic replacement on Windows.
  await until(()=>committed);
  const stored=new ConversationMemory(dir);assert.match(stored.history(scope,c).at(-1).content,/后来做得怎么样/);assert.equal(stored.record(scope).turns.length,4);assert.equal(stored.history(scope,c).at(-1).role,'assistant');
  await new Promise(r=>setTimeout(r,650));assert.equal(models.length,1);assert.equal(sent.length,1);
  if(scenario==='repeat'){child.send({advance:7*3600000});await until(()=>sent.length===2);assert.equal(models.length,2);assert.match(models[1].messages.at(-1).content,/不追问上一条/);assert.match(sent[1].message[0].data.text,/菌菇/);return;}
  child.send({event:{post_type:'message',message_type:'private',sub_type:'friend',self_id:654321,user_id:123456,time:Math.floor(now/1000),message_id:500,message:[{type:'text',data:{text:'做完啦，我们聊聊别的'}}]}});
  await until(()=>sent.length===2);assert.equal(models.length,2);assert.match(sent[1].message[0].data.text,/接着聊/);
 }finally{try{await fetch('http://127.0.0.1:13489/shutdown',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'});}catch{}child.kill();}
});
}
