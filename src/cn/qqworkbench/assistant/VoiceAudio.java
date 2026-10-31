package cn.qqworkbench.assistant;

import android.media.*;
import java.io.*;
import java.nio.*;

/** Bounded reference decoding. Imported audio stays inside the application. */
final class VoiceAudio {
    final float[] samples;final int rate;
    VoiceAudio(float[] samples,int rate){this.samples=samples;this.rate=rate;}
    static VoiceAudio pcm(byte[] bytes,int rate,int channels,int encoding)throws IOException{
        int width=encoding==AudioFormat.ENCODING_PCM_FLOAT?4:2;
        if(rate<8000||rate>96000||channels<1||channels>8||bytes.length%(width*channels)!=0)throw new IOException("语音参考音频格式不支持");
        int frames=bytes.length/(width*channels);if(frames<rate||frames>rate*10)throw new IOException("语音参考请选择1到10秒的清晰片段，并填写完全对应的文字");
        ByteBuffer in=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);float[] samples=new float[frames];double energy=0;
        for(int i=0;i<frames;i++){float value=0;for(int c=0;c<channels;c++){float x=width==4?in.getFloat():in.getShort()/32768f;if(!Float.isFinite(x))throw new IOException("语音参考包含无效采样");value+=x/channels;}samples[i]=Math.max(-1,Math.min(1,value));energy+=value*value;}
        if(energy/frames<.00000001)throw new IOException("语音参考几乎没有人声，请更换片段");return new VoiceAudio(samples,rate);
    }
    static VoiceAudio decode(File file)throws Exception{
        try(RandomAccessFile in=new RandomAccessFile(file,"r")){
            if(in.length()>12*1024*1024)throw new IOException("语音参考文件不能超过12MB");
            byte[] header=new byte[12];in.readFully(header);
            if(new String(header,0,4,"US-ASCII").equals("RIFF")&&new String(header,8,4,"US-ASCII").equals("WAVE")){
                int format=0,channels=0,rate=0,bits=0;byte[] data=null;
                while(in.getFilePointer()+8<=in.length()){byte[] chunk=new byte[8];in.readFully(chunk);String name=new String(chunk,0,4,"US-ASCII");long size=Integer.toUnsignedLong(ByteBuffer.wrap(chunk,4,4).order(ByteOrder.LITTLE_ENDIAN).getInt()),start=in.getFilePointer();if(size>12*1024*1024||start+size>in.length())throw new IOException("语音WAV文件不完整");
                    if(name.equals("fmt ")&&size>=16){byte[] fmt=new byte[16];in.readFully(fmt);ByteBuffer b=ByteBuffer.wrap(fmt).order(ByteOrder.LITTLE_ENDIAN);format=b.getShort();channels=b.getShort();rate=b.getInt();b.getInt();b.getShort();bits=b.getShort();}
                    if(name.equals("data")){data=new byte[(int)size];in.readFully(data);}in.seek(start+size+(size&1));
                }
                if(data!=null&&(format==1&&bits==16||format==3&&bits==32))return pcm(data,rate,channels,format==3?AudioFormat.ENCODING_PCM_FLOAT:AudioFormat.ENCODING_PCM_16BIT);
            }
        }
        MediaExtractor extractor=new MediaExtractor();MediaCodec codec=null;
        try{extractor.setDataSource(file.getAbsolutePath());MediaFormat format=null;
            for(int i=0;i<extractor.getTrackCount();i++){MediaFormat f=extractor.getTrackFormat(i);if(f.getString(MediaFormat.KEY_MIME).startsWith("audio/")){format=f;extractor.selectTrack(i);break;}}
            if(format==null)throw new IOException("语音文件没有音轨");
            codec=MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));codec.configure(format,null,null,0);codec.start();
            int rate=format.getInteger(MediaFormat.KEY_SAMPLE_RATE),channels=format.getInteger(MediaFormat.KEY_CHANNEL_COUNT),encoding=AudioFormat.ENCODING_PCM_16BIT;boolean ended=false,finished=false;long deadline=System.currentTimeMillis()+20000;ByteArrayOutputStream out=new ByteArrayOutputStream();MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
            while(!finished&&System.currentTimeMillis()<deadline){if(!ended){int n=codec.dequeueInputBuffer(10000);if(n>=0){ByteBuffer b=codec.getInputBuffer(n);int count=extractor.readSampleData(b,0);if(count<0){codec.queueInputBuffer(n,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);ended=true;}else{codec.queueInputBuffer(n,0,count,extractor.getSampleTime(),0);extractor.advance();}}}
                int n=codec.dequeueOutputBuffer(info,10000);if(n==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){MediaFormat f=codec.getOutputFormat();rate=f.getInteger(MediaFormat.KEY_SAMPLE_RATE);channels=f.getInteger(MediaFormat.KEY_CHANNEL_COUNT);encoding=f.containsKey(MediaFormat.KEY_PCM_ENCODING)?f.getInteger(MediaFormat.KEY_PCM_ENCODING):AudioFormat.ENCODING_PCM_16BIT;}
                else if(n>=0){ByteBuffer b=codec.getOutputBuffer(n);if(info.size>0){if(out.size()+info.size>8*1024*1024)throw new IOException("语音参考过长，请选择10秒以内片段");byte[] data=new byte[info.size];b.position(info.offset);b.get(data);out.write(data);}finished=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;codec.releaseOutputBuffer(n,false);}}
            if(!finished)throw new IOException("语音参考解码超时");if(encoding!=AudioFormat.ENCODING_PCM_16BIT&&encoding!=AudioFormat.ENCODING_PCM_FLOAT)throw new IOException("语音参考采样格式不支持");return pcm(out.toByteArray(),rate,channels,encoding);
        }finally{if(codec!=null){try{codec.stop();}catch(Exception ignored){}codec.release();}extractor.release();}
    }
    static byte[] wav(float[] samples,int rate)throws IOException{
        if(rate<8000||rate>96000||samples.length==0||samples.length>rate*100)throw new IOException("语音输出无效或过长");
        ByteBuffer b=ByteBuffer.allocate(44+samples.length*2).order(ByteOrder.LITTLE_ENDIAN);b.put("RIFF".getBytes("US-ASCII")).putInt(36+samples.length*2).put("WAVEfmt ".getBytes("US-ASCII")).putInt(16).putShort((short)1).putShort((short)1).putInt(rate).putInt(rate*2).putShort((short)2).putShort((short)16).put("data".getBytes("US-ASCII")).putInt(samples.length*2);
        for(float x:samples){if(!Float.isFinite(x))throw new IOException("语音输出包含无效采样");b.putShort((short)(Math.max(-1,Math.min(1,x))*32767));}return b.array();
    }
}
