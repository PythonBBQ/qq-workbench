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


def normal_text(value):
    return value.replace('\r\n', '\n').replace('\r', '')


def listed(output):
    return 'package:'+PACKAGE in {line.strip() for line in normal_text(output).splitlines()}


def package_record(dump):
    """Read only this package's block; later per-user query sections are unrelated."""
    text = normal_text(dump)
    start = re.search(r'^  Package \['+re.escape(PACKAGE)+r'\] \([^\n]*\):[ \t]*$', text, re.M)
    if not start:
        if 'Unable to find package' in text:
            return {'versionCode': None, 'versionName': None, 'users': {}}
        raise RuntimeError('系统安装记录格式无法识别，未把它当成已卸载。')
    block = text[start.end():]
    end = re.search(r'^(?:  Package \[|[A-Za-z][^\n]*:)', block, re.M)
    if end:
        block = block[:end.start()]
    code = re.search(r'\bversionCode=(\d+)', block)
    version = re.search(r'\bversionName=([^\s]+)', block)
    states = {}
    for user, fields in re.findall(r'^[ \t]*User (\d+):[ \t]*([^\n]+)', block, re.M):
        if not re.search(r'\binstalled=(?:true|false)\b', fields):
            continue
        row = {}
        for name in ('installed', 'hidden', 'archived', 'stopped', 'notLaunched'):
            state = re.search(r'\b'+name+r'=(true|false)\b', fields)
            row[name] = state[1] == 'true' if state else None
        inode=re.search(r'\bceDataInode=(-?\d+)',fields)
        row['ceDataInode']=int(inode[1]) if inode else None
        states[int(user)] = row
    return {'versionCode': int(code[1]) if code else None,
            'versionName': version[1] if version else None, 'users': states}


def diagnosis(record, current):
    users = record['users']
    others = [user for user, row in users.items() if user != current and row.get('installed') is True]
    active = users.get(current, {}).get('installed') is True
    if others:
        return ('当前空间'+('仍安装' if active else '已卸载')+'；用户 '+
                '、'.join(map(str, others))+' 仍安装工作台。Android 多空间共享代码版本，'+
                '普通旧版安装会被拦截；使用同签名保留数据降级，不删除系统分身。')
    if active:
        return '当前空间仍安装工作台，回退需同签名 APK 并使用保留数据降级。'
    if record['versionCode'] is not None:
        return '仍有全局版本记录或保留的数据；仅图标消失不能证明已完全移除。优先保留数据降级。'
    return '系统没有该应用的全局版本记录，可正常安装已校验的安装包。'


def inspect(call, adb):
    current = call(*adb, 'shell', 'am', 'get-current-user').strip()
    if not current.isdigit():
        raise RuntimeError('无法识别当前 Android 用户，没有修改手机。')
    user_ids = re.findall(r'UserInfo\{(\d+):', call(*adb, 'shell', 'pm', 'list', 'users'))
    if current not in user_ids:
        raise RuntimeError('用户列表不完整，没有修改手机。')
    record = package_record(call(*adb, 'shell', 'dumpsys', 'package', PACKAGE))
    rows = []
    for user in user_ids:
        result = call(*adb, 'shell', 'pm', 'list', 'packages', '-u', '--user', user, PACKAGE, binary=True, check=False)
        text = result.stdout.decode('utf-8', 'replace')
        readable = result.returncode == 0 and not re.search(r'(?i)(?:SecurityException|Permission Denial|Error:)', text)
        row = {'user': int(user), 'packageRecord': listed(text) if readable else None, 'readable': bool(readable)}
        row.update(record['users'].get(int(user), {k: None for k in ('installed', 'hidden', 'archived')}))
        rows.append(row)
    return {'package': PACKAGE, 'currentUser': int(current), 'users': rows,
            'registeredVersionCode': record['versionCode'], 'registeredVersion': record['versionName'],
            'diagnosis': diagnosis(record, int(current))}


