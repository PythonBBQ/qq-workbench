package cn.qqworkbench.assistant;
public final class VoiceAudioCheck {
    static void check(boolean good){if(!good)throw new AssertionError();}
    public static void main(String[] args)throws Exception{
        float[] wave=new float[24000];for(int n=0;n<wave.length;n++)wave[n]=(float)(.2*Math.sin(n*.12));
        byte[] wav=VoiceAudio.wav(wave,24000);java.io.File f=java.io.File.createTempFile("voice-audio-",".wav",new java.io.File("/data/local/tmp"));try{java.nio.file.Files.write(f.toPath(),wav);VoiceAudio decoded=VoiceAudio.decode(f);check(decoded.rate==24000&&decoded.samples.length==wave.length);check(Math.abs(decoded.samples[200]-wave[200])<.001);}finally{f.delete();}
        boolean rejected=false;try{VoiceAudio.pcm(new byte[48000],24000,1,android.media.AudioFormat.ENCODING_PCM_16BIT);}catch(java.io.IOException e){rejected=true;}check(rejected);
        rejected=false;try{VoiceAudio.wav(new float[]{Float.NaN},24000);}catch(java.io.IOException e){rejected=true;}check(rejected);
        String longSpeech="第一句话保留完整的意思和标点，我们先聊聊今天发生了什么，也不用着急一次说完，慢慢来就好。第二句话继续承接刚刚的话题，有必要时再补充细节。最后才自然结束这段对话，不刻意加口头禅，也不反复叫对方名字。";
        java.util.List<String> phrases=SpeechPhrasing.chunks(longSpeech,true);check(phrases.size()>=4);check(String.join("",phrases).equals(longSpeech));for(String phrase:phrases)check(phrase.length()>=16&&phrase.length()<=SpeechPhrasing.SOFT_MAX);
        check(SpeechPhrasing.chunks("version 1.25，保留（可选）。",true).size()==1);check(SpeechPhrasing.chunks(longSpeech,false).size()==1);
        // These plans must already be short before any native inference has run.
        String slow="先别着急，我们把最重要的一件事做好。剩下的可以慢慢来，不用一下子把所有事情都扛在自己身上。你刚刚已经说得很清楚了，我会认真听，也会记住你想要的表达方式。等你休息好了，我们再一起想想下一步，今天先照顾好自己。";
        java.util.List<String> planned=SpeechPhrasing.chunks(slow,true);check(planned.size()>4);check(String.join("",planned).equals(slow));for(String p:planned)check(p.length()<=32);
        for(String input:new String[]{"先检查版本0.1.42和数值1,234.56，再检查12:30的安排，最后一起确认结果。","The current model is Qwen3-TTS v0.6, and the next step is checking accuracy.","先检查（括号里的完整说明，不能切开这个部分）然后继续说明接下来的事情。","这是一段没有任何安全分隔符也没有标点的中文文字必须完整保留而不能按字数硬切成半个词","这是没有标点的一段较长说明然后我们继续完成接下来的工作但是不应该漏掉后面的内容🙂"}){
            java.util.List<String> p=SpeechPhrasing.chunks(input,true);check(String.join("",p).equals(input));for(String s:p){check(!s.isEmpty());check(!Character.isLowSurrogate(s.charAt(0)));check(!Character.isHighSurrogate(s.charAt(s.length()-1)));}for(String token:new String[]{"0.1.42","1,234.56","12:30","Qwen3-TTS","v0.6"})if(input.contains(token)){boolean retained=false;for(String s:p)if(s.contains(token))retained=true;check(retained);}
        }
        check(SpeechPhrasing.pause("慢慢来，",24000)<SpeechPhrasing.pause("慢慢来。",24000));
        float[] loud=wave.clone();for(int i=0;i<loud.length;i++)loud[i]*=6;float[] smooth=SpeechPhrasing.finish(loud,24000);float peak=0;for(float x:smooth)peak=Math.max(peak,Math.abs(x));check(peak<=.971&&smooth[0]==0&&smooth[smooth.length-1]==0);check(SpeechPhrasing.join(java.util.Arrays.asList(smooth,smooth),java.util.Arrays.asList("好。","好。"),24000).length==smooth.length*2+5760);
        SpeechPhrasing.validateDuration("你好，先休息一下。",24000,24000);rejected=false;try{SpeechPhrasing.validateDuration("这是一个较长的句子，不能只合成前面两个字。",2400,24000);}catch(java.io.IOException e){rejected=true;}check(rejected);
        check(LocalVoice.slot(0)==0&&LocalVoice.slot(3)==3);rejected=false;try{LocalVoice.slot(4);}catch(java.io.IOException e){rejected=true;}check(rejected);check(LocalVoice.mood("arbitrary").equals("neutral"));check(LocalVoice.StopCallback.class.getMethod("invoke",float[].class).getReturnType()==Integer.class);
        StringBuilder digest=new StringBuilder();for(byte b:java.security.MessageDigest.getInstance("SHA-256").digest(wav))digest.append(String.format(java.util.Locale.ROOT,"%02x",b&255));org.json.JSONObject reference=new org.json.JSONObject().put("bytes",wav.length).put("sha256",digest.toString());FeiyuReferences.checked(wav,reference);byte[] corrupt=wav.clone();corrupt[44]^=1;rejected=false;try{FeiyuReferences.checked(corrupt,reference);}catch(java.io.IOException expected){rejected=true;}check(rejected);
        for(String url:new String[]{"http://huggingface.co/voice.wav","https://evil.example/voice.wav","https://huggingface.co.evil.example/x.wav","https://u:p@huggingface.co/x.wav"}){rejected=false;try{FeiyuReferences.allowed(url);}catch(java.io.IOException expected){rejected=true;}check(rejected);}
        System.out.println("QQWB_VOICE_AUDIO_OK: bounded PCM/WAV roundtrip, silence and invalid-sample rejection, instance/reference validation");
    }
}
