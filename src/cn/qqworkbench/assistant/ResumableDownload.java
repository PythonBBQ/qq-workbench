package cn.qqworkbench.assistant;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.regex.*;

/** Bounded HTTP Range downloads. The caller validates every destination and the APK. */
final class ResumableDownload {
    interface ConnectionFactory{HttpURLConnection open(URL url)throws Exception;}
    interface Progress{void update(String phase,long received,long total);boolean cancelled();}
    static final Progress NONE=new Progress(){public void update(String p,long n,long t){}public boolean cancelled(){return false;}};
    static final class InvalidDownload extends IOException{InvalidDownload(String message){super(message);}}
    static void check(Progress p)throws InterruptedIOException{if(p.cancelled()||Thread.currentThread().isInterrupted())throw new InterruptedIOException("下载已暂停，已保留进度");}
    static File part(File dir){return new File(dir,"download.part");}
    static File meta(File dir){return new File(dir,"download.json");}
    static void clear(File dir){part(dir).delete();meta(dir).delete();}
    static String key(JSONObject release)throws Exception{return release.getString("url")+"\n"+release.getString("digest")+"\n"+release.getLong("bytes");}
    static boolean rangeMatches(String value,long offset,long size){if(value==null)return false;Matcher m=Pattern.compile("bytes ([0-9]+)-([0-9]+)/([0-9]+)").matcher(value);if(!m.matches())return false;try{long a=Long.parseLong(m.group(1)),b=Long.parseLong(m.group(2)),total=Long.parseLong(m.group(3));return a==offset&&b>=a&&b<size&&total==size;}catch(NumberFormatException e){return false;}}
    static File fetch(File dir,JSONObject release,ConnectionFactory factory,Progress progress)throws Exception{
        long size=release.getLong("bytes");String digest=release.getString("digest");if(size<=0||size>ApkPatch.LIMIT||!digest.matches("sha256:[a-f0-9]{64}"))throw new IOException("更新包大小或校验值无效");
        dir.mkdirs();File part=part(dir),meta=meta(dir);String key=key(release),saved="";if(meta.isFile()&&meta.length()<8192)saved=new String(Files.readAllBytes(meta.toPath()),StandardCharsets.UTF_8);if(!saved.equals(key)||part.length()>size){clear(dir);Files.write(meta.toPath(),key.getBytes(StandardCharsets.UTF_8));}
        if(dir.getUsableSpace()<size-part.length()+64L*1024*1024)throw new IOException("下载空间不足，已保留现有进度");
        try{
            IOException problem=null;
            for(int attempt=0;attempt<3&&part.length()<size;attempt++){
                check(progress);long offset=part.length();progress.update(attempt==0?"downloading":"retrying",offset,size);URL url=new URL(release.getString("url"));
                try{
                    boolean complete=false;
                    for(int hops=0;hops<6;hops++){
                        check(progress);HttpURLConnection c=factory.open(url);c.setRequestProperty("Accept","application/octet-stream");c.setRequestProperty("Accept-Encoding","identity");if(offset>0)c.setRequestProperty("Range","bytes="+offset+"-");
                        try{
                            int status=c.getResponseCode();if(status>=300&&status<400){String location=c.getHeaderField("Location");if(location==null)throw new InvalidDownload("更新地址跳转无效");url=new URL(url,location);continue;}
                            if(status!=200&&status!=206){if(status==429||status>=500)throw new IOException("更新服务器暂不可用（"+status+"），进度已保留");throw new InvalidDownload("更新下载失败（"+status+"）");}
                            if(status==206&&!rangeMatches(c.getHeaderField("Content-Range"),offset,size))throw new InvalidDownload("服务器返回的续传范围不匹配，进度已保留");
                            // A server without Range support restarts this file instead of appending twice.
                            if(status==200)offset=0;
                            long length=c.getContentLengthLong();if(length>size-offset)throw new InvalidDownload("更新包超过预期大小");
                            long count=offset;progress.update("downloading",count,size);
                            try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(part,offset>0)){
                                byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){check(progress);if(n>size-count)throw new InvalidDownload("更新包超过预期大小");out.write(b,0,n);count+=n;progress.update("downloading",count,size);}out.getFD().sync();
                            }
                            if(count!=size)throw new EOFException("下载中断，进度已保留");complete=true;break;
                        }finally{c.disconnect();}
                    }
                    if(!complete)throw new InvalidDownload("更新下载跳转过多");
                }catch(InvalidDownload e){throw e;}catch(IOException e){problem=e;check(progress);if(attempt<2){progress.update("retrying",part.length(),size);Thread.sleep((attempt+1)*1000L);}}
            }
            check(progress);if(part.length()!=size)throw problem==null?new IOException("下载未完成，进度已保留"):problem;
            progress.update("verifying",size,size);String actual=ApkPatch.sha(part);check(progress);
            if(!digest.equals("sha256:"+actual)){clear(dir);throw new InvalidDownload("更新包校验失败，已清除损坏缓存，请重新下载");}
            return part;
        }catch(InterruptedException e){Thread.currentThread().interrupt();throw new InterruptedIOException("下载已暂停，已保留进度");}
    }
}
