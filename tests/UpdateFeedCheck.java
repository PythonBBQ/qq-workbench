package cn.qqworkbench.assistant;
import java.io.*;
import java.net.*;
import java.util.*;
import org.json.*;
public final class UpdateFeedCheck {
    static void check(boolean b){if(!b)throw new AssertionError();}
    static class Reply extends HttpURLConnection{
        final int status;final String body,redirect;
        Reply(URL u,int s,String b,String r){super(u);status=s;body=b;redirect=r;}
        public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
        public int getResponseCode(){return status;}public String getHeaderField(String n){return n.equals("Location")?redirect:null;}
        public InputStream getInputStream()throws IOException{return new ByteArrayInputStream(body.getBytes("UTF-8"));}
    }
    public static void main(String[] args)throws Exception{
        URL source=new URL(AppUpdates.DEFAULT_FEED);String valid=new JSONObject().put("tag_name","v1.0.7").put("assets",new JSONArray().put(new JSONObject().put("name","example.qqpatch").put("size",123).put("digest","sha256:"+String.join("",Collections.nCopies(64,"a"))).put("browser_download_url","https://github.com/PythonBBQ/qq-workbench/releases/download/v1.0.7/example.qqpatch"))).toString().replace("\\/","/");
        int[] calls={0};JSONObject release=UpdateFeed.read(source,u->{calls[0]++;return new Reply(u,200,valid,null);});check(calls[0]==1&&release.getString("_transport").equals("github-api"));
        calls[0]=0;release=UpdateFeed.read(source,u->{int n=calls[0]++;if(n==0){check(u.getHost().equals("api.github.com"));return new Reply(u,403,"",null);}check(u.getHost().equals("github.com"));return new Reply(u,200,valid,null);});check(calls[0]==2&&release.getString("_transport").equals("github-release-manifest"));
        calls[0]=0;release=UpdateFeed.read(source,u->{int n=calls[0]++;if(n==0)throw new java.net.SocketTimeoutException();return n==1?new Reply(u,302,"","https://release-assets.githubusercontent.com/test/update.json"):new Reply(u,200,valid,null);});check(calls[0]==3);
        boolean failed=false;try{UpdateFeed.read(source,u->new Reply(u,403,"",null));}catch(IOException e){failed=e.getMessage().contains("403")&&e.getMessage().contains("备用");}check(failed);
        for(String wrong:new String[]{valid.replace("PythonBBQ/qq-workbench/releases/download","other/repo/releases/download"),valid.replace("sha256:","md5:"),valid.replace("v1.0.7/example", "v9.0.0/example")}){failed=false;try{UpdateFeed.validate(new JSONObject(wrong),source);}catch(Exception e){failed=true;}check(failed);}
        calls[0]=0;failed=false;try{UpdateFeed.read(source,u->{calls[0]++;return u.getHost().equals("api.github.com")?new Reply(u,429,"",null):new Reply(u,302,"","https://evil.example/updates.json");});}catch(IOException e){failed=true;}check(failed&&calls[0]==3);
        calls[0]=0;release=UpdateFeed.read(source,u->{int n=calls[0]++;return new Reply(u,n<2?403:200,n<2?"":valid,null);});check(calls[0]==3&&release.getString("_transport").equals("github-raw-index"));
        System.out.println("QQWB_UPDATE_FEED_OK: API 403/429 and timeout fallback, bounded GitHub redirects, same-repository/version/digest validation, no token required, failure stays failure");
    }
}
