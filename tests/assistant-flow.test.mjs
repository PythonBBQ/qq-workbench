import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fork} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pause=()=>new Promise(r=>setTimeout(r,40));
test('first-run Key applies without restart; pictures and follow-ups use context in one call, no real QQ or model traffic',async()=>{
  const parent=path.join(root,'build','flow-tests');await fs.mkdir(parent,{recursive:true});const dir=await fs.mkdtemp(path.join(parent,'case-'));
  for(const name of ['assistant.mjs','shortcuts.mjs','qq-media.mjs','qzone-client.mjs','device-tools.mjs','usage-ledger.mjs','voice.mjs','model-client.mjs','personality-growth.mjs','group-moderation.mjs','conversation-memory.mjs','video.mjs','video-decoder.mjs','native-network.mjs','web-learning.mjs','browse-intent.mjs','learning.mjs','multi-parser.mjs','snowluma-bridge.mjs','images.mjs','chat-style.mjs'])await fs.copyFile(path.join(root,'assets',name),path.join(dir,name));
  await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({owner:'123456',enabled:true,others:true,rate:100,apiUrl:'https://api.deepseek.com',model:'deepseek-flash',persona:'温柔，爱吃白饭',maxReplyTokens:400,memoryEnabled:false}));
  await fs.writeFile(path.join(dir,'mock.mjs'),`
import {SnowLumaBridge} from './snowluma-bridge.mjs';
import dns from 'node:dns/promises';dns.lookup=async()=>[{address:'93.184.216.34'}];
SnowLumaBridge.prototype.start=function(){};SnowLumaBridge.prototype.stop=async function(){};
SnowLumaBridge.prototype.state=async function(){return {status:{isLogin:true},info:{uin:'765432'}}};
SnowLumaBridge.prototype.remember=async function(){};
let socket;let syntheticFaces=[];
globalThis.WebSocket=class extends EventTarget{
  static OPEN=1;static CONNECTING=0;
  constructor(){super();socket=this;this.readyState=0;setImmediate(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
  receive(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
  send(raw){const d=JSON.parse(raw);process.send({rpc:d.action});const data=d.action==='get_login_info'?{user_id:765432}:d.action==='get_status'?{online:true}:d.action==='get_cookies'?{cookies:'uin=o765432; p_uin=o765432; p_skey=synthetic-cookie'}:d.action==='add_custom_face'?{emoji_id:'synthetic-face'}:d.action==='fetch_custom_face_detail'?syntheticFaces.map(f=>({...f})):{message_id:Date.now()};
    if(d.action==='modify_custom_face'){const f=syntheticFaces.find(f=>f.emoji_id===d.params.emoji_id);if(f)f.desc=d.params.desc;}
    if(d.action==='send_custom_face')process.send({sent:{...d.params,message:[{type:'image',data:{emoji_id:d.params.emoji_id}}]}});
    if(/^send_(group|private)_msg$/.test(d.action))process.send({sent:d.params});
    if(d.action.startsWith('send_')&&globalThis.sendControl==='unconfirmed')delete data.message_id;
    const delay=d.action.startsWith('send_')&&globalThis.sendControl==='delayed'?200:0;
    setTimeout(()=>this.receive({echo:d.echo,status:'ok',retcode:0,data}),delay);}
  close(){this.readyState=3;}
};
process.on('message',m=>{if(m.socketClose&&socket){socket.readyState=3;socket.dispatchEvent(new Event('close'));}if(m.control)globalThis.sendControl=m.control;if(m.faces)syntheticFaces=m.faces;if(m.event)socket?.receive(m.event);});
globalThis.fetch=async(url,options)=>{
  const u=new URL(url);
  if(u.origin==='https://api.deepseek.com'||u.origin==='https://relay.example'){
    const body=JSON.parse(options.body);process.send({model:body,auth:options.headers.Authorization,host:u.hostname});
    if(body.messages[0].content.includes('为QQ收藏表情生成简短'))return Response.json({choices:[{message:{content:'{\"label\":\"开心、卖萌\"}'}}]});
    if(body.messages[0].content.includes('工作台具备QQ收藏表情发送能力')&&JSON.stringify(body.messages.at(-1)).includes('今天开心吗'))return Response.json({choices:[{message:{content:'好开心[[表情:1]]'}}]});
    if(JSON.stringify(body.messages.at(-1)).includes('测试旧版占位回复'))return Response.json({choices:[{message:{content:'（发送了一张QQ收藏表情）'}}]});
    if(body.model==='unavailable-model')return Response.json({error:{code:'invalid_api_key',message:'synthetic-upstream-secret'}},{status:401});
    if(body.messages[0].content.includes('联网检索路由器'))return Response.json({choices:[{message:{content:JSON.stringify({search:true,query:'DeepSeek 最新发布版本'})}}]});
    if(body.messages[0].content.includes('请将以下旧对话压缩'))await new Promise(r=>setTimeout(r,1200));
    if(JSON.stringify(body).includes('等待切换'))await new Promise(r=>setTimeout(r,200));
    return Response.json({choices:[{message:{content:'好呀，配一碗白饭！'}}],usage:{prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:20}});
  }
  if(u.origin==='http://127.0.0.1:13481'&&u.pathname==='/device/action'){const request=JSON.parse(options.body);process.send({device:request});return Response.json({ok:true,output:'synthetic battery: 80%',message:'执行完成'});}
  if(u.origin==='http://127.0.0.1:13481'&&u.pathname==='/video-frames')return Response.json({sampling:'1fps-contact-sheet-v1',durationSeconds:600,sampledSeconds:600,frameCount:600,frames:Array.from({length:75},(_,i)=>({seconds:i*8,timestamps:Array.from({length:8},(_,j)=>i*8+j),url:'data:image/jpeg;base64,AQID'}))});
  if(['h5.qzone.qq.com','user.qzone.qq.com'].includes(u.hostname)){
    if(options.method==='POST'){process.send({rpc:'send_qzone_msg',qzoneBody:options.body});return Response.json({code:0,...(globalThis.sendControl==='qzone-accepted'?{tid:'synthetic-post-id'}:{})});}
    return Response.json({code:0,total:0,msglist:null,logininfo:{uin:765432}});
  }
  if(u.hostname==='api.bilibili.com')return Response.json({code:0,data:{bvid:'BV1GJ411x7h7',title:'做饭与白饭',owner:{name:'测试作者'},desc:'仅供隔离测试的公开简介'}});
  if(u.hostname==='cn.bing.com'){process.send({browse:{url:u.href,auth:options.headers?.Authorization}});return new Response('<li class="b_algo"><h2><a href="https://example.com/deepseek">DeepSeek 官方资料</a></h2><p>公开搜索摘要</p></li>',{headers:{'content-type':'text/html'}});}
  if(u.hostname==='example.com'){process.send({browse:{url:u.href,auth:options.headers?.Authorization}});return new Response('<title>公开版本资料</title><main>'+('测试版本更新信息，仅供隔离验证。'.repeat(10))+'</main>',{headers:{'content-type':'text/html'}});}
  if(u.hostname==='qpic.cn')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});
  if(u.hostname==='mp.weixin.qq.com')return new Response('<h1 id="activity-name">分享文章</h1><a id="js_name">公开作者</a><div id="js_content"><p>只存在于本次分享中的公开正文。</p><img data-src="https://qpic.cn/shared-article.png"/></div>',{headers:{'content-type':'text/html'}});
  throw new Error('Unmocked network refused');
};`);
  const token='qqwb-isolated-test-token-1234567890';let log='',exited=false;const models=[],sent=[],browses=[],rpcs=[],devices=[];
  const child=fork(path.join(dir,'assistant.mjs'),[],{execArgv:['--import',pathToFileURL(path.join(dir,'mock.mjs')).href],env:{...process.env,WORKBENCH_TOKEN:token,DEEPSEEK_API_KEY:'',VISION_API_KEY:''},stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.on('data',v=>log+=v);child.stderr.on('data',v=>log+=v);child.on('exit',()=>exited=true);child.on('message',m=>{if(m.device)devices.push(m.device);if(m.rpc)rpcs.push(m.rpc);if(m.model)models.push(m);if(m.sent)sent.push(m.sent);if(m.browse)browses.push(m.browse);});
  const api=async(route,body,auth=true)=>fetch('http://127.0.0.1:13480'+route,{method:body===undefined?'GET':'POST',headers:{...(auth?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(1000)});
  const until=async(fn)=>{const end=Date.now()+6000;while(Date.now()<end){if(exited)throw new Error(log||'child exited');try{const r=await fn();if(r)return r;}catch(e){if(e.message.includes('child'))throw e;}await pause();}throw new Error('Flow timeout: '+log);};
  try{
    const state=await until(async()=>{const r=await api('/state');const s=await r.json();return s.connected?s:null;});assert.equal(state.modelConfigured,false);
    assert.equal((await api('/credentials',{apiKey:'fake-key',visionKey:''},false)).status,401);
    const credentials=await api('/credentials',{apiKey:'fake-key',visionKey:''});assert.equal(credentials.status,200);assert.ok(!(await credentials.text()).includes('fake-key'));
    const event={post_type:'message',message_type:'private',self_id:765432,user_id:123456,time:Math.floor(Date.now()/1000),message_id:101,message:[{type:'text',data:{text:'这张图里的菜，想吃吗？'}},{type:'image',data:{url:'https://qpic.cn/test.png'}}]};
    child.send({event});await until(()=>sent.length===1);
    assert.equal(models.length,1);assert.equal(models[0].auth,'Bearer fake-key');assert.equal(models[0].model.max_tokens,400);assert.equal(models[0].model.thinking.type,'disabled');
    assert.match(models[0].model.messages[0].content,/温柔，爱吃白饭/);assert.equal(models[0].model.messages.at(-1).content[1].type,'image_url');assert.match(models[0].model.messages.at(-1).content[0].text,/这张图/);
    child.send({event:{...event,message_id:102,message:[{type:'text',data:{text:'要不要加白饭？'}}]}});await until(()=>sent.length===2);
    assert.equal(models.length,2);assert.equal(models[1].model.messages[1].content[1].type,'image_url');assert.equal(sent[1].user_id,123456);
    const latest=await(await api('/state')).json();assert.deepEqual(latest.usage,{input:200,output:20,cached:40});
    assert.equal((await api('/context/clear',{},false)).status,401);
    assert.equal((await api('/context/clear',{})).status,200);
    child.send({event:{...event,message_id:103,message:[{type:'text',data:{text:'我们重新开始'}}]}});await until(()=>sent.length===3);
    assert.equal(models[2].model.messages.length,2);
    child.send({event:{...event,user_id:999999,message_id:104,message:[{type:'text',data:{text:'#sl'}}]}});
    await new Promise(r=>setTimeout(r,100));assert.equal(sent.length,3);assert.equal(models.length,3);
    child.send({event:{...event,message_id:105,message:[{type:'text',data:{text:'#sl'}}]}});await until(()=>sent.length===4);
    assert.equal(models.length,3);assert.match(sent[3].message[0].data.text,/SnowLuma/);
    child.send({event:{...event,message_type:'group',group_id:42,user_id:999999,message_id:106,message:[{type:'text',data:{text:'这个游戏大家觉得好玩吗'}}]}});await until(()=>sent.length===5);
    assert.equal(models.length,4);assert.equal(sent[4].group_id,42);assert.match(models[3].model.messages.at(-1).content,/群聊近期发言/);
    child.send({event:{...event,message_type:'group',group_id:42,user_id:888888,message_id:107,message:[{type:'text',data:{text:'我们再聊一下游戏'}}]}});
    await new Promise(r=>setTimeout(r,100));assert.equal(sent.length,5);
    assert.equal((await api('/learning/notes',undefined,false)).status,401);
    assert.equal((await api('/learning/read',{kind:'read',value:'https://www.bilibili.com/video/BV1GJ411x7h7',save:true},false)).status,401);
    const read=await(await api('/learning/read',{kind:'read',value:'https://www.bilibili.com/video/BV1GJ411x7h7',save:true})).json();assert.equal(read.items.length,1);assert.equal((await(await api('/learning/notes')).json()).notes.length,1);
    child.send({event:{...event,message_id:108,message:[{type:'text',data:{text:'https://www.bilibili.com/video/BV1GJ411x7h7 你学到了什么'}}]}});await until(()=>sent.length===6);assert.match(models[4].model.messages.at(-1).content,/未观看视频/);
    assert.equal((await api('/learning/delete',{id:'all'})).status,200);assert.equal((await(await api('/learning/notes')).json()).notes.length,0);
    const profile={settings:{apiUrl:'https://relay.example/v1',model:'relay-model',visionMode:'auto',visionUrl:'',visionModel:''},apiKey:'relay-test-key',visionKey:''};
    assert.equal((await api('/model/apply',profile,false)).status,401);
    child.send({event:{...event,message_id:109,message:[{type:'text',data:{text:'等待切换'}}]}});await until(()=>models.length===6);
    assert.equal((await api('/model/apply',profile)).status,200);await new Promise(r=>setTimeout(r,250));assert.equal(sent.length,6,'old in-flight reply must be cancelled');
    child.send({event:{...event,message_id:110,message:[{type:'text',data:{text:'现在使用哪个模型'}}]}});await until(()=>sent.length===7);
    assert.equal(models.at(-1).host,'relay.example');assert.equal(models.at(-1).auth,'Bearer relay-test-key');assert.equal(models.at(-1).model.model,'relay-model');assert.equal(models.at(-1).model.messages.length,2);assert.match(models.at(-1).model.messages[0].content,/温柔，爱吃白饭/);
    const saved=JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8'));assert.equal(saved.owner,'123456');assert.equal(saved.persona,'温柔，爱吃白饭');assert.ok(!JSON.stringify(saved).includes('relay-test-key'));
    assert.ok(!log.includes('fake-key'));assert.ok(!(await fs.readFile(path.join(dir,'settings.json'),'utf8')).includes('fake-key'));
    assert.equal((await api('/model/test',{},false)).status,401);
    const checked=await(await api('/model/test',{})).json();assert.equal(checked.ok,true);assert.equal(sent.length,7,'model check never sends QQ messages');
    const beforeChange=models.length;
    child.send({event:{...event,message_id:111,message:[{type:'text',data:{text:'等待切换大号'}}]}});await until(()=>models.length===beforeChange+1);
    await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({...saved,owner:'999999'}));
    await api('/state');await new Promise(r=>setTimeout(r,250));assert.equal(sent.length,7,'changing owner cancels old in-flight reply');
    child.send({event:{...event,message_id:112,message:[{type:'text',data:{text:'我还是主人吗'}}]}});await until(()=>sent.length===8);
    assert.match(models.at(-1).model.messages[0].content,/当前发言者不是大号/);assert.equal(models.at(-1).model.messages.length,2,'old identity history is cleared');
    child.send({event:{...event,message_id:113,user_id:999999,message_type:'group',group_id:42,message:[{type:'text',data:{text:'@deepseek 你知道我是谁吗'}}]}});await until(()=>sent.length===9);
    assert.match(models.at(-1).model.messages[0].content,/当前发言者就是大号/);assert.match(models.at(-1).model.messages[0].content,/称呼统一为“主人”/);
    // Memory and video routes are exercised in the isolated mock server.
    const active=JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8'));
    const update=async values=>{Object.assign(active,values);await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify(active));await api('/state');};
    await update({memoryEnabled:true,worldBook:'白饭 | 白饭是这只鲸鱼的最爱'});
    assert.equal((await api('/memory/list',undefined,false)).status,401);
    const sendOwner=(id,text)=>child.send({event:{...event,user_id:999999,message_id:id,message:[{type:'text',data:{text}}]}});
    sendOwner(114,'记住：我喜欢白饭');await until(()=>sent.length===10);
    let memories=await until(async()=>{const list=await(await api('/memory/list')).json();return list.sessions.length?list.sessions:null;});
    assert.equal(memories[0].turns,1);assert.equal(memories[0].notes[0].content,'我喜欢白饭');
    assert.match(models.at(-1).model.messages[0].content,/白饭是这只鲸鱼的最爱/);
    let exported=await(await api('/memory/export',{})).json();assert.equal(JSON.parse(exported.jsonl).messages[0].content,'记住：我喜欢白饭');
    const memoryId=memories[0].id;
    assert.equal((await api('/memory/note',{id:memoryId,content:'回答简短'})).status,200);
    sendOwner(115,'你好');await until(()=>sent.length===11);assert.match(models.at(-1).model.messages[0].content,/回答简短/);
    // An analysis is local-only and must not send to QQ.
    await update({visionMode:'chat'});
    const video=await(await api('/video/analyze',{durationSeconds:3,frames:[{seconds:1,url:'data:image/jpeg;base64,AQID'}],question:'概括画面'})).json();
    assert.equal(video.ok,true);assert.match(video.message,/抽样画面/);assert.equal(sent.length,11);
    assert.equal((await api('/video/analyze',{},false)).status,401);
    const badClip=await(await api('/video/analyze',{clip:'../../settings.json'})).json();assert.equal(badClip.ok,false);
    sendOwner(116,'等待切换并删除记忆');await until(()=>models.at(-1).model.messages.at(-1).content.includes('等待切换并删除记忆'));
    assert.equal((await api('/memory/delete',{id:'all'})).status,200);await new Promise(r=>setTimeout(r,260));
    assert.equal(sent.length,11);assert.equal((await(await api('/memory/list')).json()).sessions.length,0);
    // Deletion while an already-issued send awaits acknowledgement must stay deleted.
    child.send({control:'delayed'});sendOwner(117,'这次等待QQ确认');await until(()=>sent.length===12);
    await api('/memory/delete',{id:'all'});await new Promise(r=>setTimeout(r,260));
    assert.equal((await(await api('/memory/list')).json()).sessions.length,0);
    child.send({control:'normal'});sendOwner(118,'现在正常回复');await until(()=>sent.length===13);
    await until(async()=>((await(await api('/memory/list')).json()).sessions[0]?.turns===1));
    const originalScopes=(await(await api('/memory/list')).json()).sessions;
    await update({persona:'另一位角色'});sendOwner(119,'角色更换以后');await until(()=>sent.length===14);
    assert.equal(models.at(-1).model.messages.length,2,'new persona never reuses old conversation');
    await until(async()=>((await(await api('/memory/list')).json()).sessions.length===2));
    assert.ok((await(await api('/memory/list')).json()).sessions.some(r=>r.id===originalScopes[0].id));
    assert.equal((await(await api('/memory/export',{})).json()).jsonl.split('\n').length,1,'training export does not mix different characters');
    await update({compressionMode:'model'});
    for(let i=0;i<15;i++){const count=sent.length;sendOwner(130+i,'补充长对话'+i);await until(()=>sent.length===count+1);}
    await until(()=>models.some(m=>m.model.messages[0].content.includes('请将以下旧对话压缩')));
    const beforeNext=sent.length,startedNext=Date.now();sendOwner(145,'摘要在后台时继续说话');await until(()=>sent.length===beforeNext+1);
    assert.ok(Date.now()-startedNext<800,'optional summarization must not block the QQ reply queue');
    // Natural chat performs the search AND opens its source before final completion.
    await update({compressionMode:'local'});
    assert.equal((await api('/learning/preview',{text:'联网看看DeepSeek最新版本'},false)).status,401);
    let previousSent=sent.length,previousModels=models.length;
    sendOwner(150,'联网看看DeepSeek最新版本');await until(()=>sent.length===previousSent+1);
    assert.equal(models.length,previousModels+1,'an explicit topic uses one final completion, without a routing call');
    assert.ok(browses.some(n=>n.url.includes('bing.com/search')));assert.ok(browses.some(n=>n.url.includes('example.com/deepseek')));
    assert.ok(browses.every(n=>n.auth===undefined));assert.match(models.at(-1).model.messages.at(-1).content,/公开网页正文摘录/);
    assert.match(models.at(-1).model.messages.at(-1).content,/来源：https:\/\/example.com\/deepseek/);
    previousSent=sent.length;previousModels=models.length;sendOwner(151,'那你再查一下');await until(()=>sent.length===previousSent+1);
    assert.equal(models.length,previousModels+1,'simple repeat search uses the known topic without an extra model call');
    previousSent=sent.length;previousModels=models.length;sendOwner(154,'那它当前版本支持什么，联网查一下');await until(()=>sent.length===previousSent+1);
    assert.equal(models.length,previousModels+2,'ambiguous followup uses one bounded planner then answers');
    assert.match(models.at(-2).model.messages.at(-1).content,/DeepSeek/);
    const beforeDecline=browses.length;previousSent=sent.length;sendOwner(152,'不要联网，直接和我聊聊白饭');await until(()=>sent.length===previousSent+1);assert.equal(browses.length,beforeDecline);
    const preview=await(await api('/learning/preview',{text:'去搜一下DeepSeek最新版本'})).json();assert.equal(preview.items.length,1);assert.equal(sent.length,previousSent+1,'preview cannot send QQ');
    await update({learningEnabled:false});previousSent=sent.length;const beforeDisabled=browses.length;sendOwner(153,'去搜一下禁用时不能查');await until(()=>sent.length===previousSent+1);assert.equal(browses.length,beforeDisabled);
    // An unconfirmed send is not a training sample and disables automatic reply.
    const beforeUnconfirmed=(await(await api('/memory/export',{})).json()).jsonl;
    const beforeFailed=sent.length;child.send({control:'unconfirmed'});sendOwner(146,'不会记住未确认发送');await until(()=>sent.length===beforeFailed+1);
    await until(async()=>!(await(await api('/state')).json()).enabled);
    assert.equal((await(await api('/memory/export',{})).json()).jsonl,beforeUnconfirmed);
    // Candidate-card testing cannot mutate the live model or send a QQ message.
    const liveBefore=await(await api('/state')).json(),sentBeforeCheck=sent.length;
    const badProfile={settings:{apiUrl:'https://relay.example/v1',model:'unavailable-model',apiProtocol:'chat'},apiKey:'synthetic-bad-key'};
    assert.equal((await api('/model/check',badProfile,false)).status,401);
    const badCheck=await(await api('/model/check',badProfile)).json();assert.equal(badCheck.ok,false);assert.match(badCheck.message,/401/);assert.ok(!badCheck.message.includes('synthetic-upstream-secret'));
    const liveAfter=await(await api('/state')).json();assert.equal(liveAfter.activeModel,liveBefore.activeModel);assert.equal(liveAfter.activeApiUrl,liveBefore.activeApiUrl);assert.equal(sent.length,sentBeforeCheck);
    // The tavern-growth API is authenticated and observed feedback changes the next real request.
    await update({enabled:true,others:true,growthEnabled:true,growthReflection:false,compressionMode:'local'});child.send({control:'normal'});
    assert.equal((await api('/growth/list',undefined,false)).status,401);assert.equal((await api('/growth/update',{id:'all',reset:true},false)).status,401);
    let n=sent.length;sendOwner(200,'请温柔一点，回答简短一点');await until(()=>sent.length===n+1);
    const growthRows=await until(async()=>{const a=(await(await api('/growth/list')).json()).sessions;return a.find(r=>r.scores.warmth>0)?a:null;});
    const grown=growthRows.find(r=>r.scores.warmth>0);assert.equal(grown.scores.detail,-1);
    n=sent.length;sendOwner(201,'今天过得怎么样');await until(()=>sent.length===n+1);assert.match(models.at(-1).model.messages[0].content,/酒馆对话养成/);assert.match(models.at(-1).model.messages[0].content,/更温柔/);
    await api('/growth/update',{id:grown.id,locked:true});n=sent.length;sendOwner(202,'再温柔一点');await until(()=>sent.length===n+1);
    assert.equal((await(await api('/growth/list')).json()).sessions.find(r=>r.id===grown.id).scores.warmth,1);
    // Owner moderation is applied immediately even while a target's model request is pending.
    const groupMessage=(id,user,text,extra=[])=>({post_type:'message',message_type:'group',self_id:765432,user_id:user,group_id:54321,time:Math.floor(Date.now()/1000),message_id:id,message:[{type:'text',data:{text}},...extra]});
    n=sent.length;const modelCount=models.length;
    child.send({event:groupMessage(210,888888,'@deepseek 等待切换并被拉黑')});await until(()=>models.length>modelCount);
    child.send({event:groupMessage(211,999999,'@deepseek 拉黑 ',[{type:'at',data:{qq:'888888'}}])});await until(()=>sent.length===n+1);
    assert.match(sent.at(-1).message[0].data.text,/已在本群停止回应/);assert.ok(!sent.slice(n).some(p=>p.message[0].data.text.includes('配一碗白饭')),'pending target answer is cancelled');
    assert.equal((await api('/moderation/list',undefined,false)).status,401);
    assert.equal((await(await api('/moderation/list')).json()).groups[0].users[0],'888888');
    const afterBlock=models.length;n=sent.length;child.send({event:groupMessage(212,888888,'@deepseek 去搜一下今天新闻')});await pause();await pause();assert.equal(sent.length,n);assert.equal(models.length,afterBlock,'blocked event makes no model request');
    child.send({event:groupMessage(213,123456,'@deepseek 解除拉黑 ',[{type:'at',data:{qq:'888888'}}])});await pause();await pause();assert.equal((await(await api('/moderation/list')).json()).groups[0].users[0],'888888','former owner cannot unblock');
    n=sent.length;child.send({event:groupMessage(214,999999,'@deepseek 解除拉黑 ',[{type:'at',data:{qq:'888888'}}])});await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/已解除/);
    n=sent.length;child.send({event:groupMessage(215,888888,'@deepseek 解除后可以继续聊天')});await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/白饭/);
    // No real QQ: these mocks verify strict owner gating before any model or mutating RPC.
    for(const route of ['/media/state'])assert.equal((await api(route,undefined,false)).status,401);
    for(const route of ['/stickers/sync','/stickers/annotate','/voice/preview','/voice/characters','/qzone/check','/qzone/draft','/qzone/publish'])assert.equal((await api(route,{},false)).status,401);
    n=sent.length;const beforeUnauthorized=rpcs.length,modelBefore=models.length;
    child.send({event:groupMessage(220,888888,'@deepseek 发条说说：不允许发布')});await until(()=>sent.length===n+1);
    assert.match(sent.at(-1).message[0].data.text,/只有主人/);assert.ok(!rpcs.slice(beforeUnauthorized).includes('send_qzone_msg'));assert.equal(models.length,modelBefore);
    n=sent.length;sendOwner(221,'发条说说：隔离测试');await until(()=>sent.length===n+1);assert.ok(rpcs.includes('send_qzone_msg'));assert.match(sent.at(-1).message[0].data.text,/未确认/);
    const beforeRepeat=rpcs.filter(x=>x==='send_qzone_msg').length;n=sent.length;sendOwner(222,'发条说说：不会重发');await until(()=>sent.length===n+1);assert.equal(rpcs.filter(x=>x==='send_qzone_msg').length,beforeRepeat);
    n=sent.length;sendOwner(223,'音高：10%');await until(()=>sent.length===n+1);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8')).speechPitch,10);assert.match(sent.at(-1).message[0].data.text,/已应用/);
    n=sent.length;child.send({event:groupMessage(224,888888,'@deepseek 音高：30%')});await until(()=>sent.length===n+1);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8')).speechPitch,10);
    // Request-based collection: no real QQ, including legacy automatic collection enabled.
    await update({autoCollectEmoji:true,rate:0});
    const collections=()=>rpcs.filter(x=>x==='add_custom_face').length;
    const image=url=>({type:'image',data:{url:'https://qpic.cn/'+url,sub_type:1}});
    n=sent.length;const firstCollection=collections(),beforeCollectModel=models.length;
    child.send({event:groupMessage(230,999999,'收藏这个',[image('owner-direct')])});await until(()=>sent.length===n+1);
    assert.equal(collections(),firstCollection+1);assert.match(sent.at(-1).message[0].data.text,/已保存/);assert.equal(models.length,beforeCollectModel,'collection needs no model request');
    n=sent.length;child.send({event:groupMessage(231,888888,'收藏这个',[image('unauthorized')])});await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/只有主人/);assert.equal(collections(),firstCollection+1);
    // No @ and participation rate 0: the owner's image still becomes available for a later request.
    child.send({event:groupMessage(232,999999,'',[image('owner-followup')])});
    child.send({event:groupMessage(233,888888,'',[image('other-user-image')])});
    n=sent.length;child.send({event:groupMessage(234,999999,'把刚才的表情收藏起来')});await until(()=>sent.length===n+1);assert.equal(collections(),firstCollection+2);assert.match(sent.at(-1).message[0].data.text,/已保存/);
    n=sent.length;child.send({event:groupMessage(235,999999,'收藏一下')});await until(()=>sent.length===n+1);assert.equal(collections(),firstCollection+2);assert.match(sent.at(-1).message[0].data.text,/不重复/);
    n=sent.length;child.send({event:{...groupMessage(236,999999,'收藏一下'),group_id:54322}});await until(()=>sent.length===n+1);assert.equal(collections(),firstCollection+2);assert.match(sent.at(-1).message[0].data.text,/当前聊天/);
    // A private chat reply and an old auto-collect setting cannot cause collection.
    n=sent.length;child.send({event:{...event,user_id:888888,message_id:237,message:[image('ordinary-chat-image')]}});await until(()=>sent.length===n+1);await pause();assert.equal(collections(),firstCollection+2);
    // Changing the owner clears the former owner's pending image references.
    child.send({event:groupMessage(238,999999,'',[image('former-owner')])});await pause();
    await update({owner:'123456'});n=sent.length;child.send({event:groupMessage(239,123456,'收藏一下')});await until(()=>sent.length===n+1);assert.equal(collections(),firstCollection+2);assert.match(sent.at(-1).message[0].data.text,/当前聊天/);
    n=sent.length;child.send({event:groupMessage(240,999999,'收藏这个',[image('former-owner-denied')])});await until(()=>sent.length===n+1);assert.equal(collections(),firstCollection+2);assert.match(sent.at(-1).message[0].data.text,/只有主人/);
    // Empty descriptions were previously excluded: direct requests must send an actual image without a model refusal.
    child.send({faces:[{emoji_id:'unlabelled-one',url:'https://qpic.cn/sendable',desc:''},{emoji_id:'manual-two',url:'https://qpic.cn/manual',desc:'自定义手工备注'}]});
    await update({emojiEnabled:true,emojiAutoLabel:false,visionMode:'chat'});await api('/stickers/sync',{});
    let beforeDirect=models.length;n=sent.length;sendOwner(250,'发个表情');await until(()=>sent.length===n+1);assert.equal(sent.at(-1).message[0].type,'image');assert.equal(models.length,beforeDirect);assert.ok(rpcs.includes('send_custom_face'));
    await update({rate:100});n=sent.length;child.send({event:groupMessage(251,888888,'@deepseek 发个表情')});await until(()=>sent.length===n+1);assert.equal(sent.at(-1).message[0].type,'image','sending existing faces is available to allowed chat users');
    n=sent.length;sendOwner(252,'今天开心吗');await until(()=>sent.length===n+1);assert.ok(sent.at(-1).message.some(s=>s.type==='image'));assert.ok(!JSON.stringify(sent.at(-1)).includes('[[表情:'));
    // The authenticated background job uses image bytes and no private conversation, updates only empty QQ labels.
    await update({emojiAutoLabel:true});await api('/stickers/annotate',{});
    await until(async()=>{const s=await(await api('/media/state')).json();return s.faces.find(f=>f.id==='unlabelled-one')?.desc==='开心、卖萌';});
    const annotated=await(await api('/media/state')).json();assert.equal(annotated.faces.find(f=>f.id==='manual-two').desc,'自定义手工备注');
    const labelCall=models.find(m=>m.model.messages[0].content.includes('为QQ收藏表情生成简短'));assert.equal(labelCall.model.messages.length,2);assert.equal(labelCall.model.messages[1].content[1].type,'image_url');assert.ok(!JSON.stringify(labelCall.model.messages).includes('补充长对话'));
    // Reproduce exactly the screenshot sequence after an initial image, never a textual stage direction.
    beforeDirect=models.length;
    for(const [id,text] of [[260,'还有其他表情吗'],[261,'没表情啊'],[262,'再试试'],[263,'再来一个'],[264,'再试试']]){
      n=sent.length;sendOwner(id,text);await until(()=>sent.length===n+1);
      assert.deepEqual(sent.at(-1).message.map(s=>s.type),['image'],text);assert.ok(!JSON.stringify(sent.at(-1)).includes('发送了一张'));
    }
    assert.equal(models.length,beforeDirect,'followups use the current chat, not another paid model call');
    // A provider that imitates the old history must still produce a real image, never the placeholder text.
    n=sent.length;sendOwner(265,'测试旧版占位回复');await until(()=>sent.length===n+1);assert.deepEqual(sent.at(-1).message.map(s=>s.type),['image']);
    n=sent.length;sendOwner(266,'现在聊聊白饭');await until(()=>sent.length===n+1);
    const cleanHistory=models.at(-1).model.messages.slice(1,-1);assert.ok(!JSON.stringify(cleanHistory).includes('发送了一张QQ收藏表情'));assert.ok(!JSON.stringify(cleanHistory).includes('工作台非文字消息记录'));
    // Short retries from another conversation must not borrow the owner's previous sticker context.
    n=sent.length;const beforeOther=models.length;child.send({event:{...event,user_id:777777,message_id:267,message:[{type:'text',data:{text:'再试试'}}]}});await until(()=>sent.length===n+1);assert.equal(sent.at(-1).message[0].type,'text');assert.equal(models.length,beforeOther+1);
    // Natural owner posts generate from public topics only; other users get no write capability.
    await api('/qzone/resume',{});await update({qzoneQuota:3});child.send({control:'qzone-accepted'});
    n=sent.length;const postsBefore=rpcs.filter(x=>x==='send_qzone_msg').length,modelsBeforePost=models.length;
    child.send({event:{...event,message_id:270,message:[{type:'text',data:{text:'发条说说'}}]}});await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/发布凭据/);assert.equal(rpcs.filter(x=>x==='send_qzone_msg').length,postsBefore+1);assert.equal(models.length,modelsBeforePost+1);
    assert.equal(models.at(-1).model.messages.length,2);assert.ok(!JSON.stringify(models.at(-1).model.messages).includes('现在聊聊白饭'));
    n=sent.length;child.send({event:groupMessage(271,888888,'@deepseek 发QQ空间')});await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/只有主人/);assert.equal(rpcs.filter(x=>x==='send_qzone_msg').length,postsBefore+1);
    const qzoneChecked=await(await api('/qzone/check',{})).json();assert.equal(qzoneChecked.ok,true);assert.match(qzoneChecked.message,/未发布/);assert.equal(rpcs.filter(x=>x==='send_qzone_msg').length,postsBefore+1);
    // Device tools trust the real event owner only, not the model, persona or a former owner.
    await update({deviceToolsEnabled:true});n=sent.length;const deviceModels=models.length;
    child.send({event:{...event,message_id:280,message:[{type:'text',data:{text:'查看手机电量'}}]}});await until(()=>sent.length===n+1);assert.equal(devices.length,1);assert.equal(devices[0].sender,'123456');assert.equal(devices[0].operation.action,'battery');assert.equal(models.length,deviceModels);assert.match(sent.at(-1).message[0].data.text,/synthetic battery/);
    n=sent.length;child.send({event:groupMessage(281,888888,'@deepseek 查看手机电量')});await until(()=>sent.length===n+1);assert.equal(devices.length,1);assert.match(sent.at(-1).message[0].data.text,/只有主人/);
    await update({deviceToolsEnabled:false});n=sent.length;child.send({event:{...event,message_id:282,message:[{type:'text',data:{text:'打开B站'}}]}});await until(()=>sent.length===n+1);assert.equal(devices.length,1);assert.match(sent.at(-1).message[0].data.text,/尚未开启/);
    const stats=await(await api('/usage')).json();assert.ok(stats.today.calls>0);assert.ok(stats.today.unreported>0);assert.ok(stats.groups.some(x=>x.category==='qzone'));assert.equal((await api('/usage',undefined,false)).status,401);
    n=sent.length;const countBeforeUsage=models.length;child.send({event:{...event,message_id:283,message:[{type:'text',data:{text:'查看Token用量'}}]}});await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/今日模型用量/);assert.equal(models.length,countBeforeUsage);
    // Authenticated Android network/idle events recover the existing session, without re-enabling or replaying.
    assert.equal((await api('/runtime/resume',{reason:'network'},false)).status,401);
    child.send({socketClose:true});await until(async()=>!(await(await api('/state')).json()).connected);
    n=sent.length;const beforeRecoveryModels=models.length;
    const recovery=await(await api('/runtime/resume',{reason:'network'})).json();assert.equal(recovery.ok,true);assert.equal(recovery.scheduled,true);
    await until(async()=>(await(await api('/state')).json()).connected);assert.equal(sent.length,n);assert.equal(models.length,beforeRecoveryModels);
    const repeated=await(await api('/runtime/resume',{reason:'wake'})).json();assert.equal(repeated.scheduled,false,'network callbacks are debounced');
    const sendCommand=(id,text)=>child.send({event:{...event,user_id:123456,message_id:id,message:[{type:'text',data:{text}}]}});
    // Two-character commands are locally routed; no real QQ or provider traffic.
    await update({enabled:true});n=sent.length;const commandModels=models.length;
    sendCommand(290,'＃指令');await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/＃搜索/);assert.equal(models.length,commandModels);
    n=sent.length;sendCommand(291,'#暂停');await until(()=>sent.length===n+1);assert.equal((await(await api('/state')).json()).enabled,false);
    n=sent.length;sendCommand(292,'＃状态');await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/自动回复暂停/);
    n=sent.length;sendCommand(293,'#搜索 白饭');await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/＃继续/);assert.equal(models.length,commandModels);
    n=sent.length;sendCommand(294,'#继续');await until(()=>sent.length===n+1);assert.equal((await(await api('/state')).json()).enabled,true);
    n=sent.length;child.send({event:{...event,user_id:888888,message_id:295,message:[{type:'text',data:{text:'＃暂停'}}]}});await new Promise(r=>setTimeout(r,100));assert.equal(sent.length,n);assert.equal((await(await api('/state')).json()).enabled,true);
    await update({deviceToolsEnabled:true});n=sent.length;child.send({event:groupMessage(296,123456,'＃电量')});await until(()=>sent.length===n+1);assert.equal(devices.length,2);assert.equal(devices.at(-1).operation.action,'battery');assert.equal(models.length,commandModels);
    n=sent.length;sendCommand(297,'＃用量');await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/今日模型用量/);assert.equal(models.length,commandModels);
    n=sent.length;sendCommand(298,'#亮度 101');await until(()=>sent.length===n+1);assert.equal(devices.length,2);assert.match(sent.at(-1).message[0].data.text,/用法/);
    n=sent.length;sendCommand(299,'＃结束');await until(()=>sent.length===n+1);assert.match(sent.at(-1).message[0].data.text,/聊天结束/);assert.equal(models.length,commandModels);
    // A JSON share-only group message reaches the parser and vision model through the normal QQ route.
    await update({emojiEnabled:false,memoryEnabled:false,visionMode:'chat',learningEnabled:true});
    n=sent.length;const beforeShare=models.length;
    const share=JSON.stringify({meta:{news:{title:'分享文章',jumpUrl:'https://mp.weixin.qq.com/s/synthetic',token:'DO-NOT-LEAK'}},token:'CARD-SECRET'});
    child.send({event:groupMessage(310,123456,'',[{type:'at',data:{qq:765432}},{type:'json',data:{data:share}}])});
    await until(()=>sent.length===n+1);assert.equal(models.length,beforeShare+1);
    assert.equal(models.at(-1).model.messages.at(-1).content[1].type,'image_url');
    assert.match(models.at(-1).model.messages.at(-1).content[0].text,/只存在于本次分享/);
    assert.ok(!JSON.stringify(models.at(-1)).includes('DO-NOT-LEAK'));assert.ok(!JSON.stringify(models.at(-1)).includes('CARD-SECRET'));
    n=sent.length;sendCommand(311,'你觉得呢');await until(()=>sent.length===n+1);assert.ok(!JSON.stringify(models.at(-1).model.messages.slice(1,-1)).includes('只存在于本次分享'),'retrieved article text is not repeatedly billed as history');
    assert.equal((await api('/learning/platforms',undefined,false)).status,401);
    assert.equal((await api('/learning/cookies',{cookies:{}},false)).status,401);
    const platforms=await(await api('/learning/platforms')).json();assert.equal(platforms.platforms.length,13);
    await api('/learning/cookies',{cookies:{bilibili_cookies:'SESSDATA=synthetic-private-cookie'}});
    assert.ok(!(await(await api('/learning/platforms')).text()).includes('synthetic-private-cookie'));
    assert.ok(!JSON.stringify(models).includes('synthetic-private-cookie'));
    // The full ten minutes are read sequentially; each request stays below the two-minute image budget.
    const longVideo={sampling:'1fps-contact-sheet-v1',durationSeconds:600,sampledSeconds:600,frameCount:600,frames:Array.from({length:75},(_,i)=>({seconds:i*8,timestamps:Array.from({length:8},(_,j)=>i*8+j),url:'data:image/jpeg;base64,AQID'}))};
    let beforeVideo=models.length;
    const completeVideo=await(await api('/video/analyze',{...longVideo,question:'概括整段视频'})).json();assert.equal(completeVideo.ok,true);assert.equal(models.length,beforeVideo+6);assert.equal(completeVideo.budget.batches,5);assert.equal(completeVideo.usage.prompt_tokens,600);assert.equal(completeVideo.usage.completion_tokens,60);
    for(const request of models.slice(beforeVideo,beforeVideo+5))assert.equal(request.model.messages.at(-1).content.filter(p=>p.type==='image_url').length,15);
    assert.match(JSON.stringify(models.at(-1).model),/480—600秒/);assert.ok(!JSON.stringify(models.at(-1).model).includes('data:image'));
    beforeVideo=models.length;n=sent.length;
    child.send({event:{...event,message_id:320,message:[{type:'video',data:{url:'https://gchat.qpic.cn/full-video.mp4'}}]}});await until(()=>sent.length===n+1);assert.equal(models.length,beforeVideo+6);
    n=sent.length;sendCommand(321,'最后发生了什么');await until(()=>sent.length===n+1);assert.ok(!JSON.stringify(models.at(-1).model).includes('data:image/jpeg'));
    await update({enabled:false});await api('/runtime/resume',{reason:'idle'});assert.equal((await(await api('/state')).json()).enabled,false,'manual pause survives network recovery');
  }finally{try{await api('/shutdown',{});}catch{}await until(()=>exited||false).catch(()=>child.kill());if(child.connected)child.disconnect();}
});
