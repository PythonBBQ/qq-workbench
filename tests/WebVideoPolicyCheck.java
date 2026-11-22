package cn.qqworkbench.assistant;
import java.net.URL;
public final class WebVideoPolicyCheck {
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args)throws Exception{
        for(int mb:new int[]{32,64,128,256,512})check(VideoFrames.inputMB(mb)==mb);
        for(int mb:new int[]{-1,0,1,33,1024})check(VideoFrames.inputMB(mb)==256);
        java.io.File target=new java.io.File(args[0],"bounded-video.bin");boolean limited=false;
        try{VideoFrames.copy(new java.io.ByteArrayInputStream(new byte[2048]),target,1024);}catch(java.io.IOException expected){limited=true;}finally{target.delete();}check(limited);
        check(VideoFrames.mediaHost(new URL("https://cdn.example/clip.mp4"),"web"));
        for(String value:new String[]{"http://cdn.example/clip.mp4","https://cdn.example:8443/clip.mp4","https://user:password@cdn.example/clip.mp4"})check(!VideoFrames.mediaHost(new URL(value),"web"));
        check(!VideoFrames.mediaHost(new URL("https://cdn.example/clip.mp4"),"qq"));
        check(!VideoFrames.mediaHost(new URL("https://cdn.example/clip.mp4"),"bilibili"));
        check(!VideoFrames.mediaHost(new URL("https://cdn.example/clip.mp4"),"unknown"));
        check(VideoFrames.mediaHost(new URL("https://cdn.bilivideo.com/clip.mp4"),"bilibili"));
        check(NativeNetwork.mediaResponse("video/mp4"));check(NativeNetwork.mediaResponse("application/vnd.apple.mpegurl"));
        check(!NativeNetwork.mediaResponse("text/html"));check(!NativeNetwork.mediaResponse(null));
        for(String value:new String[]{"https://127.0.0.1/secret.mp4","https://192.168.1.1/secret.mp4","https://localhost/video"}){
            try{NativeNetwork.publicUrl(value);throw new AssertionError();}catch(java.io.IOException expected){}
        }
        System.out.println("QQWB_WEB_VIDEO_POLICY_OK: media sources, public URLs, no widened QQ/Bili permissions and header-only probes");
    }
}
