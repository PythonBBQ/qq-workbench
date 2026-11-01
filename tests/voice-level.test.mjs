import test from 'node:test';import assert from 'node:assert/strict';
import {speechGain} from '../assets/voice-level.mjs';
import {speechDeliveryFilter} from '../assets/voice.mjs';
function wav(values,{format=1,bits=16,channels=1}={}){
 const data=Buffer.alloc(values.length*bits/8),b=Buffer.alloc(44);b.write('RIFF');b.writeUInt32LE(36+data.length,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(format,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(24000*channels*bits/8,28);b.writeUInt16LE(channels*bits/8,32);b.writeUInt16LE(bits,34);b.write('data',36);b.writeUInt32LE(data.length,40);
 values.forEach((v,i)=>{if(format===3)data.writeFloatLE(v,i*4);else data.writeIntLE(Math.max(-(2**(bits-1)),Math.min(2**(bits-1)-1,Math.round(v*2**(bits-1)))),i*bits/8,bits/8);});return Buffer.concat([b,data]);
}
test('whole-utterance gain respects peaks and keeps soft speech quieter without dynamic gain',()=>{
 const x=Array.from({length:24000},(_,i)=>Math.sin(i*.04)*(i<12000?.3:.003)),audio=wav(x);
 const normal=speechGain(audio),soft=speechGain(audio,true);assert.ok(normal<=6&&normal>=-12);assert.ok(Math.abs(normal-soft-4)<.01);assert.ok(.3*10**(normal/20)<=10**(-2/20));
 for(const quiet of [false,true]){const filter=speechDeliveryFilter(quiet,0,speechGain(audio,quiet));assert.ok(!/dynaudnorm|loudnorm|agate|silenceremove/.test(filter));assert.ok(filter.includes('level=0'));assert.ok(filter.endsWith('apad=pad_dur=1.5'));}
 assert.ok(speechGain(wav([.98,...Array(1000).fill(.001)]))<0,'high crest signals cannot be boosted into clipping');
 assert.equal(speechGain(wav(Array(1000).fill(.00001))),0,'silence is not boosted');
});
test('PCM16/24/32 and float references use equivalent gain; malformed or non-finite input is not amplified',()=>{
 const x=Array.from({length:1000},(_,i)=>.12*Math.sin(i*.08));const base=speechGain(wav(x));
 for(const options of [{bits:24},{bits:32},{bits:32,format:3}])assert.ok(Math.abs(speechGain(wav(x,options))-base)<.01);
 for(const audio of [Buffer.alloc(0),Buffer.from('RIFF bad file'),wav([NaN],{format:3,bits:32}),wav(x,{format:6})])assert.equal(speechGain(audio),0);
 const bad=wav(x);bad.writeUInt32LE(0xffffffff,40);assert.equal(speechGain(bad),0);
 const unusual=wav(x);unusual.writeUInt16LE(0,32);assert.equal(speechGain(unusual),0);
});
