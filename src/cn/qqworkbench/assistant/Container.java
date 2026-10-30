package cn.qqworkbench.assistant;

import android.content.*;
import android.net.*;
import java.io.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

final class Container {
    final Context context; final File base,root,tmp,lib,nativeDir;
    private Boolean accelerated;
    Container(Context c){context=c; base=new File(c.getFilesDir(),"linux");root=new File(base,"rootfs");tmp=new File(base,"tmp");lib=new File(base,"lib");nativeDir=new File(c.getApplicationInfo().nativeLibraryDir);}
    interface Progress{void update(String s);}
    void prepare(Progress progress)throws Exception {
        base.mkdirs();tmp.mkdirs();lib.mkdirs();
        for(String[] pair:new String[][]{{"libtalloc.so","libtalloc.so.2"},{"libandroidshmem.so","libandroid-shmem.so"}})
            Files.copy(new File(nativeDir,pair[0]).toPath(),new File(lib,pair[1]).toPath(),StandardCopyOption.REPLACE_EXISTING);
        if(!new File(root,".qq-rootfs-v1").isFile()){
            File stage=new File(base,"rootfs.stage");if(stage.exists()){progress.update("正在恢复上次中断的初始化…");clearStage();}stage.mkdirs();
            progress.update("正在展开离线 Ubuntu，首次启动需要几分钟…");
            extract("offline-rootfs.bin",stage);extract("glibc-python.bin",stage);extract("python-support.bin",stage);
            Files.write(new File(stage,".qq-rootfs-v1").toPath(),new byte[]{1});
            if(root.exists()||!stage.renameTo(root))throw new IOException("无法提交新的 Ubuntu 环境");
        }
        new File(root,"root").mkdirs();new File(root,"tmp").mkdirs();new File(root,"dev/shm").mkdirs();
        PythonBootstrap.ensure(root);
        new File(root,"opt/qq-workbench").mkdirs();
        // Only generated video scratch files from an interrupted previous run.
        // QQ profiles, user imports and all other cache entries are preserved.
        clearVideoTemps(new File(root,"opt/qq-workbench/video-imports"),"clip-[a-f0-9]{32}\\.bin");
        clearVideoTemps(context.getCacheDir(),"(?:video-sample-|qq-video-)[a-fA-F0-9-]{36}\\.tmp");
        if(!new File(root,"opt/snowluma/.bundle-v2.2.0").isFile()){
            progress.update("导入 SnowLuma 官方 ARM64 运行时…");File snow=new File(root,"opt/snowluma");snow.mkdirs();extract("snowluma.tar.gz",snow);Files.write(new File(snow,".bundle-v2.2.0").toPath(),new byte[]{1});
        }
        File bridgeRuntime=new File(root,"opt/qqwb-snow-1.14.22");
        if(!new File(bridgeRuntime,".bundle-1.14.22").isFile()){
            progress.update("导入已验证的 SnowLuma 1.14.22 接入组件…");bridgeRuntime.mkdirs();extract("snowluma-bridge.tar.gz",bridgeRuntime);Files.write(new File(bridgeRuntime,".bundle-1.14.22").toPath(),new byte[]{1});
        }
        File qq=new File(root,"opt/qq-workbench/linuxqq.deb");if(!qq.isFile())copyAsset("linuxqq.deb",qq);
          for(String name:new String[]{"install.sh","session.sh","assistant.mjs","shortcuts.mjs","qq-media.mjs","qzone-client.mjs","device-tools.mjs","usage-ledger.mjs","voice.mjs","model-client.mjs","personality-growth.mjs","group-moderation.mjs","conversation-memory.mjs","video.mjs","video-audio.mjs","video-decoder.mjs","native-network.mjs","web-learning.mjs","browse-intent.mjs","learning.mjs","images.mjs","chat-style.mjs","proc-locks-compat.mjs","snow-setup.py","snowluma-bridge.mjs","login.html","login.js"})copyAsset(name,new File(root,"opt/qq-workbench/"+name));
        File asr=new File(root,"opt/qq-workbench/asr");
        if(!new File(asr,".bundle-zipformer-ctc-small-zh-v1").isFile()){
            progress.update("准备离线中文音轨识别，视频声音不上传转写…");asr.mkdirs();extract("video-asr.tar.gz",asr);
            Files.write(new File(asr,".bundle-zipformer-ctc-small-zh-v1").toPath(),new byte[]{1});
        }
        copyAsset("bili-video.mjs",new File(root,"opt/qq-workbench/bili-video.mjs"));
        copyAsset("multi-parser.mjs",new File(root,"opt/qq-workbench/multi-parser.mjs"));
        File parser=new File(root,"opt/qq-workbench/parser");parser.mkdirs();
        extract("multi-parser.tar.gz",parser);
        copyAsset("snow-preload-loader.bin",new File(root,"opt/qq-workbench/snow-preload-loader.so"));
        File settings=new File(context.getFilesDir(),"settings.json");
        File liveSettings=new File(root,"opt/qq-workbench/settings.json");
        if(settings.isFile()&&!liveSettings.isFile())Files.copy(settings.toPath(),liveSettings.toPath());
        resolver();
    }
    void extract(String name,File dest)throws Exception{try(InputStream in=context.getAssets().open(name)){TrustedTar.extract(in,dest);}}
    static void clearVideoTemps(File directory,String pattern)throws IOException{
        if(!directory.isDirectory()||Files.isSymbolicLink(directory.toPath()))return;
        File[] files=directory.listFiles();if(files==null)return;
        for(File file:files)if(file.getName().matches(pattern)&&!Files.isSymbolicLink(file.toPath())&&file.isFile())file.delete();
    }
    void copyAsset(String name,File target)throws IOException{
        target.getParentFile().mkdirs();
        if(name.endsWith(".sh")){
            try(InputStream in=context.getAssets().open(name);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(bytes.size()+n>1024*1024)throw new IOException("启动脚本超过读取上限");bytes.write(b,0,n);}
                writePrivate(target,UnixText.normalize(bytes.toByteArray()));
            }
            return;
        }
        try(InputStream in=context.getAssets().open(name);OutputStream out=new FileOutputStream(target)){byte[] b=new byte[131072];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}
    }
    void resolver()throws Exception{
        ConnectivityManager cm=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
        LinkProperties lp=cm.getLinkProperties(cm.getActiveNetwork());StringBuilder s=new StringBuilder();
        if(lp!=null)for(java.net.InetAddress dns:lp.getDnsServers())s.append("nameserver ").append(dns.getHostAddress()).append('\n');
        if(s.length()>0){File resolv=new File(root,"etc/resolv.conf");if(Files.isSymbolicLink(resolv.toPath()))Files.delete(resolv.toPath());Files.write(resolv.toPath(),(s.toString()+"options timeout:3 attempts:2\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));}
    }
    void repairStage()throws Exception{
        if(RuntimeService.running)throw new IOException("请先停止本地服务");
        clearStage();
    }
    private void clearStage()throws Exception{
        Path stage=new File(base,"rootfs.stage").toPath();
        if(!stage.toAbsolutePath().normalize().getParent().equals(base.toPath().toAbsolutePath().normalize()))throw new IOException("初始化目录不匹配");
        if(Files.exists(stage,LinkOption.NOFOLLOW_LINKS))try(java.util.stream.Stream<Path> paths=Files.walk(stage)){for(Path item:paths.sorted(Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList()))Files.delete(item);}
    }
    Process start(String command,Map<String,String> env)throws Exception{
        if(accelerated==null)selectRuntimeMode(s->{});
        return processBuilder(command,env,accelerated).start();
    }
    void selectRuntimeMode(Progress progress)throws Exception{
        if(accelerated!=null)return;
        if(!Arrays.asList(android.os.Build.SUPPORTED_ABIS).contains("arm64-v8a"))throw new IOException("此安装包需要ARM64系统，当前设备不支持arm64-v8a");
        String device="设备："+android.os.Build.MANUFACTURER+" "+android.os.Build.MODEL+" · Android "+android.os.Build.VERSION.RELEASE;
        try{device+=" · 页大小 "+android.system.Os.sysconf(android.system.OsConstants._SC_PAGESIZE);}catch(Exception ignored){}
        RuntimeService.record(device);
        progress.update("正在检测容器加速能力…");
        // Probe fork/exec, path translation, sockets and shared memory before
        // starting QQ. A failed probe cannot leave a second QQ session behind.
        String probe="/usr/bin/python3 -c 'import os,socket,mmap,subprocess; assert os.stat(\"/etc/os-release\").st_size>0; a,b=socket.socketpair(); a.send(b\"x\"); assert b.recv(1)==b\"x\"; a.close(); b.close(); m=mmap.mmap(-1,4096); m[0]=1; m.close(); subprocess.run([\"/bin/true\"],check=True); print(\"QQWB_ACCEL_OK\")'";
        RuntimeProbe.Result fast=probeMode(probe,true,30000);
        if(fast.passed)accelerated=true;
        else{
            progress.update("加速检测未通过，正在检测兼容运行方式（最多60秒）…");
            RuntimeProbe.Result compatible=probeMode(probe,false,60000);
            if(compatible.passed)accelerated=false;
            else throw new IOException("容器运行检测未通过："+RuntimeProbe.diagnosis(compatible)+"；加速["+fast.status()+"]，兼容["+compatible.status()+"]。原数据保留");
        }
        progress.update(accelerated?"容器系统调用加速已启用":"容器使用兼容方式，QQ 启动可能较慢");
    }
    private RuntimeProbe.Result probeMode(String command,boolean fast,long timeout)throws Exception{
        RuntimeProbe.Result result;
        try{result=RuntimeProbe.run(processBuilder(command,Collections.emptyMap(),fast),timeout,"QQWB_ACCEL_OK");}
        catch(IOException e){RuntimeService.record((fast?"加速":"兼容")+"检测无法启动："+e.getMessage());throw e;}
        RuntimeService.record((fast?"加速":"兼容")+"检测："+result.status());
        // This process receives no credentials and runs only the fixed capability probe.
        // Keep enough diagnostic output to distinguish a timeout from missing libraries.
        if(!result.passed){String output=result.output.replace(context.getFilesDir().getAbsolutePath(),"<应用私有目录>").replaceAll("[\\p{Cntrl}&&[^\\n\\t]]","").trim();
            if(!output.isEmpty())RuntimeService.record(output.substring(0,Math.min(output.length(),4000)));
            File report=new File(context.getFilesDir(),"container-probe.txt");writePrivate(report,RuntimeService.logText());
        }
        return result;
    }
    private ProcessBuilder processBuilder(String command,Map<String,String> env,boolean fast)throws Exception{
        resolver();File links=new File(root,".l2s");links.mkdirs();File shm=new File(base,"shm");shm.mkdirs();
        List<String> argv=new ArrayList<>(Arrays.asList(new File(nativeDir,"libproot.so").getAbsolutePath(),"--link2symlink","-L","--kill-on-exit","-0","--rootfs="+root.getAbsolutePath(),"--cwd=/root","-b",links+":"+links));
        for(String bind:new String[]{"/dev","/proc","/sys","/system","/apex","/dev/urandom:/dev/random","/proc/self/fd:/dev/fd"}){argv.add("-b");argv.add(bind);}
        argv.add("-b");argv.add(shm.getAbsolutePath()+":/dev/shm");
        argv.addAll(Arrays.asList("/bin/bash","-c",command));
        ProcessBuilder pb=new ProcessBuilder(argv);pb.directory(base);pb.redirectErrorStream(true);
        Map<String,String> e=pb.environment();e.clear();
        e.put("HOME","/root");e.put("USER","root");e.put("LANG","C.UTF-8");e.put("TERM","xterm-256color");e.put("PATH","/opt/snowluma:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
        e.put("TMPDIR","/tmp");e.put("DEBIAN_FRONTEND","noninteractive");if(!fast)e.put("PROOT_NO_SECCOMP","1");e.put("PROOT_TMP_DIR",tmp.getAbsolutePath());e.put("PROOT_L2S_DIR",links.getAbsolutePath());
        e.put("PROOT_LOADER",new File(nativeDir,"libprootloader.so").getAbsolutePath());e.put("LD_LIBRARY_PATH",lib+":"+nativeDir);e.putAll(env);
        return pb;
    }
    static void writePrivate(File file,String text)throws IOException{file.getParentFile().mkdirs();File stage=new File(file.getParentFile(),file.getName()+".tmp");Files.write(stage.toPath(),text.getBytes(java.nio.charset.StandardCharsets.UTF_8));stage.setReadable(false,false);stage.setReadable(true,true);stage.setWritable(false,false);stage.setWritable(true,true);Files.move(stage.toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}
}
