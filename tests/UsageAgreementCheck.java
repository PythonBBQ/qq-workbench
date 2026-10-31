package cn.qqworkbench.assistant;
import android.content.*;
import java.lang.reflect.*;
import java.util.*;

/** Isolated consent preferences only; never accepts the real user's agreement. */
public final class UsageAgreementCheck {
    static void check(boolean ok){if(!ok)throw new AssertionError();}
    public static void main(String[] args)throws Exception{
        android.os.Looper.prepareMainLooper();Class<?> at=Class.forName("android.app.ActivityThread");Method systemMain=at.getDeclaredMethod("systemMain");systemMain.setAccessible(true);Object thread=systemMain.invoke(null);Method get=at.getDeclaredMethod("getSystemContext");get.setAccessible(true);Context app=((Context)get.invoke(thread)).createPackageContext("cn.qqworkbench.assistant",Context.CONTEXT_IGNORE_SECURITY);
        Map<String,Object> saved=new HashMap<>();boolean[] canCommit={true};Map<String,Object> pending=new HashMap<>();
        SharedPreferences.Editor edit=(SharedPreferences.Editor)Proxy.newProxyInstance(UsageAgreementCheck.class.getClassLoader(),new Class[]{SharedPreferences.Editor.class},(p,m,a)->{String n=m.getName();if(n.equals("putString")||n.equals("putLong")){pending.put((String)a[0],a[1]);return p;}if(n.equals("commit")){if(canCommit[0])saved.putAll(pending);pending.clear();return canCommit[0];}throw new UnsupportedOperationException(n);});
        SharedPreferences prefs=(SharedPreferences)Proxy.newProxyInstance(UsageAgreementCheck.class.getClassLoader(),new Class[]{SharedPreferences.class},(p,m,a)->{switch(m.getName()){case "getString":case "getLong":return saved.getOrDefault(a[0],a[1]);case "edit":return edit;default:throw new UnsupportedOperationException(m.getName());}});
        Context isolated=new ContextWrapper(app){public SharedPreferences getSharedPreferences(String name,int mode){check(name.equals(UsageAgreement.PREFS));return prefs;}};
        String text=UsageAgreement.read(isolated);check(text.contains("仅供个人、非商业"));check(!UsageAgreement.accepted(isolated));
        check(!UsageAgreement.accept(isolated,text+"changed"));check(saved.isEmpty());
        canCommit[0]=false;check(!UsageAgreement.accept(isolated,text));check(!UsageAgreement.accepted(isolated));
        canCommit[0]=true;check(UsageAgreement.accept(isolated,text));check(UsageAgreement.accepted(isolated));check((Long)saved.get("acceptedAt")>0);
        saved.put("acceptedDigest",UsageAgreement.digest(text+"next version"));check(!UsageAgreement.accepted(isolated));
        saved.put("acceptedDigest",UsageAgreement.digest(text));saved.put("acceptedAt",0L);check(!UsageAgreement.accepted(isolated));
        Context missing=new ContextWrapper(isolated){public android.content.res.AssetManager getAssets(){return null;}};check(!UsageAgreement.accepted(missing));
        System.out.println("QQWB_USAGE_AGREEMENT_OK: default refusal, shown-content match, persistence failure, explicit acceptance, version/time validation, missing-asset refusal; real agreement preferences untouched");
    }
}
