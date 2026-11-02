package cn.qqworkbench.assistant;
import android.content.*;
import android.os.Looper;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import org.json.*;
public final class PhoneUpdateProbe {
    public static void main(String[] args)throws Exception{
        new Thread(()->{try{
            String configured=AppUpdates.DEFAULT_FEED;
            File prefs=new File("/data/user/0/cn.qqworkbench.assistant/shared_prefs/settings.xml");
            if(prefs.isFile())try(InputStream in=new FileInputStream(prefs)){org.xmlpull.v1.XmlPullParser parser=android.util.Xml.newPullParser();parser.setInput(in,"UTF-8");while(parser.next()!=org.xmlpull.v1.XmlPullParser.END_DOCUMENT)if(parser.getEventType()==org.xmlpull.v1.XmlPullParser.START_TAG&&parser.getName().equals("string")&&"updateFeed".equals(parser.getAttributeValue(null,"name")))configured=parser.nextText();}
            URL source=AppUpdates.releaseUrl(configured);System.out.println("QQWB_PHONE_UPDATE_CONFIG "+new JSONObject().put("feed",source.toString()));
            for(URL url:new URL[]{source,UpdateFeed.fallback(source),UpdateFeed.index(source)}){
                HttpURLConnection c=null;long began=System.currentTimeMillis();try{c=AppUpdates.connection(NativeNetwork.publicUrl(url.toString()));int status=c.getResponseCode();JSONObject result=new JSONObject().put("host",url.getHost()).put("status",status).put("rateRemaining",c.getHeaderField("X-RateLimit-Remaining")).put("rateReset",c.getHeaderField("X-RateLimit-Reset")).put("elapsedMs",System.currentTimeMillis()-began);if(status==403){String body=new String(AppUpdates.read(c.getErrorStream(),32768),"UTF-8");try{result.put("publicError",new JSONObject(body).optString("message").substring(0,Math.min(160,new JSONObject(body).optString("message").length())));}catch(Exception ignored){}}System.out.println("QQWB_PHONE_UPDATE_ROUTE "+result);}catch(Exception e){System.out.println("QQWB_PHONE_UPDATE_ROUTE "+new JSONObject().put("host",url.getHost()).put("error",e.getClass().getSimpleName()).put("elapsedMs",System.currentTimeMillis()-began));}finally{if(c!=null)c.disconnect();}
            }
            JSONObject forced=UpdateFeed.read(source,url->{if(url.getHost().equals("api.github.com"))return new java.net.HttpURLConnection(url){public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public int getResponseCode(){return 403;}};return AppUpdates.connection(NativeNetwork.publicUrl(url.toString()));});System.out.println("QQWB_PHONE_UPDATE_FORCED_403_RECOVERED "+new JSONObject().put("version",forced.getString("tag_name")).put("transport",forced.getString("_transport")));
            JSONObject raw=UpdateFeed.read(source,url->{if(url.getHost().equals("api.github.com")||url.getHost().equals("github.com"))return new java.net.HttpURLConnection(url){public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public int getResponseCode(){return 403;}};return AppUpdates.connection(NativeNetwork.publicUrl(url.toString()));});System.out.println("QQWB_PHONE_UPDATE_RAW_RECOVERED "+new JSONObject().put("version",raw.getString("tag_name")).put("transport",raw.getString("_transport")));
            if(java.util.Arrays.asList(args).contains("--download")){
                JSONObject asset=null;JSONArray items=forced.getJSONArray("assets");for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);if(item.getString("name").equals("QQWorkbench-from-63c63c1e0b5f1aab401e549dc8c02739787d8905f6649063489601687c61baba.qqpatch"))asset=item;}
                if(asset==null||asset.getLong("size")>5*1024*1024)throw new IOException("Small diagnostic patch missing");
                File dir=new File("/data/user/0/cn.qqworkbench.assistant/cache/update-route-check-"+java.util.UUID.randomUUID());
                try{JSONObject request=new JSONObject().put("url",asset.getString("browser_download_url")).put("bytes",asset.getLong("size")).put("digest",asset.getString("digest"));File downloaded=ResumableDownload.fetch(dir,request,url->AppUpdates.connection(AppUpdates.assetUrl(url.toString())),ResumableDownload.NONE);System.out.println("QQWB_PHONE_PATCH_DOWNLOAD_OK "+new JSONObject().put("bytes",downloaded.length()).put("sha256",ApkPatch.sha(downloaded)).put("installed",false));}finally{MigrationArchive.erase(dir);}
            }
            JSONObject release=UpdateFeed.read(source,url->AppUpdates.connection(NativeNetwork.publicUrl(url.toString())));System.out.println("QQWB_PHONE_UPDATE_CHECK "+new JSONObject().put("version",release.getString("tag_name")).put("transport",release.getString("_transport")).put("assets",release.getJSONArray("assets").length()));System.exit(0);
        }catch(Throwable e){System.out.println("QQWB_PHONE_UPDATE_FAILED "+e.getClass().getSimpleName()+": "+e.getMessage());System.exit(1);}},"update-phone-probe").start();
    }
}
