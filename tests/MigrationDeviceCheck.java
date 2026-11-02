package cn.qqworkbench.assistant;

import android.content.*;
import android.os.Looper;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Uses isolated synthetic preferences and files under the app UID. No live configuration writes. */
public final class MigrationDeviceCheck {
    static void check(boolean ok){if(!ok)throw new AssertionError();}
    static class TestContext extends ContextWrapper {
        final File root;final String prefix;boolean failSettings;
        TestContext(Context base,File r,String p){super(base);root=r;prefix=p;root.mkdirs();}
        public File getFilesDir(){return root;}
        public SharedPreferences getSharedPreferences(String name,int mode){SharedPreferences p=super.getSharedPreferences(prefix+name,mode);if(!name.equals("settings"))return p;
            return (SharedPreferences)Proxy.newProxyInstance(SharedPreferences.class.getClassLoader(),new Class<?>[]{SharedPreferences.class},(proxy,m,args)->{Object result=m.invoke(p,args);if(!m.getName().equals("edit"))return result;
                return Proxy.newProxyInstance(SharedPreferences.Editor.class.getClassLoader(),new Class<?>[]{SharedPreferences.Editor.class},(x,method,values)->{if(method.getName().equals("commit")&&failSettings){failSettings=false;return false;}Object v=method.invoke(result,values);return v instanceof SharedPreferences.Editor?x:v;});});
        }
        void clean(){for(String name:new String[]{"vault","vault-health","vault-recovery","settings","MainActivity"})getBaseContext().deleteSharedPreferences(prefix+name);}
    }
    public static void main(String[] args)throws Exception{
        Looper.prepareMainLooper();Class<?> at=Class.forName("android.app.ActivityThread");Constructor<?> ctor=at.getDeclaredConstructor();ctor.setAccessible(true);Object thread=ctor.newInstance();Method system=at.getDeclaredMethod("getSystemContext");system.setAccessible(true);Context app=((Context)system.invoke(thread)).createPackageContext("cn.qqworkbench.assistant",Context.CONTEXT_IGNORE_SECURITY);
        new Thread(()->{File test=new File(app.getCacheDir(),"migration-device-check-"+UUID.randomUUID());TestContext source=new TestContext(app,new File(test,"source"),"migration-check-source-"),target=new TestContext(app,new File(test,"target"),"migration-check-target-");char[] pass="test-only-password".toCharArray();
            int exit=0;try{
                Class.forName("android.security.keystore2.AndroidKeyStoreProvider").getMethod("install").invoke(null);
                Secrets sv=new Secrets(source),tv=new Secrets(target);sv.put("internal","synthetic-source-internal");sv.put("conversation-memory","synthetic-source-memory");sv.put("deepseek","synthetic-source-api");tv.put("internal","synthetic-target-internal");tv.put("conversation-memory","synthetic-target-memory");tv.put("deepseek","synthetic-target-api");
                source.getSharedPreferences("settings",0).edit().putString("persona","source-persona").putInt("contextTurns",19).commit();target.getSharedPreferences("settings",0).edit().putString("persona","target-persona").commit();
                MigrationCheck.write(source.root,"settings.json","{\"owner\":\"123456\"}");MigrationCheck.write(target.root,"settings.json","{\"owner\":\"654321\"}");
                for(int slot=0;slot<=3;slot++)for(boolean voice:new boolean[]{false,true})MigrationCheck.write(source.root,DataMigration.WORK+(slot==0?"":"instances/slot-"+slot+"/")+(voice?"voice-memory.json":"conversation-memory.json"),MigrationCheck.memory(slot==0?sv.get("conversation-memory"):MigrationArchive.slotKey(sv.get("internal"),slot),voice).toString());
                MigrationCheck.write(target.root,DataMigration.WORK+"codex-jobs.json","{\"syntheticPending\":true}");
                ByteArrayOutputStream out=new ByteArrayOutputStream();DataMigration.exportData(source,out,pass);byte[] encrypted=out.toByteArray();
                File stage=new File(test,"stage-failure");JSONObject m=MigrationArchive.read(new ByteArrayInputStream(encrypted),stage,pass);target.failSettings=true;boolean failed=false;try{DataMigration.importData(target,stage,m,pass);}catch(Exception e){failed=true;}check(failed);check(tv.get("deepseek").equals("synthetic-target-api"));check(MigrationCheck.text(target.root,"settings.json").contains("654321"));check(target.getSharedPreferences("settings",0).getString("persona","").equals("target-persona"));check(new File(target.root,DataMigration.WORK+"codex-jobs.json").isFile());check(!DataMigration.transaction(target).exists());
                stage=new File(test,"stage-success");m=MigrationArchive.read(new ByteArrayInputStream(encrypted),stage,pass);DataMigration.importData(target,stage,m,pass);
                check(tv.get("deepseek").equals("synthetic-source-api"));check(tv.get("internal").equals("synthetic-target-internal"));check(target.getSharedPreferences("settings",0).getString("persona","").equals("source-persona"));check(target.getSharedPreferences("settings",0).getInt("contextTurns",0)==19);check(!new File(target.root,DataMigration.WORK+"codex-jobs.json").exists());
                for(int slot=0;slot<=3;slot++)for(boolean voice:new boolean[]{false,true}){File f=new File(target.root,DataMigration.WORK+(slot==0?"":"instances/slot-"+slot+"/")+(voice?"voice-memory.json":"conversation-memory.json"));String seed=slot==0?tv.get("conversation-memory"):MigrationArchive.slotKey(tv.get("internal"),slot);MigrationArchive.rekey(f,seed,seed,voice);}
                File previous=new File(target.root,"migration-before-restore.qqwb");try(InputStream in=new FileInputStream(previous)){JSONObject old=MigrationArchive.read(in,new File(test,"previous"),pass);check(old.getJSONObject("metadata").getJSONObject("secrets").getString("deepseek").equals("synthetic-target-api"));}
                DataMigration.recover(target);check(!DataMigration.transaction(target).exists());
                System.out.println("QQWB_MIGRATION_DEVICE_OK: synthetic source/target vault re-encryption, different local tokens, four accounts and eight memory files, destination pre-import encrypted backup, injected preference failure rollback, pending-task exclusion; live data untouched");
            }catch(Throwable e){e.printStackTrace();exit=1;}finally{source.clean();target.clean();try{MigrationArchive.erase(test);}catch(Exception ignored){}Arrays.fill(pass,'\0');}System.exit(exit);
        },"migration-check").start();Looper.loop();
    }
}
