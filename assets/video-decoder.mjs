import {transcribeClip} from './video-audio.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
const formats='mov,matroska,webm,avi,mpeg,mpegts,ogg,flv';
async function mediaTool(binary,args,options){
  try{return await exec(binary,args,options);}catch(error){
    if(error.code==='ENOENT')throw new Error('兼容视频解码组件尚未就绪，请稍后重试或重新启动本地服务');
    if(error.killed||error.code==='ETIMEDOUT')throw new Error('视频解码超时，请选择更短的片段');
    throw new Error('视频解码失败，请选择未损坏的常见MP4短片段');
  }
}
export async function decodeClip(file,work='/opt/qq-workbench'){
  const real=fs.realpathSync(file),directory=fs.realpathSync(path.join(work,'video-imports'));
  if(path.dirname(real)!==directory||!/^clip-[a-f0-9]{32}\.bin$/.test(path.basename(real))||fs.lstatSync(file).isSymbolicLink())throw new Error('视频暂存路径无效');
  const metadata=fs.statSync(real);if(!metadata.isFile()||metadata.size>32*1024*1024||!metadata.size)throw new Error('视频大小须在32MB以内');
  const env={PATH:'/usr/bin:/bin',HOME:'/tmp',LANG:'C.UTF-8'};
  const result=await mediaTool('/usr/bin/ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-show_entries','format=duration','-of','json',real],{env,timeout:12000,maxBuffer:65536});
  const duration=Number(JSON.parse(result.stdout).format?.duration);if(!Number.isFinite(duration)||duration<=0||duration>600)throw new Error('仅支持10分钟以内的视频');
  const span=duration,count=Math.ceil(span),frames=[],sheets=Math.ceil(count/8);
  const outputDir=fs.mkdtempSync(path.join(directory,'sheets-'));
  try{
    // One sequential decode, instead of launching a decoder once per second.
    const filter='fps=1:start_time=0:round=up,scale=256:144:force_original_aspect_ratio=decrease,pad=256:144:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop_mode=clone:stop_duration=1,trim=end_frame='+count+',tile=4x2:nb_frames=8';
    await mediaTool('/usr/bin/ffmpeg',['-v','error','-nostdin','-threads','1','-filter_threads','1','-protocol_whitelist','file,pipe','-format_whitelist',formats,'-i',real,'-t',String(span+1),'-an','-sn','-vf',filter,'-frames:v',String(sheets),'-threads','1','-c:v','mjpeg','-q:v','7',path.join(outputDir,'sheet-%02d.jpg')],{env,timeout:450000,maxBuffer:65536});
    let bytes=0;
    for(let i=0;i<sheets;i++){
      const image=fs.readFileSync(path.join(outputDir,'sheet-'+String(i+1).padStart(2,'0')+'.jpg'));bytes+=image.length;
      if(!image.length||bytes>15000000)throw new Error('视频压缩画面超过上限');
      frames.push({seconds:i*8,timestamps:Array.from({length:Math.min(8,count-i*8)},(_,j)=>i*8+j),url:'data:image/jpeg;base64,'+image.toString('base64')});
    }
    const audio=await transcribeClip(real,work);
    return {sampling:'1fps-contact-sheet-v1',durationSeconds:duration,sampledSeconds:span,frameCount:count,frames,audio};
  }finally{fs.rmSync(outputDir,{recursive:true,force:true});}
}
export async function downloadClip(url,fetcher,work='/opt/qq-workbench'){
  const directory=path.join(work,'video-imports');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'clip-'+crypto.randomBytes(16).toString('hex')+'.bin');
  try{
    const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(35000)});if(!response.ok)throw new Error('视频链接暂不可读');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>7*1024*1024)throw new Error('兼容解码仅下载7MB以内QQ短视频；更大视频请在工作台本机导入');chunks.push(chunk);}
    fs.writeFileSync(file,Buffer.concat(chunks),{mode:0o600});return await decodeClip(file,work);
  }finally{try{fs.unlinkSync(file);}catch{}}
}
