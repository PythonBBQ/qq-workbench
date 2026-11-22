package cn.qqworkbench.assistant;

import android.app.job.*;
import android.content.*;
import android.os.*;

/** Durable recovery belongs to the enabled service, never to an Activity. */
final class RuntimeRecovery {
    static final int RETRY_JOB=37101,WATCH_JOB=37102;
    static boolean unlocked(Context c){UserManager users=c.getSystemService(UserManager.class);return users!=null&&users.isUserUnlocked();}
    static boolean allowed(Context c){return unlocked(c)&&RuntimePolicy.restoreAfterBoot(
        c.getSharedPreferences("runtime",0).getBoolean("requested",false),UsageAgreement.accepted(c),DataMigration.busy||Maintenance.pending(c));}
    static JobInfo.Builder builder(Context c,int id){return new JobInfo.Builder(id,new ComponentName(c,RuntimeRecoveryJob.class))
        .setPersisted(true).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL);}
    static synchronized void watch(Context c){
        if(!allowed(c))return;
        try{JobScheduler scheduler=c.getSystemService(JobScheduler.class);
            if(scheduler.getPendingJob(WATCH_JOB)==null&&scheduler.schedule(builder(c,WATCH_JOB).setPeriodic(15*60*1000L).build())!=JobScheduler.RESULT_SUCCESS)
                event(c,"系统暂未接受后台恢复检查");
        }catch(RuntimeException e){event(c,"后台恢复检查暂不可用："+e.getClass().getSimpleName());}
    }
    static synchronized void retry(Context c){
        if(!allowed(c))return;watch(c);
        try{JobScheduler scheduler=c.getSystemService(JobScheduler.class);
            if(scheduler.getPendingJob(RETRY_JOB)==null&&scheduler.schedule(builder(c,RETRY_JOB).setMinimumLatency(30000).build())!=JobScheduler.RESULT_SUCCESS)
                event(c,"系统暂未接受连接重试");
        }catch(RuntimeException e){event(c,"连接重试暂不可用："+e.getClass().getSimpleName());}
    }
    static void recover(Context c,String reason){
        if(!allowed(c))return;watch(c);retry(c);
        try{c.startForegroundService(new Intent(c,RuntimeService.class).putExtra("recoveryReason",reason).putExtra("automaticRecovery",true));}
        catch(RuntimeException e){c.getSharedPreferences("runtime",0).edit().putBoolean("autoRecoveryPending",true)
            .putString("healthStatus","自动恢复暂未获准，等待系统重试；QQ在线状态尚未核验").apply();event(c,"自动恢复暂未启动："+e.getClass().getSimpleName());}
    }
    static synchronized void healthy(Context c){
        try{c.getSystemService(JobScheduler.class).cancel(RETRY_JOB);}catch(RuntimeException ignored){}
        c.getSharedPreferences("runtime",0).edit().putBoolean("bootRecoveryPending",false).putBoolean("autoRecoveryPending",false).apply();
    }
    static synchronized void cancel(Context c){
        try{JobScheduler scheduler=c.getSystemService(JobScheduler.class);scheduler.cancel(RETRY_JOB);scheduler.cancel(WATCH_JOB);}catch(RuntimeException ignored){}
        c.getSharedPreferences("runtime",0).edit().putBoolean("autoRecoveryPending",false).putBoolean("qqConnected",false).apply();
    }
    static void event(Context c,String text){
        RuntimeService.record(text);
        c.getSharedPreferences("runtime",0).edit().putLong("lastRecoveryEventAt",System.currentTimeMillis()).putString("lastRecoveryEvent",text).apply();
    }
}
