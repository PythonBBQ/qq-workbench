#!/bin/bash
set -euo pipefail
slot="${1:-}"
[[ "$slot" =~ ^[1-3]$ ]] || exit 64
display=$((17+slot)); vnc=$((15917+slot)); web=$((16080+slot))
work="/opt/qq-workbench/instances/slot-$slot"
export DISPLAY=":$display" XDG_RUNTIME_DIR="/tmp/qqwb-runtime-$slot" SNOWLUMA_HOOK_RUNTIME_DIR="/tmp/qqwb-runtime-$slot"
mkdir -p "$work" "$XDG_RUNTIME_DIR" "/tmp/qqwb-vnc-$slot"
chmod 700 "$XDG_RUNTIME_DIR" "/tmp/qqwb-vnc-$slot"
cd "$work"
children=()
cleanup(){ for pid in "${children[@]}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT
trap 'exit 0' TERM INT
safe_env=(env -u QQWB_ACCOUNT_PROFILES -u QQWB_SITE_COOKIES -u DEEPSEEK_API_KEY -u VISION_API_KEY -u SPEECH_API_KEY -u FEIYU_API_KEY -u WORKBENCH_TOKEN -u QQWB_NATIVE_TOKEN -u WORKBENCH_MEMORY_KEY -u VNC_PASSWORD)
"${safe_env[@]}" Xvfb ":$display" -screen 0 1100x780x24 -nolock -noreset -nolisten tcp >xvfb.log 2>&1 & children+=("$!")
for attempt in {1..40}; do [ -S "/tmp/.X11-unix/X$display" ] && break; sleep .25; done
# Reuse the app's VNC password file; API and account credentials never enter VNC.
"${safe_env[@]}" x11vnc -display ":$display" -localhost -rfbport "$vnc" -forever -shared -noshm -rfbauth /tmp/qqwb-vnc/password -quiet >vnc.log 2>&1 & children+=("$!")
"${safe_env[@]}" /usr/bin/python3 -m websockify --web=/usr/share/novnc "127.0.0.1:$web" "127.0.0.1:$vnc" >websockify.log 2>&1 & children+=("$!")
/opt/snowluma/node /opt/qq-workbench/assistant.mjs & children+=("$!")
wait "${children[-1]}"