def snapshot(call, adb, current, backup):
    """Snapshot settings, encrypted memory and voice data without touching QQ sessions."""
    # Keep only existing, bounded portable units. No entire multi-gigabyte rootfs.
    candidates = ['shared_prefs', 'files/settings.json', 'files/theme-background.jpg',
                  'files/theme-background-source.jpg']
    work = 'files/linux/rootfs/opt/qq-workbench/'
    for slot in range(4):
        prefix = work+('' if slot == 0 else f'instances/slot-{slot}/')
        candidates += [prefix+name for name in ('settings.json', 'conversation-memory.json',
                       'voice-memory.json', 'learning-notes.json', 'group-ignore.json',
                       'usage-ledger.json', 'sticker-label-journal.json')]
        candidates += [f'files/voice-references/slot-{slot}', f'files/voice-library/slot-{slot}']
    paths = []
    for name in candidates:
        result = call(*adb, 'exec-out', 'run-as', PACKAGE, '--user', current, 'ls', '-d', name, binary=True, check=False)
        if result.returncode == 0 and normal_text(result.stdout.decode('utf-8', 'replace')).strip() == name:
            paths.append(name)
    if 'shared_prefs' not in paths:
        raise RuntimeError('当前应用设置不可读，未开始安装。请先解锁对应空间并导出加密备份。')
    result = call(*adb, 'exec-out', 'run-as', PACKAGE, '--user', current,
                  'tar', '-cf', '-', *paths, binary=True, check=False, timeout=180)
    if result.returncode or len(result.stdout) < 1024:
        raise RuntimeError('备份未完成，未开始安装。')
    hashes = {}
    try:
        with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
            members = archive.getmembers()
            if len(members) > 5000 or sum(m.size for m in members) > 512*1024*1024:
                raise ValueError('snapshot size')
            for member in members:
                name = member.name.rstrip('/')
                if '..' in name.split('/') or not any(name == root or name.startswith(root+'/') for root in paths):
                    raise ValueError('unexpected path')
                if member.isfile():
                    hashes[name] = hashlib.sha256(archive.extractfile(member).read()).hexdigest()
                elif not member.isdir():
                    raise ValueError('links are not portable data')
    except (ValueError, tarfile.TarError) as error:
        raise RuntimeError('备份校验失败，未开始安装。') from error
    if not hashes:
        raise RuntimeError('备份没有文件，未开始安装。')
    (backup/'portable-data.private.tar').write_bytes(result.stdout)
    (backup/'portable-hashes.private.json').write_text(json.dumps(hashes, indent=2), encoding='utf-8')
    return hashes


