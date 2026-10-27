package cn.qqworkbench.assistant;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;
import android.util.Base64;

public final class CharacterCardCheck {
    static void check(boolean ok){if(!ok)throw new AssertionError();}
    static byte[] utf(String text){return text.getBytes(StandardCharsets.UTF_8);}
    static void rejected(byte[] bytes)throws Exception{try{CharacterCard.parse(bytes);}catch(Exception expected){return;}throw new AssertionError("Expected rejection");}
    static byte[] png(String json)throws Exception{
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(bytes);
        out.write(new byte[]{(byte)137,80,78,71,13,10,26,10});byte[] type=utf("tEXt"),data=utf("chara\0"+Base64.encodeToString(utf(json),Base64.NO_WRAP));
        out.writeInt(data.length);out.write(type);out.write(data);CRC32 crc=new CRC32();crc.update(type);crc.update(data);out.writeInt((int)crc.getValue());return bytes.toByteArray();
    }
    public static void main(String[] args)throws Exception{
        String json="{\"spec\":\"chara_card_v2\",\"data\":{\"name\":\"小鲸\",\"description\":\"{{char}}喜欢白饭\",\"personality\":\"温柔\",\"scenario\":\"和{{user}}聊天\",\"first_mes\":\"不要自动发送\",\"system_prompt\":\"FAKE_ADMIN\",\"extensions\":{\"script\":\"MUST_NOT_RUN\"}}}";
        CharacterCard.Profile p=CharacterCard.parse(utf(json));check(p.name.equals("小鲸"));check(p.persona.contains("小鲸喜欢白饭"));check(p.persona.contains("和用户聊天"));check(!p.persona.contains("FAKE_ADMIN"));check(!p.persona.contains("MUST_NOT_RUN"));check(!p.persona.contains("不要自动发送"));
        check(CharacterCard.parse(png(json)).persona.equals(p.persona));
        check(CharacterCard.parse(utf("{\"name\":\"V1\",\"personality\":\"直接\"}")).name.equals("V1"));
        CharacterCard.Profile v3=CharacterCard.parse(utf("{\"spec\":\"chara_card_v3\",\"data\":{\"name\":\"V3\",\"personality\":\"温柔\",\"character_book\":{\"entries\":[{\"keys\":[\"白饭\",\"米饭\"],\"content\":\"{{char}}爱吃白饭\",\"enabled\":true},{\"keys\":[\"秘密\"],\"content\":\"不启用\",\"enabled\":false}]}}}"));
        check(v3.worldBook.contains("白饭,米饭 | V3爱吃白饭"));check(!v3.worldBook.contains("不启用"));
        byte[] corrupt=png(json);corrupt[corrupt.length-1]^=1;rejected(corrupt);
        rejected(utf("{\"name\":\"只有名称\"}"));rejected(utf("{\"spec\":\"unknown\",\"name\":\"a\"}"));rejected(new byte[]{(byte)137,80,78,71,13,10,26,10,127,127,127,127});
        try{CharacterCard.read(new ByteArrayInputStream(new byte[20]),10);throw new AssertionError();}catch(IOException expected){}
        System.out.println("QQWB_CHARACTER_CARD_OK: V1/V2/V3 JSON, PNG, placeholders, keyword world book, ignored executable fields, corrupted/oversized rejection");
    }
}
