import {deviceRequest,validDeviceOperation} from './device-tools.mjs';
export const COMMANDS=[
 ['指令','','显示全部指令'],['状态','','查看QQ和模型状态'],['用量','','查看Token用量'],['暂停','','暂停自动回复'],['继续','','恢复自动回复'],['结束','','结束当前对话'],
 ['搜索','关键词','联网搜索'],['浏览','网址','读取公开网页'],['收藏','','收藏刚发的表情'],['表情','','发一个收藏表情'],['语音','文字','朗读指定文字'],['开音','','开启语音'],['静音','','关闭语音'],['音色','晓晓','切换基础音色'],['语速','数值','调整语速百分比'],['音高','数值','调整音高百分比'],
 ['动态','正文','发布指定说说，省略则生成并发布'],['草稿','主题','只生成说说草稿'],['发布','','发布已有草稿'],['空间','','检查QQ空间连接'],['自发','','开启自动说说'],['停发','','关闭自动说说'],['更新','','检查软件更新'],
 ['电量','','查看设备电量'],['存储','','查看剩余空间'],['应用','','查看应用列表'],['屏幕','','查看屏幕尺寸'],['打开','B站 / 包名','打开应用'],['亮度','1–100','调整亮度'],['音量','0–15','调整媒体音量'],['点击','横坐标 纵坐标','点击屏幕'],['滑动','起点X 起点Y 终点X 终点Y 毫秒','滑动屏幕，毫秒可省略'],['按键','桌面 / 返回 / 最近 / 回车 / 亮屏 / 息屏','按指定键'],
 ['拉黑','@某人 / QQ号','本群不再回应此人'],['解黑','@某人 / QQ号','解除本群不回应'],['名单','','查看本群不回应名单']
];
export function commandHelp(){return '主人指令\n半角#、全角＃都可以；群聊直接发，不用再@deepseek。\n\n'+COMMANDS.map(([name,args,description])=>'＃'+name+(args?' '+args:'')+'：'+description).join('\n')+'\n\n只有当前大号可用。设备操作需开启并授权Shizuku。原有自然说法和@codex继续可用；语音、说说可能产生服务费用。';}
export function shortcutEvent(event,text){return {...event,raw_message:text,message:[{type:'text',data:{text:(event.message_type==='group'?'@deepseek ':'')+text}},...(Array.isArray(event.message)?event.message.filter(s=>s.type!=='text'):[])]};}
export function parseShortcut(event){
 const raw=(Array.isArray(event.message)?event.message.filter(s=>s.type==='text').map(s=>s.data?.text||'').join(''):String(event.raw_message||'')).trim().replace(/^@deepseek\b\s*/i,'');
 const m=raw.match(/^[#＃]([\u4e00-\u9fff]{2})([\s\S]*)$/);if(!m)return null;
 const name=m[1]==='帮助'?'指令':m[1]==='联网'?'搜索':m[1],entry=COMMANDS.find(c=>c[0]===name);
 const error=message=>({operation:{action:'commandText',text:message+'\n发＃指令查看列表。'}});
 if(!entry)return error('没有这条指令：＃'+name);
 if(m[2]&&!/^[\s：:\d+\-]/.test(m[2]))return error('指令后请加空格，例如＃'+name+(entry[1]?' '+entry[1]:''));
 const arg=m[2].replace(/^[\s：:]+/,'').trim();
 if(!entry[1]&&arg)return error('＃'+name+'不用填写参数。');
 const operation=(action,extra={})=>({operation:{action,...extra}});
 const rewrite=text=>({event:shortcutEvent(event,text),needsReply:true});
 const need=()=>error('用法：＃'+name+' '+entry[1]);
 if(name==='指令')return operation('commandText',{text:commandHelp()});
 if(name==='状态')return operation('commandStatus');
 if(name==='用量')return operation('usage');
 if(['暂停','继续'].includes(name))return operation('replyControl',{enabled:name==='继续'});
 if(name==='结束')return operation('endChat');
 if(name==='搜索')return arg?rewrite('去搜一下'+arg):need();
 if(name==='浏览'){try{const u=new URL(arg);if(u.protocol!=='https:'||u.username||u.password)throw 0;}catch{return need();}return rewrite(arg);}
 if(name==='收藏')return operation('collect');
 if(name==='表情')return rewrite('发个表情');
 if(name==='语音')return arg&&arg.length<=260?operation('speak',{text:arg}):need();
 if(name==='开音'||name==='静音')return operation('setting',{key:'voiceEnabled',value:name==='开音'});
 if(name==='音色')return ['晓晓','晓伊','曉臻','曉曼','七海','善熙'].includes(arg)?operation('voice',{name:arg}):error('音色可选：晓晓、晓伊、曉臻、曉曼、七海、善熙。');
 if(name==='语速'||name==='音高'){const n=Number(arg.replace(/%$/,''));return /^[+-]?\d+%?$/.test(arg)&&n>=(name==='语速'?-40:-30)&&n<=(name==='语速'?60:30)?operation('prosody',{key:name==='语速'?'speechRate':'speechPitch',value:n}):error(name+'范围：'+(name==='语速'?'-40到60':'-30到30')+'。');}
 if(name==='动态')return arg.length<=1000?operation(arg?'post':'generateAndPost',arg?{text:arg}:{topic:''}):need();
 if(name==='草稿')return arg&&arg.length<=200?operation('draft',{topic:arg}):need();
 if(name==='发布')return operation('publishDraft');
 if(name==='空间')return operation('qzoneCheck');
 if(name==='自发'||name==='停发')return operation('autoPost',{enabled:name==='自发'});
 if(name==='更新')return operation('update');
 if(['拉黑','解黑','名单'].includes(name)){
  if(event.message_type!=='group')return error('这条指令只在群聊生效。');
  if(arg&&!/^[1-9][0-9]{4,11}$/.test(arg))return need();
  return {event:shortcutEvent(event,name==='名单'?'拉黑列表':(name==='拉黑'?'拉黑':'解除拉黑')+(arg?' '+arg:'')),moderation:true};
 }
 let op;
 if(['电量','存储','应用','屏幕'].includes(name))op={action:({电量:'battery',存储:'storage',应用:'apps',屏幕:'display'})[name]};
 if(name==='打开'){const request=deviceRequest('打开'+arg);if(request?.operations)return operation('device',{request});const explicit=deviceRequest('打开应用 '+arg);if(explicit?.operations)return operation('device',{request:explicit});return need();}
 if(name==='亮度'||name==='音量')op={action:name==='亮度'?'brightness':'volume',[name==='亮度'?'percent':'level']:/^\d+%?$/.test(arg)?Number(arg.replace(/%$/,'')):NaN};
 if(name==='按键')op={action:'key',key:({桌面:'home',返回:'back',最近:'recent',回车:'enter',亮屏:'wake',息屏:'sleep'})[arg]};
 if(name==='点击'||name==='滑动'){const nums=arg.split(/\s+/);if(!nums.every(n=>/^\d+$/.test(n)))return need();const n=nums.map(Number);if(name==='点击'&&n.length===2)op={action:'tap',x:n[0],y:n[1]};if(name==='滑动'&&(n.length===4||n.length===5))op={action:'swipe',x1:n[0],y1:n[1],x2:n[2],y2:n[3],duration:n[4]??300};}
 return validDeviceOperation(op)?operation('device',{request:{operations:[op]}}):need();
}
