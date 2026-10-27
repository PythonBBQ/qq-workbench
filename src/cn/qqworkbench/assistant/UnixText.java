package cn.qqworkbench.assistant;

/** Shell assets must retain Unix line endings on Windows workstations too. */
final class UnixText {
    static String normalize(byte[] bytes){
        return new String(bytes,java.nio.charset.StandardCharsets.UTF_8).replace("\r\n","\n").replace('\r','\n');
    }
    private UnixText(){}
}
