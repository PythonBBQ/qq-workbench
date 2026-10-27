package cn.qqworkbench.assistant;

import org.json.*;
import android.util.Base64;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.CRC32;

/** Reads basic V1/V2/V3 fields and bounded keyword entries; no extensions execute. */
final class CharacterCard {
    static final class Profile{final String name,persona,worldBook;Profile(String n,String p,String w){name=n;persona=p;worldBook=w;}}
    static byte[] read(InputStream in,int limit)throws IOException{
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[16384];int n;
        while((n=in.read(b))!=-1){if(out.size()+n>limit)throw new IOException("角色卡文件过大");out.write(b,0,n);}return out.toByteArray();
    }
    static Profile parse(byte[] bytes)throws Exception{
        if(bytes.length>20*1024*1024)throw new IOException("角色卡文件过大");
        byte[] signature={(byte)137,80,78,71,13,10,26,10};
        if(bytes.length>=8&&Arrays.equals(Arrays.copyOf(bytes,8),signature)){
            try(DataInputStream in=new DataInputStream(new ByteArrayInputStream(bytes,8,bytes.length-8))){
                while(in.available()>0){
                    int len=in.readInt();if(len<0||len>in.available()-8)throw new IOException("PNG 角色卡已损坏");
                    byte[] type=new byte[4];in.readFully(type);byte[] data=new byte[len];in.readFully(data);long expected=Integer.toUnsignedLong(in.readInt());
                    CRC32 crc=new CRC32();crc.update(type);crc.update(data);if(crc.getValue()!=expected)throw new IOException("PNG 校验失败");
                    if(new String(type,StandardCharsets.US_ASCII).equals("tEXt")&&len>6&&data[5]==0&&new String(data,0,5,StandardCharsets.US_ASCII).equals("chara")){
                        if(len>768*1024)throw new IOException("角色卡描述过大");return json(Base64.decode(Arrays.copyOfRange(data,6,data.length),Base64.DEFAULT));
                    }
                    if(new String(type,StandardCharsets.US_ASCII).equals("tEXt")&&len>5&&data[4]==0&&new String(data,0,4,StandardCharsets.US_ASCII).equals("ccv3")){
                        if(len>768*1024)throw new IOException("角色卡描述过大");return json(Base64.decode(Arrays.copyOfRange(data,5,data.length),Base64.DEFAULT));
                    }
                    if(new String(type,StandardCharsets.US_ASCII).equals("IEND"))break;
                }
            }
            throw new IOException("此图片没有酒馆 chara 角色卡数据，请选择 JSON 角色卡");
        }
        return json(bytes);
    }
    static Profile json(byte[] bytes)throws Exception{
        if(bytes.length>512*1024)throw new IOException("JSON 角色卡描述过大");
        String text=new String(bytes,StandardCharsets.UTF_8);if(text.startsWith("\uFEFF"))text=text.substring(1);
        JSONObject root=new JSONObject(text),data=root;
        if(root.has("spec")){if(!root.optString("spec").equals("chara_card_v2")&&!root.optString("spec").equals("chara_card_v3"))throw new IOException("目前支持 V1 / V2 / V3 基础角色字段");data=root.getJSONObject("data");}
        String name=data.optString("name","").trim();if(name.isEmpty())throw new IOException("角色卡缺少名称");
        StringBuilder persona=new StringBuilder();
        for(String key:new String[]{"description","personality","scenario","mes_example"}){
            Object value=data.opt(key);if(!(value instanceof String))continue;
            String part=((String)value).trim().replace("{{char}}",name).replace("{{user}}","用户");
            if(!part.isEmpty())persona.append(part).append('\n');
        }
        if(persona.length()==0)throw new IOException("角色卡没有可导入的性格或描述");
        StringBuilder world=new StringBuilder();JSONObject book=data.optJSONObject("character_book");JSONArray entries=book==null?null:book.optJSONArray("entries");
        if(entries!=null)for(int i=0;i<Math.min(entries.length(),80);i++){
            JSONObject e=entries.optJSONObject(i);if(e==null||!e.optBoolean("enabled",true))continue;
            JSONArray keys=e.optJSONArray("keys");String content=e.optString("content","").replace("{{char}}",name).replace("{{user}}","用户").replace('\n',' ').replace('\r',' ').trim();
            if(keys==null||content.isEmpty())continue;StringBuilder terms=new StringBuilder();
            for(int j=0;j<Math.min(keys.length(),8);j++){String k=keys.optString(j,"").replace('|',' ').replace('\n',' ').replace(',',' ').trim();if(k.isEmpty())continue;if(terms.length()>0)terms.append(',');terms.append(k.substring(0,Math.min(40,k.length())));}
            if(terms.length()==0)continue;String line=terms+" | "+content.substring(0,Math.min(500,content.length()));if(world.length()+line.length()>12000)break;world.append(line).append('\n');
        }
        return new Profile(name.substring(0,Math.min(60,name.length())),persona.substring(0,Math.min(4000,persona.length())).trim(),world.toString().trim());
    }
}
