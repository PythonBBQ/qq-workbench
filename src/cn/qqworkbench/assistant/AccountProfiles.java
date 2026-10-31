package cn.qqworkbench.assistant;
import android.content.Context;
import org.json.*;
import java.io.IOException;

/** Independent bot profiles, including their own API and speech keys, in Keystore ciphertext. */
final class AccountProfiles {
    private final Secrets vault;
    AccountProfiles(Context context){vault=new Secrets(context);}
    JSONArray list()throws Exception{String saved=vault.get("qq-instances");return saved.isEmpty()?new JSONArray():new JSONArray(saved);}
    static void voiceAddress(String address)throws Exception{java.net.URI u=new java.net.URI(address);String h=u.getHost();boolean local=h!=null&&(h.equals("localhost")||h.equals("127.0.0.1")||h.equals("[::1]")||h.matches("10\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}")||h.matches("192\\.168\\.[0-9]{1,3}\\.[0-9]{1,3}")||h.matches("172\\.(1[6-9]|2[0-9]|3[01])\\.[0-9]{1,3}\\.[0-9]{1,3}"));if(h==null||u.getUserInfo()!=null||u.getRawQuery()!=null||u.getRawFragment()!=null||!("https".equals(u.getScheme())||"http".equals(u.getScheme())&&local))throw new IOException("肥鱼服务需HTTPS或本机/局域网HTTP地址");}
    static JSONObject validate(JSONObject source)throws Exception{
        JSONObject p=new JSONObject(source.toString());int slot=p.optInt("slot");
        if(slot<1||slot>3)throw new IOException("最多新增3个QQ实例");
        String bot=p.optString("bot"),owner=p.optString("owner");
        if(!bot.matches("[1-9][0-9]{4,11}")||!owner.matches("[1-9][0-9]{4,11}")||bot.equals(owner))throw new IOException("请分别填写机器人QQ和大号QQ");
        JSONObject api=ApiProfiles.validated(p);for(java.util.Iterator<String> it=api.keys();it.hasNext();){String k=it.next();p.put(k,api.get(k));}
        if(p.optString("speechKey").length()>4096||p.optString("feiyuKey").length()>4096)throw new IOException("语音密钥过长");
        if(!java.util.Arrays.asList("android","azure","qq","feiyu","zipvoice").contains(p.optString("speechProvider","android")))throw new IOException("语音服务无效");
        if(!java.util.Arrays.asList("smart","request","always").contains(p.optString("voiceMode","smart")))throw new IOException("语音策略无效");
        if(p.optString("speechProvider").equals("feiyu")){voiceAddress(p.optString("feiyuUrl"));if(p.optString("feiyuKey").trim().isEmpty())throw new IOException("请填写肥鱼服务自己的Key");}
        return p;
    }
    void save(JSONObject profile)throws Exception{JSONObject p=validate(profile);JSONArray all=list(),next=new JSONArray();boolean found=false;
        for(int i=0;i<all.length();i++){JSONObject old=all.getJSONObject(i);if(old.optInt("slot")==p.optInt("slot")){next.put(p);found=true;}else{if(old.optString("bot").equals(p.optString("bot")))throw new IOException("此机器人QQ已在另一实例中配置");next.put(old);}}
        if(!found){if(next.length()>=3)throw new IOException("最多新增3个QQ实例");next.put(p);}vault.put("qq-instances",next.toString());
    }
    void remove(int slot)throws Exception{JSONArray all=list(),next=new JSONArray();for(int i=0;i<all.length();i++)if(all.getJSONObject(i).optInt("slot")!=slot)next.put(all.getJSONObject(i));vault.put("qq-instances",next.toString());}
}
