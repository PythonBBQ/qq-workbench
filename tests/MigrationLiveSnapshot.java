package cn.qqworkbench.assistant;
import android.content.*;
import android.os.Looper;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Opt-in: briefly stop runtime, roundtrip real data into an isolated target, then resume. */
public final class MigrationLiveSnapshot {
    public static void main(String[] args)throws Exception{
        Looper.prepareMainLooper();Class<?> at=Class.forName("android.app.ActivityThread");Constructor<?> ctor=at.getDeclaredConstructor();ctor.setAccessible(true);Object thread=ctor.newInstance();Method system=at.getDeclaredMethod("getSystemContext");system.setAccessible(true);Context app=((Context)system.invoke(thread)).createPackageContext("cn.qqworkbench.assistant",Context.CONTEXT_IGNORE_SECURITY);
        new Thread(()->{
            File test=new File(app.getCacheDir(),"migration-live-check-"+UUID.randomUUID());test.mkdirs();MigrationDeviceCheck.TestContext target=new MigrationDeviceCheck.TestContext(app,new File(test,"target"),"migration-live-target-");char[] password=UUID.randomUUID().toString().toCharArray();boolean requested=app.getSharedPreferences("runtime",0).getBoolean("requested",false);int exit=0;
            try{
                Class.forName("android.security.keystore2.AndroidKeyStoreProvider").getMethod("install").invoke(null);// Caller stops the real service via am; app_process lacks an ActivityThread binder token.
                java.lang.Process lock=new Container(app).start("exec flock -w 20 /opt/qq-workbench/.runtime.lock true",new HashMap<>());if(!lock.waitFor(25,java.util.concurrent.TimeUnit.SECONDS))throw new IOException("Runtime lock still held");if(lock.exitValue()!=0){byte[] log=CharacterCard.read(lock.getInputStream(),16000);System.err.println(new String(log,"UTF-8"));throw new IOException("Runtime lock check exit "+lock.exitValue());}
                Map<String,File> source=DataMigration.files(app);Map<String,String> before=new TreeMap<>();for(Map.Entry<String,File> f:source.entrySet())before.put(f.getKey(),MigrationArchive.digest(f.getValue()));
                File backup=new File(test,"snapshot.qqwb");try(OutputStream out=new FileOutputStream(backup)){DataMigration.exportData(app,out,password);}
                File stage=new File(test,"stage");JSONObject manifest;try(InputStream in=new FileInputStream(backup)){manifest=MigrationArchive.read(in,stage,password);}
                MigrationDeviceCheck.check(manifest.getJSONObject("files").length()==source.size());String local=new Secrets(target).ensure("internal");DataMigration.importData(target,stage,manifest,password);MigrationDeviceCheck.check(new Secrets(target).get("internal").equals(local));
                int memories=0;for(int slot=0;slot<=3;slot++)for(boolean voice:new boolean[]{false,true}){File f=new File(target.getFilesDir(),DataMigration.WORK+(slot==0?"":"instances/slot-"+slot+"/")+(voice?"voice-memory.json":"conversation-memory.json"));if(f.isFile()){String seed=slot==0?new Secrets(target).get("conversation-memory"):MigrationArchive.slotKey(local,slot);MigrationArchive.rekey(f,seed,seed,voice);memories++;}}
                for(Map.Entry<String,File> f:source.entrySet())MigrationDeviceCheck.check(MigrationArchive.digest(f.getValue()).equals(before.get(f.getKey())));
                System.out.println("QQWB_MIGRATION_LIVE_OK "+new JSONObject().put("files",source.size()).put("encryptedBytes",backup.length()).put("readableMemoryFiles",memories).put("sourceUnchanged",true).put("localTokenPreserved",true).put("isolatedImport",true).put("resumeRequested",requested));
            }catch(Throwable e){e.printStackTrace();exit=1;}
            finally{target.clean();try{MigrationArchive.erase(test);}catch(Exception ignored){}Arrays.fill(password,'\0');}
            System.exit(exit);
        },"migration-live-snapshot").start();Looper.loop();
    }
}
