package cn.qqworkbench.assistant;

import java.io.IOException;
import java.util.*;

/** Plan short phrases before inference. Preserve words, numbers and the full input. */
final class SpeechPhrasing {
    // Tablet calibration: 7/14/18/31/45 characters, twice at 8 steps, slow rate.
    // 18 characters had the most consistent transcript among the short samples.
    static final int TARGET=18,MIN=16,SOFT_MAX=32;
    static List<String> chunks(String text,boolean natural){
        List<String> out=new ArrayList<>();if(!natural||text.length()<=24){out.add(text);return out;}
        SortedMap<Integer,Integer> points=new TreeMap<>();int depth=0;boolean quote=false;
        for(int i=0;i<text.length();i++){
            char c=text.charAt(i);
            if("（([{【“「『".indexOf(c)>=0){depth++;continue;}
            if("）)]}】”」』".indexOf(c)>=0){depth=Math.max(0,depth-1);continue;}
            if(c=='"'){quote=!quote;continue;}if(depth>0||quote)continue;
            boolean strong="。！？!?；;\n".indexOf(c)>=0||c=='.'&&(i+1==text.length()||Character.isWhitespace(text.charAt(i+1)));
            boolean weak="，,：:".indexOf(c)>=0&&!(i>0&&i+1<text.length()&&Character.isDigit(text.charAt(i-1))&&Character.isDigit(text.charAt(i+1)));
            if(strong||weak){int end=i+1;while(end<text.length()&&Character.isWhitespace(text.charAt(end)))end++;points.put(end,strong?2:1);}
            // Natural clause starts also help unpunctuated Chinese; never split inside a token.
            if(i>0)for(String word:new String[]{"然后","但是","不过","所以","另外","接下来","同时","也可以","你可以","不用"})if(text.startsWith(word,i))points.putIfAbsent(i,0);
            // English may use word boundaries, but decimal/version/identifier tokens stay intact.
            if(Character.isWhitespace(c)&&i>0&&i+1<text.length()&&asciiLetter(text.charAt(i-1))&&asciiLetter(text.charAt(i+1)))points.put(i+1,0);
        }
        points.put(text.length(),2);int start=0;
        while(start<text.length()){
            if(text.length()-start<=24){out.add(text.substring(start));break;}
            int chosen=-1,best=Integer.MAX_VALUE;
            for(Map.Entry<Integer,Integer> p:points.entrySet()){
                int end=p.getKey(),length=end-start,tail=text.length()-end;
                if(length<MIN||length>SOFT_MAX||tail>0&&tail<MIN)continue;
                int score=Math.abs(length-TARGET)*4-p.getValue()*3;
                if(score<best){best=score;chosen=end;}
            }
            // With no safe short boundary, keep the long phrase intact rather than cut a word.
            if(chosen<0)for(int end:points.keySet())if(end-start>=MIN&&(text.length()-end==0||text.length()-end>=MIN)){chosen=end;break;}
            if(chosen<0)chosen=text.length();out.add(text.substring(start,chosen));start=chosen;
        }
        return out;
    }
    static boolean asciiLetter(char c){return c>='a'&&c<='z'||c>='A'&&c<='Z';}
    static float[] finish(float[] source,int rate)throws IOException{
        if(rate<8000||rate>96000||source.length==0||source.length>rate*100)throw new IOException("语音输出无效或过长");
        float peak=0;for(float x:source){if(!Float.isFinite(x))throw new IOException("语音输出包含无效采样");peak=Math.max(peak,Math.abs(x));}
        if(peak<.0001f)throw new IOException("语音输出没有可听内容");
        int start=0,end=source.length,edge=Math.min(rate/3,source.length/4),padding=rate/25;
        while(start<edge&&Math.abs(source[start])<.0005f)start++;
        while(source.length-end<edge&&end>start&&Math.abs(source[end-1])<.0005f)end--;
        start=Math.max(0,start-padding);end=Math.min(source.length,end+padding);
        float gain=peak>.97f?.97f/peak:1;float[] output=Arrays.copyOfRange(source,start,end);
        // Short fades avoid clicks at joins; never alter pitch or add synthetic breaths.
        int fade=Math.min(rate/250,output.length/4);
        for(int i=0;i<output.length;i++){float envelope=i<fade?i/(float)fade:i>=output.length-fade?(output.length-1-i)/(float)fade:1;output[i]*=gain*envelope;}
        return output;
    }
    static void validateDuration(String text,int samples,int rate)throws IOException{
        if(rate<8000||rate>96000||samples<=0)throw new IOException("语音片段没有完整返回");
        int units=0;boolean latin=false;for(int i=0;i<text.length();i++){char c=text.charAt(i);if(Character.UnicodeScript.of(c)==Character.UnicodeScript.HAN){units++;latin=false;}else if(Character.isLetterOrDigit(c)){if(!latin)units++;latin=true;}else latin=false;}
        // A coarse guard against empty/almost-empty chunks, not a transcript guarantee.
        if(samples/(double)rate<Math.max(.22,units/14.0))throw new IOException("语音片段时长异常，可能不完整，本条使用文字");
    }
    static float[] join(List<float[]> parts,List<String> text,int rate)throws IOException{
        long length=0;for(int i=0;i<parts.size();i++)length+=parts.get(i).length+(i+1<parts.size()?pause(text.get(i),rate):0);
        if(length<=0||length>rate*100L)throw new IOException("语音输出过长");float[] result=new float[(int)length];int offset=0;
        for(int i=0;i<parts.size();i++){float[] samples=parts.get(i);System.arraycopy(samples,0,result,offset,samples.length);offset+=samples.length;if(i+1<parts.size())offset+=pause(text.get(i),rate);}return result;
    }
    static int pause(String text,int rate){String s=text.trim();return rate*(s.endsWith("，")||s.endsWith(",")?100:s.endsWith("：")||s.endsWith(":")?140:s.endsWith("；")||s.endsWith(";")?180:s.endsWith("？")||s.endsWith("?")?220:s.endsWith("！")||s.endsWith("!")?180:s.endsWith("。")||s.endsWith(".")?240:80)/1000;}
}
