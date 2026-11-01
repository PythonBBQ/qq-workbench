package cn.qqworkbench.assistant;

import android.content.*;
import android.os.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.lang.reflect.*;

/** Real ARM64 synthesis in a separate test directory; never changes live voices. */
public final class CharacterPresetProbe {
    public static void main(String[] args)throws Exception{
        System.out.println("QQWB_CHARACTER_PROBE_START");
        if((args.length!=2&&args.length!=3)||!args[0].matches("[a-z0-9-]{1,48}"))throw new IOException("Probe identifier and package path required");
        Looper.prepareMainLooper();Class<?> at=Class.forName("android.app.ActivityThread");Constructor<?> ctor=at.getDeclaredConstructor();ctor.setAccessible(true);Object thread=ctor.newInstance();Method system=at.getDeclaredMethod("getSystemContext");system.setAccessible(true);
        Context app=((Context)system.invoke(thread)).createPackageContext("cn.qqworkbench.assistant",Context.CONTEXT_IGNORE_SECURITY);
        System.out.println("QQWB_CHARACTER_PROBE_CONTEXT");
        File test=new File(app.getFilesDir(),"voice-preset-probe-"+args[0]);if(test.exists())throw new IOException("Use a new isolated probe identifier");if(!test.mkdir())throw new IOException("Probe directory unavailable");
        File modelLink=new File(test,"zipvoice-models-v1");android.system.Os.symlink(new File(app.getFilesDir(),"zipvoice-models-v1").getPath(),modelLink.getPath());
        Context isolated=new ContextWrapper(app){public File getFilesDir(){return test;}public Context getApplicationContext(){return this;}};
        System.load(app.getApplicationInfo().nativeLibraryDir+"/libsherpa-onnx-jni.so");
        System.out.println("QQWB_CHARACTER_PROBE_NATIVE");
        LocalVoice voice=LocalVoice.get(isolated);try(InputStream in=new FileInputStream(args[1])){voice.installPack(0,in);}try(InputStream in=new FileInputStream(args[1])){voice.installPack(1,in);}
        String primary=new String(Files.readAllBytes(new File(test,"voice-references/slot-0/neutral.json").toPath()),StandardCharsets.UTF_8);voice.removeReference(1,"neutral");if(!primary.equals(new String(Files.readAllBytes(new File(test,"voice-references/slot-0/neutral.json").toPath()),StandardCharsets.UTF_8)))throw new IOException("Account reference isolation failed");
        File outputs=new File(test,"outputs");outputs.mkdir();JSONObject report=new JSONObject().put("scope","isolated-real-tablet-synthesis-no-live-profile-change").put("slotIsolation",true).put("samples",new JSONArray());
        String[] moods={"neutral","happy","gentle","shy","sad","serious"};
        String[] texts={"嗯，我在这里呢，今天想聊点什么？","太好啦，今天的事情终于做好了！","没关系，你慢慢说，我会认真听的。","诶，你这样夸我，我会有点不好意思的。","今天有点难过，可以陪我坐一会儿吗？","先等一下，我们把这件事情说清楚。"};
        String[] secondTexts={"你回来啦，想先吃饭还是休息一下？","嘿嘿，今天这么顺利，真让人高兴。","今天辛苦了，先照顾好自己再说吧。","嗯，我听见啦，你先让我想一想嘛。","唉，没关系的，我只是想安静一会。","现在先把情况确认清楚，再决定下一步。"};
        String[] acknowledgments={"嗯。","诶？","啊！","啊。","嘿嘿。","嘿嘿。","嘻嘻。","啊。","呜。"};String[] ackMoods={"gentle","neutral","happy","gentle","shy","happy","shy","neutral","sad"};
        JSONObject manifest=new JSONObject(new String(Files.readAllBytes(new File(test,"voice-references/slot-0/pack.json").toPath()),StandardCharsets.UTF_8));
        if(args.length==3&&args[2].equals("quality")){
            for(int i:new int[]{0,2,3})render(voice,outputs,report,"quality-"+moods[i],new JSONObject().put("slot",0).put("text",i==2?"今天辛苦啦，先坐下来休息一下吧。等你准备好了，我们再慢慢聊。":texts[i]).put("emotion",moods[i]).put("referenceVariant",0).put("steps",8).put("rate",0).put("deliveryStyle","normal").put("phrasing",true),false);
            render(voice,outputs,report,"quality-long",new JSONObject().put("slot",0).put("text","嗯，你先别着急，我们把最重要的事情做好，剩下的可以慢慢来。你刚才说的话我有认真听，等你休息好了，我们再一起想想下一步。").put("emotion","gentle").put("referenceVariant",0).put("steps",8).put("rate",0).put("deliveryStyle","normal").put("phrasing",true),false);
        }else if(args.length==3&&args[2].equals("ready")){
            render(voice,outputs,report,"ready",VoicePreview.request(0,new JSONObject().put("speechProvider","zipvoice").put("speechRate",manifest.optString("engine").equals("feiyu-index-rvc")?-30:-15).put("zipVoiceSteps",4),"neutral","准备好了。"),false);
        }else if(args.length==3&&args[2].equals("long")){
            for(int steps:new int[]{4,8}){
                render(voice,outputs,report,"long-shy-"+steps,new JSONObject().put("slot",0).put("text","嗯，你这样说，我会有一点不好意思的。不过我有认真听你讲，刚才那件事情不用着急，我们可以慢慢把它做好。").put("emotion","shy").put("referenceVariant",0).put("steps",steps).put("rate",-15).put("phrasing",true),false);
                render(voice,outputs,report,"long-gentle-"+steps,new JSONObject().put("slot",0).put("text","今天辛苦啦，先坐下来休息一下吧。想吃什么可以告诉我，等你休息好了，我们再一起想想明天要做的事情，好不好？").put("emotion","gentle").put("referenceVariant",2).put("steps",steps).put("rate",-15).put("phrasing",true),false);
            }
            render(voice,outputs,report,"long-soft-4",new JSONObject().put("slot",0).put("text","嗯，闭上眼睛，慢慢放松，今天的事情就先放在一边吧。你已经很努力了，不需要现在把所有事情都想明白。让肩膀放松一点，呼吸也慢一点，我就在这里陪你。等明天醒来以后，我们再慢慢安排接下来的事情。晚安，今晚安心睡个好觉。").put("emotion","gentle").put("deliveryStyle","soft").put("steps",4).put("rate",-15).put("phrasing",true),false);
        }else if(args.length==3&&args[2].startsWith("calibrate")){
            boolean second=args[2].endsWith("-b");for(int strength:new int[]{1,2,3})for(String mood:moods)render(voice,outputs,report,mood+"-g"+strength+"-4"+(second?"b":""),new JSONObject().put("slot",0).put("text",second?"明天想吃什么？我可以陪你一起慢慢挑。":"今天辛苦啦，先休息一下，等会儿我们再慢慢聊。").put("emotion",mood).put("referenceVariant",0).put("guidanceScale",strength).put("skipOriginalOpening",true).put("steps",4).put("rate",-15).put("phrasing",true),false);
            if(!second)for(int strength:new int[]{1,3})for(String mood:new String[]{"shy","gentle"})render(voice,outputs,report,mood+"-g"+strength+"-8",new JSONObject().put("slot",0).put("text","今天辛苦啦，先休息一下，等会儿我们再慢慢聊。").put("emotion",mood).put("referenceVariant",0).put("guidanceScale",strength).put("skipOriginalOpening",true).put("steps",8).put("rate",-15).put("phrasing",true),false);
        }else if(args.length==3&&args[2].equals("fragile")){
            for(int strength:new int[]{1,2,3})for(int steps:new int[]{4,8})for(int i:new int[]{2,3})for(int sentence=0;sentence<2;sentence++)render(voice,outputs,report,moods[i]+"-v"+(i==2?6:2)+"-g"+strength+"-"+steps+(sentence==1?"b":""),new JSONObject().put("slot",0).put("text",sentence==0?texts[i]:secondTexts[i]).put("emotion",moods[i]).put("referenceVariant",i==2?6:2).put("guidanceScale",strength).put("steps",steps).put("rate",-15).put("phrasing",true),false);
        }else if(args.length==3&&args[2].equals("focus")){
            for(int steps:new int[]{4,8})for(int i:new int[]{3,5})for(int sentence=0;sentence<2;sentence++)render(voice,outputs,report,moods[i]+"-v"+(i==3?7:4)+"-"+steps+(sentence==1?"b":""),new JSONObject().put("slot",0).put("text",sentence==0?texts[i]:secondTexts[i]).put("emotion",moods[i]).put("referenceVariant",i==3?7:4).put("steps",steps).put("requestedSteps",steps).put("rate",-15).put("phrasing",true),false);
        }else{
            for(int i=0;i<acknowledgments.length;i++)render(voice,outputs,report,"original-"+i,new JSONObject().put("slot",0).put("text",acknowledgments[i]).put("skipOriginalAcknowledgment",false).put("emotion",ackMoods[i]).put("steps",4).put("rate",0),true);
            for(int steps:new int[]{4,8})for(int variant=0;variant<(steps==4?8:1);variant++)for(int i=0;i<moods.length;i++){
                JSONArray variants=manifest.optJSONObject("variants")==null?null:manifest.getJSONObject("variants").optJSONArray(moods[i]);if(variant>=(variants==null?1:variants.length()+1))continue;
                render(voice,outputs,report,moods[i]+"-v"+variant+"-"+steps,new JSONObject().put("slot",0).put("text",texts[i]).put("emotion",moods[i]).put("referenceVariant",variant).put("steps",steps).put("requestedSteps",steps).put("rate",-15).put("phrasing",true),false);
                if(steps==4)render(voice,outputs,report,moods[i]+"-v"+variant+"-4b",new JSONObject().put("slot",0).put("text",secondTexts[i]).put("emotion",moods[i]).put("referenceVariant",variant).put("steps",4).put("rate",-15).put("phrasing",true),false);
            }
            render(voice,outputs,report,"auto-soft-gentle-4",new JSONObject().put("slot",0).put("text","嗯，闭上眼睛，慢慢放松，今晚安心睡个好觉吧。").put("emotion","gentle").put("steps",4).put("rate",-15).put("phrasing",true),false);
            render(voice,outputs,report,"auto-soft-shy-4",new JSONObject().put("slot",0).put("text","啊，你还没睡呀，那我再轻声陪你说一会儿。").put("emotion","shy").put("steps",4).put("rate",-15).put("phrasing",true),false);
        }
        voice.release();Files.write(new File(outputs,"review.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));System.out.println("QQWB_CHARACTER_PRESET_OK "+new JSONObject().put("samples",report.getJSONArray("samples").length()).put("output",outputs.getPath()).put("liveProfileChanged",false).put("slotIsolation",true));System.exit(0);
    }
    static void render(LocalVoice voice,File dir,JSONObject report,String id,JSONObject request,boolean original)throws Exception{
        JSONObject result=voice.synthesize(request);if(!result.optBoolean("ok"))throw new IOException("Synthesis failed");if(original&&!result.has("originalAcknowledgment"))throw new IOException("Original acknowledgment was not used: "+id);
        byte[] audio=android.util.Base64.decode(result.getString("audio"),android.util.Base64.DEFAULT);Files.write(new File(dir,id+".wav").toPath(),audio);result.remove("audio");result.put("sample",id).put("request",request);report.getJSONArray("samples").put(result);Files.write(new File(dir,"review.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));System.out.println("QQWB_CHARACTER_SAMPLE "+id+" "+result.optLong("elapsedMs")+"ms "+result.optLong("durationMs")+"ms");
    }
}
