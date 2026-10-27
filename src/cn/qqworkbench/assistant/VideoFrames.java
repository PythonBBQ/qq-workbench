package cn.qqworkbench.assistant;

import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.net.*;

/** Bounded visual sampling; no audio transcription or claim to watch every frame. */
final class VideoFrames {
    static final long MAX_BYTES=32L*1024*1024;
    static long[] timestamps(long durationMs){
        if(durationMs<=0||durationMs>600000)throw new IllegalArgumentException("仅支持10分钟以内的视频，建议选择短片段");
        int count=(int)Math.min(4,Math.max(1,(durationMs+4999)/5000));long[] values=new long[count];
        for(int i=0;i<count;i++)values[i]=Math.min(durationMs-1,Math.max(0,durationMs*(2L*i+1)/(2L*count)));return values;
    }
    private static JSONObject extract(MediaMetadataRetriever reader)throws Exception{
        String durationText=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
        if(durationText==null)throw new IOException("视频未提供可读取的时长，编码可能不受支持");
        long duration=Long.parseLong(durationText);
        JSONArray frames=new JSONArray();int total=0;
        for(long stamp:timestamps(duration)){
            Bitmap b=reader.getScaledFrameAtTime(stamp*1000,MediaMetadataRetriever.OPTION_CLOSEST,512,512);
            if(b==null)continue;
            try{ByteArrayOutputStream bytes=new ByteArrayOutputStream();b.compress(Bitmap.CompressFormat.JPEG,65,bytes);byte[] data=bytes.toByteArray();total+=data.length;if(total>1500000)throw new IOException("视频抽帧超过大小上限");frames.put(new JSONObject().put("seconds",stamp/1000.0).put("url","data:image/jpeg;base64,"+Base64.encodeToString(data,Base64.NO_WRAP)));}finally{b.recycle();}
        }
        if(frames.length()==0)throw new IOException("无法读取视频画面，文件可能已损坏或编码不支持");
        return new JSONObject().put("durationSeconds",duration/1000.0).put("frames",frames).put("scope","仅抽取代表画面，未读取音轨、字幕或全部视频帧");
    }
    static JSONObject local(Context context,Uri uri)throws Exception{
        File copy=new File(context.getCacheDir(),"video-sample-"+java.util.UUID.randomUUID()+".tmp");
        try(InputStream in=context.getContentResolver().openInputStream(uri)){
            if(in==null)throw new IOException("无法打开视频");copy(in,copy);return file(copy);
        }finally{copy.delete();}
    }
    static void copy(InputStream in,File file)throws Exception{
        try(OutputStream out=new FileOutputStream(file)){long total=0;byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1){total+=n;if(total>MAX_BYTES)throw new IOException("视频超过32MB，请先裁剪短片段");out.write(b,0,n);}}
    }
    static JSONObject file(File file)throws Exception{
        if(file.length()>MAX_BYTES)throw new IOException("视频超过32MB");
        try(MediaMetadataRetriever reader=new MediaMetadataRetriever()){reader.setDataSource(file.getAbsolutePath());return extract(reader);}
    }
    static JSONObject remote(Context context,String value)throws Exception{
        URL url=NativeNetwork.publicUrl(value);String host=url.getHost().toLowerCase(java.util.Locale.ROOT);
        boolean allowed=false;for(String domain:new String[]{"qq.com","qq.com.cn","qpic.cn","gtimg.cn"})if(host.equals(domain)||host.endsWith("."+domain))allowed=true;
        if(!allowed)throw new IOException("QQ视频仅下载腾讯媒体域名；其他视频请在本机选择文件");
        File temporary=new File(context.getCacheDir(),"qq-video-"+java.util.UUID.randomUUID()+".tmp");
        HttpURLConnection c=(HttpURLConnection)url.openConnection();
        try{c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(25000);c.setRequestProperty("Accept","video/*,application/octet-stream");
            if(c.getResponseCode()!=200)throw new IOException("QQ视频暂不可下载");
            if(c.getContentLengthLong()>MAX_BYTES)throw new IOException("QQ视频超过32MB，请发送短片段");
            String type=c.getContentType();if(type!=null&&!type.startsWith("video/")&&!type.startsWith("application/octet-stream"))throw new IOException("链接不是可读取的视频文件");
            try(InputStream in=c.getInputStream()){copy(in,temporary);}return file(temporary);
        }finally{c.disconnect();temporary.delete();}
    }
}
