package cn.qqworkbench.assistant;

import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import org.json.*;
import java.io.*;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import rikka.shizuku.Shizuku;

final class DeviceTools {
    static DeviceTools instance;
    static synchronized DeviceTools get(Context c){if(instance==null)instance=new DeviceTools(c.getApplicationContext());return instance;}
    final Context context;final Handler main=new Handler(Looper.getMainLooper());final Object lock=new Object();
    volatile IBinder remote;volatile boolean binding;volatile long bindAt;
    final Shizuku.UserServiceArgs args;
    final ServiceConnection connection=new ServiceConnection(){
        public void onServiceConnected(ComponentName name,IBinder binder){synchronized(lock){remote=binder;binding=false;lock.notifyAll();}}
        public void onServiceDisconnected(ComponentName name){synchronized(lock){remote=null;binding=false;lock.notifyAll();}}
    };
    DeviceTools(Context c){context=c;args=new Shizuku.UserServiceArgs(new ComponentName(c,DeviceShellService.class)).daemon(false).tag("qqwb-device-tools").version(28).processNameSuffix("device_shell");}
    JSONObject state(){JSONObject s=new JSONObject();try{boolean alive=Shizuku.pingBinder(),granted=alive&&Shizuku.checkSelfPermission()==PackageManager.PERMISSION_GRANTED;
        s.put("installed",context.getPackageManager().getLaunchIntentForPackage("moe.shizuku.privileged.api")!=null).put("running",alive).put("granted",granted).put("uid",granted?Shizuku.getUid():-1).put("ready",remote!=null&&remote.isBinderAlive());
        s.put("message",!alive?"请先在Shizuku中启动服务":!granted?"请允许工作台使用Shizuku":"Shizuku已授权，设备动作可用");
    }catch(Exception ignored){}return s;}
    void requestPermission(){if(!Shizuku.pingBinder())throw new IllegalStateException("请先启动Shizuku");if(Shizuku.checkSelfPermission()!=PackageManager.PERMISSION_GRANTED)Shizuku.requestPermission(706);else ensureBound();}
    void ensureBound(){if(binding&&SystemClock.elapsedRealtime()-bindAt<8000||remote!=null&&remote.isBinderAlive())return;binding=true;bindAt=SystemClock.elapsedRealtime();main.post(()->{try{Shizuku.bindUserService(args,connection);}catch(Exception e){synchronized(lock){binding=false;lock.notifyAll();}}});}
    JSONObject config()throws Exception{
        for(File file:new File[]{new File(context.getFilesDir(),"linux/rootfs/opt/qq-workbench/settings.json"),new File(context.getFilesDir(),"settings.json")})if(file.isFile())return new JSONObject(new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8));
        throw new IOException("设置尚未准备");
    }
    void verify(JSONObject request)throws Exception{
        JSONObject c=config();String owner=c.optString("owner");
        if(!c.optBoolean("deviceToolsEnabled")||!owner.matches("[1-9][0-9]{4,11}")||!owner.equals(request.optString("sender")))throw new SecurityException("设备操作仅限当前真实大号，并需在设置开启");
    }
    synchronized JSONObject run(JSONObject request)throws Exception{
        verify(request);JSONObject action=request.getJSONObject("operation");DeviceCommand.args(action);
        if(!state().optBoolean("granted"))return new JSONObject().put("ok",false).put("message",state().optString("message","请先授权Shizuku"));
        ensureBound();long deadline=SystemClock.elapsedRealtime()+7000;
        synchronized(lock){while((remote==null||!remote.isBinderAlive())&&binding&&SystemClock.elapsedRealtime()<deadline)lock.wait(Math.max(1,deadline-SystemClock.elapsedRealtime()));}
        if(remote==null||!remote.isBinderAlive())return new JSONObject().put("ok",false).put("message","设备服务尚未连接，请打开设置重新检查Shizuku");
        verify(request);String id=request.getString("id");if(!id.matches("[a-f0-9]{64}"))throw new Exception("动作标识无效");
        SharedPreferences journal=context.getSharedPreferences("device-actions",0);
        if(journal.contains(id))return new JSONObject().put("ok",false).put("message","此设备动作已处理，不重复执行");
        SharedPreferences.Editor edit=journal.edit();if(journal.getAll().size()>256){long oldest=Long.MAX_VALUE;String key=null;for(java.util.Map.Entry<String,?> e:journal.getAll().entrySet())if(e.getValue() instanceof Long&&(Long)e.getValue()<oldest){key=e.getKey();oldest=(Long)e.getValue();}if(key!=null)edit.remove(key);}
        if(!edit.putLong(id,System.currentTimeMillis()).commit())throw new Exception("动作记录无法保存，尚未执行");
        Parcel data=Parcel.obtain(),reply=Parcel.obtain();
        try{data.writeInterfaceToken(DeviceShellService.DESCRIPTOR);data.writeString(action.toString());if(!remote.transact(1,data,reply,0))throw new RemoteException();reply.readException();JSONObject result=new JSONObject(reply.readString());
            context.getSharedPreferences("device",0).edit().putString("lastAction",action.getString("action")).putLong("lastAt",System.currentTimeMillis()).putBoolean("lastOk",result.optBoolean("ok")).apply();return result;
        }catch(Exception e){return new JSONObject().put("ok",false).put("uncertain",true).put("message","设备动作结果未确认，不自动重试");}finally{data.recycle();reply.recycle();}
    }
}
