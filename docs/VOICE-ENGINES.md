# 语音选择与情境表达

调研日期：2026-10-31。以下为当日公开文档所述能力，不代表已在本机完成各引擎推理。

0.1.41 已集成并实测 ZipVoice-Distill INT8 与 sherpa-onnx；使用方法、体积、许可与测试范围见 [低配语音说明](LIGHTWEIGHT-VOICE.md)。

## 本版如何决定是否发语音

智能模式在原有聊天请求里增加简短的输出形式说明。聊天模型结合本次消息、已筛选的历史与记忆，选择文字或语音，并可选择自然、开心、温柔、轻柔害羞、难过或认真这几种语气意图。控制标记在保存回答、转换语音与发QQ之前剥离，不作为聊天文字或发给TTS朗读。每轮不另加一次判断模型调用，但说明与标记本身仍占少量输入/输出Token。

本机仍检查语音开关、明确文字要求、最近不方便听的要求、长内容与可复制内容、群聊主动插话和发送间隔。明确要求语音时优先尝试；生成失败返回文字，发送回执不确定则不再发一份文字或重发语音，以免重复。可调整语音倾向和20–180秒自动语音间隔；关闭语音时模型标记不能自行开启。用户明确重新要求语音可替代较早的拒绝。

## 声音引擎比较

| 引擎 | 已有接法与表达能力 | 条件与本版验证范围 |
|---|---|---|
| ZipVoice 本机语音 | 按号导入准确录音与文字，使用同一说话人的语气参考；多号共享单个 CPU 模型 | 已在测试平板合成中文和中英混读。默认系统声音参考，不是肥鱼音色；未导入语气回退自然，不以变音高伪装情绪。模型 CC-BY-NC 非商业，离线推理不产生云端语音 Token。 |
| Android系统TTS | 使用设备已有音色；按语气做有限语速/音高微调 | 本版已在平板合成、转码并获得QQ发送回执；用户已确认收到测试与普通聊天语音。微调不等于专门训练的情绪模型；是否离线由系统引擎决定。 |
| Azure Speech | 保留独立Speech Key；晓晓使用支持的cheerful/gentle/sad/serious样式，其他音色维持基础语音 | 需服务商额度；害羞意图近似为gentle，不能宣称是独立娇羞音色。SSML映射有回归测试，未用真实Azure额度试听。 |
| 肥鱼声音服务 | 本版独立实现公开HTTP协议：提交一次、鉴权轮询成功、下载WAV、转MP3发QQ；可爱/温柔可固定或按语气意图选择 | 必须另行部署可达的声音后端并填写其独立Key。服务、权重与参考音频未捆入APK。接口模拟已验证，尚未在本机部署GPU推理，因此不能称已换成肥鱼音色。 |
| QQ群音色 | 保留原有群内音色选择 | 仅群聊，没有本版可控情绪参数。 |

肥鱼TTS的可爱/温柔由现有checkpoint与参考音频路由实现，普通说话不再串一次RVC。RVC接收已有音频换声，不是文字直接发声。其公开说话接口仅接受`style=cute/gentle`，没有`shy`参数，也没有本版声称可直接使用的任意情绪指令。本版将温柔、轻柔害羞、难过、认真意图映射到gentle，其余映射cute；这是声线选择，不是完整情绪合成。

当日模型仓库列出的TTS文件合计约7.45GB，另需推理依赖和显存；官方路线偏向Windows+WSL及GPU。当前工作站有RTX4060 Laptop，未安装WSL；未为本次接入修改系统组件或下载大模型。手机要连电脑服务时填手机可达的地址，`127.0.0.1`表示手机自身，不是电脑。

## 后续情绪引擎候选

| 项目 | 公开能力 | 与当前肥鱼服务的关系 |
|---|---|---|
| [CosyVoice](https://github.com/FunAudioLLM/CosyVoice) | 支持语言、方言、情绪、速度等指令；按所选模型/接口确认 | 肥鱼已基于CosyVoice3，但其当前公开接口未暴露完整情绪指令，不能直接补一个参数就声称生效。 |
| [IndexTTS](https://github.com/index-tts/index-tts) | 情绪参考音频、情绪描述、8维情绪向量；当日主分支为2.5 | 音色与情绪可分别控制，适合做后续独立GPU服务；“害羞”需要适当参考或描述试听，不是8维向量中的独立一项。未接入或安装。 |
| [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | 提供0.6B和1.7B；Base支持参考克隆，CustomVoice预置说话人可配表达指令，VoiceDesign用文字描述设计音色 | 不能把各型号能力混为一谈。可作为后续较小模型候选，但未验证安卓部署、耗时和内存；没有随本APK安装。 |
| [Fish Speech](https://github.com/fishaudio/fish-speech) | 当日文档支持whisper/angry/laughing等行内表达标签 | 另有模型、服务接口与许可；并非肥鱼RVC声库。未接入或安装。 |

0.1.42再次核对官方README：CosyVoice当前为Fun-CosyVoice3-0.5B-2512；IndexTTS为2.5；Fish Speech主推Fish Audio Drama 3，不再把S2-Pro当作最新。当前设备实测的是ZipVoice肥鱼参考克隆，不是完整肥鱼CosyVoice权重。更强的节奏与情绪表达需要换相应引擎并实际试听；短句规划、速度或提示词微调无法保证达到真人听感。电脑GPU为RTX4060 Laptop、8GB显存，只完成硬件查询，未跑这些候选，不能承诺具体显存或速度。

来源：[肥鱼项目](https://github.com/Esmerubphire/astrbot_plugin_feiyu_voice)、[HTTP接口](https://github.com/Esmerubphire/astrbot_plugin_feiyu_voice/blob/main/server/README.md)、[模型包](https://huggingface.co/Esmerubphire/FeiyuVoice-CosyVoice3)、[原始素材署名与授权说明](https://github.com/Esmerubphire/astrbot_plugin_feiyu_voice/blob/main/COPYRIGHT.md)。上游没有为其本地原创源码赋予一揽子开源许可，本版不复制或分发该插件源码、模型或录音，仅按公开协议编写客户端。各引擎与模型仍适用各自条款。
