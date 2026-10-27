package cn.qqworkbench.assistant;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import java.io.File;
import java.lang.reflect.*;
import java.util.Arrays;
import org.json.JSONObject;

/** Read-only validation with the installed app's real context; never starts an installer. */
public final class InstalledUpdateCheck {
    public static void main(String[] args)throws Exception{
        android.os.Looper.prepareMainLooper();Class<?> at=Class.forName("android.app.ActivityThread");
        java.lang.reflect.Constructor<?> constructor=at.getDeclaredConstructor();constructor.setAccessible(true);Object thread=constructor.newInstance();Method getContext=at.getDeclaredMethod("getSystemContext");getContext.setAccessible(true);
        Context system=(Context)getContext.invoke(thread);Context app=system.createPackageContext("cn.qqworkbench.assistant",Context.CONTEXT_IGNORE_SECURITY);
        PackageInfo installed=app.getPackageManager().getPackageInfo(app.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
        File candidate=new File(args[0]);AppUpdates.verify(app,candidate);
        boolean wrongRejected=false;if(args.length>1){try{AppUpdates.verify(app,new File(args[1]));}catch(Exception expected){wrongRejected=true;}}
        JSONObject result=new JSONObject().put("candidateVerifiedAgainstInstalledApp",true).put("installedVersion",installed.versionName).put("wrongPackageRejected",wrongRejected).put("installed",false);
        if(Arrays.asList(args).contains("--network")){JSONObject release=AppUpdates.check(app);result.put("releaseCheck",release.optString("message")).put("releaseAvailable",release.optBoolean("available"));}
        System.out.println("QQWB_INSTALLED_UPDATE_CHECK "+result);
    }
}
