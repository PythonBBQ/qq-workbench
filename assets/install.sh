#!/bin/bash
set -euo pipefail
cd /opt/qq-workbench
if [ -n "${QQWB_APT_PROXY:-}" ]; then export http_proxy="$QQWB_APT_PROXY" https_proxy="$QQWB_APT_PROXY"; fi

scan_environment() {
  local result=0
  /usr/bin/python3 -I /opt/qq-workbench/environment-check.py > environment-status.json.tmp || result=$?
  if [ -s environment-status.json.tmp ]; then mv environment-status.json.tmp environment-status.json; else rm -f environment-status.json; fi
  return "$result"
}
phase() { printf 'QQWB:%s\n' "$1"; }
repair_failure() {
  local hint='组件补齐未完成，请保持联网后重试；账号与配置保留'
  if grep -Eiq 'Temporary failure resolving|Could not resolve|Name or service not known' environment-install.log; then hint='下载失败：软件源域名无法解析，请检查网络或初始化代理后重试'
  elif grep -Eiq 'No space left|not enough free space' environment-install.log; then hint='空间不足，组件补齐未完成，请释放设备存储后重试'
  elif grep -Eiq 'Could not get lock|Unable to acquire|dpkg.*locked' environment-install.log; then hint='其他组件正在安装，请稍候重试，未删除软件包锁或账号数据'
  elif grep -Eiq 'Connection.*(failed|timed out)|Failed to fetch|Network is unreachable|TLS|certificate' environment-install.log; then hint='组件下载连接失败，请检查网络、系统时间或初始化代理后重试'; fi
  phase "$hint";printf '%s\n' "$hint" > environment-problem.txt
}
video_dependencies() {
  if ffmpeg -version >/dev/null 2>&1 && ffprobe -version >/dev/null 2>&1; then return; fi
  local now last;now=$(date +%s);last=$(cat .video-attempt 2>/dev/null || echo 0)
  [[ "$last" =~ ^[0-9]+$ ]] || last=0
  if (( now - last < 21600 )); then return; fi
  printf '%s' "$now" > .video-attempt
  phase '自动准备视频兼容组件，QQ账号与设置保留…'
  if timeout 150 bash -c 'dpkg --configure -a && apt-get update -o Acquire::Retries=1 -o Acquire::http::Timeout=20 && apt-get install -y --no-install-recommends ffmpeg' > /tmp/qqwb-video-setup.log 2>&1; then
    apt-get clean;phase '视频兼容组件已准备好'
  else phase '视频兼容组件暂未下载完成，继续启动QQ；下次自动重试'; fi
}
prepare_video_later() {
  env -u QQWB_SITE_COOKIES -u DEEPSEEK_API_KEY -u VISION_API_KEY -u SPEECH_API_KEY -u FEIYU_API_KEY -u WORKBENCH_TOKEN -u WORKBENCH_MEMORY_KEY -u VNC_PASSWORD bash /opt/qq-workbench/install.sh --video-only 9>&- &
}
if [ "${1:-}" = '--check-only' ]; then scan_environment; exit $?; fi
exec 9> .environment.lock
if [ "${1:-}" = '--video-only' ]; then flock -n 9 || exit 0;video_dependencies;exit 0;fi
phase '正在检测 Python、QQ 运行库和登录窗口组件…'
if ! flock -w 180 9; then phase '组件安装仍在进行，请稍候重试；没有重复下载';exit 1;fi
if scan_environment; then
  phase '基础环境检测通过';: > environment-problem.txt
  flock -u 9;prepare_video_later;exit 0
fi
phase '发现环境缺失，正在从内置资源及系统软件源自动补齐…'
mkdir -p /tmp /dev/shm /run /var/lib/apt/lists/partial
chmod 1777 /tmp
printf 'APT::Sandbox::User "root";\nAcquire::Retries "1";\nAcquire::http::Timeout "20";\nAcquire::https::Timeout "20";\nDPkg::Lock::Timeout "120";\n' > /etc/apt/apt.conf.d/99qq-workbench
# Import only the packaged official application; existing account profiles live elsewhere.
if [ ! -x /opt/QQ/qq ]; then
  phase '正在恢复安装包内的官方 Linux QQ…'
  if ! dpkg-deb -x /opt/qq-workbench/linuxqq.deb / > environment-install.log 2>&1; then repair_failure;exit 1;fi
fi
scan_environment || true
all_packages='python3 python3-minimal python3.12 libpython3.12-stdlib xvfb x11vnc novnc websockify dbus-x11 libnss3 libatk-bridge2.0-0 libgtk-3-0 libasound2t64 libgbm1 libxss1 libsecret-1-0 libnotify4 libdrm2 libxdamage1 libxrandr2 libxcomposite1 libxtst6 libxkbcommon0 fonts-noto-cjk ca-certificates'
if ! packages=$(/usr/bin/python3 -I -c 'import json; r=json.load(open("environment-status.json"));assert r["schema"]==1;print(" ".join(r["packages"]))' 2>/dev/null); then
  packages="$all_packages";phase 'Python检测器暂不可用，正在通过系统包管理器恢复基础环境…'
fi
if [ -n "$packages" ]; then
  # Package names come only from the bundled allowlist, never messages or role cards.
  allowed=" $all_packages "
  for package in $packages; do [[ "$allowed" == *" $package "* ]] || { phase '环境报告包含未知软件包，未执行安装';exit 1; };done
  phase '正在下载并修复缺失组件，首次准备可能需要几分钟…'
  : > environment-install.log
  if ! timeout 900 bash -c 'apt-get update && (dpkg --configure -a || apt-get -y -f install) && apt-get install -y --no-install-recommends --reinstall "$@"' qqwb-repair $packages >> environment-install.log 2>&1; then repair_failure;exit 1;fi
fi
if ! scan_environment; then phase '环境复检未通过，请在诊断查看仍缺失的组件；未清空账号数据';exit 1;fi
/opt/snowluma/node /opt/snowluma/check-node-version.cjs
touch .deps-v1
: > environment-problem.txt
phase '环境复检通过，正在启动 QQ 登录窗口…'
flock -u 9;prepare_video_later
