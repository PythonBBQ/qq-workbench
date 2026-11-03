package cn.qqworkbench.assistant;

import android.content.Context;
import android.os.SystemClock;
import java.io.*;
import java.nio.file.Files;
import java.util.*;

/** Only the current app UID's containers with this exact rootfs are eligible. */
final class RuntimeProcesses {
    static final class Entry {
        final int pid,parent; final String birth; final List<String> command;
        Entry(int p,int pp,String b,List<String> c){pid=p;parent=pp;birth=b;command=c;}
    }
    static Entry read(File proc,int pid,int uid)throws IOException{
        File dir=new File(proc,Integer.toString(pid));
        if(android.system.Os.getuid()!=uid)throw new IOException("运行用户不一致");
        try{if(android.system.Os.stat(dir.getPath()).st_uid!=uid)return null;}catch(android.system.ErrnoException e){return null;}
        String stat=new String(Files.readAllBytes(new File(dir,"stat").toPath()),"UTF-8");
        String[] fields=stat.substring(stat.lastIndexOf(')')+2).split(" ");
        if(fields[0].equals("Z"))return null;
        String cmd=new String(Files.readAllBytes(new File(dir,"cmdline").toPath()),"UTF-8");
        return new Entry(pid,Integer.parseInt(fields[1]),fields[19],Arrays.asList(cmd.split("\u0000")));
    }
    static boolean container(Entry e,String root){return !e.command.isEmpty()&&e.command.get(0).endsWith("/libproot.so")&&e.command.contains("--rootfs="+root);}
    static Map<Integer,Entry> scan(){
        Map<Integer,Entry> all=new HashMap<>();File proc=new File("/proc");String[] names=proc.list();if(names==null)return all;
        for(String n:names)try{int pid=Integer.parseInt(n);Entry e=read(proc,pid,android.system.Os.getuid());if(e!=null)all.put(pid,e);}catch(Exception ignored){}
        return all;
    }
    static Set<Integer> descendants(Map<Integer,Entry> all,Set<Integer> roots){
        Set<Integer> result=new HashSet<>(roots);boolean changed;
        do{changed=false;for(Entry e:all.values())if(result.contains(e.parent)&&result.add(e.pid))changed=true;}while(changed);
        return result;
    }
    static boolean alive(Entry entry){try{Entry now=read(new File("/proc"),entry.pid,android.system.Os.getuid());return now!=null&&now.birth.equals(entry.birth);}catch(Exception e){return false;}}
    static void signal(Entry e,int signal){if(alive(e))android.os.Process.sendSignal(e.pid,signal);}
    static void stop(Context c)throws Exception{
        String root=new Container(c).root.getAbsolutePath();Map<Integer,Entry> all=scan();Set<Integer> roots=new HashSet<>();
        for(Entry e:all.values())if(container(e,root))roots.add(e.pid);
        if(roots.isEmpty())return;
        Set<Integer> owned=descendants(all,roots);
        // Leave the tracer alive while its tracees handle TERM and flush files.
        for(int pid:owned)if(!roots.contains(pid))signal(all.get(pid),15);
        long end=SystemClock.elapsedRealtime()+5000;
        while(SystemClock.elapsedRealtime()<end){boolean live=false;for(int pid:owned)if(!roots.contains(pid)&&alive(all.get(pid)))live=true;if(!live)break;Thread.sleep(100);}
        // Include helpers spawned during graceful shutdown, without following recycled PIDs.
        Map<Integer,Entry> latest=scan();Set<Integer> liveRoots=new HashSet<>();for(int pid:roots)if(alive(all.get(pid)))liveRoots.add(pid);
        for(int pid:descendants(latest,liveRoots))if(!liveRoots.contains(pid))signal(latest.get(pid),9);
        for(int pid:owned)if(!roots.contains(pid))signal(all.get(pid),9);
        for(int pid:roots)signal(all.get(pid),15);
        Thread.sleep(250);for(int pid:roots)signal(all.get(pid),9);
        end=SystemClock.elapsedRealtime()+3000;
        while(SystemClock.elapsedRealtime()<end){boolean live=false;for(int pid:owned)if(alive(all.get(pid)))live=true;if(!live)return;Thread.sleep(100);}
        throw new IOException("原会话仍在退出，未开始备份或覆盖数据");
    }
    static void unlocked(Context c,long waitMs)throws Exception{
        Container container=new Container(c);if(!new File(container.root,".qq-rootfs-v1").isFile())return;
        RuntimeProbe.Result result=RuntimeProbe.run(container.start("exec flock -w "+Math.max(1,waitMs/1000)+" -E 75 /opt/qq-workbench/.runtime.lock /bin/echo QQWB_UNLOCKED",Collections.emptyMap()),waitMs+4000,"QQWB_UNLOCKED");
        if(result.passed)return;
        if(result.exit==75)throw new IOException("原会话尚未释放运行锁，未开始备份或覆盖数据");
        throw new IOException("无法核验运行锁："+RuntimeProbe.diagnosis(result)+"（"+result.status()+"）");
    }
}
