# 构建与发布

源码与发行版分离：仓库不存放 API Key、QQ 配置、聊天数据、签名密钥和大型上游二进制。现有安装包可直接从 Releases 下载，首次更新到 0.1.20 后使用软件内更新。

## 助手回归

需要 Node.js 24：

```sh
node --test tests/*.test.mjs
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

## 后续更新

1. 修改源码和 AndroidManifest.xml 的 versionCode / versionName。
2. 运行回归并构建，使用原签名校验和真机检查。
3. 提交源码；使用已授权的 GitHub CLI 上传新 Releases。软件更新源默认 PythonBBQ/qq-workbench，仅识别最新正式 Release 中唯一的 APK。

```sh
python tools/publish-release.py --notes docs/RELEASE-0.1.20.md --gh /path/to/gh
```

发布脚本从本地 build/build-receipt.json 读取已校验安装包，上传 APK 和 SHA256SUMS.txt，不上传整个 build 目录。不会代替用户确认安卓系统安装。
