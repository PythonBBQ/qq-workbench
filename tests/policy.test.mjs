import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decide,plain,cleanReply,confirmed,chooseAccount,accountStatus,bridgeError} from '../assets/assistant.mjs';
const cfg={owner:'123456',enabled:true,others:true,rate:35};
function message(text,extra={}){return {post_type:'message',message_type:'group',group_id:42,self_id:765432,user_id:123456,message:[{type:'text',data:{text}}],...extra};}
test('paused mode ignores owner commands',()=>assert.equal(decide(message('@deepseek 你好'),{...cfg,enabled:false},new Map()),'ignore'));
test('owner forces reply even at zero participation',()=>assert.equal(decide(message('@deepseek 你好'),{...cfg,rate:0},new Map()),'reply'));
test('others mode gates even explicit mentions',()=>assert.equal(decide(message('@deepseek 你好',{user_id:999999}),{...cfg,others:false},new Map()),'ignore'));
test('other users mentions respect participation',()=>assert.equal(decide(message('@deepseek 你好',{user_id:999999}),{...cfg,rate:0},new Map()),'ignore'));
test('group session continues then explicitly ends',()=>{const sessions=new Map();assert.equal(decide(message('@deepseek 你好'),cfg,sessions,100),'reply');assert.equal(decide(message('继续刚才的话题'),{...cfg,rate:0},sessions,200),'reply');assert.equal(decide(message('结束聊天'),cfg,sessions,300),'end');assert.equal(decide(message('继续刚才的话题'),{...cfg,rate:0},sessions,400),'ignore');});
test('sessions isolate groups and users and expire',()=>{const sessions=new Map();decide(message('@deepseek 嗨'),cfg,sessions,100);assert.equal(decide(message('继续',{group_id:43}),{...cfg,rate:0},sessions,200),'ignore');assert.equal(decide(message('继续',{user_id:999999}),{...cfg,rate:0},sessions,200),'ignore');assert.equal(decide(message('继续'),{...cfg,rate:0},sessions,200000),'ignore');});
test('messages directed at other humans do not interrupt',()=>{const e=message('@deepseek 帮我看看');e.message.push({type:'at',data:{qq:'888888'}});assert.equal(decide(e,cfg,new Map()),'ignore');});
test('own messages cannot create loops',()=>assert.equal(decide(message('@deepseek',{user_id:765432}),cfg,new Map()),'ignore'));
test('private chat does not require a mention',()=>assert.equal(decide(message('你好',{message_type:'private',group_id:undefined}),cfg,new Map()),'reply'));
test('codex invocation is distinct from chat',()=>assert.equal(decide(message('@codex 做任务'),cfg,new Map()),'codex'));
test('codex routing supports Chinese adjacency and respects first addressee without promoting non-owners',()=>{
 assert.equal(decide(message('@codex做任务'),cfg,new Map()),'codex');
 assert.equal(decide(message('hello@codex.com',{message_type:'private'}),cfg,new Map()),'reply');
 assert.equal(decide(message('@deepseek 解释 @codex'),cfg,new Map()),'reply');
 assert.equal(decide(message('@codex做任务',{user_id:999999}),cfg,new Map()),'ignore');
});
test('image event remains structured, text comes from text segments',()=>assert.equal(plain(message('结合这个图',{message:[{type:'image',data:{url:'https://example.com/a.png'}},{type:'text',data:{text:'结合这个图'}}]})),'结合这个图'));
test('success requires message evidence, transport-only success is insufficient',()=>{assert.equal(confirmed({status:'ok',retcode:0,data:{message_id:3}}),true);for(const r of [{},{status:'ok',retcode:0},{status:'failed',retcode:0,data:{message_id:3}},{status:'ok',retcode:1200,data:{message_id:3}}])assert.equal(confirmed(r),false);});
test('QQ formatting keeps meaningful path punctuation',()=>assert.equal(cleanReply('# 结果\n**做好了**\n- 路径 E:/项目/a-b.txt'),'结果\n做好了\n路径 E:/项目/a-b.txt'));
test('account selection uses verified login identity and never silently selects among multiple accounts',()=>{const first={pid:12,uin:'123456',loggedIn:true,connected:true},second={pid:13,uin:'654321',loggedIn:true,connected:true};assert.equal(chooseAccount([first],undefined),first);assert.equal(chooseAccount([first,second],undefined),null);assert.equal(chooseAccount([first,second],13),second);assert.equal(chooseAccount([{...first,loggedIn:false}],12),null);assert.throws(()=>chooseAccount([first],999));assert.throws(()=>chooseAccount([first],'12'));});
test('failed bridge does not misreport the QQ session as signed out',()=>{const p={status:'error',connected:false,loggedIn:false,uin:'0'};assert.match(accountStatus(p),/桥接失败/);assert.doesNotMatch(accountStatus(p),/待登录|未登录/);assert.match(bridgeError({success:false,process:{error:'component loading failed [COMPONENT_LOAD_FAILED]'}}),/COMPONENT_LOAD_FAILED/);assert.match(accountStatus({...p,status:'loaded',connected:true}),/等待 QQ 登录事件/);assert.match(accountStatus({...p,connected:true,loggedIn:true,uin:'123456'}),/QQ 已登录/);});
