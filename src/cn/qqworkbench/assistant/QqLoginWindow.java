package cn.qqworkbench.assistant;

import android.graphics.Color;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import java.net.URLEncoder;
import java.util.concurrent.*;

/** One lifecycle-owned window; stale probes cannot open a different account page. */
final class QqLoginWindow {
    final MainActivity a;final int slot;final WebView web;final TextView hint;final Button identify;
    final ExecutorService worker=Executors.newSingleThreadExecutor();boolean closed,busy,loaded,paused;String startProblem="";
    QqLoginWindow(MainActivity activity,int account,Runnable identifyAction){
        a=activity;slot=account;hint=a.text("正在检查本机环境和 QQ 窗口…",14);a.body.addView(hint);
        identify=a.plainButton("识别并连接 QQ",identifyAction);identify.setEnabled(false);a.body.addView(identify,new LinearLayout.LayoutParams(-1,a.dp(48)));
        web=new WebView(a);a.browser=web;web.setBackgroundColor(Color.TRANSPARENT);web.setVisibility(View.GONE);
        web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient(){
            public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !QqWindowProbe.allowed(slot,r.getUrl().toString());}
            public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError error){if(r.isForMainFrame())failed();}
            public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse response){if(r.isForMainFrame())failed();}
        });a.body.addView(web,new LinearLayout.LayoutParams(-1,a.dp(520)));
        a.button("检测环境并重试打开",this::retry);a.button("查看环境检测和诊断",()->a.go("diagnostics"));a.loginWindow=this;retry();
    }
    boolean current(){return !closed&&!a.destroyed&&a.loginWindow==this&&a.browser==web;}
    final Runnable tick=new Runnable(){public void run(){if(!current()||paused)return;if(!busy){busy=true;worker.submit(()->{QqWindowProbe.Status result=QqWindowProbe.check(slot);a.runOnUiThread(()->{busy=false;if(!current()||paused)return;
            if(result==QqWindowProbe.Status.READY){identify.setEnabled(true);hint.setText("QQ 登录窗口已就绪，请在下方登录；完成后核验账号。");if(!loaded)load();}
            else {identify.setEnabled(false);if(loaded){loaded=false;web.stopLoading();web.setVisibility(View.GONE);}String stage=RuntimeService.state;hint.setText(!startProblem.isEmpty()?startProblem:!RuntimeService.running?stage+"\n可点“检测环境并重试打开”，或在诊断查看缺失组件。":result==QqWindowProbe.Status.DESKTOP_UNAVAILABLE?"登录网页已就绪，桌面组件仍在准备…\n"+stage:"正在准备 QQ 登录窗口…\n"+stage+"\n首次安装会自动检测并下载缺失组件，请保持联网。");}
        });});}a.handler.postDelayed(this,2500);}};
    void load(){try{loaded=true;web.setVisibility(View.VISIBLE);web.loadUrl("http://127.0.0.1:"+QqWindowProbe.webPort(slot)+"/vnc.html?autoconnect=true&resize=scale#password="+URLEncoder.encode(new Secrets(a).ensure("vnc").substring(0,8),"UTF-8"));}catch(Exception e){failed();}}
    void failed(){if(!current())return;loaded=false;identify.setEnabled(false);web.setVisibility(View.GONE);hint.setText("QQ 窗口连接中断，正在重新检测本机服务…");}
    void retry(){if(!current()||busy)return;startProblem="";loaded=false;web.stopLoading();web.setVisibility(View.GONE);identify.setEnabled(false);a.startLocal();
        if(slot>0&&!busy){busy=true;worker.submit(()->{try{a.api("/multi/configure",new org.json.JSONObject().put("profiles",new AccountProfiles(a).list()));a.api("/multi/start",new org.json.JSONObject().put("slot",slot));}catch(Exception e){a.runOnUiThread(()->{if(current())startProblem="此独立账号尚未启动，请等待主服务准备完成后重试。";});}finally{a.runOnUiThread(()->busy=false);}});}
        a.handler.removeCallbacks(tick);a.handler.post(tick);
    }
    void pause(){paused=true;a.handler.removeCallbacks(tick);}
    void resume(){if(!current())return;paused=false;a.handler.removeCallbacks(tick);a.handler.post(tick);}
    void close(){closed=true;a.handler.removeCallbacks(tick);worker.shutdownNow();}
}
