# 工作台多平台解析适配层

上游为 Qfxaile/astrbot_plugin_multi_parser v1.3.0，固定提交
`b40468057e11a3e6301e93453285a1b898da522c`，MIT 许可。上游文件来源及摘要见
UPSTREAM.json，原许可见 LICENSE-upstream.txt。qqwb_multi 保留平台内容解析
算法；包入口为空以避免载入 AstrBot 登录/投递模块；core/media/operations.py
仅将 AstrBot logger 改为 Python logging。

worker.py 是工作台适配层：使用原解析器，HTTP 经有界 NDJSON 请求委托给
工作台 Android 网络栈；不直接使用模型密钥或 QQ 登录凭据，不执行 AstroBot
聊天/登录/投递逻辑。禁止落地全部图片和视频，保留图文引用供宿主最多读两张图。
B站不请求播放地址，抖音不探测清晰度直链。GitHub 在同一次页面请求中补提取
OpenGraph 标题和简介；其内容不是仓库全部源码。

tools/build-multi-parser.py 将本目录和 tools/multi-parser-lock.json 中的8个
纯 Python 依赖打成离线资产。所有依赖下载前后校验 SHA-256，依赖原许可随
dist-info 一起打包。xhshow/qrcode 仅用于上游独立登录功能，本适配不使用，
不引入相应密码学、二维码或 AstrBot 依赖。

JSON/XML 分享卡片由宿主仅抽取公开标题、URL、预览图和腾讯频道公开 feed_id；
其余卡片 token 与用户标识不进入解析请求。可选平台 Cookie 在安卓密钥库
加密保存，仅交给对应平台解析器；不将 Cookie、私有模型密钥或原始卡片交给
聊天模型。最多12次平台请求、单次4MB、整个解析25秒；配图各最多3MB。

支持平台和内容类型以原解析器为准。登录、站点限制和接口变动可能导致失败；
公开作品元数据及封面不表示已经观看整段视频。Pixiv 默认关闭。
