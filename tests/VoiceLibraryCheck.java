package cn.qqworkbench.assistant;
import android.content.*;
import java.io.*;
import org.json.*;
public final class VoiceLibraryCheck {
    static void check(boolean ok){if(!ok)throw new AssertionError();}
    public static void main(String[] args)throws Exception{
        File dir=new File("/data/local/tmp/voice-library-check-"+java.util.UUID.randomUUID());dir.mkdir();Context context=new ContextWrapper(null){public File getFilesDir(){return dir;}};
        try{float[] wave=new float[24000];for(int i=0;i<wave.length;i++)wave[i]=(float)(.2*Math.sin(i*.1));VoiceReferencePack pack=VoiceReferencePack.single(VoiceAudio.wav(wave,24000),"准备好了。");
            JSONObject saved=VoiceLibrary.save(context,0,pack),again=VoiceLibrary.save(context,0,pack);check(saved.getString("id").equals(again.getString("id")));check(VoiceLibrary.list(context,0).length()==1);check(VoiceLibrary.list(context,1).length()==0);
            VoiceReferencePack loaded=VoiceLibrary.load(context,0,saved.getString("id"));File stage=new File(dir,"stage");loaded.stage(stage);check(!new File(stage,"acknowledgments.json").exists());for(String mood:LocalVoice.MOODS){JSONObject ref=new JSONObject(new String(java.nio.file.Files.readAllBytes(new File(stage,mood+".json").toPath()),"UTF-8"));check(ref.getString("source").equals("custom-single"));check(ref.getString("text").equals("准备好了。"));check(!ref.has("alternatives"));}
            boolean rejected=false;try{VoiceLibrary.load(context,0,"../other");}catch(Exception e){rejected=true;}check(rejected);rejected=false;try{VoiceLibrary.load(context,1,saved.getString("id"));}catch(Exception e){rejected=true;}check(rejected);
            VoiceLibrary.remove(context,0,saved.getString("id"));check(VoiceLibrary.list(context,0).length()==0);check(new File(stage,"neutral.json").isFile());VoiceReferencePack.discardStage(stage);
            JSONObject request=VoicePreview.request(2,new JSONObject().put("speechProvider","zipvoice").put("speechRate",-15).put("speechPitch",8).put("apiKey","not-for-preview"),"shy","准备好了。");check(request.getInt("slot")==2);check(request.getInt("rate")==-15);check(request.getInt("pitch")==8);check(!request.has("apiKey"));check(request.getString("text").equals("准备好了。"));
            System.out.println("QQWB_VOICE_LIBRARY_OK: stable imports, reselectable presets, per-account isolation, no previous-character acknowledgments, bounded paths, local preview snapshot");
        }finally{try(java.util.stream.Stream<java.nio.file.Path> paths=java.nio.file.Files.walk(dir.toPath())){for(java.nio.file.Path p:paths.sorted(java.util.Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList()))java.nio.file.Files.delete(p);}}
    }
}
