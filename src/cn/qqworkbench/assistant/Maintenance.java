package cn.qqworkbench.assistant;

import android.content.*;
import android.os.SystemClock;
import java.io.*;
import java.nio.channels.*;

/** One lifecycle for backup, restore, interrupted transactions and installer handoff. */
final class Maintenance implements AutoCloseable {
    final Context context;
    final boolean requested;
    private final RandomAccessFile file;
    private final FileLock lock;
    private PortableDataAccess data;
    private boolean stopAttempted,stopped,handoff,closed;
    private Maintenance(Context c,boolean requested,RandomAccessFile file,FileLock lock){context=c;this.requested=requested;this.file=file;this.lock=lock;}
    static SharedPreferences prefs(Context c){return c.getSharedPreferences("maintenance",0);}
    static boolean pending(Context c){return prefs(c).contains("kind")||DataMigration.transaction(c).exists();}
    static boolean installing(Context c){return "install".equals(prefs(c).getString("kind",""));}
    static synchronized Maintenance begin(Context c,String kind)throws Exception{return begin(c,kind,false);}
    private static synchronized Maintenance begin(Context c,String kind,boolean recovering)throws Exception{
        if(DataMigration.busy||(!recovering&&pending(c)))throw new IOException("有维护任务尚未结束，请重新打开应用完成恢复");
        RandomAccessFile file=new RandomAccessFile(new File(c.getFilesDir(),"maintenance.lock"),"rw");FileLock lock=null;
        try{
            lock=file.getChannel().tryLock();if(lock==null)throw new IOException("备份、导入或安装正在进行");
            boolean requested=recovering?prefs(c).getBoolean("resume",c.getSharedPreferences("runtime",0).getBoolean("requested",false)):c.getSharedPreferences("runtime",0).getBoolean("requested",false);
            if(!prefs(c).edit().putString("kind",kind).putBoolean("resume",requested).commit())throw new IOException("无法保存维护状态，未停止服务");
            DataMigration.busy=true;c.startForegroundService(new Intent(c,MaintenanceService.class));return new Maintenance(c,requested,file,lock);
        }catch(Exception e){DataMigration.busy=false;if(lock!=null)lock.release();file.close();throw e;}
    }
    static void stopRuntime(Context c)throws Exception{
        RuntimeService.stopRequested(c);long end=SystemClock.elapsedRealtime()+45000;
        while(RuntimeService.running||RuntimeService.stopping){if(SystemClock.elapsedRealtime()>end)throw new IOException("原会话仍在退出，未覆盖数据");Thread.sleep(100);}
        RuntimeProcesses.stop(c);RuntimeProcesses.unlocked(c,5000);
    }
    void quiesce()throws Exception{
        stopAttempted=true;stopRuntime(context);stopped=true;data=PortableDataAccess.acquire(context,false,30000);
    }
    void handoffInstall()throws Exception{
        if(!stopped)throw new IOException("安装前尚未停止会话");
        if(!context.getSharedPreferences("runtime",0).edit().putBoolean("requested",requested).commit())throw new IOException("无法保存安装恢复状态");
        handoff=true;
    }
    static void recover(Context c)throws Exception{
        long target=UpdateFlow.prefs(c).getLong("installTarget",0);
        if(installing(c)&&target>0&&UpdateFlow.version(c)>=target){UpdateFlow.begin(c);c.getSharedPreferences("update-download",0).edit().putString("phase","integrating").putString("message","安装完成，正在整合本地资源").commit();}
        long deadline=SystemClock.elapsedRealtime()+90000;Maintenance task;
        while(true){
            synchronized(Maintenance.class){if(!DataMigration.busy){if(!pending(c))return;task=begin(c,"recover",true);break;}}
            if(SystemClock.elapsedRealtime()>deadline)throw new IOException("另一项维护仍在进行，请稍后重试");Thread.sleep(100);
        }
        try(Maintenance active=task){active.quiesce();DataMigration.recover(c);
            File[] stale=c.getCacheDir().listFiles();if(stale!=null)for(File file:stale)if(file.getName().matches("migration-(?:import-[a-f0-9-]{36}|export-[a-f0-9-]{36}\\.qqwb)"))MigrationArchive.erase(file);
        }
    }
    public void close()throws Exception{
        synchronized(Maintenance.class){
            if(closed)return;closed=true;
            try{
                if(data!=null)data.close();
                if(!handoff&&(!stopAttempted||stopped)&&!DataMigration.transaction(context).exists()&&!prefs(context).edit().clear().commit())throw new IOException("维护结果尚未保存，请重新打开应用恢复");
            }finally{try{lock.release();}finally{try{file.close();}finally{DataMigration.busy=false;context.stopService(new Intent(context,MaintenanceService.class));}}}
        }
        if(!handoff&&stopped&&!pending(context))try{DataMigration.resume(context,requested);}catch(Exception e){RuntimeService.record("维护已完成，本地服务需重新打开应用启动");}
    }
}
