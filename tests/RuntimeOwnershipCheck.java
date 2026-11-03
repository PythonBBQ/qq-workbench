package cn.qqworkbench.assistant;
import java.util.*;
public final class RuntimeOwnershipCheck {
    static RuntimeProcesses.Entry entry(int pid,int parent,String... args){return new RuntimeProcesses.Entry(pid,parent,"same-birth",Arrays.asList(args));}
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
        String root="/data/user/0/cn.qqworkbench.assistant/files/linux/rootfs";
        check(RuntimeProcesses.container(entry(1,0,"/native/libproot.so","--rootfs="+root),root));
        check(!RuntimeProcesses.container(entry(1,0,"/native/libproot.so","--rootfs="+root+"-other"),root));
        check(!RuntimeProcesses.container(entry(1,0,"/native/qq","--rootfs="+root),root));
        check(!RuntimeProcesses.container(entry(1,0,"/native/libproot.so","--cwd="+root),root));
        Map<Integer,RuntimeProcesses.Entry> all=new HashMap<>();all.put(10,entry(10,1));all.put(11,entry(11,10));all.put(12,entry(12,11));all.put(13,entry(13,1));
        Set<Integer> owned=RuntimeProcesses.descendants(all,new HashSet<>(Arrays.asList(10)));check(owned.equals(new HashSet<>(Arrays.asList(10,11,12))));
        System.out.println("QQWB_RUNTIME_OWNERSHIP_OK: exact root and executable, descendants only, unrelated processes excluded");
    }
}
