package cn.qqworkbench.assistant;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

/** Check both local services before showing a credential-bearing login URL. */
final class QqWindowProbe {
    enum Status { READY, WEB_UNAVAILABLE, DESKTOP_UNAVAILABLE }
    static int webPort(int slot){if(slot<0||slot>3)throw new IllegalArgumentException("账号槽位无效");return 16080+slot;}
    static boolean allowed(int slot,String url){try{URI u=URI.create(url);return "http".equals(u.getScheme())&&"127.0.0.1".equals(u.getHost())&&u.getPort()==webPort(slot)&&u.getUserInfo()==null;}catch(Exception e){return false;}}
    static Status check(int slot){return checkPorts(webPort(slot),15917+slot);}
    static Status checkPorts(int web,int desktop){
        HttpURLConnection c=null;
        try{
            c=(HttpURLConnection)new URL("http://127.0.0.1:"+web+"/vnc.html").openConnection(Proxy.NO_PROXY);c.setConnectTimeout(700);c.setReadTimeout(700);c.setInstanceFollowRedirects(false);c.setUseCaches(false);
            if(c.getResponseCode()!=200)return Status.WEB_UNAVAILABLE;
            try(InputStream in=c.getInputStream()){ByteArrayOutputStream b=new ByteArrayOutputStream();byte[] part=new byte[1024];int n;boolean found=false;while(b.size()<8192&&(n=in.read(part,0,Math.min(part.length,8192-b.size())))!=-1){b.write(part,0,n);if(new String(b.toByteArray(),StandardCharsets.UTF_8).toLowerCase(java.util.Locale.ROOT).contains("novnc")){found=true;break;}}if(!found)return Status.WEB_UNAVAILABLE;}
        }catch(IOException e){return Status.WEB_UNAVAILABLE;}finally{if(c!=null)c.disconnect();}
        try(Socket socket=new Socket()){socket.connect(new InetSocketAddress("127.0.0.1",desktop),700);socket.setSoTimeout(700);byte[] hello=new byte[4];new DataInputStream(socket.getInputStream()).readFully(hello);return new String(hello,StandardCharsets.US_ASCII).equals("RFB ")?Status.READY:Status.DESKTOP_UNAVAILABLE;}catch(IOException e){return Status.DESKTOP_UNAVAILABLE;}
    }
}
