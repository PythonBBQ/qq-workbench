package cn.qqworkbench.assistant;
import java.io.*;
import org.json.*;
public final class ApkPatchCheck {
    public static void main(String[] args)throws Exception{
        File root=new File(args[0]),base=new File(root,"base.apk"),out=new File(root,"rebuilt.apk");
        final long[] previous={-1},size={0};final int[] calls={0};
        ApkPatch.apply(base,new File(root,"valid.qqpatch"),out,"v1.0.1",new ResumableDownload.Progress(){public boolean cancelled(){return false;}public void update(String phase,long n,long total){if(!phase.equals("reconstructing"))return;if(n<previous[0]||n>total||total<=0)throw new AssertionError("Nonmonotonic reconstruction progress");previous[0]=n;size[0]=total;calls[0]++;}});
        if(calls[0]<2||previous[0]!=size[0])throw new AssertionError("Missing reconstruction completion progress");
        if(!ApkPatch.sha(out).equals(ApkPatch.sha(new File(root,"target.apk"))))throw new AssertionError("Exact reconstruction failed");out.delete();final boolean[] cancel={false};boolean cancelled=false;
        try{ApkPatch.apply(base,new File(root,"valid.qqpatch"),out,"v1.0.1",new ResumableDownload.Progress(){public boolean cancelled(){return cancel[0];}public void update(String phase,long n,long total){if(phase.equals("reconstructing")&&n>0)cancel[0]=true;}});}catch(InterruptedIOException expected){cancelled=true;}if(!cancelled||out.exists())throw new AssertionError("Cancelled reconstruction left an output");int rejected=0;
        for(File f:root.listFiles())if(f.getName().endsWith(".qqpatch")&&!f.getName().equals("valid.qqpatch")){
            boolean failed=false;try{ApkPatch.apply(base,f,out,"v1.0.1");}catch(Exception e){failed=true;rejected++;}if(!failed||out.exists())throw new AssertionError("Unsafe patch accepted or output left: "+f.getName());
        }
        if(rejected!=8)throw new AssertionError("Missing negative fixtures");
        if(args.length>2){File installed=new File(args[1]),delta=new File(args[2]),rebuilt=new File(args[3]);ApkPatch.apply(installed,delta,rebuilt,"v1.0.0");System.out.println("QQWB_REAL_APK_RECONSTRUCTED "+ApkPatch.sha(rebuilt));}
        System.out.println("QQWB_APK_PATCH_OK: exact reconstruction, 8 invalid patches rejected and cleaned up");
    }
}
