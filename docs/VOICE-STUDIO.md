# 电脑增强语音与长篇工作台

手机内置 Kokoro 可以独立离线使用。这里的 IndexTTS、肥鱼完整 CosyVoice3 与 RVC 需要电脑服务在线，不会把 CUDA 权重当成安卓可运行模型塞进 APK。手机在“能力→语音→肥鱼声音服务”选择电脑引擎；已有语音设置不会自动覆盖。

| 选择 | 合成路线 | 表达方式 |
|---|---|---|
| 肥鱼原模型 | 肥鱼 CosyVoice3 完整权重 | 按已发布的可爱、温柔配置选择 checkpoint 和参考音频 |
| 肥鱼参考音色 | IndexTTS2 + 已校验的肥鱼参考音频 | 聊天现有情绪标签映射到八维情绪控制；这属于参考克隆，不是加载肥鱼原模型 |
| IndexTTS + 肥鱼 RVC | 上一条合成后再经过完整肥鱼换声模型 | 更慢，两个 GPU 引擎依次运行；是否更好听需实际试听 |

没有单独训练“害羞”权重，轻柔害羞是温柔参考和轻量情绪组合的近似。聊天不额外调用模型来判断情绪；语音处理在电脑完成，增加本机计算和耗时，不产生云端 TTS Token。聊天模型正常用量照常统计。

## 导出到平板本地

可以先在电脑生成六种参考，再由平板内置的小模型独立合成新文本。六种参考共用一份 ZipVoice-Distill INT8，不会复制六套模型。参考音频只能传递部分音色和语气，不能把 IndexTTS / CosyVoice / RVC 权重转成通用的小模型 embedding；本流程不进行新训练或权重蒸馏。

电脑声音服务启动后运行：

```powershell
python tools/export-feiyu-reference-pack.py --runtime .voice-studio --output local-voice-references --bundle-to assets/feiyu-six-references.zip
```

工具按自然、开心、温柔、害羞、难过、认真逐条生成，校验完整 WAV 后重采样为 24kHz 单声道 PCM，保存对应文本、生成记录和 SHA256，不通过裁掉后半句满足时长。固定六段为 1–10 秒，生成失败保留已完成的可校验进度。默认路线为 IndexTTS 后接肥鱼 RVC；`--voice feiyu-index` 可直接导出参考克隆。

重新构建 APK 后，语音页出现“一键使用肥鱼六种语气”。也可使用“导入六种语气参考包”选择 `Feiyu-Six-References.zip`；保存为参考克隆后即可本机运行。导入会保留所选账号的原参考目录作为备份。生成的个人参考包已从源码提交中排除，不自动公开上传。

本机实际导出包约 0.8MB，六段约 3–4 秒；平板全部六种参考已实际用于合成新句子，首次约 6 秒，后续约 3–4 秒。以上为本次短句、4 步推理数据，长文本与其他设备耗时另计。情绪强度和声线相似程度仍以用户试听为准。

## 准备与启动

当前适配目标为 Windows、NVIDIA CUDA 和 Python 3.11。RTX 4060 Laptop 8GB 是本次测试机器；不把该结果视为其他显卡或文本的性能保证。建议电脑预留 50GB 空间，权重与独立 Python/CUDA 环境明显大于 APK。

