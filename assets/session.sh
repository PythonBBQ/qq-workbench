#!/bin/bash
set -euo pipefail
cd /opt/qq-workbench
for prefix in /data/data/cn.qqworkbench.assistant/files/linux/rootfs /data/user/0/cn.qqworkbench.assistant/files/linux/rootfs; do
  mapped="$prefix/opt/QQ/resources/app"
  mkdir -p "$mapped"
  [ -e "$mapped/wrapper.node" ] || ln -s /opt/QQ/resources/app/wrapper.node "$mapped/wrapper.node"
done
export DISPLAY=:17 XDG_RUNTIME_DIR=/tmp/qqwb-runtime SNOWLUMA_HOOK_RUNTIME_DIR=/tmp/qqwb-runtime
mkdir -p "$XDG_RUNTIME_DIR" /tmp/qqwb-vnc
chmod 700 "$XDG_RUNTIME_DIR" /tmp/qqwb-vnc
cleanup() { for pid in "${children[@]}"; do kill "$pid" 2>/dev/null || true; done; }
children=()
trap cleanup EXIT
trap 'exit 0' TERM INT
env -u QQWB_SITE_COOKIES -u DEEPSEEK_API_KEY -u VISION_API_KEY -u SPEECH_API_KEY -u WORKBENCH_TOKEN -u WORKBENCH_MEMORY_KEY -u VNC_PASSWORD Xvfb :17 -screen 0 1100x780x24 -nolock -noreset -nolisten tcp >xvfb.log 2>&1 & children+=("$!")
for attempt in {1..40}; do [ -S /tmp/.X11-unix/X17 ] && break; sleep .25; done
env -u QQWB_SITE_COOKIES -u DEEPSEEK_API_KEY -u VISION_API_KEY -u SPEECH_API_KEY -u WORKBENCH_TOKEN -u WORKBENCH_MEMORY_KEY -u VNC_PASSWORD python3 /opt/qq-workbench/snow-setup.py
env -u QQWB_SITE_COOKIES -u DEEPSEEK_API_KEY -u VISION_API_KEY -u SPEECH_API_KEY -u WORKBENCH_TOKEN -u WORKBENCH_MEMORY_KEY x11vnc -storepasswd "$VNC_PASSWORD" /tmp/qqwb-vnc/password >/dev/null 2>&1
unset VNC_PASSWORD
env -u QQWB_SITE_COOKIES -u DEEPSEEK_API_KEY -u VISION_API_KEY -u SPEECH_API_KEY -u WORKBENCH_TOKEN -u WORKBENCH_MEMORY_KEY x11vnc -display :17 -localhost -rfbport 15917 -forever -shared -noshm -rfbauth /tmp/qqwb-vnc/password -quiet >vnc.log 2>&1 & children+=("$!")
env -u QQWB_SITE_COOKIES -u DEEPSEEK_API_KEY -u VISION_API_KEY -u SPEECH_API_KEY -u WORKBENCH_TOKEN -u WORKBENCH_MEMORY_KEY /usr/bin/python3 -m websockify --web=/usr/share/novnc 127.0.0.1:16080 127.0.0.1:15917 >websockify.log 2>&1 & children+=("$!")
echo 'QQWB:SnowLuma 1.14.22 正在启动，QQ 登录完成后会自动核验连接'
/opt/snowluma/node /opt/qq-workbench/assistant.mjs & children+=("$!")
wait "${children[-1]}"
