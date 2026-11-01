package cn.qqworkbench.assistant;

import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.io.IOException;

final class Secrets {
    // All callers share the same Keystore and preferences, including UI/health workers.
    private static final Object LOCK=new Object();
    private static final String ALIAS="qq-workbench-v1";
    private final Context c;
    Secrets(Context c){this.c=c;}
    private javax.crypto.SecretKey key(boolean create)throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if(!ks.containsAlias(ALIAS)){
            if(!create)return null;
            KeyGenerator generator=KeyGenerator.getInstance("AES","AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();
        }return (javax.crypto.SecretKey)ks.getKey(ALIAS,null);
    }
    private String read(String name)throws Exception {
        String saved=c.getSharedPreferences("vault",0).getString(name,"");if(saved.isEmpty())return "";
        try{
            byte[] all=Base64.decode(saved,Base64.NO_WRAP);if(all.length<28)throw new IllegalArgumentException();
            javax.crypto.SecretKey secret=key(false);
            if(secret==null){unavailable(name,"系统密钥已不存在");return "";}
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,secret,new GCMParameterSpec(128,all,0,12));
            String value=new String(cipher.doFinal(all,12,all.length-12),java.nio.charset.StandardCharsets.UTF_8);
            c.getSharedPreferences("vault-health",0).edit().remove(name).apply();return value;
        }catch(AEADBadTagException e){unavailable(name,"加密校验不匹配");return "";}
        catch(IllegalArgumentException e){unavailable(name,"加密记录不完整");return "";}
        catch(android.security.keystore.KeyPermanentlyInvalidatedException|java.security.UnrecoverableKeyException e){unavailable(name,"系统密钥已失效");return "";}
    }
    private void unavailable(String name,String reason)throws IOException{
        if(!c.getSharedPreferences("vault-health",0).edit().putString(name,reason).commit())throw new IOException("无法记录加密配置异常；原记录保留");
    }
    String get(String name)throws Exception{synchronized(LOCK){return read(name);}}
    boolean unavailable(String name){synchronized(LOCK){return c.getSharedPreferences("vault-health",0).contains(name);}}
    void put(String name,String value)throws Exception{synchronized(LOCK){
        android.content.SharedPreferences stored=c.getSharedPreferences("vault",0);
        String old=stored.getString(name,"");
        if(!old.isEmpty()){
            read(name);
            if(unavailable(name)){
                // Preserve the exact ciphertext before replacing this single failed entry.
                String id=name+"-"+hex(java.security.MessageDigest.getInstance("SHA-256").digest(old.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                if(!c.getSharedPreferences("vault-recovery",0).edit().putString(id,old).commit())throw new IOException("无法保存原加密记录，未替换配置");
            }
        }
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key(true));byte[] encrypted=cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)),iv=cipher.getIV(),all=new byte[iv.length+encrypted.length];System.arraycopy(iv,0,all,0,iv.length);System.arraycopy(encrypted,0,all,iv.length,encrypted.length);
        if(!stored.edit().putString(name,Base64.encodeToString(all,Base64.NO_WRAP)).commit())throw new IOException("密钥保存失败");
        c.getSharedPreferences("vault-health",0).edit().remove(name).commit();
    }}
    String ensure(String name)throws Exception{synchronized(LOCK){
        if(!java.util.Arrays.asList("internal","vnc","conversation-memory").contains(name))throw new IOException("不能自动生成此项凭据");
        String value=read(name);if(value.isEmpty()){byte[] b=new byte[32];new SecureRandom().nextBytes(b);value="Qq7!"+Base64.encodeToString(b,Base64.NO_WRAP|Base64.URL_SAFE);put(name,value);}return value;
    }}
    private static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return s.toString();}
    static String label(String name){switch(name){case "internal":return "本机接口凭据";case "vnc":return "QQ窗口凭据";case "conversation-memory":return "对话与语音记忆密钥";case "active-api":return "当前模型配置";case "api-profiles":return "模型卡片";case "qq-instances":return "多账号配置";case "deepseek":return "聊天API Key";case "vision":return "视觉API Key";case "speech":case "feiyu":return "语音API Key";case "site-cookies":return "网站登录资料";default:return "加密配置";}}
    static String report(Context context){synchronized(LOCK){
        java.util.Map<String,?> problems=context.getSharedPreferences("vault-health",0).getAll();
        StringBuilder s=new StringBuilder();for(String name:new java.util.TreeSet<>(problems.keySet()))s.append(label(name)).append("：暂不可用，请重新填写或登录；原加密记录保留。\n");
        if(!context.getSharedPreferences("vault-recovery",0).getAll().isEmpty())s.append("已隔离旧的失效密文；未清空QQ账号或聊天。旧记忆若无法解密会保留原文件并暂停持久化。\n");
        return s.toString().trim();
    }}
}
