package cn.qqworkbench.assistant;

import android.app.AlertDialog;
import android.widget.SeekBar;
import org.json.JSONArray;
import org.json.JSONObject;

/** Local proactive score inspection and explicit category preferences. */
final class OwnerChatScreens {
    static final String[] KEYS={"company","interest","daily","plan","help","lookup","general"};
    static final String[] LABELS={"陪伴与心情","兴趣闲聊","日常生活","安排与进展","工作与求助","一次性查询","其他聊天"};

    static void preferences(MainActivity a){
        a.base("主动话题偏好","ownerChatWeights");
        a.section("调整话题分数","每类可加减15分，0表示使用默认分数。只影响主动开场，不影响主人发来消息后的正常回复。调整后点击保存。");
        JSONObject weights=a.currentConfig().optJSONObject("proactiveWeights");
        SeekBar[] bars=new SeekBar[KEYS.length];
        for(int i=0;i<KEYS.length;i++)bars[i]=a.slider(LABELS[i],weights==null?0:weights.optInt(KEYS[i],0),-15,15," 分");
        a.primary("保存话题偏好",()->{try{JSONObject next=new JSONObject();for(int i=0;i<KEYS.length;i++)next.put(KEYS[i],bars[i].getProgress()-15);a.patch(new JSONObject().put("proactiveWeights",next));a.toast("主动话题偏好已保存");}catch(Exception e){a.toast("话题偏好未保存");}});
        a.button("恢复默认话题偏好",()->{try{a.patch(new JSONObject().put("proactiveWeights",new JSONObject()));for(String label:LABELS)a.drafts.remove("ownerChatWeights:"+label);preferences(a);a.toast("已恢复默认话题分数");}catch(Exception e){a.toast("恢复未完成");}});
    }

