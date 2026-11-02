package cn.qqworkbench.assistant;

import android.content.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.json.*;

public final class MigrationCheck {
    static void check(boolean value){if(!value)throw new AssertionError();}
    static void write(File root,String n,String s)throws Exception{File f=new File(root,n);f.getParentFile().mkdirs();Files.write(f.toPath(),s.getBytes("UTF-8"));}
    static String text(File root,String n)throws Exception{return new String(Files.readAllBytes(new File(root,n).toPath()),"UTF-8");}
    static void rejected(byte[] bytes,File stage,char[] pass)throws Exception{boolean bad=false;try{MigrationArchive.read(new ByteArrayInputStream(bytes),stage,pass);}catch(Exception e){bad=true;}check(bad&&!stage.exists());}
    static JSONObject memory(String seed,boolean voice)throws Exception{
        byte[] iv=new byte[12];new java.security.SecureRandom().nextBytes(iv);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(MigrationArchive.memoryKey(seed,voice),"AES"),new GCMParameterSpec(128,iv));byte[] all=c.doFinal((voice?"{\"version\":1,\"records\":[]}":"{\"version\":1,\"records\":{}}").getBytes("UTF-8"));
        return new JSONObject().put("version",1).put("encrypted",true).put("iv",Base64.getEncoder().encodeToString(iv)).put("tag",Base64.getEncoder().encodeToString(Arrays.copyOfRange(all,all.length-16,all.length))).put("data",Base64.getEncoder().encodeToString(Arrays.copyOf(all,all.length-16)));
    }
    public static void main(String[] args)throws Exception{
        File root=new File("/data/local/tmp/qqwb-migration-check-"+UUID.randomUUID());root.mkdirs();char[] pass="synthetic-password-123".toCharArray();
        try{
            File source=new File(root,"source");source.mkdir();write(source,"settings.json","{\"persona\":\"测试鲸鱼\"}");write(source,DataMigration.WORK+"learning-notes.json","[\"synthetic note\"]");
            Map<String,File> entries=new TreeMap<>();entries.put("settings.json",new File(source,"settings.json"));entries.put(DataMigration.WORK+"learning-notes.json",new File(source,DataMigration.WORK+"learning-notes.json"));
            ByteArrayOutputStream out=new ByteArrayOutputStream();MigrationArchive.write(source,entries,new JSONObject().put("synthetic","private-test-key"),pass,out);byte[] encrypted=out.toByteArray();check(!new String(encrypted,"ISO-8859-1").contains("private-test-key"));
            File stage=new File(root,"stage");JSONObject manifest=MigrationArchive.read(new ByteArrayInputStream(encrypted),stage,pass);check(manifest.getJSONObject("files").length()==2);check(text(stage,"settings.json").equals(text(source,"settings.json")));
            rejected(encrypted,new File(root,"wrong"),"wrong-password-1".toCharArray());byte[] tamper=encrypted.clone();tamper[tamper.length-1]^=1;rejected(tamper,new File(root,"tamper"),pass);rejected(Arrays.copyOf(encrypted,encrypted.length-20),new File(root,"truncated"),pass);
            for(String path:new String[]{"../settings.json","/settings.json","voice-references/slot-0/../../settings.json","linux/rootfs/root/.config/QQ/secret","linux/rootfs/opt/qq-workbench/codex-jobs.json","voice-references/slot-0.backup-test/pack.json"})check(!MigrationArchive.permitted(path));
            Files.createSymbolicLink(new File(source,"theme-background.jpg").toPath(),new File(source,"settings.json").toPath());boolean reject=false;try{MigrationArchive.child(source,"theme-background.jpg");}catch(IOException e){reject=true;}check(reject);
            for(int slot=1;slot<=3;slot++)for(boolean voice:new boolean[]{false,true}){
                String old=MigrationArchive.slotKey("old-device-token",slot),next=MigrationArchive.slotKey("new-device-token",slot);check(!old.equals(next));File f=new File(root,"memory-"+slot+voice);Files.write(f.toPath(),memory(old,voice).toString().getBytes("UTF-8"));
                MigrationArchive.rekey(f,old,next,voice);MigrationArchive.rekey(f,next,next,voice);boolean failed=false;try{MigrationArchive.rekey(f,old,old,voice);}catch(Exception e){failed=true;}check(failed);
            }
            write(source,"voice-references/slot-0/pack.json","{}");write(source,"voice-references/slot-0.backup-00000000-0000-0000-0000-000000000000/pack.json","{}");write(source,"full-voice-probe-test/out.wav","scratch");write(source,"zipvoice-full-models-v1/model.onnx","preserve");
            long bytes=StorageCleanup.clear(source);check(bytes>0);check(new File(source,"voice-references/slot-0/pack.json").isFile());check(new File(source,"zipvoice-full-models-v1/model.onnx").isFile());check(!new File(source,"full-voice-probe-test").exists());
            System.out.println("QQWB_MIGRATION_CODEC_OK: encrypted roundtrip, wrong password, tamper/truncation, path/link rejection, cross-token rekey for all three accounts and both memories; cleanup preserves active voices/models");
        }finally{MigrationArchive.erase(root);Arrays.fill(pass,'\0');}
    }
}
