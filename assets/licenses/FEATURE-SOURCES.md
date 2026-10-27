# Feature references (2026-10-25)

- DeepSeek official Vision guide: https://api-docs.deepseek.com/guides/vision
- DeepSeek model capabilities: https://api-docs.deepseek.com/quick_start/pricing
  The current guide documents `deepseek-flash`, text plus `image_url` content,
  base64 data URLs and `detail: low`. Official vision uses the user's existing
  DeepSeek API key; model availability on third-party gateways can differ.
- SillyTavern: https://github.com/SillyTavern/SillyTavern (AGPL-3.0).
  Referenced the character-profile concept and interoperable card format;
  SillyTavern application code, server and extensions are not bundled.
- Character Card V1/V2 format:
  https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md
  This app independently reads common descriptive fields from JSON or PNG
  `chara` tEXt metadata. This is a profile-field importer, not a complete card
  editor or implementation of all V2 prompt, worldbook and extension behavior.
  Original user files are not modified. Card scripts are not executed.

All QQ access runtime archives and their licenses are bundled separately.
The active, verified engine is SnowLuma 1.14.22 with official Linux QQ
3.2.34 on ARM64. NapCat is not bundled or launched by this release.
# Public webpage learning and provider cards (0.1.10)

Original local implementation; no Bilibili website or provider source copied.
Bilibili public metadata: https://api.bilibili.com/x/web-interface/view
Public search: https://api.bilibili.com/x/web-interface/search/type
No website login, model credentials or access-control bypass. Public endpoint availability is not guaranteed. This feature currently reads metadata, not video frames, audio or complete subtitles, and does not train model weights.

Provider presets are editable OpenAI-compatible endpoint templates, not bundled models or a guarantee of account/model access:
DeepSeek: https://api-docs.deepseek.com/
Alibaba Cloud Model Studio: https://help.aliyun.com/zh/model-studio/
Moonshot: https://platform.moonshot.cn/docs/
Zhipu: https://docs.bigmodel.cn/


## Long conversations, character memory and video (0.1.15)

Independently implemented bounded memory, keyword retrieval, extractive digest,
optional model summarization and owner-only training dataset export. No
SillyTavern application or extension source is bundled or copied. References:
- https://docs.sillytavern.app/extensions/summarize/
- https://docs.sillytavern.app/usage/core-concepts/worldinfo/
- https://github.com/kwaroran/character-card-spec-v3

Basic V3 and keyword book import does not implement the full Tavern runtime.
Training dataset export does not initiate model fine-tuning or upload.

Native video-interface references (not a claim of universal API compatibility):
- https://help.aliyun.com/zh/model-studio/vision
- https://ai.google.dev/gemini-api/docs/video-understanding

This release sends bounded sampled JPEG frames to the configured visual model.
No audio transcription or full Bilibili video retrieval is included. FFmpeg
and its dependencies are provisioned from the existing official Ubuntu package
sources as an optional compatibility decoder; distro copyright and license
files remain under /usr/share/doc in the private Linux environment. The host
synthetic-video generator and its Windows FFmpeg binary are test tools only
and are not bundled into the APK. https://ffmpeg.org/legal.html

## Natural chat browsing (0.1.16)

Independent local implementation of natural-language intent routing, optional
JSON planning with the configured model, public search and bounded page reads.
Searches use public Bing / DuckDuckGo result pages, not a copied search engine
or a bundled browser. No provider-hosted browser or paid search API is claimed.
The user-selected model receives only bounded source excerpts for the answer;
public websites receive no model credentials or QQ account credentials.

## Dialogue style adaptation and group ignore (0.1.18)

Independent workbench implementation. Structured local style scores and optional
evidence-checked model reflection complement imported Tavern characters; no
SillyTavern runtime or model training service is bundled. Group ignore only
filters assistant events and does not call QQ account blacklist APIs.
The compatible transport supports configured Chat Completions or Responses;
availability, model IDs and credentials remain those of the selected provider.
