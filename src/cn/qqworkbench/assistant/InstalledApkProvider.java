package cn.qqworkbench.assistant;

import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;

/** Shares only this process's installed APK, never a stale download or user data. */
public final class InstalledApkProvider extends ContentProvider {
    public boolean onCreate(){return true;}
    private File target(Uri uri)throws FileNotFoundException{
        if(!"/installed.apk".equals(uri.getPath())||uri.getQuery()!=null||uri.getFragment()!=null)throw new FileNotFoundException();
        File file=new File(getContext().getApplicationInfo().sourceDir);if(!file.isFile())throw new FileNotFoundException();return file;
    }
    public String getType(Uri uri){return "application/vnd.android.package-archive";}
    public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{if(!"r".equals(mode))throw new FileNotFoundException();return ParcelFileDescriptor.open(target(uri),ParcelFileDescriptor.MODE_READ_ONLY);}
    public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){try{
        File file=target(uri);String version=getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),0).versionName;
        String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;
        MatrixCursor result=new MatrixCursor(columns);Object[] values=new Object[columns.length];
        for(int i=0;i<columns.length;i++)values[i]=OpenableColumns.DISPLAY_NAME.equals(columns[i])?"QQWorkbench-"+version+".apk":OpenableColumns.SIZE.equals(columns[i])?file.length():null;
        result.addRow(values);return result;
    }catch(Exception e){return null;}}
    public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
    public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
}
