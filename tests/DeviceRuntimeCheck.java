package cn.qqworkbench.assistant;
import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.lang.reflect.*;
import java.util.UUID;

/** Read-only real integration check. No model calls, QQ sends or screen actions. */
public final class DeviceRuntimeCheck {
    static String token;
    static String hash(String value)throws Exception{byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes("UTF-8"));StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format("%02x",b&255));return out.toString();}
    static JSONObject request(int port,String route,JSONObject body)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:"+port+route).openConnection();
        c.setConnectTimeout(3000);c.setReadTimeout(25000);c.setRequestProperty("Authorization","Bearer "+token);
        if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes("UTF-8"));}}
        try{if(c.getResponseCode()!=200)throw new IOException("Local interface rejected request: "+c.getResponseCode());ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){byte[] b=new byte[2048];int n;while((n=in.read(b))!=-1){if(bytes.size()+n>131072)throw new IOException("Response too large");bytes.write(b,0,n);}}return new JSONObject(bytes.toString("UTF-8"));}finally{c.disconnect();}
    }
    public static void main(String[] args)throws Exception{
        android.os.Looper.prepareMainLooper();Class<?> at=Class.forName("android.app.ActivityThread");Constructor<?> constructor=at.getDeclaredConstructor();constructor.setAccessible(true);Object thread=constructor.newInstance();Method getContext=at.getDeclaredMethod("getSystemContext");getContext.setAccessible(true);
        Context app=((Context)getContext.invoke(thread)).createPackageContext("cn.qqworkbench.assistant",Context.CONTEXT_IGNORE_SECURITY);
        Class.forName("android.security.keystore2.AndroidKeyStoreProvider").getMethod("install").invoke(null);
        token=new Secrets(app).get("internal");if(token.length()<24)throw new IOException("Existing local credentials missing");
        JSONObject state=request(13480,"/state",null),usage=request(13480,"/usage",null),permission=request(13481,"/device/state",new JSONObject());
        if(!permission.optBoolean("granted"))throw new IOException("Shizuku must be granted through the app first");
        JSONObject c=new JSONObject(new String(java.nio.file.Files.readAllBytes(new File(app.getFilesDir(),"linux/rootfs/opt/qq-workbench/settings.json").toPath()),"UTF-8"));if(!c.optBoolean("deviceToolsEnabled"))throw new IOException("Device tools must be enabled in settings first");
        String id=hash(UUID.randomUUID().toString());
        JSONObject call=new JSONObject().put("id",id).put("sender",c.getString("owner")).put("operation",new JSONObject().put("action","battery"));
        JSONObject result=request(13481,"/device/action",call);if(!result.optBoolean("ok")||!result.optString("output").contains("level:"))throw new IOException("Battery command did not complete: "+result.optString("message"));
        JSONObject repeated=request(13481,"/device/action",call);if(repeated.optBoolean("ok")||!repeated.optString("message").contains("不重复执行"))throw new IOException("Persistent action dedup failed");
        call.put("id",hash(UUID.randomUUID().toString())).put("sender",c.getString("owner").equals("10001")?"10002":"10001");
        boolean denied=false;try{request(13481,"/device/action",call);}catch(IOException expected){denied=true;}if(!denied)throw new IOException("Foreign sender was accepted");
        JSONObject after=request(13480,"/usage",null);if(after.getJSONObject("today").getInt("calls")!=usage.getJSONObject("today").getInt("calls"))throw new IOException("Usage count changed during check; repeat without active chat");
        System.out.println("QQWB_DEVICE_RUNTIME_OK "+new JSONObject().put("qqConnected",state.optBoolean("connected")).put("shizukuUid",permission.optInt("uid")).put("batteryRead",true).put("persistentDedup",true).put("foreignSenderDenied",denied).put("usageEndpoint",true).put("extraModelCalls",0));
    }
}
