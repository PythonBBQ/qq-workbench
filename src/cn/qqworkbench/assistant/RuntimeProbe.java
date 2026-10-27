package cn.qqworkbench.assistant;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/** Drain diagnostics during execution; a full pipe must never masquerade as a timeout. */
final class RuntimeProbe {
    static final int OUTPUT_LIMIT=8192;
    static final class Result {
        final boolean passed,timedOut;final int exit;final long elapsedMs;final String output;
        Result(boolean ok,boolean timeout,int code,long ms,String value){passed=ok;timedOut=timeout;exit=code;elapsedMs=ms;output=value;}
        String status(){return (passed?"通过":timedOut?"超时":"退出码 "+exit)+" · "+elapsedMs+"毫秒";}
    }
    static final class Capture {
        final ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        final String marker;String tail="";boolean found;
        Capture(String marker){this.marker=marker;}
        synchronized void append(byte[] value,int count){int n=Math.min(count,OUTPUT_LIMIT-bytes.size());if(n>0)bytes.write(value,0,n);
            String chunk=tail+new String(value,0,count,StandardCharsets.UTF_8);if(chunk.contains(marker))found=true;
            tail=chunk.substring(Math.max(0,chunk.length()-marker.length()+1));
        }
        synchronized boolean matched(){return found;}
        synchronized String value(){return new String(bytes.toByteArray(),StandardCharsets.UTF_8);}
    }
    static Result run(ProcessBuilder builder,long timeoutMs,String marker)throws IOException,InterruptedException{
        long start=System.nanoTime();Process process=builder.redirectErrorStream(true).start();Capture capture=new Capture(marker);
        Thread reader=new Thread(()->{try(InputStream in=process.getInputStream()){byte[] b=new byte[2048];int n;while((n=in.read(b))!=-1)capture.append(b,n);}catch(IOException ignored){}},"qqwb-probe-output");reader.setDaemon(true);reader.start();
        boolean finished=false;
        try{
            finished=process.waitFor(timeoutMs,TimeUnit.MILLISECONDS);
            if(!finished)terminate(process);
            reader.join(2000);String output=capture.value();int exit=finished?process.exitValue():-1;
            return new Result(finished&&exit==0&&capture.matched(),!finished,exit,TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start),output);
        }finally{
            if(process.isAlive())terminate(process);
            try{process.getInputStream().close();}catch(IOException ignored){}
        }
    }
    private static void terminate(Process process)throws IOException,InterruptedException{
        if(!process.isAlive())return;process.destroy();
        if(!process.waitFor(2000,TimeUnit.MILLISECONDS)){process.destroyForcibly();if(!process.waitFor(2000,TimeUnit.MILLISECONDS))throw new IOException("容器检测进程未退出，已停止启动");}
    }
    static String diagnosis(Result result){
        String s=result.output.toLowerCase(java.util.Locale.ROOT);
        if(result.timedOut)return "运行探测超时，可能启动较慢或被系统暂停";
        if(s.contains("ptrace")||s.contains("seccomp")||s.contains("operation not permitted"))return "系统限制了容器所需的进程跟踪或系统调用";
        if(s.contains("permission denied"))return "系统拒绝执行容器或访问必要文件";
        if(s.contains("shared libraries")||s.contains("no such file")||s.contains("not found"))return "容器程序或运行库缺失，请查看具体路径";
        if(s.contains("page size")||s.contains("elf")||s.contains("exec format"))return "原生程序与系统页大小或架构可能不兼容";
        if(s.contains("traceback")||s.contains("modulenotfounderror"))return "Python运行环境出错";
        return "运行探测未完成，具体输出已记录";
    }
}
