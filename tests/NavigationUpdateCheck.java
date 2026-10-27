package cn.qqworkbench.assistant;
import java.io.File;
public final class NavigationUpdateCheck {
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args)throws Exception{
        check(Navigation.MAIN.length==5);
        for(String route:new String[]{"personality","growth","memory","budget"})check(Navigation.group(route).equals("personality"));
        for(String route:new String[]{"learning","video","voice","emoji","feeds"})check(Navigation.group(route).equals("learning"));
        for(String route:new String[]{"qq","appearance","crop","background","diagnostics","updates","replies"})check(Navigation.group(route).equals("settings"));
        check(Navigation.parent("budget").equals("personality"));check(Navigation.parent("personality").equals("home"));check(Navigation.parent("apiEdit").equals("api"));
        check(AppUpdates.compare("v0.1.20","0.1.19-preview")>0);check(AppUpdates.compare("v0.1.20","0.1.20-preview")==0);check(AppUpdates.compare("v0.1.9","0.1.20-preview")<0);
        check(AppUpdates.assetUrl("https://github.com/PythonBBQ/qq-workbench/releases/download/v0.1.20/app.apk").getHost().equals("github.com"));
        check(AppUpdates.releaseUrl(AppUpdates.DEFAULT_FEED).getHost().equals("api.github.com"));
        for(String value:new String[]{"file:///secret","https://evil.example/update.apk","https://github.com.evil.example/update.apk","http://github.com/app.apk","https://user:pass@github.com/app.apk","https://github.com:8443/app.apk"}){
            try{AppUpdates.assetUrl(value);throw new AssertionError();}catch(Exception expected){check(!(expected instanceof RuntimeException));}
        }
        System.out.println("QQWB_NAVIGATION_UPDATE_OK: five entries, nested routes, old-route parents, semantic versions, restricted HTTPS release assets");
    }
}
