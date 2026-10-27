package cn.qqworkbench.assistant;

import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import java.security.SecureRandom;

final class Secrets {
    private final Context c;
    Secrets(Context c){this.c=c;}
    private javax.crypto.SecretKey key()throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if(!ks.containsAlias("qq-workbench-v1")){
            KeyGenerator generator=KeyGenerator.getInstance("AES","AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("qq-workbench-v1",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());generator.generateKey();
        }return (javax.crypto.SecretKey)ks.getKey("qq-workbench-v1",null);
    }
    synchronized String get(String name)throws Exception {
        String saved=c.getSharedPreferences("vault",0).getString(name,"");if(saved.isEmpty())return "";
        byte[] all=Base64.decode(saved,Base64.NO_WRAP);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,all,0,12));
        return new String(cipher.doFinal(all,12,all.length-12),java.nio.charset.StandardCharsets.UTF_8);
    }
    synchronized void put(String name,String value)throws Exception{
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());byte[] encrypted=cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)),iv=cipher.getIV(),all=new byte[iv.length+encrypted.length];System.arraycopy(iv,0,all,0,iv.length);System.arraycopy(encrypted,0,all,iv.length,encrypted.length);
        if(!c.getSharedPreferences("vault",0).edit().putString(name,Base64.encodeToString(all,Base64.NO_WRAP)).commit())throw new java.io.IOException("密钥保存失败");
    }
    synchronized String ensure(String name)throws Exception{String value=get(name);if(value.isEmpty()){byte[] b=new byte[32];new SecureRandom().nextBytes(b);value="Qq7!"+Base64.encodeToString(b,Base64.NO_WRAP|Base64.URL_SAFE);put(name,value);}return value;}
}
