package cn.qqworkbench.assistant;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Opt-in diagnostic. Decrypt on device only, test saved relay cards, never print credentials or chat content. */
public final class RelayProfilesCheck {
    public static void main(String[] args)throws Exception{
        try{diagnose(args);}catch(Throwable e){System.out.println(new JSONObject().put("phase","diagnostic-unavailable").put("errorType",e.getClass().getSimpleName()).toString());}
        System.exit(0);
    }
    static String preference(String file,String name)throws Exception{
        org.xmlpull.v1.XmlPullParser p=android.util.Xml.newPullParser();
        try(InputStream in=new FileInputStream("/data/user/0/cn.qqworkbench.assistant/shared_prefs/"+file+".xml")){p.setInput(in,"UTF-8");while(p.next()!=org.xmlpull.v1.XmlPullParser.END_DOCUMENT)if(p.getEventType()==org.xmlpull.v1.XmlPullParser.START_TAG&&p.getName().equals("string")&&name.equals(p.getAttributeValue(null,"name")))return p.nextText();}return "";
    }
    static void diagnose(String[] args)throws Exception{
        // Keys remain in this app UID's Keystore; no decrypted value leaves this process.
        String saved=preference("vault","api-profiles");byte[] encrypted=android.util.Base64.decode(saved,android.util.Base64.NO_WRAP);
        Class.forName("android.security.keystore2.AndroidKeyStoreProvider").getMethod("install").invoke(null);
        java.security.KeyStore store=java.security.KeyStore.getInstance("AndroidKeyStore");store.load(null);
        javax.crypto.Cipher cipher=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");cipher.init(javax.crypto.Cipher.DECRYPT_MODE,store.getKey("qq-workbench-v1",null),new javax.crypto.spec.GCMParameterSpec(128,encrypted,0,12));
        JSONArray cards=new JSONArray(new String(cipher.doFinal(encrypted,12,encrypted.length-12),StandardCharsets.UTF_8));String active=preference("settings","activeApi");
        for(int i=0;i<cards.length();i++){
            JSONObject card=cards.getJSONObject(i);URI u=ModelCatalog.uri(card.getString("apiUrl"));
            System.out.println(new JSONObject().put("phase","saved-card").put("name",card.optString("name")).put("host",u.getHost()).put("model",card.optString("model")).put("protocol",card.optString("apiProtocol","chat")).put("selected",active.equals(card.optString("id"))).toString());
            if(!java.util.Arrays.asList(args).contains("--test")||!card.optString("model").toLowerCase().matches(".*gpt[-_ ]?6[._]?1.*"))continue;
            if(java.util.Arrays.asList(args).contains("--bridge")){
                for(String protocol:new String[]{"models","chat","responses"})bridgeTest(card,protocol,store);
                continue;
            }
            long start=System.currentTimeMillis();HttpURLConnection c=null;
            try{
                String protocol=card.optString("apiProtocol","chat");JSONObject body=new JSONObject().put("model",card.getString("model")).put("stream",false);
                JSONArray messages=new JSONArray().put(new JSONObject().put("role","user").put("content","请只回复：连接正常"));body.put(protocol.equals("responses")?"input":"messages",messages).put(protocol.equals("responses")?"max_output_tokens":"max_tokens",256);
                c=(HttpURLConnection)new URL(ModelCatalog.completion(card.getString("apiUrl"),protocol)).openConnection();c.setConnectTimeout(10000);c.setReadTimeout(25000);c.setInstanceFollowRedirects(false);c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");c.setRequestProperty("Authorization","Bearer "+card.getString("apiKey"));
                try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}
                int code=c.getResponseCode();JSONObject result=new JSONObject().put("phase","saved-relay-test").put("host",u.getHost()).put("model",card.getString("model")).put("http",code).put("elapsedMs",System.currentTimeMillis()-start);
                byte[] bytes;try(InputStream in=code<400?c.getInputStream():c.getErrorStream()){bytes=in==null?new byte[0]:CharacterCard.read(in,2*1024*1024);}
                try{JSONObject data=new JSONObject(new String(bytes,StandardCharsets.UTF_8));JSONArray choices=data.optJSONArray("choices");JSONObject first=choices==null?null:choices.optJSONObject(0),message=first==null?null:first.optJSONObject("message");Object content=message==null?null:message.opt("content");result.put("hasChatText",content instanceof String&&!((String)content).trim().isEmpty()).put("finishReason",first==null?"":first.optString("finish_reason")).put("hasResponsesOutput",data.optJSONArray("output")!=null).put("hasError",data.has("error"));}catch(Exception ignored){result.put("json",false);}
                System.out.println(result.toString());
            }catch(Exception e){System.out.println(new JSONObject().put("phase","saved-relay-test").put("host",u.getHost()).put("errorType",e.getClass().getSimpleName()).put("elapsedMs",System.currentTimeMillis()-start).toString());}finally{if(c!=null)c.disconnect();}
        }
        System.out.println("QQWB_RELAY_PROFILES_DONE: no QQ messages, no active settings changed");
    }
    static void bridgeTest(JSONObject card,String protocol,java.security.KeyStore store)throws Exception{
        byte[] encrypted=android.util.Base64.decode(preference("vault","internal"),android.util.Base64.NO_WRAP);javax.crypto.Cipher cipher=javax.crypto.Cipher.getInstance("AES/GCM/NoPadding");cipher.init(javax.crypto.Cipher.DECRYPT_MODE,store.getKey("qq-workbench-v1",null),new javax.crypto.spec.GCMParameterSpec(128,encrypted,0,12));String token=new String(cipher.doFinal(encrypted,12,encrypted.length-12),StandardCharsets.UTF_8);
        JSONObject input=new JSONObject().put("model",card.getString("model")).put("stream",false);JSONArray message=new JSONArray().put(new JSONObject().put("role","user").put("content","请只回复：连接正常"));input.put(protocol.equals("responses")?"input":"messages",message).put(protocol.equals("responses")?"max_output_tokens":"max_tokens",600);
        String target=protocol.equals("models")?ModelCatalog.models(card.getString("apiUrl")):ModelCatalog.completion(card.getString("apiUrl"),protocol);
        JSONObject request=new JSONObject().put("url",target).put("method",protocol.equals("models")?"GET":"POST").put("headers",new JSONObject().put("Authorization","Bearer "+card.getString("apiKey")).put("Content-Type","application/json")).put("body",protocol.equals("models")?"":input.toString()).put("timeoutMs",30000);
        HttpURLConnection c=(HttpURLConnection)new URL("http://127.0.0.1:13481/fetch").openConnection();long start=System.currentTimeMillis();JSONObject result=new JSONObject().put("phase","installed-bridge-relay-test").put("protocol",protocol).put("model",card.optString("model"));
        try{c.setConnectTimeout(2000);c.setReadTimeout(35000);c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");c.setRequestProperty("Authorization","Bearer "+token);try(OutputStream out=c.getOutputStream()){out.write(request.toString().getBytes(StandardCharsets.UTF_8));}
            int local=c.getResponseCode();byte[] bytes;try(InputStream in=local<400?c.getInputStream():c.getErrorStream()){bytes=CharacterCard.read(in,3*1024*1024);}JSONObject response=new JSONObject(new String(bytes,StandardCharsets.UTF_8));result.put("bridgeHttp",local);
            if(local==200){result.put("upstreamHttp",response.optInt("status"));String raw=new String(android.util.Base64.decode(response.optString("body"),android.util.Base64.NO_WRAP),StandardCharsets.UTF_8);try{JSONObject data=new JSONObject(raw);JSONArray choices=data.optJSONArray("choices");JSONObject first=choices==null?null:choices.optJSONObject(0),m=first==null?null:first.optJSONObject("message");String error=String.valueOf(data.opt("error"));result.put("hasChatText",m!=null&&!m.optString("content").isEmpty()).put("hasResponsesOutput",data.optJSONArray("output")!=null).put("hasModels",data.optJSONArray("data")!=null).put("finishReason",first==null?"":first.optString("finish_reason")).put("errorCategory",error.matches("(?is).*responses.*")?"responses-related":error.matches("(?is).*max_(?:completion_)?tokens.*")?"token-parameter":error.matches("(?is).*quota|.*balance|.*credit.*")?"quota":data.has("error")?"upstream-error":"none");}catch(Exception ignored){result.put("json",false).put("eventStream",raw.startsWith("data:"));}}
            else result.put("networkCategory",response.optString("error"));
        }catch(Exception e){result.put("errorType",e.getClass().getSimpleName());}finally{c.disconnect();}
        result.put("elapsedMs",System.currentTimeMillis()-start);System.out.println(result.toString());
    }
}
