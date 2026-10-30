package cn.qqworkbench.assistant;

import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
import android.util.Base64;

/** Authenticated loopback transport using Android's DNS, proxy and TLS stack. */
final class NativeNetwork implements AutoCloseable {
    private final ServerSocket listener;
    private final byte[] authorization;
    private final ThreadPoolExecutor workers=new ThreadPoolExecutor(0,4,30,TimeUnit.SECONDS,new SynchronousQueue<Runnable>());
    private final Set<HttpURLConnection> active=Collections.synchronizedSet(new HashSet<HttpURLConnection>());
    private volatile boolean closed;
    private final android.content.Context context;
    NativeNetwork(String token)throws IOException{this(token,null);}
    NativeNetwork(String token,android.content.Context context)throws IOException{
        this.context=context;
        if(token.length()<24)throw new IOException("Missing local authentication");
        authorization=("Bearer "+token).getBytes(StandardCharsets.UTF_8);
        listener=new ServerSocket();listener.setReuseAddress(true);listener.bind(new InetSocketAddress("127.0.0.1",13481),8);
        Thread accept=new Thread(()->{while(!closed)try{Socket socket=listener.accept();try{workers.execute(()->handle(socket));}catch(RejectedExecutionException busy){socket.close();}}catch(IOException ignored){}});
        accept.setDaemon(true);accept.start();
    }
    static URL publicUrl(String value)throws Exception{
        URI u=new URI(value);
        if(!"https".equalsIgnoreCase(u.getScheme())||u.getHost()==null||u.getRawUserInfo()!=null||u.getRawFragment()!=null)throw new IOException("仅支持公开 HTTPS 地址");
        String host=u.getHost().toLowerCase(Locale.ROOT);
        if(host.equals("localhost")||host.endsWith(".localhost")||host.endsWith(".local")||!host.contains("."))throw new IOException("不读取本机或内网地址");
        // Let Android resolve public hostnames through the system/VPN resolver.
        // VPN fake-IP ranges must remain usable; reject literal private IPs.
        if(host.matches("[0-9.]+")||host.contains(":")){
            InetAddress ip=InetAddress.getByName(host.replace("[","").replace("]",""));
            if(ip.isAnyLocalAddress()||ip.isLoopbackAddress()||ip.isLinkLocalAddress()||ip.isSiteLocalAddress()||ip.isMulticastAddress())throw new IOException("不读取本机或内网地址");
        }
        for(InetAddress ip:InetAddress.getAllByName(host)){
            byte[] raw=ip.getAddress();
            if(ip.isAnyLocalAddress()||ip.isLoopbackAddress()||ip.isLinkLocalAddress()||ip.isSiteLocalAddress()||ip.isMulticastAddress()||raw.length==16&&(raw[0]&0xfe)==0xfc)throw new IOException("域名指向本机或内网，未访问");
        }
        return u.toURL();
    }
    private static String line(InputStream in)throws IOException{
        ByteArrayOutputStream out=new ByteArrayOutputStream();int n;
        while((n=in.read())!=-1){if(n=='\n')return out.toString("US-ASCII").replace("\r","");if(out.size()>=8192)throw new IOException("Header too large");out.write(n);}
        throw new EOFException();
    }
    private static byte[] read(InputStream in,int limit)throws IOException{
        if(in==null)return new byte[0];ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[32768];int n;
        while((n=in.read(b))!=-1){if(out.size()+n>limit)throw new IOException("响应超过读取上限");out.write(b,0,n);}return out.toByteArray();
    }
    private static void response(Socket socket,int status,JSONObject data)throws IOException{
        byte[] body=data.toString().getBytes(StandardCharsets.UTF_8);
        OutputStream out=socket.getOutputStream();out.write(("HTTP/1.1 "+status+" Result\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: "+body.length+"\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(body);out.flush();
    }
    private void handle(Socket socket){
        try(Socket s=socket){s.setSoTimeout(100000);InputStream in=new BufferedInputStream(s.getInputStream());
            String route=line(in);boolean video=route.equals("POST /video-frames HTTP/1.1"),updates=route.equals("POST /app-update HTTP/1.1");
            if(!route.equals("POST /fetch HTTP/1.1")&&!video&&!updates&&!route.equals("POST /device/state HTTP/1.1")&&!route.equals("POST /device/action HTTP/1.1")){response(s,404,new JSONObject());return;}
            Map<String,String> headers=new HashMap<>();String row;int total=0;
            while(!(row=line(in)).isEmpty()){total+=row.length();if(total>16384)throw new IOException("Headers too large");int colon=row.indexOf(':');if(colon<1)throw new IOException("Invalid header");headers.put(row.substring(0,colon).toLowerCase(Locale.ROOT),row.substring(colon+1).trim());}
            if(headers.containsKey("origin")||!MessageDigest.isEqual(authorization,headers.getOrDefault("authorization","").getBytes(StandardCharsets.UTF_8))){response(s,401,new JSONObject());return;}
            int length=Integer.parseInt(headers.getOrDefault("content-length","0"));if(length<2||length>24*1024*1024)throw new IOException("Invalid body size");
            byte[] body=new byte[length];int offset=0;while(offset<length){int n=in.read(body,offset,length-offset);if(n<0)throw new EOFException();offset+=n;}
            JSONObject request=new JSONObject(new String(body,StandardCharsets.UTF_8));
            try{if(route.equals("POST /device/state HTTP/1.1")){if(context==null)throw new IOException("No app context");response(s,200,DeviceTools.get(context).state());}else if(route.equals("POST /device/action HTTP/1.1")){if(context==null)throw new IOException("No app context");response(s,200,DeviceTools.get(context).run(request));}else if(updates){if(context==null)throw new IOException("Update service unavailable");response(s,200,AppUpdates.check(context));}else if(video){if(context==null)throw new IOException("Video service unavailable");response(s,200,VideoFrames.remote(context,request.getString("url"),"bilibili".equals(request.optString("source"))));}else response(s,200,fetch(request));}catch(Exception e){String type=e instanceof java.net.SocketTimeoutException?"timeout":e instanceof java.net.UnknownHostException?"dns":e instanceof javax.net.ssl.SSLException?"tls":"network";response(s,502,new JSONObject().put("error",type).put("message",video&&e.getMessage()!=null&&e.getMessage().matches("^(B站|视频|链接).*")?e.getMessage():"网络请求未完成"));}
        }catch(Exception ignored){}
    }
    static boolean qzoneCredentials(URL url,String method){
        if(!url.getProtocol().equals("https")||(url.getPort()!=-1&&url.getPort()!=443)||url.getUserInfo()!=null)return false;
        String prefix=url.getHost().equalsIgnoreCase("h5.qzone.qq.com")?"/proxy/domain/taotao.qzone.qq.com/":url.getHost().equalsIgnoreCase("user.qzone.qq.com")?"/proxy/domain/taotao.qq.com/":"";
        if(prefix.isEmpty())return false;
        return (method.equals("GET")&&url.getPath().equals(prefix+"cgi-bin/emotion_cgi_msglist_v6"))||(method.equals("POST")&&url.getPath().equals(prefix+"cgi-bin/emotion_cgi_publish_v6"));
    }
    JSONObject fetch(JSONObject request)throws Exception{
        URL url=publicUrl(request.getString("url"));String method=request.optString("method","GET");
        if(!method.equals("GET")&&!method.equals("POST"))throw new IOException("Unsupported method");
        HttpURLConnection c=(HttpURLConnection)url.openConnection();active.add(c);
        int timeout=Math.max(500,Math.min(90000,request.optInt("timeoutMs",90000)));
        try{c.setInstanceFollowRedirects(false);c.setConnectTimeout(Math.min(15000,timeout));c.setReadTimeout(timeout);c.setRequestMethod(method);
            JSONObject h=request.optJSONObject("headers");if(h!=null)for(Iterator<String> keys=h.keys();keys.hasNext();){String key=keys.next();if((qzoneCredentials(url,method)&&Arrays.asList("cookie","referer").contains(key.toLowerCase(Locale.ROOT)))||(parserCredentials(url,method)&&Arrays.asList("cookie","referer","origin","accept-language","x-requested-with","x-oidb","x-qq-client-appid").contains(key.toLowerCase(Locale.ROOT)))||Arrays.asList("authorization","content-type","accept","user-agent","ocp-apim-subscription-key","x-microsoft-outputformat").contains(key.toLowerCase(Locale.ROOT)))c.setRequestProperty(key,h.getString(key));}
            if(method.equals("POST")){byte[] bytes=request.optString("body","").getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}}
            int status=c.getResponseCode();JSONObject resultHeaders=new JSONObject();for(String key:new String[]{"Content-Type","Location","Retry-After","Set-Cookie"}){String value=c.getHeaderField(key);if(value!=null)resultHeaders.put(key,value);}
            try(InputStream stream=status>=400?c.getErrorStream():c.getInputStream()){
                return new JSONObject().put("status",status).put("headers",resultHeaders).put("body",Base64.encodeToString(read(stream,8*1024*1024),Base64.NO_WRAP));
            }
        }finally{active.remove(c);c.disconnect();}
    }
    static boolean parserCredentials(URL url,String method){
        if(!url.getProtocol().equals("https")||url.getPort()!=-1&&url.getPort()!=443)return false;
        String host=url.getHost().toLowerCase(Locale.ROOT);
        if(!method.equals("GET")&&!host.equals("pd.qq.com"))return false;
        for(String suffix:new String[]{"bilibili.com","b23.tv","bili2233.cn","douyin.com","iesdouyin.com","xiaohongshu.com","xiaohongshu.cn","xhslink.com","xhslink.cn","tieba.baidu.com","tiebac.baidu.com","weibo.com","weibo.cn","sina.com.cn","sina.cn","zhihu.com","zhihu.com.cn","xiaoheihe.cn","heybox.com","heybox.cn","weixin.qq.com","yuanbao.tencent.com","hdslb.com","xhscdn.com","sinaimg.cn","zhimg.com","qpic.cn","qlogo.cn","pximg.net","pd.qq.com"})if(host.equals(suffix)||host.endsWith("."+suffix))return true;
        return false;
    }
    public void close(){closed=true;try{listener.close();}catch(IOException ignored){}synchronized(active){for(HttpURLConnection c:active)c.disconnect();}workers.shutdownNow();}
}
