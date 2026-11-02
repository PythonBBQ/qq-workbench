package cn.qqworkbench.assistant;

/** Only known bundled models and their supported inference budgets can be selected. */
final class VoiceModelPolicy {
    static String referenceMood(String value){return "intimate".equals(value)?"shy":LocalVoice.mood(value);}
    static String deliveryStyle(String value){return "intimate".equals(value)?"soft":"normal";}
    static int rate(String mood,int value){return Math.max(-40,Math.min(60,value-("intimate".equals(mood)||"shy".equals(mood)?5:0)));}
    static String model(String value){return "full".equals(value)?"full":"fast";}
    static int steps(String model,int value){return "full".equals(model)?(value==32?32:16):(value==4?4:8);}
    static int selectedSteps(String model,int value,String preset,String mood){
        if("full".equals(model)&&"t02-t06".equals(preset))return "neutral".equals(referenceMood(mood))||"gentle".equals(referenceMood(mood))?32:16;
        return steps(model,value);
    }
}
