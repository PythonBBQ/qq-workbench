package cn.qqworkbench.assistant;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** Downloads belong to a visible foreground service, independent of Activity lifetime. */
public final class UpdateDownloadService extends Service {
    static final AtomicBoolean active=new AtomicBoolean(),paused=new AtomicBoolean(),starting=new AtomicBoolean();
    static volatile String phase="idle",message="尚未下载更新";static volatile long received,total;
    Thread worker;PowerManager.WakeLock wake;long notified;
    static File pending(Context c){File dir=AppUpdates.file(c).getParentFile();dir.mkdirs();return new File(dir,"pending-release.json");}
    static JSONObject pendingRelease(Context c)throws Exception{File file=pending(c);if(!file.isFile()||file.length()>8192)throw new IOException("暂无可继续的下载，请先检查版本");return new JSONObject(new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8));}
    static synchronized void start(Context c,JSONObject release)throws Exception{
        if(active.get()||!starting.compareAndSet(false,true))return;
        try{AppUpdates.assetUrl(release.getString("url"));if(!release.getString("digest").matches("sha256:[a-f0-9]{64}"))throw new IOException("更新包缺少校验值");
            c.getSharedPreferences("update-flow",0).edit().remove("promptedFile").apply();
            phase="starting";message="正在准备下载";received=0;total=release.optLong("bytes");
            Files.write(pending(c).toPath(),release.toString().getBytes(StandardCharsets.UTF_8));c.startForegroundService(new Intent(c,UpdateDownloadService.class));
        }catch(Exception e){starting.set(false);throw e;}
    }
    static void pause(Context c){paused.set(true);c.startService(new Intent(c,UpdateDownloadService.class).setAction("pause"));}
    static String amount(long bytes){return String.format(Locale.ROOT,"%.1f MiB",bytes/1048576.0);}
    static JSONObject state(Context c){android.content.SharedPreferences saved=c.getSharedPreferences("update-download",0);JSONObject result=new JSONObject();try{result.put("active",(active.get()||starting.get())).put("phase",(active.get()||starting.get())?phase:saved.getString("phase","idle")).put("message",(active.get()||starting.get())?message:saved.getString("message","尚未下载更新")).put("received",(active.get()||starting.get())?received:saved.getLong("received",0)).put("total",(active.get()||starting.get())?total:saved.getLong("total",0));}catch(Exception ignored){}return result;}
    public IBinder onBind(Intent intent){return null;}
    public void onCreate(){super.onCreate();NotificationChannel channel=new NotificationChannel("updates","软件更新下载",NotificationManager.IMPORTANCE_LOW);getSystemService(NotificationManager.class).createNotificationChannel(channel);}
    public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null&&"pause".equals(intent.getAction())){paused.set(true);if(worker!=null)worker.interrupt();if(!active.get())stopSelf();return START_NOT_STICKY;}
        startForeground(18,notification("正在准备更新下载",false));
        if(!UsageAgreement.accepted(this)){starting.set(false);stopSelf();return START_NOT_STICKY;}
        if(!active.compareAndSet(false,true)){starting.set(false);return START_NOT_STICKY;}starting.set(false);paused.set(false);
        worker=new Thread(()->{
            try{wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"qqworkbench:update");wake.setReferenceCounted(false);wake.acquire(30*60*1000L);
                JSONObject release=pendingRelease(this);total=release.getLong("bytes");
                AppUpdates.download(this,release,new ResumableDownload.Progress(){public boolean cancelled(){return paused.get();}public void update(String next,long n,long size){
                    phase=next;received=n;total=size;message=next.equals("verifying")?"正在校验下载内容":next.equals("base-check")?"正在检查已安装版本":next.equals("signing")?"正在校验安装包与签名":next.equals("reconstructing")?"正在整合补丁与内置资源 · "+amount(n)+" / "+amount(size):(next.equals("retrying")?"网络中断，正在续传 · ":"正在下载 · ")+amount(n)+" / "+amount(size);
                    long now=SystemClock.elapsedRealtime();if(now-notified>750){notified=now;persist();getSystemService(NotificationManager.class).notify(18,notification(message,false));}
                }});
                phase="ready";message="资源重建与签名校验完成，等待系统安装确认";received=total;pending(this).delete();
            }catch(Exception e){phase=paused.get()?"paused":"interrupted";message=paused.get()?"下载已暂停，点击继续可保留进度":e.getMessage()==null?"下载未完成，点击继续下载":e.getMessage();}
            finally{if(wake!=null&&wake.isHeld())wake.release();persist();active.set(false);stopForeground(STOP_FOREGROUND_DETACH);getSystemService(NotificationManager.class).notify(18,notification(message,true));stopSelf();}
        },"app-update-download");worker.start();return START_NOT_STICKY;
    }
    void persist(){getSharedPreferences("update-download",0).edit().putString("phase",phase).putString("message",message).putLong("received",received).putLong("total",total).apply();}
    Notification notification(String text,boolean finished){
        Intent open=new Intent(this,MainActivity.class).putExtra("openUpdates",true).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap=PendingIntent.getActivity(this,18,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder n=new Notification.Builder(this,"updates").setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("七丘 QQ 工作台 · 更新").setContentText(text).setContentIntent(tap).setOnlyAlertOnce(true).setOngoing(!finished).setAutoCancel(finished);
        if(!finished){boolean indeterminate=total<=0||!(phase.equals("downloading")||phase.equals("reconstructing"));n.setProgress(1000,total>0?(int)Math.min(1000,received*1000/total):0,indeterminate);Intent pause=new Intent(this,UpdateDownloadService.class).setAction("pause");n.addAction(new Notification.Action.Builder(null,"暂停",PendingIntent.getService(this,19,pause,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE)).build());}
        return n.build();
    }
    public void onTimeout(int startId,int type){paused.set(true);if(worker!=null)worker.interrupt();stopSelf();}
    public void onDestroy(){if(active.get()){paused.set(true);if(worker!=null)worker.interrupt();}super.onDestroy();}
}
