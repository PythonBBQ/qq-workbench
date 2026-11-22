package cn.qqworkbench.assistant;

import org.json.*;
import java.io.*;
import java.util.*;
import java.util.zip.*;

/** New emotion data is optional; old six-mood imports must remain valid. */
public final class VoiceExtendedPackCheck {
    static void check(boolean ok){if(!ok)throw new AssertionError();}
    static byte[] pack(boolean extended,String problem)throws Exception{
        byte[] wav=new byte[48044];StringBuilder sha=new StringBuilder();
        for(byte b:java.security.MessageDigest.getInstance("SHA-256").digest(wav))sha.append(String.format(Locale.ROOT,"%02x",b&255));
        JSONObject refs=new JSONObject();Map<String,byte[]> files=new LinkedHashMap<>();
        for(String mood:extended?LocalVoice.ALL_MOODS:LocalVoice.MOODS){
            if(problem.equals("missing-base")&&mood.equals("happy"))continue;
            String file=mood+".wav";files.put(file,wav);refs.put(mood,new JSONObject().put("file",file).put("text","我在认真听你说。").put("bytes",wav.length).put("sha256",sha.toString()));
        }
        if(problem.equals("unknown"))refs.put("unknown",refs.getJSONObject("neutral"));
        JSONObject manifest=new JSONObject().put("schema",problem.equals("old-schema")?1:2).put("type",VoiceReferencePack.TYPE).put("id","fixed-emotions").put("references",refs);
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(ZipOutputStream z=new ZipOutputStream(bytes)){
            z.putNextEntry(new ZipEntry("manifest.json"));z.write(manifest.toString().getBytes("UTF-8"));z.closeEntry();
            for(Map.Entry<String,byte[]> file:files.entrySet()){z.putNextEntry(new ZipEntry(file.getKey()));z.write(file.getValue());z.closeEntry();}
        }return bytes.toByteArray();
    }
    public static void main(String[] args)throws Exception{
        check(VoiceReferencePack.read(new ByteArrayInputStream(pack(false,""))).audio.size()==6);
        check(VoiceReferencePack.read(new ByteArrayInputStream(pack(true,""))).audio.size()==10);
        for(String problem:new String[]{"missing-base","unknown","old-schema"}){
            boolean rejected=false;try{VoiceReferencePack.read(new ByteArrayInputStream(pack(true,problem)));}catch(IOException expected){rejected=true;}check(rejected);
        }
        for(String mood:LocalVoice.ALL_MOODS){check(LocalVoice.mood(mood).equals(mood));check(VoiceReferencePack.permittedName(mood+".wav"));}
        check(!VoiceReferencePack.permittedName("../afraid.wav"));check(!VoiceReferencePack.permittedName("unknown.wav"));
        try(InputStream in=new FileInputStream("assets/character-daily-references.zip")){
            VoiceReferencePack actual=VoiceReferencePack.read(in);check(actual.audio.size()==10);check(!actual.manifest.has("variants"));
            check(!actual.manifest.getJSONObject("references").getJSONObject("sad").getString("text").contains("困"));
        }
        System.out.println("QQWB_EXTENDED_EMOTIONS_OK: old six-mood packs, ten fixed anchors, strict optional names, actual asset checksums");
    }
}
