import {test} from 'node:test';import assert from 'node:assert/strict';
import {transcriptObjects,compactTranscript,audioContext,withAudio,AUDIO_POLICY,pcmSignal,audioEvents,audioEvidence,asksAudio,audioReplyPolicy,audioFocusContext} from '../assets/video-audio.mjs';
import {sampledVideo,videoBatches} from '../assets/video.mjs';
test('speech output parsing ignores diagnostics, braces in strings and non-transcript JSON',()=>{
 const output='Started\n'+JSON.stringify({text:'视频说了 {这是例子} 和 "引用"',tokens:['x']})+'\nDone!\n'+JSON.stringify({debug:true});
 assert.equal(transcriptObjects(output).length,1);assert.match(transcriptObjects(output)[0].text,/这是例子/);
});
test('local speech is bounded by thirty-second segments, no additional language-model calls, and aligned to each visual batch',()=>{
 const audio=compactTranscript(Array.from({length:20},(_,i)=>({text:i===0?'开始讨论米饭':'文'.repeat(800)})),600);
 assert.equal(audio.status,'ok');assert.ok(audio.characters<=6000);assert.equal(audio.segments[1].truncated,true);
 const text=audioContext(audio,120,240);assert.match(text,/120—150秒/);assert.match(text,/210—240秒/);assert.ok(!text.includes('开始讨论米饭'));assert.ok(text.length<1500);
 assert.equal(AUDIO_POLICY.threads,2);assert.equal(audioContext({status:'failed'}),'');
 assert.equal(compactTranscript([{text:''}],30).status,'unintelligible');
});
test('real transcript replaces visual-only scope and enters only the corresponding model batch',()=>{
 const data={sampling:'1fps-contact-sheet-v1',durationSeconds:240,sampledSeconds:240,frameCount:240,frames:Array.from({length:30},(_,i)=>({seconds:i*8,timestamps:Array.from({length:8},(_,j)=>i*8+j),url:'data:image/jpeg;base64,AQID'}))};
 const audio=compactTranscript(Array.from({length:8},(_,i)=>({text:'第'+i+'段对白'})),240),video=sampledVideo({...data,audio});
 assert.match(video.scope,/本地转写音轨/);assert.ok(!video.scope.includes('未听取音轨'));assert.match(video.audioText,/第0段对白/);
 const batches=videoBatches(video);assert.match(JSON.stringify(batches[0]),/第0段对白/);assert.ok(!JSON.stringify(batches[0]).includes('第4段对白'));assert.match(JSON.stringify(batches[1]),/第4段对白/);
 const missing=withAudio(sampledVideo(data),{status:'no-audio'});assert.match(missing.scope,/文件内没有音频流/);assert.equal(missing.audioText,'');
});

function wave(samples){const data=Buffer.alloc(44+samples.length*2);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(16000,24);data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples.length*2,40);samples.forEach((v,i)=>data.writeInt16LE(v,44+i*2));return data;}
test('digital silence is measured separately from ASR emptiness and quiet but audible PCM',()=>{
 assert.equal(pcmSignal([wave([0,0,0,0])]).signal,'silent');assert.equal(pcmSignal([wave([12,-12,0,0])]).signal,'present');assert.equal(pcmSignal([wave([12000,-12000,400,-400])]).signal,'present');assert.throws(()=>pcmSignal([Buffer.from('bad')]));assert.throws(()=>pcmSignal([wave([])]));
 for(const status of ['unintelligible','failed','unavailable'])assert.match(audioEvidence({status,signal:'present'}),/测到非静音声音/);
 assert.match(audioEvidence({status:'unintelligible',signal:'present'}),/这不表示没有声音/);assert.match(audioEvidence({status:'failed'}),/不能声称静音/);assert.match(audioEvidence({status:'no-audio'}),/不能推断网站上的原作品静音/);
});
test('bounded local event probabilities supplement music even when no human words are recognized',()=>{
 const tags=audioEvents('0: AudioEvent(name="Music", index=137, prob=0.98)\nAudioEvent(name="Piano", index=153, prob=0.70)\nAudioEvent(name="Music", index=137, prob=0.91)\nAudioEvent(name="Speech", index=0, prob=0.12)');
 assert.deepEqual(tags,[{name:'Music',confidence:.98},{name:'Piano',confidence:.7}]);
 const result=withAudio({scope:'低清画面；未听取音轨、未读取完整字幕，'}, {...compactTranscript([{text:''}],30),signal:'present',tags,tagWindows:3});assert.ok(!result.scope.includes('Music 98%'));assert.match(audioFocusContext(result.audio,'这音乐怎么样'),/Music 98%/);assert.match(result.scope,/不能说没声音/);assert.match(result.scope,/没有转写不得当作静音/);assert.equal(result.audioText,'');
 assert.match(audioEvidence({status:'silent',signal:'silent'}),/PCM采样接近数字零值/);
});


test('music evidence is opt-in for current questions while dialogue remains available in every batch',()=>{
 const audio={status:'ok',signal:'present',segments:[{start:0,end:30,text:'这是识别出的对白'}],tags:[{name:'Music',confidence:.98}],tagWindows:3};
 for(const text of ['这声音怎么样','这音乐好听吗','听听BGM','bgm咋样','分析这个视频的配乐'])assert.equal(asksAudio(text),true,text);
 for(const text of ['概括视频','最后发生了什么','不用分析音乐，只说剧情','不要评价BGM','视频整体怎么样'])assert.equal(asksAudio(text),false,text);
 const video=withAudio({scope:'视频画面',parts:[{type:'image_url',image_url:{url:'data:image/jpeg;base64,AQID'}}]},audio);
 const normal=JSON.stringify(videoBatches(video,'视频讲了什么')),focused=JSON.stringify(videoBatches(video,'这音乐怎么样'));
 assert.match(normal,/这是识别出的对白/);assert.ok(!normal.includes('Music 98%'));assert.match(normal,/不主动提及/);
 assert.match(focused,/Music 98%/);assert.match(focused,/不发送BGM或音乐文件/);assert.equal(video.audio.tags.length,1);
 assert.match(audioReplyPolicy('说说剧情'),/没有对白也不必说明/);
});
