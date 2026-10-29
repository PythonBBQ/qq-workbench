import fs from 'node:fs';
import path from 'node:path';
const count=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n))&&Number(n)>=0?Math.floor(Number(n)):null;
const categories=['chat','vision','search','memory','personality','sticker','qzone','device','test','other'];
const day=at=>new Date(at+8*3600000).toISOString().slice(0,10);
function empty(){return {calls:0,reported:0,unreported:0,failed:0,input:0,output:0,cached:0,reasoning:0};}
function total(rows){const sum=empty();for(const row of rows){sum.calls++;sum.reported+=row.reported?1:0;sum.unreported+=row.reported?0:1;sum.failed+=row.ok?0:1;for(const k of ['input','output','cached','reasoning'])sum[k]+=row[k]||0;}return sum;}
export class UsageLedger{
  constructor(directory){this.file=path.join(directory,'usage-ledger.json');this.rows=[];this.session=[];this.notice='';try{const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!Array.isArray(saved)||saved.some(r=>!r||!Number.isFinite(r.at)||typeof r.reported!=='boolean'))throw new Error('Invalid usage ledger');this.rows=saved.slice(-2000);}catch(e){if(e.code!=='ENOENT'){this.notice='旧用量记录损坏，原文件保留；当前统计仅在本次运行有效';this.readOnly=true;}}}
  record({usage={},model,host,category='other',ok=true,ms=0,at=Date.now()}){
    const input=count(usage.prompt_tokens??usage.input_tokens),output=count(usage.completion_tokens??usage.output_tokens);
    const row={at,day:day(at),model:String(model||'unknown').replace(/[\r\n]/g,' ').slice(0,100),host:String(host||'').slice(0,160),category:categories.includes(category)?category:'other',ok:!!ok,ms:Math.max(0,Math.min(300000,Number(ms)||0)),reported:input!==null&&output!==null,input,output,cached:count(usage.prompt_cache_hit_tokens??usage.prompt_tokens_details?.cached_tokens??usage.input_tokens_details?.cached_tokens)||0,reasoning:count(usage.completion_tokens_details?.reasoning_tokens??usage.output_tokens_details?.reasoning_tokens)||0};
    this.rows.push(row);this.session.push(row);this.rows=this.rows.filter(r=>at-r.at<90*86400000).slice(-2000);this.session=this.session.slice(-2000);
    if(!this.readOnly)try{fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.rows),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}catch{this.notice='用量暂未写入磁盘，本次统计仍可查看';}
    return row;
  }
  snapshot(now=Date.now()){
    const today=this.rows.filter(r=>r.day===day(now)),groups=new Map();
    for(const row of today){const key=row.host+'\0'+row.model+'\0'+row.category;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    return {notice:this.notice,day:day(now),today:total(today),session:total(this.session),retained:total(this.rows),last:this.rows.at(-1)||null,groups:[...groups.values()].map(rows=>({model:rows[0].model,host:rows[0].host,category:rows[0].category,...total(rows)})),recent:this.rows.slice(-30).reverse()};
  }
  text(){const s=this.snapshot(),t=s.today;return '今日模型用量（北京时间）\n输入 '+t.input+' Token，输出 '+t.output+' Token，缓存命中 '+t.cached+' Token（已包含在输入中）。\n共 '+t.calls+' 次调用，'+t.unreported+' 次未返回完整用量；未知用量不按零计。'+(s.last?'\n最近一次：'+s.last.model+'，'+(s.last.reported?'输入 '+s.last.input+'，输出 '+s.last.output:'服务商未报告完整用量')+'。':'')+'\n包括看图、搜索规划、记忆等辅助调用；费用以服务商账单为准。';}
}
