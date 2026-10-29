import {test} from 'node:test';import assert from 'node:assert/strict';
import {COMMANDS,commandHelp,parseShortcut} from '../assets/shortcuts.mjs';
import {moderationCommand} from '../assets/group-moderation.mjs';
const event=(text,extra={})=>({self_id:765432,user_id:123456,message_type:'private',message:[{type:'text',data:{text}}],...extra});
test('two-character menu supports both hash widths and exact command boundaries without routing quoted chat',()=>{
 assert.ok(COMMANDS.every(c=>[...c[0]].length===2));assert.equal(new Set(COMMANDS.map(c=>c[0])).size,COMMANDS.length);
 for(const prefix of ['#','＃'])assert.equal(parseShortcut(event(prefix+'指令')).operation.text,commandHelp());
 assert.equal(parseShortcut(event('@deepseek ＃帮助')).operation.text,commandHelp());
 for(const text of ['有人说＃暂停','不要＃暂停','“＃暂停”','#sl','hello #指令'])assert.equal(parseShortcut(event(text)),null);
 assert.match(parseShortcut(event('#暂停啊')).operation.text,/空格/);assert.match(parseShortcut(event('#暂停 #继续')).operation.text,/不用填写参数/);assert.match(parseShortcut(event('#未知')).operation.text,/没有这条/);
});
test('hash commands map to existing exact operations and reject missing or invalid arguments',()=>{
 assert.deepEqual(parseShortcut(event('＃暂停')).operation,{action:'replyControl',enabled:false});assert.deepEqual(parseShortcut(event('#继续')).operation,{action:'replyControl',enabled:true});
 assert.deepEqual(parseShortcut(event('#动态 早安，白饭真香')).operation,{action:'post',text:'早安，白饭真香'});assert.equal(parseShortcut(event('#动态')).operation.action,'generateAndPost');
 assert.equal(parseShortcut(event('#草稿 白饭')).operation.topic,'白饭');assert.match(parseShortcut(event('#草稿')).operation.text,/用法/);
 assert.equal(parseShortcut(event('#语音：你好')).operation.text,'你好');assert.equal(parseShortcut(event('#语速 -20%')).operation.value,-20);assert.match(parseShortcut(event('#语速 100')).operation.text,/范围/);
 assert.equal(parseShortcut(event('#静音')).operation.value,false);assert.equal(parseShortcut(event('#用量')).operation.action,'usage');
 assert.match(parseShortcut(event('#浏览 file:///secret')).operation.text,/用法/);assert.match(parseShortcut(event('#浏览 https://example.com')).event.message[0].data.text,/https:\/\/example.com/);
});
test('device short commands are typed and range checked before any model or device call',()=>{
 const op=text=>parseShortcut(event(text)).operation;
 assert.deepEqual(op('#电量').request.operations,[{action:'battery'}]);assert.equal(op('#打开 B站').request.operations[0].package,'tv.danmaku.bili');assert.equal(op('#打开 com.example.app').request.operations[0].package,'com.example.app');
 assert.equal(op('＃亮度50').request.operations[0].percent,50);assert.equal(op('#音量 3').request.operations[0].level,3);
 assert.deepEqual(op('#点击 300 600').request.operations[0],{action:'tap',x:300,y:600});assert.equal(op('#滑动 1 2 3 4').request.operations[0].duration,300);assert.equal(op('#按键 返回').request.operations[0].key,'back');
 for(const text of ['#点击 1','＃亮度 101','#音量 -1','#滑动 1 2 3 4 99999','#打开 com.example;reboot','#点击 1.5 2'])assert.equal(op(text).action,'commandText');
});
test('group shortcuts preserve image, reply and at segments and use existing moderation validation',()=>{
 const group=text=>event(text,{message_type:'group',group_id:42});
 const m=group('#拉黑');m.message.push({type:'at',data:{qq:999999}});const black=parseShortcut(m);assert.deepEqual(moderationCommand(black.event,'123456'),{action:'block',target:'999999'});
 assert.deepEqual(moderationCommand(parseShortcut(group('#解黑 999999')).event,'123456'),{action:'unblock',target:'999999'});
 assert.equal(moderationCommand(parseShortcut(group('#名单')).event,'123456').action,'list');assert.equal(moderationCommand(black.event,'999999'),null);
 assert.equal(parseShortcut(event('#拉黑 999999')).operation.action,'commandText');
 const image={type:'image',data:{url:'https://qpic.cn/test'}};const imageEvent=group('#搜索 白饭');imageEvent.message.push(image);const parsed=parseShortcut(imageEvent);assert.equal(parsed.event.message.at(-1),image);assert.match(parsed.event.message[0].data.text,/^@deepseek 去搜一下白饭$/);
});
