package cn.qqworkbench.assistant;

import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;

public final class ResumableDownloadCheck {
    static void check(boolean b){if(!b)throw new AssertionError();}
    static byte[] content=new byte[150007];
    static class Reply extends HttpURLConnection {
        final int status;final byte[] body;final String range;final boolean fail;
        Reply(URL u,int status,byte[] b,String range,boolean fail){super(u);this.status=status;this.body=b;this.range=range;this.fail=fail;}
        public void disconnect(){}public boolean usingProxy(){return false;}public void connect(){}public int getResponseCode(){return status;}
        public long getContentLengthLong(){return body.length;}
        public String getHeaderField(String name){return name.equals("Content-Range")?range:null;}
        public InputStream getInputStream(){return new InputStream(){int pos;public int read()throws IOException{byte[] b=new byte[1];return read(b,0,1)<0?-1:b[0]&255;}public int read(byte[] b,int off,int length)throws IOException{if(fail&&pos>=4096)throw new IOException("synthetic network interruption");if(pos==body.length)return -1;int n=Math.min(length,body.length-pos);if(fail)n=Math.min(n,4096-pos);System.arraycopy(body,pos,b,off,n);pos+=n;return n;}};}
    }
    static JSONObject release(File target)throws Exception{return new JSONObject().put("url","https://github.com/PythonBBQ/qq-workbench/releases/download/v9.0.0/test.apk").put("bytes",content.length).put("digest","sha256:"+ApkPatch.sha(target));}
    static void seed(File dir,JSONObject release,int length)throws Exception{dir.mkdirs();Files.write(ResumableDownload.part(dir).toPath(),Arrays.copyOf(content,length));Files.write(ResumableDownload.meta(dir).toPath(),ResumableDownload.key(release).getBytes("UTF-8"));}
    public static void main(String[] args)throws Exception{
        for(int i=0;i<content.length;i++)content[i]=(byte)(i*31+7);File root=new File("/data/local/tmp/qqwb-download-check-"+System.nanoTime());root.mkdirs();File target=new File(root,"expected");Files.write(target.toPath(),content);JSONObject r=release(target);int[] connections={0};
        try{
            // Resume a file left by a previous app process, requesting precisely the missing bytes.
            File first=new File(root,"resume");seed(first,r,4096);
            File out=ResumableDownload.fetch(first,r,url->new Reply(url,206,Arrays.copyOfRange(content,4096,content.length),"bytes 4096-150006/150007",false){public int getResponseCode(){check("bytes=4096-".equals(getRequestProperty("Range")));connections[0]++;return 206;}},ResumableDownload.NONE);
            check(ApkPatch.sha(out).equals(ApkPatch.sha(target))&&connections[0]==1);
            File retry=new File(root,"retry");int[] calls={0};out=ResumableDownload.fetch(retry,r,url->{boolean firstCall=calls[0]++==0;return firstCall?new Reply(url,200,content,null,true):new Reply(url,206,Arrays.copyOfRange(content,4096,content.length),"bytes 4096-150006/150007",false){public int getResponseCode(){check("bytes=4096-".equals(getRequestProperty("Range")));return 206;}};},ResumableDownload.NONE);check(calls[0]==2&&ApkPatch.sha(out).equals(ApkPatch.sha(target)));
            File ignored=new File(root,"no-range");seed(ignored,r,1000);out=ResumableDownload.fetch(ignored,r,url->new Reply(url,200,content,null,false),ResumableDownload.NONE);check(out.length()==content.length&&ApkPatch.sha(out).equals(ApkPatch.sha(target)));
            File wrong=new File(root,"wrong-range");seed(wrong,r,1000);boolean rejected=false;try{ResumableDownload.fetch(wrong,r,url->new Reply(url,206,content,"bytes 0-150006/150007",false),ResumableDownload.NONE);}catch(IOException e){rejected=true;}check(rejected&&ResumableDownload.part(wrong).length()==1000);
            File cancelled=new File(root,"paused");final boolean[] abort={false};rejected=false;
            try{ResumableDownload.fetch(cancelled,r,url->new Reply(url,200,content,null,false),new ResumableDownload.Progress(){public void update(String p,long n,long total){if(n>0&&p.equals("downloading"))abort[0]=true;}public boolean cancelled(){return abort[0];}});}catch(InterruptedIOException e){rejected=true;}
            long offset=ResumableDownload.part(cancelled).length();check(rejected&&offset>0&&offset<content.length);
            final int from=(int)offset;out=ResumableDownload.fetch(cancelled,r,url->new Reply(url,206,Arrays.copyOfRange(content,from,content.length),"bytes "+from+"-150006/150007",false),ResumableDownload.NONE);check(ApkPatch.sha(out).equals(ApkPatch.sha(target)));
            File corrupt=new File(root,"bad-hash");JSONObject bad=new JSONObject(r.toString()).put("digest","sha256:"+String.join("",Collections.nCopies(64,"0")));rejected=false;
            try{ResumableDownload.fetch(corrupt,bad,url->new Reply(url,200,content,null,false),ResumableDownload.NONE);}catch(IOException e){rejected=true;}check(rejected&&!ResumableDownload.part(corrupt).exists()&&!ResumableDownload.meta(corrupt).exists());
            File completed=new File(root,"complete");seed(completed,r,content.length);out=ResumableDownload.fetch(completed,r,url->{throw new AssertionError("Complete file must not be downloaded again");},ResumableDownload.NONE);check(out.length()==content.length);
            File changed=new File(root,"new-release");seed(changed,bad,400);out=ResumableDownload.fetch(changed,r,url->new Reply(url,200,content,null,false){public int getResponseCode(){check(getRequestProperty("Range")==null);return 200;}},ResumableDownload.NONE);check(ApkPatch.sha(out).equals(ApkPatch.sha(target)));
            System.out.println("QQWB_RESUMABLE_DOWNLOAD_OK: restart resume, exact Range, ignored Range restart, bad range, pause/resume, hash failure cleanup, no redownload, stale cache reset");
        }finally{for(File dir:root.listFiles()){if(dir.isDirectory()){for(File file:dir.listFiles())file.delete();}dir.delete();}root.delete();}
    }
}
