package cn.qqworkbench.assistant;

import android.os.*;
import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.util.concurrent.*;

/** Runs as Shizuku's shell UID in a separate process, not in the QQ container. */
public final class DeviceShellService extends Binder {
    static final String DESCRIPTOR="cn.qqworkbench.assistant.DeviceShell";
    final int appUid;
    public DeviceShellService(Context context){appUid=context.getApplicationInfo().uid;attachInterface(null,DESCRIPTOR);}
    @Override public boolean onTransact(int code,Parcel data,Parcel reply,int flags)throws RemoteException{
        int uid=Binder.getCallingUid();if(uid!=appUid)throw new SecurityException("Unexpected caller");
        if(code==16777115){System.exit(0);return true;}
        if(code!=1)return super.onTransact(code,data,reply,flags);
        data.enforceInterface(DESCRIPTOR);
        JSONObject result;
        try{String raw=data.readString();if(raw==null||raw.length()>2048)throw new Exception("参数无效");result=execute(new JSONObject(raw));}
        catch(Exception e){result=new JSONObject();try{result.put("ok",false).put("message","设备动作未完成，请检查Shizuku和参数");}catch(Exception ignored){}}
        reply.writeNoException();reply.writeString(result.toString());return true;
    }
    static JSONObject execute(JSONObject request)throws Exception{
        String[] command=DeviceCommand.args(request);java.lang.Process process=new ProcessBuilder(command).redirectErrorStream(true).start();
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();Thread reader=new Thread(()->{try(InputStream in=process.getInputStream()){byte[] chunk=new byte[1024];int n;while((n=in.read(chunk))!=-1){synchronized(bytes){if(bytes.size()<16384)bytes.write(chunk,0,Math.min(n,16384-bytes.size()));}}}catch(IOException ignored){}});reader.setDaemon(true);reader.start();
        try{
            boolean complete=process.waitFor(12,TimeUnit.SECONDS);if(!complete){process.destroyForcibly();reader.join(1000);return new JSONObject().put("ok",false).put("uncertain",!DeviceCommand.readOnly(request.getString("action"))).put("message","设备动作超时，停止后续动作；不自动重试");}
            reader.join(1000);String output;synchronized(bytes){output=bytes.toString("UTF-8");}
            return new JSONObject().put("ok",process.exitValue()==0).put("exitCode",process.exitValue()).put("output",output).put("message",process.exitValue()==0?"系统命令执行完成；不代表已核对屏幕效果":"系统未能执行此动作");
        }catch(InterruptedException e){Thread.currentThread().interrupt();throw e;}
        finally{if(process.isAlive())process.destroyForcibly();try{process.getInputStream().close();}catch(IOException ignored){}try{process.getOutputStream().close();}catch(IOException ignored){}reader.interrupt();}
    }
}
