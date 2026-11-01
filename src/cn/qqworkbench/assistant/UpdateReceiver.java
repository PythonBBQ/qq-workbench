package cn.qqworkbench.assistant;
import android.content.*;
public final class UpdateReceiver extends BroadcastReceiver {
    public void onReceive(Context context,Intent intent){if(Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction()))UpdateFlow.replaced(context);}
}
