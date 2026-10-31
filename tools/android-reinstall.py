"""Inspect Android's package records or reinstall a same-signed workbench APK.

No uninstall, user removal, application-data clearing, or system-policy changes.
"""
import argparse
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'cn.qqworkbench.assistant'
SIGNER = '2761b36e64042b9b8837b0c742f9ee9369d6a05a2547c0d81bcfebf0655c86ce'


def main():
    parser = argparse.ArgumentParser(description='检查工作台安装残留；指定 APK 时保留数据覆盖安装或降级。')
    parser.add_argument('--adb', default=shutil.which('adb') or str(ROOT.parent/'research/android/toolchain/platform-tools/adb.exe'))
    parser.add_argument('--serial', help='多设备时指定 adb 序列号')
    parser.add_argument('--apk', type=Path, help='明确选定的官方同签名旧版或新版 APK；不传时只检查')
    parser.add_argument('--build-tools', type=Path, default=ROOT.parent/'research/android/toolchain/build-tools_r35_windows/android-15')
    parser.add_argument('--java-bin', type=Path, help='apksigner 使用的 Java bin 目录')
    args = parser.parse_args()
    environment = dict(os.environ)
    if args.java_bin:
        environment['JAVA_HOME'] = str(args.java_bin.resolve().parent)
        environment['PATH'] = str(args.java_bin.resolve()) + os.pathsep + environment.get('PATH', '')

    def call(*parts, binary=False, check=True, timeout=90):
        result = subprocess.run([str(p) for p in parts], stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, env=environment)
        if check and result.returncode:
            raise RuntimeError(result.stderr.decode('utf-8', 'replace').strip() or result.stdout.decode('utf-8', 'replace').strip())
        return result if binary else result.stdout.decode('utf-8', 'replace').strip()

    lines = call(args.adb, 'devices').splitlines()[1:]
    devices = [line.split()[0] for line in lines if len(line.split()) >= 2 and line.split()[1] == 'device']
    serial = args.serial or (devices[0] if len(devices) == 1 else None)
    if serial not in devices:
        raise RuntimeError('没有唯一的已授权设备。请连接手机并允许 USB/无线调试；多设备时用 --serial 指定。没有修改手机。')
    adb = [args.adb, '-s', serial]
    current = call(*adb, 'shell', 'am', 'get-current-user')
    if not current.isdigit():
        raise RuntimeError('无法识别当前 Android 用户，没有修改手机。')
    users_text = call(*adb, 'shell', 'pm', 'list', 'users')
    user_ids = re.findall(r'UserInfo\{(\d+):', users_text)
    records = []
    for user in user_ids:
        result = call(*adb, 'shell', 'pm', 'list', 'packages', '-u', '--user', user, PACKAGE, binary=True, check=False)
        output = result.stdout.decode('utf-8', 'replace')
        records.append({'user': int(user), 'packageRecord': 'package:'+PACKAGE in {line.strip() for line in output.splitlines()},
                        'readable': result.returncode == 0})
    dump = call(*adb, 'shell', 'dumpsys', 'package', PACKAGE)
    per_user = {user: fields for user, fields in re.findall(r'^\s*User (\d+):\s*(.+)$', dump, re.M)}
    for record in records:
        fields = per_user.get(str(record['user']), '')
        for name in ('installed', 'hidden', 'archived'):
            state = re.search(r'\b'+name+r'=(true|false)\b', fields)
            record[name] = state[1] == 'true' if state else None
    code = re.search(r'\bversionCode=(\d+)', dump)
    version = re.search(r'\bversionName=([^\s]+)', dump)
    print(json.dumps({'package': PACKAGE, 'currentUser': int(current), 'users': records,
                      'registeredVersionCode': int(code[1]) if code else None,
                      'registeredVersion': version[1] if version else None}, ensure_ascii=False, indent=2))
    if not args.apk:
        print('仅完成安装记录检查，未卸载或清理数据。指定 --apk 可保留数据重新安装；多用户共享包版本。')
        return
    apk = args.apk.resolve(strict=True)
    if apk.suffix.lower() != '.apk':
        raise RuntimeError('请选择 APK 安装文件。')
    aapt = args.build_tools/('aapt.exe' if os.name == 'nt' else 'aapt')
    badging = call(aapt, 'dump', 'badging', apk)
    match = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", badging, re.M)
    if not match or match[1] != PACKAGE:
        raise RuntimeError('安装包不是七丘 QQ 工作台，没有修改手机。')
    signer_jar = args.build_tools/'lib/apksigner.jar'
    java = args.java_bin/('java.exe' if os.name == 'nt' else 'java') if args.java_bin else 'java'
    signing = call(java, '-jar', signer_jar, 'verify', '--print-certs', apk)
    certs = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)$', signing, re.M)
    if len(certs) != 1 or certs[0].lower() != SIGNER:
        raise RuntimeError('安装包签名与本项目官方发布签名不符，没有修改手机。')
    with apk.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    print('目标版本：'+match[3]+'；SHA256：'+digest)
    timestamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = ROOT/'build/private-reinstall-backups'/timestamp
    backup.mkdir(parents=True, exist_ok=False)
    # This is a settings snapshot, not a full backup of chats or the container.
    active = call(*adb, 'shell', 'pm', 'list', 'packages', '--user', current, PACKAGE)
    if 'package:'+PACKAGE in {line.strip() for line in active.splitlines()}:
        call(*adb, 'shell', 'am', 'force-stop', '--user', current, PACKAGE)
        snapshot = call(*adb, 'exec-out', 'run-as', PACKAGE, '--user', current,
                        'tar', '-cf', '-', 'shared_prefs', binary=True, check=False)
        if snapshot.returncode or len(snapshot.stdout) < 1024:
            raise RuntimeError('无法备份当前用户设置，已停止覆盖安装；未卸载或清理数据。')
        try:
            with tarfile.open(fileobj=io.BytesIO(snapshot.stdout)) as archive:
                if not all(p.name == 'shared_prefs' or p.name.startswith('shared_prefs/') for p in archive):
                    raise ValueError('unexpected archive path')
        except (ValueError, tarfile.TarError) as error:
            raise RuntimeError('设置备份无效，已停止覆盖安装。') from error
        (backup/'shared-prefs-private.tar').write_bytes(snapshot.stdout)
        print('已保存当前用户设置备份（含密钥，勿公开）：'+str(backup))
    else:
        print('当前用户未安装；保留 Android 现有数据记录，不执行卸载。')
    result = call(*adb, 'install', '-r', '-d', '--user', current, apk,
                  binary=True, check=False, timeout=900)
    output = (result.stdout+result.stderr).decode('utf-8', 'replace').strip()
    receipt = {'at': timestamp, 'targetVersion': match[3], 'targetVersionCode': int(match[2]),
               'sha256': digest, 'success': result.returncode == 0 and bool(re.search(r'^Success\s*$', output, re.M)),
               'method': 'adb install -r -d', 'settingsSnapshotOnly': True, 'versionConfirmed': False,
               'uninstalled': False, 'clearedData': False}
    (backup/'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    if not receipt['success']:
        print(output)
        if 'VERSION_DOWNGRADE' in output:
            raise RuntimeError('手机系统仍拒绝降级。没有卸载或清理数据；保留诊断记录，改用更高版本号的修复包。')
        raise RuntimeError('系统未确认安装成功。没有改签名、卸载或清理数据。')
    after = call(*adb, 'shell', 'dumpsys', 'package', PACKAGE)
    installed = re.search(r'\bversionCode=(\d+)', after)
    if not installed or int(installed[1]) != int(match[2]):
        raise RuntimeError('安装器返回成功，但版本核对不一致；请查看手机安装状态。')
    receipt['versionConfirmed'] = True
    (backup/'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    print('已保留数据安装 '+match[3]+'。未启动 QQ 或发送消息；旧版能否读取新版数据仍需实际使用确认。')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print('未完成：'+str(error), file=sys.stderr)
        sys.exit(1)
