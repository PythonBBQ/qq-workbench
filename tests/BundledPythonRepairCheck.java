package cn.qqworkbench.assistant;
import java.nio.file.*;
public final class BundledPythonRepairCheck {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception{
        Path temp=Files.createTempDirectory("qqwb-python-repair-");
        try{
            Path root=temp.resolve("root"),stage=temp.resolve("stage");Files.createDirectories(root);Files.createDirectories(stage);
            for(String p:new String[]{"usr/bin/python3.12","usr/lib/python3.12/encodings/__init__.py","usr/lib/python3.12/json/__init__.py","usr/lib/python3.12/ssl.py","usr/lib/aarch64-linux-gnu/libsqlite3.so.0","usr/lib/aarch64-linux-gnu/libreadline.so.8"}){Path f=stage.resolve(p);Files.createDirectories(f.getParent());Files.write(f,"#!/bin/bash\nexit 0\n".getBytes("UTF-8"));}
            check(BundledPythonRepair.needed(root.toFile()),"missing detected");
            Path custom=root.resolve("usr/lib/python3.12/ssl.py");Files.createDirectories(custom.getParent());Files.write(custom,"preserved-package-file".getBytes("UTF-8"));Path settings=root.resolve("settings.json");Files.write(settings,"private-config".getBytes("UTF-8"));
            BundledPythonRepair.mergeMissing(root.toFile(),stage.toFile());check(!BundledPythonRepair.needed(root.toFile()),"missing restored");check(new String(Files.readAllBytes(custom),"UTF-8").equals("preserved-package-file"),"existing python preserved");check(new String(Files.readAllBytes(settings),"UTF-8").equals("private-config"),"settings preserved");
            Path lib=root.resolve("usr/lib/aarch64-linux-gnu/libsqlite3.so.0");Files.write(lib,new byte[0]);check(BundledPythonRepair.needed(root.toFile()),"empty detected");BundledPythonRepair.mergeMissing(root.toFile(),stage.toFile());check(Files.size(lib)>0,"empty restored");
            System.out.println("QQWB_BUNDLED_PYTHON_REPAIR_OK: missing and empty files restored, existing package files and private config preserved");
        }finally{try(java.util.stream.Stream<Path> paths=Files.walk(temp)){for(Path p:paths.sorted(java.util.Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList()))Files.delete(p);}}
    }
}
