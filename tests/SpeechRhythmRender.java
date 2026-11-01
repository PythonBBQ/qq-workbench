package cn.qqworkbench.assistant;
import java.io.*;
import java.nio.*;
import java.nio.file.*;
import java.util.*;
import javax.sound.sampled.*;

/** Desktop A/B renderer using the same production join function as Android. */
public final class SpeechRhythmRender {
    static void write(Path path,float[] values,int rate)throws Exception{
        ByteBuffer b=ByteBuffer.allocate(values.length*2).order(ByteOrder.LITTLE_ENDIAN);
        for(float f:values)b.putShort((short)Math.max(Short.MIN_VALUE,Math.min(Short.MAX_VALUE,Math.round(f*32768))));
        AudioFormat format=new AudioFormat(rate,16,1,true,false);
        try(AudioInputStream in=new AudioInputStream(new ByteArrayInputStream(b.array()),format,values.length)){
            AudioSystem.write(in,AudioFileFormat.Type.WAVE,path.toFile());
        }
    }
    public static void main(String[] args)throws Exception{
        if(args[0].equals("plan")){for(String phrase:SpeechPhrasing.chunks(args[1],true))System.out.println(phrase);return;}
        Path directory=Paths.get(args[0]);List<String> text=Files.readAllLines(directory.resolve("phrases.txt"),java.nio.charset.StandardCharsets.UTF_8);
        List<float[]> chunks=new ArrayList<>();int rate=0;
        for(int i=0;i<text.size();i++){
            try(AudioInputStream in=AudioSystem.getAudioInputStream(directory.resolve("chunk-"+i+".wav").toFile())){
                AudioFormat f=in.getFormat();if(f.getChannels()!=1||f.getSampleSizeInBits()!=16||f.isBigEndian())throw new IOException("Expected PCM16 mono");
                if(rate!=0&&rate!=(int)f.getSampleRate())throw new IOException("Different sample rates");rate=(int)f.getSampleRate();
                byte[] data=in.readAllBytes();ByteBuffer b=ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);float[] samples=new float[data.length/2];for(int j=0;j<samples.length;j++)samples[j]=b.getShort()/32768f;
                chunks.add(SpeechPhrasing.finish(samples,rate));
            }
        }
        int oldLength=0;for(int i=0;i<chunks.size();i++)oldLength+=chunks.get(i).length+(i+1<chunks.size()?SpeechPhrasing.pause(text.get(i),rate):0);
        float[] old=new float[oldLength];int offset=0;
        for(int i=0;i<chunks.size();i++){float[] a=chunks.get(i);System.arraycopy(a,0,old,offset,a.length);offset+=a.length;if(i+1<chunks.size())offset+=SpeechPhrasing.pause(text.get(i),rate);}
        float[] improved=SpeechPhrasing.join(chunks,text,rate);
        write(directory.resolve("old-padding.wav"),old,rate);write(directory.resolve("no-double-padding.wav"),improved,rate);
        System.out.println("{\"segments\":"+chunks.size()+",\"rate\":"+rate+",\"oldSamples\":"+old.length+",\"newSamples\":"+improved.length+",\"removedExtraSilenceMs\":"+((old.length-improved.length)*1000/rate)+",\"speechSamplesUnchanged\":true}");
    }
}
