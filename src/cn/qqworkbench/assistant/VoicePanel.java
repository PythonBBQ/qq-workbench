package cn.qqworkbench.assistant;

import android.app.AlertDialog;
import android.content.Intent;
import android.widget.*;
import org.json.*;

/** Three user presets; implementation engines are not additional voice choices. */
final class VoicePanel {
    final MainActivity a;final int slot;final JSONObject original;
    final Switch enabled,emotion,natural,memory,adaptive;final Spinner policy,steps,modelQuality;
    final SeekBar rate,pitch,preference,cooldown;final EditText key,feiyuKey;
    final TextView selected;final LinearLayout[] cards=new LinearLayout[3];String preset,provider,presetId;final LinearLayout library;int presetIndex=-1;final Spinner mood;boolean busy;
    VoicePanel(MainActivity activity,int account,JSONObject c){
        a=activity;slot=account;original=c;a.activeVoicePanel=this;provider=c.optString("speechProvider","android");
        if(!provider.equals("zipvoice")&&!provider.equals("android")&&!provider.equals("kokoro"))provider="android";
        presetId=c.optString("voicePresetId");preset=c.optString("voicePresetName",provider.equals("zipvoice")?"已保存参考音色":"系统自带");
        // Kept for compatibility with account save; no unused credential fields in the UI.
        key=new EditText(a);feiyuKey=new EditText(a);
        a.section("音色预设","选择后自动试听“准备好了”。只在本机播放，不发QQ、不消耗聊天模型Token。");
        selected=a.text("当前："+preset,15);a.body.addView(selected);
        presetIndex=preset.equals("第一版肥鱼")?1:preset.startsWith("新原声")?2:provider.equals("android")?0:-1;
        String[] titles={"系统自带","第一版肥鱼","新原声 · 多情态"},summaries={"使用安卓中文语音引擎","保留第一版六种语气与原参数","原声多情态参考，整句统一合成"};
        for(int i=0;i<3;i++){final int n=i;a.selectionCard(titles[i],summaries[i],i==presetIndex?"已选择":"点击切换并试听",i==presetIndex,()->selectPreset(n));cards[i]=a.body;}
        a.section("我的声音","");a.button("导入我的声音",()->new AlertDialog.Builder(a).setTitle("导入声音").setItems(new String[]{"单段参考音频","完整语音预设包"},(d,n)->{if(busy){a.toast("正在切换声音，请稍候");return;}if(n==0)VoiceReferences.chooseSingle(a,slot);else VoiceReferences.choosePack(a,slot);}).show());
        library=new LinearLayout(a);library.setOrientation(1);a.body.addView(library);refreshLibrary();
        a.section("音调与速度","调整后可在下方试听，保存后用于聊天。");
        rate=a.slider("语速",c.optInt("speechRate",0),-40,60,"%");
        pitch=a.slider("音调",c.optInt("speechPitch",0),-30,30,"%");
        a.section("语气预设","自动跟随情境，或固定使用一种表达。软绵·暧昧使用轻柔参考与略慢语速；自导入的单段参考共用同一音色。");
        String[] moods={"auto","neutral","happy","gentle","shy","sad","serious","intimate"};int chosen=java.util.Arrays.asList(moods).indexOf(c.optString("voiceEmotionPreset","auto"));
        mood=a.choices(new String[]{"自动","自然","开心","温柔","害羞","难过","认真","软绵 · 暧昧"},Math.max(0,chosen));
        a.section("语音回复","长回复自动分成多条语音，按顺序发送；某段合成失败，剩余转文字。");
        enabled=a.toggle("开启语音",c.optBoolean("voiceEnabled"));
        String mode=c.optString("voiceMode",c.optBoolean("voiceAlways")?"always":"smart");
        policy=a.choices(new String[]{"智能选择","仅明确要求时","优先语音"},mode.equals("request")?1:mode.equals("always")?2:0);
        preference=a.slider("语音倾向",c.optInt("voicePreference",35),0,100,"%");
        LinearLayout root=a.body;a.body=fold("更多设置 · 语气、速度与记忆");
        emotion=a.toggle("语气随情境变化",c.optBoolean("voiceEmotion",true));
        natural=a.toggle("自然口语与停顿",c.optBoolean("voiceNatural",true));
        cooldown=a.slider("自动语音间隔",c.optInt("voiceCooldown",45),20,180,"秒");
        adaptive=new Switch(a);adaptive.setChecked(false);
        modelQuality=a.choices(new String[]{"轻量 · ZipVoice-Distill INT8","音质优先 · ZipVoice FP32"},c.optString("zipVoiceModel").equals("full")?1:0);
        int budget=c.optInt("zipVoiceSteps",8);steps=a.choices(new String[]{"轻量 4步","轻量 8步","完整模型 16步（推荐）","完整模型 32步（更慢）","已选听感 · 日常32步 / 害羞16步"},c.optString("zipVoiceDeliveryPreset").equals("t02-t06")?4:budget==32?3:budget==16?2:budget==4?0:1);
        modelQuality.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onNothingSelected(android.widget.AdapterView<?> p){}public void onItemSelected(android.widget.AdapterView<?> p,android.view.View v,int position,long id){int n=steps.getSelectedItemPosition();if(position==1&&n<2)steps.setSelection(2);else if(position==0&&n>=2)steps.setSelection(1);}});
        steps.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener(){public void onNothingSelected(android.widget.AdapterView<?> p){}public void onItemSelected(android.widget.AdapterView<?> p,android.view.View v,int position,long id){int n=position>=2?1:0;if(modelQuality.getSelectedItemPosition()!=n)modelQuality.setSelection(n);}});
        a.note("已选听感使用你认可的日常32步、害羞16步。完整模型保留FP32精度，平板16步约需30秒生成5秒语音，32步更慢；长回复自动拆成多条。轻量模型速度较快。语速0、音调0可减少变调处理。");
        memory=a.toggle("记住说话偏好",c.optBoolean("voiceMemoryEnabled",true));
        a.button("查看说话偏好",()->request("/voice/memory",null,r->{StringBuilder text=new StringBuilder();JSONArray list=r.optJSONArray("sessions");if(list!=null)for(int i=0;i<list.length();i++){JSONObject item=list.getJSONObject(i);text.append(item.optString("group").isEmpty()?"私聊":"群 "+item.optString("group")).append(" · QQ ").append(item.optString("user")).append("\n").append(item.optString("description")).append("\n\n");}new AlertDialog.Builder(a).setTitle("说话偏好").setMessage(text.length()>0?text.toString():"暂无已学习的说话偏好").setPositiveButton("关闭",null).show();}));
        a.button("清除本账号说话偏好",()->request("/voice/memory/clear",new JSONObject(),r->a.toast(r.optString("message"))));
        a.button("系统文字转语音设置",()->{try{a.startActivity(new Intent("com.android.settings.TTS_SETTINGS"));}catch(Exception e){a.toast("请在系统设置搜索文字转语音");}});
        a.help("音色说明","第一版肥鱼保持原六语气参考。新原声包含多情态参考；语气词与正文整句合成，不拼接独立原录音；没有额外训练新权重。系统自带使用安卓已安装的文字转语音引擎，需有中文语言包。多账号的音色与偏好分别保存。");
        a.body=root;if(provider.equals("zipvoice")&&original.optString("voicePresetName").isEmpty())detectLegacyPreset();
    }
    void detectLegacyPreset(){a.io.submit(()->{try{JSONArray refs=LocalVoiceClient.call(a,"state",new JSONObject().put("slot",slot)).getJSONArray("references");String source="";for(int i=0;i<refs.length();i++)if(refs.getJSONObject(i).optString("mood").equals("neutral"))source=refs.getJSONObject(i).optString("source");final int n=source.startsWith("feiyu-six")?1:source.startsWith("character-daily")?2:-1;a.runOnUiThread(()->{if(a.destroyed||!preset.equals("已保存参考音色")||n<0)return;presetIndex=n;preset=n==1?"第一版肥鱼":"新原声 · 多情态";refreshCards();});}catch(Exception ignored){}});}
    LinearLayout fold(String title){LinearLayout root=a.body,child=new LinearLayout(a);child.setOrientation(1);child.setVisibility(android.view.View.GONE);a.button(title+" ▾",()->child.setVisibility(child.getVisibility()==android.view.View.VISIBLE?android.view.View.GONE:android.view.View.VISIBLE));root.addView(child);return child;}
    void selectPreset(int n){
        if(busy){a.toast("正在切换声音，请稍候");return;}VoicePreview.cancel(a);busy=true;
        a.toast(n==0?"正在切换系统音色…":"正在本机准备声音预设…");
        a.io.submit(()->{try{if(n!=0)LocalVoiceClient.call(a,"install-bundled-references",new JSONObject().put("slot",slot).put("preset",n==1?"feiyu":"character-daily"));
            a.runOnUiThread(()->{busy=false;if(a.destroyed)return;provider=n==0?"android":"zipvoice";presetId="";presetIndex=n;preset=new String[]{"系统自带","第一版肥鱼","新原声 · 多情态"}[n];enabled.setChecked(true);policy.setSelection(0);emotion.setChecked(true);natural.setChecked(true);modelQuality.setSelection(n==2?1:0);steps.setSelection(n==2?4:0);adaptive.setChecked(false);pitch.setProgress(30);mood.setSelection(0);if(n==0)rate.setProgress(40);if(n==1)rate.setProgress(10);if(n==2)rate.setProgress(40);
                try{JSONObject c=values();if(slot==0)a.patch(c);else a.toast("参考已切换，请保存此账号配置");refreshCards();refreshLibrary();VoicePreview.ready(a,slot,c,"neutral");}catch(Exception e){a.toast("设置未保存："+e.getMessage());}
            });
        }catch(Exception e){a.runOnUiThread(()->{busy=false;if(!a.destroyed)a.toast("声音未切换："+e.getMessage());});}});
    }
    void refreshCards(){selected.setText("当前："+preset);for(int i=0;i<cards.length;i++){cards[i].setTag(i==presetIndex?"selected-card":"choice-card");((TextView)cards[i].getChildAt(0)).setText(i==presetIndex?"已选择":"点击切换并试听");}a.applyTheme();}
    void imported(String name,String mood,String id){provider="zipvoice";preset=name;presetId=id;presetIndex=-1;enabled.setChecked(true);try{JSONObject c=values();if(slot==0)a.patch(c);else a.toast("参考已导入，请保存此账号配置");refreshCards();refreshLibrary();VoicePreview.ready(a,slot,c,mood);}catch(Exception e){a.toast("参考已导入，配置未保存："+e.getMessage());}}
    void refreshLibrary(){a.io.submit(()->{try{JSONArray list=LocalVoiceClient.call(a,"list-presets",new JSONObject().put("slot",slot)).getJSONArray("presets");a.runOnUiThread(()->{if(a.destroyed)return;library.removeAllViews();for(int i=0;i<list.length();i++){JSONObject item=list.optJSONObject(i);String id=item.optString("id"),name=item.optString("name");Button card=a.plainButton((id.equals(presetId)?"已选择 · ":"")+name+"\n点击切换 · 长按移除",()->useSaved(id));card.setGravity(android.view.Gravity.LEFT|android.view.Gravity.CENTER_VERTICAL);LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,a.dp(70));lp.topMargin=a.dp(8);library.addView(card,lp);card.setOnLongClickListener(v->{new AlertDialog.Builder(a).setTitle("移除已保存预设？").setMessage("当前正在使用的参考保留，只移除列表中的这一份。").setPositiveButton("移除",(d,n)->a.io.submit(()->{try{LocalVoiceClient.call(a,"remove-preset",new JSONObject().put("slot",slot).put("id",id));a.runOnUiThread(this::refreshLibrary);}catch(Exception e){a.runOnUiThread(()->a.toast("未移除："+e.getMessage()));}})).setNegativeButton("取消",null).show();return true;});}}); }catch(Exception ignored){}});}
    void useSaved(String id){if(busy){a.toast("正在切换声音，请稍候");return;}busy=true;VoicePreview.cancel(a);a.io.submit(()->{try{JSONObject r=LocalVoiceClient.call(a,"use-saved-preset",new JSONObject().put("slot",slot).put("id",id));a.runOnUiThread(()->{busy=false;if(!a.destroyed)imported(r.optString("presetName","我的导入预设"),"neutral",id);});}catch(Exception e){a.runOnUiThread(()->{busy=false;a.toast("预设未切换："+e.getMessage());});}});}
    JSONObject values()throws Exception{return new JSONObject().put("voicePresetId",presetId).put("voiceEmotionPreset",new String[]{"auto","neutral","happy","gentle","shy","sad","serious","intimate"}[mood.getSelectedItemPosition()]).put("voicePresetName",preset).put("voiceEnabled",enabled.isChecked()).put("voiceAlways",false).put("voiceMode",new String[]{"smart","request","always"}[policy.getSelectedItemPosition()]).put("voicePreference",preference.getProgress()).put("voiceCooldown",cooldown.getProgress()+20).put("voiceEmotion",emotion.isChecked()).put("voiceNatural",natural.isChecked()).put("voiceMemoryEnabled",memory.isChecked()).put("zipVoiceAdaptive",adaptive.isChecked()).put("zipVoiceModel",modelQuality.getSelectedItemPosition()==1?"full":"fast").put("zipVoiceSteps",new int[]{4,8,16,32,16}[steps.getSelectedItemPosition()]).put("zipVoiceDeliveryPreset",steps.getSelectedItemPosition()==4?"t02-t06":"").put("speechProvider",provider).put("speechRate",rate.getProgress()-40).put("speechPitch",pitch.getProgress()-30).put("androidVoice",original.optString("androidVoice")).put("speechLanguage","zh-CN");}
    interface Result{void show(JSONObject result)throws Exception;}
    void request(String route,JSONObject data,Result handler){if(busy){a.toast("上次操作尚未完成");return;}busy=true;a.io.submit(()->{try{JSONObject r=a.accountApi(slot,route,data);a.runOnUiThread(()->{busy=false;if(a.destroyed)return;try{handler.show(r);}catch(Exception e){a.toast("语音响应未完成");}});}catch(Exception e){a.runOnUiThread(()->{busy=false;a.toast("请先保存设置并启动对应账号");});}});}
    void tests(){
        a.button("试听当前音色",()->new AlertDialog.Builder(a).setTitle("选择试听语气").setItems(new String[]{"准备好了","开心","温柔","害羞","难过","认真","睡前轻声","软绵 · 暧昧"},(d,n)->{if(busy){a.toast("正在切换声音，请稍候");return;}try{VoicePreview.play(a,slot,values(),new String[]{"neutral","happy","gentle","shy","sad","serious","gentle","intimate"}[n],new String[]{"准备好了。","太好啦，今天终于把事情做好了！","没关系，你慢慢说，我会认真听的。","诶，你这样夸我，我会有点不好意思的。","今天有点难过，可以陪我坐一会儿吗？","先等一下，我们把这件事情说清楚。","嗯，闭上眼睛，慢慢放松，今晚好好休息。","嗯，靠近一点嘛，我想轻轻和你说句话。"}[n]);}catch(Exception e){a.toast(e.getMessage());}}).show());

    }
}
