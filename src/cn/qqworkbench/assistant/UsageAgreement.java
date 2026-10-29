package cn.qqworkbench.assistant;
import android.content.Context;
import java.io.*;
import java.security.MessageDigest;

/** Local explicit consent; content changes require a new user decision. */
final class UsageAgreement {
    static final String PREFS="usage-agreement";
    static String read(Context context)throws Exception{
        try(InputStream in=context.getAssets().open("usage-notice.txt")){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[2048];int n;while((n=in.read(b))!=-1){if(out.size()+n>32768)throw new IOException("声明文件过大");out.write(b,0,n);}String text=new String(out.toByteArray(),java.nio.charset.StandardCharsets.UTF_8);if(text.trim().isEmpty())throw new IOException("声明内容为空");return text;}
    }
    static String digest(String text)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)))s.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return s.toString();}
    static boolean accepted(Context context){try{return digest(read(context)).equals(context.getSharedPreferences(PREFS,0).getString("acceptedDigest",""))&&context.getSharedPreferences(PREFS,0).getLong("acceptedAt",0)>0;}catch(Exception e){return false;}}
    static boolean accept(Context context,String shown)throws Exception{
        String current=read(context);if(!current.equals(shown))return false;
        return context.getSharedPreferences(PREFS,0).edit().putString("acceptedDigest",digest(current)).putLong("acceptedAt",System.currentTimeMillis()).commit()&&accepted(context);
    }
}
