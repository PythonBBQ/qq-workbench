import fs from 'node:fs';
import path from 'node:path';
const count=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n))&&Number(n)>=0?Math.floor(Number(n)):null;
const categories=['chat','vision','search','memory','personality','sticker','qzone','device','codex','test','other'];
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
  recentText(number){
    if(!Number.isInteger(number)||number<1||number>20)throw new Error('次数需为1到20');
    const rows=this.rows.slice(-number).reverse(),sum=total(rows);if(!rows.length)return '暂时没有模型调用用量记录。';
    const labels={chat:'聊天',vision:'看图',search:'搜索',memory:'记忆',personality:'性格',sticker:'表情',qzone:'空间',device:'设备',codex:'Codex',test:'测试',other:'其他'};
    const lines=rows.map((r,i)=>{const time=new Date(r.at+8*3600000).toISOString().slice(5,19).replace('T',' ');return (i+1)+'）'+time+' '+(labels[r.category]||'其他')+' '+r.model.slice(0,24)+(r.ok?'':'（失败）')+'\n输入 '+(r.input??'未报告')+'，输出 '+(r.output??'未报告')+'，缓存 '+r.cached;});
    return '最近 '+rows.length+' 次模型调用（最新在前，北京时间）'+(rows.length<number?'，仅有这些记录':'')+'\n\n'+lines.join('\n\n')+'\n\n已报告部分合计：输入 '+sum.input+'，输出 '+sum.output+'，缓存 '+sum.cached+' Token。缓存已包含在输入中，不重复相加。'+(sum.unreported?'\n'+sum.unreported+' 次未完整报告用量，未知部分不按零计。':'')+'\n一次聊天可能包含多次看图、搜索或记忆调用；费用以服务商账单为准。'+(this.notice?'\n'+this.notice:'');
  }
  text(){const s=this.snapshot(),t=s.today;return '今日模型用量（北京时间）\n输入 '+t.input+' Token，输出 '+t.output+' Token，缓存命中 '+t.cached+' Token（已包含在输入中）。\n共 '+t.calls+' 次调用，'+t.unreported+' 次未返回完整用量；未知用量不按零计。'+(s.last?'\n最近一次：'+s.last.model+'，'+(s.last.reported?'输入 '+s.last.input+'，输出 '+s.last.output:'服务商未报告完整用量')+'。':'')+'\n包括看图、搜索规划、记忆等辅助调用；费用以服务商账单为准。';}
}
