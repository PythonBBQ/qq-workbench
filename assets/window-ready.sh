# Sourced by the main and isolated sessions. No credentials are printed.
window_ready() {
  local web="$1" desktop="$2" web_pid="$3" desktop_pid="$4"
  for attempt in {1..60}; do
    if ! kill -0 "$web_pid" 2>/dev/null; then echo 'QQWB:QQ登录网页服务启动失败，请在诊断重新检测并补齐Python/websockify';return 1;fi
    if ! kill -0 "$desktop_pid" 2>/dev/null; then echo 'QQWB:QQ桌面连接组件启动失败，请在诊断检查Xvfb/x11vnc';return 1;fi
    if /usr/bin/python3 -I -c 'import socket,sys,urllib.request
try:
 with urllib.request.build_opener(urllib.request.ProxyHandler({})).open("http://127.0.0.1:"+sys.argv[1]+"/vnc.html",timeout=.7) as r:
  assert r.status==200 and b"novnc" in r.read(8192).lower()
 with socket.create_connection(("127.0.0.1",int(sys.argv[2])),.7) as s:
  s.settimeout(.7);assert s.recv(4)==b"RFB "
except Exception:sys.exit(1)' "$web" "$desktop" >/dev/null 2>&1; then return 0;fi
    sleep .5
  done
  echo 'QQWB:QQ登录窗口准备超时，请在诊断查看环境检测结果后重试';return 1
}
