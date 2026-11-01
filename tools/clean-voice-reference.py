"""Separate instrumental backing before using a personal voice reference.

Runs on the desktop; only the resulting short PCM reference goes to Android.
No pitch shifting or spectral gating: preserve the original voice and timing.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--runtime", type=Path, required=True)
    p.add_argument("--register-ssr", action="store_true", help="Register cleaned vocals for the local feiyu-ssr gateway preset")
    p.add_argument("--trim-leading-silence", type=float, default=0., help="Seconds of verified leading silence only; never cuts the end")
    args = p.parse_args()
    runtime, out = args.runtime.resolve(), args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    os.environ["TORCH_HOME"] = str(runtime / "torch-cache")
    os.environ["OMP_NUM_THREADS"] = "4"
    os.environ["MKL_NUM_THREADS"] = "4"
    import torch
    import torchaudio
    import soundfile as sf
    import numpy as np
    torch.set_num_threads(4)
    checkpoint = runtime / "models/HDemucs/hdemucs_high_trained.pt"
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    url = "https://download.pytorch.org/torchaudio/models/hdemucs_high_trained.pt"
    expected_bytes = 334697255
    expected_hash = "a004b2790d73ffeaa535db458a1a79b539dfdbafbccc31f275d07e632ebd7816"
    if not checkpoint.is_file() or checkpoint.stat().st_size != expected_bytes:
        partial = checkpoint.with_suffix(".partial")
        print("Downloading official torchaudio HDemucs checkpoint", flush=True)
        with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as dest:
            while data := response.read(1024 * 1024):
                dest.write(data)
        if partial.stat().st_size != expected_bytes:
            raise ValueError("Incomplete separation checkpoint")
        if sha(partial) != expected_hash:
            raise ValueError("Separation checkpoint checksum mismatch")
        partial.replace(checkpoint)
    model_hash = sha(checkpoint)
    if model_hash != expected_hash:
        raise ValueError("Separation checkpoint checksum mismatch")
    print(json.dumps({"checkpointSHA256": model_hash}), flush=True)
    ffmpeg = runtime / "bin/ffmpeg.exe"
    decoded = out / "mixture-stereo-44k.wav"
    subprocess.run([str(ffmpeg), "-nostdin", "-y", "-v", "error", "-i", str(args.input),
                    "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(decoded)], check=True)
    audio, rate = sf.read(decoded, dtype="float32", always_2d=True)
    if not 1 <= len(audio) / rate <= 30:
        raise ValueError("This reference preparation tool accepts 1–30 seconds")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = torchaudio.models.hdemucs_high(sources=["drums", "bass", "other", "vocals"])
    model.load_state_dict(torch.load(checkpoint, map_location="cpu", weights_only=True))
    model.eval().to(device)
    mixture = torch.from_numpy(audio.T.copy()).to(device)
    mono = mixture.mean(0)
    mean, std = mono.mean(), mono.std().clamp_min(1e-6)
    start = time.monotonic()
    with torch.inference_mode():
        estimates = model(((mixture - mean) / std)[None])[0] * std
    # Restore the tiny removed DC only to the backing stem, never to each stem.
    stems = estimates.cpu().numpy()
    vocals = stems[3].T
    backing = stems[:3].sum(0).T + float(mean)
    peak = float(max(np.abs(vocals).max(), np.abs(backing).max()))
    gain = min(1., .97 / max(peak, 1e-6))
    sf.write(out / "vocals.wav", vocals * gain, rate, subtype="PCM_16")
    sf.write(out / "instruments.wav", backing * gain, rate, subtype="PCM_16")
    # A comparison mix only; the cloning reference uses vocals.wav, not this mix.
    quiet = vocals + backing * 10 ** (-24 / 20)
    quiet *= min(1., .97 / max(float(np.abs(quiet).max()), 1e-6))
    sf.write(out / "backing-minus24db.wav", quiet, rate, subtype="PCM_16")
    for name in ("vocals", "backing-minus24db"):
        subprocess.run([str(ffmpeg), "-nostdin", "-y", "-v", "error", "-i", str(out / (name + ".wav")),
                        "-c:a", "libmp3lame", "-q:a", "2", str(out / (name + ".mp3"))], check=True)
    if args.register_ssr:
        if not 0 <= args.trim_leading_silence <= .5:
            raise ValueError("Leading silence trim must be 0–0.5 seconds")
        prefix = audio[:round(args.trim_leading_silence * rate)]
        if prefix.size and float(np.sqrt(np.mean(prefix ** 2))) > .0126:
            raise ValueError("Requested leading trim contains audible audio")
        profile = runtime / "reference-profiles/feiyu-ssr"
        profile.mkdir(parents=True, exist_ok=True)
        prepared = profile / "vocals.next.wav"
        subprocess.run([str(ffmpeg), "-nostdin", "-y", "-v", "error", "-ss", str(args.trim_leading_silence),
                        "-i", str(out / "vocals.wav"), "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(prepared)], check=True)
        entry = {"name": "大肥鱼SSR · 原声去伴奏", "file": "vocals.wav", "bytes": prepared.stat().st_size,
                 "sha256": sha(prepared), "sourceSHA256": sha(args.input), "leadingSilenceTrim": args.trim_leading_silence,
                 "method": "HDemucs vocals only; no RVC or pitch shift"}
        prepared.replace(profile / "vocals.wav")
        record = profile / "manifest.next.json"
        record.write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
        record.replace(profile / "manifest.json")
    mixture_rms = float(np.sqrt(np.mean(audio ** 2)))
    residual_rms = float(np.sqrt(np.mean((audio - vocals - backing) ** 2)))
    report = {"source": str(args.input.resolve()), "sourceSHA256": sha(args.input),
              "method": "torchaudio HDEMUCS_HIGH_MUSDB_PLUS", "checkpointURL": url,
              "checkpointSHA256": model_hash, "device": device,
              "seconds": len(audio) / rate, "elapsedSeconds": round(time.monotonic() - start, 3),
              "backingInComparisonDb": -24, "referenceUsesBacking": False,
              "reconstructionErrorDb": round(20 * np.log10(max(residual_rms, 1e-12) / max(mixture_rms, 1e-12)), 2),
              "note": "Model separation may leave residual music or alter timbre; requires listening comparison.",
              "outputs": {name: {"bytes": (out / name).stat().st_size, "sha256": sha(out / name)}
                          for name in ("vocals.wav", "instruments.wav", "backing-minus24db.wav", "vocals.mp3", "backing-minus24db.mp3")}}
    (out / "separation-receipt.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
