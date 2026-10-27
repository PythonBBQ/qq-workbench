package cn.qqworkbench.assistant;
import android.graphics.*;
import java.io.*;

public final class PhotoBackgroundCheck {
    static void check(boolean ok){if(!ok)throw new AssertionError();}
    public static void main(String[] args)throws Exception{
        Bitmap source=Bitmap.createBitmap(4096,1024,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(source);canvas.drawColor(Color.RED);Paint p=new Paint();p.setColor(Color.BLUE);canvas.drawRect(2048,0,4096,1024,p);
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();source.compress(Bitmap.CompressFormat.PNG,100,bytes);source.recycle();
        Bitmap decoded=PhotoBackground.decodePhoto(bytes.toByteArray());check(decoded.getWidth()==2048&&decoded.getHeight()==512);
        Bitmap view=Bitmap.createBitmap(100,100,Bitmap.Config.ARGB_8888);Canvas out=new Canvas(view);PhotoBackground bg=new PhotoBackground(decoded,0);bg.setBounds(0,0,100,100);bg.draw(out);check(Color.red(view.getPixel(25,50))>240);check(Color.blue(view.getPixel(75,50))>240);
        bg=new PhotoBackground(decoded,210);bg.setBounds(0,0,100,100);bg.draw(out);check(Color.blue(view.getPixel(25,50))>=209);check(Color.red(view.getPixel(75,50))>=209);
        try{PhotoBackground.decodePhoto(new byte[]{1,2,3});throw new AssertionError();}catch(IOException expected){}
        try{PhotoBackground.decodePhoto(new byte[20*1024*1024+1]);throw new AssertionError();}catch(IOException expected){}
        decoded.recycle();view.recycle();System.out.println("QQWB_PHOTO_OK: real Android decode, bounded resolution, centered crop, readability veil, invalid/oversized rejection");
    }
}
