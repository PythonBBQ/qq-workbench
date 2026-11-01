// Measure the complete PCM utterance once. Never turn up a quiet breath separately.
export function speechGain(bytes,soft=false){
  if(!Buffer.isBuffer(bytes)||bytes.length<44||bytes.length>6*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')return 0;
  let format=0,width=0,channels=0,block=0,data=null;
  for(let offset=12;offset+8<=bytes.length;){
    const size=bytes.readUInt32LE(offset+4),start=offset+8,end=start+size;if(end>bytes.length)return 0;
    const id=bytes.toString('ascii',offset,offset+4);
    if(id==='fmt '&&size>=16){format=bytes.readUInt16LE(start);channels=bytes.readUInt16LE(start+2);block=bytes.readUInt16LE(start+12);width=bytes.readUInt16LE(start+14);}
    if(id==='data')data=bytes.subarray(start,end);
    offset=end+(size&1);
  }
  if(!data||!data.length||channels<1||channels>8||!((format===1&&[16,24,32].includes(width))||(format===3&&width===32))||block!==channels*width/8||data.length%block)return 0;
  let energy=0,peak=0,count=0;const stride=width/8;
  for(let i=0;i<data.length;i+=stride){const value=format===3?data.readFloatLE(i):width===16?data.readInt16LE(i)/32768:width===24?data.readIntLE(i,3)/8388608:data.readInt32LE(i)/2147483648;if(!Number.isFinite(value))return 0;energy+=value*value;peak=Math.max(peak,Math.abs(value));count++;}
  const rms=Math.sqrt(energy/count);if(rms<0.0001||peak<0.0001)return 0;
  const target=soft?-24:-20;
  return Math.min(6,Math.max(-12,target-20*Math.log10(rms)),-2-20*Math.log10(peak));
}
