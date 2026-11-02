package cn.qqworkbench.assistant;

import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

/** Local reference selection, with no chat-model call or invented vocal sounds. */
final class VoicePresetBank {
    static final class Opening {final JSONObject record;final String prefix,remainder;Opening(JSONObject record,String prefix,String remainder){this.record=record;this.prefix=prefix;this.remainder=remainder;}}
    static String shortText(String value){return value.trim().replaceAll("[，。！!、~～…\\s]","");}
    static boolean safeAlias(String value){return value!=null&&value.matches("[嗯啊呀诶欸唉哦噢哈嘿嘻呵哼咦呜ーんうあえっへふはぁ！!？?，。、~～…\\s]{1,12}")&&!shortText(value).isEmpty();}
    static String audioName(String value)throws IOException{if(!value.matches("[a-f0-9-]{36}\\.wav"))throw new IOException("语音预设音频记录无效");return value;}
    static boolean tagged(JSONObject row,String tag){JSONArray tags=row.optJSONArray("tags");if(tags!=null)for(int j=0;j<tags.length();j++)if(tag.equals(tags.optString(j)))return true;return false;}
    static JSONObject select(JSONObject primary,String text,int sequence,int requested)throws Exception{
        return select(primary,text,sequence,requested,null);
    }
    static JSONObject select(JSONObject primary,String text,int sequence,int requested,Boolean requestedSoft)throws Exception{
        JSONArray alternatives=primary.optJSONArray("alternatives");if(alternatives==null||alternatives.length()==0)return primary;
        if(alternatives.length()>8)throw new IOException("语音变体记录无效");
        if(requested>=0){if(requested>=alternatives.length())throw new IOException("语音变体不存在");return alternatives.getJSONObject(requested);}
        List<JSONObject> matching=new ArrayList<>();boolean soft=requestedSoft==null?text.matches("(?is).*(ASMR|晚安|闭上眼|慢慢放松|轻声|小声说|安心睡|睡个好觉|放轻声音).*" ):requestedSoft;String tag=soft?"soft":text.matches(".*[？?]$")?"question":text.matches(".*(别急|没关系|陪你|慢慢|休息|辛苦|别难过).*" )?"comfort":"";
        String vocal=text.matches("^[啊呀][，、。！？!?…\\s].*")?"ah":text.matches("^嗯[，、。！？!?…\\s].*")?"hmm":"";
        if(!soft&&!vocal.isEmpty())for(int i=0;i<alternatives.length();i++){JSONObject row=alternatives.getJSONObject(i);if(tagged(row,vocal)&&!tagged(row,"soft"))return row;}
        if(!tag.isEmpty())for(int i=0;i<alternatives.length();i++){JSONObject row=alternatives.getJSONObject(i);if(tagged(row,tag)&&(soft||!tagged(row,"soft")))matching.add(row);}
        if(matching.isEmpty())for(int i=0;i<alternatives.length();i++){JSONObject row=alternatives.getJSONObject(i);if(soft||!tagged(row,"soft")&&!tagged(row,"ah"))matching.add(row);}
        if(matching.isEmpty())return primary;
        return matching.get(Math.floorMod(sequence,matching.size()));
    }
    static JSONObject acknowledgment(File profile,String text,String mood,int sequence)throws Exception{
        if(!safeAlias(text))return null;File file=new File(profile,"acknowledgments.json"),reference=new File(profile,mood+".json");if(!file.isFile()||!reference.isFile())return null;
        JSONObject active=new JSONObject(new String(Files.readAllBytes(reference.toPath()),StandardCharsets.UTF_8));String source=active.optString("source");
        if(file.length()>32768)throw new IOException("短回应记录过大");JSONArray records=new JSONArray(new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8));
        List<JSONObject> choices=new ArrayList<>();for(int i=0;i<records.length();i++){JSONObject row=records.getJSONObject(i);if(source.isEmpty()||!source.equals(row.optString("source")))continue;JSONArray moods=row.getJSONArray("moods");boolean match=false;for(int j=0;j<moods.length();j++)if(mood.equals(moods.getString(j)))match=true;if(!match)continue;
            JSONArray aliases=row.getJSONArray("aliases");for(int j=0;j<aliases.length();j++)if(shortText(text).equals(shortText(aliases.getString(j)))){choices.add(row);break;}}
        return choices.isEmpty()?null:choices.get(Math.floorMod(sequence,choices.size()));
    }
    static Opening opening(File profile,String text,String mood,int sequence)throws Exception{
        java.util.regex.Matcher match=java.util.regex.Pattern.compile("^(嗯|啊|诶|欸|唉|哦|噢|嘿嘿|嘻嘻|呜呜?)[，、。！？!?~～…]+\\s*").matcher(text);
        if(!match.find())return null;String remainder=text.substring(match.end()).trim();if(remainder.length()<4)return null;
        String prefix=text.substring(0,match.end());JSONObject row=acknowledgment(profile,prefix,mood,sequence);
        return row==null?null:new Opening(row,prefix,remainder);
    }
    static void discardReferences(File profile,JSONObject record){Set<String> names=new HashSet<>();names.add(record.optString("file"));JSONArray alternatives=record.optJSONArray("alternatives");if(alternatives!=null)for(int i=0;i<alternatives.length();i++){JSONObject row=alternatives.optJSONObject(i);if(row!=null)names.add(row.optString("file"));}for(String name:names)if(name.matches("[a-f0-9-]{36}\\.wav"))new File(profile,name).delete();}
}
