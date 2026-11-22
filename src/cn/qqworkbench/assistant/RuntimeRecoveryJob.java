package cn.qqworkbench.assistant;

import android.app.job.*;
import android.content.*;
import java.util.concurrent.*;

/** Re-enter the normal service path after boot/network delay or process death. */
public final class RuntimeRecoveryJob extends JobService {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final java.util.Set<JobParameters> active=ConcurrentHashMap.newKeySet();
    public boolean onStartJob(JobParameters params){
        active.add(params);
        worker.execute(()->{
            boolean retry=false;
            try{
                if(!RuntimeRecovery.unlocked(this)){retry=true;return;}
                if(!RuntimeRecovery.allowed(this))return;
                android.content.SharedPreferences p=getSharedPreferences("runtime",0);
                long now=System.currentTimeMillis();
                if(RuntimePolicy.recentlyHealthy(now,p.getLong("lastHealthy",0),p.getBoolean("qqConnected",false))&&RuntimeService.running)return;
                if(!RuntimeService.running&&!RuntimePolicy.mayRecover(now,p.getLong("recoveryWindow",0),p.getInt("recoveryAttempts",0))){retry=true;return;}
                // A retry job remains outstanding until the service confirms QQ online.
                startForegroundService(new Intent(this,RuntimeService.class).putExtra("automaticRecovery",true).putExtra("recoveryReason","scheduled"));
                p.edit().putLong("lastAutomaticRecovery",now).apply();
                retry=params.getJobId()==RuntimeRecovery.RETRY_JOB;
            }catch(RuntimeException e){retry=true;RuntimeRecovery.event(this,"后台恢复稍后重试："+e.getClass().getSimpleName());}
            finally{if(active.remove(params))jobFinished(params,retry);}
        });
        return true;
    }
    public boolean onStopJob(JobParameters params){active.remove(params);return RuntimeRecovery.allowed(this);}
    public void onDestroy(){active.clear();worker.shutdownNow();super.onDestroy();}
}
