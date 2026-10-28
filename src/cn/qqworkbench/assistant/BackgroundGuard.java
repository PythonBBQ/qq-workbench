package cn.qqworkbench.assistant;

import android.content.*;
import android.net.*;
import android.net.wifi.WifiManager;
import android.os.PowerManager;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Owned by the foreground service, never the Activity. No screen-on lock or polling alarm. */
final class BackgroundGuard implements AutoCloseable {
    private final Context context;
    private final ScheduledExecutorService executor;
    private final Consumer<String> recover;
    private final ConnectivityManager connectivity;
    private final PowerManager power;
    private WifiManager.WifiLock wifi;
    private ConnectivityManager.NetworkCallback callback;
    private BroadcastReceiver receiver;
    private ScheduledFuture<?> pending;
    private boolean closed;
    private String observed="",dns="";
    BackgroundGuard(Context context,ScheduledExecutorService executor,Consumer<String> recover){
        this.context=context.getApplicationContext();this.executor=executor;this.recover=recover;
        connectivity=this.context.getSystemService(ConnectivityManager.class);power=this.context.getSystemService(PowerManager.class);
    }
    void start(){
        try{WifiManager manager=context.getSystemService(WifiManager.class);if(manager!=null){wifi=manager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF,"qqworkbench:wifi");wifi.setReferenceCounted(false);}}catch(RuntimeException ignored){}
        callback=new ConnectivityManager.NetworkCallback(){
            public void onAvailable(Network network){signal("network");}
            public void onLost(Network network){signal("network");}
            public void onCapabilitiesChanged(Network network,NetworkCapabilities caps){
                String next=network.toString()+":"+caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)+":"+caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
                synchronized(BackgroundGuard.this){if(next.equals(observed))return;observed=next;}signal("network");
            }
            public void onLinkPropertiesChanged(Network network,LinkProperties properties){
                String next=network.toString()+":"+properties.getDnsServers().toString();
                synchronized(BackgroundGuard.this){if(next.equals(dns))return;dns=next;}signal("network");
            }
        };
        try{connectivity.registerDefaultNetworkCallback(callback);}catch(RuntimeException e){RuntimeService.record("系统网络监听暂不可用，将继续定时检查");callback=null;}
        receiver=new BroadcastReceiver(){public void onReceive(Context c,Intent i){signal(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED.equals(i.getAction())?"idle":"wake");}};
        IntentFilter filter=new IntentFilter();filter.addAction(Intent.ACTION_SCREEN_ON);filter.addAction(Intent.ACTION_USER_PRESENT);filter.addAction(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED);
        if(android.os.Build.VERSION.SDK_INT>=33)context.registerReceiver(receiver,filter,Context.RECEIVER_NOT_EXPORTED);else context.registerReceiver(receiver,filter);
        refresh();
    }
    synchronized void signal(String reason){
        if(closed)return;if(pending!=null)pending.cancel(false);
        try{pending=executor.schedule(()->{synchronized(BackgroundGuard.this){if(closed)return;}refresh();if(online()&&!power.isDeviceIdleMode())recover.accept(reason);},1500,TimeUnit.MILLISECONDS);}catch(RejectedExecutionException ignored){}
    }
    boolean online(){try{NetworkCapabilities caps=connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());return caps!=null&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);}catch(RuntimeException e){return false;}}
    synchronized void refresh(){
        if(closed)return;
        try{
            NetworkCapabilities caps=connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());
            boolean needed=caps!=null&&caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
            if(wifi!=null){if(needed&&!wifi.isHeld())wifi.acquire();else if(!needed&&wifi.isHeld())wifi.release();}
            context.getSharedPreferences("runtime",0).edit().putBoolean("wifiProtected",wifi!=null&&wifi.isHeld()).putBoolean("networkAvailable",online()).putBoolean("deviceIdle",power.isDeviceIdleMode()).apply();
        }catch(RuntimeException e){RuntimeService.record("Wi-Fi休眠保护暂不可用，检查系统后台限制");}
    }
    public synchronized void close(){
        if(closed)return;closed=true;if(pending!=null)pending.cancel(false);
        if(callback!=null)try{connectivity.unregisterNetworkCallback(callback);}catch(RuntimeException ignored){}
        if(receiver!=null)try{context.unregisterReceiver(receiver);}catch(RuntimeException ignored){}
        if(wifi!=null&&wifi.isHeld())try{wifi.release();}catch(RuntimeException ignored){}
        context.getSharedPreferences("runtime",0).edit().putBoolean("wifiProtected",false).apply();
    }
}
