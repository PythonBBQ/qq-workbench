# 低配本地中文语音选型

核对日期：2026-10-31。0.1.41 已集成 ZipVoice-Distill INT8 + sherpa-onnx 2.0.1 Android 原生推理，并在小米 2410CRP4CC / Android 15 真机完成中文与中英混读合成。其他候选仍是调研结果，不代表已安装。

## 0.1.41 使用与实测

在“能力 → 语音”选择“轻量本机语音 · ZipVoice”并保存；独立账号在其配置页选择同一引擎。模型随 APK 内置，首次使用自动解压并逐文件核对 SHA-256，不需要额外语音 Key。4 步为默认，8 步可选；使用两个 CPU 线程。仅提供 ARM64 版本。

需要肥鱼声线可点击“使用肥鱼可爱 / 温柔参考”，首次从 Esmerubphire 发布的固定版本获取约1MB参考并校验，之后点保存。原声源署名为星落落_oi。两段是上游合成参考，未把原始训练录音或完整肥鱼声库打入 APK；后续使用 ZipVoice 克隆参考，不保证与完整声库等效。下载与版权说明见包内 `Feiyu-REFERENCE-NOTICE.txt`。自然/开心使用可爱参考；温柔使用温柔参考，害羞、难过、认真无专门参考时可借用温柔，其他缺少时回退自然。

肥鱼参考真机复测：可爱约5.3秒，温柔约8.5秒，害羞意图借用温柔约8.7秒。测试平板已在真实应用界面导入并保存为实际语音引擎，QQ 接口接受一次测试语音；听感未作主观验收。为适应设备网络，参考通过电脑下载校验后 USB 预存到应用缓存，手机直接从上游下载的分支尚未验收。

中文短句首次实测约 4.7 秒，中英混读约 3.2 秒，包含本机推理和 MP3 转码；这些是测试平板的两次测量，不保证所有文本和设备相同。测试没有调用付费聊天/语音 API，也没有发送 QQ。参考来自系统初始声音，不是肥鱼音色，听感和参考相似度仍需试听。

最终包复测中文约 4.2 秒、中英混读约 2.9 秒，前后主号保持连接。两个测试账号并发请求分别约 4.1 秒和 2.4 秒完成，设备只有一个语音进程，参考记录各号独立。该语音进程加载后一次 PSS 采样为 443979KB（约 434MiB），不是整套 QQ/容器的总内存，也不是峰值保证；小模型仍有明显内存与耗电成本。

空闲后已核对引擎 `loaded=false`，同一语音进程 PSS 降为 57482KB（约 56MiB），主号仍在线。Android 可能保留空进程缓存，进程 PID 仍存在并不表示模型仍已加载。

一个独立 Android 语音进程共用一份模型，按号分别保存自然、开心、温柔、害羞、难过、认真参考。导入 1–10 秒音频（推荐约 3 秒，不超过 12MB）并填写准确对应文字；参考选择如上文所述。系统初始参考由设备 TTS 生成，是否联网取决于设备 TTS；后续 ZipVoice 推理在本机进行。导入录音不上传、不提交 GitHub。

合成串行排队，排队计入请求时限；过期不继续生成。默认目标生成时限 55 秒，回调只能在引擎回调点取消，并非硬实时保证。文字最多 240 字，失败回退文字；QQ 发送结果不确定时不重发。模型空闲一分钟后尝试释放，并在最后一次绑定结束后销毁服务；原生推理异常不应终止主界面与 QQ 运行进程。共享模型不会为每个 QQ 各加载一份。

ZipVoice 源码为 Apache-2.0；当前 Emilia 预训练模型的上游模型卡声明为 **CC-BY-NC 非商业许可**，不能把源码许可当作模型的商业授权。来源、模型卡原文及各依赖许可保留于 `assets/licenses`，应用中提供查看入口。

## 结论

