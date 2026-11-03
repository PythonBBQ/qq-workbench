package cn.qqworkbench.assistant;
import android.app.*;
import android.content.*;
import android.os.*;

/** Keeps the user-requested data transaction alive after the QQ service stops. */
public final class MaintenanceService extends Service {
    private PowerManager.WakeLock wake;
    private boolean recovering;
    public IBinder onBind(Intent intent){return null;}
    public void onCreate(){
        super.onCreate();NotificationManager manager=getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("maintenance","备份与更新维护",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,21,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE);
        startForeground(21,new Notification.Builder(this,"maintenance").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("七丘 QQ 工作台 · 正在维护").setContentText("正在安全停止会话、处理备份或交接更新").setContentIntent(open).setOngoing(true).build());
        wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"qqworkbench:maintenance");wake.setReferenceCounted(false);wake.acquire(10*60*1000L);
    }
    public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null&&"recover-update".equals(intent.getAction())&&!recovering&&!DataMigration.busy){recovering=true;
            new Thread(()->{try{Maintenance.recover(getApplicationContext());}catch(Exception e){RuntimeService.record("更新交接待恢复："+e.getMessage());}finally{stopSelf();}},"maintenance-update-recovery").start();
        }else if(!DataMigration.busy&&!recovering)stopSelf();return START_NOT_STICKY;
    }
    public void onDestroy(){if(wake!=null&&wake.isHeld())wake.release();super.onDestroy();}
}
