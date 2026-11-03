package cn.qqworkbench.backupcheck;

import android.app.Instrumentation;
import android.content.*;
import android.os.Bundle;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.json.*;

/** Separate, same-signed test APK. Executes under the installed app's real lifecycle. */
public final class BackupInstrumentation extends Instrumentation {
    Context app;ClassLoader loader;android.app.Activity activity;Field busy;
    void phase(String text)throws Exception{Files.write(new File(app.getCacheDir(),"backup-check-phase.txt").toPath(),text.getBytes("UTF-8"));Bundle b=new Bundle();b.putString("phase",text);sendStatus(0,b);}
    Object call(String type,String method,Class<?>[] types,Object... args)throws Exception{
        Method m=loader.loadClass("cn.qqworkbench.assistant."+type).getDeclaredMethod(method,types);m.setAccessible(true);
        try{return m.invoke(null,args);}catch(InvocationTargetException e){throw (Exception)e.getCause();}
    }
    Object container()throws Exception{Constructor<?> c=loader.loadClass("cn.qqworkbench.assistant.Container").getDeclaredConstructor(Context.class);c.setAccessible(true);return c.newInstance(app);}
    Process start(String command)throws Exception{Object c=container();Method m=c.getClass().getDeclaredMethod("start",String.class,Map.class);m.setAccessible(true);return (Process)m.invoke(c,command,Collections.emptyMap());}
    void unlocked()throws Exception{call("RuntimeProcesses","unlocked",new Class[]{Context.class,long.class},app,2000L);}
    static final class Target extends ContextWrapper {
        final File root;final String prefix="backup-lock-check-"+UUID.randomUUID()+"-";
        Target(Context app,File root){super(app);this.root=root;root.mkdirs();}
        public File getFilesDir(){return root;}
        public SharedPreferences getSharedPreferences(String name,int mode){return super.getSharedPreferences(prefix+name,mode);}
        void clean(){for(String name:new String[]{"settings","MainActivity","vault","vault-health","vault-recovery"})getBaseContext().deleteSharedPreferences(prefix+name);}
    }
    byte[] digest(File f)throws Exception{return MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(f.toPath()));}
    public void onCreate(Bundle args){super.onCreate(args);start();}
    public void onStart(){
        app=getTargetContext();loader=app.getClassLoader();Bundle result=new Bundle();File test=new File(app.getCacheDir(),"backup-lock-check-"+UUID.randomUUID());test.mkdirs();Target target=new Target(app,new File(test,"target"));char[] pass=UUID.randomUUID().toString().toCharArray();Process held=null;int code=-1;
        try{
            busy=loader.loadClass("cn.qqworkbench.assistant.DataMigration").getDeclaredField("busy");busy.setAccessible(true);busy.setBoolean(null,true);
            activity=startActivitySync(new Intent().setClassName(app.getPackageName(),"cn.qqworkbench.assistant.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            runOnMainSync(()->{try{Field h=activity.getClass().getDeclaredField("handler");h.setAccessible(true);((android.os.Handler)h.get(activity)).removeCallbacksAndMessages(null);}catch(Exception e){throw new RuntimeException(e);}});

            runOnMainSync(()->app.startForegroundService(new Intent().setClassName(app.getPackageName(),"cn.qqworkbench.assistant.MaintenanceService")));
            phase("recover-orphan");call("RuntimeProcesses","stop",new Class[]{Context.class},app);phase("check-unlocked");unlocked();
            phase("fd-inheritance");Process inheritance=start("flock --close /opt/qq-workbench/.runtime.lock bash -c 'sleep 3 >/dev/null 2>&1 &'; flock -n -E 75 /opt/qq-workbench/.runtime.lock echo QQWB_FD_CLOSED");
            ByteArrayOutputStream text=new ByteArrayOutputStream();try(InputStream in=inheritance.getInputStream()){byte[] b=new byte[1024];int n;while((n=in.read(b))!=-1)text.write(b,0,n);}
            if(!inheritance.waitFor(10,TimeUnit.SECONDS)||inheritance.exitValue()!=0||!text.toString("UTF-8").contains("QQWB_FD_CLOSED"))throw new IOException("lock inheritance test failed");
            phase("acquire-test-lock");held=start("exec flock --close /opt/qq-workbench/.runtime.lock bash -c 'echo QQWB_HELD; sleep 120'");
            BufferedReader reader=new BufferedReader(new InputStreamReader(held.getInputStream()));if(!"QQWB_HELD".equals(reader.readLine()))throw new IOException("test lock not acquired");
            phase("refuse-live-lock");boolean refused=false;try{unlocked();}catch(IOException e){if(!e.getMessage().contains("尚未释放运行锁"))throw e;refused=true;}if(!refused)throw new IOException("live lock bypassed");
            phase("recover-orphan");call("RuntimeProcesses","stop",new Class[]{Context.class},app);phase("check-unlocked");unlocked();
            if(!held.waitFor(5,TimeUnit.SECONDS))throw new IOException("orphan not stopped");reader.close();
            // Also use the exact backup stop entry point (service already stopped).
            phase("backup-stop");call("DataMigration","stop",new Class[]{Context.class},app);
            // Keep the Activity from auto-starting during a transaction, but let
            // Maintenance own the real busy marker and foreground lifetime.
            busy.setBoolean(null,false);
            Object first=call("Maintenance","begin",new Class[]{Context.class,String.class},app,"test");
            boolean overlap=false;try{call("Maintenance","begin",new Class[]{Context.class,String.class},app,"test-overlap");}catch(IOException expected){overlap=true;}
            if(!overlap)throw new IOException("concurrent maintenance allowed");
            Method quiet=first.getClass().getDeclaredMethod("quiesce");quiet.setAccessible(true);quiet.invoke(first);
            Method close=first.getClass().getDeclaredMethod("close");close.setAccessible(true);close.invoke(first);
            app.getSharedPreferences("maintenance",0).edit().putString("kind","interrupted-export").putBoolean("resume",false).commit();
            call("Maintenance","recover",new Class[]{Context.class},app);
            if((Boolean)call("Maintenance","pending",new Class[]{Context.class},app))throw new IOException("maintenance journal survived recovery");
            result.putBoolean("exclusiveMaintenance",true);result.putBoolean("interruptedTaskRecovered",true);
            phase("installer-cancel-recovery");
            Object install=call("Maintenance","begin",new Class[]{Context.class,String.class},app,"install");quiet.invoke(install);Method handoff=install.getClass().getDeclaredMethod("handoffInstall");handoff.setAccessible(true);handoff.invoke(install);close.invoke(install);
            if(!(Boolean)call("Maintenance","installing",new Class[]{Context.class},app))throw new IOException("installer handoff not durable");
            call("Maintenance","recover",new Class[]{Context.class},app);if((Boolean)call("Maintenance","pending",new Class[]{Context.class},app))throw new IOException("cancelled install not recovered");result.putBoolean("installerCancelRecovered",true);

            phase("speech-reference-lock");
            Class<?> access=loader.loadClass("cn.qqworkbench.assistant.PortableDataAccess");Method acquire=access.getDeclaredMethod("acquire",Context.class,boolean.class,long.class);acquire.setAccessible(true);
            AutoCloseable speechReader=(AutoCloseable)acquire.invoke(null,app,true,0L);boolean blocked=false;
            try{acquire.invoke(null,app,false,200L);}catch(InvocationTargetException expected){blocked=expected.getCause() instanceof IOException;}finally{speechReader.close();}
            if(!blocked)throw new IOException("speech and restore raced");((AutoCloseable)acquire.invoke(null,app,false,1000L)).close();result.putBoolean("speechImportExcluded",true);
            busy.setBoolean(null,true);runOnMainSync(()->app.startForegroundService(new Intent().setClassName(app.getPackageName(),"cn.qqworkbench.assistant.MaintenanceService")));
            phase("codec-regressions");
            cn.qqworkbench.assistant.MigrationCheck.main(new String[]{test.getPath()});
            phase("vault-import-regressions");
            cn.qqworkbench.assistant.MigrationDeviceCheck.run(app);
            // Invalid metadata must fail before any existing destination file changes.
            JSONObject invalid=new JSONObject().put("metadata",new JSONObject().put("version",99));boolean rejected=false;
            try{call("DataMigration","importData",new Class[]{Context.class,File.class,JSONObject.class,char[].class},target,new File(test,"invalid"),invalid,pass);}catch(IOException expected){rejected=true;}
            if(!rejected)throw new IOException("invalid metadata accepted");result.putBoolean("invalidImportRejected",true);
            phase("snapshot-files");Map<String,File> source=(Map<String,File>)call("DataMigration","files",new Class[]{Context.class},app);Map<String,byte[]> before=new TreeMap<>();for(Map.Entry<String,File> entry:source.entrySet())before.put(entry.getKey(),digest(entry.getValue()));
            phase("export-encrypted");File backup=new File(test,"snapshot.qqwb");try(OutputStream out=new FileOutputStream(backup)){call("DataMigration","exportData",new Class[]{Context.class,OutputStream.class,char[].class},app,out,pass);}
            phase("decrypt");File stage=new File(test,"stage");JSONObject manifest;try(InputStream in=new FileInputStream(backup)){manifest=(JSONObject)call("MigrationArchive","read",new Class[]{InputStream.class,File.class,char[].class},in,stage,pass);}
            phase("isolated-import");call("DataMigration","importData",new Class[]{Context.class,File.class,JSONObject.class,char[].class},target,stage,manifest,pass);
            for(Map.Entry<String,File> entry:source.entrySet())if(!Arrays.equals(before.get(entry.getKey()),digest(entry.getValue())))throw new IOException("source data changed");
            result.putString("result","QQWB_BACKUP_LOCK_OK");result.putInt("portableFiles",source.size());result.putLong("encryptedBytes",backup.length());result.putBoolean("sourceUnchanged",true);result.putBoolean("isolatedImport",true);result.putBoolean("liveLockRefused",true);result.putBoolean("orphanRecovered",true);result.putBoolean("inheritedFdPrevented",true);
        }catch(Exception e){code=0;result.putString("error",e.getClass().getSimpleName()+": "+e.getMessage());StringWriter stack=new StringWriter();e.printStackTrace(new PrintWriter(stack));result.putString("stack",stack.toString());}
        finally{if(held!=null&&held.isAlive())held.destroyForcibly();target.clean();Arrays.fill(pass,'\0');try{call("MigrationArchive","erase",new Class[]{File.class},test);}catch(Exception ignored){}}
        if(activity!=null)runOnMainSync(()->activity.finish());try{if(busy!=null)busy.setBoolean(null,false);}catch(Exception ignored){}app.stopService(new Intent().setClassName(app.getPackageName(),"cn.qqworkbench.assistant.MaintenanceService"));finish(code,result);
    }
}
