package cn.qqworkbench.assistant;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Download publisher-provided synthetic references on explicit user selection. */
final class FeiyuReferences {
    static void checked(byte[] data,JSONObject record)throws Exception{
        if(data.length!=record.getInt("bytes")||data.length>2*1024*1024)throw new IOException("肥鱼参考大小校验失败");
        StringBuilder hash=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(data))hash.append(String.format(Locale.ROOT,"%02x",b&255));
        if(!hash.toString().equals(record.getString("sha256")))throw new IOException("肥鱼参考校验失败，请重试");
    }
    static URL allowed(String value)throws Exception{
        URI u=new URI(value);String h=u.getHost();if(!"https".equals(u.getScheme())||h==null||u.getRawUserInfo()!=null||u.getPort()!=-1||!(h.equals("huggingface.co")||h.endsWith(".huggingface.co")||h.endsWith(".hf.co")))throw new IOException("肥鱼参考来源无效");return NativeNetwork.publicUrl(value);
    }
    private static File obtain(Context context,String style,JSONObject record)throws Exception{
        File dir=new File(context.getFilesDir(),"voice-reference-downloads");dir.mkdirs();
        File target=new File(dir,"feiyu-"+style+"-"+record.getString("sha256").substring(0,12)+".wav");
        if(target.isFile())try{checked(Files.readAllBytes(target.toPath()),record);return target;}catch(Exception ignored){}
        URL url=allowed(record.getString("url"));long deadline=android.os.SystemClock.elapsedRealtime()+60000;
        for(int redirects=0;redirects<6;redirects++){
            HttpURLConnection c=(HttpURLConnection)url.openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(15000);c.setRequestProperty("User-Agent","QQWorkbench-VoiceReferences");
            try{int code=c.getResponseCode();if(code>=300&&code<400){url=allowed(new URL(url,c.getHeaderField("Location")).toString());continue;}if(code!=200)throw new IOException("肥鱼参考下载未完成，请检查网络后重试");byte[] data;
                try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1){if(Thread.currentThread().isInterrupted()||android.os.SystemClock.elapsedRealtime()>deadline)throw new IOException("肥鱼参考下载超时");if(out.size()+n>record.getInt("bytes"))throw new IOException("肥鱼参考超过预期大小");out.write(b,0,n);}data=out.toByteArray();}
                checked(data,record);File temporary=File.createTempFile("feiyu-",".partial",dir);try{Files.write(temporary.toPath(),data);Files.move(temporary.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);}finally{temporary.delete();}return target;
            }finally{c.disconnect();}
        }throw new IOException("肥鱼参考跳转过多");
    }
    private static VoiceAudio gentle(File file)throws Exception{
        // The pinned N10 is 10.020 s, ending in 20 ms of near-silent PCM.
        // Trim only that verified tail to the normal 10 s import limit.
        byte[] raw=Files.readAllBytes(file.toPath());java.nio.ByteBuffer h=java.nio.ByteBuffer.wrap(raw).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        if(raw.length!=801644||h.getShort(20)!=1||h.getShort(22)!=1||h.getInt(24)!=40000||h.getShort(34)!=16||!new String(raw,36,4,"US-ASCII").equals("data"))throw new IOException("肥鱼温柔参考格式不匹配");
        for(int i=800044;i+1<raw.length;i+=2)if(Math.abs((int)h.getShort(i))>32)throw new IOException("肥鱼参考尾部有人声，未裁剪");
        return VoiceAudio.pcm(Arrays.copyOfRange(raw,44,800044),40000,1,android.media.AudioFormat.ENCODING_PCM_16BIT);
    }
    static JSONObject install(Context context,int slot)throws Exception{
        LocalVoice.slot(slot);JSONObject lock;try(InputStream in=context.getAssets().open("feiyu-references.json")){lock=new JSONObject(new String(LocalVoice.read(in,16384),StandardCharsets.UTF_8));}
        JSONObject records=lock.getJSONObject("references"),cute=records.getJSONObject("cute"),gentle=records.getJSONObject("gentle");
        VoiceAudio a=VoiceAudio.decode(obtain(context,"cute",cute)),b=gentle(obtain(context,"gentle",gentle));
        LocalVoice voice=LocalVoice.get(context);voice.saveReference(slot,"neutral",a,cute.getString("text"),"feiyu-cute");voice.saveReference(slot,"gentle",b,gentle.getString("text"),"feiyu-gentle");
        return voice.state(slot);
    }
}