安装 Git 和 [uv](https://docs.astral.sh/uv/) 后，在源码根目录运行：

```powershell
python tools/prepare-voice-studio.py --runtime .voice-studio --start
```

网络需要显式代理时可追加 `--proxy http://127.0.0.1:7897`。所有环境、Python、缓存、权重和配置放在所选目录，不修改系统 Python 或全局 PATH。源码与模型固定 revision，下载支持续传，文件完成后核验 SHA256 或 Git blob SHA1；中断可重跑。首次准备要下载约 16GB 模型及额外运行依赖，不代表已完成声音验收。

依赖安装现在优先使用同盘硬链接共享一致的包文件，准备成功后清理可重新下载的 uv 包缓存。清理不会移除已安装环境的链接，也不清理声音权重、参考或 Hugging Face 模型。频繁离线重建环境时可加 `--keep-package-cache` 保留下载缓存。不要在这些共享的第三方库中直接编辑文件；自有兼容修改放在独立适配器里。

以后运行：

```powershell
powershell -File tools/start-voice-studio.ps1 -Runtime .voice-studio
```

本机编辑页面：`http://127.0.0.1:7860/longform`。包含长篇台本、音色参考库、多轨编辑、混响、空间音频和工程导出；这些是原工作台制作功能，不会自动执行或发布作品。手机只使用独立的合成接口。

手机走同一局域网时，启动器可加 `-ListenAddress 0.0.0.0`，在手机填 `http://电脑局域网IP:9880`，以及本地 `gateway-key.local.txt` 中的独立服务 Key。Studio 原编辑和管理接口始终只绑定电脑回环地址；外部合成接口全部验证 Bearer Key。不要把服务 Key 当聊天模型 Key。手机的 `127.0.0.1` 指手机自己；USB 调试可由电脑使用 `adb reverse tcp:9880 tcp:9880` 建立临时通道，断开 USB 后该方式失效。

## 执行与回退

聊天合成与台本生成共用同一把 GPU 锁。切换到肥鱼原模型或 RVC 前释放 IndexTTS 显存；原生肥鱼进程结束后释放自身资源。情绪模型不为每条聊天额外常驻，默认使用直接向量。单次任务只提交一次；手机最多等待 135 秒，断网或合成失败回退文字，不重复提交未知状态的 GPU 任务。发送结果不确定时仍不自动重发。

输出需完整生成并检查 WAV 后才交手机转码，不向用户发送部分生成的音频。手机文本上限 1200 字，常规语音回答维持简短；长篇作品在电脑台本页面制作，不能把聊天的等待时间当作无限长作品的预算。

## 电脑指导平板的本地校准

`tools/calibrate-tablet-voice.py` 使用当前第一版六语气参考，对比电脑 IndexTTS2 + 肥鱼 RVC 和平板独立合成的相同文本。它只读取本地凭据，不发送 QQ、不改账号配置或音色、不调用付费聊天模型。短句、完整句、段落和较长段落分别比较当前 4 步分段、4 步整段和 8 步分段；成功音频按哈希复用，未知提交不自动重发，电脑任务共用现有 GPU 串行锁。

```powershell
python tools/calibrate-tablet-voice.py --runtime .voice-studio --output local-calibration --serial 设备序列号
python tools/analyze-voice-calibration.py --directory local-calibration
```

输出包含 WAV、转写、句尾检查、生成耗时和停顿统计。当前工具要求输出目录与项目位于同一个工作站根目录，并要求安卓端仍在使用第一版 `feiyu-index-rvc` 参考包。这里是校准语料和参数评估，不是权重训练或蒸馏。不能从几条样本或说话人向量推断自然度，更不能把 IndexTTS 的 embedding 直接当成 ZipVoice 权重。

本次 16 条实测均保留句尾，但 4 步整段的一条约 31 字句子出现明显转写差异；8 步分段在约 31 字句子上耗时 10.39 秒，当前 4 步为 5.50 秒，较长段落为 26.25 秒和 13.63 秒。因此保留原 4 步与安全分段，不根据这组样本替换第一版音色或全局关闭分段。ASR 差异不等于听觉评分，仍须试听。

源码补充了拼接时的静音去重：只补足段尾已有静音与下一段开头静音之外缺少的停顿，不移除任何原始人声采样、不改音高、不产生云端用量。`tests/SpeechRhythmCheck.java` 验证 16/24/48 kHz、已有静音、弱噪声、轻声起音和样本完整保留。`tools/compare-voice-rhythm.py` 可用平板现场生成的相同片段制作原拼接/新拼接 A/B，避免不同轮合成的随机变化干扰比较。本次真实三段样本没有达到保守的静音识别阈值，拼接结果相同，不能据此宣称已经提升听感。

真正的声音微调需要收集并核对足量同音色语料，在电脑训练小模型后再进行 ONNX 导出、量化和安卓 CPU 验证。当前没有新训练权重，也没有把电脑 CUDA 模型加入 APK。校准与源码检查不代表已更新设备安装包。

## 来源与许可

- [IndexTTS2 Studio](https://github.com/lfandrh/indextts2-studio)，固定 `3004e8494c7e783de4bdb7da3f5552d6d5b7c115`。
- [长篇语音工作台](https://github.com/Mars-1438/indextts2-longform-workbench)，固定 `dcaee86bdd572d6db8b5e0bae97cba511534d114`，其扩展代码采用 MIT。
- [肥鱼声音项目](https://github.com/Esmerubphire/astrbot_plugin_feiyu_voice)，固定 `76774b499f7d306454562d56348dd63399b6d7e8`；完整 TTS、RVC 权重、参考和来源说明从作者公开模型包下载。

IndexTTS 代码与模型适用其 Bilibili Model Use License，不改称 MIT。肥鱼原始素材、声音及衍生权重保留作者版权和来源条款；参考录音不是用户本人录制。本仓库仅分发独立桥接、准备工具和校验清单，不复制分发这些上游源码、训练数据或 GPU 模型；准备工具直接获取上游固定版本并保留其许可。原生 Windows CUDA 路线使用本项目适配和本机验证，不冒称上游官方 WSL 认证。
