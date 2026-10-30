"""One bounded parse. HTTP is delegated to the existing Android/Node transport.

The pinned MIT platform parsers run without an AstrBot instance. They receive
only public share fields and optional site cookies, never model/ADB credentials.
"""
import asyncio
import base64
import importlib
import json
import pathlib
import sys
from html.parser import HTMLParser

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / 'deps'))
import httpx

PLATFORMS = {
    'bilibili': 'BilibiliParser', 'douyin': 'DouyinParser', 'fanqie': 'FanqieParser',
    'redbook': 'RedBookParser', 'tieba': 'TiebaParser', 'weibo': 'WeiboParser',
    'wechat': 'WeChatParser', 'xiaoheihe': 'XiaoheiheParser', 'zhihu': 'ZhihuParser',
    'github': 'GitHubParser', 'qqchannel': 'QQChannelParser', 'qzone': 'QzoneParser',
    'pixiv': 'PixivParser',
}
documents = []
counter = 0
network_lock = None


def emit(value):
    print(json.dumps(value, ensure_ascii=True, separators=(',', ':')), flush=True)


class BridgeTransport(httpx.AsyncBaseTransport):
    async def handle_async_request(self, request):
        global counter
        async with network_lock:
            counter += 1
            if counter > 12:
                raise httpx.RequestError('平台请求次数已达上限', request=request)
            body = await request.aread()
            if len(body) > 65536:
                raise httpx.RequestError('平台请求过大', request=request)
            emit({'fetch': counter, 'url': str(request.url), 'method': request.method,
                  'headers': dict(request.headers), 'body': body.decode('utf-8')})
            raw = await asyncio.to_thread(sys.stdin.readline)
            data = json.loads(raw)
            if data.get('id') != counter or data.get('error'):
                raise httpx.RequestError('平台网络读取未完成', request=request)
            content = base64.b64decode(data['body'])
            if len(content) > 4 * 1024 * 1024:
                raise httpx.RequestError('平台资料超过读取上限', request=request)
            headers = data.get('headers', {})
            # Bridge bodies are already decoded by the host networking stack.
            headers = {k: v for k, v in headers.items() if k.lower() not in ('content-encoding', 'content-length', 'transfer-encoding')}
            if 'text/html' in str(headers.get('content-type', '')) and len(documents) < 2:
                documents.append(content.decode('utf-8', errors='replace'))
            return httpx.Response(data['status'], headers=headers, content=content, request=request)


OriginalClient = httpx.AsyncClient


class Client(OriginalClient):
    def __init__(self, *args, **kwargs):
        kwargs.pop('proxy', None)
        kwargs['transport'] = BridgeTransport()
        kwargs['trust_env'] = False
        kwargs['max_redirects'] = 4
        super().__init__(*args, **kwargs)


httpx.AsyncClient = Client
from qqwb_multi.core.contracts import ParseContext
from qqwb_multi.core.parser import BaseParser


async def keep_images(self, result, *args, **kwargs):
    # Preserve remote references; the host downloads at most two trusted images.
    # No plugin temporary images, video files, cloud sync or message delivery.
    return result


BaseParser.materialize_images = keep_images
BaseParser.materialize_public_images = keep_images


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.values = {}

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == 'meta':
            name = data.get('property') or data.get('name')
            if name in ('og:title', 'og:description', 'description'):
                self.values[name] = data.get('content', '')


async def run(data):
    global network_lock
    network_lock = asyncio.Lock()
    name = data.get('platform')
    if name not in PLATFORMS:
        raise ValueError('不支持的平台')
    module = importlib.import_module('qqwb_multi.platforms.' + name + '.parser')
    parser = getattr(module, PLATFORMS[name])({'request_timeout_seconds': 8, 'cookies': data.get('cookies', {})})
    if name == 'bilibili':
        # Chat needs the work's contents, not an extra request for a video URL.
        async def no_play_url(*args):
            return ''
        parser._get_play_url = no_play_url
    if name == 'douyin':
        async def no_video_probe(*args):
            return ''
        parser._probe_video_url = no_video_probe
    cards = data.get('cards', [])[:2]
    context = ParseContext(text=str(data.get('text', ''))[:8192],
                           json_urls=[c.get('url', '') for c in cards],
                           json_titles=[c.get('title', '') for c in cards],
                           json_previews=[c.get('preview', '') for c in cards],
                           json_metadata=[c.get('metadata', {}) for c in cards])
    if not await parser.match(context):
        raise ValueError('该平台暂不支持这种链接类型')
    result = await parser.parse(context)
    if result.diagnostics.error:
        raise ValueError(result.diagnostics.error)
    if name == 'github' and documents:
        meta = Metadata()
        meta.feed(documents[0])
        result.content.title = meta.values.get('og:title', '')
        result.content.description = meta.values.get('og:description') or meta.values.get('description', '')
    lines = [s for s in result.visible_text_lines if s != '无法获取视频直链。' and not s.startswith('play_token=')]
    text = '\n'.join(lines)[:3200]
    images = [u for u in result.ordered_image_references if isinstance(u, str) and u.startswith(('https://', '//'))][:2]
    emit({'result': {'platform': name, 'title': result.content.title[:160],
                     'author': result.content.author[:100], 'content': text,
                     'images': images, 'imageHosts': list(parser.image_host_suffixes),
                     'hasVideo': bool(result.media.video_url), 'hasAudio': bool(result.media.audio_url)}})


if __name__ == '__main__':
    try:
        data = json.loads(sys.stdin.readline(65537))
        asyncio.run(asyncio.wait_for(run(data), timeout=22))
    except Exception:
        # Exceptions may contain a signed URL or Cookie. Never forward them.
        emit({'error': '平台资料读取失败，可能需要登录、链接已失效或站点限制了访问；未读取到完整内容。'})
