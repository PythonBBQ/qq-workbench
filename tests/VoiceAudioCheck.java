package cn.qqworkbench.assistant;
public final class VoiceAudioCheck {
    static void check(boolean good){if(!good)throw new AssertionError();}
    public static void main(String[] args)throws Exception{
        float[] wave=new float[24000];for(int n=0;n<wave.length;n++)wave[n]=(float)(.2*Math.sin(n*.12));
        byte[] wav=VoiceAudio.wav(wave,24000);java.io.File f=java.io.File.createTempFile("voice-audio-",".wav",new java.io.File("/data/local/tmp"));try{java.nio.file.Files.write(f.toPath(),wav);VoiceAudio decoded=VoiceAudio.decode(f);check(decoded.rate==24000&&decoded.samples.length==wave.length);check(Math.abs(decoded.samples[200]-wave[200])<.001);}finally{f.delete();}
        boolean rejected=false;try{VoiceAudio.pcm(new byte[48000],24000,1,android.media.AudioFormat.ENCODING_PCM_16BIT);}catch(java.io.IOException e){rejected=true;}check(rejected);
        rejected=false;try{VoiceAudio.wav(new float[]{Float.NaN},24000);}catch(java.io.IOException e){rejected=true;}check(rejected);
        check(LocalVoice.slot(0)==0&&LocalVoice.slot(3)==3);rejected=false;try{LocalVoice.slot(4);}catch(java.io.IOException e){rejected=true;}check(rejected);check(LocalVoice.mood("arbitrary").equals("neutral"));check(LocalVoice.StopCallback.class.getMethod("invoke",float[].class).getReturnType()==Integer.class);
        System.out.println("QQWB_VOICE_AUDIO_OK: bounded PCM/WAV roundtrip, silence and invalid-sample rejection, instance/reference validation");
    }
}
