package cn.qqworkbench.assistant;
import java.io.*;
import java.nio.file.*;
public class TrustedTarCheck {
    public static void main(String[] args)throws Exception {
        File fixtures=new File(args[0]);int count=0;
        for(String name:new String[]{"valid.tar.gz","pax.tar","traversal.tar","absolute.tar","link-escape.tar","bad-checksum.tar","truncated.tar"}){
            File out=new File(fixtures,"out-"+name.replace('.','-'));out.mkdirs();boolean failed=false;
            try(InputStream in=new FileInputStream(new File(fixtures,name))){TrustedTar.extract(in,out);}catch(IOException e){failed=true;}
            boolean expected=!name.equals("valid.tar.gz")&&!name.equals("pax.tar");
            if(failed!=expected)throw new AssertionError(name+" rejection="+failed);
            if(name.equals("valid.tar.gz")&&!Files.readString(new File(out,"usr/bin/example").toPath()).equals("hello"))throw new AssertionError("Content mismatch");
            if(name.equals("pax.tar")&&!Files.readString(new File(out,"long/"+"a".repeat(140)).toPath()).equals("pax"))throw new AssertionError("PAX mismatch");
            count++;System.out.println("PASS "+name);
        }
        System.out.println(count+" archive checks passed");
    }
}
