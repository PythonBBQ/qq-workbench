# 设备能力、用量和聊天风格：2026-10-29 调研

先查阅以下 GitHub 项目及源码，再确定本版实现。

| 资源 | 本版用途 |
| --- | --- |
| [RikkaApps/Shizuku](https://github.com/RikkaApps/Shizuku) | 免Root的安卓Shell服务及官方管理器；管理器由用户安装并系统授权 |
| [Shizuku-API](https://github.com/RikkaApps/Shizuku-API) | 实际集成MIT SDK 13.1.5，Provider与UserService桥接；采用官方demo的Context构造方式 |
| [libadb-android](https://github.com/MuntashirAkon/libadb-android) | 调研无线ADB/TLS配对；本版未引入，避免同时维护第二套设备连接 |
| [SillyTavern tokenizer](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/tokenizers.js) | 参考Token预算和上下文思路；本版使用服务商实际usage记录，不将字符估算冒充账单 |
| [LiteLLM](https://github.com/BerriAI/litellm) | 参考多协议用量记录思路；未捆绑完整代理或复制其源码 |

Shizuku SDK与AndroidX annotation下载地址及SHA-256固定在tools/shizuku-sdk.json。构建下载只取固定依赖，包和classes.jar均校验；相关许可见assets/licenses/Shizuku-DEPENDENCIES.md。用户授权仅允许当前大号经工作台已支持的设备动作使用Shell能力，群成员和角色卡不能取得此权。

设备动作只通过ProcessBuilder的独立参数执行，模型生成文字不送入sh -c。模型只能规划已有动作，不提供自主读屏。执行前保存动作标识，结果不确定时停止；不把系统命令退出0描述为已经核对屏幕效果。

自然聊天继续统一在酒馆，采用有界的风格提示；没有引入额外人格服务或声称在线训练权重。Token记录与聊天正文分离，保留窗口有上限，缺失usage如实展示。
