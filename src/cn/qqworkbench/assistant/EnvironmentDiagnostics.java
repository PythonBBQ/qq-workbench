package cn.qqworkbench.assistant;

import android.content.Context;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

final class EnvironmentDiagnostics {
    static String report(Context context){
        File root=new File(context.getFilesDir(),"linux/rootfs/opt/qq-workbench");StringBuilder text=new StringBuilder();
        try{
            File file=new File(root,"environment-status.json");if(file.length()>65536)throw new IOException();
            JSONObject result=new JSONObject(new String(java.nio.file.Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8));
            text.append("上次基础环境检测：").append(result.optBoolean("ok")?"通过":"有待补齐项").append("\n");JSONArray checks=result.optJSONArray("checks");
            if(checks!=null)for(int i=0;i<checks.length();i++){JSONObject item=checks.getJSONObject(i);text.append(item.optBoolean("ok")?"✓ ":"待修复 · ").append(item.optString("label")).append('\n');}
            long at=result.optLong("checkedAt")*1000;if(at>0)text.append("检测时间：").append(android.text.format.DateFormat.format("MM-dd HH:mm:ss",at));
        }catch(Exception e){text.append("尚无环境检测结果。启动服务后会自动检查Python、网页/桌面组件与QQ运行库。");}
        try{File issue=new File(root,"environment-problem.txt");if(issue.length()>0&&issue.length()<4096)text.append("\n").append(new String(java.nio.file.Files.readAllBytes(issue.toPath()),StandardCharsets.UTF_8).trim());}catch(Exception ignored){}
        return text.toString();
    }
    static String check(Context context)throws Exception{
        Container c=new Container(context);if(!new File(c.root,".qq-rootfs-v1").isFile())return "离线环境尚未完成初始化，请启动本地服务自动准备。";
        if(!new File(c.root,"opt/qq-workbench/environment-check.py").isFile())return "环境检测脚本尚未导入，请先重试启动本地服务。";
        c.selectRuntimeMode(s->{});Process process=c.start("bash /opt/qq-workbench/install.sh --check-only",java.util.Collections.emptyMap());
        try{if(!process.waitFor(90,java.util.concurrent.TimeUnit.SECONDS))throw new IOException("环境检测超时，请查看容器运行状态");return report(context);}finally{if(process.isAlive())process.destroy();}
    }
}
