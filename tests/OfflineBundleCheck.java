package cn.qqworkbench.assistant;
import java.io.*;
import java.nio.file.*;
import java.util.zip.*;

/** Scratch rootfs only: never copy the installed app's rootfs, accounts or secrets. */
public final class OfflineBundleCheck {
    public static void main(String[] args)throws Exception{
        File dest=new File(args[1]).getCanonicalFile();
        if(!dest.getPath().endsWith("/files/linux/offline-env-test-0.1.45/rootfs"))throw new IOException("Unexpected scratch root");
        if(args.length>3&&args[3].equals("bootstrap")){PythonBootstrap.ensure(dest);System.out.println("QQWB_SCRATCH_PYTHON_READY");return;}
        if(dest.exists())throw new IOException("Scratch root already exists");
        dest.mkdirs();
        try(ZipFile apk=new ZipFile(args[0])){
            for(String asset:new String[]{"offline-rootfs.bin","glibc-python.bin","python-support.bin"})try(InputStream in=apk.getInputStream(apk.getEntry("assets/"+asset))){TrustedTar.extract(in,dest);}
            PythonBootstrap.ensure(dest);
            File snow=new File(dest,"opt/snowluma");snow.mkdirs();
            try(InputStream in=apk.getInputStream(apk.getEntry("assets/snowluma.tar.gz"))){TrustedTar.extract(in,snow);}
            File work=new File(dest,"opt/qq-workbench");work.mkdirs();
            try(InputStream in=apk.getInputStream(apk.getEntry("assets/linuxqq.deb"))){Files.copy(in,new File(work,"linuxqq.deb").toPath());}
        }
        File bundle=new File(dest,"opt/qq-workbench/qq-environment");bundle.mkdirs();
        try(InputStream in=new FileInputStream(args[2])){TrustedTar.extract(in,bundle);}
        System.out.println("QQWB_SCRATCH_EXTRACTED");
    }
}
