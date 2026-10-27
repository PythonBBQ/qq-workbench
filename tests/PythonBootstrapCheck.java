package cn.qqworkbench.assistant;
import java.io.*;import java.nio.file.*;import java.nio.file.attribute.PosixFilePermissions;
public final class PythonBootstrapCheck {
    public static void main(String[] args)throws Exception{
        if(args.length==1&&args[0].equals("--repair-app")){PythonBootstrap.ensure(new File("/data/user/0/cn.qqworkbench.assistant/files/linux/rootfs"));System.out.println("QQWB_PYTHON_BOOTSTRAP_REPAIRED: program executable and entry restored; configuration preserved");return;}
        File root=new File("/data/local/tmp/qqwb-python-bootstrap-"+System.nanoTime());
        Path exe=new File(root,"usr/bin/python3.12").toPath(),enc=new File(root,"usr/lib/python3.12/encodings/__init__.py").toPath();Files.createDirectories(exe.getParent());Files.createDirectories(enc.getParent());Files.write(exe,new byte[]{1});Files.write(enc,new byte[]{1});Files.setPosixFilePermissions(exe,PosixFilePermissions.fromString("rw-r--r--"));
        PythonBootstrap.ensure(root);Path command=exe.getParent().resolve("python3");check(Files.isExecutable(exe)&&Files.isExecutable(command));check(Files.readSymbolicLink(command).toString().equals("python3.12"));PythonBootstrap.ensure(root);
        Files.delete(command);Files.createSymbolicLink(command,Paths.get("missing-python"));PythonBootstrap.ensure(root);check(Files.isExecutable(command));
        Files.delete(command);Files.write(command,new byte[]{7});Files.setPosixFilePermissions(command,PosixFilePermissions.fromString("rw-r--r--"));try{PythonBootstrap.ensure(root);throw new AssertionError("must preserve existing file");}catch(IOException expected){}check(Files.readAllBytes(command)[0]==7);
        Files.delete(command);Files.delete(exe);try{PythonBootstrap.ensure(root);throw new AssertionError("missing archive rejected");}catch(IOException expected){}
        try(java.util.stream.Stream<Path> paths=Files.walk(root.toPath())){for(Path p:paths.sorted(java.util.Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList()))Files.delete(p);}
        System.out.println("QQWB_PYTHON_BOOTSTRAP_OK: executable mode, relative command link, idempotence, dangling link repair, preserve custom file, incomplete archive rejection");
    }
    static void check(boolean ok){if(!ok)throw new AssertionError();}
}
