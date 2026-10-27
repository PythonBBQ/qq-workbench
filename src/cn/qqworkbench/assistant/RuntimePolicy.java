package cn.qqworkbench.assistant;

/** Pure recovery policy: bounded restarts, never restart a still-running child. */
final class RuntimePolicy {
    static final long WINDOW_MS=10*60*1000L;
    static boolean mayRecover(long now,long window,int attempts){return now<window||now-window>=WINDOW_MS||attempts<3;}
    static boolean resetWindow(long now,long window){return now<window||now-window>=WINDOW_MS;}
    static long retryDelay(int attempt){return Math.min(30000,5000L*Math.max(1,attempt));}
    static boolean unexpectedExit(int code,boolean stopping){return !stopping&&code!=0&&code!=75;}
    static boolean schedulingGap(long previous,long now){return previous>0&&now-previous>90000;}
}
