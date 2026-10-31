# 安装旧版时提示“已安装更高版本”

Android 根据包名和内部 versionCode 判断版本，桌面图标消失不代表所有安装记录都已移除。其他系统用户、应用分身、隐私空间仍安装同一包，或卸载时保留应用数据，都可能让旧版继续被拒绝。只有设备安装记录才能区分具体原因；不是缺少 Python 的证据。

正常升级直接覆盖安装，不先卸载。确需回退到 GitHub 已发布的旧版，可用桌面工具 `tools/android-reinstall.py`。它只处理 `cn.qqworkbench.assistant`，校验官方签名，打印各用户安装记录；使用 `adb install -r -d` 请求系统保留数据安装。不清除数据、不卸载应用、不删除系统用户、不修改系统安装策略。Android 多用户共享 APK 版本，回退会影响该包在其他用户中的代码版本。

需要 Python 3.11+、官方 Android Platform Tools、Build Tools 35 和 Java。仓库工作站已配置工具路径；其他电脑可以用 `--adb`、`--build-tools`、`--java-bin` 指定。

只检查，不改变手机：

```powershell
python tools/android-reinstall.py
```

明确选择已下载的官方旧版 APK，保留数据安装：

```powershell
python tools/android-reinstall.py --apk "D:/Downloads/QQWorkbench-Android.apk" --java-bin "D:/Java/bin"
```

多设备时增加 `--serial 设备序列号`。当前用户仍安装工作台时，工具先停止该用户的工作台，并将 shared_prefs 设置快照保存在 `build/private-reinstall-backups/时间/`；无法备份就停止。快照可能含模型密钥，不要提交 GitHub 或发给别人。这不是完整聊天、记忆及容器备份；安装本身使用保留数据选项，也不保证旧版支持新版的数据格式。

本项目预览包启用了 debuggable，允许 ADB 请求降级。部分厂商仍可能拒绝，工具会保留错误并停止，不自动转成卸载。拒绝时改用内部版本号更高的修复包；签名不符也不能靠降级参数解决。已卸载并删除的数据无法通过重新安装恢复。

当前新增工具尚未在报告此问题的手机上执行。ADB 无设备时不会尝试清理或安装，不能据此声称该手机残留已修复。
