import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

/** A half-open local socket must not prevent all later reconnect attempts. */
export function socketDeadline(socket,onTimeout,{milliseconds=12000,schedule=setTimeout,cancel=clearTimeout}={}){
  let active=true;
  const done=()=>{if(!active)return;active=false;cancel(timer);for(const type of ['open','error','close'])socket.removeEventListener(type,done);};
  const timer=schedule(()=>{if(!active)return;done();if(socket.readyState===0)onTimeout();},milliseconds);
  for(const type of ['open','error','close'])socket.addEventListener(type,done);
  return done;
}
export const validUin=value=>/^[1-9][0-9]{4,11}$/.test(String(value));
export function readyAccount(items) {
  const online=items.filter(p=>p.connected&&p.loggedIn&&validUin(p.uin));
  return online.length===1?online[0]:null;
}
export function needsRelaunchRecovery({launcherExited,args,nativeLoaded}) {
  return launcherExited&&args.includes('--relaunch')&&!nativeLoaded;
}
export function oneBotConfig(config,token) {
  if(!config?.networks)throw new Error('SnowLuma OneBot 配置格式不兼容');
  return {...config,networks:{...config.networks,
    wsServers:[{name:'qq-workbench-android',enabled:true,host:'127.0.0.1',port:13001,
      path:'/',role:'Universal',accessToken:token,messageFormat:'array',reportSelfMessage:false}],
    wsClients:[],httpServers:[],httpClients:[]}};
}
function privateText(file,value) {
  fs.writeFileSync(file+'.next',value,{mode:0o600});fs.renameSync(file+'.next',file);
}
export class SnowLumaBridge {
  constructor({work='/opt/qq-workbench/snowluma',onExit=()=>{}}={}) {
    this.work=work;this.onExit=onExit;this.failure='';this.auth='';this.stopped=false;
    this.root='/opt/qqwb-snow-1.14.22';this.home='/root/.local/share/qqwb-snow';
    this.onebotToken=crypto.randomBytes(32).toString('hex');this.children=[];this.configuredUin='';
    this.recoveries=[];this.launcherExited=false;
  }
  start() {
    fs.mkdirSync(this.work,{recursive:true,mode:0o700});
    const file=path.join(this.work,'console-password');
    try{this.password=fs.readFileSync(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!this.password||this.password.length<32){this.password='Local!7'+crypto.randomBytes(32).toString('hex');privateText(file,this.password);}
    const env={...process.env,HOME:this.home,XDG_CONFIG_HOME:this.home+'/.config',
      XDG_RUNTIME_DIR:'/tmp/qqwb-runtime',SNOWLUMA_HOOK_RUNTIME_DIR:'/tmp/qqwb-runtime'};
    for(const name of ['DEEPSEEK_API_KEY','VISION_API_KEY','SPEECH_API_KEY','WORKBENCH_TOKEN','WORKBENCH_MEMORY_KEY','VNC_PASSWORD',
      'LD_PRELOAD','ELECTRON_RUN_AS_NODE','SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD',
      'NAPCAT_QUICK_PASSWORD','NAPCAT_QUICK_PASSWORD_MD5'])delete env[name];
    this.launch=(command,args,extra={},role='snow')=>{
      const child=spawn(command,args,{cwd:this.work,env:{...env,...extra},detached:true,stdio:['ignore','pipe','pipe']});
      this.children.push(child);
      for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
        // Raw QQ/SnowLuma output can contain login credentials or chat content.
        const text=chunk.toString();
        if(/undefined symbol|error while loading shared libraries/.test(text))this.failure='SnowLuma 或 QQ 缺少原生运行库';
        if(/EADDRINUSE/.test(text))this.failure='本机接入端口已被占用，请停止旧服务后重试';
      });
      child.on('error',()=>{this.failure='SnowLuma 接入进程未能启动';this.onExit();});
      child.on('exit',(code,signal)=>{if(!this.stopped){
        if(role==='qq')this.launcherExited=true;
        this.failure=role==='qq'?'QQ 启动进程已结束，正在核对登录后重启状态':'SnowLuma 已退出，请重启本地服务';
        console.log('QQWB:'+ (role==='qq'?'QQ 启动进程':'SnowLuma')+'结束（'+(signal||code)+'）');this.onExit();
      }});
      return child;
    };
    this.launchQq();
    this.snow=this.launch('/opt/snowluma/node',['--import','/opt/qq-workbench/proc-locks-compat.mjs',this.root+'/index.mjs'],
      {SNOWLUMA_UPDATE_ROOT:this.root,SNOWLUMA_WEBUI_HOST:'127.0.0.1',SNOWLUMA_WEBUI_PORT:'15099',
        SNOWLUMA_WEBUI_BOOTSTRAP_PASSWORD:this.password,SNOWLUMA_HOOK_AUTOLOAD:'0',QQWB_PROC_LOCKS_FDINFO:'1',
        SNOWLUMA_LOG_MAX_TOTAL_MB:'32',SNOWLUMA_LOG_RETAIN_DAYS:'2',SNOWLUMA_ACCEPT_EULA:'1',SNOWLUMA_ACCEPT_PRIVACY:'1'});
  }
  launchQq() {
    this.launcherExited=false;this.configuredUin='';
    this.qq=this.launch('/usr/bin/dbus-run-session',['--','/usr/bin/env',
      'SNOWLUMA_HOOK_STUB_START=true','SNOWLUMA_HOOK_SERVICE_MODE=in-process',
      'LD_PRELOAD='+this.root+'/native/snowluma-linux-arm64.so','/opt/QQ/qq',
      '--no-sandbox','--disable-gpu','--disable-software-rasterizer','--disable-gpu-compositing','--disable-dev-shm-usage'],
      {LD_LIBRARY_PATH:'/opt/QQ:/opt/QQ/resources/app:/usr/lib/aarch64-linux-gnu'},'qq');
  }
  async recoverRelaunch() {
    if(this.stopped||!this.launcherExited)return;
    const pids=fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p)&&this.ownsQq(p));
    let lost=false;
    for(const pid of pids)try{
      lost||=needsRelaunchRecovery({launcherExited:this.launcherExited,
        args:fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0'),
        nativeLoaded:fs.readFileSync('/proc/'+pid+'/maps','utf8').includes('/snowluma-linux-arm64.so')});
    }catch{}
    if(!lost)return;
    const now=Date.now();this.recoveries=this.recoveries.filter(t=>now-t<600000);
    if(this.recoveries.length>=2){this.failure='QQ 多次重启后接入仍未恢复，请停止本地服务后查看诊断';return;}
    if(this.recoveries.length&&now-this.recoveries.at(-1)<30000)return;
    this.recoveries.push(now);this.failure='QQ 登录后重新启动，正在恢复 SnowLuma 接入';
    console.log('QQWB:'+this.failure);this.onExit();
    // Only this app UID and the dedicated QQ profile, never Android QQ or SnowLuma.
    for(const pid of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p)))try{
      const cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0')[0];
      if(fs.statSync('/proc/'+pid).uid===fs.statSync('/proc/self').uid&&
        ['/opt/QQ/qq','/opt/QQ/chrome_crashpad_handler'].includes(cmd)&&
        fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').includes('HOME='+this.home))process.kill(Number(pid),'SIGTERM');
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,2000));
    if(this.stopped)return;
    if(pids.some(pid=>this.ownsQq(pid))){this.failure='QQ 尚未完成退出，暂不重复启动';return;}
    this.launchQq();
  }
  async request(route,payload,open=false) {
    const response=await fetch('http://127.0.0.1:15099'+route,{method:payload===undefined?'GET':'POST',
      headers:{'Content-Type':'application/json',...(!open?{Authorization:'Bearer '+this.auth}:{})},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(route.endsWith('/load')?45000:12000)});
    if(response.status===401)this.auth='';
    if(!response.ok)throw new Error('本机 SnowLuma 尚未就绪');
    return response.json();
  }
  async authorize() {
    if(this.auth)return;
    if(this.authorizing)return this.authorizing;
    this.authorizing=(async()=>{
      let result=await this.request('/api/login',{password:this.password},true);
      if(!result.success||!result.token)throw new Error('本机 SnowLuma 认证尚未就绪');
      this.auth=result.token;
      if(result.mustChangePassword){
        const next='Local!8'+crypto.randomBytes(32).toString('hex');
        await this.request('/api/auth/change-password',{oldPassword:this.password,newPassword:next});
        this.password=next;privateText(path.join(this.work,'console-password'),next);
        result=await this.request('/api/login',{password:next},true);
        if(!result.success||!result.token){this.auth='';throw new Error('本机 SnowLuma 认证未完成');}
        this.auth=result.token;
      }
    })();
    try{await this.authorizing;}finally{this.authorizing=null;}
  }
  ownsQq(pid) {
    try{
      const command=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0');
      return fs.statSync('/proc/'+pid).uid===fs.statSync('/proc/self').uid&&command[0]==='/opt/QQ/qq'&&
        !command.some(s=>s.startsWith('--type='))&&fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').includes('HOME='+this.home);
    }catch{return false;}
  }
  async processes() {
    if(this.recovering)await this.recovering;
    else {this.recovering=this.recoverRelaunch();try{await this.recovering;}finally{this.recovering=null;}}
    await this.authorize();
    let items=((await this.request('/api/processes')).list||[]).filter(p=>this.ownsQq(p.pid));
    for(const p of items)if(!p.connected&&fs.existsSync('/tmp/qqwb-runtime/mojo.'+p.pid+'.control.sock')){
      await this.request('/api/processes/'+p.pid+'/load',{});
      items=((await this.request('/api/processes')).list||[]).filter(p=>this.ownsQq(p.pid));break;
    }
    return items;
  }
  async state() {
    const items=await this.processes(),account=readyAccount(items);
    if(account){
      this.failure='';
      const uin=String(account.uin);
      if(this.configuredUin!==uin){
        const saved=(await this.request('/api/config/'+uin)).config;
        await this.request('/api/config/'+uin,oneBotConfig(saved,this.onebotToken));
        this.configuredUin=uin;
      }
      return {status:{isLogin:true},info:{uin}};
    }
    this.configuredUin='';
    return {status:{isLogin:false,loginError:items.some(p=>p.connected)?'SnowLuma 已连接，等待 QQ 完成登录':''},info:{uin:''}};
  }
  async accounts() {
    return (await this.processes()).filter(p=>validUin(p.uin)).map(p=>({uin:String(p.uin),
      loggedIn:!!p.loggedIn,connected:false,statusLabel:p.connected&&p.loggedIn?'QQ 已登录，等待 OneBot 核验':'账号已发现，登录状态待核验'}));
  }
  async quickLogin(uin) {
    if(!validUin(uin))throw new Error('请选择正确的 QQ 账号');
    return false; // QQ's official window owns account selection and login.
  }
  async remember() {}
  qrData(){return '';}
  async stop() {
    this.stopped=true;
    for(const child of [...this.children].reverse()){
      if(child.exitCode!==null||child.signalCode!==null)continue;
      const exited=new Promise(resolve=>child.once('exit',resolve));
      try{process.kill(-child.pid,'SIGTERM');}catch{}
      const done=await Promise.race([exited.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),2000))]);
      if(!done)try{process.kill(-child.pid,'SIGKILL');}catch{}
    }
    // Electron may detach from its D-Bus process group. Scope cleanup to the
    // exact dedicated HOME and this Android UID, including detached helpers.
    const uid=fs.statSync('/proc/self').uid;
    for(const pid of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p)))try{
      if(fs.statSync('/proc/'+pid).uid!==uid)continue;
      if(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').includes('HOME='+this.home))process.kill(Number(pid),'SIGKILL');
    }catch{}
  }
}
