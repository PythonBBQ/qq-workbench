#!/bin/bash
set -euo pipefail
cd /opt/qq-workbench
# Existing installations still need the optional video decoder. Failure must
# not prevent QQ startup; retry automatically on a later launch after 6 hours.
video_dependencies() {
  if ffmpeg -version >/dev/null 2>&1 && ffprobe -version >/dev/null 2>&1; then return; fi
  local now last
  now=$(date +%s); last=$(cat .video-attempt 2>/dev/null || echo 0)
  [[ "$last" =~ ^[0-9]+$ ]] || last=0
  if (( now - last < 21600 )); then return; fi
  printf '%s' "$now" > .video-attempt
  echo 'QQWB:自动准备视频兼容组件，QQ账号与设置保留…'
  if timeout 150 bash -c 'dpkg --configure -a && apt-get update -o Acquire::Retries=1 -o Acquire::http::Timeout=20 && apt-get install -y --no-install-recommends ffmpeg' > /tmp/qqwb-video-setup.log 2>&1; then
    apt-get clean
    echo 'QQWB:视频兼容组件已准备好'
  else
    echo 'QQWB:视频兼容组件暂未下载完成，继续启动QQ；下次自动重试'
  fi
}
if [ -n "${QQWB_APT_PROXY:-}" ]; then
  export http_proxy="$QQWB_APT_PROXY" https_proxy="$QQWB_APT_PROXY"
fi
if [ "${1:-}" = '--video-only' ]; then video_dependencies; exit 0; fi
prepare_video_later() {
  env -u DEEPSEEK_API_KEY -u VISION_API_KEY -u SPEECH_API_KEY -u WORKBENCH_TOKEN -u WORKBENCH_MEMORY_KEY -u VNC_PASSWORD bash /opt/qq-workbench/install.sh --video-only &
}
if [ -f .deps-v1 ]; then prepare_video_later; exit 0; fi
echo 'QQWB:准备 Linux QQ 图形依赖（仅首次需要联网下载）…'
mkdir -p /tmp /dev/shm /run /var/lib/apt/lists/partial
chmod 1777 /tmp
printf 'APT::Sandbox::User "root";\nAcquire::Retries "2";\n' > /etc/apt/apt.conf.d/99qq-workbench
apt-get update
dpkg --configure -a
apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify dbus-x11 libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2t64 libgbm1 libxss1 libsecret-1-0 libnotify4 libdrm2 libxdamage1 libxrandr2 libxcomposite1 libxtst6 libxkbcommon0 fonts-noto-cjk ca-certificates 2>&1 | awk '/^Unpacking / {n++; if(n % 20 == 0) {print "QQWB:正在安装图形组件，首次准备仍在进行…";fflush()}} {print;fflush()}'
echo 'QQWB:正在导入腾讯官方 Linux ARM64 QQ…'
dpkg-deb -x /opt/qq-workbench/linuxqq.deb /
test -x /opt/QQ/qq
missing="$(ldd /opt/QQ/qq | grep 'not found' || true)"
if [ -n "$missing" ]; then printf 'QQWB:QQ 仍缺少运行库：%s\n' "$missing"; exit 1; fi
/opt/snowluma/node /opt/snowluma/check-node-version.cjs
touch .deps-v1
echo 'QQWB:Linux QQ 和基础环境已安装'
prepare_video_later
