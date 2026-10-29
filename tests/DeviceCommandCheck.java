package cn.qqworkbench.assistant;
import java.util.Arrays;
import org.json.JSONObject;
public final class DeviceCommandCheck {
    static void check(boolean ok){if(!ok)throw new AssertionError();}
    public static void main(String[] args)throws Exception{
        check(Arrays.equals(DeviceCommand.args(new JSONObject("{action:'battery'}")),new String[]{"/system/bin/dumpsys","battery"}));
        check(Arrays.equals(DeviceCommand.args(new JSONObject("{action:'tap',x:1,y:2}")),new String[]{"/system/bin/input","tap","1","2"}));
        check(DeviceCommand.args(new JSONObject("{action:'brightness',percent:50}"))[4-1].equals("screen_brightness"));
        for(String value:new String[]{"{action:'launch',package:'com.example; reboot'}","{action:'tap',x:1.5,y:2}","{action:'tap',x:-1,y:2}","{action:'swipe',x1:1,y1:2,x2:3,y2:4,duration:999999}","{action:'key',key:'power'}","{action:'brightness',percent:101}","{action:'shell',command:'cat /secret'}"}){
            boolean rejected=false;try{DeviceCommand.args(new JSONObject(value));}catch(Exception e){rejected=true;}check(rejected);
        }
        check(DeviceCommand.readOnly("battery"));check(!DeviceCommand.readOnly("tap"));
        System.out.println("DEVICE_COMMAND_HOST_OK: typed arguments, shell-injection rejection, integer/range validation, read/write classes; no real device commands executed");
    }
}
