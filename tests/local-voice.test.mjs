import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {synthesize} from '../assets/voice.mjs';
import {qqRecoveryReason,SnowLumaBridge} from '../assets/snowluma-bridge.mjs';
import {validateInstance} from '../assets/account-instances.mjs';

test('local voice passes only supported reference mood controls, preserves timbre, reports real fallback reference and cleans audio',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'local-voice-'));try{
 const bytes=Buffer.alloc(200);bytes.write('RIFF');let calls=0;
 const audio=await synthesize({speechProvider:'zipvoice',zipVoiceSteps:8,speechRate:4,speechPitch:20},'主人，休息一下。',{emotion:'shy',directory,native:async(route,data)=>{calls++;assert.equal(route,'synthesize');assert.equal(data.provider,'zipvoice');assert.equal(data.emotion,'shy');assert.equal(data.rate,4,'no fake emotional pitch/rate changes');assert.equal(data.steps,8);return {ok:true,audio:bytes.toString('base64'),referenceMood:'neutral',referenceSource:'system',elapsedMs:2000};},convert:async(bin,args)=>fs.writeFileSync(args.at(-1),Buffer.alloc(100))});
 assert.equal(calls,1);assert.deepEqual(audio.info,{provider:'zipvoice',referenceMood:'neutral',referenceSource:'system',elapsedMs:2000});assert.equal(fs.readdirSync(directory).length,1);audio.cleanup();assert.equal(fs.readdirSync(directory).length,0);
 await assert.rejects(()=>synthesize({speechProvider:'zipvoice'},'长句',{directory,native:async()=>({ok:false,message:'语音轻量模式限240字'})}),/240/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('multi-account recovery handles a vanished QQ without touching healthy, manual-stop or relaunch-with-hook processes',()=>{
 assert.equal(qqRecoveryReason({launcherExited:true,ownedCount:0,lostHook:false}),'missing');
 assert.equal(qqRecoveryReason({launcherExited:true,ownedCount:1,lostHook:true}),'relaunch');
 for(const state of [{launcherExited:false,ownedCount:0,lostHook:false},{launcherExited:true,ownedCount:1,lostHook:false},{launcherExited:true,ownedCount:0,lostHook:false,stopped:true}])assert.equal(qqRecoveryReason(state),null);
});
test('primary identity remains available while offline, only inside its own bridge directory',async()=>{
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-identity-'));try{const bridge=new SnowLumaBridge({work});await bridge.remember('123456');assert.equal(new SnowLumaBridge({work}).lastKnownUin(),'123456');await bridge.remember('not-an-account');assert.equal(bridge.lastKnownUin(),'123456');}finally{fs.rmSync(work,{recursive:true,force:true});}
});
test('local voice is a supported independently configured account provider',()=>{
 assert.equal(validateInstance({slot:1,bot:'765432',owner:'123456',apiUrl:'https://example.com/v1',apiKey:'synthetic',model:'test',speechProvider:'zipvoice'}).speechProvider,'zipvoice');
});
