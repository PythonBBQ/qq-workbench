package cn.qqworkbench.assistant;
public final class UnixTextCheck {
    public static void main(String[] args)throws Exception{
        String shell="#!/bin/bash\r\nset -euo pipefail\r\nfor n in 1 2; do\r\n  echo 中文\r\ndone\r\n";
        String fixed=UnixText.normalize(shell.getBytes("UTF-8"));
        if(fixed.indexOf('\r')>=0||!fixed.contains("echo 中文\n")||!fixed.equals(UnixText.normalize(fixed.getBytes("UTF-8"))))throw new AssertionError();
        if(!UnixText.normalize("one\rtwo\r".getBytes("UTF-8")).equals("one\ntwo\n"))throw new AssertionError();
        System.out.println("QQWB_UNIX_TEXT_OK: CRLF/lone-CR repair, UTF-8 preserved, idempotence");
    }
}
