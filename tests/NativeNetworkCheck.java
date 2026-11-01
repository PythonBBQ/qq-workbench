package cn.qqworkbench.assistant;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;
public final class NativeNetworkCheck {
    public static void main(String[] args)throws Exception{
        for(String url:new String[]{"http://example.com","https://127.0.0.1","https://192.168.1.2","https://localhost","https://user:pass@example.com"}){
            try{NativeNetwork.publicUrl(url);throw new AssertionError("Unsafe URL accepted");}catch(IOException expected){}
        }
        String token="isolated-network-check-0123456789012345";
        try(NativeNetwork service=new NativeNetwork(token)){
            HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:13481/fetch").openConnection();c.setRequestMethod("POST");c.setDoOutput(true);try(OutputStream out=c.getOutputStream()){out.write("{}".getBytes(StandardCharsets.UTF_8));}if(c.getResponseCode()!=401)throw new AssertionError("Auth missing");c.disconnect();
            if(args.length>0){
                JSONObject request=new JSONObject().put("url",args[0]).put("method","GET");
                c=(HttpURLConnection)new URL("http://127.0.0.1:13481/fetch").openConnection();c.setConnectTimeout(5000);c.setReadTimeout(25000);c.setRequestMethod("POST");c.setRequestProperty("Authorization","Bearer "+token);c.setDoOutput(true);try(OutputStream out=c.getOutputStream()){out.write(request.toString().getBytes(StandardCharsets.UTF_8));}
                int status=c.getResponseCode();ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=status>=400?c.getErrorStream():c.getInputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)bytes.write(b,0,n);}JSONObject result=new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8));
                System.out.println(new JSONObject().put("androidTransportStatus",status).put("upstreamStatus",result.optInt("status")).put("error",result.optString("error")).put("modelKeySent",false));c.disconnect();
            }
        }
        System.out.println("QQWB_NATIVE_NETWORK_AUTH_AND_URL_CHECK_OK");
    }
}
