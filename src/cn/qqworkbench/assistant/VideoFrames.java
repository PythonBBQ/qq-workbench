package cn.qqworkbench.assistant;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
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
        int count=(int)((durationMs+999)/1000);long[] values=new long[count];
        for(int i=0;i<count;i++)values[i]=i*1000L;return values;
    }
    private static JSONObject extract(MediaMetadataRetriever reader)throws Exception{
        String durationText=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
        if(durationText==null)throw new IOException("视频未提供可读取的时长，编码可能不受支持");
        long duration=Long.parseLong(durationText);
        JSONArray frames=new JSONArray();int total=0;long[] stamps=timestamps(duration);long deadline=android.os.SystemClock.elapsedRealtime()+450000;
        Paint paint=new Paint(Paint.FILTER_BITMAP_FLAG);
        for(int start=0;start<stamps.length;start+=8){
            Bitmap sheet=Bitmap.createBitmap(1024,288,Bitmap.Config.RGB_565);
            try{
                Canvas canvas=new Canvas(sheet);canvas.drawColor(Color.BLACK);JSONArray times=new JSONArray();
                for(int j=0;j<8&&start+j<stamps.length;j++){
                    if(android.os.SystemClock.elapsedRealtime()>deadline)throw new IOException("视频解码超时，请选择更短的片段");
                    long stamp=stamps[start+j];Bitmap b=reader.getScaledFrameAtTime(stamp*1000,MediaMetadataRetriever.OPTION_CLOSEST,256,144);
                    if(b==null)throw new IOException("视频画面不完整，请使用兼容解码");
                    try{
                        float scale=Math.min(256f/b.getWidth(),144f/b.getHeight());int w=Math.max(1,Math.round(b.getWidth()*scale)),h=Math.max(1,Math.round(b.getHeight()*scale));
                        int x=j%4*256+(256-w)/2,y=j/4*144+(144-h)/2;
                        canvas.drawBitmap(b,null,new Rect(x,y,x+w,y+h),paint);times.put(stamp/1000);
                    }finally{b.recycle();}
                }
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();if(!sheet.compress(Bitmap.CompressFormat.JPEG,55,bytes))throw new IOException("视频画面压缩失败");
                byte[] data=bytes.toByteArray();total+=data.length;if(total>15000000)throw new IOException("视频压缩画面超过大小上限");
                frames.put(new JSONObject().put("seconds",start).put("timestamps",times).put("url","data:image/jpeg;base64,"+Base64.encodeToString(data,Base64.NO_WRAP)));
            }finally{sheet.recycle();}
        }
        return new JSONObject().put("sampling","1fps-contact-sheet-v1").put("durationSeconds",duration/1000.0).put("sampledSeconds",duration/1000.0).put("frameCount",stamps.length).put("frames",frames);
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
