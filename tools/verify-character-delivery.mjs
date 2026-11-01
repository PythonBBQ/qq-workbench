// Exercise the production synthesis-to-MP3 path with real native tablet outputs.
// Uses no credentials and sends no QQ messages.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {synthesize,speechDeliveryFilter} from '../assets/voice.mjs';

const execute=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),workspace=path.resolve(root,'../..');
const option=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error('Missing '+name);return path.resolve(process.argv[i+1]);};
const source=option('--tablet'),output=option('--output');
for(const file of [source,output])if(path.relative(workspace,file).startsWith('..')||path.isAbsolute(path.relative(workspace,file)))throw new Error('Outside workspace');
fs.mkdirSync(output,{recursive:true});
const ffmpeg=path.resolve(root,'../research/android/voice-runtime/bin/ffmpeg.exe'),report=JSON.parse(fs.readFileSync(path.join(source,'review.json'),'utf8')),rows=[];
for(const row of report.samples){
  const id=row.sample;if(!/^[a-z0-9-]+$/.test(id))throw new Error('Unsafe sample');
  const input=path.join(source,id+'.wav'),bytes=fs.readFileSync(input),soft=row.request.deliveryStyle==='soft'||row.deliveryStyle==='soft';
  const result=await synthesize({speechProvider:'zipvoice',zipVoiceSteps:row.request.steps,zipVoiceAdaptive:false},row.request.text,{
    emotion:row.request.emotion,event:{raw_message:soft?'用ASMR轻声说':'正常说话'},directory:output,
    native:async()=>({...row,audio:bytes.toString('base64')}),
    convert:async(binary,args,options)=>{if(binary!=='/usr/bin/ffmpeg')throw new Error('Unexpected converter');await execute(ffmpeg,args,{...options,env:process.env,windowsHide:true});}
  });
  const dest=path.join(output,id+'.mp3');fs.renameSync(result.file,dest);result.cleanup();
  rows.push({sample:id,text:row.request.text,input,output:dest,soft,filter:speechDeliveryFilter(soft),sourceSHA256:crypto.createHash('sha256').update(bytes).digest('hex'),outputSHA256:crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex')});
}
fs.writeFileSync(path.join(output,'delivery-receipt.json'),JSON.stringify({scope:'production-synthesize-real-ffmpeg-no-QQ-send',tailPaddingSeconds:1.5,samples:rows},null,2));
process.stdout.write(JSON.stringify({samples:rows.length,output,qqMessagesSent:0})+'\n');
