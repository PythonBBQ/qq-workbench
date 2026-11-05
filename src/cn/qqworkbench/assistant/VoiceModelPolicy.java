package cn.qqworkbench.assistant;

/** Only known bundled models and their supported inference budgets can be selected. */
final class VoiceModelPolicy {
    static String referenceMood(String value){return "intimate".equals(value)?"shy":LocalVoice.mood(value);}
    static String deliveryStyle(String value){return "intimate".equals(value)?"soft":"normal";}
    static String deliveryStyle(String mood,String text){return "intimate".equals(mood)||text.matches("(?s).*(闭上眼睛|慢慢放松|安心睡|睡个好觉).*")?"soft":"normal";}
    static int rate(String mood,int value){return Math.max(-40,Math.min(60,value-("intimate".equals(mood)?3:"shy".equals(mood)?5:0)));}
    static int rate(String provider,String mood,int value){
        if("zipvoice".equals(provider))return rate(mood,value);
        int offset="happy".equals(mood)?6:"gentle".equals(mood)?-7:"shy".equals(mood)?-9:"sad".equals(mood)?-10:"serious".equals(mood)?-4:0;
        return Math.max(-40,Math.min(60,value+offset));
    }
    static int pitch(String provider,String mood,int value){
        int offset="zipvoice".equals(provider)?0:"happy".equals(mood)?3:"gentle".equals(mood)?-2:"shy".equals(mood)?1:"sad".equals(mood)?-3:"serious".equals(mood)?-2:0;
        return Math.max(-30,Math.min(30,value+offset));
    }
    static boolean stableReference(String mood){return "intimate".equals(mood)||"shy".equals(mood);}
    static String model(String value){return "full".equals(value)?"full":"fast";}
    static int steps(String model,int value){return "full".equals(model)?(value==32?32:16):(value==4?4:8);}
    static int selectedSteps(String model,int value,String preset,String mood){
        if("full".equals(model)&&"t02-t06".equals(preset))return "neutral".equals(referenceMood(mood))||"gentle".equals(referenceMood(mood))?32:16;
        return steps(model,value);
    }
}
