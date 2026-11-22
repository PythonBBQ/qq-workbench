package cn.qqworkbench.assistant;

public final class RuntimeRecoveryPolicyCheck {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args){
        check(RuntimePolicy.restoreAfterBoot(true,true,false),"An enabled, consented session resumes after boot");
        check(!RuntimePolicy.restoreAfterBoot(false,true,false),"Manual stop persists across reboot");
        check(!RuntimePolicy.restoreAfterBoot(true,false,false),"First launch and revoked consent cannot start services");
        check(!RuntimePolicy.restoreAfterBoot(true,true,true),"An interrupted restore/update owns runtime recovery");
        check(!RuntimePolicy.restoreAfterBoot(false,false,true),"No initialization as a side effect of boot");
        check(RuntimePolicy.mayRecover(700000,0,3),"Expired crash limit does not permanently block later recovery");
        check(!RuntimePolicy.mayRecover(500000,0,3),"Repeated crash recovery stays bounded");
        check(RuntimePolicy.unexpectedExit(0,false),"A normal child exit without a user stop still needs recovery");
        check(!RuntimePolicy.unexpectedExit(0,true),"Manual stop never restarts a normal child");
        check(!RuntimePolicy.unexpectedExit(75,false),"A live owner lock never causes a second QQ launch");
        check(RuntimePolicy.recentlyHealthy(100000,60000,true),"Fresh verified connection can skip recovery");
        check(!RuntimePolicy.recentlyHealthy(160000,60000,true),"Stale health cannot skip recovery");
        check(!RuntimePolicy.recentlyHealthy(100000,60000,false),"Reachable local server alone is not QQ online");
        check(!RuntimePolicy.recentlyHealthy(1000,60000,true),"Wall clock correction cannot preserve stale health");
        check(!RuntimePolicy.adoptedSessionLost(2,true),"A transient local timeout must not relaunch QQ");
        check(!RuntimePolicy.adoptedSessionLost(20,false),"An unresponsive but owned runtime must not be duplicated");
        check(RuntimePolicy.adoptedSessionLost(3,true),"A departed adopted session can recover after its lock is verified free");
        System.out.println("QQWB_BOOT_RECOVERY_POLICY_OK: prior enable, manual stop, agreement, maintenance and bounded crash recovery");
    }
}
