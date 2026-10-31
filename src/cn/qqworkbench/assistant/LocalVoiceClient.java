package cn.qqworkbench.assistant;

import android.content.*;
import android.os.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.file.Files;
import java.util.concurrent.*;

final class LocalVoiceClient {
    static JSONObject call(Context context,String operation,JSONObject request)throws Exception{
        CountDownLatch done=new CountDownLatch(1);JSONObject[] result={null};java.util.concurrent.atomic.AtomicBoolean waiting=new java.util.concurrent.atomic.AtomicBoolean(true),dispatched=new java.util.concurrent.atomic.AtomicBoolean(false);
        JSONObject body=new JSONObject(request.toString()).put("localDeadline",SystemClock.elapsedRealtime()+60000);
        Messenger reply=new Messenger(new Handler(Looper.getMainLooper()) {public void handleMessage(Message msg){try{JSONObject value=new JSONObject(msg.getData().getString("result","{}"));if(waiting.get())result[0]=value;else discard(context,value);}catch(Exception ignored){}done.countDown();}});
        ServiceConnection connection=new ServiceConnection(){public void onServiceConnected(ComponentName name,IBinder binder){if(!waiting.get()||!dispatched.compareAndSet(false,true)){done.countDown();return;}try{Message message=Message.obtain();message.replyTo=reply;Bundle data=new Bundle();data.putString("operation",operation);data.putString("request",body.toString());message.setData(data);new Messenger(binder).send(message);}catch(Exception e){done.countDown();}}public void onServiceDisconnected(ComponentName name){done.countDown();}public void onBindingDied(ComponentName name){done.countDown();}public void onNullBinding(ComponentName name){done.countDown();}};
        boolean bound=context.bindService(new Intent(context,LocalVoiceService.class),connection,Context.BIND_AUTO_CREATE);
        if(!bound)throw new IOException("语音独立服务未启动");
        try{if(!done.await(operation.equals("state")?8:65,TimeUnit.SECONDS)||result[0]==null)throw new IOException("语音独立服务未完成，本条使用文字；QQ继续运行");JSONObject r=result[0];if(!r.optBoolean("ok"))throw new IOException(r.optString("message","语音合成未完成"));
            if(r.has("file")){String name=r.getString("file");if(!name.matches("local-voice-output-[a-f0-9-]{36}\\.wav"))throw new IOException("语音输出文件无效");File file=new File(context.getCacheDir(),name);try{if(file.length()<44||file.length()>6*1024*1024)throw new IOException("语音输出大小无效");r.put("audio",Base64.encodeToString(Files.readAllBytes(file.toPath()),Base64.NO_WRAP));r.remove("file");}finally{file.delete();}}
            return r;
        }finally{waiting.set(false);if(result[0]!=null)discard(context,result[0]);new Handler(Looper.getMainLooper()).postDelayed(()->{try{context.unbindService(connection);}catch(Exception ignored){}},result[0]!=null&&result[0].optBoolean("ok")?65000:0);}
    }
    private static void discard(Context c,JSONObject r){String name=r.optString("file");if(name.matches("local-voice-output-[a-f0-9-]{36}\\.wav"))new File(c.getCacheDir(),name).delete();}
}
