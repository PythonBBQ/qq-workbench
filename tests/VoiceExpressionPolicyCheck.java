package cn.qqworkbench.assistant;

import org.json.*;

/** Check actual preview requests and reference selection without loading a model. */
public final class VoiceExpressionPolicyCheck {
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args)throws Exception{
        JSONObject primary=new JSONObject().put("file","selected-anchor").put("text","你这样说，我会有点不好意思的。");
        JSONObject soft=new JSONObject().put("file","old-soft-variant").put("tags",new JSONArray().put("soft"));
        primary.put("alternatives",new JSONArray().put(new JSONObject(primary.toString())).put(soft));
        JSONObject settings=new JSONObject().put("speechProvider","zipvoice").put("zipVoiceModel","full").put("zipVoiceDeliveryPreset","t02-t06").put("speechRate",0).put("speechPitch",0);
        for(String mood:new String[]{"shy","intimate"}){
            JSONObject request=VoicePreview.request(0,settings,mood,"嗯，别走那么快嘛。");
            check(request.getBoolean("stableReference"));check(request.getString("emotion").equals("shy"));
            check(request.getInt("pitch")==0);check(request.getInt("rate")==("shy".equals(mood)?-5:-3));check(request.getInt("steps")==16);
            for(int sequence=0;sequence<8;sequence++)check(VoicePresetBank.synthesisReference(primary,"晚安，闭上眼。",sequence,request,true)==primary);
        }
        JSONObject request=VoicePreview.request(0,settings,"intimate","嗯。");request.put("referenceVariant",1);
        check(VoicePresetBank.synthesisReference(primary,"嗯。",0,request,true)==soft);
        check(VoicePresetBank.synthesisReference(primary,"晚安。",0,new JSONObject(),true)==soft);
        JSONObject single=new JSONObject().put("file","own-recording");
        check(VoicePresetBank.synthesisReference(single,"你好。",0,new JSONObject().put("stableReference",true),true)==single);
        JSONObject disabled=VoicePreview.request(0,new JSONObject(settings.toString()).put("voiceEmotion",false),"intimate","你好。");
        check(disabled.getString("emotion").equals("neutral"));check(!disabled.getBoolean("stableReference"));check(disabled.getInt("rate")==0);
        JSONObject ordinary=VoicePreview.request(0,settings,"neutral","晚安。");
        check(ordinary.getString("deliveryStyle").equals("normal"));
        JSONObject quiet=VoicePreview.request(0,settings,"neutral","闭上眼睛，安心睡吧。");
        check(quiet.getString("emotion").equals("gentle"));check(quiet.getString("deliveryStyle").equals("soft"));
        JSONObject system=VoicePreview.request(0,new JSONObject(settings.toString()).put("speechProvider","android").put("speechRate",4).put("speechPitch",2),"shy","你好。");
        check(system.getInt("rate")==-5);check(system.getInt("pitch")==3);
        JSONObject plain=VoicePreview.request(0,new JSONObject(settings.toString()).put("voiceNatural",false),"neutral","你好。");
        check(!plain.getBoolean("phrasing"));
        System.out.println("QQWB_VOICE_EXPRESSION_POLICY_OK: same anchor across utterances, explicit probe override, single reference, unchanged pitch, preview rates and disabled emotion");
    }
}
