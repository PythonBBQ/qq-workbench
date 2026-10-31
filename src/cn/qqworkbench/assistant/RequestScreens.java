package cn.qqworkbench.assistant;

import android.app.AlertDialog;
import android.widget.TextView;
import org.json.*;

/** Read-only, local view of each account's bounded outgoing prompt previews. */
final class RequestScreens {
    static int slot=0;
    static String category(String value){switch(value){case "chat":return "聊天";case "vision":return "图片";case "summary":return "压缩";case "growth":return "性格观察";default:return value;}}
    static void show(MainActivity a){
        a.base("模型输入","requests");a.section(slot==0?"原账号": "独立账号 "+slot,"展示最近20次实际发出的请求，包括系统提示、携带的上下文、记忆和当前消息。仅本次运行保存在内存，重启消失；每次文字最多64000字符，图片数据和密钥隐藏。查看不调用模型。");
        a.button("切换查看账号",()->{try{JSONArray all=new AccountProfiles(a).list();String[] names=new String[all.length()+1];int[] slots=new int[names.length];names[0]="原账号";for(int i=0;i<all.length();i++){names[i+1]=all.getJSONObject(i).optString("name");slots[i+1]=all.getJSONObject(i).optInt("slot");}new AlertDialog.Builder(a).setTitle("按账号隔离查看").setItems(names,(d,n)->{slot=slots[n];show(a);}).show();}catch(Exception e){a.toast("账号配置读取失败");}});
        a.button("刷新输入记录",()->show(a));a.button("清除此账号输入预览",()->load(a,"/requests/clear",new JSONObject(),r->show(a)));
        TextView status=a.text("正在读取…",14);a.body.addView(status);final android.widget.LinearLayout requested=a.page;
        load(a,"/requests/list",null,r->{if(a.page!=requested)return;JSONArray all=r.optJSONArray("requests");if(all==null||all.length()==0){status.setText("暂无记录。启动服务后发一条消息，再回来刷新。");return;}status.setText("当前运行共保留 "+all.length()+" 次");for(int i=0;i<all.length();i++){JSONObject entry=all.getJSONObject(i);String id=entry.getString("id"),time=java.text.DateFormat.getTimeInstance().format(new java.util.Date(entry.optLong("at")));String label=time+" · "+category(entry.optString("category"))+" · "+entry.optString("model");a.button(label,()->{try{load(a,"/requests/get",new JSONObject().put("id",id),full->{JSONObject item=full.getJSONObject("request");a.base("实际输入文本","requestDetail");a.note(time+" · "+item.optString("host")+" · "+item.optString("protocol")+"\n"+(item.optString("status").equals("completed")?"模型已完成":item.optString("status").equals("failed")?"请求失败":"等待模型返回")+(item.optBoolean("truncated")?" · 预览有截断":""));TextView text=a.text(item.getJSONObject("body").toString(2),14);text.setTextIsSelectable(true);a.body.addView(text);a.button("返回输入记录",()->show(a));});}catch(Exception e){a.toast("记录已过期");}});}});
    }
    interface Result{void done(JSONObject result)throws Exception;}
    static void load(MainActivity a,String route,JSONObject data,Result result){final int selected=slot;final android.widget.LinearLayout page=a.page;a.io.submit(()->{try{JSONObject r=a.accountApi(selected,route,data);a.runOnUiThread(()->{if(a.destroyed||a.page!=page)return;try{result.done(r);}catch(Exception e){a.toast("输入记录读取失败");}});}catch(Exception e){a.runOnUiThread(()->a.toast("请先启动对应账号；记录只保留在当前运行内存"));}});}
}
