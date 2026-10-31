package cn.qqworkbench.assistant;

import java.io.*;
import java.nio.file.*;
import java.util.*;

/** Copy missing files from a trusted staged Python archive, preserving existing installs. */
final class BundledPythonRepair {
    static boolean needed(File root){for(String name:new String[]{"usr/bin/python3.12","usr/lib/python3.12/encodings/__init__.py","usr/lib/python3.12/json/__init__.py","usr/lib/python3.12/ssl.py","usr/lib/aarch64-linux-gnu/libsqlite3.so.0","usr/lib/aarch64-linux-gnu/libreadline.so.8"})if(!new File(root,name).isFile()||new File(root,name).length()==0)return true;return false;}
    static void mergeMissing(File root,File stage)throws IOException{
        Path base=root.getCanonicalFile().toPath(),source=stage.getCanonicalFile().toPath();
        try(java.util.stream.Stream<Path> stream=Files.walk(source)){
            for(Path item:(Iterable<Path>)stream::iterator){if(item.equals(source))continue;if(Files.isSymbolicLink(item))throw new IOException("内置Python归档包含异常链接");
                Path target=base.resolve(source.relativize(item)).normalize();if(!target.startsWith(base)||!target.getParent().toFile().getCanonicalFile().toPath().startsWith(base))throw new IOException("Python恢复路径超出容器");
                if(Files.isDirectory(item)){if(Files.exists(target)&&!Files.isDirectory(target))throw new IOException("Python恢复目录被占用");Files.createDirectories(target);}
                else if(!Files.exists(target,LinkOption.NOFOLLOW_LINKS)){Files.copy(item,target);}
                else if(Files.isRegularFile(target,LinkOption.NOFOLLOW_LINKS)&&Files.size(target)==0){Files.copy(item,target,StandardCopyOption.REPLACE_EXISTING);}
            }
        }
        PythonBootstrap.ensure(root);
    }
}
