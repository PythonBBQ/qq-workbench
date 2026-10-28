// Read-only live evidence: authentication and QQ numbers never leave the app UID.
import fs from 'node:fs';
const uid=fs.statSync('/proc/self').uid;let token='',assistantPid='';
for(const pid of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p)))try{
  if(fs.statSync('/proc/'+pid).uid!==uid)continue;
  const cmd=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0');if(!cmd.includes('/opt/qq-workbench/assistant.mjs'))continue;
  const env=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0');token=(env.find(s=>s.startsWith('WORKBENCH_TOKEN='))||'').slice(16);if(token){assistantPid=pid;break;}
}catch{}
if(!token)throw new Error('No authenticated assistant process');
const state=await(await fetch('http://127.0.0.1:13480/state',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)})).json();
console.log(JSON.stringify({at:Date.now(),assistantPid,connected:state.connected,enabled:state.enabled,queue:state.queue}));
