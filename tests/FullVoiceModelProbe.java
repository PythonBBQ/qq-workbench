package cn.qqworkbench.assistant;

import android.content.*;
import android.os.*;
import org.json.*;
import com.k2fsa.sherpa.onnx.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.lang.reflect.*;
import java.util.*;

/** Full precision, non-distilled model comparison. Writes only an isolated test directory. */
public final class FullVoiceModelProbe {
    public static void main(String[] args)throws Exception{
        if(args.length!=2||!args[0].matches("[a-z0-9-]{1,48}"))throw new IOException("Probe ID and pack required");
        Looper.prepareMainLooper();Class<?> at=Class.forName("android.app.ActivityThread");Constructor<?> ctor=at.getDeclaredConstructor();ctor.setAccessible(true);Object thread=ctor.newInstance();Method system=at.getDeclaredMethod("getSystemContext");system.setAccessible(true);
        System.out.println("FULL_PROBE_START");
        Context app=((Context)system.invoke(thread)).createPackageContext("cn.qqworkbench.assistant",Context.CONTEXT_IGNORE_SECURITY);
        File test=new File(app.getFilesDir(),"full-voice-probe-"+args[0]);if(!test.mkdir())throw new IOException("Probe directory already exists");
        VoiceReferencePack pack;try(InputStream in=new FileInputStream(args[1])){pack=VoiceReferencePack.read(in);}File profile=new File(test,"references");pack.stage(profile);File outputs=new File(test,"outputs");outputs.mkdir();
        System.out.println("FULL_PROBE_REFERENCES_READY");
        File models=new File(app.getFilesDir(),"zipvoice-full-models-v1"),old=new File(app.getFilesDir(),"zipvoice-models-v1");
        System.load(app.getApplicationInfo().nativeLibraryDir+"/libsherpa-onnx-jni.so");
        OfflineTtsZipVoiceModelConfig z=new OfflineTtsZipVoiceModelConfig();z.setEncoder(new File(models,"text_encoder.onnx").getPath());z.setDecoder(new File(models,"fm_decoder.onnx").getPath());z.setVocoder(new File(old,"vocos_24khz.onnx").getPath());z.setTokens(new File(models,"tokens.txt").getPath());z.setLexicon(new File(old,"lexicon.txt").getPath()+","+new File(old,"lexicon-en-us.txt").getPath());
        OfflineTtsModelConfig m=new OfflineTtsModelConfig();m.setZipvoice(z);m.setNumThreads(4);m.setProvider("cpu");OfflineTtsConfig config=new OfflineTtsConfig();config.setModel(m);config.setMaxNumSentences(1);
        long start=SystemClock.elapsedRealtime();OfflineTts engine=new OfflineTts(null,config);JSONObject report=new JSONObject().put("model","ZipVoice FP32 non-distilled").put("loadMs",SystemClock.elapsedRealtime()-start).put("samples",new JSONArray());System.out.println("FULL_MODEL_LOADED "+report.optLong("loadMs"));
        for(int steps:(pack.manifest.optString("revision").contains("expressive")?new int[]{16}:new int[]{16,32}))for(String mood:new String[]{"gentle","shy"}){
            String text=mood.equals("gentle")?"今天辛苦啦，先坐下来休息一下吧。等你准备好了，我们再慢慢聊。":"嗯，你这样说，我会有点不好意思的。不过我听着呢，你慢慢说。";
            if(pack.manifest.optString("revision").contains("expressive"))text=mood.equals("gentle")?"嗯，今天辛苦啦。先坐下来休息一下吧，我在这里陪你。":"啊，别一直这样夸我嘛，我会有点不好意思的。嗯，你慢慢说，我听着呢。";
            if(pack.manifest.optString("revision").contains("selected-p01"))text=mood.equals("gentle")?"嗯，你先别急着走嘛，我还想和你多聊一会儿。":"啊，别一直这样看着我嘛，我会有点不好意思的。";
            JSONObject primary=new JSONObject(new String(Files.readAllBytes(new File(profile,mood+".json").toPath()),StandardCharsets.UTF_8));JSONObject ref=VoicePresetBank.select(primary,text,0,-1,false);VoiceAudio audio=VoiceAudio.decode(new File(profile,ref.getString("file")));
            GenerationConfig c=new GenerationConfig();c.setReferenceAudio(audio.samples);c.setReferenceSampleRate(audio.rate);c.setReferenceText(ref.getString("text"));c.setNumSteps(steps);c.setSpeed(pack.manifest.optString("revision").contains("selected-p01")?.95f:1f);c.setSilenceScale(pack.manifest.optString("revision").contains("selected-p01")?.8f:.25f);Map<String,String> extra=new HashMap<>();extra.put("guidance_scale","1.0");extra.put("min_words_in_sentence","30");extra.put("max_words_in_sentence","70");c.setExtra(extra);
            start=SystemClock.elapsedRealtime();LocalVoice.StopCallback callback=new LocalVoice.StopCallback(start+180000);GeneratedAudio generated=engine.generateWithConfigAndCallback(text,c,callback);if(callback.interrupted)throw new IOException("Model timeout");SpeechPhrasing.validateDuration(text,generated.getSamples().length,generated.getSampleRate());
            byte[] wav=VoiceAudio.wav(SpeechPhrasing.finish(generated.getSamples(),generated.getSampleRate()),generated.getSampleRate());String name=mood+"-fp32-"+steps;Files.write(new File(outputs,name+".wav").toPath(),wav);
            JSONObject row=new JSONObject().put("sample",name).put("text",text).put("steps",steps).put("elapsedMs",SystemClock.elapsedRealtime()-start).put("durationMs",generated.getSamples().length*1000L/generated.getSampleRate()).put("pssKB",Debug.getPss());report.getJSONArray("samples").put(row);Files.write(new File(outputs,"review.json").toPath(),report.toString(2).getBytes(StandardCharsets.UTF_8));System.out.println("FULL_MODEL_SAMPLE "+row);
        }
        engine.release();System.out.println("QQWB_FULL_VOICE_OK "+outputs);System.exit(0);
    }
}
