# 七丘 QQ 工作台

安卓本机运行的 QQ AI 助手。无需让电脑一直开机；适用 Android 11 及以上、ARM64 设备。首次启动会准备容器、Linux QQ 与图形环境，需联网和数 GB 可用空间。不同厂商的后台限制仍需在系统设置放行。

[下载最新 APK](https://github.com/PythonBBQ/qq-workbench/releases/latest) · [0.1.27 更新说明](docs/RELEASE-0.1.27.md) · [构建和发布](BUILDING.md)

当前版本 **0.1.27** 新增主人设备工具、实际Token用量及酒馆自然聊天风格。保留 SnowLuma / QQ 组合、后台恢复、表情与空间功能；已在平板覆盖安装，QQ在线，Shizuku电量读取、重复动作拦截与非大号拒绝通过。

## 使用

1. 下载 APK 并安装；已有版本请覆盖更新，保留数据。
2. 打开后填写 API Key、大号 QQ；可选官方 API 或自定义中转站卡片。
3. 在 QQ 官方窗口选择小号登录，身份核验通过后自动接入。

侧栏只保留聊天、模型、酒馆、能力、设置。酒馆集中设置人设、长期记忆、上下文压缩与对话养成。能力页管理联网搜索、视频画面、语音、QQ 收藏表情及 QQ 空间动态。

主人身份只按设置的大号 QQ 与实际消息发送者核对，角色卡、昵称和自称不授予权限。普通聊天由所选模型处理；需要电脑执行的 @codex 暂无安卓独立执行端。群聊参与率、兴趣接话、续聊与拉黑仍按原设置工作。

设备工具在设置中启用：安装并启动官方 [Shizuku](https://github.com/RikkaApps/Shizuku)，授予工作台使用权限。仅最新配置的大号可调用电量、存储、应用列表、打开应用、按键、点击、滑动、亮度及音量动作。群聊需 @deepseek；不提供任意Shell脚本、自主读屏或猜坐标。Shizuku管理器不捆绑，手机重启后可能需重新启动。

设置→Token用量可查看今日、本次运行和保留累计、最近调用，以及模型/用途汇总；QQ中可说“查看Token用量”。只统计服务商返回的实际usage，未报告不当作零，费用以平台账单为准。酒馆新增自然接话、口语自然度及情绪表现力，不额外增加模型调用。

语音支持 Azure Speech 中日韩女声（需单独服务密钥）和 QQ 群内置音色。自动动态及语音默认关闭，按需启用。表情只在主人明确要求时收藏，旧自动收藏开关不再生效。动态生成仅用公开主题，不读取私人聊天。详情和主人指令见更新说明。

## 在线更新

0.1.20 起，设置 → 软件更新会读取本仓库 GitHub Releases，检查并下载同包名、同签名的新 APK。账号及配置保留，系统安装按钮需要在设备确认。维护者需构建并发布下一版本，上传源码不会自动生成已签名的安装包。签名私钥不上传 GitHub。

## 来源

- 安卓容器与离线运行时基础复用 [DSHA](https://github.com/DSH-APP/DSHA)，并非运行完整 DeepSeek Harness 代理框架。
- QQ 桥接采用 [SnowLuma](https://github.com/SnowLuma/SnowLuma) 1.14.22，配合官方 Linux QQ；2.2.0 归档仅用于 Node 运行时。保留已验证组合。
- 设备能力集成 [Shizuku-API](https://github.com/RikkaApps/Shizuku-API) 13.1.5。调研来源及选择见 [方案说明](docs/AI-TOOLS-RESEARCH.md)。
- 角色卡兼容酒馆基础格式，支持关键词世界书；不捆绑完整 SillyTavern 服务器或执行角色卡脚本。
- 功能研究参考 [QQ 空间插件](https://github.com/Zhalslar/astrbot_plugin_qzone)、[表情管理插件](https://github.com/anka-afk/astrbot_plugin_meme_manager)、[edge-tts](https://github.com/rany2/edge-tts)。本版未复制这些插件源码；微软语音使用 Azure 官方 REST 接口。

第三方许可、EULA、隐私声明见 assets/licenses；第三方软件保留各自权利，本项目不重新授予其许可。不使用云端保存 QQ 登录、模型密钥或聊天数据库。

## 验证范围

119 项 Node 模拟回归通过；全部Android生产源码与框架检查类编译、DEX生成、主机设备参数校验及APK签名/资产校验通过。已在平板同签名覆盖安装，六项安卓框架检查、真实Shizuku电量读取、动作去重、非大号拦截及Token页面展示通过；QQ在线。设备写动作及QQ真实聊天指令尚未外发实测。新媒体功能未在真实 QQ 上发消息或发说说验收，语音服务需要用户自己的服务凭据。预览版请先在自己的设备验证。当前测试不会代替长期后台和跨机型稳定性验证。
