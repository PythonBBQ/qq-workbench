package cn.qqworkbench.assistant;

import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Host sockets exercise refused, wrong HTTP, redirect and RFB readiness. */
public final class QqWindowProbeCheck {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static final class Server implements AutoCloseable {
        final ServerSocket server;final ExecutorService worker=Executors.newSingleThreadExecutor();volatile boolean closed;
        Server(String response)throws IOException{server=new ServerSocket(0,20,InetAddress.getByName("127.0.0.1"));worker.submit(()->{while(!closed)try(Socket s=server.accept()){s.setSoTimeout(1000);if(response.startsWith("HTTP/")){BufferedReader request=new BufferedReader(new InputStreamReader(s.getInputStream(),StandardCharsets.US_ASCII));String line;while((line=request.readLine())!=null&&!line.isEmpty()){} }s.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));s.getOutputStream().flush();}catch(IOException e){if(!closed)throw new RuntimeException(e);}});}
        int port(){return server.getLocalPort();}public void close()throws IOException{closed=true;server.close();worker.shutdownNow();}
    }
    public static void main(String[] args)throws Exception{
        int absent;try(ServerSocket s=new ServerSocket(0)){absent=s.getLocalPort();}
        check(QqWindowProbe.checkPorts(absent,absent)==QqWindowProbe.Status.WEB_UNAVAILABLE,"refused");
        try(Server web=new Server("HTTP/1.1 200 OK\r\nContent-Length: 18\r\nConnection: close\r\n\r\n<html>noVNC</html>");Server desktop=new Server("RFB 003.008\n");Server unrelated=new Server("hello")){
            check(QqWindowProbe.checkPorts(web.port(),desktop.port())==QqWindowProbe.Status.READY,"ready");
            check(QqWindowProbe.checkPorts(web.port(),absent)==QqWindowProbe.Status.DESKTOP_UNAVAILABLE,"missing desktop");
            check(QqWindowProbe.checkPorts(web.port(),unrelated.port())==QqWindowProbe.Status.DESKTOP_UNAVAILABLE,"wrong desktop");
        }
        for(String response:new String[]{"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nother","HTTP/1.1 302 Found\r\nLocation: https://example.com/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n","HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"})try(Server web=new Server(response)){check(QqWindowProbe.checkPorts(web.port(),absent)==QqWindowProbe.Status.WEB_UNAVAILABLE,"bad HTTP");}
        check(QqWindowProbe.webPort(0)==16080&&QqWindowProbe.webPort(3)==16083,"ports");
        check(QqWindowProbe.allowed(0,"http://127.0.0.1:16080/vnc.html#password=test"),"local url");
        for(String url:new String[]{"http://127.0.0.1:16081/vnc.html","http://127.0.0.1:6080/vnc.html","https://evil.example/","file:///etc/passwd","http://user:pass@127.0.0.1:16080/vnc.html"})check(!QqWindowProbe.allowed(0,url),"reject foreign url");
        System.out.println("QQWB_LOGIN_PROBE_OK: real local HTTP/RFB sockets, refused/partial/wrong services, redirects and slot isolation");
        // Android's HTTP stack can keep service threads alive in app_process.
        System.exit(0);
    }
}
