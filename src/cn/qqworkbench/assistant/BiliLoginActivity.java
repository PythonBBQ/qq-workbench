package cn.qqworkbench.assistant;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.webkit.*;
import android.webkit.CookieManager;
import android.widget.*;
import android.graphics.Color;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Official Bilibili login in an app-owned WebView; no JavaScript bridge or cross-app extraction. */
public final class BiliLoginActivity extends Activity {
    static final String LOGIN="https://passport.bilibili.com/h5-app/passport/login";
    private WebView web;private TextView status;private final Handler timer=new Handler();
    private final ExecutorService io=Executors.newSingleThreadExecutor();private boolean active,checking,done;private volatile boolean destroyed;
    private String checked="";
    static boolean allowed(String value){
        try{URI u=new URI(value);String host=u.getHost();return "https".equals(u.getScheme())&&u.getUserInfo()==null&&(u.getPort()==-1||u.getPort()==443)&&host!=null&&(host.equals("bilibili.com")||host.endsWith(".bilibili.com"));}catch(Exception e){return false;}
    }
    static String usableCookie(String value){
        if(value==null||value.length()>8192||value.indexOf('\r')>=0||value.indexOf('\n')>=0)return "";
        boolean session=false;for(String piece:value.split(";"))if(piece.trim().matches("SESSDATA=.+"))session=true;
        return session?value.trim():"";
    }
    public void onCreate(Bundle state){
        super.onCreate(state);if(!UsageAgreement.accepted(this)){finish();return;}
        LinearLayout page=new LinearLayout(this);page.setOrientation(1);page.setPadding(16,12,16,0);page.setBackgroundColor(Color.WHITE);
        status=new TextView(this);status.setTextColor(Color.DKGRAY);status.setTextSize(15);status.setText("请在B站官方页面登录，完成后会自动检查并加密保存。短信验证码与密码只填写在官方页面，不交给AI。");page.addView(status);
        LinearLayout row=new LinearLayout(this);page.addView(row);
        add(row,"网页登录",()->{web.getSettings().setUserAgentString(WebSettings.getDefaultUserAgent(this));web.loadUrl(LOGIN);});
        add(row,"扫码登录",()->{web.getSettings().setUserAgentString("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36");web.loadUrl("https://passport.bilibili.com/login");});
        add(row,"完成登录",()->check(true));add(row,"返回",this::finish);
        web=new WebView(this);page.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(page);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSupportMultipleWindows(false);settings.setSaveFormData(false);
        CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebViewClient(new WebViewClient(){
            public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(!request.isForMainFrame())return false;boolean block=!allowed(request.getUrl().toString());if(block)Toast.makeText(BiliLoginActivity.this,"请使用B站页面的短信、密码或扫码登录",Toast.LENGTH_SHORT).show();return block;}
            public void onPageFinished(WebView view,String url){if(allowed(url))check(false);}
            public void onReceivedSslError(WebView view,android.webkit.SslErrorHandler handler,android.net.http.SslError error){handler.cancel();status.setText("B站页面证书验证失败，请检查网络与设备时间。");}
        });
        web.loadUrl(LOGIN);
    }
    private void add(LinearLayout row,String title,Runnable run){Button b=new Button(this);b.setText(title);b.setTextSize(12);b.setOnClickListener(v->run.run());row.addView(b,new LinearLayout.LayoutParams(0,-2,1));}
    private final Runnable poll=new Runnable(){public void run(){if(!active||destroyed||done)return;check(false);timer.postDelayed(this,2500);}};
    protected void onResume(){super.onResume();active=true;timer.postDelayed(poll,1000);}
    protected void onPause(){active=false;timer.removeCallbacks(poll);super.onPause();}
    private void check(boolean manual){
        if(checking||done||destroyed)return;
        String value=usableCookie(CookieManager.getInstance().getCookie("https://www.bilibili.com/"));
        if(value.isEmpty()){if(manual)status.setText("尚未检测到B站登录。请先完成官方页面的短信或扫码验证；只在官方App登录不会自动同步到工作台。");return;}
        if(!manual&&value.equals(checked))return;checked=value;checking=true;status.setText("正在向B站确认登录状态…");
        io.submit(()->{
            try{
                verify(value);
                if(destroyed)return;
                Secrets vault=new Secrets(this);String saved=vault.get("site-cookies");JSONObject cookies=saved.isEmpty()?new JSONObject():new JSONObject(saved);cookies.put("bilibili_cookies",value);vault.put("site-cookies",cookies.toString());
                runOnUiThread(()->{if(destroyed)return;done=true;CookieManager.getInstance().flush();setResult(RESULT_OK,new Intent().putExtra("biliLogin",true));Toast.makeText(this,"B站登录已保存",Toast.LENGTH_SHORT).show();finish();});
            }catch(Exception e){runOnUiThread(()->{if(!destroyed)status.setText("B站尚未确认登录，请完成官方验证后点“完成登录”，或检查网络后重试。");});}
            finally{runOnUiThread(()->checking=false);}
        });
    }
    static void verify(String cookie)throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL("https://api.bilibili.com/x/web-interface/nav").openConnection();
        try{c.setConnectTimeout(10000);c.setReadTimeout(12000);c.setInstanceFollowRedirects(false);c.setRequestProperty("Cookie",cookie);c.setRequestProperty("Referer","https://www.bilibili.com/");c.setRequestProperty("User-Agent","Mozilla/5.0");
            if(c.getResponseCode()!=200)throw new IOException("登录未确认");ByteArrayOutputStream data=new ByteArrayOutputStream();
            try(InputStream in=c.getInputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(data.size()+n>65536)throw new IOException("响应过大");data.write(b,0,n);}}
            JSONObject result=new JSONObject(new String(data.toByteArray(),StandardCharsets.UTF_8));JSONObject account=result.optJSONObject("data");if(result.optInt("code",-1)!=0||account==null||!account.optBoolean("isLogin"))throw new IOException("登录失效");
        }finally{c.disconnect();}
    }
    static void clearBrowserSession(){
        CookieManager manager=CookieManager.getInstance();
        for(String domain:new String[]{".bilibili.com","passport.bilibili.com","www.bilibili.com"})for(String name:new String[]{"SESSDATA","bili_jct","DedeUserID","DedeUserID__ckMd5","sid"})manager.setCookie("https://"+domain.replaceFirst("^\\.","")+"/",name+"=; Max-Age=0; Path=/; Domain="+domain+"; Secure");manager.flush();
    }
    public void onBackPressed(){finish();}
    protected void onDestroy(){destroyed=true;timer.removeCallbacksAndMessages(null);if(web!=null){web.stopLoading();web.destroy();}io.shutdownNow();super.onDestroy();}
}
