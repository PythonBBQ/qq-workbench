package cn.qqworkbench.assistant;

import android.graphics.RectF;

final class CropGeometry {
    float x=.5f,y=.5f,zoom=1;
    static float bound(float value,float min,float max){return Math.max(min,Math.min(max,value));}
    float scale(int w,int h,RectF viewport){return Math.max(viewport.width()/w,viewport.height()/h)*zoom;}
    void clamp(int w,int h,RectF viewport){
        zoom=bound(zoom,1,6);float s=scale(w,h,viewport);
        float rx=Math.min(.5f,viewport.width()/(2*w*s)),ry=Math.min(.5f,viewport.height()/(2*h*s));
        x=bound(x,rx,1-rx);y=bound(y,ry,1-ry);
    }
    RectF source(int w,int h,RectF viewport){
        clamp(w,h,viewport);float s=scale(w,h,viewport),rx=viewport.width()/(2*s),ry=viewport.height()/(2*s);
        return new RectF(x*w-rx,y*h-ry,x*w+rx,y*h+ry);
    }
}
