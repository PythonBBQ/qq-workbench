package cn.qqworkbench.assistant;
import java.io.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermission;
import java.util.*;

/** The pinned Python archive carries a 0644 executable and no python3 alias. */
final class PythonBootstrap {
    static void ensure(File root)throws IOException{
        Path canonical=root.getCanonicalFile().toPath();
        Path executable=canonical.resolve("usr/bin/python3.12");
        Path command=canonical.resolve("usr/bin/python3");
        // Installed Ubuntu packages may already provide a valid version; leave it alone.
        if(Files.isRegularFile(command)&&Files.isExecutable(command)&&Files.size(command)>0)return;
        if(!Files.isRegularFile(executable)||Files.size(executable)==0||!Files.isRegularFile(canonical.resolve("usr/lib/python3.12/encodings/__init__.py")))throw new IOException("离线Python环境不完整，缺少程序或标准库");
        if(!executable.toRealPath().startsWith(canonical)||!command.getParent().toRealPath().startsWith(canonical))throw new IOException("Python路径超出容器目录");
        try{Set<PosixFilePermission> mode=Files.getPosixFilePermissions(executable);mode.add(PosixFilePermission.OWNER_EXECUTE);mode.add(PosixFilePermission.GROUP_EXECUTE);mode.add(PosixFilePermission.OTHERS_EXECUTE);Files.setPosixFilePermissions(executable,mode);}
        catch(UnsupportedOperationException e){if(!executable.toFile().setExecutable(true,false))throw new IOException("无法设置Python执行权限");}
        if(Files.exists(command,LinkOption.NOFOLLOW_LINKS)){
            if(!Files.isSymbolicLink(command)&&!Files.isSameFile(command,executable))throw new IOException("现有Python入口不可用，未覆盖用户文件");
            Files.delete(command);
        }
        try{Files.createSymbolicLink(command,Paths.get("python3.12"));}
        catch(UnsupportedOperationException|IOException e){Files.copy(executable,command,StandardCopyOption.COPY_ATTRIBUTES);if(!command.toFile().setExecutable(true,false))throw new IOException("无法设置Python入口执行权限",e);}
        if(!Files.isRegularFile(command)||!Files.isExecutable(command))throw new IOException("Python入口恢复后仍不可执行");
    }
}
