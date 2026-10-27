package cn.qqworkbench.assistant;

import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import org.json.*;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;

/** Public releases only. Provider/model credentials are never used for updates. */
final class AppUpdates {
    static final String DEFAULT_FEED="https://api.github.com/repos/PythonBBQ/qq-workbench/releases/latest";
    static String feed(Context c){return c.getSharedPreferences("settings",0).getString("updateFeed",DEFAULT_FEED);}
    static URL releaseUrl(String value)throws Exception{
        URL u=NativeNetwork.publicUrl(value);
        if(!u.getHost().equals("api.github.com")||u.getPort()!=-1||!u.getPath().matches("/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/latest")||u.getQuery()!=null)throw new IOException("请填写 GitHub 最新发行版 API 地址");return u;
    }
    static int compare(String a,String b){String[] x=a.replaceFirst("^[vV]","").split("[.-]"),y=b.replaceFirst("^[vV]","").split("[.-]");for(int i=0;i<3;i++){int n=i<x.length&&x[i].matches("[0-9]{1,6}")?Integer.parseInt(x[i]):0,m=i<y.length&&y[i].matches("[0-9]{1,6}")?Integer.parseInt(y[i]):0;if(n!=m)return Integer.compare(n,m);}return 0;}
    static byte[] read(InputStream input,int limit)throws Exception{try(InputStream in=input;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1){if(out.size()+n>limit)throw new IOException("更新信息过大");out.write(b,0,n);}return out.toByteArray();}}
    static HttpURLConnection connection(URL url)throws Exception{HttpURLConnection c=(HttpURLConnection)url.openConnection();c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setInstanceFollowRedirects(false);c.setRequestProperty("User-Agent","QQWorkbench-Updater");c.setRequestProperty("Accept","application/vnd.github+json");return c;}
    static JSONObject check(Context context)throws Exception{
        HttpURLConnection c=connection(releaseUrl(feed(context)));JSONObject release;
        try{int status=c.getResponseCode();if(status==404)return new JSONObject().put("available",false).put("message","此项目暂无可用发行版；可在设置中更换更新源");if(status!=200)throw new IOException("更新源暂不可用（"+status+"）");release=new JSONObject(new String(read(c.getInputStream(),512*1024),"UTF-8"));}finally{c.disconnect();}
        String tag=release.optString("tag_name"),current=context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName;JSONArray assets=release.optJSONArray("assets");
        if(!tag.matches("[vV]?[0-9]{1,6}\\.[0-9]{1,6}\\.[0-9]{1,6}(?:[-.][A-Za-z0-9.-]+)?"))return new JSONObject().put("available",false).put("message","发行版未提供可识别的版本号");
        if(compare(tag,current)<=0)return new JSONObject().put("available",false).put("message","当前已是最新版本").put("version",tag);
        JSONObject asset=null;if(assets!=null)for(int i=0;i<assets.length();i++){JSONObject a=assets.optJSONObject(i);if(a!=null&&a.optString("name").toLowerCase(Locale.ROOT).endsWith(".apk")){if(asset!=null)throw new IOException("发行版有多个安装包，请使用只发布本应用APK的更新源");asset=a;}}
        if(asset==null)return new JSONObject().put("available",false).put("message","新发行版尚未提供安卓安装包");
        assetUrl(asset.optString("browser_download_url"));long size=asset.optLong("size");if(size<=0||size>600L*1024*1024)throw new IOException("更新包大小无效");
        return new JSONObject().put("available",true).put("version",tag).put("url",asset.getString("browser_download_url")).put("bytes",size).put("digest",asset.optString("digest")).put("message","发现新版本 "+tag);
    }
    static URL assetUrl(String value)throws Exception{URL u=NativeNetwork.publicUrl(value);String h=u.getHost();if(!(h.equals("github.com")||h.equals("objects.githubusercontent.com")||h.equals("release-assets.githubusercontent.com"))||u.getPort()!=-1)throw new IOException("更新包必须来自 GitHub 发行版");return u;}
    static File file(Context c){return new File(new File(c.getCacheDir(),"updates"),"latest.apk");}
    static File download(Context context,JSONObject release)throws Exception{
        File target=file(context);target.getParentFile().mkdirs();File temporary=new File(target.getParentFile(),"download.part");URL url=assetUrl(release.getString("url"));long expected=release.getLong("bytes");MessageDigest hash=MessageDigest.getInstance("SHA-256");
        try{boolean complete=false;for(int hops=0;hops<5;hops++){
            HttpURLConnection c=connection(url);c.setRequestProperty("Accept","application/octet-stream");
            try{int status=c.getResponseCode();if(status>=300&&status<400){url=assetUrl(new URL(url,c.getHeaderField("Location")).toString());continue;}if(status!=200)throw new IOException("更新下载失败（"+status+"）");
                long count=0;try(InputStream in=c.getInputStream();OutputStream out=new FileOutputStream(temporary)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){if(Thread.currentThread().isInterrupted())throw new InterruptedIOException();count+=n;if(count>expected||count>600L*1024*1024)throw new IOException("更新包超过预期大小");hash.update(b,0,n);out.write(b,0,n);}}
                if(count!=expected)throw new IOException("更新下载不完整，请重试");complete=true;break;
            }finally{c.disconnect();}
        }if(!complete)throw new IOException("更新下载跳转过多");
            String digest=release.optString("digest");if(!digest.isEmpty()){StringBuilder actual=new StringBuilder();for(byte b:hash.digest())actual.append(String.format(Locale.ROOT,"%02x",b&255));if(!digest.equals("sha256:"+actual))throw new IOException("更新包哈希校验失败");}
            verify(context,temporary);if(target.exists()&&!target.delete())throw new IOException("无法替换旧更新包");if(!temporary.renameTo(target))throw new IOException("无法保存更新包");return target;
        }finally{temporary.delete();}
    }
    static void verify(Context c,File f)throws Exception{
        PackageManager pm=c.getPackageManager();PackageInfo apk=pm.getPackageArchiveInfo(f.getAbsolutePath(),PackageManager.GET_SIGNING_CERTIFICATES),installed=pm.getPackageInfo(c.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
        if(apk==null||!c.getPackageName().equals(apk.packageName)||apk.getLongVersionCode()<=installed.getLongVersionCode())throw new IOException("更新包不是本应用的新版本");
        if(apk.signingInfo==null||installed.signingInfo==null||!signatures(apk).equals(signatures(installed)))throw new IOException("更新包签名与当前软件不一致，已拒绝安装");
    }
    static Set<String> signatures(PackageInfo p)throws Exception{Set<String> result=new HashSet<>();for(Signature s:p.signingInfo.getApkContentsSigners())result.add(android.util.Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(s.toByteArray()),android.util.Base64.NO_WRAP));return result;}
    static Intent installer(Context c)throws Exception{
        File file=file(c);verify(c,file);
        if(!c.getPackageManager().canRequestPackageInstalls())return new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+c.getPackageName()));
        return new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://"+c.getPackageName()+".updates/apk/latest"),"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }
}
