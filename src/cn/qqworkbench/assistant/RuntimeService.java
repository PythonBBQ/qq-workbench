package cn.qqworkbench.assistant;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.JSONObject;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

public final class RuntimeService extends Service {
    static volatile String state="尚未启动";
    static volatile boolean running=false;
    static volatile boolean stopping=false;
    static volatile String environmentProblem="";
    static final ArrayDeque<String> logs=new ArrayDeque<>();
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService health=Executors.newSingleThreadScheduledExecutor();
    private volatile java.lang.Process process;
    private volatile boolean stopped;
    private PowerManager.WakeLock wake;
    private NativeNetwork network;
    private BackgroundGuard background;
    private long lastResume;
    private long lastHealthTick;
    private volatile int healthFailures;
    private volatile boolean adopted;
    static synchronized void record(String value){if(value==null||value.trim().isEmpty())return;logs.addLast(value);while(logs.size()>160)logs.removeFirst();}
    static synchronized String logText(){return String.join("\n",logs);}
    public android.os.IBinder onBind(Intent i){return null;}
    public void onCreate(){super.onCreate();
        if(!UsageAgreement.accepted(this)){state="请先在应用中阅读并同意个人使用协议";stopSelf();return;}
        NotificationManager nm=getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("runtime","QQ 工作台运行状态",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE);
        startForeground(17,new Notification.Builder(this,"runtime").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("七丘 QQ 工作台").setContentText("手机本地运行；点击查看状态").setContentIntent(open).setOngoing(true).build());
        wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"qqworkbench:runtime");wake.setReferenceCounted(false);wake.acquire();
        background=new BackgroundGuard(this,health,this::resumeConnection);background.start();
    }
    public int onStartCommand(Intent i,int flags,int id){
        if(!UsageAgreement.accepted(this)){getSharedPreferences("runtime",0).edit().putBoolean("requested",false).commit();stopSelf();return START_NOT_STICKY;}
        android.content.SharedPreferences preferences=getSharedPreferences("runtime",0);
        if(i==null&&(!preferences.getBoolean("requested",false)||!claimRecovery())){stopSelf();return START_NOT_STICKY;}
        preferences.edit().putBoolean("requested",true).apply();
        if(!running){running=true;stopped=false;update("服务已启动，正在检查本机环境…");health.scheduleWithFixedDelay(this::checkHealth,30,30,TimeUnit.SECONDS);worker.execute(this::supervise);}
        return START_STICKY;
    }
    static void stopRequested(Context context){context.getSharedPreferences("runtime",0).edit().putBoolean("requested",false).commit();context.stopService(new Intent(context,RuntimeService.class));}
    private boolean claimRecovery(){
        android.content.SharedPreferences p=getSharedPreferences("runtime",0);long now=System.currentTimeMillis(),window=p.getLong("recoveryWindow",0);int attempts=p.getInt("recoveryAttempts",0);
        if(!RuntimePolicy.mayRecover(now,window,attempts)){update("十分钟内已恢复三次，请打开诊断检查；自动恢复已暂缓");return false;}
        if(RuntimePolicy.resetWindow(now,window)){window=now;attempts=0;}
        return p.edit().putLong("recoveryWindow",window).putInt("recoveryAttempts",attempts+1).commit();
    }
    private void update(String s){state=s;record(s);if(s.startsWith("基础环境检测通过")||s.startsWith("环境复检通过"))environmentProblem="";else if(s.contains("下载失败：")||s.contains("组件下载连接失败")||s.contains("空间不足")||s.contains("组件补齐未完成")||s.contains("环境复检未通过"))environmentProblem=s;try{Container.writePrivate(new File(getFilesDir(),"runtime-status.txt"),s+"\n"+logText());}catch(IOException ignored){}}
    private void resumeConnection(String reason){
        if(stopped||!running||!RuntimePolicy.resumeDue(lastResume,SystemClock.elapsedRealtime()))return;
        lastResume=SystemClock.elapsedRealtime();
        try{Container container=new Container(this);if(new File(container.root,".qq-rootfs-v1").isFile())container.resolver();}catch(Exception ignored){}
        java.net.HttpURLConnection c=null;
        try{
            c=(java.net.HttpURLConnection)new java.net.URL("http://127.0.0.1:13480/runtime/resume").openConnection();c.setConnectTimeout(1000);c.setReadTimeout(2000);c.setRequestMethod("POST");c.setRequestProperty("Authorization","Bearer "+new Secrets(this).ensure("internal"));c.setRequestProperty("Content-Type","application/json");c.setDoOutput(true);
            try(OutputStream out=c.getOutputStream()){out.write(("{\"reason\":\""+reason+"\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8));}
            if(c.getResponseCode()==200)getSharedPreferences("runtime",0).edit().putLong("lastNetworkResume",System.currentTimeMillis()).apply();
        }catch(Exception ignored){}finally{if(c!=null)c.disconnect();}
    }
    private JSONObject localState()throws Exception{
        java.net.HttpURLConnection c=(java.net.HttpURLConnection)new java.net.URL("http://127.0.0.1:13480/state").openConnection();c.setConnectTimeout(1000);c.setReadTimeout(2500);c.setRequestProperty("Authorization","Bearer "+new Secrets(this).ensure("internal"));
        try(InputStream in=c.getInputStream()){ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(bytes.size()+n>131072)throw new IOException("Local response too large");bytes.write(b,0,n);}return new JSONObject(bytes.toString("UTF-8"));}finally{c.disconnect();}
    }
    private void checkHealth(){if(stopped)return;long now=SystemClock.elapsedRealtime();
        if(RuntimePolicy.schedulingGap(lastHealthTick,now)){record("后台检查曾暂停超过90秒，可能被系统冻结或休眠；返回后已继续检查");getSharedPreferences("runtime",0).edit().putLong("lastSchedulingGap",System.currentTimeMillis()).apply();resumeConnection("wake");}lastHealthTick=now;
        if(background!=null)background.refresh();
        try{JSONObject s=localState();healthFailures=0;if(!s.optBoolean("connected")&&background!=null&&background.online())resumeConnection("health");getSharedPreferences("runtime",0).edit().putLong("lastHealthy",System.currentTimeMillis()).putBoolean("qqConnected",s.optBoolean("connected")).putString("healthStatus",s.optBoolean("connected")?"后台服务与QQ在线核验通过":"后台服务可达，QQ等待重新连接").apply();
            NotificationManager manager=getSystemService(NotificationManager.class);manager.notify(17,notification(s.optBoolean("connected")?"QQ在线 · 后台检查正常":"后台运行 · QQ正在连接"));
        }catch(Exception ignored){healthFailures++;if(healthFailures==3){record("连续三次本机健康检查未响应；保留仍运行的进程，避免重复启动QQ");getSharedPreferences("runtime",0).edit().putString("healthStatus","本机检查未响应，请检查省电限制或诊断").apply();}}
    }
    private Notification notification(String message){
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this,"runtime").setSmallIcon(android.R.drawable.stat_notify_sync).setContentTitle("七丘 QQ 工作台").setContentText(message).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).build();
    }
    private void supervise(){try{
        Secrets vault=new Secrets(this);network=new NativeNetwork(vault.ensure("internal"),this);
        // If Android recreated this service while the isolated session survived,
        // adopt it instead of starting a second QQ. Tokens remain in Keystore.
        try{localState();adopted=true;}catch(Exception ignored){}
        if(adopted){update("已接管仍在运行的本机QQ会话");while(!stopped)Thread.sleep(15000);return;}
        int exit;
        do{
            exit=launchOnce();
            if(!RuntimePolicy.unexpectedExit(exit,stopped)||!claimRecovery())break;
            int attempt=getSharedPreferences("runtime",0).getInt("recoveryAttempts",1);update("本机进程异常退出，稍后自动恢复（最多三次/十分钟）…");Thread.sleep(RuntimePolicy.retryDelay(attempt));
        }while(!stopped);
        if(!stopped&&exit==75)update("已有本机会话持有运行锁，未重复启动QQ；请到诊断检查");
    }catch(Exception|LinkageError e){if(!stopped)update("启动失败："+e.getClass().getSimpleName()+" · "+e.getMessage());}
    finally{
        java.lang.Process survivor=process;
        if(!stopped&&survivor!=null&&survivor.isAlive()){requestShutdown();survivor.destroy();try{if(!survivor.waitFor(3,TimeUnit.SECONDS))survivor.destroyForcibly();}catch(InterruptedException ignored){Thread.currentThread().interrupt();}}
        if(network!=null){network.close();network=null;}running=false;process=null;if(!stopped)stopSelf();}}
    private int launchOnce()throws Exception{
        Container container=new Container(this);container.prepare(this::update);if(stopped||Thread.currentThread().isInterrupted())return 0;
        container.selectRuntimeMode(this::update);if(stopped||Thread.currentThread().isInterrupted())return 0;Secrets vault=new Secrets(this);
        JSONObject selected=new ApiProfiles(this).active();
        File configFile=new File(getFilesDir(),"linux/rootfs/opt/qq-workbench/settings.json");JSONObject current=configFile.isFile()?new JSONObject(new String(java.nio.file.Files.readAllBytes(configFile.toPath()),java.nio.charset.StandardCharsets.UTF_8)):new JSONObject();JSONObject apiSettings=ApiProfiles.settings(selected);for(java.util.Iterator<String> it=apiSettings.keys();it.hasNext();){String k=it.next();current.put(k,apiSettings.get(k));}Container.writePrivate(configFile,current.toString());
        Map<String,String> env=new HashMap<>();env.put("WORKBENCH_TOKEN",vault.ensure("internal"));env.put("DEEPSEEK_API_KEY",selected.optString("apiKey"));env.put("VISION_API_KEY",selected.optString("visionKey"));env.put("SPEECH_API_KEY",vault.get("speech"));env.put("FEIYU_API_KEY",vault.get("feiyu"));
        env.put("QQWB_ACCOUNT_PROFILES",new AccountProfiles(this).list().toString());env.put("QQWB_ANDROID_NETWORK","1");env.put("QQWB_SITE_COOKIES",vault.get("site-cookies"));
        env.put("WORKBENCH_MEMORY_KEY",vault.ensure("conversation-memory"));env.put("QQWB_TIME_ZONE",java.util.TimeZone.getDefault().getID());
        env.put("VNC_PASSWORD",vault.ensure("vnc").substring(0,8));
        env.put("QQWB_APT_PROXY",getSharedPreferences("settings",0).getString("setupProxy",""));
        update("检查 Linux QQ 与图形组件…");
        process=container.start("exec flock -n -E 75 /opt/qq-workbench/.runtime.lock bash -c 'bash /opt/qq-workbench/install.sh && exec bash /opt/qq-workbench/session.sh'",env);
        if(stopped){process.destroy();return 0;}
        try(BufferedReader in=new BufferedReader(new InputStreamReader(process.getInputStream()))){String line;while((line=in.readLine())!=null){
            // Raw upstream logs can contain account and bootstrap details; publish explicit phases only.
            if(line.startsWith("QQWB:"))update(line.substring(5));
            else if(line.contains("error while loading shared libraries")||line.contains("EADDRINUSE")||line.contains("PTRACE_")||line.startsWith("E:")||line.contains("Segmentation fault")||line.contains("Permission denied"))record(line.substring(0,Math.min(line.length(),500)));
            else if(line.matches(".*(?:install|session)\\.sh: line [0-9]+:.*(?:syntax error|command not found|bad interpreter).*"))record("启动脚本错误："+line.replaceAll("[^\\p{L}\\p{N} /_.:()\\-]","?").substring(0,Math.min(line.length(),500)));
        }}
        int code=process.waitFor();process=null;if(!stopped)update("运行已停止（退出码 "+code+"）"+(environmentProblem.isEmpty()?"，请查看诊断后重试":" · "+environmentProblem));return code;
    }
    private void requestShutdown(){
        java.net.HttpURLConnection c=null;
        try{c=(java.net.HttpURLConnection)new java.net.URL("http://127.0.0.1:13480/shutdown").openConnection();c.setConnectTimeout(1000);c.setReadTimeout(1500);c.setRequestMethod("POST");c.setRequestProperty("Authorization","Bearer "+new Secrets(this).ensure("internal"));c.getResponseCode();}
        catch(Exception ignored){}finally{if(c!=null)c.disconnect();}
    }
    public void onTaskRemoved(Intent rootIntent){record("界面已离开最近任务，后台服务继续运行；系统强行停止仍会终止它");super.onTaskRemoved(rootIntent);}
    public void onDestroy(){stopped=true;java.lang.Process p=process;stopping=p!=null||adopted;
        if(stopping){state="正在停止本地服务…";new Thread(()->{try{requestShutdown();if(p!=null&&!p.waitFor(7,TimeUnit.SECONDS)){p.destroy();if(!p.waitFor(3,TimeUnit.SECONDS))p.destroyForcibly();}}catch(Exception ignored){}finally{stopping=false;state="已停止";}}).start();}
        if(background!=null)background.close();health.shutdownNow();worker.shutdownNow();if(wake!=null&&wake.isHeld())wake.release();running=false;super.onDestroy();}
}
