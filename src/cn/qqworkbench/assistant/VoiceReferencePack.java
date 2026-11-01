package cn.qqworkbench.assistant;

import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Bounded data-only presets. Schema 1 remains compatible with the first voice. */
final class VoiceReferencePack {
    static final String TYPE="qq-workbench-voice-references";
    static final int MAX_BYTES=12*1024*1024;
    final JSONObject manifest;final Map<String,byte[]> audio;
    VoiceReferencePack(JSONObject manifest,Map<String,byte[]> audio){this.manifest=manifest;this.audio=audio;}
    static boolean permittedName(String name){return name.matches("(?:neutral|happy|gentle|shy|sad|serious)(?:-[1-7])?\\.wav")||name.matches("ack-[a-z0-9-]{1,32}\\.wav")||name.equals("manifest.json")||name.equals("NOTICE.txt");}
    static void reference(JSONObject ref,String expected,Map<String,byte[]> files,Set<String> used)throws Exception{
        String text=ref.getString("text");if(!text.equals(text.trim())||text.isEmpty()||text.length()>200||!expected.equals(ref.getString("file")))throw new IOException("语气参考文字或文件名无效");
        byte[] data=files.get(expected);if(data==null||!used.add(expected))throw new IOException("语气参考缺失或重复");
        if(!ref.getString("sha256").matches("[a-f0-9]{64}"))throw new IOException("语音参考校验记录无效");FeiyuReferences.checked(data,ref);
        if(ref.has("guidanceScale")){Object value=ref.get("guidanceScale");double scale=value instanceof Number?((Number)value).doubleValue():Double.NaN;if(!Double.isFinite(scale)||scale<.5||scale>4)throw new IOException("语音参考引导参数无效");}
    }
    static VoiceReferencePack read(InputStream input)throws Exception{
        Map<String,byte[]> files=new LinkedHashMap<>();int total=0;
        try(ZipInputStream zip=new ZipInputStream(input)){
            ZipEntry entry;while((entry=zip.getNextEntry())!=null){String name=entry.getName();
                if(entry.isDirectory()||!permittedName(name)||files.containsKey(name)||files.size()>=72)throw new IOException("语气参考包包含无效或重复文件");
                byte[] bytes=LocalVoice.read(zip,name.endsWith(".wav")?2*1024*1024:65536);total+=bytes.length;if(total>MAX_BYTES)throw new IOException("语气参考包过大");files.put(name,bytes);
            }
        }
        if(!files.containsKey("manifest.json"))throw new IOException("语气参考包缺少清单");
        JSONObject manifest=new JSONObject(new String(files.get("manifest.json"),StandardCharsets.UTF_8));int schema=manifest.getInt("schema");
        if((schema!=1&&schema!=2)||!TYPE.equals(manifest.getString("type")))throw new IOException("语气参考包版本不支持");
        if(schema==2&&!manifest.optString("id").matches("[a-z0-9-]{1,48}"))throw new IOException("语音预设标识无效");
        JSONObject refs=manifest.getJSONObject("references");if(refs.length()!=LocalVoice.MOODS.length)throw new IOException("请使用包含六种语气的完整参考包");
        Set<String> used=new HashSet<>();for(String mood:LocalVoice.MOODS)reference(refs.getJSONObject(mood),mood+".wav",files,used);
        JSONObject variants=manifest.optJSONObject("variants");JSONArray acks=manifest.optJSONArray("acknowledgments");
        if(schema==1&&(variants!=null||acks!=null))throw new IOException("旧版参考包不支持扩展音频");
        if(variants!=null){for(Iterator<String> it=variants.keys();it.hasNext();){String mood=it.next();if(!Arrays.asList(LocalVoice.MOODS).contains(mood))throw new IOException("扩展语气无效");JSONArray choices=variants.getJSONArray(mood);if(choices.length()>7)throw new IOException("每种语气最多八个参考");
            for(int i=0;i<choices.length();i++){JSONObject row=choices.getJSONObject(i);reference(row,mood+"-"+(i+1)+".wav",files,used);JSONArray tags=row.optJSONArray("tags");if(tags!=null){if(tags.length()>4)throw new IOException("语音标签过多");for(int j=0;j<tags.length();j++)if(!Arrays.asList("question","comfort","hesitant","bright","calm","soft","playful").contains(tags.getString(j)))throw new IOException("语音标签无效");}}
        }}
        if(acks!=null){if(acks.length()>16)throw new IOException("短回应最多16个");Set<String> ids=new HashSet<>();for(int i=0;i<acks.length();i++){JSONObject row=acks.getJSONObject(i);String id=row.getString("id");if(!id.matches("[a-z0-9-]{1,32}")||!ids.add(id))throw new IOException("短回应标识无效");reference(row,"ack-"+id+".wav",files,used);
            if(!VoicePresetBank.safeAlias(row.getString("text")))throw new IOException("短回应只用于明确语气词");JSONArray aliases=row.getJSONArray("aliases"),moods=row.getJSONArray("moods");if(aliases.length()<1||aliases.length()>8||moods.length()<1||moods.length()>6)throw new IOException("短回应匹配配置无效");for(int j=0;j<aliases.length();j++)if(!VoicePresetBank.safeAlias(aliases.getString(j)))throw new IOException("短回应匹配文字无效");for(int j=0;j<moods.length();j++)if(!Arrays.asList(LocalVoice.MOODS).contains(moods.getString(j)))throw new IOException("短回应语气无效");
        }}
        Map<String,byte[]> audio=new LinkedHashMap<>();for(String name:files.keySet())if(name.endsWith(".wav")){if(!used.contains(name))throw new IOException("参考包包含未登记的音频");audio.put(name,files.get(name));}
        return new VoiceReferencePack(manifest,audio);
    }
    JSONObject stageAudio(File directory,JSONObject record,boolean acknowledgment)throws Exception{
        String name=UUID.randomUUID()+".wav";File wav=new File(directory,name);Files.write(wav.toPath(),audio.get(record.getString("file")));
        VoiceAudio decoded=acknowledgment?VoiceAudio.decode(wav,180,2500):VoiceAudio.decode(wav);
        String id=manifest.optString("id","feiyu-six");JSONObject data=new JSONObject().put("file",name).put("text",record.getString("text"))
            .put("seconds",decoded.samples.length/(double)decoded.rate).put("source",id).put("pack",manifest.optString("name").substring(0,Math.min(80,manifest.optString("name").length())));
        if(record.has("tags"))data.put("tags",record.getJSONArray("tags"));if(record.has("guidanceScale"))data.put("guidanceScale",record.getDouble("guidanceScale"));return data;
    }
    void stage(File directory)throws Exception{
        if(!directory.mkdir())throw new IOException("无法准备语气参考目录");JSONObject variants=manifest.optJSONObject("variants");
        for(String mood:LocalVoice.MOODS){JSONObject data=stageAudio(directory,manifest.getJSONObject("references").getJSONObject(mood),false);
            if(manifest.optInt("schema")==1&&!manifest.has("id"))data.put("source","feiyu-six-"+mood);
            data.put("variant",0);if(variants!=null&&variants.has(mood)){JSONArray choices=new JSONArray();choices.put(new JSONObject(data.toString()));JSONArray extra=variants.getJSONArray(mood);for(int i=0;i<extra.length();i++)choices.put(stageAudio(directory,extra.getJSONObject(i),false).put("variant",i+1));data.put("alternatives",choices);}
            Files.write(new File(directory,mood+".json").toPath(),data.toString().getBytes(StandardCharsets.UTF_8));
        }
        JSONArray acks=manifest.optJSONArray("acknowledgments");if(acks!=null){JSONArray index=new JSONArray();for(int i=0;i<acks.length();i++){JSONObject row=acks.getJSONObject(i),data=stageAudio(directory,row,true);data.put("id",row.getString("id")).put("moods",row.getJSONArray("moods")).put("aliases",row.getJSONArray("aliases"));index.put(data);}Files.write(new File(directory,"acknowledgments.json").toPath(),index.toString().getBytes(StandardCharsets.UTF_8));}
        Files.write(new File(directory,"pack.json").toPath(),manifest.toString().getBytes(StandardCharsets.UTF_8));
    }
    static void discardStage(File directory){File[] files=directory.listFiles();if(files!=null)for(File file:files)if(file.isFile())file.delete();directory.delete();}
}
