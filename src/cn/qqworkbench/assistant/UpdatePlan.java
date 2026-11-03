package cn.qqworkbench.assistant;
import java.io.IOException;
import org.json.*;

/** Select by exact installed APK hash; a version label alone never identifies a base. */
final class UpdatePlan {
    final JSONObject patch,full;
    UpdatePlan(JSONObject patch,JSONObject full){this.patch=patch;this.full=full;}
    static boolean newer(String remote,String installed,long remoteCode,long installedCode){int version=AppUpdates.compare(remote,installed);return version>0||(version==0&&remoteCode>installedCode);}
    static boolean patches(JSONArray assets){if(assets!=null)for(int i=0;i<assets.length();i++){JSONObject a=assets.optJSONObject(i);if(a!=null&&a.optString("name").endsWith(".qqpatch"))return true;}return false;}
    static UpdatePlan choose(JSONArray assets,String hash)throws Exception{
        JSONObject patch=null,full=null;
        if(assets!=null)for(int i=0;i<assets.length();i++){JSONObject a=assets.optJSONObject(i);if(a==null)continue;String name=a.optString("name");
            if(name.equals("QQWorkbench-from-"+hash+".qqpatch")&&hash.matches("[a-f0-9]{64}")){if(patch!=null)throw new IOException("发行版补丁重复");patch=a;}
            if(name.toLowerCase(java.util.Locale.ROOT).endsWith(".apk")){if(full!=null)throw new IOException("发行版包含多个APK，无法确定更新包");full=a;}
        }
        return new UpdatePlan(patch,full);
    }
}
