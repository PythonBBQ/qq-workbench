"""Render six synthetic references on the GPU for later offline tablet use.

This exports audio conditioning, not learned ZipVoice weights or six new models.
All synthesis goes through the already configured local desktop gateway.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request
import wave
import zipfile

SAMPLES = {
    "neutral": ("cute", "主人，我已经准备好了，今天想聊点什么？"),
    "happy": ("cute", "太好啦，今天有好多好吃的，我好开心呀！"),
    "gentle": ("gentle", "先别着急，我就在这里，慢慢听你说。"),
    "shy": ("gentle", "你这样夸我，我有一点不好意思啦。"),
    "sad": ("gentle", "今天有一点难过，你能陪我一会儿吗？"),
    "serious": ("gentle", "这件事需要认真对待，我们一步一步处理。"),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--bundle-to", type=Path)
    parser.add_argument("--voice", choices=("feiyu-index", "feiyu-index-rvc", "feiyu-ssr"), default="feiyu-index-rvc")
    parser.add_argument("--name", default="肥鱼六种语气 · 本机参考")
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    key = (runtime / "gateway-key.local.txt").read_text().strip()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    ffmpeg = runtime / "bin" / ("ffmpeg.exe" if __import__("os").name == "nt" else "ffmpeg")
    manifest = {"schema": 1, "type": "qq-workbench-voice-references", "name": args.name,
                "engine": args.voice, "attribution": "星落落_oi / Esmerubphire 肥鱼声音项目；IndexTTS2 合成",
                "scope": "synthetic reference conditioning; not six trained voices; shyness is approximate",
                "references": {}}
    receipt_path = output / "generation.json"
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}

    def conditioning(style):
        if args.voice == "feiyu-ssr":
            folder = runtime / "reference-profiles/feiyu-ssr"
            entry = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
            name, expected = entry["file"], entry["sha256"]
        else:
            folder = runtime / "models/FeiyuVoice-CosyVoice3"
            entry = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))["styles"][style]
            name, expected = entry["reference_audio"], entry["reference_sha256"]
        target = (folder / name).resolve()
        target.relative_to(folder.resolve())
        if digest(target.read_bytes()) != expected:
            raise ValueError("Conditioning reference checksum mismatch")
        return expected

    def request(route, data=None):
        return opener.open(urllib.request.Request("http://127.0.0.1:9880" + route,
            data=json.dumps(data, ensure_ascii=False).encode() if data is not None else None,
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"}), timeout=15)

    for mood, (style, text) in SAMPLES.items():
        reference_hash = conditioning(style)
        target = output / (mood + ".wav")
        saved = receipt.get(mood, {})
        if not (target.is_file() and saved.get("text") == text and saved.get("engine") == args.voice
                and saved.get("conditioningSHA256") == reference_hash
                and saved.get("sha256") == digest(target.read_bytes())):
            started = time.monotonic()
            # One submission only: an uncertain response never causes a duplicate GPU job.
            with request("/v1/speech", {"voice": args.voice, "style": style, "emotion": mood, "text": text}) as response:
                task = json.load(response)
            deadline = time.monotonic() + 660
            while True:
                with request("/v1/jobs/" + task["id"]) as response:
                    state = json.load(response)
                if state["status"] not in ("queued", "running"):
                    break
                if time.monotonic() > deadline:
                    raise TimeoutError("Reference job unfinished: " + task["id"])
                time.sleep(2)
            if state["status"] != "success":
                raise RuntimeError("Reference generation failed: " + mood + " " + str(state))
            with request("/v1/jobs/" + task["id"] + "/audio") as response:
                original = response.read(24 * 1024**2 + 1)
            if len(original) > 24 * 1024**2:
                raise ValueError("Reference audio too large")
            source = output / (mood + "-source.wav")
            source.write_bytes(original)
            # Resample only. No time stretch, cut words, fake pitch change, or new transcript.
            subprocess.run([str(ffmpeg), "-nostdin", "-y", "-v", "error", "-i", str(source),
                            "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(target)], check=True)
            receipt[mood] = {"text": text, "engine": args.voice, "job": task["id"],
                             "conditioningSHA256": reference_hash,
                             "elapsedSeconds": round(time.monotonic() - started, 2),
                             "sha256": digest(target.read_bytes())}
            receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")
        data = target.read_bytes()
        with wave.open(io.BytesIO(data)) as wav:
            seconds = wav.getnframes() / wav.getframerate()
            if not 1 <= seconds <= 10 or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                raise ValueError("Reference must be complete 1–10 second PCM: " + mood)
        manifest["references"][mood] = {"file": target.name, "text": text, "bytes": len(data),
                                        "sha256": digest(data), "seconds": round(seconds, 4),
                                        "conditioningSHA256": reference_hash}
        print(json.dumps({"mood": mood, "seconds": seconds, **receipt[mood]}, ensure_ascii=False), flush=True)

    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
    (output / "manifest.json").write_bytes(manifest_bytes)
    notice = ("肥鱼六种语气参考包（本地个人试听）\n"
              "由 IndexTTS2 生成；旧版另经肥鱼RVC，SSR版从分离人声直接克隆。非真人新增录音、非六套训练权重。\n"
              "原始声源：星落落_oi；肥鱼项目：Esmerubphire。\n"
              "https://github.com/Esmerubphire/astrbot_plugin_feiyu_voice\n"
              "https://github.com/lfandrh/indextts2-studio\n"
              "自然、开心、温柔、害羞、难过、认真分别作参考；害羞为近似表达。\n"
              "平板使用内置 ZipVoice-Distill INT8；参考只能传递部分音色/语气，效果需试听。\n"
              "上游版权和模型条款继续适用；本包不赋予声源身份或其他权利。\n")
    pack = output / "Feiyu-Six-References.zip"
    with zipfile.ZipFile(pack, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in [("manifest.json", manifest_bytes), ("NOTICE.txt", notice.encode()),
                           *((mood + ".wav", (output / (mood + ".wav")).read_bytes()) for mood in SAMPLES)]:
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    if args.bundle_to:
        args.bundle_to.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(pack, args.bundle_to)
    print(json.dumps({"package": str(pack), "bytes": pack.stat().st_size,
                      "sha256": digest(pack.read_bytes()), "references": len(SAMPLES)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
