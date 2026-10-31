package cn.qqworkbench.assistant;

import android.app.Service;
import android.content.Intent;
import android.os.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.*;

/** Native model failures are isolated from the UI, foreground runtime and QQ. */
public final class LocalVoiceService extends Service {
    private final ExecutorService jobs=Executors.newSingleThreadExecutor();
    private Messenger messenger;
    private final Handler cleanup=new Handler(Looper.getMainLooper());
    public void onCreate(){super.onCreate();File[] old=getCacheDir().listFiles();if(old!=null)for(File f:old)if(f.getName().matches("local-voice-output-[a-f0-9-]{36}\\.wav")&&System.currentTimeMillis()-f.lastModified()>120000)f.delete();messenger=new Messenger(new Handler(Looper.getMainLooper()){
        public void handleMessage(Message msg){if(msg.replyTo==null)return;final Messenger reply=msg.replyTo;final String request=msg.getData().getString("request","{}");final String operation=msg.getData().getString("operation","");jobs.execute(()->{JSONObject result;File output=null;try{LocalVoice local=LocalVoice.get(LocalVoiceService.this);JSONObject data=new JSONObject(request);
            if(operation.equals("state"))result=local.state(data.optInt("slot"));else if(operation.equals("release")){local.release();result=new JSONObject().put("ok",true);}else if(operation.equals("synthesize")){result=local.synthesize(data);output=new File(getCacheDir(),"local-voice-output-"+UUID.randomUUID()+".wav");Files.write(output.toPath(),Base64.decode(result.getString("audio"),Base64.DEFAULT));result.remove("audio");result.put("file",output.getName());}else throw new IOException("语音操作无效");
        }catch(Exception|LinkageError e){result=new JSONObject();try{result.put("ok",false).put("message",e.getMessage()==null?"语音合成未完成":e.getMessage());}catch(Exception ignored){}}
        if(output!=null){File stale=output;cleanup.postDelayed(()->stale.delete(),120000);}
        try{Message response=Message.obtain();Bundle bundle=new Bundle();bundle.putString("result",result.toString());response.setData(bundle);reply.send(response);}catch(Exception e){if(output!=null)output.delete();}});}
    });}
    public IBinder onBind(Intent i){return messenger.getBinder();}
    public void onDestroy(){jobs.shutdownNow();LocalVoice.get(this).release();super.onDestroy();}
}
