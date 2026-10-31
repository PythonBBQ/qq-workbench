package cn.qqworkbench.assistant;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Uses the installed Android speech engine; does not invoke a chat model. */
final class NativeSpeech implements AutoCloseable {
    private final Context context;
    private TextToSpeech engine;
    NativeSpeech(Context context){this.context=context.getApplicationContext();}
    private void ready()throws Exception{
        if(engine!=null)return;
        CountDownLatch done=new CountDownLatch(1);final int[] result={TextToSpeech.ERROR};
        TextToSpeech created=new TextToSpeech(context,status->{result[0]=status;done.countDown();});
        if(!done.await(15,TimeUnit.SECONDS)||result[0]!=TextToSpeech.SUCCESS){created.shutdown();throw new IOException("系统语音引擎不可用，请在安卓文字转语音设置安装并启用引擎");}
        engine=created;
    }
    synchronized JSONObject state()throws Exception{
        ready();JSONArray voices=new JSONArray();Set<Voice> all=engine.getVoices();
        if(all!=null)for(Voice v:all){String language=v.getLocale().getLanguage();if(!Arrays.asList("zh","ja","ko","en").contains(language))continue;
            voices.put(new JSONObject().put("id",v.getName()).put("language",v.getLocale().toLanguageTag()).put("network",v.isNetworkConnectionRequired()));if(voices.length()>=80)break;}
        return new JSONObject().put("ok",true).put("provider","android").put("voices",voices).put("message","系统语音引擎可用；音色和离线能力由已安装引擎提供");
    }
    synchronized JSONObject synthesize(JSONObject request)throws Exception{
        ready();String text=request.optString("text").trim();if(text.isEmpty()||text.length()>1200)throw new IOException("语音文字需为1到1200字");
        String selected=request.optString("voice"),language=request.optString("language","zh-CN");boolean found=false;
        Set<Voice> voices=engine.getVoices();if(!selected.isEmpty()&&voices!=null)for(Voice v:voices)if(v.getName().equals(selected)){if(engine.setVoice(v)!=TextToSpeech.SUCCESS)throw new IOException("所选系统音色不可用");found=true;break;}
        if(!selected.isEmpty()&&!found)throw new IOException("所选系统音色已变化，请重新选择");
        if(!found&&engine.setLanguage(Locale.forLanguageTag(language))<TextToSpeech.LANG_AVAILABLE)throw new IOException("系统缺少此语言语音数据，请在文字转语音设置下载，或选择Azure语音");
        float rate=(float)Math.max(.6,Math.min(1.6,1+request.optDouble("rate",0)/100));float pitch=(float)Math.max(.7,Math.min(1.3,1+request.optDouble("pitch",0)/100));engine.setSpeechRate(rate);engine.setPitch(pitch);
        File target=new File(context.getCacheDir(),"tts-"+UUID.randomUUID()+".wav");CountDownLatch done=new CountDownLatch(1);final boolean[] ok={false};String id=UUID.randomUUID().toString();
        engine.setOnUtteranceProgressListener(new UtteranceProgressListener(){public void onStart(String u){}public void onDone(String u){if(id.equals(u)){ok[0]=true;done.countDown();}}public void onError(String u){if(id.equals(u))done.countDown();}public void onError(String u,int code){onError(u);}});
        try{
            if(engine.synthesizeToFile(text,new Bundle(),target,id)!=TextToSpeech.SUCCESS)throw new IOException("系统语音未开始合成");
            if(!done.await(45,TimeUnit.SECONDS)||!ok[0]){engine.stop();throw new IOException("系统语音合成失败或超时，请检查语言包和网络");}
            if(target.length()<44||target.length()>6*1024*1024)throw new IOException("系统语音文件无效或过大");
            byte[] data=java.nio.file.Files.readAllBytes(target.toPath());
            if(data[0]!='R'||data[1]!='I'||data[2]!='F'||data[3]!='F')throw new IOException("系统语音未返回WAV音频");
            return new JSONObject().put("ok",true).put("format","wav").put("audio",Base64.encodeToString(data,Base64.NO_WRAP));
        }finally{target.delete();engine.setOnUtteranceProgressListener(null);}
    }
    public synchronized void close(){if(engine!=null){engine.stop();engine.shutdown();engine=null;}}
}
