package cn.qqworkbench.assistant;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Data-only per-account preset library; no paths from imported metadata are used. */
final class VoiceLibrary {
    static File directory(Context c,int slot)throws Exception{LocalVoice.slot(slot);File dir=new File(c.getFilesDir(),"voice-library/slot-"+slot);dir.mkdirs();return dir;}
    static String id(String value)throws Exception{if(!value.matches("[a-f0-9]{64}"))throw new IOException("预设标识无效");return value;}
    static JSONArray list(Context c,int slot)throws Exception{File dir=directory(c,slot);JSONArray all=new JSONArray();File[] files=dir.listFiles();if(files==null)return all;Arrays.sort(files,Comparator.comparing(File::getName));for(File f:files){if(!f.getName().matches("[a-f0-9]{64}\\.json")||f.length()>4096)continue;try{JSONObject item=new JSONObject(new String(Files.readAllBytes(f.toPath()),"UTF-8"));String key=id(item.getString("id"));if(!f.getName().equals(key+".json"))continue;if(new File(dir,key+".zip").isFile())all.put(item);}catch(Exception ignored){}}return all;}
    static VoiceReferencePack load(Context c,int slot,String key)throws Exception{try(InputStream in=new FileInputStream(new File(directory(c,slot),id(key)+".zip"))){return VoiceReferencePack.read(in);}}
    static JSONObject save(Context c,int slot,VoiceReferencePack pack)throws Exception{
        File dir=directory(c,slot);ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(ZipOutputStream zip=new ZipOutputStream(bytes)){ZipEntry manifest=new ZipEntry("manifest.json");manifest.setTime(0);zip.putNextEntry(manifest);zip.write(pack.manifest.toString().getBytes("UTF-8"));zip.closeEntry();for(Map.Entry<String,byte[]> item:pack.audio.entrySet()){if(!VoiceReferencePack.permittedName(item.getKey()))throw new IOException("预设文件名无效");ZipEntry entry=new ZipEntry(item.getKey());entry.setTime(0);zip.putNextEntry(entry);zip.write(item.getValue());zip.closeEntry();}}
        byte[] data=bytes.toByteArray();StringBuilder h=new StringBuilder();for(byte b:java.security.MessageDigest.getInstance("SHA-256").digest(data))h.append(String.format(Locale.ROOT,"%02x",b&255));String key=h.toString();File target=new File(dir,key+".zip");
        long size=0;int count=0;File[] files=dir.listFiles();if(files!=null)for(File file:files)if(file.getName().endsWith(".zip")){size+=file.length();count++;}if(!target.isFile()&&(count>=12||size+data.length>64L*1024*1024))throw new IOException("已保存的声音过多，请先移除不需要的预设");
        if(!target.isFile()){File stage=new File(dir,key+".part");try{Files.write(stage.toPath(),data);Files.move(stage.toPath(),target.toPath(),StandardCopyOption.ATOMIC_MOVE);}finally{stage.delete();}}
        String name=pack.manifest.optString("name","我的导入预设");if(name.length()>80)name=name.substring(0,80);
        JSONObject item=new JSONObject().put("id",key).put("name",name).put("bytes",data.length).put("slot",slot);
        Container.writePrivate(new File(dir,key+".json"),item.toString());return item;
    }
    static void remove(Context c,int slot,String key)throws Exception{File dir=directory(c,slot);key=id(key);new File(dir,key+".json").delete();new File(dir,key+".zip").delete();}
}
