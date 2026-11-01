package cn.qqworkbench.assistant;
import java.io.*;

/** Real child processes test pipe pressure, timeout cleanup and interrupted waits. */
public final class RuntimeProbeCheck {
    public static void main(String[] args)throws Exception{
        if(args.length>0){
            if(args[0].equals("flood")){System.out.println("QQWB_ACCEL_OK");for(int i=0;i<20000;i++)System.out.println("bounded probe output "+i);return;}
            if(args[0].equals("late-marker")){for(int i=0;i<20000;i++)System.out.println("early warning "+i);System.out.println("QQWB_ACCEL_OK");return;}
            if(args[0].equals("slow")){Thread.sleep(1200);System.out.println("QQWB_ACCEL_OK");return;}
            if(args[0].equals("hang")){Thread.sleep(60000);return;}
            if(args[0].equals("fail")){System.out.println("proot: ptrace: Operation not permitted");System.exit(1);}
            if(args[0].equals("missing")){System.out.println("loader: No such file");System.exit(1);}
            if(args[0].equals("no-marker")){System.out.println("QQWB_ACCEL_NOT_OK");return;}
        }
        RuntimeProbe.Result flooded=RuntimeProbe.run(child("flood"),10000,"QQWB_ACCEL_OK");
        require(flooded.passed&&!flooded.timedOut,"flood output must not block child");require(flooded.output.length()<=RuntimeProbe.OUTPUT_LIMIT,"bounded capture");
        require(RuntimeProbe.run(child("late-marker"),10000,"QQWB_ACCEL_OK").passed,"marker after diagnostic truncation is still detected");
        RuntimeProbe.Result slow=RuntimeProbe.run(child("slow"),5000,"QQWB_ACCEL_OK");require(slow.passed,"slow valid probe passes");
        RuntimeProbe.Result timeout=RuntimeProbe.run(child("hang"),150,"QQWB_ACCEL_OK");require(timeout.timedOut&&!timeout.passed,"timeout distinguishes failure");require(timeout.elapsedMs<7000,"timeout child cleaned");
        RuntimeProbe.Result failed=RuntimeProbe.run(child("fail"),10000,"QQWB_ACCEL_OK");require(failed.exit==1&&!failed.timedOut,"exit preserved");require(RuntimeProbe.diagnosis(failed).contains("进程跟踪"),"ptrace category");
        RuntimeProbe.Result missing=RuntimeProbe.run(child("missing"),10000,"QQWB_ACCEL_OK");require(RuntimeProbe.diagnosis(missing).contains("运行库缺失"),"missing-library category");
        require(!RuntimeProbe.run(child("no-marker"),10000,"QQWB_ACCEL_OK").passed,"not arbitrary exit zero");
        Thread worker=new Thread(()->{try{RuntimeProbe.run(child("hang"),60000,"QQWB_ACCEL_OK");throw new AssertionError("expected interrupt");}catch(InterruptedException expected){}catch(IOException e){throw new RuntimeException(e);}});worker.start();Thread.sleep(250);worker.interrupt();worker.join(6000);require(!worker.isAlive(),"interrupted probe released");
        System.out.println("QQWB_RUNTIME_PROBE_OK: bounded pipe drain, slow success, timeout cleanup, exit diagnostics, missing marker, cancellation");
    }
    static ProcessBuilder child(String mode){String java=new File(System.getProperty("java.home"),"bin/java.exe").getAbsolutePath();return new ProcessBuilder(java,"-cp",System.getProperty("java.class.path"),RuntimeProbeCheck.class.getName(),mode);}
    static void require(boolean ok,String detail){if(!ok)throw new AssertionError(detail);}
}
