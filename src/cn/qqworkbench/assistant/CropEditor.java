package cn.qqworkbench.assistant;

import android.content.Context;
import android.graphics.*;
import android.view.*;

final class CropEditor extends View {
    final Bitmap bitmap;
    final CropGeometry crop=new CropGeometry();
    final RectF viewport=new RectF();
    final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
    final ScaleGestureDetector pinch;
    float ratio,lastX,lastY;boolean moving;
    CropEditor(Context context,Bitmap image,float aspect){super(context);bitmap=image;ratio=aspect;setContentDescription("背景裁剪预览，拖动调整位置，双指缩放");
        pinch=new ScaleGestureDetector(context,new ScaleGestureDetector.SimpleOnScaleGestureListener(){
            public boolean onScale(ScaleGestureDetector detector){
                if(viewport.isEmpty())return false;
                float previous=crop.scale(bitmap.getWidth(),bitmap.getHeight(),viewport);
                crop.zoom=CropGeometry.bound(crop.zoom*detector.getScaleFactor(),1,6);
                float next=crop.scale(bitmap.getWidth(),bitmap.getHeight(),viewport);
                crop.x+=(detector.getFocusX()-viewport.centerX())*(1/previous-1/next)/bitmap.getWidth();
                crop.y+=(detector.getFocusY()-viewport.centerY())*(1/previous-1/next)/bitmap.getHeight();
                crop.clamp(bitmap.getWidth(),bitmap.getHeight(),viewport);invalidate();return true;
            }
        });
    }
    void aspect(float value){ratio=value;requestLayout();invalidate();}
    void reset(){crop.x=crop.y=.5f;crop.zoom=1;invalidate();}
    protected void onDraw(Canvas canvas){super.onDraw(canvas);canvas.drawColor(0xff101b24);
        float inset=16*getResources().getDisplayMetrics().density,w=getWidth()-2*inset,h=getHeight()-2*inset;
        if(w<=0||h<=0)return;float cw=Math.min(w,h*ratio),ch=cw/ratio;
        viewport.set((getWidth()-cw)/2,(getHeight()-ch)/2,(getWidth()+cw)/2,(getHeight()+ch)/2);
        crop.clamp(bitmap.getWidth(),bitmap.getHeight(),viewport);float s=crop.scale(bitmap.getWidth(),bitmap.getHeight(),viewport);
        float left=viewport.centerX()-crop.x*bitmap.getWidth()*s,top=viewport.centerY()-crop.y*bitmap.getHeight()*s;
        canvas.drawBitmap(bitmap,null,new RectF(left,top,left+bitmap.getWidth()*s,top+bitmap.getHeight()*s),paint);
        Paint shade=new Paint();shade.setColor(0xaa000000);
        canvas.drawRect(0,0,getWidth(),viewport.top,shade);canvas.drawRect(0,viewport.bottom,getWidth(),getHeight(),shade);
        canvas.drawRect(0,viewport.top,viewport.left,viewport.bottom,shade);canvas.drawRect(viewport.right,viewport.top,getWidth(),viewport.bottom,shade);
        Paint line=new Paint(Paint.ANTI_ALIAS_FLAG);line.setStyle(Paint.Style.STROKE);line.setStrokeWidth(2*getResources().getDisplayMetrics().density);line.setColor(Color.WHITE);canvas.drawRect(viewport,line);
        line.setStrokeWidth(1);line.setColor(0x88ffffff);for(int i=1;i<3;i++){float x=viewport.left+viewport.width()*i/3,y=viewport.top+viewport.height()*i/3;canvas.drawLine(x,viewport.top,x,viewport.bottom,line);canvas.drawLine(viewport.left,y,viewport.right,y,line);}
    }
    public boolean onTouchEvent(android.view.MotionEvent event){
        getParent().requestDisallowInterceptTouchEvent(true);pinch.onTouchEvent(event);
        switch(event.getActionMasked()){
            case MotionEvent.ACTION_DOWN:moving=true;lastX=event.getX();lastY=event.getY();return true;
            case MotionEvent.ACTION_MOVE:
                if(moving&&!pinch.isInProgress()&&event.getPointerCount()==1&&!viewport.isEmpty()){
                    float s=crop.scale(bitmap.getWidth(),bitmap.getHeight(),viewport);crop.x-=(event.getX()-lastX)/(bitmap.getWidth()*s);crop.y-=(event.getY()-lastY)/(bitmap.getHeight()*s);crop.clamp(bitmap.getWidth(),bitmap.getHeight(),viewport);invalidate();
                }lastX=event.getX();lastY=event.getY();return true;
            case MotionEvent.ACTION_POINTER_UP:moving=false;return true;
            case MotionEvent.ACTION_UP:case MotionEvent.ACTION_CANCEL:moving=false;getParent().requestDisallowInterceptTouchEvent(false);return true;
        }return true;
    }
    Bitmap exportCrop(){if(viewport.isEmpty())throw new IllegalStateException("请等待预览显示后保存");return PhotoBackground.cropped(bitmap,crop.source(bitmap.getWidth(),bitmap.getHeight(),viewport));}
}
