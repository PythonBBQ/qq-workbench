package cn.qqworkbench.assistant;
import android.graphics.*;
import java.util.Arrays;
import org.json.JSONObject;

public final class NativeSettingsCheck {
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args)throws Exception{
        String endpoint="https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6";
        check(NativeNetwork.qzoneCredentials(new java.net.URL(endpoint),"POST"));
        check(!NativeNetwork.qzoneCredentials(new java.net.URL(endpoint),"GET"));
        for(String url:new String[]{endpoint.replace("h5.qzone.qq.com","h5.qzone.qq.com.evil.example"),endpoint+"/extra",endpoint.replace("https:","http:"),endpoint.replace("h5.qzone.qq.com","h5.qzone.qq.com:8443")})check(!NativeNetwork.qzoneCredentials(new java.net.URL(url),"POST"));
        check(RuntimePolicy.mayRecover(1000,0,2));check(!RuntimePolicy.mayRecover(1000,0,3));check(RuntimePolicy.mayRecover(601000,0,3));
        check(RuntimePolicy.resetWindow(601000,0));check(RuntimePolicy.resetWindow(500,1000));
        check(RuntimePolicy.unexpectedExit(137,false));check(!RuntimePolicy.unexpectedExit(75,false));check(!RuntimePolicy.unexpectedExit(0,false));check(!RuntimePolicy.unexpectedExit(137,true));
        check(RuntimePolicy.retryDelay(1)==5000&&RuntimePolicy.retryDelay(100)==30000);
        check(RuntimePolicy.resumeDue(0,1000));check(!RuntimePolicy.resumeDue(1000,15999));check(RuntimePolicy.resumeDue(1000,16000));check(RuntimePolicy.resumeDue(2000,1000));
        check(RuntimePolicy.schedulingGap(1000,92000)&&!RuntimePolicy.schedulingGap(1000,31000));
        check(ModelCatalog.completion("https://relay.example/v1/").equals("https://relay.example/v1/chat/completions"));
        check(ModelCatalog.models("https://relay.example/v1/chat/completions").equals("https://relay.example/v1/models"));
        check(ModelCatalog.models("https://relay.example/gateway/v1//").equals("https://relay.example/gateway/v1/models"));
        check(ModelCatalog.models("https://relay.example/v1/responses").equals("https://relay.example/v1/models"));
        check(ModelCatalog.completion("https://relay.example/v1/models","responses").equals("https://relay.example/v1/responses"));
        check(Arrays.equals(ModelCatalog.parse("{\"data\":[{\"id\":\"z\"},{\"id\":\"a\"},{\"id\":\"a\"},{}]}"),new String[]{"a","z"}));
        for(String u:new String[]{"http://relay.example","https://user:pass@relay.example","https://relay.example/?secret=1","https://relay.example/#x"}){try{ModelCatalog.models(u);throw new AssertionError();}catch(java.io.IOException expected){}}
        check(ApiProfiles.sameOrigin("https://relay.example/v1","https://relay.example:443/other"));check(!ApiProfiles.sameOrigin("https://relay.example","https://other.example"));check(!ApiProfiles.sameOrigin("https://relay.example","https://relay.example:8443"));
        for(int i=0;i<4;i++){JSONObject profile=ApiProfiles.template(i).put("apiKey","isolated-test-key");ApiProfiles.validated(profile);JSONObject settings=ApiProfiles.settings(profile);check(!settings.has("apiKey")&&!settings.has("persona")&&!settings.has("characterName"));check(settings.has("model"));}
        JSONObject responses=ApiProfiles.template(0).put("apiKey","isolated-test-key").put("apiProtocol","responses");check(ApiProfiles.settings(ApiProfiles.validated(responses)).getString("apiProtocol").equals("responses"));
        JSONObject profile=ApiProfiles.template(4).put("apiUrl","https://relay.example/v1").put("model","test-model").put("apiKey","isolated-test-key");ApiProfiles.validated(profile);profile.put("visionMode","separate").put("visionUrl","https://vision.example/v1").put("visionModel","test-vision");try{ApiProfiles.validated(profile);throw new AssertionError();}catch(java.io.IOException expected){}profile.put("visionKey","isolated-vision-key");ApiProfiles.validated(profile);
        CropGeometry crop=new CropGeometry();RectF viewport=new RectF(0,0,100,100);crop.x=100;crop.y=-100;crop.zoom=100;
        RectF region=crop.source(400,200,viewport);check(crop.zoom==6);check(region.left>=-.001&&region.right<=400.001&&region.top>=-.001&&region.bottom<=200.001);check(Math.abs(region.width()-region.height())<.001);
        Bitmap source=Bitmap.createBitmap(400,200,Bitmap.Config.ARGB_8888);Canvas c=new Canvas(source);c.drawColor(Color.RED);Paint paint=new Paint();paint.setColor(Color.BLUE);c.drawRect(200,0,400,200,paint);crop.x=.75f;crop.y=.5f;crop.zoom=1;Bitmap exported=PhotoBackground.cropped(source,crop.source(400,200,viewport));check(exported.getWidth()==exported.getHeight());check(Color.blue(exported.getPixel(exported.getWidth()/2,exported.getHeight()/2))>240);
        Bitmap canvasBitmap=Bitmap.createBitmap(40,40,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(canvasBitmap);PhotoBackground bg=new PhotoBackground(exported,0,Color.GREEN);bg.setBounds(0,0,40,40);bg.draw(canvas);check(canvasBitmap.getPixel(20,20)==Color.GREEN);bg=new PhotoBackground(exported,255,Color.GREEN);bg.setBounds(0,0,40,40);bg.draw(canvas);check(Color.blue(canvasBitmap.getPixel(20,20))>240);
        java.io.File scratch=new java.io.File("/data/local/tmp/qqwb-video-cleanup-check");scratch.mkdirs();
        java.io.File generated=new java.io.File(scratch,"clip-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bin"),preserved=new java.io.File(scratch,"user-video.mp4");
        generated.createNewFile();preserved.createNewFile();Container.clearVideoTemps(scratch,"clip-[a-f0-9]{32}\\.bin");
        check(!generated.exists()&&preserved.exists());preserved.delete();scratch.delete();
        source.recycle();exported.recycle();canvasBitmap.recycle();System.out.println("QQWB_NATIVE_SETTINGS_OK: model paths/list parsing, credential isolation, crop/opacity, generated-video-only cleanup");
    }
}
