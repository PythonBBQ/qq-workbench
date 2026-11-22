package cn.qqworkbench.assistant;

import android.content.*;

/** Restore only a previously requested session, after credential storage unlocks. */
public final class BootRecoveryReceiver extends BroadcastReceiver {
    public void onReceive(Context context,Intent intent){
        if(intent==null||!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()))return;
        SharedPreferences p=context.getSharedPreferences("runtime",0);
        if(!RuntimePolicy.restoreAfterBoot(p.getBoolean("requested",false),UsageAgreement.accepted(context),DataMigration.busy||Maintenance.pending(context)))return;
        // Persist the retry before trying the service: a failed first attempt
        // must not leave the UI as the only way to resume a saved account.
        p.edit().putLong("lastBootRecovery",System.currentTimeMillis()).putBoolean("bootRecoveryPending",true)
            .putBoolean("qqConnected",false).putLong("lastHealthy",0).putInt("recoveryAttempts",0).putLong("recoveryWindow",0).commit();
        RuntimeRecovery.event(context,"已收到开机恢复，首次解锁后自动恢复QQ；等待真实在线核验");
        RuntimeRecovery.recover(context,"boot");
    }
}
