package cn.qqworkbench.assistant;

import android.app.AlertDialog;
import android.content.Intent;
import android.widget.*;
import org.json.*;

final class VoiceReferences {
    static final String[] LABELS={"自然","开心","温柔","害羞（参考表达）","难过","认真"};
    static void controls(MainActivity a,int slot){
        a.note("ZipVoice 轻量本机合成，无需语音Key。模型已内置，首次自动解压；多号共用一份模型，各号参考声音独立。默认先用系统中文声音作为初始参考，可导入自己喜欢的声音。音高滑条不作用于此引擎。");
        a.button("语音模型来源与许可",()->{try(java.io.InputStream in=a.getAssets().open("licenses/ZipVoice-MODEL-NOTICE.txt")){TextView content=a.text(new String(LocalVoice.read(in,32000),java.nio.charset.StandardCharsets.UTF_8),14);ScrollView scroll=new ScrollView(a);scroll.addView(content);new AlertDialog.Builder(a).setTitle("ZipVoice · 非商业模型").setView(scroll).setPositiveButton("关闭",null).show();}catch(Exception e){a.toast("许可文件暂时无法读取");}});
        TextView status=a.text("正在检查轻量语音…",13);a.body.addView(status);
        Runnable refresh=()->a.io.submit(()->{try{JSONObject s=LocalVoiceClient.call(a,"state",new JSONObject().put("slot",slot));JSONArray refs=s.getJSONArray("references");StringBuilder text=new StringBuilder(s.optBoolean("prepared")?"模型已准备":"首次合成时准备模型");text.append(s.optBoolean("loaded")?" · 已载入":" · 空闲时释放内存");for(int i=0;i<refs.length();i++){JSONObject r=refs.getJSONObject(i);int n=java.util.Arrays.asList(LocalVoice.MOODS).indexOf(r.optString("mood"));text.append("\n").append(n>=0?LABELS[n]:"自然").append("：").append(r.optString("source").equals("system")?"系统初始参考":"已导入").append(" · ").append(String.format(java.util.Locale.ROOT,"%.1f秒",r.optDouble("seconds")));}if(s.optLong("lastMillis")>0)text.append("\n上次合成 ").append(s.optLong("lastMillis")/1000.0).append(" 秒");a.runOnUiThread(()->{if(!a.destroyed)status.setText(text.toString());});}catch(Exception e){a.runOnUiThread(()->status.setText("轻量语音服务正忙，请稍后刷新"));}});
        a.button("准备或检查轻量模型",()->{a.toast("正在本机准备，无需联网…");a.io.submit(()->{try{LocalVoice.get(a).prepare();a.runOnUiThread(()->{a.toast("模型已准备，选择此引擎并保存即可");refresh.run();});}catch(Exception e){a.runOnUiThread(()->a.toast(e.getMessage()));}});});
        a.button("导入本账号参考声音",()->new AlertDialog.Builder(a).setTitle("语气参考，请使用同一个人的声音").setItems(LABELS,(d,n)->{EditText transcript=new EditText(a);transcript.setHint("填写录音中实际说的话，完全对应");transcript.setMinLines(2);transcript.setMaxLines(5);new AlertDialog.Builder(a).setTitle("选1–10秒清晰录音，推荐约3秒").setView(transcript).setPositiveButton("选择音频",(dialog,which)->{String text=transcript.getText().toString().trim();if(text.isEmpty()||text.length()>200){a.toast("参考文字需为1到200字");return;}a.pendingVoiceSlot=slot;a.pendingVoiceMood=LocalVoice.MOODS[n];a.pendingVoiceText=text;try{a.startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("audio/*").addCategory(Intent.CATEGORY_OPENABLE),76);}catch(Exception e){a.pendingVoiceText="";a.toast("音频文件选择器不可用");}}).setNegativeButton("取消",null).show();}).show());
        a.button("移除本账号某个语气参考",()->new AlertDialog.Builder(a).setTitle("只移除所选参考，其他账号保留").setItems(LABELS,(d,n)->a.io.submit(()->{try{LocalVoice.get(a).removeReference(slot,LocalVoice.MOODS[n]);a.runOnUiThread(()->{a.toast("已移除；缺少该语气时使用自然声音");refresh.run();});}catch(Exception e){a.runOnUiThread(()->a.toast("参考未移除"));}})).show());
        a.button("刷新参考声音状态",refresh);a.note("语气跟随同一声音的参考片段；未导入对应语气时使用自然参考，不承诺专门的娇羞模型。合成空闲一分钟后释放模型内存。");refresh.run();
    }
    static void imported(MainActivity a,android.net.Uri uri){int slot=a.pendingVoiceSlot;String mood=a.pendingVoiceMood,text=a.pendingVoiceText;a.pendingVoiceText="";if(uri==null||text.isEmpty())return;a.toast("正在读取本机录音…");a.io.submit(()->{try{LocalVoice.get(a).importReference(slot,mood,uri,text);a.runOnUiThread(()->a.toast("已保存到本账号；点击刷新查看，未上传录音"));}catch(Exception e){a.runOnUiThread(()->a.toast("导入未完成："+e.getMessage()));}});}
}