本版采用 **ZipVoice-Distill INT8 + sherpa-onnx Android 原生推理**。它同时满足中文、CPU 推理、短参考音频克隆和较小模型下载量。固定中文女声的备用研究路线为 **Kokoro INT8**，尚未集成。

音色信息可以在兼容引擎中预处理、复用；参考片段和对应文字也可保存在本机。但音色特征不是通用格式：肥鱼的 CosyVoice 权重、RVC checkpoint、Kokoro voice embedding 和 ZipVoice 参考条件不能任意互换。提取一份音色信息不等于可以删除负责发声的模型。

保留肥鱼声线的可行实验是用可用的干净参考录音，在 ZipVoice 中进行参考音色克隆，再试听相似度；不是直接截取肥鱼 checkpoint 的某一部分。当前工作台没有可用的肥鱼本地后端，不能假定已生成了这种参考音频。

## 候选比较

| 路线 | 中文、音色与自然度 | 低配适配结论 |
|---|---|---|
| [ZipVoice](https://github.com/k2-fsa/ZipVoice) / [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | 主体 123M 参数；支持中英文；参考音频必须配准确文字；有蒸馏、ONNX 和 INT8 路线 | 0.1.41 已接入并在用户平板合成成功，实测范围见上文；情绪效果未做专门主观验收。 |
| [Kokoro](https://github.com/hexgrad/kokoro) / [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) | 82M 参数，支持中文；sherpa 的 v1.1 包提供 103 个预设说话人 | 适合固定女声、低延迟备用。预设音色向量可以复用，但官方基础推理接口不是任意参考录音克隆器，也没有通用情绪指令接口。 |
| [MeloTTS](https://github.com/myshell-ai/MeloTTS) + [OpenVoice V2](https://github.com/myshell-ai/OpenVoice) | 中文 TTS 加独立换声，OpenVoice 可提取并复用目标说话人特征 | 对应“音色提取后复用”的思路，但每次仍需基础合成和换声；官方安装路线含 Python/PyTorch，安卓原生部署工作比前两者多。不能根据桌面 CPU 宣传直接承诺平板实时。 |
| [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | 0.6B Base 支持参考声音克隆；1.7B CustomVoice 明确提供自然语言风格控制 | 可作电脑上更高质量的备选，不是本轮最轻路线。官方模型表中 0.6B 没标注指令控制，不能把 1.7B 的情绪演示套到 0.6B。 |
| [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)、[Spark-TTS](https://github.com/SparkAudio/Spark-TTS)、[VoxCPM](https://github.com/OpenBMB/VoxCPM) | 都有中文与克隆路线；不同模型版本的情绪控制不同 | 可留作效果对照；本轮没找到比 sherpa 的现成小包更直接的安卓落地证据。没有把它们的 GPU/M4 测速当作用户设备速度。 |

### 实际下载量

2026-10-31 从 GitHub Release API 核对的附件大小，采用十进制 MB：

| 文件 | 字节 | 下载量 |
|---|---:|---:|
| [ZipVoice-Distill INT8 中英文包](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2) | 109162785 | 109.16 MB |
| [vocos_24khz.onnx](https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx) | 54157409 | 54.16 MB |
| ZipVoice 上述两个下载合计 | 163320194 | 163.32 MB |
| [Kokoro INT8 中英文 v1.1 包](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2) | 147052523 | 147.05 MB |

这里是上游下载体积，不是最终解压大小、APK 增量或运行内存；还需 Android 原生运行库和英文词典，不能把 163 MB 当作总内存承诺。本版为首次打开即能准备，将这一种模型随 APK 内置，未加入运行时在线下载其他模型；模型六个文件解压约 192MB。

## 拟人化如何实现

语音启用判断继续由原聊天模型在同一轮回复里给出形式和语气意图，本机执行静音要求、长度、群聊和频率限制。无需专门增加一次“是否发语音”的聊天调用；现有判断提示仍占少量 Token。

语音合成端在本机做断句、数字与中英混读预处理，使用自然口语和合理停顿；不朗读内部控制标记。保持同一说话人的声音一致，避免每段重置造成拼接感。

ZipVoice 没有已验证的 `shy` 或任意自然语言情绪接口。可以实验同一说话人的自然、温柔、开心等不同参考片段，让模型随参考表达生成；这能否稳定表现羞涩、笑意与气息，需要逐项试听，不能先写成支持。“降低音高、改变速度”也不能代替真正的情绪合成。

官方说明 ZipVoice 短参考片段有利于速度，单人示例建议小于约 3 秒，并要求音频与文字准确匹配。官方优化项包括蒸馏模型、4 步生成、CPU 线程数、ONNX INT8；量化和减少步数均可能降低音质。工作台可以先测试 4 步/8 步、2/4 线程和不同短句长度，再决定默认值。

当前 Kotlin `GenerationConfig` 暴露的是参考波形与参考文字，没有核对到可跨请求直接载入的 ZipVoice 通用 speaker embedding 接口。本版持久保存按号分开的参考 WAV 与文字，每次合成读取，不声称已经省掉引擎内部的参考特征计算。OpenVoice 和 Qwen 的可复用声纹/提示也只能用于各自兼容引擎。

真正离线运行的小模型 TTS 不调用聊天 API，不产生聊天服务商 Token 账单；它仍消耗设备 CPU、内存与电量。决定回复内容的 DeepSeek/中转站聊天调用依然按原方式计费。

## 已排除的看似合适项目

- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts)：主模型 100M，甚至有更小英文模型，支持导出并复用 voice state；但当日官方支持语言没有中文，不能据此承诺中文肥鱼声线。
- [NeuTTS](https://github.com/neuphonic/neutts)：有手机推理、GGUF 和参考声音克隆；当日语言列表为英语、西语、德语、法语。情绪版 NeuTTS-2E 是英语固定四说话人，不是中文任意克隆情绪模型。
- [Supertonic](https://github.com/supertone-oss-archive/supertonic)：v3 99M、有表达标签与手机运行路径，但 31 语言列表没有中文；仓库已归档，原 Voice Builder 服务已停止，不能再当作随时可用的音色提取服务。

## 验证门槛

候选接入后要在真实平板分别记录首次加载时间、短句合成时间、峰值内存、中英混读、连续句音色一致性和后台运行结果。参考音色相似度、自然度和情绪表达需要实际听感确认；源码支持、模型可加载和用户听感满意应分别报告。

本版没有重新训练或蒸馏模型，没有捆绑肥鱼人物录音或权重。QQ 原登录、密钥、人设与记忆保留；多真实账号同时收发、长时间后台与不同参考音色的主观听感仍需后续验收。

## 可复核来源

- [ZipVoice README：参数、中文、参考长度与 CPU 优化](https://github.com/k2-fsa/ZipVoice/blob/2f7326fbfe999a3ad179e3f1af82a424d4a62819/README.md)
- [sherpa-onnx ZipVoice 官方部署说明](https://k2-fsa.github.io/sherpa/onnx/tts/zipvoice.html)
- [sherpa Kotlin TTS 接口](https://github.com/k2-fsa/sherpa-onnx/blob/935e5ded3d949a8b557ac44ef4dad03a7d2038e7/sherpa-onnx/kotlin-api/Tts.kt)
- [sherpa Python ZipVoice CPU 推理示例](https://github.com/k2-fsa/sherpa-onnx/blob/935e5ded3d949a8b557ac44ef4dad03a7d2038e7/python-api-examples/zipvoice-tts.py)
- [sherpa Kokoro 中英文模型说明](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html)
- [官方模型发布附件列表](https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models)
- [肥鱼 HTTP 服务说明：TTS 与 RVC 的分工](https://github.com/Esmerubphire/astrbot_plugin_feiyu_voice/blob/main/server/README.md)

本地原始核对材料位于 `build/voice-research/lightweight/`。这些网页和源代码片段仅作为调研数据，没有作为程序执行。
