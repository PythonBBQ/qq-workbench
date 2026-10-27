package cn.qqworkbench.assistant;

/** One place owns the hierarchy; old saved routes remain valid. */
final class Navigation {
    static final String[][] MAIN={{"home","聊天"},{"api","模型"},{"personality","酒馆"},{"learning","能力"},{"settings","设置"}};
    static final String[][] TAVERN={{"personality","人设"},{"memory","记忆"},{"growth","养成"},{"budget","上下文"}};
    static final String[][] ABILITIES={{"learning","联网"},{"video","图片·视频"},{"voice","语音"},{"emoji","表情"},{"feeds","动态"}};
    static boolean contains(String[][] entries,String route){for(String[] e:entries)if(e[0].equals(route))return true;return false;}
    static String group(String route){
        if(contains(TAVERN,route))return "personality";
        if(contains(ABILITIES,route))return "learning";
        if(route.equals("api")||route.equals("apiEdit"))return "api";
        if(route.equals("home")||route.equals("setup"))return "home";
        return "settings";
    }
    static String[][] tabs(String route){if(contains(TAVERN,route))return TAVERN;if(contains(ABILITIES,route))return ABILITIES;return new String[0][];}
    static String parent(String route){String group=group(route);return route.equals(group)?"home":group;}
    private Navigation(){}
}
