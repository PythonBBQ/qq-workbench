package cn.qqworkbench.assistant;

import android.content.Context;
import android.net.Uri;
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

/** One shared CPU model, independently stored reference voices for each QQ. */
final class LocalVoice {
    /** JNI resolves invoke(float[]) specifically; a Java lambda only exposes invoke(Object). */
    public static final class StopCallback implements kotlin.jvm.functions.Function1<float[],Integer>{
        final long deadline;StopCallback(long deadline){this.deadline=deadline;}
        public Integer invoke(float[] samples){return SystemClock.elapsedRealtime()>deadline||Thread.currentThread().isInterrupted()?0:1;}
    }
    static final String[] MOODS={"neutral","happy","gentle","shy","sad","serious"};
    private static LocalVoice instance;
    static synchronized LocalVoice get(Context c){if(instance==null)instance=new LocalVoice(c.getApplicationContext());return instance;}
    private final Context context;private final File models,refs;private final ReentrantLock inference=new ReentrantLock();
    private volatile OfflineTts engine;private volatile long used,lastMillis;private volatile String lastReference="",lastProblem="";
    private LocalVoice(Context c){context=c;models=new File(c.getFilesDir(),"zipvoice-models-v1");refs=new File(c.getFilesDir(),"voice-references");ScheduledExecutorService idle=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"voice-idle");t.setDaemon(true);return t;});idle.scheduleWithFixedDelay(()->{if(SystemClock.elapsedRealtime()-used>60000)release();},30,30,TimeUnit.SECONDS);}
    static int slot(int n)throws IOException{if(n<0||n>3)throw new IOException("语音账号无效");return n;}
    static String mood(String value){return Arrays.asList(MOODS).contains(value)?value:"neutral";}
    private File profile(int n)throws Exception{File p=new File(refs,"slot-"+slot(n));p.mkdirs();return p;}
    private JSONObject manifest()throws Exception{try(InputStream in=context.getAssets().open("zipvoice-models.json")){return new JSONObject(new String(read(in,16384),StandardCharsets.UTF_8));}}
    static byte[] read(InputStream in,int limit)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1){if(out.size()+n>limit)throw new IOException("语音文件超过上限");out.write(b,0,n);}return out.toByteArray();}
    private static String hex(byte[] value){StringBuilder s=new StringBuilder();for(byte b:value)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    synchronized void prepare()throws Exception{
        models.mkdirs();try(java.nio.channels.FileChannel channel=new RandomAccessFile(new File(models,"prepare.lock"),"rw").getChannel();java.nio.channels.FileLock lock=channel.lock()){prepareLocked();}
    }
    private void prepareLocked()throws Exception{
        JSONObject record=manifest(),files=record.getJSONObject("files");File marker=new File(models,"ready.json");
        if(marker.isFile()&&new String(Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8).equals(record.toString())){boolean complete=true;for(Iterator<String> it=files.keys();it.hasNext();){String name=it.next();if(new File(models,name).length()!=files.getJSONObject(name).getLong("bytes"))complete=false;}if(complete)return;}
        models.mkdirs();Set<String> seen=new HashSet<>();
        try(ZipInputStream zip=new ZipInputStream(context.getAssets().open("zipvoice-models.zip"))){ZipEntry entry;while((entry=zip.getNextEntry())!=null){String name=entry.getName();if(!files.has(name)||name.contains("/")||name.contains("\\")||!seen.add(name))throw new IOException("语音模型包内容无效");JSONObject expected=files.getJSONObject(name);File partial=new File(models,name+".partial");MessageDigest hash=MessageDigest.getInstance("SHA-256");long size=0;try(OutputStream out=new FileOutputStream(partial)){byte[] b=new byte[65536];int n;while((n=zip.read(b))!=-1){size+=n;if(size>expected.getLong("bytes"))throw new IOException("语音模型大小无效");out.write(b,0,n);hash.update(b,0,n);}}
            if(size!=expected.getLong("bytes")||!hex(hash.digest()).equals(expected.getString("sha256")))throw new IOException("语音模型校验失败，请重新安装");Files.move(partial.toPath(),new File(models,name).toPath(),StandardCopyOption.REPLACE_EXISTING);}}
        if(seen.size()!=files.length())throw new IOException("语音模型包不完整");Files.write(marker.toPath(),record.toString().getBytes(StandardCharsets.UTF_8));
    }
    JSONObject state(int n)throws Exception{slot(n);JSONArray voices=new JSONArray();for(String mood:MOODS){File f=new File(profile(n),mood+".json");if(f.isFile()){JSONObject v=new JSONObject(new String(Files.readAllBytes(f.toPath()),StandardCharsets.UTF_8));voices.put(new JSONObject().put("mood",mood).put("text",v.optString("text")).put("seconds",v.optDouble("seconds")).put("source",v.optString("source")));}}
        return new JSONObject().put("ok",true).put("provider","zipvoice").put("prepared",new File(models,"ready.json").isFile()).put("loaded",engine!=null).put("references",voices).put("lastMillis",lastMillis).put("lastReference",lastReference).put("message",lastProblem.isEmpty()?"轻量模型已随软件内置，首次使用自动准备；本机合成无需API Key":lastProblem);}
    void importReference(int n,String style,Uri uri,String text)throws Exception{slot(n);if(!Arrays.asList(MOODS).contains(style))throw new IOException("语音语气无效");text=text.trim();if(text.isEmpty()||text.length()>200)throw new IOException("语音参考文字需为1到200字，必须与录音一致");
        File input=File.createTempFile("voice-import-",".tmp",context.getCacheDir());try{try(InputStream in=context.getContentResolver().openInputStream(uri);OutputStream out=new FileOutputStream(input)){if(in==null)throw new IOException("语音文件无法读取");out.write(read(in,12*1024*1024));}saveReference(n,style,VoiceAudio.decode(input),text,"imported");}finally{input.delete();}}
    private synchronized void saveReference(int n,String mood,VoiceAudio audio,String text,String source)throws Exception{File dir=profile(n),old=new File(dir,mood+".json");String previous="";if(old.isFile())try{previous=new JSONObject(new String(Files.readAllBytes(old.toPath()),StandardCharsets.UTF_8)).optString("file");}catch(Exception ignored){}
        String name=UUID.randomUUID()+".wav";Files.write(new File(dir,name).toPath(),VoiceAudio.wav(audio.samples,audio.rate));JSONObject data=new JSONObject().put("file",name).put("text",text).put("seconds",audio.samples.length/(double)audio.rate).put("source",source);File temp=new File(dir,mood+".json.next");Files.write(temp.toPath(),data.toString().getBytes(StandardCharsets.UTF_8));Files.move(temp.toPath(),old.toPath(),StandardCopyOption.REPLACE_EXISTING);if(previous.matches("[a-f0-9-]{36}\\.wav"))new File(dir,previous).delete();}
    synchronized void removeReference(int n,String style)throws Exception{File dir=profile(n),meta=new File(dir,mood(style)+".json");if(meta.isFile()){JSONObject old=new JSONObject(new String(Files.readAllBytes(meta.toPath()),StandardCharsets.UTF_8));meta.delete();String name=old.optString("file");if(name.matches("[a-f0-9-]{36}\\.wav"))new File(dir,name).delete();}}
    private void defaultReference(int n,String voice)throws Exception{if(new File(profile(n),"neutral.json").isFile())return;String text="主人，今天也要好好吃饭。";NativeSpeech system=new NativeSpeech(context);File file=File.createTempFile("voice-seed-",".wav",context.getCacheDir());try{JSONObject result=system.synthesize(new JSONObject().put("text",text).put("voice",voice).put("language","zh-CN"));Files.write(file.toPath(),Base64.decode(result.getString("audio"),Base64.DEFAULT));saveReference(n,"neutral",VoiceAudio.decode(file),text,"system");}finally{system.close();file.delete();}}
    JSONObject synthesize(JSONObject request)throws Exception{
        int n=slot(request.optInt("slot"));String text=request.optString("text").trim();if(text.isEmpty()||text.length()>240)throw new IOException("语音轻量模式限240字，长内容使用文字");
        if(!inference.tryLock(8,TimeUnit.SECONDS))throw new IOException("语音模型正忙，本条使用文字");
        long start=SystemClock.elapsedRealtime(),deadline=Math.min(start+55000,request.optLong("localDeadline",start+55000));try{if(start>=deadline)throw new IOException("语音排队超时，本条使用文字");prepare();defaultReference(n,request.optString("voice"));String style=mood(request.optString("emotion"));File dir=profile(n),meta=new File(dir,style+".json");if(!meta.isFile()){style="neutral";meta=new File(dir,"neutral.json");}
            JSONObject ref=new JSONObject(new String(Files.readAllBytes(meta.toPath()),StandardCharsets.UTF_8));String name=ref.getString("file");if(!name.matches("[a-f0-9-]{36}\\.wav"))throw new IOException("语音参考记录无效");VoiceAudio audio=VoiceAudio.decode(new File(dir,name));
            if(engine==null){OfflineTtsZipVoiceModelConfig z=new OfflineTtsZipVoiceModelConfig();z.setEncoder(new File(models,"encoder.int8.onnx").getPath());z.setDecoder(new File(models,"decoder.int8.onnx").getPath());z.setVocoder(new File(models,"vocos_24khz.onnx").getPath());z.setTokens(new File(models,"tokens.txt").getPath());z.setLexicon(new File(models,"lexicon.txt").getPath()+","+new File(models,"lexicon-en-us.txt").getPath());OfflineTtsModelConfig m=new OfflineTtsModelConfig();m.setZipvoice(z);m.setNumThreads(2);m.setProvider("cpu");OfflineTtsConfig c=new OfflineTtsConfig();c.setModel(m);c.setMaxNumSentences(1);engine=new OfflineTts(null,c);}
            GenerationConfig c=new GenerationConfig();c.setReferenceAudio(audio.samples);c.setReferenceSampleRate(audio.rate);c.setReferenceText(ref.getString("text"));c.setNumSteps(request.optInt("steps",4)==8?8:4);c.setSpeed((float)Math.max(.8,Math.min(1.2,1+request.optDouble("rate",0)/100)));c.setSilenceScale(.25f);
            if(SystemClock.elapsedRealtime()>=deadline)throw new IOException("语音准备耗时过长，本条使用文字");
            GeneratedAudio output=engine.generateWithConfigAndCallback(text,c,new StopCallback(deadline));
            if(SystemClock.elapsedRealtime()>deadline)throw new IOException("语音合成耗时过长，本条使用文字");byte[] bytes=VoiceAudio.wav(output.getSamples(),output.getSampleRate());if(bytes.length>6*1024*1024)throw new IOException("语音生成内容过长");used=SystemClock.elapsedRealtime();lastMillis=used-start;lastReference=style;lastProblem="";
            return new JSONObject().put("ok",true).put("audio",Base64.encodeToString(bytes,Base64.NO_WRAP)).put("format","wav").put("elapsedMs",lastMillis).put("referenceMood",style).put("referenceSource",ref.optString("source"));
        }catch(Exception|LinkageError e){lastProblem=e instanceof LinkageError?"语音原生组件无法加载，请安装匹配的完整版":e.getMessage();throw new IOException(lastProblem,e);}finally{used=SystemClock.elapsedRealtime();inference.unlock();}}
    void release(){if(!inference.tryLock())return;try{if(engine!=null){engine.release();engine=null;}}finally{inference.unlock();}}
}
