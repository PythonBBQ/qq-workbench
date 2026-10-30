package cn.qqworkbench.assistant;
import android.media.*;
import java.io.*;
import java.nio.ByteBuffer;
import org.json.*;
public final class VideoFramesCheck {
    static void check(boolean value){if(!value)throw new AssertionError();}
    static void synthetic(File file)throws Exception{
        MediaCodec encoder=MediaCodec.createByCodecName("c2.android.avc.encoder");MediaMuxer muxer=new MediaMuxer(file.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
        boolean muxing=false;int track=-1,frame=0;MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
        try{MediaFormat format=MediaFormat.createVideoFormat("video/avc",64,64);format.setInteger(MediaFormat.KEY_COLOR_FORMAT,MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible);format.setInteger(MediaFormat.KEY_BIT_RATE,64000);format.setInteger(MediaFormat.KEY_FRAME_RATE,10);format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL,1);encoder.configure(format,null,null,MediaCodec.CONFIGURE_FLAG_ENCODE);encoder.start();
            boolean done=false;long deadline=System.nanoTime()+15000000000L;
            while(!done&&System.nanoTime()<deadline){
                if(frame<=20){int index=encoder.dequeueInputBuffer(10000);if(index>=0){ByteBuffer input=encoder.getInputBuffer(index);input.clear();if(frame==20){encoder.queueInputBuffer(index,0,0,2000000,MediaCodec.BUFFER_FLAG_END_OF_STREAM);}else{byte[] raw=new byte[64*64*3/2];java.util.Arrays.fill(raw,0,64*64,(byte)(frame<10?70:190));java.util.Arrays.fill(raw,64*64,raw.length,(byte)128);input.put(raw);encoder.queueInputBuffer(index,0,raw.length,frame*100000L,0);}frame++;}}
                int output=encoder.dequeueOutputBuffer(info,10000);
                if(output==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){track=muxer.addTrack(encoder.getOutputFormat());muxer.start();muxing=true;}
                else if(output>=0){ByteBuffer buffer=encoder.getOutputBuffer(output);if((info.flags&MediaCodec.BUFFER_FLAG_CODEC_CONFIG)!=0)info.size=0;if(info.size>0){check(muxing);buffer.position(info.offset);buffer.limit(info.offset+info.size);muxer.writeSampleData(track,buffer,info);}done=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;encoder.releaseOutputBuffer(output,false);}
            }check(done);
        }finally{try{encoder.stop();}catch(Exception ignored){}encoder.release();if(muxing)muxer.stop();muxer.release();}
    }
    public static void main(String[] args)throws Exception{
        // A shell app_process has no Application; Xiaomi's media API requires one.
        // Initialize a test-only framework Context, without launching any app UI.
        android.os.Looper.prepareMainLooper();
        Class<?> threadClass=Class.forName("android.app.ActivityThread");
        Object thread=threadClass.getMethod("systemMain").invoke(null);
        android.content.Context context=((android.content.Context)threadClass.getMethod("getSystemContext").invoke(thread)).createPackageContext("com.android.shell",0);
        android.app.Application application=new android.app.Application();
        java.lang.reflect.Method attach=android.app.Application.class.getDeclaredMethod("attach",android.content.Context.class);attach.setAccessible(true);attach.invoke(application,context);
        java.lang.reflect.Field initial=threadClass.getDeclaredField("mInitialApplication");initial.setAccessible(true);initial.set(thread,application);
        check(VideoFrames.timestamps(1000).length==1);check(VideoFrames.timestamps(600000).length==600);
        try{VideoFrames.timestamps(600001);throw new AssertionError();}catch(IllegalArgumentException expected){}
        check(VideoFrames.timestamps(120000).length==120);check(VideoFrames.timestamps(120000)[119]==119000);check(VideoFrames.timestamps(1250).length==2);
        File file=new File(args.length>1?args[1]:"/data/local/tmp/qqwb-video-synthetic.mp4");
        {check(file.isFile());JSONObject sample=VideoFrames.file(file);check(sample.getDouble("durationSeconds")>1);check(sample.getJSONArray("frames").length()==(sample.getInt("frameCount")+7)/8);check(sample.getInt("frameCount")==(int)Math.ceil(sample.getDouble("durationSeconds")));check(sample.getJSONArray("frames").getJSONObject(0).getString("url").startsWith("data:image/jpeg;base64,"));
            System.out.println("QQWB_VIDEO_OK: synthetic AVC clip, real Android metadata/frame decode, JPEG sampling and duration bounds");
            if(args.length>0)try(FileOutputStream out=new FileOutputStream(args[0])){out.write(sample.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}
        }
    }
}
