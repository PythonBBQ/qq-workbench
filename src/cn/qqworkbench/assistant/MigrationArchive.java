package cn.qqworkbench.assistant;

import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.zip.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.json.*;

/** Versioned password-encrypted container. Never extracts unauthenticated bytes. */
final class MigrationArchive {
    static final long MAX=256L*1024*1024, PER_FILE=64L*1024*1024;
    static final byte[] MAGIC={'Q','Q','W','B','B','K','0','1'};
    static final Set<String> DATA=new HashSet<>(Arrays.asList("settings.json","conversation-memory.json","voice-memory.json","learning-notes.json","group-ignore.json","usage-ledger.json","sticker-label-journal.json"));
    static boolean permitted(String name){
        if(name.equals("settings.json")||name.equals("theme-background.jpg")||name.equals("theme-background-source.jpg"))return true;
        if(name.matches("voice-(?:references|library)/slot-[0-3]/[A-Za-z0-9_.-]{1,100}")&&!name.contains(".."))return true;
        String relative=name.replaceFirst("^linux/rootfs/opt/qq-workbench/","");
        if(relative.equals(name))return false;
        relative=relative.replaceFirst("^instances/slot-[1-3]/","");
        return DATA.contains(relative);
    }
    static File child(File root,String name)throws IOException{
        if(!permitted(name))throw new IOException("备份包含不支持的路径");
        File file=new File(root,name);if(!file.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator))throw new IOException("备份路径越界");
        Path p=file.toPath();while(p!=null&&!p.equals(root.toPath())){if(Files.isSymbolicLink(p))throw new IOException("备份路径不能是符号链接");p=p.getParent();}return file;
    }
    static SecretKeySpec key(char[] password,byte[] salt)throws Exception{
        if(password==null||password.length<8||password.length>256)throw new IOException("备份密码需为 8–256 位");
        PBEKeySpec spec=new PBEKeySpec(password,salt,210000,256);
        try{return new SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(),"AES");}finally{spec.clearPassword();}
    }
    static String digest(File file)throws Exception{MessageDigest d=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)d.update(b,0,n);}StringBuilder s=new StringBuilder();for(byte b:d.digest())s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    static long copy(InputStream in,OutputStream out,long limit)throws IOException{byte[] b=new byte[32768];long total=0;int n;while((n=in.read(b))!=-1){total+=n;if(total>limit)throw new IOException("备份超过容量限制");out.write(b,0,n);}return total;}
    static void write(File root,Map<String,File> files,JSONObject metadata,char[] password,OutputStream target)throws Exception{
        if(files.size()>2000)throw new IOException("备份文件过多");
        JSONObject hashes=new JSONObject();long total=0;
        for(Map.Entry<String,File> item:files.entrySet()){File f=child(root,item.getKey());if(!f.equals(item.getValue())||!f.isFile()||f.length()>PER_FILE)throw new IOException("备份文件不完整或过大");total+=f.length();if(total>MAX)throw new IOException("备份数据超过256MB");hashes.put(item.getKey(),new JSONObject().put("bytes",f.length()).put("sha256",digest(f)));}
        JSONObject manifest=new JSONObject().put("format",1).put("created",System.currentTimeMillis()).put("files",hashes).put("metadata",metadata);
        byte[] salt=new byte[16],iv=new byte[12];SecureRandom random=new SecureRandom();random.nextBytes(salt);random.nextBytes(iv);
        target.write(MAGIC);target.write(salt);target.write(iv);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(password,salt),new GCMParameterSpec(128,iv));cipher.updateAAD(MAGIC);
        try(ZipOutputStream zip=new ZipOutputStream(new CipherOutputStream(target,cipher))){
            zip.putNextEntry(new ZipEntry("manifest.json"));zip.write(manifest.toString().getBytes("UTF-8"));zip.closeEntry();
            for(Map.Entry<String,File> item:files.entrySet()){zip.putNextEntry(new ZipEntry(item.getKey()));try(InputStream in=new FileInputStream(item.getValue())){copy(in,zip,PER_FILE);}zip.closeEntry();}
        }
    }
    static JSONObject read(InputStream source,File stage,char[] password)throws Exception{
        if(stage.exists())throw new IOException("迁移暂存目录已存在");if(!stage.mkdirs())throw new IOException("无法创建迁移暂存");
        try{
            DataInputStream input=new DataInputStream(source);byte[] magic=new byte[8],salt=new byte[16],iv=new byte[12];input.readFully(magic);input.readFully(salt);input.readFully(iv);if(!Arrays.equals(magic,MAGIC))throw new IOException("不是工作台加密备份");
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(password,salt),new GCMParameterSpec(128,iv));cipher.updateAAD(MAGIC);
            File payload=new File(stage,"payload.zip");long count=0;
            try(OutputStream out=new FileOutputStream(payload)){byte[] b=new byte[32768];int n;while((n=input.read(b))!=-1){count+=n;if(count>MAX+8*1024*1024)throw new IOException("备份文件过大");byte[] decoded=cipher.update(b,0,n);if(decoded!=null)out.write(decoded);}out.write(cipher.doFinal());}
            JSONObject manifest;
            try(ZipFile zip=new ZipFile(payload)){
                ZipEntry m=zip.getEntry("manifest.json");if(m==null)throw new IOException("备份清单缺失");ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=zip.getInputStream(m)){copy(in,bytes,2*1024*1024);}manifest=new JSONObject(bytes.toString("UTF-8"));
                if(manifest.getInt("format")!=1)throw new IOException("备份版本不支持");JSONObject hashes=manifest.getJSONObject("files");if(hashes.length()>2000)throw new IOException("备份文件过多");
                Set<String> seen=new HashSet<>();long total=0;Enumeration<? extends ZipEntry> entries=zip.entries();
                while(entries.hasMoreElements()){ZipEntry e=entries.nextElement();String name=e.getName();if(!seen.add(name)||e.isDirectory())throw new IOException("备份路径重复或不规范");if(name.equals("manifest.json"))continue;
                    if(!hashes.has(name))throw new IOException("备份包含清单外文件");File f=child(stage,name);f.getParentFile().mkdirs();JSONObject hash=hashes.getJSONObject(name);long size;
                    try(InputStream in=zip.getInputStream(e);OutputStream out=new FileOutputStream(f)){size=copy(in,out,PER_FILE);}total+=size;if(total>MAX||size!=hash.getLong("bytes")||!digest(f).equals(hash.getString("sha256")))throw new IOException("备份文件校验失败");
                }
                if(seen.size()!=hashes.length()+1)throw new IOException("备份文件缺失");
            }
            Files.delete(payload.toPath());return manifest;
        }catch(Exception e){erase(stage);if(e instanceof AEADBadTagException)throw new IOException("密码不正确或备份已损坏");throw e;}
    }
    static void erase(File file)throws IOException{
        if(Files.isSymbolicLink(file.toPath())){Files.delete(file.toPath());return;}
        File[] children=file.listFiles();if(children!=null)for(File child:children)erase(child);Files.deleteIfExists(file.toPath());
    }
    static String slotKey(String token,int slot)throws Exception{Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(token.getBytes("UTF-8"),"HmacSHA256"));StringBuilder s=new StringBuilder();for(byte b:mac.doFinal(("memory-slot-"+slot).getBytes("UTF-8")))s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    static byte[] memoryKey(String seed,boolean voice)throws Exception{return MessageDigest.getInstance("SHA-256").digest(((voice?"voice-memory-v1\0":"")+seed).getBytes("UTF-8"));}
    static void rekey(File file,String oldSeed,String newSeed,boolean voice)throws Exception{
        if(!file.isFile())return;JSONObject envelope=new JSONObject(new String(Files.readAllBytes(file.toPath()),"UTF-8"));
        if(envelope.optBoolean("encrypted")){
            if(oldSeed.isEmpty())throw new IOException("记忆密钥缺失，未覆盖目标数据");
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");byte[] data=java.util.Base64.getDecoder().decode(envelope.getString("data")),tag=java.util.Base64.getDecoder().decode(envelope.getString("tag")),joined=Arrays.copyOf(data,data.length+tag.length);System.arraycopy(tag,0,joined,data.length,tag.length);
            cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(memoryKey(oldSeed,voice),"AES"),new GCMParameterSpec(128,java.util.Base64.getDecoder().decode(envelope.getString("iv"))));
            JSONObject plain=new JSONObject(new String(cipher.doFinal(joined),"UTF-8"));if(plain.getInt("version")!=1||!plain.has("records"))throw new IOException("记忆格式无效");
            byte[] iv=new byte[12];new SecureRandom().nextBytes(iv);cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(memoryKey(newSeed,voice),"AES"),new GCMParameterSpec(128,iv));byte[] encrypted=cipher.doFinal(plain.toString().getBytes("UTF-8"));
            envelope.put("iv",java.util.Base64.getEncoder().encodeToString(iv)).put("tag",java.util.Base64.getEncoder().encodeToString(Arrays.copyOfRange(encrypted,encrypted.length-16,encrypted.length))).put("data",java.util.Base64.getEncoder().encodeToString(Arrays.copyOf(encrypted,encrypted.length-16)));
            Files.write(file.toPath(),envelope.toString().getBytes("UTF-8"));
        }else if(envelope.optInt("version")!=1||!envelope.has("records"))throw new IOException("记忆格式无效");
    }
}
