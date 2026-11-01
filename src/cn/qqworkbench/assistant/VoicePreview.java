package cn.qqworkbench.assistant;

import org.json.*;
import android.util.Base64;

/** Local synthesis only: never routes a preview through QQ or an LLM. */
final class VoicePreview {
    static void cancel(MainActivity a){a.voicePreviewGeneration++;if(a.voicePreview!=null){a.voicePreview.release();a.voicePreview=null;}}
    static void ready(MainActivity a,int slot,JSONObject settings,String mood){play(a,slot,settings,settings.optString("voiceEmotionPreset","auto").equals("auto")?mood:settings.optString("voiceEmotionPreset"),"准备好了。");}
    static void imported(MainActivity a,int slot,String mood){try{JSONObject c=a.currentConfig();if(slot!=0){JSONArray all=new AccountProfiles(a).list();c=new JSONObject();for(int i=0;i<all.length();i++)if(all.getJSONObject(i).optInt("slot")==slot)c=all.getJSONObject(i);}c=new JSONObject(c.toString()).put("speechProvider","zipvoice");ready(a,slot,c,mood);}catch(Exception e){a.toast("参考已保存，稍后可在语音页试听");}}
    static JSONObject request(int slot,JSONObject c,String mood,String text)throws Exception{
        if(slot<0||slot>3)throw new IllegalArgumentException("账号无效");String provider=c.optString("speechProvider");if(!provider.equals("zipvoice")&&!provider.equals("kokoro")&&!provider.equals("android"))throw new IllegalArgumentException("请先保存服务音色，再使用服务试听");
        return new JSONObject().put("slot",slot).put("provider",provider).put("speaker",c.optInt("kokoroSpeaker",3)).put("text",text).put("emotion",mood).put("steps",c.optInt("zipVoiceSteps",8)).put("rate",c.optInt("speechRate",0)).put("phrasing",true).put("voice",c.optString("androidVoice")).put("language","zh-CN").put("pitch",c.optInt("speechPitch",0));
    }
    static void play(MainActivity a,int slot,JSONObject settings,String mood,String text){
        final JSONObject request;try{request=request(slot,settings,mood,text);}catch(Exception e){a.toast(e.getMessage());return;}
        cancel(a);final int generation=a.voicePreviewGeneration;a.toast("正在准备本机试听…");
        a.io.submit(()->{if(a.destroyed||generation!=a.voicePreviewGeneration)return;try{JSONObject result=LocalVoiceClient.call(a,"synthesize",request);byte[] audio=Base64.decode(result.getString("audio"),Base64.DEFAULT);a.runOnUiThread(()->{if(a.destroyed||generation!=a.voicePreviewGeneration)return;try{a.playVoice(audio,request.optString("provider").equals("zipvoice")?(float)(1+request.optDouble("pitch",0)/100):1f);}catch(Exception e){a.toast("试听播放未完成，请再试一次");}});}catch(Exception e){a.runOnUiThread(()->{if(!a.destroyed&&generation==a.voicePreviewGeneration)a.toast("试听未完成："+e.getMessage());});}});
    }
}
