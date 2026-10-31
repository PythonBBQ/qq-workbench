package cn.qqworkbench.assistant;

import android.app.AlertDialog;
import android.content.Intent;
import android.widget.*;
import org.json.*;

/** The same voice controls are used for the primary and isolated bot profiles. */
final class VoicePanel {
    boolean busy;final MainActivity a;final int slot;final JSONObject original;
    final Switch enabled,emotion,natural,memory,adaptive;final Spinner policy,provider,voice,feiyuStyle,zipSteps;final EditText region,key,group,feiyuUrl,feiyuKey;
    final SeekBar rate,pitch,preference,cooldown;String androidVoice,qqVoiceId,qqVoiceName;
    static final String[] IDS={"zh-CN-XiaoxiaoNeural","zh-CN-XiaoyiNeural","zh-TW-HsiaoChenNeural","zh-HK-HiuMaanNeural","ja-JP-NanamiNeural","ko-KR-SunHiNeural"};
    VoicePanel(MainActivity activity,int account,JSONObject c){a=activity;slot=account;original=c;
        a.section("语音回复","由聊天模型在同一次回答里结合上下文选择形式，不增加调用次数。群聊少打扰；代码、链接和长内容保留文字，明确要求优先。失败时回退文字。");
        enabled=a.toggle("开启语音",c.optBoolean("voiceEnabled"));
        String selected=c.optString("voiceMode",c.optBoolean("voiceAlways")?"always":"smart");
        policy=a.choices(new String[]{"智能选择 · 推荐","仅明确要求时","优先语音"},selected.equals("request")?1:selected.equals("always")?2:0);
        preference=a.slider("智能语音倾向",c.optInt("voicePreference",35),0,100,"（0仅主动要求，100更偏向语音）");
        cooldown=a.slider("自动语音最短间隔",c.optInt("voiceCooldown",45),20,180," 秒（明确要求不受限）");
        emotion=a.toggle("让语气随情境变化",c.optBoolean("voiceEmotion",true));
        natural=a.toggle("自然口语与句间停顿",c.optBoolean("voiceNatural",true));
        memory=a.toggle("单独记住说话偏好",c.optBoolean("voiceMemoryEnabled",true));
        adaptive=a.toggle("本机语音长句自动加速",c.optBoolean("zipVoiceAdaptive",true));
        a.note("合成前按约18字寻找句号、逗号或语意边界分段，过短尾句合并，完成后拼成一条语音。超过60字时自动用4步；关闭自动加速后保留原精度。语速设置保留，总等待最多约两分钟，失败则保留全文分两段文字回复。");
        a.note("仅记住明确反馈，如“以后语音短一点”；刚收到语音后说“慢一点”也可学习。按账号、联系人和群分别保存，不修改酒馆人设，不新增模型调用。临时不方便听不保存为长期偏好。语音是否自然仍受音色和模型影响。");
        a.button("查看说话偏好",()->request("/voice/memory",null,r->{JSONArray list=r.optJSONArray("sessions");StringBuilder text=new StringBuilder();if(list!=null)for(int i=0;i<list.length();i++){JSONObject item=list.getJSONObject(i);text.append(item.optString("group").isEmpty()?"私聊":"群 "+item.optString("group")).append(" · QQ ").append(item.optString("user")).append("\n").append(item.optString("description")).append("\n\n");}new AlertDialog.Builder(a).setTitle("独立说话偏好").setMessage(text.length()>0?text.toString():r.optString("problem","").isEmpty()?"还没有明确反馈，暂未学习偏好":r.optString("problem")).setPositiveButton("关闭",null).show();}));
        a.button("清除本账号说话偏好",()->request("/voice/memory/clear",new JSONObject(),r->a.toast(r.optString("message"))));
        String service=c.optString("speechProvider",slot==0?"azure":"android");
        provider=a.choices(new String[]{"安卓系统语音 · 无需另填Key","微软 Azure · 中日韩女声","QQ 群内置音色 · 仅群聊","肥鱼声音服务 · 需部署后端","轻量本机语音 · ZipVoice"},service.equals("azure")?1:service.equals("qq")?2:service.equals("feiyu")?3:service.equals("zipvoice")?4:0);
        LinearLayout host=a.body,system=new LinearLayout(a),azure=new LinearLayout(a),qq=new LinearLayout(a),feiyu=new LinearLayout(a),light=new LinearLayout(a);system.setOrientation(1);azure.setOrientation(1);qq.setOrientation(1);host.addView(system);host.addView(azure);host.addView(qq);feiyu.setOrientation(1);host.addView(feiyu);light.setOrientation(1);host.addView(light);a.body=light;VoiceReferences.controls(a,slot,()->{provider.setSelection(4);enabled.setChecked(true);emotion.setChecked(true);policy.setSelection(0);});zipSteps=a.choices(new String[]{"快速合成 · 4步","细致合成 · 8步（更慢）"},c.optInt("zipVoiceSteps",4)==8?1:0);a.body=system;
        androidVoice=c.optString("androidVoice");qqVoiceId=c.optString("qqVoiceId");qqVoiceName=c.optString("qqVoiceName");
        a.note("系统音色："+(androidVoice.isEmpty()?"默认中文":androidVoice));
        a.button("检查并选择系统音色",()->request("/voice/state",null,result->{JSONObject local=result.optJSONObject("local");if(local==null||!local.optBoolean("ok")){a.toast(local==null?"先保存为安卓系统语音，再检查":local.optString("message"));return;}JSONArray voices=local.optJSONArray("voices");if(voices==null||voices.length()==0){a.toast("没有可用音色，请下载系统语言包");return;}String[] labels=new String[voices.length()];for(int i=0;i<labels.length;i++){JSONObject v=voices.optJSONObject(i);labels[i]=v.optString("language")+" · "+v.optString("id")+(v.optBoolean("network")?"（需联网）":"（本机）");}new AlertDialog.Builder(a).setTitle("选择后请保存").setItems(labels,(d,n)->{androidVoice=voices.optJSONObject(n).optString("id");a.toast("已选择，保存后生效");}).setNegativeButton("取消",null).show();}));
        a.button("系统文字转语音设置",()->{try{a.startActivity(new Intent("com.android.settings.TTS_SETTINGS"));}catch(Exception e){a.toast("请在系统设置搜索“文字转语音”");}});
        a.button("恢复系统默认中文音色",()->{androidVoice="";a.toast("保存后使用默认中文");});a.body=azure;
        int active=0;for(int i=0;i<IDS.length;i++)if(IDS[i].equals(c.optString("speechVoice")))active=i;
        a.note("Azure 基础音色");voice=a.choices(new String[]{"晓晓 · 普通话","晓伊 · 普通话","曉臻 · 台湾国语","曉曼 · 粤语","七海 · 日语","善熙 · 韩语"},active);
        region=a.input("Azure 区域",c.optString("speechRegion","eastasia"),false);key=a.input("Speech Key","",true);
        a.note("Azure 单独计费；安卓语音是否离线取决于所选引擎和语言包，音色不保证为女声。");
        a.body=host;rate=a.slider("语速",c.optInt("speechRate",0),-40,60,"%");pitch=a.slider("音高",c.optInt("speechPitch",0),-30,30,"%");
        a.body=qq;group=a.input("QQ音色群号",c.optString("qqVoiceGroup"),false);group.setInputType(2);
        a.button("选择QQ群音色",()->{try{request("/voice/characters",new JSONObject().put("group",group.getText().toString().trim()),result->{JSONArray groups=result.optJSONArray("groups");java.util.ArrayList<JSONObject> all=new java.util.ArrayList<>();if(groups!=null)for(int i=0;i<groups.length();i++){JSONArray items=groups.optJSONObject(i).optJSONArray("characters");if(items!=null)for(int j=0;j<items.length();j++)all.add(items.optJSONObject(j));}if(all.isEmpty()){a.toast(result.optString("message","此群没有可用音色"));return;}String[] labels=new String[all.size()];for(int i=0;i<labels.length;i++)labels[i]=all.get(i).optString("character_name");new AlertDialog.Builder(a).setTitle("选择后请保存").setItems(labels,(d,n)->{qqVoiceId=all.get(n).optString("character_id");qqVoiceName=all.get(n).optString("character_name");a.toast("已选择 "+qqVoiceName);}).show();});}catch(Exception e){a.toast("请填写群号");}});
        a.body=feiyu;feiyuUrl=a.input("肥鱼服务地址",c.optString("feiyuUrl","http://127.0.0.1:9880"),false);feiyuKey=a.input("肥鱼服务Key","",true);feiyuStyle=a.choices(new String[]{"随情境选可爱 / 温柔","固定可爱","固定温柔"},c.optString("feiyuStyle","auto").equals("cute")?1:c.optString("feiyuStyle","auto").equals("gentle")?2:0);a.note("这是独立HTTP声音后端，模型与GPU服务未捆入APK。支持可爱/温柔，不宣称有独立娇羞模型；服务器需可从手机访问，127.0.0.1表示手机自己。原系统语音仍可选。系统语音仅微调语速音高，不等于完整情绪合成。Azure晓晓可使用支持的情绪样式。");
        a.body=host;Runnable visibility=()->{int n=provider.getSelectedItemPosition();system.setVisibility(n==0?android.view.View.VISIBLE:android.view.View.GONE);azure.setVisibility(n==1?android.view.View.VISIBLE:android.view.View.GONE);qq.setVisibility(n==2?android.view.View.VISIBLE:android.view.View.GONE);feiyu.setVisibility(n==3?android.view.View.VISIBLE:android.view.View.GONE);light.setVisibility(n==4?android.view.View.VISIBLE:android.view.View.GONE);};provider.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> p,android.view.View v,int n,long id){visibility.run();}public void onNothingSelected(AdapterView<?> p){}});visibility.run();
    }
    JSONObject values()throws Exception{
        String service=new String[]{"android","azure","qq","feiyu","zipvoice"}[provider.getSelectedItemPosition()],r=region.getText().toString().trim();if(service.equals("azure")&&!r.matches("[a-z][a-z0-9]{1,30}"))throw new Exception("Azure区域格式不正确");
        if(service.equals("feiyu"))AccountProfiles.voiceAddress(feiyuUrl.getText().toString().trim());
        return new JSONObject().put("zipVoiceAdaptive",adaptive.isChecked()).put("voiceNatural",natural.isChecked()).put("voiceMemoryEnabled",memory.isChecked()).put("zipVoiceSteps",zipSteps.getSelectedItemPosition()==1?8:4).put("voiceCooldown",cooldown.getProgress()+20).put("voiceEmotion",emotion.isChecked()).put("feiyuUrl",feiyuUrl.getText().toString().trim()).put("feiyuVoice","feiyu").put("feiyuStyle",new String[]{"auto","cute","gentle"}[feiyuStyle.getSelectedItemPosition()]).put("voiceEnabled",enabled.isChecked()).put("voiceAlways",false).put("voicePreference",preference.getProgress()).put("voiceMode",new String[]{"smart","request","always"}[policy.getSelectedItemPosition()]).put("speechProvider",service).put("speechVoice",IDS[voice.getSelectedItemPosition()]).put("androidVoice",androidVoice).put("speechLanguage","zh-CN").put("speechRegion",r).put("speechRate",rate.getProgress()-40).put("speechPitch",pitch.getProgress()-30).put("qqVoiceGroup",group.getText().toString().trim()).put("qqVoiceId",qqVoiceId).put("qqVoiceName",qqVoiceName);
    }
    interface Result{void show(JSONObject result)throws Exception;}
    void request(String route,JSONObject data,Result handler){if(busy){a.toast("上次操作尚未完成");return;}busy=true;a.toast("正在检查，请勿重复操作…");a.io.submit(()->{try{JSONObject r=a.accountApi(slot,route,data);a.runOnUiThread(()->{busy=false;if(a.destroyed)return;try{handler.show(r);}catch(Exception e){a.toast("语音响应未完成");}});}catch(Exception e){a.runOnUiThread(()->{busy=false;a.toast("检查未完成，请先保存设置并启动对应账号");});}});}
    void tests(){
        a.button("试听已保存音色与语气（不发QQ）",()->new AlertDialog.Builder(a).setTitle("选择语气意图，实际效果取决于引擎").setItems(new String[]{"自然","开心","温柔安慰","轻柔害羞（近似）","难过","认真"},(dialog,n)->{try{String[] moods={"neutral","happy","gentle","shy","sad","serious"};request("/voice/preview",new JSONObject().put("emotion",moods[n]),r->{if(!r.optBoolean("ok")){a.toast(r.optString("message"));return;}a.playVoice(android.util.Base64.decode(r.getString("audio"),android.util.Base64.DEFAULT));});}catch(Exception e){a.toast("试听未完成");}}).show());
        a.button("向本账号大号发送测试语音",()->request("/voice/test-send",new JSONObject(),r->a.toast(r.optString("message"))));
    }
}
