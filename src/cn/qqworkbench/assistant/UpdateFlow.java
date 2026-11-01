package cn.qqworkbench.assistant;

import android.content.*;
import android.app.*;
import android.os.*;
import org.json.*;
import java.io.*;

/** Durable install handoff. APK installation always remains a system operation. */
final class UpdateFlow {
    static android.content.SharedPreferences prefs(Context c){return c.getSharedPreferences("update-flow",0);}
    static long version(Context c){try{return c.getPackageManager().getPackageInfo(c.getPackageName(),0).getLongVersionCode();}catch(Exception e){return -1;}}
    static boolean needsSync(long installed,long synced){return installed>0&&installed!=synced;}
    static boolean integrating(Context c){return prefs(c).getBoolean("integrating",false);}
    static void begin(Context c){prefs(c).edit().putBoolean("integrating",true).putString("integrationMessage","正在整合本地资源…").commit();}
    static void resourcesReady(Context c){c.getSharedPreferences("runtime",0).edit().putLong("resourceVersion",version(c)).commit();if(integrating(c))prefs(c).edit().putString("integrationMessage","资源已整合，正在恢复本地服务…").apply();}
    static void finished(Context c){if(!integrating(c))return;prefs(c).edit().putBoolean("integrating",false).putString("integrationMessage","更新完成，本地服务已恢复").remove("installTarget").commit();c.getSharedPreferences("update-download",0).edit().putString("phase","complete").putString("message","更新完成，资源已整合，本地服务已恢复").apply();AppUpdates.file(c).delete();}
    static void problem(Context c,String message){if(integrating(c))prefs(c).edit().putString("integrationMessage",message+"；可在诊断中重试，账号和配置保留").apply();}
    static void install(MainActivity a){
        if(a.updateInstalling)return;a.updateInstalling=true;a.toast("正在核对更新包，请稍候…");
        a.io.submit(()->{try{Intent intent=AppUpdates.installer(a);boolean permission=intent.getAction().equals(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);if(!permission){android.content.pm.PackageInfo target=a.getPackageManager().getPackageArchiveInfo(AppUpdates.file(a).getAbsolutePath(),0);if(target==null)throw new IOException("无法读取更新版本");prefs(a).edit().putLong("installTarget",target.getLongVersionCode()).commit();}
            a.runOnUiThread(()->{a.updateInstalling=false;if(a.destroyed)return;try{a.updatePermissionReturn=permission;prefs(a).edit().putBoolean("permissionPending",permission).commit();a.startActivityForResult(intent,78);}catch(Exception e){a.updatePermissionReturn=false;a.toast("无法打开系统安装界面，请稍后重试");}});
        }catch(Exception e){a.runOnUiThread(()->{a.updateInstalling=false;if(!a.destroyed)a.toast(e.getMessage());});}});
    }
    static void offerInstall(MainActivity a){
        if(!a.updateForeground||a.updateInstalling||!a.screen.equals("updates"))return;
        JSONObject state=UpdateDownloadService.state(a);File file=AppUpdates.file(a);if(!state.optString("phase").equals("ready")||state.optBoolean("active")||!file.isFile())return;
        String identity=file.length()+":"+file.lastModified();if(identity.equals(prefs(a).getString("promptedFile","")))return;
        prefs(a).edit().putString("promptedFile",identity).apply();a.installUpdate();
    }
    static void replaced(Context c){
        if(!UsageAgreement.accepted(c))return;long target=prefs(c).getLong("installTarget",0);boolean requested=c.getSharedPreferences("runtime",0).getBoolean("requested",false);
        if(target<=0||version(c)<target){if(requested)try{c.startForegroundService(new Intent(c,RuntimeService.class));}catch(Exception ignored){}return;}
        begin(c);c.getSharedPreferences("update-download",0).edit().putString("phase","integrating").putString("message","安装完成，正在整合本地资源").apply();
        try{c.startForegroundService(new Intent(c,RuntimeService.class));}catch(Exception e){problem(c,"请打开软件继续初始化");}
        Intent open=new Intent(c,MainActivity.class).putExtra("openUpdates",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        NotificationManager nm=c.getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("update-restart","更新完成",NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent tap=PendingIntent.getActivity(c,20,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        nm.notify(20,new Notification.Builder(c,"update-restart").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("七丘 QQ 工作台 · 已更新").setContentText("正在恢复本地服务；点击返回工作台").setContentIntent(tap).setAutoCancel(true).build());
        try{c.startActivity(open);}catch(Exception ignored){} // OEMs may require the notification tap.
    }
}