    static void inspect(MainActivity a){
        a.io.submit(()->{try{JSONObject result=a.api("/owner-chat/state",null);a.runOnUiThread(()->{if(!a.destroyed)show(a,result,result);});}catch(Exception e){a.runOnUiThread(()->a.toast("本地服务就绪后可查看评分"));}});
    }
    static String signed(int n){return (n>0?"+":"")+n;}
    static String date(long at){return at>0?new java.text.SimpleDateFormat("MM-dd HH:mm",java.util.Locale.ROOT).format(new java.util.Date(at)):"暂无";}
    static void show(MainActivity a,JSONObject result,JSONObject candidate){
        StringBuilder text=new StringBuilder(result.optString("stamp")).append("\n").append(result.optString("reason"));
        if(candidate!=result)text.append("\n此项是候选话题，不代表会发送。");
        text.append("\n\n").append(candidate.optString("label")).append("：").append(candidate.optInt("score")).append(" / ").append(result.optInt("threshold")).append(" 分");
        int missing=Math.max(0,result.optInt("threshold")-candidate.optInt("score"));
        text.append(missing>0?"\n距离门槛还差 "+missing+" 分":candidate!=result?"\n此候选得分达标；实际调度以当前最高分话题为准":result.optBoolean("shouldGenerate")?"\n本次评分和等待条件已满足；不代表已经发送":"\n分数达标，当前仍在等待："+result.optString("reason"));
        JSONObject decision=result.optJSONObject("lastDecision");
        if(decision!=null)text.append("\n\n上次实际尝试：").append(date(decision.optLong("at"))).append("\n").append(decision.optString("message")).append("\n当时评分 ").append(decision.optInt("score")).append(" / ").append(decision.optInt("threshold")).append(" 分；与本次快照分开显示。");
        String topic=candidate.optString("topic");if(!topic.isEmpty())text.append("\n\n主人原话：").append(topic).append("\n记录于 ").append(date(candidate.optLong("evidenceAt")));
        JSONArray parts=candidate.optJSONArray("components");
        if(parts!=null)for(int i=0;i<parts.length();i++){JSONObject part=parts.optJSONObject(i);if(part!=null)text.append("\n").append(part.optString("label")).append("：").append(signed(part.optInt("points")));}
        if(!candidate.optString("recommendation").isEmpty())text.append("\n\n开场方向：").append(candidate.optString("recommendation"));
        JSONObject habit=result.optJSONObject("habit");if(habit!=null)text.append("\n\n聊天时段样本：").append(habit.optInt("days")).append("天 / ").append(habit.optInt("sessions")).append("次会话").append(habit.optBoolean("learned")?"；仅作轻微时段偏好。":"；不足3天、4次会话时不加时段习惯分。");
        if(result.optLong("lastContactAt")>0)text.append("\n上次主动联系：").append(date(result.optLong("lastContactAt")));
        if(result.optLong("earliestCheckAt")>result.optLong("at"))text.append("\n当前等待最早结束：").append(date(result.optLong("earliestCheckAt"))).append("，到时重新评分，不保证发送。");
        text.append("\n\n查看使用已保存设置，不生成或发送消息。未回复只是减分，不会永久停止主动聊天。");
        new AlertDialog.Builder(a).setTitle("主动聊天评估").setMessage(text.toString()).setPositiveButton("关闭",null)
            .setNeutralButton("候选话题",(d,w)->candidates(a,result)).setNegativeButton("评分规则",(d,w)->rules(a,result)).show();
    }
    static void candidates(MainActivity a,JSONObject result){
        JSONArray list=result.optJSONArray("candidates");
        if(list==null||list.length()==0){a.toast("当前没有可评分的主人话题");return;}
        String[] labels=new String[list.length()];
        for(int i=0;i<labels.length;i++){JSONObject c=list.optJSONObject(i);labels[i]=c.optInt("score")+"分 · "+c.optString("label")+"\n"+c.optString("topic");}
        new AlertDialog.Builder(a).setTitle("候选话题 · 按得分排序").setItems(labels,(d,index)->show(a,result,list.optJSONObject(index))).setNegativeButton("返回",(d,w)->show(a,result,result)).show();
    }
    static void rules(MainActivity a,JSONObject result){
        JSONObject policy=result.optJSONObject("policy");StringBuilder text=new StringBuilder("按设备当地时间评分，免打扰优先。\n");
        JSONArray bands=policy==null?null:policy.optJSONArray("timeBands"),types=policy==null?null:policy.optJSONArray("categories");
        if(bands!=null)for(int i=0;i<bands.length();i++){JSONObject b=bands.optJSONObject(i);text.append("\n").append(b.optInt("from")).append(":00～").append(b.optInt("to")).append(":00 ").append(b.optString("label")).append(" ").append(signed(b.optInt("points")));}
        text.append("\n周末9:00～22:00额外+3；常聊时段最多+8。");
        text.append("\n\n话题基础分 / 主人调整");
        if(types!=null)for(int i=0;i<types.length();i++){JSONObject type=types.optJSONObject(i);text.append("\n").append(type.optString("label")).append(" ").append(signed(type.optInt("points"))).append(" / ").append(signed(type.optInt("adjustment")));}
        text.append("\n\n真实续聊依据：陪伴、兴趣、日常、安排+10，查询与求助不加，避免普通白天话题永远够不到门槛。\n使用程度：不同会话+4、跨天+2，合计最多20。同一会话刷词不加分。\n话题新鲜度：6小时内+14、一天内+8、三天内0、七天内-24、更早-48。\n未完话题+8；明确时间的安排临近+12，过期降低相关性。后续补充不丢失原计划时间。\n自然间隔最多+10，按当前证据重算，不按检查次数累加。\n\n睡觉最多-85、忙碌-55、告别-35，分别在8小时/2小时/90分钟内逐渐恢复；午睡按2小时。\n已结束的话题-28，明确不想聊的话题-80，只影响对应话题。\n刚联系过最多-18、未回复12～36分，取衰减后较大的扣分，不重复相加。\n近期同类最多-6、相同话题最多-14，取对应一项并逐渐衰减；同类回应历史最多±8分，不把没回复认定为讨厌此话题。\n饭点类别不再整天拦截，仍过滤近24小时的相同或高度相似开场。\n\n话题识别使用本地分词和规则，不调用额外模型。低分不生成；达到门槛后才调用一次模型，模型仍可跳过。查看快照不会模拟或补发聊天。上次实际尝试单独显示，评分通过不等于QQ已接受。");
        new AlertDialog.Builder(a).setTitle("评分规则").setMessage(text.toString()).setPositiveButton("返回评分",(d,w)->show(a,result,result)).show();
    }
}
