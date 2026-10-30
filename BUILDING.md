# 构建与发布

源码与发行版分离：仓库不存放 API Key、QQ 配置、聊天数据、签名密钥和大型上游二进制。现有安装包可直接从 Releases 下载，首次更新到 0.1.20 后使用软件内更新。

## 助手回归

需要 Node.js 24、Python 3.11+。测试入口先校验并打包固定的离线解析器及8个纯Python依赖，首次需要网络下载锁定的wheel，之后复用本机哈希校验缓存：

```sh
python tools/test-assistant.py --node /path/to/node
```

模拟测试不调用真实 QQ 或付费模型。源码助手需要原生安卓服务和 Linux QQ 桥接，不是运行 assistant.mjs 就能单独登录 QQ。

## 安卓构建

目前提供工作站 Windows 构建入口 build.py，未配置云端签名构建。需要 Python 3.11+、JDK、Android API 35 / Build Tools 35，以及具有相应授权的固定上游资产。

设置 QQWB_JAVA_BIN 指向 JDK 的 bin；QQWB_DSHA_APK 指向构建时固定的 DSHA APK，SHA-256 必须为 1fedf883d431af658d89c28b86d85974cc1d11b74e0c5d46ef3d3cf8650b1961。它是当前固定输入，不等同于同名其他 DSHA 版本。

build.py 预期项目相邻 research/android 目录含 toolchain、DSHA-upstream、snow-source、SnowLuma-arm64 与 releases。固定文件包括：

- SnowLuma-v1.14.22-linux-arm64-lite.tar.gz，SHA-256 c394af290c2fe3f88a31fc2a6b1dc43f432a80ee4b6d767d92d1e0be74a7e0d5
- SnowLuma-v2.2.0-linux-arm64.tar.gz，仅取 Node 运行时
- linuxqq_3.2.34-53644_arm64.deb，SHA-256 181b895cb573548e396e54bb0548cca92ffdc1b1a4b018fa4551bb062385fdca
- 由 native-runtime/snow-preload.c 构建并通过 assets/snow-preload-build.json 校验的加载器

上游地址及许可见 README 和 assets/licenses。当前仓库不是包含全部上游资产的一键云构建，需自行准备上述文件；不应以其他版本绕过哈希校验。

```sh
python build.py
```

首次构建会生成本地签名。维护已有应用必须保留原 build/development-signing.p12 与密码文件；生成新签名不能覆盖已安装版本。这两个文件不得提交到 GitHub。

## Shizuku SDK

构建通过tools/shizuku_deps.py获取固定的Shizuku API 13.1.5（api/provider/shared/aidl）及AndroidX annotation 1.3.0。下载和解包的classes.jar都按tools/shizuku-sdk.json校验SHA-256，保存在build/shizuku-sdk；首次构建需可访问固定Maven地址。Javac和D8均使用这组依赖，相关许可放入APK的assets/licenses。应用不捆绑Shizuku管理器或绕过系统授权。

设备参数策略的主机检查需要org.json 20240303，可用下列命令（设置JSON_JAR为该依赖路径）运行；只校验参数，不操作设备：

```sh
javac -encoding UTF-8 -cp "$JSON_JAR" -d build/device-policy src/cn/qqworkbench/assistant/DeviceCommand.java tests/DeviceCommandCheck.java
java -cp "build/device-policy:$JSON_JAR" cn.qqworkbench.assistant.DeviceCommandCheck
```

Windows类路径分隔符改为分号。实际设备动作仍需安装APK、启动并授权Shizuku后验证。设备工具只读集成检查可运行 `python tests/run-native-settings.py --device-tools`，需已开启设备工具和系统授权；读取电量、检查去重及非大号拒绝，不发QQ或调用模型。

## 后续更新

1. 修改源码和 AndroidManifest.xml 的 versionCode / versionName。
2. 运行回归并构建，使用原签名校验和真机检查。
3. 提交源码；使用已授权的 GitHub CLI 上传新 Releases。软件更新源默认 PythonBBQ/qq-workbench，仅识别最新正式 Release 中唯一的 APK。

```sh
python tools/publish-release.py --notes docs/RELEASE-0.1.33.md --gh /path/to/gh
```

发布脚本从本地 build/build-receipt.json 读取已校验安装包，上传 APK 和 SHA256SUMS.txt，不上传整个 build 目录。不会代替用户确认安卓系统安装。

## 视频验证

视频最多32MB、10分钟，每秒1帧，256×144画面按4×2拼成1024×288 JPEG。每段最多15张低清拼图，完整长视频顺序分析后汇总。预算估算不保证任意中转站的实际图像Token账单；用量页保存服务商实际返回的值。没有音轨与完整字幕转录。

`python tests/run-device-video-budget.py` 可在连接的测试设备容器中生成并解码2/10分钟合成片段，验证帧时间、尺寸、分段预算与临时文件清理；需本机FFmpeg路径适配，默认脚本使用工作站工具目录。不发送QQ消息或调用付费模型。默认安卓框架测试不含shell媒体解码，厂商系统可能将无真实应用上下文的媒体进程终止。

B站视频路径通过固定官方API选择最低码率视频轨，安卓受限流式下载后交给FFmpeg；Cookie只用于B站API，不注入媒体请求、模型和历史。可使用`tests/device-bili-video.mjs`在已启动的测试容器内做公开BV视频下载/抽帧验证，不调用模型或发送QQ。登录页在独立非导出的Activity中打开官方WebView，真实账号登录需用户自行完成；不能从官方App提取登录状态。

搜索视频需使用biliVideoIntent区分新主题与纯指代续看；readBiliSearchFrames先新搜索再选取匹配视频，不能以历史链接补偿失败。tests/device-bili-search.mjs可在独立bili-video-tests目录测试真实公开搜索和解码，需同时复制候选的bili-video、images、browse-intent、web-learning、video模块；不调用模型或发送QQ。


本机视频语音识别由 `tools/build-video-asr.py` 按 `tools/asr-lock.json` 下载并校验ARM64 Sherpa-ONNX运行时和发布者中文模型，打成离线资源。可用 `QQWB_ASR_CACHE` 指定下载缓存；默认位于相邻的 `research/android/asr`。首次构建需下载约90MB，模型及运行库解压约100MB；APK内增加约63MB。转写无需额外API Key或云端声音上传。
