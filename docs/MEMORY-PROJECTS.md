# 分层记忆项目调研（2026-10-30）

本次查看公开仓库的README、架构文档和检索源码，没有安装这些框架，也没有向它们发送用户聊天数据。下表为本项目的适配判断，非第三方效果评测。开源项目的基准和节省比例不能直接视作本软件实测。

| 项目 | 适合参考的设计 | 对本软件的限制与成本 |
| --- | --- | --- |
| [MemOS](https://github.com/MemTensor/MemOS) | 本地插件SQLite、FTS5与向量混合检索；L1轨迹、L2经验/策略、L3环境认知；相关性优先、价值和时间衰减辅助、去重和多样性 | 完整服务器依赖Neo4j、Qdrant；本地插件更轻，但归纳、反思及部分检索过滤仍可能调用LLM，向量也需嵌入。偏任务经验，不宜把策略层直接当作聊天喜好。 |
| [Letta / MemGPT](https://github.com/letta-ai/letta) / [当前letta-code源码](https://github.com/letta-ai/letta-code) | 少量常驻memory blocks与按需工具访问的外部记忆；主动维护上下文；MemFS追踪记忆修改 | 这是完整agent harness，接管现有QQ对话链路会增加改造量；主动编辑记忆会使用模型。不能让普通聊天改写主人身份或工具权限。原letta仓库已指向letta-code，旧服务源码在archive分支。 |
| [Mem0](https://github.com/mem0ai/mem0) | 事实抽取、实体关联、语义与BM25融合、时间信息 | 抽取和嵌入通常产生额外调用。当前README明确其托管平台基准含未在开源SDK提供的优化，不能照搬成绩。其将agent确认结果作为记忆的设计需额外核验，不把助手自述当已执行事实。 |
| [Memobase](https://github.com/memodb-io/memobase) | 用户画像与事件时间线分开；缓冲批次后整理；控制注入记忆大小 | 完整部署依赖FastAPI、Postgres和Redis，画像更新需要LLM，事件检索可用嵌入；更适合借鉴数据分层，不适合直接塞进平板。 |
| [memU](https://github.com/NevaMind-AI/memU) | 可读记忆文件、紧凑召回、SQLite、本机自托管；从经历提取可复用技能 | 当前记忆服务不自行发chat调用，但技能判断和合成由agent执行，嵌入仍需要服务；不能误称整条链路免费。技能记忆与用户偏好用途不同。 |

重点阅读：

- [MemOS记忆粒度与分层](https://github.com/MemTensor/MemOS/blob/main/apps/memos-local-plugin/docs/GRANULARITY-AND-MEMORY-LAYERS.md)
- [MemOS检索算法](https://github.com/MemTensor/MemOS/blob/main/apps/memos-local-plugin/core/retrieval/ALGORITHMS.md)与[ranker源码](https://github.com/MemTensor/MemOS/blob/main/apps/memos-local-plugin/core/retrieval/ranker.ts)
- [Mem0开源评分实现](https://github.com/mem0ai/mem0/blob/main/mem0-ts/src/oss/src/utils/scoring.ts)
- [Memobase部署及模型依赖](https://github.com/memodb-io/memobase/blob/main/src/server/readme.md)

本软件0.1.38采用轻量的层次：近期4轮对话（可调）、明确偏好、相关旧摘录/可选摘要。常提词仅作为检索辅助分数，不作为独立事实层，不自动推断喜欢或讨厌。权重按时间衰减，短时重复限频，明确纠正优先；候选去重，不用无关摘录填满预算。这些是本机实现，没有引入上述框架依赖、复制其代码或启用云端记忆。

当前仍是词法检索，尚未实现向量语义召回、完整事件时间线或自动归纳事实。换种说法但没有共同词时，可能找不到旧记忆。未来若加入语义层，应单独计量抽取/嵌入开销，并验证删除、纠正、角色隔离和来源可信度。

0.1.39已加入本机事件原文时间线，并按近期历史/明确偏好/事件层去重和相关性筛选；没有引入向量服务或额外记忆模型调用。
