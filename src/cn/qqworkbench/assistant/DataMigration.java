package cn.qqworkbench.assistant;

import android.content.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.json.*;

/** Portable data only: no QQ device sessions, runtime queues or system permissions. */
final class DataMigration {
    static volatile boolean busy;
    static final String WORK="linux/rootfs/opt/qq-workbench/";
    static final String[] SECRETS={"conversation-memory","active-api","api-profiles","qq-instances","deepseek","vision","speech","feiyu","site-cookies"};
    static final String[] PREFS={"settings","MainActivity","vault"};
    static List<String> replacementUnits(){List<String> list=units();for(int slot=0;slot<=3;slot++)for(String name:new String[]{"codex-jobs.json","delivery-journal.json","qzone-journal.json"})list.add(WORK+(slot==0?"":"instances/slot-"+slot+"/")+name);return list;}
    static List<String> units(){List<String> list=new ArrayList<>(Arrays.asList("settings.json","theme-background.jpg","theme-background-source.jpg"));for(int slot=0;slot<=3;slot++){for(String name:MigrationArchive.DATA)list.add(WORK+(slot==0?"":"instances/slot-"+slot+"/")+name);list.add("voice-library/slot-"+slot);list.add("voice-references/slot-"+slot);}return list;}
    static JSONObject preferences(SharedPreferences prefs)throws Exception{JSONObject all=new JSONObject();for(Map.Entry<String,?> e:prefs.getAll().entrySet()){Object v=e.getValue();String type=v instanceof Boolean?"bool":v instanceof Integer?"int":v instanceof Long?"long":v instanceof Float?"float":v instanceof Set?"set":"string";all.put(e.getKey(),new JSONObject().put("type",type).put("value",v instanceof Set?new JSONArray((Set<?>)v):v));}return all;}
    static void preferences(SharedPreferences prefs,JSONObject all)throws Exception{
        SharedPreferences.Editor edit=prefs.edit().clear();for(Iterator<String> it=all.keys();it.hasNext();){String k=it.next();JSONObject v=all.getJSONObject(k);switch(v.getString("type")){case "bool":edit.putBoolean(k,v.getBoolean("value"));break;case "int":edit.putInt(k,v.getInt("value"));break;case "long":edit.putLong(k,v.getLong("value"));break;case "float":edit.putFloat(k,(float)v.getDouble("value"));break;case "set":Set<String> set=new HashSet<>();JSONArray a=v.getJSONArray("value");for(int i=0;i<a.length();i++)set.add(a.getString(i));edit.putStringSet(k,set);break;case "string":edit.putString(k,v.getString("value"));break;default:throw new IOException("设置格式无效");}}if(!edit.commit())throw new IOException("设置保存失败");
    }
    static Map<String,File> files(Context c)throws Exception{
        Map<String,File> files=new TreeMap<>();File root=c.getFilesDir();for(String name:units()){
            File f=new File(root,name);if(Files.isSymbolicLink(f.toPath()))throw new IOException("数据目录不能是链接");
            if(f.isDirectory()){File[] children=f.listFiles();if(children!=null)for(File child:children){String n=name+"/"+child.getName();if(MigrationArchive.permitted(n)&&child.isFile())files.put(n,MigrationArchive.child(root,n));}}
            else if(f.isFile())files.put(name,MigrationArchive.child(root,name));
        }return files;
    }
    static JSONObject metadata(Context c)throws Exception{
        Secrets vault=new Secrets(c);JSONObject secrets=new JSONObject();for(String name:SECRETS){String value=vault.get(name);if(vault.unavailable(name))throw new IOException("部分加密配置不可读，请先到诊断恢复");secrets.put(name,value);}
        return new JSONObject().put("version",1).put("slotSeed",vault.ensure("internal")).put("secrets",secrets).put("settings",preferences(c.getSharedPreferences("settings",0))).put("theme",preferences(c.getSharedPreferences("MainActivity",0)));
    }
    static void exportData(Context c,OutputStream out,char[] password)throws Exception{MigrationArchive.write(c.getFilesDir(),files(c),metadata(c),password,out);}
    static boolean stop(Context c)throws Exception{
        boolean requested=c.getSharedPreferences("runtime",0).getBoolean("requested",false);RuntimeService.stopRequested(c);
        long end=android.os.SystemClock.elapsedRealtime()+45000;
        while(RuntimeService.running||RuntimeService.stopping){if(android.os.SystemClock.elapsedRealtime()>end)throw new IOException("原会话仍在退出，请稍后重试");Thread.sleep(250);}
        Container container=new Container(c);if(new File(container.root,".qq-rootfs-v1").isFile()){
            java.lang.Process p=container.start("exec flock -w 20 /opt/qq-workbench/.runtime.lock true",new HashMap<>());
            if(!p.waitFor(25,java.util.concurrent.TimeUnit.SECONDS)){p.destroy();throw new IOException("原会话尚未释放运行锁");}if(p.exitValue()!=0)throw new IOException("原会话尚未释放运行锁");
        }return requested;
    }
    static void resume(Context c,boolean requested){if(requested)c.startForegroundService(new Intent(c,RuntimeService.class));}
    static File transaction(Context c){return new File(c.getFilesDir(),"migration-transaction");}
    static void save(File f,JSONObject data)throws Exception{Container.writePrivate(f,data.toString());}
    static void recover(Context c)throws Exception{
        File tx=transaction(c),journal=new File(tx,"journal.json");if(!journal.isFile()){if(tx.exists())MigrationArchive.erase(tx);return;}
        JSONObject j=new JSONObject(new String(Files.readAllBytes(journal.toPath()),"UTF-8"));
        if(!j.optBoolean("committed")){
            JSONArray touched=j.getJSONArray("touched");for(int i=touched.length()-1;i>=0;i--){JSONObject item=touched.getJSONObject(i);String n=item.getString("path");if(!replacementUnits().contains(n))throw new IOException("迁移恢复清单无效");File dest=new File(c.getFilesDir(),n),old=new File(tx,"old/"+n);
                if(old.exists()){MigrationArchive.erase(dest);dest.getParentFile().mkdirs();Files.move(old.toPath(),dest.toPath());}else if(!item.getBoolean("existed"))MigrationArchive.erase(dest);
            }
            JSONObject prefs=j.getJSONObject("prefs");for(String n:PREFS)preferences(c.getSharedPreferences(n,0),prefs.getJSONObject(n));
        }
        MigrationArchive.erase(tx);
    }
    static void importData(Context c,File stage,JSONObject manifest,char[] password)throws Exception{
        JSONObject meta=manifest.getJSONObject("metadata");if(meta.getInt("version")!=1)throw new IOException("备份格式不支持");
        JSONObject secrets=meta.getJSONObject("secrets");for(String name:SECRETS)if(!secrets.has(name)||!(secrets.get(name) instanceof String))throw new IOException("备份凭据不完整");
        String sourceSeed=meta.getString("slotSeed"),targetSeed=new Secrets(c).ensure("internal"),master=secrets.getString("conversation-memory");
        for(int slot=0;slot<=3;slot++)for(boolean voice:new boolean[]{false,true}){
            String name=WORK+(slot==0?"":"instances/slot-"+slot+"/")+(voice?"voice-memory.json":"conversation-memory.json");
            MigrationArchive.rekey(new File(stage,name),slot==0?master:MigrationArchive.slotKey(sourceSeed,slot),slot==0?master:MigrationArchive.slotKey(targetSeed,slot),voice);
        }
        // Save the destination's complete portable data, encrypted with the same password.
        File previous=new File(c.getFilesDir(),"migration-before-restore.qqwb"),next=new File(c.getFilesDir(),"migration-before-restore.part");
        try(OutputStream out=new FileOutputStream(next)){exportData(c,out,password);}Files.move(next.toPath(),previous.toPath(),StandardCopyOption.REPLACE_EXISTING);
        File tx=transaction(c);if(!tx.mkdirs())throw new IOException("迁移事务未恢复，请重新打开应用");
        JSONObject oldPrefs=new JSONObject();for(String n:PREFS)oldPrefs.put(n,preferences(c.getSharedPreferences(n,0)));
        JSONObject journal=new JSONObject().put("prefs",oldPrefs).put("touched",new JSONArray()).put("committed",false);File jf=new File(tx,"journal.json");save(jf,journal);
        try{
            for(String name:replacementUnits()){
                File dest=new File(c.getFilesDir(),name),src=new File(stage,name),old=new File(tx,"old/"+name);
                if(!dest.exists()&&!src.exists())continue;
                // Validate ancestors for directory units as well as ordinary files.
                if(!name.endsWith("codex-jobs.json")&&!name.endsWith("delivery-journal.json")&&!name.endsWith("qzone-journal.json"))MigrationArchive.child(c.getFilesDir(),name.startsWith("voice-")?name+"/pack.json":name);
                journal.getJSONArray("touched").put(new JSONObject().put("path",name).put("existed",dest.exists()));save(jf,journal);
                if(dest.exists()){old.getParentFile().mkdirs();Files.move(dest.toPath(),old.toPath());}
                if(src.exists()){dest.getParentFile().mkdirs();Files.move(src.toPath(),dest.toPath());}
            }
            preferences(c.getSharedPreferences("settings",0),meta.getJSONObject("settings"));preferences(c.getSharedPreferences("MainActivity",0),meta.getJSONObject("theme"));
            Secrets vault=new Secrets(c);for(String n:SECRETS)vault.put(n,secrets.getString(n));
            // Local permissions must be granted on the destination itself.
            c.getSharedPreferences("settings",0).edit().remove("backgroundPermissionOffered").putBoolean("deviceToolsEnabled",false).commit();
            for(String path:new String[]{"settings.json",WORK+"settings.json"}){File config=new File(c.getFilesDir(),path);if(config.isFile()){JSONObject value=new JSONObject(new String(Files.readAllBytes(config.toPath()),"UTF-8"));value.put("deviceToolsEnabled",false);save(config,value);}}
            journal.put("committed",true);save(jf,journal);recover(c);
        }catch(Exception e){try{recover(c);}catch(Exception rollback){throw new IOException("迁移中断，原数据待恢复；请重新打开应用",rollback);}throw e;}
    }
}
