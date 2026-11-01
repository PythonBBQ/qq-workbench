"""Generate local listening samples through the real, authenticated GPU gateway.

Does not send QQ messages, change the selected phone voice, or call a chat API.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import time
import urllib.request
import wave


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--url", default="http://127.0.0.1:9880")
    parser.add_argument("--voices", nargs="+", choices=("feiyu", "feiyu-index", "feiyu-index-rvc"),
                        default=["feiyu-index", "feiyu-index-rvc"])
    args = parser.parse_args()
    key = (args.runtime / "gateway-key.local.txt").read_text().strip()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    args.output.mkdir(parents=True, exist_ok=True)

    def request(route, data=None):
        req = urllib.request.Request(args.url.rstrip("/") + route,
            data=json.dumps(data, ensure_ascii=False).encode() if data is not None else None,
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        return opener.open(req, timeout=15)

    report = {"scope": "actual synthesis and valid PCM; listening quality requires user review", "samples": []}
    with request("/health") as response:
        report["capabilities"] = json.load(response)
    for voice in args.voices:
        variants = [("cute", "neutral", "主人，饭已经准备好啦，先吃饭再忙吧。"),
                    ("gentle", "shy", "你这样夸我，我会有一点不好意思的。")]
        if voice == "feiyu-index-rvc":
            variants = variants[:1]
        for style, emotion, text in variants:
            started = time.monotonic()
            with request("/v1/speech", {"voice": voice, "style": style, "emotion": emotion, "text": text}) as response:
                task = json.load(response)
            deadline = time.monotonic() + 660
            while True:
                with request("/v1/jobs/" + task["id"]) as response:
                    state = json.load(response)
                if state["status"] not in ("queued", "running"):
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError("Voice job timed out; not submitted again: " + task["id"])
                time.sleep(2)
            row = {"voice": voice, "style": style, "emotion": emotion, "text": text,
                   "job": task["id"], "status": state["status"],
                   "elapsedSeconds": round(time.monotonic() - started, 2)}
            if state["status"] == "success":
                with request("/v1/jobs/" + task["id"] + "/audio") as response:
                    audio = response.read(24 * 1024**2 + 1)
                if len(audio) > 24 * 1024**2:
                    raise ValueError("Audio exceeds the gateway size limit")
                with wave.open(io.BytesIO(audio)) as wav:
                    row.update(seconds=round(wav.getnframes() / wav.getframerate(), 3),
                               sampleRate=wav.getframerate(), channels=wav.getnchannels())
                target = args.output / (voice + "-" + style + ".wav")
                target.write_bytes(audio)
                row.update(file=target.name, sha256=hashlib.sha256(audio).hexdigest())
            else:
                row["error"] = state.get("error", "Unknown")
            report["samples"].append(row)
            (args.output / "validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(row, ensure_ascii=False), flush=True)
    return int(any(row["status"] != "success" for row in report["samples"]))


if __name__ == "__main__":
    raise SystemExit(main())
