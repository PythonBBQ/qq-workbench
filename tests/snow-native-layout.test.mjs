import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {adaptSnowCoreLayout,prepareSnowNative,SNOW_CORE_LAYOUT} from '../assets/snowluma-bridge.mjs';

test('unknown or changed native binaries cannot receive the layout patch',()=>{
  for(const bytes of [Buffer.alloc(0),Buffer.from('ELF'),Buffer.alloc(129992)])
    assert.throws(()=>adaptSnowCoreLayout(bytes),/校验不符/);
});

test('a QQ version label alone cannot enable the native adaptation',()=>{
  const work=fileURLToPath(new URL('../build/maintenance-host/',import.meta.url));fs.mkdirSync(work,{recursive:true});
  const dir=fs.mkdtempSync(path.join(work,'qqwb-layout-'));
  try{
    const app=path.join(dir,'qq/resources/app'),snow=path.join(dir,'snow');
    fs.mkdirSync(app,{recursive:true});
    fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({version:'future-version'}));
    assert.equal(prepareSnowNative({snowRoot:snow,qqRoot:path.join(dir,'qq')}),path.join(snow,'native/snowluma-linux-arm64.so'));
    fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({version:SNOW_CORE_LAYOUT.qqVersion}));
    fs.writeFileSync(path.join(app,'wrapper.node'),'different QQ build');
    assert.throws(()=>prepareSnowNative({snowRoot:snow,qqRoot:path.join(dir,'qq')}),/QQ 原生组件/);
    assert.equal(fs.existsSync(snow),false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

const fixture=process.env.QQWB_SNOW_NATIVE_FIXTURE;
test('verified upstream ELF changes only its core offset instruction and preserves the input',{skip:!fixture},()=>{
  const original=fs.readFileSync(fixture),before=Buffer.from(original),adapted=adaptSnowCoreLayout(original);
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(adapted),SNOW_CORE_LAYOUT.adaptedSha256);
  assert.deepEqual(original,before);
  const differences=[];for(let i=0;i<original.length;i++)if(original[i]!==adapted[i])differences.push(i);
  assert.ok(differences.length>0&&differences.length<=4);
  assert.equal(Math.floor(differences[0]/4),Math.floor(differences.at(-1)/4));
  const instruction=Math.floor(differences[0]/4)*4;
  assert.equal(original.readUInt32LE(instruction),0x91092000);
  assert.equal(adapted.readUInt32LE(instruction),0x9108c000);
  assert.throws(()=>adaptSnowCoreLayout(adapted),/校验不符/);
  const corrupt=Buffer.from(original);corrupt[corrupt.length-1]^=1;
  assert.throws(()=>adaptSnowCoreLayout(corrupt),/校验不符/);
});
