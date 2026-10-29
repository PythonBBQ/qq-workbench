import crypto from 'node:crypto';
const reads=['status','battery','storage','apps','display'];
export const deviceActions=[...reads,'launch','tap','swipe','key','brightness','volume'];
export function deviceRequest(raw){
  const text=String(raw).trim().replace(/^(?:(?:请|帮我|你|麻烦你?)\s*)+/,'').replace(/[。！!？?]+$/,'');
  if(!text||text.length>500||/^(?:不要|别|不用|怎么|如何|有人|他说|她说|如果|假如)|[“”「」『』`]/.test(text))return null;
  const fixed=[[/^(?:查看|检查|读取|看看|看下|查询)?(?:一下)?(?:手机|设备|平板)(?:的)?(?:电量|电池状态)$/,{action:'battery'}],[/^(?:查看|检查|看看|看下)?(?:手机|设备|平板)(?:的)?(?:存储|剩余空间)$/,{action:'storage'}],[/^(?:查看|检查|看看|看下)?(?:手机|设备|平板)(?:的)?(?:状态|型号)$/,{action:'status'}],[/^(?:查看|看看|查询)(?:手机|设备|平板)?(?:的)?(?:已安装应用|应用列表)$/,{action:'apps'}],[/^(?:查看|查询)(?:屏幕|手机)?(?:的)?(?:尺寸|分辨率)$/,{action:'display'}],[/^(?:返回桌面|回到桌面)$/,{action:'key',key:'home'}],[/^(?:返回上一页|按返回键)$/,{action:'key',key:'back'}],[/^(?:唤醒|点亮)(?:手机|平板)?屏幕$/,{action:'key',key:'wake'}],[/^(?:关闭|熄灭)(?:手机|平板)?屏幕$/,{action:'key',key:'sleep'}]];
  for(const [pattern,operation] of fixed)if(pattern.test(text))return {operations:[operation]};
  let m;
  if((m=text.match(/^(?:把)?(?:手机|平板)?亮度(?:设为|调到|调成)\s*(\d{1,3})\s*%$/)))return {operations:[{action:'brightness',percent:Number(m[1])}]};
  if((m=text.match(/^(?:打开|启动)应用\s*[:：]?\s*([a-zA-Z][\w]*(?:\.[\w]+)+)$/)))return {operations:[{action:'launch',package:m[1]}]};
  const apps={'哔哩哔哩':'tv.danmaku.bili','B站':'tv.danmaku.bili','QQ':'com.tencent.mobileqq','微信':'com.tencent.mm','设置':'com.android.settings'};
  if((m=text.match(/^(?:打开|启动)(哔哩哔哩|B站|QQ|微信|设置)$/)))return {operations:[{action:'launch',package:apps[m[1]]}]};
  if((m=text.match(/^(?:adb\s+shell|执行adb|运行adb)[：:]?\s+([\s\S]+)$/i))){
    const cmd=m[1].trim();const exact={'dumpsys battery':{action:'battery'},'wm size':{action:'display'},'df -h /data':{action:'storage'},'pm list packages -3':{action:'apps'},'getprop ro.product.model':{action:'status'}};
    if(exact[cmd])return {operations:[exact[cmd]]};
    let p;if((p=cmd.match(/^input tap (\d+) (\d+)$/)))return {operations:[{action:'tap',x:Number(p[1]),y:Number(p[2])}]};
    if((p=cmd.match(/^input swipe (\d+) (\d+) (\d+) (\d+)(?: (\d+))?$/)))return {operations:[{action:'swipe',x1:Number(p[1]),y1:Number(p[2]),x2:Number(p[3]),y2:Number(p[4]),duration:Number(p[5]||300)}]};
    return {unsupported:true};
  }
  if(/^(?:用|通过)?(?:adb|ADB)(?:\s|帮|检查|查看|打开|点击|滑动|返回)|^(?:操作|控制)(?:一下)?(?:手机|平板|设备)[：:]/.test(text))return {plan:text};
  return null;
}
export function validDeviceOperation(op){
  if(!op||typeof op!=='object'||!deviceActions.includes(op.action))return false;
  const n=(k,min,max)=>Number.isInteger(op[k])&&op[k]>=min&&op[k]<=max;
  if(op.action==='tap')return n('x',0,10000)&&n('y',0,10000);
  if(op.action==='swipe')return ['x1','y1','x2','y2'].every(k=>n(k,0,10000))&&n('duration',100,2000);
  if(op.action==='launch')return typeof op.package==='string'&&op.package.length<=180&&/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/.test(op.package);
  if(op.action==='key')return ['home','back','recent','enter','wake','sleep'].includes(op.key);
  if(op.action==='brightness')return n('percent',1,100);
  if(op.action==='volume')return n('level',0,15);
  return reads.includes(op.action);
}
export async function runDeviceTask({request,event,config,stillCurrent,planner,execute}){
  if(String(event.user_id)!==String(config.owner))return '只有主人可以使用设备操作。';
  if(!config.deviceToolsEnabled)return '设备操作尚未开启，请在设置→设备权限中开启，并授权Shizuku。';
  if(request.unsupported)return '这条ADB命令暂未开放。支持电量、存储、应用列表、打开应用、亮度、媒体音量、点击、滑动和返回桌面；不接受任意Shell脚本。';
  let operations=request.operations;
  if(!operations){
    if(!stillCurrent())return '设备任务已取消。';
    let raw;try{raw=await planner([{role:'system',content:'把主人当前明确要求的手机操作转成JSON {"operations":[...]}，最多3个动作。只输出JSON，不实际执行。可用动作：status,battery,storage,apps,display；launch需package；tap需整数x,y；swipe需x1,y1,x2,y2,duration(100-2000)；key需key(home/back/recent/enter/wake/sleep)；brightness需percent(1-100)；volume需level(0-15)。没有坐标时不能猜坐标。禁止增加用户没要求的动作。不支持的请求返回{"operations":[]}'},{role:'user',content:String(request.plan).slice(0,500)}]);operations=JSON.parse(raw).operations;}catch{return '未能理解设备操作，尚未执行。可以说“查看手机电量”或“打开B站”。';}
  }
  if(!Array.isArray(operations)||!operations.length||operations.length>3||!operations.every(validDeviceOperation))return '这次设备动作缺少有效参数，尚未执行；点击和滑动需要明确坐标。';
  const results=[];
  for(let i=0;i<operations.length;i++){
    if(!stillCurrent())return '设备任务已停止；已执行的动作不会重放。';
    const operation=operations[i];const id=crypto.createHash('sha256').update(JSON.stringify([event.self_id,config.owner,event.message_type,event.group_id||event.user_id,event.message_id,i])).digest('hex');
    let result;try{result=await execute({sender:String(event.user_id),id,operation});}catch{return '设备接口连接中断，结果未确认；已停止后续动作，不自动重试。';}
    if(!stillCurrent())return '账号或配置已切换，后续设备动作已停止。';
    if(!result?.ok)return String(result?.message||'设备动作未完成，已停止后续操作。').slice(0,500);
    results.push(operation.action+'：'+(reads.includes(operation.action)?String(result.output||'完成').slice(0,2000):'系统命令已执行，尚未核对屏幕效果'));
  }
  return results.join('\n\n');
}
