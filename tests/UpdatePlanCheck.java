package cn.qqworkbench.assistant;
import org.json.*;
public final class UpdatePlanCheck {
    static void check(boolean value){if(!value)throw new AssertionError();}
    static JSONObject asset(String name)throws Exception{return new JSONObject().put("name",name);}
    public static void main(String[] args)throws Exception{
        String a=String.join("",java.util.Collections.nCopies(64,"a")),b=String.join("",java.util.Collections.nCopies(64,"b"));
        JSONObject full=asset("QQWorkbench-Android.apk"),patch=asset("QQWorkbench-from-"+a+".qqpatch");JSONArray assets=new JSONArray().put(patch).put(full);
        UpdatePlan chosen=UpdatePlan.choose(assets,a);check(chosen.patch==patch&&chosen.full==full);
        chosen=UpdatePlan.choose(assets,b);check(chosen.patch==null&&chosen.full==full);
        chosen=UpdatePlan.choose(new JSONArray().put(patch),b);check(chosen.patch==null&&chosen.full==null);
        boolean failed=false;try{UpdatePlan.choose(new JSONArray().put(full).put(asset("other.apk")),a);}catch(java.io.IOException expected){failed=true;}check(failed);
        failed=false;try{UpdatePlan.choose(new JSONArray().put(patch).put(patch),a);}catch(java.io.IOException expected){failed=true;}check(failed);
        check(UpdatePlan.newer("v1.0.8","1.0.7",10009,10007));check(UpdatePlan.newer("v1.0.8","1.0.8",10009,10008));check(!UpdatePlan.newer("v1.0.8","1.0.8",10009,10009));check(!UpdatePlan.newer("v1.0.7","1.0.8",10010,10009));
        System.out.println("QQWB_UPDATE_PLAN_OK: exact-hash patches, explicit full fallback, missing/duplicate assets, same-version newer build");
    }
}
