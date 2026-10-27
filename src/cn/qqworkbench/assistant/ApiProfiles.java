package cn.qqworkbench.assistant;
import android.content.Context;
import org.json.*;
import java.io.IOException;
import java.net.URI;

/** Provider credentials stay inside Android Keystore-backed ciphertext. */
final class ApiProfiles {
    private final Secrets vault;
    private final Context context;
    ApiProfiles(Context context){this.context=context;vault=new Secrets(context);}
    JSONObject active()throws Exception {
        String saved=vault.get("active-api");if(!saved.isEmpty())return new JSONObject(saved);
        android.content.SharedPreferences prefs=context.getSharedPreferences("settings",0);JSONObject p=new JSONObject();
        p.put("apiUrl",prefs.getString("apiUrl","https://api.deepseek.com")).put("model",prefs.getString("model","deepseek-flash")).put("visionMode",prefs.getString("visionMode",prefs.getString("visionUrl","").isEmpty()?"auto":"separate")).put("visionUrl",prefs.getString("visionUrl","")).put("visionModel",prefs.getString("visionModel","")).put("apiKey",vault.get("deepseek")).put("visionKey",vault.get("vision"));p.put("apiProtocol",prefs.getString("apiProtocol","chat"));return p;
    }
    void activate(JSONObject profile)throws Exception {vault.put("active-api",validated(profile).toString());}
    JSONArray list()throws Exception {String text=vault.get("api-profiles");return text.isEmpty()?new JSONArray():new JSONArray(text);}
    JSONObject get(String id)throws Exception {JSONArray all=list();for(int i=0;i<all.length();i++)if(all.getJSONObject(i).optString("id").equals(id))return all.getJSONObject(i);throw new IOException("配置卡片不存在");}
    static boolean sameOrigin(String a,String b){try{URI x=ModelCatalog.uri(a),y=ModelCatalog.uri(b);return x.getScheme().equals(y.getScheme())&&x.getHost().equalsIgnoreCase(y.getHost())&&(x.getPort()==-1?443:x.getPort())==(y.getPort()==-1?443:y.getPort());}catch(Exception e){return false;}}
    static JSONObject validated(JSONObject card)throws Exception {
        JSONObject c=new JSONObject(card.toString());String name=c.optString("name").trim(),model=c.optString("model").trim();
        if(name.isEmpty()||name.length()>60)throw new IOException("卡片名称需为 1–60 字");
        ModelCatalog.uri(c.optString("apiUrl"));
        String protocol=c.optString("apiProtocol","chat");if(!protocol.equals("chat")&&!protocol.equals("responses"))throw new IOException("模型接口协议无效");c.put("apiProtocol",protocol);
        if(model.isEmpty()||model.length()>200||model.contains(",")||model.contains("，"))throw new IOException("请选择一个当前聊天模型");
        String key=c.optString("apiKey").trim();if(key.isEmpty()||key.length()>4096)throw new IOException("请填写这张卡片的 API Key");
        String mode=c.optString("visionMode","auto");if(!mode.equals("auto")&&!mode.equals("chat")&&!mode.equals("separate"))throw new IOException("视觉模式无效");
        if(mode.equals("separate")){ModelCatalog.uri(c.optString("visionUrl"));if(c.optString("visionModel").trim().isEmpty()||c.optString("visionKey").trim().isEmpty())throw new IOException("单独视觉服务需填写地址、模型和自己的 Key");}
        c.put("name",name).put("model",model).put("apiKey",key);return c;
    }
    void save(JSONObject card)throws Exception {JSONObject c=validated(card);JSONArray old=list(),next=new JSONArray();boolean found=false;for(int i=0;i<old.length();i++){JSONObject p=old.getJSONObject(i);if(p.optString("id").equals(c.getString("id"))){next.put(c);found=true;}else next.put(p);}if(!found){if(next.length()>=20)throw new IOException("最多保存 20 张 API 卡片");next.put(c);}vault.put("api-profiles",next.toString());}
    void delete(String id)throws Exception {JSONArray old=list(),next=new JSONArray();for(int i=0;i<old.length();i++)if(!old.getJSONObject(i).optString("id").equals(id))next.put(old.getJSONObject(i));vault.put("api-profiles",next.toString());}
    static JSONObject settings(JSONObject p)throws Exception {JSONObject c=new JSONObject();for(String k:new String[]{"apiUrl","model","visionMode","visionUrl","visionModel","apiProtocol"})c.put(k,p.optString(k,k.equals("visionMode")?"auto":k.equals("apiProtocol")?"chat":""));return c;}
    static JSONObject template(int which)throws Exception {
        String[][] providers={{"DeepSeek 官方","https://api.deepseek.com","deepseek-flash"},{"阿里云百炼 / 通义千问","https://dashscope.aliyuncs.com/compatible-mode/v1","qwen-plus"},{"月之暗面 / Kimi","https://api.moonshot.cn/v1","moonshot-v1-8k"},{"智谱开放平台","https://open.bigmodel.cn/api/paas/v4","glm-4-flash"},{"自定义中转站","https://",""}};
        String[] p=providers[Math.max(0,Math.min(which,providers.length-1))];return new JSONObject().put("id",java.util.UUID.randomUUID().toString()).put("name",p[0]).put("apiUrl",p[1]).put("model",p[2]).put("visionMode","auto").put("visionUrl","").put("visionModel","").put("apiKey","").put("visionKey","");
    }
}
