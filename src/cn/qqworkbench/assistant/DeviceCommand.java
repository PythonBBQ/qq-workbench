package cn.qqworkbench.assistant;

import org.json.JSONObject;
import java.util.*;

/** Typed shell arguments. Model text is never interpolated into a shell script. */
final class DeviceCommand {
    static int integer(JSONObject p,String name,int min,int max)throws Exception{
        Object raw=p.get(name);if(!(raw instanceof Number)||((Number)raw).doubleValue()!=((Number)raw).intValue())throw new Exception("参数必须为整数");
        int n=((Number)raw).intValue();if(n<min||n>max)throw new Exception("参数超出范围");return n;
    }
    static String[] args(JSONObject p)throws Exception{
        String action=p.getString("action");
        switch(action){
            case "status":return new String[]{"/system/bin/getprop","ro.product.model"};
            case "battery":return new String[]{"/system/bin/dumpsys","battery"};
            case "storage":return new String[]{"/system/bin/df","-h","/data"};
            case "apps":return new String[]{"/system/bin/pm","list","packages","-3"};
            case "display":return new String[]{"/system/bin/wm","size"};
            case "tap":return new String[]{"/system/bin/input","tap",""+integer(p,"x",0,10000),""+integer(p,"y",0,10000)};
            case "swipe":return new String[]{"/system/bin/input","swipe",""+integer(p,"x1",0,10000),""+integer(p,"y1",0,10000),""+integer(p,"x2",0,10000),""+integer(p,"y2",0,10000),""+integer(p,"duration",100,2000)};
            case "key":{
                Map<String,String> keys=new HashMap<>();keys.put("home","3");keys.put("back","4");keys.put("recent","187");keys.put("enter","66");keys.put("wake","224");keys.put("sleep","223");
                String key=keys.get(p.getString("key"));if(key==null)throw new Exception("按键无效");return new String[]{"/system/bin/input","keyevent",key};
            }
            case "launch":{
                String name=p.getString("package");if(!name.matches("[a-zA-Z][a-zA-Z0-9_]*(?:\\.[a-zA-Z0-9_]+)+")||name.length()>180)throw new Exception("应用包名无效");
                return new String[]{"/system/bin/monkey","-p",name,"-c","android.intent.category.LAUNCHER","1"};
            }
            case "brightness":return new String[]{"/system/bin/settings","put","system","screen_brightness",""+Math.round(integer(p,"percent",1,100)*2.55f)};
            case "volume":return new String[]{"/system/bin/cmd","media_session","volume","--stream","3","--set",""+integer(p,"level",0,15)};
            default:throw new Exception("尚未开放此设备动作");
        }
    }
    static boolean readOnly(String action){return Arrays.asList("status","battery","storage","apps","display").contains(action);}
}
