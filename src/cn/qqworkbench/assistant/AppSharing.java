package cn.qqworkbench.assistant;

import android.content.*;
import android.net.Uri;

final class AppSharing {
    static void share(MainActivity a){try{
        Uri uri=Uri.parse("content://"+a.getPackageName()+".installed-apk/installed.apk");
        Intent intent=new Intent(Intent.ACTION_SEND).setType("application/vnd.android.package-archive")
            .putExtra(Intent.EXTRA_STREAM,uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("QQWorkbench-"+a.appVersion()+".apk",uri));
        a.startActivity(Intent.createChooser(intent,"分享当前安装版本 "+a.appVersion()));
    }catch(Exception e){a.toast("无法打开分享，请从文件管理选择新版安装包");}}
}
