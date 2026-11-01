package cn.qqworkbench.assistant;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.*;
import org.json.*;

final class UpdateScreens {
    static void show(MainActivity a){
        a.base("软件更新","updates");a.section("更新与下载","当前 "+a.appVersion()+"。普通更新优先节流补丁，重建安装后保留账号与配置。");
        EditText feed=a.input("GitHub 更新源",AppUpdates.feed(a),false);Switch automatic=a.toggle("打开软件时检查更新",a.prefs().getBoolean("autoUpdateCheck",true));
        a.button("保存更新设置",()->{try{AppUpdates.releaseUrl(feed.getText().toString().trim());a.prefs().edit().putString("updateFeed",feed.getText().toString().trim()).putBoolean("autoUpdateCheck",automatic.isChecked()).apply();a.clearDraft();a.toast("更新设置已保存");}catch(Exception e){a.toast(e.getMessage());}});
        a.primary("检查新版本",()->a.checkUpdates(false));
        a.section("下载任务","支持断点续传；切换页面后仍在通知栏下载。网络短暂中断会自动重试，失败后保留进度。");
        TextView text=a.text("读取下载状态…",14);a.body.addView(text);ProgressBar bar=new ProgressBar(a,null,android.R.attr.progressBarStyleHorizontal);bar.setMax(1000);a.body.addView(bar,new LinearLayout.LayoutParams(-1,a.dp(12)));
        Button resume=a.plainButton("继续下载",()->{try{UpdateDownloadService.start(a,UpdateDownloadService.pendingRelease(a));}catch(Exception e){a.toast(e.getMessage());}});a.body.addView(resume);
        Button pause=a.plainButton("暂停下载",()->{try{UpdateDownloadService.pause(a);}catch(Exception e){a.toast("暂停未完成，请稍后重试");}});a.body.addView(pause);
        Button install=a.plainButton("安装已下载更新",a::installUpdate);a.body.addView(install);
        a.button("清理下载缓存",()->{if(UpdateDownloadService.active.get()){a.toast("请先暂停下载");return;}a.io.submit(()->{try{java.io.File dir=AppUpdates.file(a).getParentFile();ResumableDownload.clear(dir);AppUpdates.file(a).delete();UpdateDownloadService.pending(a).delete();a.getSharedPreferences("update-download",0).edit().clear().apply();a.runOnUiThread(()->a.toast("已清理安装包与下载进度，账号和配置保留"));}catch(Exception e){a.runOnUiThread(()->a.toast("缓存清理未完成"));}});});
        a.button("打开GitHub发行页",()->{try{a.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://github.com/PythonBBQ/qq-workbench/releases")));}catch(Exception e){a.toast("浏览器未能打开");}});
        a.help("下载说明","显示的是实际下载流量；补丁重建仍需完整安装包的临时空间。下载和校验完成后点安装，由系统确认。没有匹配当前安装包的补丁会明确提示，不会静默改下整包。只下载GitHub发行资产，逐个跳转检查来源；模型Key与聊天不参与更新。");
        final LinearLayout page=a.page;
        a.handler.post(new Runnable(){public void run(){if(a.destroyed||!a.screen.equals("updates")||a.page!=page)return;JSONObject state=UpdateDownloadService.state(a);boolean busy=state.optBoolean("active");long n=state.optLong("received"),total=state.optLong("total");text.setText(state.optString("message")+(total>0?"\n"+UpdateDownloadService.amount(n)+" / "+UpdateDownloadService.amount(total):""));bar.setProgress(total>0?(int)Math.min(1000,n*1000/total):0);bar.setIndeterminate(busy&&!state.optString("phase").equals("downloading"));pause.setVisibility(busy?View.VISIBLE:View.GONE);resume.setVisibility(!busy&&UpdateDownloadService.pending(a).isFile()?View.VISIBLE:View.GONE);install.setVisibility(!busy&&AppUpdates.file(a).isFile()?View.VISIBLE:View.GONE);a.handler.postDelayed(this,750);}});
    }
    static void offer(MainActivity a,JSONObject result){
        boolean patch=result.optString("kind").equals("patch");
        new AlertDialog.Builder(a).setTitle(result.optString("message")).setMessage((patch?"节流补丁":"完整安装包")+" · "+UpdateDownloadService.amount(result.optLong("bytes"))+"\n"+(patch?"本机重建完整安装包后检查原签名；需要额外临时空间。":"直接覆盖安装，保留数据。")+"\n下载可暂停续传，完成后从更新页确认安装。").setPositiveButton("下载",(dialog,which)->{try{UpdateDownloadService.start(a,result);a.go("updates");}catch(Exception e){a.toast(e.getMessage());}}).setNegativeButton("稍后",null).show();
    }
}