def uninstall_all(call, adb, report, backup, apply=False):
    """Explicit global removal. Back up every installed user's data or refuse."""
    users=[item for item in report['users'] if item.get('installed') is True]
    plan={'package': PACKAGE, 'action':'uninstall-all-users',
          'installedUsers':[item['user'] for item in users],
          'removesData':True,'applied':False}
    if not apply:return plan
    if any(item.get('installed') is None for item in report['users']):raise RuntimeError('部分空间安装记录不完整，未执行完全卸载。')
    for item in users:
        user=str(item['user']);destination=backup/('user-'+user);destination.mkdir(parents=True,exist_ok=False)
        call(*adb,'shell','am','force-stop','--user',user,PACKAGE)
        # An install record with no launched data still blocks older versions.
        # Do not treat a read permission error as evidence that data is absent.
        if item.get('notLaunched') is True and item.get('ceDataInode')==0:
            (destination/'never-launched.json').write_text(json.dumps(item),encoding='utf-8')
        else:
            snapshot(call,adb,user,destination)
    response=call(*adb,'uninstall',PACKAGE,binary=True,check=False,timeout=180)
    output=normal_text((response.stdout+response.stderr).decode('utf-8','replace'))
    if response.returncode or not re.search(r'^Success\s*$',output,re.M):raise RuntimeError('系统未确认完整卸载；备份保留，未继续安装。'+output.strip())
    after=inspect(call,adb)
    (backup/'after-uninstall.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf-8')
    if after['registeredVersionCode'] is not None or any(item.get('installed') for item in after['users']):raise RuntimeError('卸载后仍有包记录，未把它当作卸载干净。')
    plan.update(applied=True,packageAbsent=True,retainedDataRequested=False)
    return plan


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description='检查工作台安装残留；指定 APK 时保留数据覆盖安装或降级。')
    parser.add_argument('--adb', default=shutil.which('adb') or str(ROOT.parent/'research/android/toolchain/platform-tools/adb.exe'))
    parser.add_argument('--serial', help='多设备时指定 adb 序列号')
    parser.add_argument('--apk', type=Path, help='明确选定的官方同签名旧版或新版 APK；不传时只检查')
    parser.add_argument('--build-tools', type=Path, default=ROOT.parent/'research/android/toolchain/build-tools_r35_windows/android-15')
    parser.add_argument('--java-bin', type=Path, help='apksigner 使用的 Java bin 目录')
    parser.add_argument('--uninstall-all-users',action='store_true',help='列出完全卸载计划；会涉及所有空间的本应用数据')
    parser.add_argument('--apply-uninstall',action='store_true',help='明确执行完全卸载；必须先成功备份所有已使用空间，不使用保留数据选项')
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
        return result if binary else normal_text(result.stdout.decode('utf-8', 'replace')).strip()

    lines = call(args.adb, 'devices').splitlines()[1:]
    devices = [line.split()[0] for line in lines if len(line.split()) >= 2 and line.split()[1] == 'device']
    serial = args.serial or (devices[0] if len(devices) == 1 else None)
    if serial not in devices:
        raise RuntimeError('没有唯一的已授权设备。请连接手机并允许 USB/无线调试；多设备时用 --serial 指定。没有修改手机。')
    adb = [args.adb, '-s', serial]
    report = inspect(call, adb)
    current = str(report['currentUser'])
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.apply_uninstall and not args.uninstall_all_users:raise RuntimeError('--apply-uninstall 必须配合 --uninstall-all-users')
    if args.uninstall_all_users:
        if args.apk:raise RuntimeError('完全卸载与保留数据重装不能同时指定。')
        backup=ROOT/'build/private-reinstall-backups'/('uninstall-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        if args.apply_uninstall:backup.mkdir(parents=True,exist_ok=False)
        plan=uninstall_all(call,adb,report,backup,args.apply_uninstall)
        print(json.dumps(plan,ensure_ascii=False,indent=2));return
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
    timestamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup = ROOT/'build/private-reinstall-backups'/timestamp
    backup.mkdir(parents=True, exist_ok=False)
    (backup/'before.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    hashes = {}
    active = call(*adb, 'shell', 'pm', 'list', 'packages', '--user', current, PACKAGE)
    if listed(active):
        call(*adb, 'shell', 'am', 'force-stop', '--user', current, PACKAGE)
        hashes = snapshot(call, adb, current, backup)
        print('已备份当前空间配置、记忆和音色（含密钥，勿公开）：'+str(backup))
    else:
        print('当前用户未安装；保留 Android 现有数据记录，不执行卸载。')
    result = call(*adb, 'install', '-r', '-d', '--user', current, apk,
                  binary=True, check=False, timeout=900)
    output = (result.stdout+result.stderr).decode('utf-8', 'replace').strip()
    receipt = {'at': timestamp, 'targetVersion': match[3], 'targetVersionCode': int(match[2]),
               'sha256': digest, 'success': result.returncode == 0 and bool(re.search(r'^Success\s*$', output, re.M)),
               'method': 'adb install -r -d', 'portableSnapshotFiles': len(hashes), 'versionConfirmed': False,
               'uninstalled': False, 'clearedData': False}
    (backup/'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    if not receipt['success']:
        print(output)
        if 'VERSION_DOWNGRADE' in output:
            raise RuntimeError('手机系统仍拒绝降级。没有卸载或清理数据；保留诊断记录，改用更高版本号的修复包。')
        raise RuntimeError('系统未确认安装成功。没有改签名、卸载或清理数据。')
    after = inspect(call, adb)
    (backup/'after.json').write_text(json.dumps(after, ensure_ascii=False, indent=2), encoding='utf-8')
    if (after['registeredVersionCode'] != int(match[2]) or
            not listed(call(*adb, 'shell', 'pm', 'list', 'packages', '--user', current, PACKAGE))):
        raise RuntimeError('安装器返回成功，但版本核对不一致；请查看手机安装状态。')
    original_users = {r['user'] for r in report['users'] if r.get('installed') is True}
    after_users = {r['user'] for r in after['users'] if r.get('installed') is True}
    if not original_users.issubset(after_users):
        raise RuntimeError('其他空间安装状态发生变化，请查看诊断；没有执行卸载或删除用户。')
    preserved = True
    for name, digest in hashes.items():
        data = call(*adb, 'exec-out', 'run-as', PACKAGE, '--user', current, 'cat', name, binary=True)
        if hashlib.sha256(data.stdout).hexdigest() != digest:
            preserved = False
    receipt['portableDataPreserved'] = preserved if hashes else None
    receipt['otherInstalledUsersPreserved'] = True
    receipt['currentUserInstalled'] = True
    receipt['versionConfirmed'] = True
    (backup/'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
    if not preserved:
        raise RuntimeError('版本已回退，但部分文件核对不同；未启动服务，原备份保留。')
    print('已保留数据安装 '+match[3]+'。未启动 QQ 或发送消息；旧版能否读取新版数据仍需实际使用确认。', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print('未完成：'+str(error), file=sys.stderr)
        sys.exit(1)
