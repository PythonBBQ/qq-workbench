package cn.qqworkbench.assistant;
import java.io.*;
import org.json.*;
public final class ApkPatchCheck {
    public static void main(String[] args)throws Exception{
        File root=new File(args[0]),base=new File(root,"base.apk"),out=new File(root,"rebuilt.apk");
        ApkPatch.apply(base,new File(root,"valid.qqpatch"),out,"v1.0.1");
        if(!ApkPatch.sha(out).equals(ApkPatch.sha(new File(root,"target.apk"))))throw new AssertionError("Exact reconstruction failed");out.delete();int rejected=0;
        for(File f:root.listFiles())if(f.getName().endsWith(".qqpatch")&&!f.getName().equals("valid.qqpatch")){
            boolean failed=false;try{ApkPatch.apply(base,f,out,"v1.0.1");}catch(Exception e){failed=true;rejected++;}if(!failed||out.exists())throw new AssertionError("Unsafe patch accepted or output left: "+f.getName());
        }
        if(rejected!=8)throw new AssertionError("Missing negative fixtures");
        if(args.length>2){File installed=new File(args[1]),delta=new File(args[2]),rebuilt=new File(args[3]);ApkPatch.apply(installed,delta,rebuilt,"v1.0.0");System.out.println("QQWB_REAL_APK_RECONSTRUCTED "+ApkPatch.sha(rebuilt));}
        System.out.println("QQWB_APK_PATCH_OK: exact reconstruction, 8 invalid patches rejected and cleaned up");
    }
}
