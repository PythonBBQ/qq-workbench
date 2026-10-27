package cn.qqworkbench.assistant;
import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;

/** Grants the system installer read access to exactly the verified cached APK. */
public final class UpdateFileProvider extends ContentProvider {
    public boolean onCreate(){return true;}
    private File target(Uri u)throws FileNotFoundException{if(!u.getPath().equals("/apk/latest")||u.getQuery()!=null)throw new FileNotFoundException();return AppUpdates.file(getContext());}
    public String getType(Uri u){return "application/vnd.android.package-archive";}
    public ParcelFileDescriptor openFile(Uri u,String mode)throws FileNotFoundException{if(!mode.equals("r"))throw new FileNotFoundException();return ParcelFileDescriptor.open(target(u),ParcelFileDescriptor.MODE_READ_ONLY);}
    public Cursor query(Uri u,String[] projection,String selection,String[] args,String sort){try{File file=target(u);String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;MatrixCursor result=new MatrixCursor(columns);Object[] values=new Object[columns.length];for(int i=0;i<columns.length;i++)values[i]=OpenableColumns.DISPLAY_NAME.equals(columns[i])?"QQWorkbench-update.apk":OpenableColumns.SIZE.equals(columns[i])?file.length():null;result.addRow(values);return result;}catch(Exception e){return null;}}
    public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
    public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
}
