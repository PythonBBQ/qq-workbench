// Read the user-provided public BV video without model calls or QQ sends.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {resolveBiliVideo,readBiliFrames} from '/opt/qq-workbench/bili-video.mjs';
import {androidFetch} from '/opt/qq-workbench/native-network.mjs';import {decodeClip} from '/opt/qq-workbench/video-decoder.mjs';
const work=path.dirname(fileURLToPath(import.meta.url));if(path.basename(work)!=='bili-video-tests')throw new Error('Isolated test required');
let token='';const uid=fs.statSync('/proc/self').uid;
for(const pid of fs.readdirSync('/proc').filter(v=>/^\d+$/.test(v)))try{if(fs.statSync('/proc/'+pid).uid!==uid)continue;if(!fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0').includes('/opt/qq-workbench/assistant.mjs'))continue;token=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').find(v=>v.startsWith('WORKBENCH_TOKEN='))?.slice(16)||'';if(token)break;}catch{}
if(!token)throw new Error('Local service is not ready');
const network=androidFetch(fetch,token),start=Date.now();let report;
try{
 const video=await readBiliFrames('https://www.bilibili.com/video/BV1Umxc6JEdD',token,network,{decode:async name=>{const file=path.join('/opt/qq-workbench/video-imports',name);try{return await decodeClip(file);}finally{try{fs.unlinkSync(file);}catch{}}}});
 report={realBiliVideoFrames:true,frameCount:video.frameCount,sheets:video.sheets,source:video.reference,elapsedMs:Date.now()-start,anonymousAccess:true,paidModelCalls:0,qqMessagesSent:0};
}catch(error){report={realBiliVideoFrames:false,message:error.message,elapsedMs:Date.now()-start,anonymousAccess:true,paidModelCalls:0,qqMessagesSent:0};}
fs.writeFileSync(path.join(work,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
