package cn.qqworkbench.assistant;

import org.json.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

/** Exact signed-APK reconstruction. No code or assets are loaded from the patch. */
final class ApkPatch {
    static final long LIMIT=1900L*1024*1024;
    static String sha(File file)throws Exception{MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[131072];int n;while((n=in.read(b))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();digest.update(b,0,n);}}StringBuilder h=new StringBuilder();for(byte b:digest.digest())h.append(String.format(Locale.ROOT,"%02x",b&255));return h.toString();}
    static long integer(JSONObject obj,String key)throws Exception{Object v=obj.get(key);if(!(v instanceof Integer)&&!(v instanceof Long))throw new IOException("补丁整数无效");return ((Number)v).longValue();}
    static byte[] manifest(ZipFile zip)throws Exception{ZipEntry entry=zip.getEntry("manifest.json");if(entry==null||entry.getSize()<2||entry.getSize()>4*1024*1024)throw new IOException("补丁清单无效");try(InputStream in=zip.getInputStream(entry);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>4*1024*1024)throw new IOException("补丁清单过大");out.write(b,0,n);}return out.toByteArray();}}
    static void apply(File base,File patch,File output,String version)throws Exception{
        if(output.getCanonicalPath().equals(base.getCanonicalPath())||output.getCanonicalPath().equals(patch.getCanonicalPath()))throw new IOException("补丁输出路径无效");
        boolean complete=false;
        try(ZipFile zip=new ZipFile(patch)){
            if(zip.size()!=2||zip.getEntry("payload.bin")==null)throw new IOException("补丁内容无效");
            JSONObject m=new JSONObject(new String(manifest(zip),"UTF-8"));
            if(m.getInt("schema")!=1||!m.getString("format").equals("qqwb-apk-delta-v1")||!m.getString("version").equals(version))throw new IOException("补丁版本不一致");
            long size=integer(m,"targetBytes"),payloadSize=integer(m,"payloadBytes");
            if(size<=0||size>LIMIT||payloadSize<0||payloadSize>size||zip.getEntry("payload.bin").getSize()!=payloadSize)throw new IOException("补丁大小无效");
            if(base.length()!=integer(m,"baseBytes")||!sha(base).equals(m.getString("baseSha256")))throw new IOException("当前安装包与补丁基础不一致，请选择对应版本的补丁");
            if(output.getParentFile().getUsableSpace()<size+64L*1024*1024)throw new IOException("补丁重建空间不足");
            JSONArray ops=m.getJSONArray("ops");if(ops.length()==0||ops.length()>100000)throw new IOException("补丁步骤无效");
            long total=0,literals=0;byte[] b=new byte[131072];
            try(RandomAccessFile old=new RandomAccessFile(base,"r");InputStream payload=zip.getInputStream(zip.getEntry("payload.bin"));FileOutputStream out=new FileOutputStream(output)){
                for(int i=0;i<ops.length();i++){
                    JSONObject op=ops.getJSONObject(i);long length=integer(op,"length");String kind=op.getString("kind");if(length<=0||length>size-total)throw new IOException("补丁步骤长度无效");
                    boolean copy=kind.equals("copy");if(copy){long offset=integer(op,"offset");if(offset<0||offset>base.length()||length>base.length()-offset)throw new IOException("补丁复制越界");old.seek(offset);}else if(kind.equals("data")){if(length>payloadSize-literals)throw new IOException("补丁数据越界");literals+=length;}else throw new IOException("补丁步骤无效");
                    total+=length;while(length>0){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();int n=copy?old.read(b,0,(int)Math.min(length,b.length)):payload.read(b,0,(int)Math.min(length,b.length));if(n<0)throw new IOException("补丁数据不完整");out.write(b,0,n);length-=n;}
                }
                if(total!=size||literals!=payloadSize||payload.read()!=-1)throw new IOException("补丁长度不一致");out.getFD().sync();
            }
            if(!sha(output).equals(m.getString("targetSha256")))throw new IOException("重建安装包校验失败");complete=true;
        }finally{if(!complete)output.delete();}
    }
}
