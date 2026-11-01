package cn.qqworkbench.assistant;
import java.util.*;
import java.io.IOException;
/** Pure waveform regression: keep all source speech; avoid double-padding joins. */
public final class SpeechRhythmCheck {
    static void check(boolean ok){if(!ok)throw new AssertionError();}
    static float[] audio(int rate,int headMs,int tailMs){float[] a=new float[rate];Arrays.fill(a,headMs*rate/1000,a.length-tailMs*rate/1000,.1f);return a;}
    public static void main(String[] args)throws Exception{
        for(int rate:new int[]{16000,24000,48000}){
            float[] a=audio(rate,0,80),b=audio(rate,60,0);
            float[] joined=SpeechPhrasing.join(Arrays.asList(a,b),Arrays.asList("先休息一下。","我陪着你。"),rate);
            // Original 140ms padding + only the missing 100ms yields 240ms total.
            check(joined.length==a.length+b.length+rate/10);
            check(Arrays.equals(Arrays.copyOfRange(joined,0,a.length),a));
            check(Arrays.equals(Arrays.copyOfRange(joined,joined.length-b.length,joined.length),b));
            float[] plain=audio(rate,0,0);
            check(SpeechPhrasing.join(Arrays.asList(plain,plain),Arrays.asList("好。","好。"),rate).length==rate*2+rate*240/1000);
            // Already-long quiet edges get no additional gap, and are never cut.
            float[] c=audio(rate,0,250),d=audio(rate,250,0);
            check(SpeechPhrasing.join(Arrays.asList(c,d),Arrays.asList("你好，","慢慢来。"),rate).length==rate*2);
            float[] noise=audio(rate,0,0);Arrays.fill(noise,noise.length-rate/10,noise.length,.0001f);
            check(SpeechPhrasing.quietEdge(noise,rate,false)==rate/10);
            // A soft voiced onset is retained and must not be labelled quiet.
            Arrays.fill(noise,0,rate/10,.002f);check(SpeechPhrasing.quietEdge(noise,rate,true)==0);
            float[] one=SpeechPhrasing.join(Arrays.asList(a),Arrays.asList("你好。"),rate);check(Arrays.equals(a,one));
        }
        boolean rejected=false;try{SpeechPhrasing.join(Arrays.asList(new float[4]),Collections.emptyList(),24000);}catch(IOException e){rejected=true;}check(rejected);
        rejected=false;try{SpeechPhrasing.join(Collections.emptyList(),Collections.emptyList(),24000);}catch(IOException e){rejected=true;}check(rejected);
        System.out.println("QQWB_SPEECH_RHYTHM_OK: 3 rates, quiet/noisy padding, soft onset, full sample preservation and no duplicate silence");
    }
}
