package cn.qqworkbench.assistant;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

final class ModelCatalog {
    static URI uri(String value)throws Exception{URI u=new URI(value.trim());if(!"https".equals(u.getScheme())||u.getHost()==null||u.getRawUserInfo()!=null||u.getRawQuery()!=null||u.getRawFragment()!=null)throw new IOException("地址须为 HTTPS，不能含账号或参数");return u;}
    static String completion(String value)throws Exception{return completion(value,"chat");}
    static String completion(String value,String protocol)throws Exception{URI u=uri(value);String path=u.getPath().replaceAll("/+$","").replaceAll("/(chat/completions|responses|models)$","");return new URI(u.getScheme(),u.getAuthority(),path+(protocol.equals("responses")?"/responses":"/chat/completions"),null,null).toASCIIString();}
    static String models(String value)throws Exception{URI u=uri(value);String path=u.getPath().replaceAll("/+$","").replaceAll("/(chat/completions|responses|models)$","");return new URI(u.getScheme(),u.getAuthority(),path+"/models",null,null).toASCIIString();}
    static String[] fetch(String address,String key)throws Exception{
        if(key.trim().isEmpty())throw new IOException("请先填写 API Key");HttpURLConnection c=(HttpURLConnection)new URL(models(address)).openConnection();c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setInstanceFollowRedirects(false);c.setRequestProperty("Authorization","Bearer "+key);c.setRequestProperty("Accept","application/json");
        try{int code=c.getResponseCode();if(code!=200)throw new IOException("模型列表 HTTP "+code);byte[] bytes;try(InputStream in=c.getInputStream()){bytes=CharacterCard.read(in,2*1024*1024);}return parse(new String(bytes,StandardCharsets.UTF_8));}finally{c.disconnect();}
    }
    static String[] parse(String json)throws Exception{JSONArray entries=new JSONObject(json).optJSONArray("data");if(entries==null)throw new IOException("服务商没有返回兼容的模型列表");TreeSet<String> names=new TreeSet<>();for(int i=0;i<Math.min(entries.length(),5000);i++){JSONObject item=entries.optJSONObject(i);if(item==null)continue;String name=item.optString("id","").trim();if(!name.isEmpty()&&name.length()<=200)names.add(name);}if(names.isEmpty())throw new IOException("模型列表为空");return names.toArray(new String[0]);}
}
