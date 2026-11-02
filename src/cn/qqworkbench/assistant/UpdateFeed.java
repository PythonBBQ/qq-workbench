package cn.qqworkbench.assistant;
import java.io.*;
import java.net.*;
import java.util.*;
import org.json.*;

/** Two public GitHub routes; no authentication token and no third-party mirror. */
final class UpdateFeed {
    interface Open{HttpURLConnection open(URL u)throws Exception;}
    static String repository(URL api)throws IOException{
        String p=api.getPath();if(!api.getHost().equals("api.github.com")||!p.matches("/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/latest"))throw new IOException("更新源无效");return p.substring(7,p.length()-"/releases/latest".length());
    }
    static URL fallback(URL api)throws Exception{return new URL("https://github.com/"+repository(api)+"/releases/latest/download/update.json");}
    static URL index(URL api)throws Exception{return new URL("https://raw.githubusercontent.com/"+repository(api)+"/main/updates/latest.json");}
    static JSONObject validate(JSONObject release,URL source)throws Exception{
        String repo=repository(source),tag=release.optString("tag_name");if(!tag.matches("[vV]?[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}(?:[-.][A-Za-z0-9.-]+)?"))throw new IOException("发行版版本号无效");
        JSONArray assets=release.optJSONArray("assets");if(assets==null||assets.length()>100)throw new IOException("发行版文件清单无效");
        Set<String> names=new HashSet<>();for(int i=0;i<assets.length();i++){JSONObject asset=assets.getJSONObject(i);String name=asset.getString("name");if(!names.add(name))throw new IOException("发行版文件重复");
            if(!name.endsWith(".qqpatch")&&!name.toLowerCase(Locale.ROOT).endsWith(".apk"))continue;
            URL u=AppUpdates.assetAddress(asset.getString("browser_download_url"));String expected="/"+repo+"/releases/download/"+tag+"/";
            if(!u.getHost().equals("github.com")||!u.getPath().startsWith(expected)||u.getQuery()!=null)throw new IOException("更新资源不属于此发行版");
            if(!asset.optString("digest").matches("sha256:[a-f0-9]{64}")||!AppUpdates.validApkSize(asset.optLong("size")))throw new IOException("更新资源缺少大小或校验值");
        }return release;
    }
    static JSONObject read(URL source,Open open)throws Exception{
        Exception primary=null;
        for(int route=0;route<3;route++){
            URL url=route==0?source:route==1?fallback(source):index(source);
            try{
                for(int hops=0;hops<6;hops++){
                    // Every redirect is checked before connecting, including private DNS checks in production.
                    HttpURLConnection c=open.open(url);
                    try{int status=c.getResponseCode();if(status>=300&&status<400){String location=c.getHeaderField("Location");if(location==null)throw new IOException("更新源跳转无效");url=AppUpdates.assetAddress(new URL(url,location).toString());continue;}
                        if(status!=200)throw new IOException("更新源暂不可用（"+status+"）");
                        JSONObject result=new JSONObject(new String(AppUpdates.read(c.getInputStream(),512*1024),"UTF-8"));validate(result,source);result.put("_transport",route==0?"github-api":route==1?"github-release-manifest":"github-raw-index");return result;
                    }finally{c.disconnect();}
                }throw new IOException("更新源跳转过多");
            }catch(Exception e){if(route==0)primary=e;else if(route==2)throw new IOException((primary==null?"更新检查失败":primary.getMessage())+"；备用发行清单也不可用，请稍后重试",e);}
        }throw new IOException("更新检查失败");
    }
}
