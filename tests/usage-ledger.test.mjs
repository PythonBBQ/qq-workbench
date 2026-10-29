import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {UsageLedger} from '../assets/usage-ledger.mjs';
const sample={model:'synthetic-model',host:'relay.example',category:'vision',usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:30}}};
test('reported usage survives restart, groups by model/purpose/day and cache is not added to input twice',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qqwb-usage-'));try{
    const u=new UsageLedger(dir);u.record(sample);u.record({...sample,category:'search',usage:{}});u.record({...sample,ok:false,usage:{prompt_tokens:null,completion_tokens:null}});
    const s=u.snapshot();assert.equal(s.today.calls,3);assert.equal(s.today.input,100);assert.equal(s.today.output,20);assert.equal(s.today.cached,30);assert.equal(s.today.unreported,2);assert.equal(s.today.failed,1);assert.equal(s.groups.length,2);
    const again=new UsageLedger(dir);assert.equal(again.snapshot().today.input,100);assert.equal(again.snapshot().session.calls,0);assert.match(again.text(),/未知用量不按零计/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('usage stores no prompts, keys or responses; a corrupted ledger is preserved',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qqwb-usage-'));try{
    new UsageLedger(dir).record({...sample,key:'synthetic-secret',prompt:'private content',answer:'private answer'});const file=path.join(dir,'usage-ledger.json');const bytes=fs.readFileSync(file,'utf8');assert.ok(!/synthetic-secret|private content|private answer/.test(bytes));
    fs.writeFileSync(file,'broken');const u=new UsageLedger(dir);u.record(sample);assert.equal(fs.readFileSync(file,'utf8'),'broken');assert.match(u.snapshot().notice,/原文件保留/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Responses usage and reasoning token details are accepted without inventing missing fields',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qqwb-usage-'));try{const u=new UsageLedger(dir);u.record({...sample,usage:{input_tokens:50,output_tokens:30,input_tokens_details:{cached_tokens:20},output_tokens_details:{reasoning_tokens:10}}});const s=u.snapshot();assert.equal(s.today.reasoning,10);assert.equal(s.today.input,50);assert.equal(s.today.cached,20);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
