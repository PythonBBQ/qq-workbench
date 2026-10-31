package cn.qqworkbench.assistant;

import android.app.AlertDialog;
import android.graphics.Color;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.net.*;

/** Independent QQ profiles; the existing account is never migrated or cleared. */
final class AccountScreens {
    static void list(MainActivity a){
        a.base("QQ 多账号","instances");a.section("原账号","继续使用原来的模型卡片、酒馆和记忆。");
        a.note(a.lastState!=null&&a.lastState.optBoolean("connected")?"在线 · "+a.lastState.optString("identity"):"原账号待连接");
        a.button("打开原账号QQ",()->a.go("qq"));a.button("原账号语音",()->a.go("voice"));
        a.section("独立账号","最多再开3个。每个号单独配置API、语音与记忆；同时多开会增加内存和耗电。新账号需在自己的窗口登录。电脑 @codex 暂由原账号接入。");
        try{
            JSONArray profiles=new AccountProfiles(a).list();final android.widget.LinearLayout requested=a.page;
            java.util.Map<Integer,TextView> states=new java.util.HashMap<>();
            for(int i=0;i<profiles.length();i++){JSONObject p=profiles.getJSONObject(i);int slot=p.getInt("slot");
                a.section(p.optString("name"),"QQ "+p.optString("bot")+" · 模型 "+p.optString("model"));TextView state=a.text("正在检查…",14);a.body.addView(state);states.put(slot,state);
                a.button("查看此账号模型输入",()->{RequestScreens.slot=slot;a.go("requests");});
                a.button("配置此账号",()->{a.editingSlot=slot;a.clearDraft();a.go("instanceEdit");});
                a.button("启动此账号",()->action(a,"/multi/start",slot,true));a.button("打开此账号QQ",()->window(a,slot));a.button("停止此账号",()->action(a,"/multi/stop",slot,false));
            }
            if(profiles.length()<3)a.primary("添加独立账号",()->{try{JSONArray all=new AccountProfiles(a).list();int slot=1;for(;slot<=3;slot++){boolean used=false;for(int i=0;i<all.length();i++)if(all.getJSONObject(i).optInt("slot")==slot)used=true;if(!used)break;}a.editingSlot=slot;a.clearDraft();a.go("instanceEdit");}catch(Exception e){a.toast("配置读取失败，未改动原数据");}});
            a.button("刷新状态",()->list(a));
            a.io.submit(()->{try{JSONArray all=a.api("/multi/list",null).optJSONArray("instances");a.runOnUiThread(()->{if(a.destroyed||a.page!=requested)return;if(all!=null)for(int i=0;i<all.length();i++){JSONObject p=all.optJSONObject(i);TextView view=states.get(p.optInt("slot"));if(view!=null)view.setText((p.optBoolean("connected")?"已连接 · "+p.optString("identity"):p.optBoolean("running")?"运行中，等待登录":"已停止")+"\n"+p.optString("message"));}});}catch(Exception e){a.runOnUiThread(()->{if(a.page==requested)for(TextView v:states.values())v.setText("主服务尚未就绪，配置已保留");});}});
        }catch(Exception e){a.note("配置读取失败，原数据未改动。");}
    }
    static void action(MainActivity a,String path,int slot,boolean open){a.toast("正在处理…");a.io.submit(()->{try{if(open)a.api("/multi/configure",new JSONObject().put("profiles",new AccountProfiles(a).list()));JSONObject result=a.api(path,new JSONObject().put("slot",slot));a.runOnUiThread(()->{a.toast(result.optString("message"));if(open)window(a,slot);else if(a.screen.equals("instances"))list(a);});}catch(Exception e){a.runOnUiThread(()->a.toast("操作未完成，请先检查主服务；运行中的账号须先停止再修改"));}});}
    static JSONObject profile(MainActivity a,int slot)throws Exception{JSONArray all=new AccountProfiles(a).list();for(int i=0;i<all.length();i++)if(all.getJSONObject(i).optInt("slot")==slot)return all.getJSONObject(i);return new JSONObject().put("slot",slot).put("name","账号"+slot).put("apiUrl","https://api.deepseek.com").put("model","deepseek-flash").put("owner",a.currentConfig().optString("owner")).put("voiceMode","smart").put("speechProvider","android");}
    static void edit(MainActivity a){
        final int slot=a.editingSlot;final JSONObject p;try{p=profile(a,slot);}catch(Exception e){a.toast("配置读取失败");list(a);return;}
        a.base("独立账号 "+slot,"instanceEdit");a.section("账号与独立API","修改前请先停止此账号。密钥留空保留，不跟随原账号切换。聊天记忆和登录记录保留。");
        EditText name=a.input("账号名称",p.optString("name"),false),bot=a.input("机器人QQ",p.optString("bot"),false),owner=a.input("本账号大号QQ",p.optString("owner"),false);bot.setInputType(2);owner.setInputType(2);
        EditText url=a.input("本账号API地址",p.optString("apiUrl"),false),model=a.input("本账号模型",p.optString("model"),false),key=a.input("本账号API Key","",true);
        Spinner protocol=a.choices(new String[]{"Chat Completions","Responses"},p.optString("apiProtocol").equals("responses")?1:0);
        Spinner mode=a.choices(new String[]{"自动视觉","聊天模型看图","单独视觉服务"},p.optString("visionMode").equals("chat")?1:p.optString("visionMode").equals("separate")?2:0);
        EditText visionUrl=a.input("本账号视觉地址",p.optString("visionUrl"),false),visionModel=a.input("本账号视觉模型",p.optString("visionModel"),false),visionKey=a.input("本账号视觉Key","",true);
        a.button("复制一张API卡片到此账号",()->{try{JSONArray cards=new ApiProfiles(a).list();if(cards.length()==0){a.toast("还没有API卡片");return;}String[] names=new String[cards.length()];for(int i=0;i<names.length;i++)names[i]=cards.getJSONObject(i).optString("name");new AlertDialog.Builder(a).setTitle("复制为独立配置").setItems(names,(d,n)->{JSONObject card=cards.optJSONObject(n);url.setText(card.optString("apiUrl"));model.setText(card.optString("model"));key.setText(card.optString("apiKey"));visionUrl.setText(card.optString("visionUrl"));visionModel.setText(card.optString("visionModel"));visionKey.setText(card.optString("visionKey"));protocol.setSelection(card.optString("apiProtocol").equals("responses")?1:0);mode.setSelection(card.optString("visionMode").equals("chat")?1:card.optString("visionMode").equals("separate")?2:0);}).show();}catch(Exception e){a.toast("卡片读取失败");}});
        Switch enabled=a.toggle("此账号自动回复",p.optBoolean("enabled",true)),others=a.toggle("此账号允许回复其他人",p.optBoolean("others")),auto=a.toggle("随软件启动此账号",p.optBoolean("autoStart"));
        VoicePanel voice=new VoicePanel(a,slot,p);
        a.primary("保存此账号配置",()->{try{
            JSONObject next=new JSONObject(p.toString());next.put("slot",slot).put("name",name.getText().toString().trim()).put("bot",bot.getText().toString().trim()).put("owner",owner.getText().toString().trim()).put("apiUrl",url.getText().toString().trim()).put("model",model.getText().toString().trim()).put("apiProtocol",protocol.getSelectedItemPosition()==1?"responses":"chat").put("visionMode",new String[]{"auto","chat","separate"}[mode.getSelectedItemPosition()]).put("visionUrl",visionUrl.getText().toString().trim()).put("visionModel",visionModel.getText().toString().trim()).put("enabled",enabled.isChecked()).put("others",others.isChecked()).put("autoStart",auto.isChecked());
            if(!key.getText().toString().trim().isEmpty())next.put("apiKey",key.getText().toString().trim());if(!visionKey.getText().toString().trim().isEmpty())next.put("visionKey",visionKey.getText().toString().trim());
            JSONObject v=voice.values();for(java.util.Iterator<String> it=v.keys();it.hasNext();){String k=it.next();next.put(k,v.get(k));}if(!voice.key.getText().toString().trim().isEmpty())next.put("speechKey",voice.key.getText().toString().trim());
            if(!voice.feiyuKey.getText().toString().trim().isEmpty())next.put("feiyuKey",voice.feiyuKey.getText().toString().trim());
            JSONObject valid=AccountProfiles.validate(next);if(a.lastState!=null&&valid.optString("bot").equals(a.lastState.optString("identity")))throw new Exception("此QQ正在原账号使用，请勿重复配置");
            a.io.submit(()->{try{JSONArray runtime=a.api("/multi/list",null).getJSONArray("instances");for(int i=0;i<runtime.length();i++)if(runtime.getJSONObject(i).optInt("slot")==slot&&runtime.getJSONObject(i).optBoolean("running"))throw new Exception("请先停止此账号再保存");new AccountProfiles(a).save(valid);a.api("/multi/configure",new JSONObject().put("profiles",new AccountProfiles(a).list()));a.runOnUiThread(()->{a.clearDraft();a.toast("独立配置已保存，启动后生效");list(a);});}catch(Exception e){a.runOnUiThread(()->a.toast(e.getMessage()));}});
        }catch(Exception e){a.toast(e.getMessage());}});
        voice.tests();a.button("停止此账号以修改配置",()->action(a,"/multi/stop",slot,false));
    }
    static void window(MainActivity a,int slot){
        a.editingSlot=slot;a.base("独立QQ "+slot,"instanceQQ");a.section("此窗口仅登录账号 "+slot,"窗口会等待主服务和此实例准备好；请选择匹配的机器人QQ。号码不一致时不会自动回复。");
        new QqLoginWindow(a,slot,()->a.io.submit(()->{try{JSONObject p=profile(a,slot),result=a.accountApi(slot,"/connect",new JSONObject().put("uin",p.getString("bot")));a.runOnUiThread(()->a.toast(result.optString("message")));}catch(Exception e){a.runOnUiThread(()->a.toast("此账号尚未完成登录，请查看当前窗口状态"));}}));
    }
}
