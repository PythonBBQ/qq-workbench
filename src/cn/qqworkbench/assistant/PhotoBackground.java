package cn.qqworkbench.assistant;

import android.content.Context;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.file.*;

/** Imports a bounded, orientation-correct copy; never needs broad photo access. */
final class PhotoBackground extends Drawable {
    final Bitmap bitmap;
    final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
    final Paint veil=new Paint();
    int baseColor=Color.WHITE;
    PhotoBackground(Bitmap bitmap,int shade){this.bitmap=bitmap;veil.setColor(Color.argb(shade,255,255,255));}
    PhotoBackground(Bitmap bitmap,int opacity,int color){this.bitmap=bitmap;baseColor=color;paint.setAlpha(Math.max(0,Math.min(255,opacity)));veil.setColor(Color.TRANSPARENT);}
    static File sourceFile(Context c){return new File(c.getFilesDir(),"theme-background-source.jpg");}
    static File draftFile(Context c){return new File(c.getFilesDir(),"theme-background-draft.jpg");}
    static Bitmap loadSource(Context c){Bitmap b=BitmapFactory.decodeFile(sourceFile(c).getAbsolutePath());return b!=null?b:load(c);}
    static void saveBitmap(File file,Bitmap bitmap)throws IOException{
        File stage=new File(file.getParentFile(),file.getName()+".tmp");
        try{try(OutputStream out=new FileOutputStream(stage)){if(!bitmap.compress(Bitmap.CompressFormat.JPEG,92,out))throw new IOException("图片保存失败");}Files.move(stage.toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}
        finally{Files.deleteIfExists(stage.toPath());}
    }
    static Bitmap readPhoto(Context c,Uri uri)throws Exception{
        ByteArrayOutputStream data=new ByteArrayOutputStream();try(InputStream in=c.getContentResolver().openInputStream(uri)){
            if(in==null)throw new IOException("无法读取图片");byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){if(data.size()+n>20*1024*1024)throw new IOException("请选择小于 20MB 的图片");data.write(b,0,n);}}
        return decodePhoto(data.toByteArray());
    }
    static Bitmap cropped(Bitmap source,RectF region){
        int w=Math.max(1,Math.round(region.width())),h=Math.max(1,Math.round(region.height()));float ratio=Math.min(1,2048f/Math.max(w,h));
        Bitmap result=Bitmap.createBitmap(Math.max(1,Math.round(w*ratio)),Math.max(1,Math.round(h*ratio)),Bitmap.Config.ARGB_8888);
        Canvas c=new Canvas(result);Paint p=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
        c.save();c.scale(result.getWidth()/region.width(),result.getHeight()/region.height());c.translate(-region.left,-region.top);c.drawBitmap(source,0,0,p);c.restore();return result;
    }
    static File file(Context c){return new File(c.getFilesDir(),"theme-background.jpg");}
    static Bitmap load(Context c){return BitmapFactory.decodeFile(file(c).getAbsolutePath());}
    static Bitmap importPhoto(Context c,Uri uri)throws Exception{
        ByteArrayOutputStream data=new ByteArrayOutputStream();
        try(InputStream in=c.getContentResolver().openInputStream(uri)){
            if(in==null)throw new IOException("无法读取所选图片");
            byte[] b=new byte[65536];int n;
            while((n=in.read(b))!=-1){if(data.size()+n>20*1024*1024)throw new IOException("请选择小于 20MB 的图片");data.write(b,0,n);}
        }
        Bitmap result=decodePhoto(data.toByteArray());
        File stage=new File(c.getFilesDir(),"theme-background.tmp");
        try{
            try(OutputStream out=new FileOutputStream(stage)){if(!result.compress(Bitmap.CompressFormat.JPEG,90,out))throw new IOException("图片保存失败");}
            Files.move(stage.toPath(),file(c).toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
            return result;
        }catch(Exception e){result.recycle();throw e;}
        finally{Files.deleteIfExists(stage.toPath());}
    }
    static Bitmap decodePhoto(byte[] data)throws IOException{
        if(data.length>20*1024*1024)throw new IOException("请选择小于 20MB 的图片");
        return ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(data)),(decoder,info,source)->{
            int w=info.getSize().getWidth(),h=info.getSize().getHeight();
            float scale=Math.min(1f,2048f/Math.max(w,h));
            decoder.setTargetSize(Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale)));
            decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
        });
    }
    public void draw(Canvas canvas){
        canvas.drawColor(baseColor);
        Rect b=getBounds();float scale=Math.max((float)b.width()/bitmap.getWidth(),(float)b.height()/bitmap.getHeight());
        float w=bitmap.getWidth()*scale,h=bitmap.getHeight()*scale;
        canvas.drawBitmap(bitmap,null,new RectF(b.centerX()-w/2,b.centerY()-h/2,b.centerX()+w/2,b.centerY()+h/2),paint);
        canvas.drawRect(b,veil);
    }
    public void setAlpha(int alpha){paint.setAlpha(alpha);invalidateSelf();}
    public void setColorFilter(ColorFilter filter){paint.setColorFilter(filter);invalidateSelf();}
    public int getOpacity(){return PixelFormat.OPAQUE;}
}
