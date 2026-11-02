package cn.qqworkbench.assistant;
import java.io.*;
import java.nio.file.*;
import java.util.*;

/** Strictly generated test artifacts. Never traverses the container filesystem. */
final class StorageCleanup {
    static List<File> candidates(File root){
        List<File> result=new ArrayList<>();collect(new File(root,"."),"(?:full-voice-probe-|voice-preset-probe-).+",result);
        collect(new File(root,"voice-references"),"slot-[0-3]\\.backup-[a-f0-9-]{36}",result);
        collect(new File(root,DataMigration.WORK),"(?:voice-(?:quality-|tablet-|soft-|user-soft-|selected-p01-).+|(?:six-local-|six-reference-|ssr-reference-|ssr-source-|ssr-v2-|speech-validation-|teacher-voice-|ready-validation-).+|character-daily-asr|bili-video-tests|evolution-tests|natural-browse-tests|next-version-tests|search-speed-tests|video-budget-tests|startup-smoke)",result);return result;
    }
    static void collect(File parent,String pattern,List<File> result){if(Files.isSymbolicLink(parent.toPath()))return;File[] files=parent.listFiles();if(files!=null)for(File f:files)if(f.getName().matches(pattern)&&!Files.isSymbolicLink(f.toPath()))result.add(f);}
    static long size(File f)throws IOException{if(Files.isSymbolicLink(f.toPath()))return 0;long n=f.isFile()?f.length():0;File[] children=f.listFiles();if(children!=null)for(File c:children)n+=size(c);return n;}
    static long clear(File root)throws Exception{long bytes=0;String base=root.getCanonicalPath()+File.separator;for(File f:candidates(root)){if(!f.getCanonicalPath().startsWith(base))throw new IOException("清理路径超出应用目录");bytes+=size(f);MigrationArchive.erase(f);}return bytes;}
    static String format(long bytes){return String.format(Locale.ROOT,"%.1f MB",bytes/1048576.0);}
    static void show(MainActivity a){
        a.base("存储清理","storage");a.section("应用测试文件","仅清理历次试听、探测输出和已替换音色的旧副本。正在使用的模型、收藏音色、QQ登录、对话与记忆始终保留。");
        android.widget.TextView state=a.text("正在统计可清理空间…",14);a.body.addView(state);
        a.io.submit(()->{long bytes=0;try{for(File f:candidates(a.getFilesDir()))bytes+=size(f);}catch(Exception ignored){}final long count=bytes;a.runOnUiThread(()->{if(!a.destroyed)state.setText("可清理："+format(count));});});
        a.button("清理测试文件",()->{if(DataMigration.busy){a.toast("备份或迁移中，请稍候");return;}DataMigration.busy=true;a.io.submit(()->{String result;try{long n=clear(a.getFilesDir());result="已清理 "+format(n);}catch(Exception e){result="清理未完成，用户数据保留";}finally{DataMigration.busy=false;}final String text=result;a.runOnUiThread(()->{if(!a.destroyed){state.setText(text);a.toast(text);}});});});
        a.note("应用本体包含QQ运行环境、视频转写和语音模型，属于离线运行所需资源。下载目录的旧安装包可在文件管理中单独删除。");
    }
}
