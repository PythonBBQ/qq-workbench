"""Pinned, resumable model downloads. Only needed for the optional desktop GPU service."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request


def verified(path, entry):
    if not path.is_file() or path.stat().st_size != entry["bytes"]:
        return False
    if entry.get("sha256"):
        with path.open("rb") as stream:
            return hashlib.file_digest(stream, "sha256").hexdigest() == entry["sha256"]
    digest = hashlib.sha1(b"blob " + str(entry["bytes"]).encode() + b"\0")
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024**2), b""):
            digest.update(chunk)
    return digest.hexdigest() == entry["git_sha1"]


def download(root, entry, proxy=None):
    target = (root / entry["target"]).resolve()
    target.relative_to(root.resolve())
    target.parent.mkdir(parents=True, exist_ok=True)
    if verified(target, entry):
        return {"file": entry["target"], "verified": True, "cached": True}
    part = target.with_name(target.name + ".partial")
    if part.exists() and part.stat().st_size > entry["bytes"]:
        part.unlink()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({"https": proxy}) if proxy else urllib.request.ProxyHandler())
    base = "https://huggingface.co/" + entry["repo"] + "/resolve/" + entry["revision"] + "/" + urllib.parse.quote(entry["name"])
    while not part.exists() or part.stat().st_size < entry["bytes"]:
        begin = part.stat().st_size if part.exists() else 0
        end = min(entry["bytes"] - 1, begin + 16 * 1024**2 - 1)
        failure = None
        for attempt in range(8):
            try:
                request = urllib.request.Request(base + "?download=true&nonce=" + str(time.time_ns()), headers={"Range": f"bytes={begin}-{end}"})
                with opener.open(request, timeout=90) as response:
                    if response.status == 206:
                        if response.headers.get("Content-Range") != f"bytes {begin}-{end}/{entry['bytes']}":
                            raise ValueError("Unexpected download range")
                    elif response.status != 200 or begin != 0 or end != entry["bytes"] - 1:
                        raise ValueError("Server ignored the requested range")
                    block = response.read(end - begin + 2)
                    if len(block) != end - begin + 1:
                        raise ValueError("Incomplete download block")
                with part.open("ab") as output:
                    output.write(block)
                failure = None
                break
            except Exception as exc:
                failure = exc
                time.sleep(min(attempt + 1, 8))
        if failure:
            raise RuntimeError("Download interrupted; progress retained: " + entry["target"]) from failure
        print(json.dumps({"file": entry["target"], "received": end + 1, "total": entry["bytes"]}), flush=True)
    if not verified(part, entry):
        part.unlink(missing_ok=True)
        raise ValueError("Model checksum mismatch: " + entry["target"])
    part.replace(target)
    return {"file": entry["target"], "verified": True, "bytes": entry["bytes"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--proxy")
    parser.add_argument("--subset", choices=("all", "index", "feiyu", "aux"), default="all")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.workers <= 8:
        parser.error("workers must be between 1 and 8")
    root = args.runtime.resolve() / "models"
    entries = json.loads(Path(__file__).with_suffix(".json").read_text())["files"]
    if args.subset == "index":
        entries = [e for e in entries if e["target"].startswith("IndexTTS-2/")]
    elif args.subset == "feiyu":
        entries = [e for e in entries if e["target"].startswith("FeiyuVoice-")]
    elif args.subset == "aux":
        entries = [e for e in entries if "/hf_cache/" in e["target"]]
    if args.verify_only:
        missing = [e["target"] for e in entries if not verified(root / e["target"], e)]
        print(json.dumps({"verified": not missing, "missingOrInvalid": missing}, indent=2))
        return bool(missing)
    root.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        receipts = list(pool.map(lambda e: download(root, e, args.proxy), entries))
    (args.runtime / ("model-receipt-" + args.subset + ".json")).write_text(json.dumps(receipts, indent=2), encoding="utf-8")
    print("Selected models downloaded and verified.")


if __name__ == "__main__":
    raise SystemExit(main())
