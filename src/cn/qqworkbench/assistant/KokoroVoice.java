package cn.qqworkbench.assistant;

import android.content.Context;
import android.os.SystemClock;
import android.util.Base64;
import com.k2fsa.sherpa.onnx.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.locks.ReentrantLock;
import java.util.zip.*;

/** Direct Chinese/English synthesis; no system-generated reference or cloning step. */
final class KokoroVoice {
    private static KokoroVoice instance;
    static synchronized KokoroVoice get(Context c){if(instance==null)instance=new KokoroVoice(c.getApplicationContext());return instance;}
    final Context context;final File models;final ReentrantLock lock=new ReentrantLock();
    OfflineTts engine;long used,lastMillis;
    KokoroVoice(Context c){context=c;models=new File(c.getFilesDir(),"kokoro-models-v1");ScheduledExecutorService idle=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"kokoro-idle");t.setDaemon(true);return t;});idle.scheduleWithFixedDelay(()->{if(SystemClock.elapsedRealtime()-used>90000)release();},30,30,TimeUnit.SECONDS);}
    static String hex(byte[] data){StringBuilder s=new StringBuilder();for(byte b:data)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    void prepare()throws Exception{
        models.mkdirs();JSONObject record;try(InputStream in=context.getAssets().open("kokoro-models.json")){record=new JSONObject(new String(LocalVoice.read(in,256*1024),StandardCharsets.UTF_8));}
        JSONObject files=record.getJSONObject("files");File marker=new File(models,"ready.json");
        if(marker.isFile()&&new String(Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8).equals(record.toString())){boolean ready=true;for(Iterator<String> it=files.keys();it.hasNext();){String name=it.next();if(new File(models,name).length()!=files.getJSONObject(name).getLong("bytes"))ready=false;}if(ready)return;}
        Set<String> seen=new HashSet<>();String prefix=models.getCanonicalPath()+File.separator;
        try(ZipInputStream zip=new ZipInputStream(context.getAssets().open("kokoro-models.zip"))){ZipEntry entry;while((entry=zip.getNextEntry())!=null){String name=entry.getName();File target=new File(models,name);if(!files.has(name)||!target.getCanonicalPath().startsWith(prefix)||!seen.add(name))throw new IOException("语音模型条目无效");target.getParentFile().mkdirs();JSONObject expected=files.getJSONObject(name);File temp=new File(target.getPath()+".partial");MessageDigest hash=MessageDigest.getInstance("SHA-256");long count=0;
            try{try(OutputStream out=new FileOutputStream(temp)){byte[] b=new byte[65536];int n;while((n=zip.read(b))!=-1){count+=n;if(count>expected.getLong("bytes"))throw new IOException("语音模型大小无效");hash.update(b,0,n);out.write(b,0,n);}}
                if(count!=expected.getLong("bytes")||!hex(hash.digest()).equals(expected.getString("sha256")))throw new IOException("语音模型校验失败");Files.move(temp.toPath(),target.toPath(),StandardCopyOption.REPLACE_EXISTING);
            }finally{temp.delete();}
        }}if(seen.size()!=files.length())throw new IOException("语音模型不完整");Files.write(marker.toPath(),record.toString().getBytes(StandardCharsets.UTF_8));
    }
    JSONObject state()throws Exception{return new JSONObject().put("ok",true).put("provider","kokoro").put("prepared",new File(models,"ready.json").isFile()).put("loaded",engine!=null).put("lastMillis",lastMillis).put("message","内置中文女声，离线使用，无需密钥或参考录音；情绪为口语与语速调整，不是独立情绪模型");}
    JSONObject synthesize(JSONObject request)throws Exception{
        String text=request.optString("text").trim();if(text.isEmpty()||text.length()>240)throw new IOException("语音限240字，长内容使用文字");
        if(!lock.tryLock(8,TimeUnit.SECONDS))throw new IOException("语音模型正忙，本条使用文字");long start=SystemClock.elapsedRealtime(),deadline=Math.min(start+115000,request.optLong("localDeadline",start+115000));
        try{prepare();if(engine==null){OfflineTtsKokoroModelConfig k=new OfflineTtsKokoroModelConfig();k.setModel(new File(models,"model.int8.onnx").getPath());k.setVoices(new File(models,"voices.bin").getPath());k.setTokens(new File(models,"tokens.txt").getPath());k.setDataDir(new File(models,"espeak-ng-data").getPath());k.setDictDir(new File(models,"dict").getPath());k.setLexicon(new File(models,"lexicon-zh.txt")+","+new File(models,"lexicon-us-en.txt"));OfflineTtsModelConfig m=new OfflineTtsModelConfig();m.setKokoro(k);m.setNumThreads(2);m.setProvider("cpu");OfflineTtsConfig c=new OfflineTtsConfig();c.setModel(m);c.setMaxNumSentences(1);c.setRuleFsts(new File(models,"phone-zh.fst")+","+new File(models,"date-zh.fst")+","+new File(models,"number-zh.fst"));engine=new OfflineTts(null,c);}
            int sid=Math.max(3,Math.min(6,request.optInt("speaker",3)));float speed=(float)Math.max(.75,Math.min(1.4,1+request.optDouble("rate",0)/100));
            List<String> phrases=new ArrayList<>();StringBuilder phrase=new StringBuilder();for(String part:SpeechPhrasing.chunks(text,true)){if(phrase.length()>0&&phrase.length()+part.length()>65){phrases.add(phrase.toString());phrase.setLength(0);}phrase.append(part);}if(phrase.length()>0)phrases.add(phrase.toString());
            List<float[]> parts=new ArrayList<>();int rate=0;
            for(String part:phrases){if(SystemClock.elapsedRealtime()>=deadline)throw new IOException("语音生成超时，本条使用文字");LocalVoice.StopCallback stop=new LocalVoice.StopCallback(deadline);GeneratedAudio audio=engine.generateWithCallback(part,sid,speed,stop);if(stop.interrupted)throw new IOException("语音生成中断，本条使用文字");if(rate!=0&&rate!=audio.getSampleRate())throw new IOException("语音采样率变化");rate=audio.getSampleRate();SpeechPhrasing.validateDuration(part,audio.getSamples().length,rate);parts.add(SpeechPhrasing.finish(audio.getSamples(),rate));}
            if(SystemClock.elapsedRealtime()>=deadline)throw new IOException("语音生成超时，本条使用文字");byte[] wav=VoiceAudio.wav(SpeechPhrasing.join(parts,phrases,rate),rate);lastMillis=SystemClock.elapsedRealtime()-start;
            return new JSONObject().put("ok",true).put("audio",Base64.encodeToString(wav,Base64.NO_WRAP)).put("format","wav").put("provider","kokoro").put("speaker",sid).put("elapsedMs",lastMillis).put("segments",phrases.size()).put("completedSegments",parts.size()).put("characters",text.length()).put("durationMs",(wav.length-44)*500L/rate);
        }finally{used=SystemClock.elapsedRealtime();lock.unlock();}
    }
    void release(){if(!lock.tryLock())return;try{if(engine!=null){engine.release();engine=null;}}finally{lock.unlock();}}
}
