package cn.qqworkbench.assistant;

/** Pure recovery policy: bounded restarts, never restart a still-running child. */
final class RuntimePolicy {
    static final long WINDOW_MS=10*60*1000L;
    static boolean mayRecover(long now,long window,int attempts){return now<window||now-window>=WINDOW_MS||attempts<3;}
    static boolean resetWindow(long now,long window){return now<window||now-window>=WINDOW_MS;}
    static long retryDelay(int attempt){return Math.min(30000,5000L*Math.max(1,attempt));}
    static boolean unexpectedExit(int code,boolean stopping){return !stopping&&code!=75;}
    static boolean resumeDue(long previous,long now){return previous==0||now<previous||now-previous>=15000;}
    static boolean schedulingGap(long previous,long now){return previous>0&&now-previous>90000;}
    static boolean restoreAfterBoot(boolean requested,boolean accepted,boolean maintenance){return requested&&accepted&&!maintenance;}
    static boolean recentlyHealthy(long now,long checked,boolean connected){return connected&&checked>0&&now>=checked&&now-checked<90000;}
    static boolean adoptedSessionLost(int failures,boolean lockFree){return failures>=3&&lockFree;}
}
