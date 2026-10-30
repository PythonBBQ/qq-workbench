import {test} from 'node:test';import assert from 'node:assert/strict';
import {transcriptObjects,compactTranscript,audioContext,withAudio,AUDIO_POLICY} from '../assets/video-audio.mjs';
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
 const missing=withAudio(sampledVideo(data),{status:'no-audio'});assert.match(missing.scope,/没有可用声音/);assert.equal(missing.audioText,'');
});
