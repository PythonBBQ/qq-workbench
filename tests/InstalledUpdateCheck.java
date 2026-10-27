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
    public static void main(String[] args){try{diagnose(args);}catch(Throwable e){System.out.println("QQWB_INSTALLED_UPDATE_CHECK "+new JSONObject().put("completed",false).put("errorType",e.getClass().getSimpleName()));System.exit(2);}}
    static void diagnose(String[] args)throws Exception{
        android.os.Looper.prepareMainLooper();Class<?> at=Class.forName("android.app.ActivityThread");
        java.lang.reflect.Constructor<?> constructor=at.getDeclaredConstructor();constructor.setAccessible(true);Object thread=constructor.newInstance();Method getContext=at.getDeclaredMethod("getSystemContext");getContext.setAccessible(true);
        Context system=(Context)getContext.invoke(thread);Context app=system.createPackageContext("cn.qqworkbench.assistant",Context.CONTEXT_IGNORE_SECURITY);
        PackageInfo installed=app.getPackageManager().getPackageInfo(app.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
        File candidate=new File(args[0]);AppUpdates.verify(app,candidate);
        boolean wrongRejected=false;if(args.length>1){try{AppUpdates.verify(app,new File(args[1]));}catch(Exception expected){wrongRejected=true;}}
        JSONObject result=new JSONObject().put("candidateVerifiedAgainstInstalledApp",true).put("installedVersion",installed.versionName).put("wrongPackageRejected",wrongRejected).put("installed",false);
        if(Arrays.asList(args).contains("--network")||Arrays.asList(args).contains("--download")){JSONObject release=AppUpdates.check(app);result.put("releaseCheck",release.optString("message")).put("releaseAvailable",release.optBoolean("available"));
            if(Arrays.asList(args).contains("--download")){long start=System.currentTimeMillis();Context original=app;File scratch=new File("/data/local/tmp/qqwb-update-download-check");scratch.mkdirs();Context isolated=new android.content.ContextWrapper(original){public File getCacheDir(){return scratch;}};File downloaded=AppUpdates.download(isolated,release);result.put("releaseDownloadVerified",true).put("downloadedBytes",downloaded.length()).put("downloadElapsedMs",System.currentTimeMillis()-start);if(!downloaded.delete())throw new java.io.IOException("Diagnostic download cleanup failed");result.put("testDownloadRemoved",true).put("downloadContext","isolated-shell-cache");downloaded.getParentFile().delete();scratch.delete();}
        }
        System.out.println("QQWB_INSTALLED_UPDATE_CHECK "+result);
    }
}
