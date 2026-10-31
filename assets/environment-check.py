"""Inspect only runtime dependencies. Never read QQ accounts, keys or chat files."""
from pathlib import Path
import json, os, shutil, subprocess, sys, time

GRAPHICS = ['xvfb', 'x11vnc', 'novnc', 'websockify', 'dbus-x11', 'libnss3',
            'libatk-bridge2.0-0', 'libgtk-3-0', 'libasound2t64', 'libgbm1', 'libxss1',
            'libsecret-1-0', 'libnotify4', 'libdrm2', 'libxdamage1', 'libxrandr2',
            'libxcomposite1', 'libxtst6', 'libxkbcommon0', 'fonts-noto-cjk', 'ca-certificates']
PYTHON = ['python3', 'python3-minimal', 'python3.12', 'libpython3.12-stdlib']

def inspect(root=Path('/'), which=shutil.which, run=subprocess.run):
    checks=[];packages=[]
    def add(name, label, good, required=()):
        checks.append({'id':name, 'label':label, 'ok':bool(good)})
        if not good:
            for p in required:
                if p not in packages:packages.append(p)
    def succeeds(args):
        try:return run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=12).returncode == 0
        except (OSError, subprocess.TimeoutExpired):return False
    python=which('python3')
    add('python', 'Python 3 与标准库', python and succeeds([python, '-I', '-c', 'import encodings,json,ssl,socket,asyncio,subprocess,ctypes,sqlite3,zlib,urllib.request']), PYTHON)
    add('websockify', 'QQ 窗口网页服务', python and succeeds([python, '-I', '-c', 'import websockify']), ['websockify'])
    for command, label, package in [('Xvfb','虚拟显示器','xvfb'), ('x11vnc','桌面连接组件','x11vnc'), ('dbus-run-session','桌面会话','dbus-x11')]:
        add(command,label,which(command),[package])
    add('novnc','QQ 登录网页文件',(root/'usr/share/novnc/vnc.html').is_file(),['novnc'])
    qq=root/'opt/QQ/qq';add('qq','官方 Linux QQ',qq.is_file() and os.access(qq,os.X_OK))
    libraries=False
    if qq.is_file():
        try:
            p=run(['ldd',str(qq)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=12)
            libraries=p.returncode==0 and 'not found' not in p.stdout and 'not found' not in p.stderr
        except (OSError,subprocess.TimeoutExpired):pass
    add('qq-libraries','QQ 运行库',libraries,GRAPHICS)
    node=root/'opt/snowluma/node';add('node','SnowLuma Node 运行时',node.is_file() and succeeds([str(node),'--version']))
    missing=[c['label'] for c in checks if not c['ok']]
    return {'schema':1,'checkedAt':int(time.time()),'ok':not missing,'checks':checks,'packages':packages,
            'summary':'基础环境检测通过' if not missing else '待补齐：'+'、'.join(missing)}

if __name__=='__main__':
    if sys.argv[1:]==['--all-packages']:
        print(' '.join(dict.fromkeys(PYTHON+GRAPHICS)));sys.exit(0)
    result=inspect();print(json.dumps(result,ensure_ascii=False));sys.exit(0 if result['ok'] else 2)
