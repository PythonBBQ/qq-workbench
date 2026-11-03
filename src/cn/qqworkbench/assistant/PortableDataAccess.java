package cn.qqworkbench.assistant;

import android.content.Context;
import android.os.SystemClock;
import java.io.*;
import java.nio.channels.*;

/** Cross-process boundary between speech reference writers and migration. */
final class PortableDataAccess implements AutoCloseable {
    private final RandomAccessFile file;
    private final FileLock lock;
    private PortableDataAccess(RandomAccessFile file,FileLock lock){this.file=file;this.lock=lock;}
    static PortableDataAccess acquire(Context c,boolean shared,long timeout)throws Exception{
        RandomAccessFile file=new RandomAccessFile(new File(c.getFilesDir(),"portable-data.lock"),"rw");boolean acquired=false;
        try{
            long deadline=SystemClock.elapsedRealtime()+timeout;
            do{
                try{FileLock lock=file.getChannel().tryLock(0,Long.MAX_VALUE,shared);if(lock!=null){acquired=true;return new PortableDataAccess(file,lock);}}
                catch(OverlappingFileLockException busy){}
                if(SystemClock.elapsedRealtime()>=deadline)throw new IOException(shared?"备份或导入正在使用声音数据，请稍后再试":"语音仍在处理，请等当前语音完成后重试；原数据未改动");
                Thread.sleep(100);
            }while(true);
        }finally{if(!acquired)file.close();}
    }
    public void close()throws IOException{try{lock.release();}finally{file.close();}}
}
