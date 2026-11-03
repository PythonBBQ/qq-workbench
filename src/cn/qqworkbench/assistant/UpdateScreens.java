package cn.qqworkbench.assistant;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.*;
import org.json.*;

final class UpdateScreens {
    static void show(MainActivity a){
        a.base("软件更新","updates");a.section("应用内更新","当前 "+a.appVersion()+"。下载、校验与资源重建均在此完成，保留账号和设置。");
        a.primary("检查更新",()->a.checkUpdates(false));
        TextView text=a.text("读取更新状态…",15);a.body.addView(text);
        ProgressBar bar=new ProgressBar(a,null,android.R.attr.progressBarStyleHorizontal);bar.setMax(1000);a.body.addView(bar,new LinearLayout.LayoutParams(-1,a.dp(12)));
        Button resume=a.plainButton("继续下载",()->{try{UpdateDownloadService.start(a,UpdateDownloadService.pendingRelease(a));}catch(Exception e){a.toast(e.getMessage());}});a.body.addView(resume);
        Button pause=a.plainButton("暂停",()->{try{UpdateDownloadService.pause(a);}catch(Exception e){a.toast("暂停未完成，请稍后重试");}});a.body.addView(pause);
        Button install=a.plainButton("继续安装",a::installUpdate);a.body.addView(install);
        Button full=a.plainButton("改用完整安装包",()->{try{JSONObject release=UpdateDownloadService.pendingRelease(a).getJSONObject("fullFallback");offer(a,release);}catch(Exception e){a.toast("此发行版没有完整包，请重新检查更新");}});a.body.addView(full);
        a.note("下载期间留在软件内显示进度，不打开浏览器、不停止聊天。下载完成后整合补丁并校验，再进入系统安装确认；安装后同步资源并恢复服务。");
        LinearLayout parent=a.body,advanced=new LinearLayout(a);advanced.setOrientation(1);advanced.setVisibility(View.GONE);a.button("更新设置 ▾",()->advanced.setVisibility(advanced.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE));parent.addView(advanced);a.body=advanced;
        EditText feed=a.input("更新源",AppUpdates.feed(a),false);Switch automatic=a.toggle("打开时检查更新",a.prefs().getBoolean("autoUpdateCheck",true));
        a.button("保存更新设置",()->{try{AppUpdates.releaseUrl(feed.getText().toString().trim());a.prefs().edit().putString("updateFeed",feed.getText().toString().trim()).putBoolean("autoUpdateCheck",automatic.isChecked()).apply();a.clearDraft();a.toast("已保存");}catch(Exception e){a.toast(e.getMessage());}});
        a.button("清理更新缓存",()->{if(UpdateDownloadService.state(a).optBoolean("active")||a.updateInstalling||UpdateFlow.integrating(a)){a.toast("更新进行中，请稍候");return;}a.io.submit(()->{try{java.io.File dir=AppUpdates.file(a).getParentFile();ResumableDownload.clear(dir);AppUpdates.file(a).delete();UpdateDownloadService.pending(a).delete();a.getSharedPreferences("update-download",0).edit().clear().apply();a.runOnUiThread(()->a.toast("更新缓存已清理，账号与配置保留"));}catch(Exception e){a.runOnUiThread(()->a.toast("缓存清理未完成"));}});});
        a.button("查看 GitHub 发行页",()->{try{a.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://github.com/PythonBBQ/qq-workbench/releases")));}catch(Exception e){a.toast("浏览器未能打开");}});a.body=parent;
        a.section("版本回退与重装","回退前先导出备份，不必先卸载。系统分身或其他空间仍安装新版时，主空间删掉图标也会继续提示已有更高版本。");
        a.button("回退前备份账号与记忆",()->a.go("backup"));
        a.help("如何安装旧版","普通系统安装器通常不允许降级。电脑连接USB调试后，用项目的 tools/android-reinstall.py 选择同签名旧版APK，可检查所有空间并请求保留数据降级。工具会核对版本、当前空间安装和其他空间的保留状态。系统仍拒绝时显示真实原因，不自动卸载。若确实要彻底卸载，先在各空间导出备份，再在系统应用管理中移除本应用的所有用户安装且不保留数据；不用删除整个系统分身。此前卸载已删除的数据无法靠重装自动找回。");
        final LinearLayout page=a.page;
        a.handler.post(new Runnable(){public void run(){if(a.destroyed||!a.screen.equals("updates")||a.page!=page)return;
            JSONObject state=UpdateDownloadService.state(a);boolean busy=state.optBoolean("active"),integrating=UpdateFlow.integrating(a);String phase=state.optString("phase");long n=state.optLong("received"),total=state.optLong("total");
            String message=integrating?UpdateFlow.prefs(a).getString("integrationMessage","正在整合资源")+"\n"+RuntimeService.state:state.optString("message");
            boolean measured=busy&&(phase.equals("downloading")||phase.equals("retrying")||phase.equals("switching")||phase.equals("reconstructing"));
            text.setText(message+(measured&&total>0?"\n"+(int)Math.min(100,n*100/total)+"%":""));bar.setIndeterminate(integrating||(busy&&!measured));bar.setProgress(total>0?(int)Math.min(1000,n*1000/total):phase.equals("ready")||phase.equals("complete")?1000:0);
            pause.setVisibility(busy?View.VISIBLE:View.GONE);resume.setVisibility(!busy&&UpdateDownloadService.pending(a).isFile()?View.VISIBLE:View.GONE);install.setVisibility(!busy&&!integrating&&AppUpdates.file(a).isFile()?View.VISIBLE:View.GONE);
            boolean fallback=false;try{fallback=!busy&&UpdateDownloadService.pendingRelease(a).has("fullFallback");}catch(Exception ignored){}full.setVisibility(fallback?View.VISIBLE:View.GONE);
            UpdateFlow.offerInstall(a);a.handler.postDelayed(this,750);
        }});
    }
    static void offer(MainActivity a,JSONObject result){boolean patch=result.optString("kind").equals("patch");new AlertDialog.Builder(a).setTitle(result.optString("message")).setMessage((patch?"补丁":"完整包")+" · "+UpdateDownloadService.amount(result.optLong("bytes"))+"\n下载后在本机整合资源并校验签名，再进入系统安装确认。安装后自动恢复服务，保留账号与配置。").setPositiveButton("在软件内更新",(d,n)->{try{UpdateDownloadService.start(a,result);a.go("updates");}catch(Exception e){a.toast(e.getMessage());}}).setNegativeButton("稍后",null).show();}
}
