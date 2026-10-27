package cn.qqworkbench.assistant;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.*;
import java.util.zip.GZIPInputStream;

/** Only build-pinned, signed APK assets. Absolute Linux links are rebased within root. */
public final class TrustedTar {
    private TrustedTar() {}
    static String string(byte[] b, int at, int n) {
        int end=at; while(end<at+n && b[end]!=0)end++;
        return new String(b,at,end-at,StandardCharsets.UTF_8);
    }
    static long number(byte[] b,int at,int n)throws IOException {
        if((b[at]&128)!=0)throw new IOException("Unsupported binary tar size");
        String s=string(b,at,n).trim();
        try{return s.isEmpty()?0:Long.parseLong(s,8);}catch(NumberFormatException e){throw new IOException("Invalid tar number");}
    }
    static void readFully(InputStream in,byte[] b)throws IOException {
        int o=0,k;while(o<b.length){k=in.read(b,o,b.length-o);if(k<0)throw new EOFException("Truncated archive");o+=k;}
    }
    static void drain(InputStream in,long n)throws IOException {
        byte[] b=new byte[32768];while(n>0){int k=in.read(b,0,(int)Math.min(n,b.length));if(k<0)throw new EOFException();n-=k;}
    }
    static Path path(Path root,String name)throws IOException {
        if(name.indexOf('\0')>=0 || name.startsWith("/") || name.contains("\\"))throw new IOException("Invalid tar path");
        Path p=root.resolve(name).normalize();if(!p.startsWith(root))throw new IOException("Archive path escape");return p;
    }
    static void boundary(Path root,Path p)throws IOException {
        File f=p.toFile().getCanonicalFile();if(!f.toPath().startsWith(root))throw new IOException("Archive link escape");
    }
    static void permissions(Path p,int mode)throws IOException {
        StringBuilder s=new StringBuilder();String bits="rwxrwxrwx";
        for(int i=0;i<9;i++)s.append((mode&(1<<(8-i)))!=0?bits.charAt(i):'-');
        try{Files.setPosixFilePermissions(p,PosixFilePermissions.fromString(s.toString()));}
        catch(UnsupportedOperationException e){p.toFile().setExecutable((mode&0111)!=0,false);}
    }
    static Map<String,String> pax(byte[] bytes)throws IOException {
        Map<String,String> r=new HashMap<>();int i=0;
        while(i<bytes.length){int space=i;while(space<bytes.length && bytes[space]!=' ')space++;
            int n;try{n=Integer.parseInt(new String(bytes,i,space-i,StandardCharsets.US_ASCII));}catch(Exception e){throw new IOException("Invalid PAX");}
            if(n<4 || i+n>bytes.length)throw new IOException("Invalid PAX length");
            String v=new String(bytes,space+1,i+n-space-2,StandardCharsets.UTF_8);int eq=v.indexOf('=');
            if(eq>0)r.put(v.substring(0,eq),v.substring(eq+1));i+=n;
        }return r;
    }
    public static void extract(InputStream source,File destination)throws IOException {
        Path root=destination.getCanonicalFile().toPath();Files.createDirectories(root);
        BufferedInputStream raw=new BufferedInputStream(source,131072);raw.mark(2);int a=raw.read(),b=raw.read();raw.reset();
        try(InputStream in=a==31&&b==139?new GZIPInputStream(raw,131072):raw){
            byte[] h=new byte[512],copy=new byte[131072];Map<String,String> global=new HashMap<>(),local=new HashMap<>();
            List<String[]> hard=new ArrayList<>();long total=0;int entries=0;
            while(true){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Archive extraction cancelled");readFully(in,h);boolean zero=true;for(byte v:h)if(v!=0){zero=false;break;}if(zero)break;
                if(++entries>200000)throw new IOException("Too many tar entries");
                long checksum=0;for(int i=0;i<512;i++)checksum+=i>=148&&i<156?32:h[i]&255;
                if(number(h,148,8)!=checksum)throw new IOException("Tar checksum mismatch");
                long size=number(h,124,12);int mode=(int)number(h,100,8);char type=(char)h[156];
                String name=string(h,0,100),prefix=string(h,345,155),link=string(h,157,100);
                if(!prefix.isEmpty())name=prefix+"/"+name;
                if(size>2L*1024*1024*1024 || (total+=size)>6L*1024*1024*1024)throw new IOException("Archive size limit");
                if(type=='x'||type=='g'||type=='L'||type=='K'){
                    if(size>1024*1024)throw new IOException("Tar metadata limit");byte[] v=new byte[(int)size];readFully(in,v);
                    if(type=='x')local.putAll(pax(v));else if(type=='g')global.putAll(pax(v));else local.put(type=='L'?"path":"linkpath",string(v,0,v.length));
                }else{
                    Map<String,String> props=new HashMap<>(global);props.putAll(local);local.clear();
                    name=props.getOrDefault("path",name);link=props.getOrDefault("linkpath",link);
                    Path out=path(root,name);boundary(root,out);long left=size;
                    if(out.equals(root)){drain(in,left);left=0;}
                    else if(type=='5'){Files.createDirectories(out);permissions(out,mode|0700);}
                    else if(type=='2'){
                        Path target=link.startsWith("/")?path(root,link.substring(1)):path(root,root.relativize(out.getParent()).resolve(link).toString().replace('\\','/'));
                        Files.createDirectories(out.getParent());Files.deleteIfExists(out);Files.createSymbolicLink(out,out.getParent().relativize(target));
                    }else if(type=='1'){hard.add(new String[]{name,link});}
                    else if(type=='0'||type==0){
                        Files.createDirectories(out.getParent());boundary(root,out);
                        try(OutputStream f=Files.newOutputStream(out)){while(left>0){int k=in.read(copy,0,(int)Math.min(left,copy.length));if(k<0)throw new EOFException();f.write(copy,0,k);left-=k;}}
                        permissions(out,mode);
                    }
                    if(left>0)drain(in,left);
                }
                drain(in,(512-size%512)%512);
            }
            for(String[] link:hard){Path out=path(root,link[0]),target=path(root,link[1]);boundary(root,out);boundary(root,target);Files.createDirectories(out.getParent());
                // Android SELinux may deny hardlink(); copying preserves executable content.
                Files.copy(target,out,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.COPY_ATTRIBUTES);
            }
        }
    }
}
