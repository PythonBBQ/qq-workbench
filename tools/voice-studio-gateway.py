"""Authenticated chat bridge for a local IndexTTS Studio + longform installation.

The original editing UI stays on loopback. GPU jobs share the Studio inference
lock, so chat synthesis and longform rendering never load separate GPU engines
at the same time. No model, recording or upstream source is redistributed here.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import hmac
import importlib.util
import json
import math
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
import uuid
import wave

MOODS = {"neutral", "happy", "gentle", "shy", "sad", "serious"}
VOICES = {"feiyu", "feiyu-index", "feiyu-index-rvc", "feiyu-ssr", "character-daily"}


def emotion_vector(mood):
    # IndexTTS order: happy, angry, sad, afraid, disgusted, low, surprised, calm.
    # Shyness is approximated with a quiet reference, not a separate checkpoint.
    return {"happy": [.45, 0, 0, 0, 0, 0, .05, .15],
            "gentle": [0, 0, 0, 0, 0, 0, 0, .45],
            "shy": [.10, 0, 0, 0, 0, 0, 0, .45],
            "sad": [0, 0, .35, 0, 0, .15, 0, .10],
            "serious": [0, 0, 0, 0, 0, 0, 0, .35]}.get(mood)


def package_path(root, name):
    target = (root / name).resolve()
    target.relative_to(root.resolve())
    return target


def checked_reference(package, style):
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    entry = manifest["styles"][style]
    ref = package_path(package, entry["reference_audio"])
    with ref.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != entry["reference_sha256"]:
        raise ValueError("Reference checksum mismatch")
    return ref


def check_wave(path):
    if not path.is_file() or path.stat().st_size > 24 * 1024**2:
        raise ValueError("Invalid generated audio size")
    with wave.open(str(path), "rb") as stream:
        duration = stream.getnframes() / stream.getframerate()
        if not .08 <= duration <= 180 or stream.getnchannels() not in (1, 2):
            raise ValueError("Invalid generated audio duration")
    return duration


def checked_ssr_reference(runtime):
    # A desktop-prepared, hashed profile; HTTP callers never supply file paths.
    package = runtime / "reference-profiles/feiyu-ssr"
    record = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    ref = package_path(package, record["file"])
    if not ref.is_file() or ref.stat().st_size != record["bytes"]:
        raise ValueError("SSR reference size mismatch")
    with ref.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != record["sha256"]:
            raise ValueError("SSR reference checksum mismatch")
    check_wave(ref)
    return ref


def checked_character_reference(runtime, mood, variant=0):
    """Only locally prepared profiles, never paths supplied by HTTP callers."""
    package = runtime / 'reference-profiles/character-daily'
    record = json.loads((package / 'manifest.json').read_text(encoding='utf-8'))
    if record.get('schema') != 1 or record.get('voice') != 'character-daily':
        raise ValueError('Character profile version mismatch')

    def checked(entry):
        ref = package_path(package, entry['file'])
        if not ref.is_file() or ref.stat().st_size != entry['bytes'] or ref.stat().st_size > 2 * 1024**2:
            raise ValueError('Character reference size mismatch')
        with ref.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != entry['sha256']:
                raise ValueError('Character reference checksum mismatch')
        if not 1 <= check_wave(ref) <= 15:
            raise ValueError('Character reference duration mismatch')
        return ref

    choices = record['emotions'][mood]
    if not isinstance(choices, list) or not 1 <= len(choices) <= 8:
        raise ValueError('Invalid character reference bank')
    speaker = checked(record['speaker'])
    emotion = checked(choices[variant % len(choices)])
    alpha = float(record.get('emotionAlpha', .65))
    if not .1 <= alpha <= 1:
        raise ValueError('Invalid character emotion strength')
    return speaker, emotion, alpha


def character_controls(reference, alpha, delivery):
    # Ordinary conversation keeps more of the stable speaker prompt. A strong
    # emotion prompt can also copy whisper/breath patterns from reference audio.
    # Soft/expressive delivery is opt-in and preserves the prepared full strength.
    return {'emo_audio_prompt': str(reference),
            'emo_alpha': min(alpha, .45) if delivery == 'normal' else alpha}


def make_app(studio, runtime, worker, token):
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import FileResponse
    # Request annotation must be available at module level with future annotations.
    globals()["Request"] = Request
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="voice-chat")
    guard = threading.Lock()
    jobs = {}
    folder = runtime / "jobs"
    folder.mkdir(parents=True, exist_ok=True)
    package = runtime / "models/FeiyuVoice-CosyVoice3"
    last_used = [time.monotonic()]

    @app.middleware("http")
    async def authorize(request: Request, call_next):
        from starlette.responses import JSONResponse
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied.encode(), ("Bearer " + token).encode()):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)

    def capability():
        return {"voices": sorted(VOICES),
                "styles": ["cute", "gentle"], "emotions": sorted(MOODS),
                "shy": "approximation", "studio": "http://127.0.0.1:7860/longform",
                "localOnlyUi": True, "gpuJobs": "serial",
                "feiyuRuntimeConfigured": (runtime / "tts-profile.local.json").is_file(),
                "rvcRuntimeConfigured": (runtime / "rvc-profile.local.json").is_file()}

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "qq-workbench-voice", **capability()}

    @app.get("/v1/capabilities")
    def capabilities():
        return capability()

    def run(job_id, request):
        output = folder / job_id
        output.mkdir()
        try:
            with guard:
                jobs[job_id]["status"] = "running"
            wav = output / "speech.wav"
            with studio._INFER_LOCK:
                if request["voice"] == "feiyu":
                    # Free IndexTTS VRAM before invoking the original Feiyu model.
                    studio.tts.unload()
                    run_worker("tts", output, request)
                    wav = output / "tts/speech.wav"
                else:
                    custom = request['voice'] == 'character-daily'
                    if custom:
                        ref, emo_ref, alpha = checked_character_reference(runtime, request['emotion'], request.get('variant', 0))
                    else:
                        ref = checked_ssr_reference(runtime) if request["voice"] == "feiyu-ssr" else checked_reference(package, request["style"])
                    model = studio.tts.ensure_loaded()
                    controls = character_controls(emo_ref, alpha, request['delivery']) if custom else {'emo_vector': emotion_vector(request['emotion']), 'emo_alpha': .50}
                    quality = request.get('quality', {})
                    if custom and 'emotion_alpha' in quality:
                        controls['emo_alpha'] = quality['emotion_alpha']
                    if custom and quality.get('speaker_reference') == 'emotion':
                        ref = emo_ref
                    infer_quality = {k: quality[k] for k in ('diffusion_steps', 'inference_cfg_rate', 'temperature', 'top_p') if k in quality}
                    model.infer(spk_audio_prompt=str(ref), text=request["text"],
                                output_path=str(wav), **controls, **infer_quality,
                                use_emo_text=False, use_random=False,
                                max_text_tokens_per_segment=90, num_beams=1,
                                max_mel_tokens=1800, interval_silence=140)
                    if getattr(model, "mel_tokens_capped", False):
                        raise ValueError("Synthesis reached its length limit; audio withheld")
                    if request["voice"] == "feiyu-index-rvc":
                        studio.tts.unload()
                        run_worker("rvc", output, {**request, "input": str(wav)})
                        wav = output / "rvc/speech.wav"
                seconds = check_wave(wav)
                last_used[0] = time.monotonic()
            with guard:
                jobs[job_id].update(status="success", audio=str(wav), seconds=seconds)
        except Exception as exc:
            # Detailed local diagnostics never reach the phone (paths, subprocess data).
            import logging
            logging.getLogger("voice-gateway").exception("Voice job %s failed", job_id)
            with guard:
                jobs[job_id].update(status="failed", error=type(exc).__name__)

    def run_worker(engine, output, request):
        profile = runtime / (engine + "-profile.local.json")
        if not profile.is_file():
            raise RuntimeError(engine + " runtime not configured")
        cfg = json.loads(profile.read_text(encoding="utf-8"))
        task = output / (engine + "-request.json")
        task.write_text(json.dumps({**request, "output_dir": str(output / engine)}, ensure_ascii=False), encoding="utf-8")
        command = [cfg["python"], str(worker), "--runtime", str(runtime),
                   "--engine", engine, "--request", str(task)]
        with (output / (engine + ".log")).open("w", encoding="utf-8") as log:
            subprocess.run(command, check=True, timeout=600, stdout=log,
                           stderr=subprocess.STDOUT, creationflags=0x08000000 if os.name == "nt" else 0)

    @app.post("/v1/speech", status_code=202)
    async def submit(request: Request):
        # Read a bounded body before JSON parsing.
        chunks = bytearray()
        async for chunk in request.stream():
            chunks.extend(chunk)
            if len(chunks) > 16384:
                raise HTTPException(413, "Request too large")
        try:
            data = json.loads(chunks)
            text = data["text"]
            voice, style, mood = data.get("voice", "feiyu"), data.get("style", "cute"), data.get("emotion", "neutral")
            variant = data.get('variant', 0)
            delivery = data.get('delivery', 'normal')
            if not isinstance(text, str) or not text.strip() or len(text) > 1200:
                raise ValueError()
            if voice not in VOICES or style not in {"cute", "gentle"} or mood not in MOODS:
                raise ValueError()
            if not isinstance(variant, int) or isinstance(variant, bool) or not 0 <= variant <= 7:
                raise ValueError()
            if delivery not in ('normal', 'soft', 'expressive'):
                raise ValueError()
            quality = data.get('quality', {})
            if not isinstance(quality, dict) or set(quality) - {'diffusion_steps', 'inference_cfg_rate', 'temperature', 'top_p', 'emotion_alpha', 'speaker_reference'}:
                raise ValueError()
            if quality and voice != 'character-daily':
                raise ValueError()
            for name, value in quality.items():
                if name == 'speaker_reference':
                    if value not in ('base', 'emotion'):
                        raise ValueError()
                elif name == 'diffusion_steps':
                    if type(value) is not int or value not in (16, 32, 48, 64):
                        raise ValueError()
                else:
                    bounds = {'inference_cfg_rate': (.3, 1), 'temperature': (.4, 1), 'top_p': (.5, 1), 'emotion_alpha': (0, 1)}[name]
                    if type(value) not in (int, float) or not math.isfinite(value) or not bounds[0] <= value <= bounds[1]:
                        raise ValueError()
        except (ValueError, TypeError, KeyError):
            raise HTTPException(400, "Invalid voice request")
        with guard:
            now = time.time()
            for old in list(jobs):
                if jobs[old]["status"] not in {"queued", "running"} and now - jobs[old]["created"] > 600:
                    import shutil
                    shutil.rmtree(folder / old, ignore_errors=True)
                    jobs.pop(old)
            if sum(j["status"] in {"queued", "running"} for j in jobs.values()) >= 4:
                raise HTTPException(429, "Voice queue is full")
            job_id = uuid.uuid4().hex
            jobs[job_id] = {"id": job_id, "status": "queued", "created": now}
        pool.submit(run, job_id, {"text": text, "voice": voice, "style": style, "emotion": mood, "variant": variant, "delivery": delivery, "quality": quality})
        return {"id": job_id, "status": "queued"}

    def get_job(job_id):
        if len(job_id) != 32 or any(c not in "0123456789abcdef" for c in job_id):
            raise HTTPException(404, "Unknown job")
        with guard:
            value = jobs.get(job_id)
            if value is None:
                raise HTTPException(404, "Unknown job")
            return dict(value)

    @app.get("/v1/jobs/{job_id}")
    def status(job_id: str):
        return {k: v for k, v in get_job(job_id).items() if k != "audio"}

    @app.get("/v1/jobs/{job_id}/audio")
    def audio(job_id: str):
        job = get_job(job_id)
        if job["status"] != "success":
            raise HTTPException(409, "Audio is not complete")
        return FileResponse(job["audio"], media_type="audio/wav")

    def release_idle():
        while True:
            time.sleep(30)
            if time.monotonic() - last_used[0] > 180 and studio._INFER_LOCK.acquire(blocking=False):
                try:
                    studio.tts.unload()
                finally:
                    studio._INFER_LOCK.release()
    threading.Thread(target=release_idle, daemon=True, name="voice-idle-release").start()
    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--studio", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9880)
    args = parser.parse_args()
    runtime, source = args.runtime.resolve(), args.studio.resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    token_file = runtime / "gateway-key.local.txt"
    if not token_file.exists():
        token_file.write_text(secrets.token_urlsafe(32), encoding="ascii")
        token_file.chmod(0o600)
    token = token_file.read_text(encoding="ascii").strip()
    if len(token) < 24:
        raise ValueError("Voice service key must contain at least 24 characters")
    os.environ.update(OMP_NUM_THREADS="4", MKL_NUM_THREADS="4", HF_HOME=str(runtime / "hf-cache"),
                      TORCH_HOME=str(runtime / "torch-cache"), MODELSCOPE_CACHE=str(runtime / "modelscope-cache"),
                      MPLCONFIGDIR=str(runtime / "matplotlib"), NLTK_DATA=str(runtime / "nltk-data"),
                      XDG_CACHE_HOME=str(runtime / "cache"), TORCH_EXTENSIONS_DIR=str(runtime / "torch-extensions"))
    if (runtime / "bin").is_dir():
        os.environ["PATH"] = str(runtime / "bin") + os.pathsep + os.environ.get("PATH", "")
    os.chdir(source)
    sys.path.insert(0, str(source))
    sys.argv = [str(source / "server.py"), "--model_dir", str(runtime / "models/IndexTTS-2"),
                "--diffusion_steps", "16", "--inference_cfg_rate", "0.6"]
    import server as studio
    import uvicorn
    local = uvicorn.Server(uvicorn.Config(studio.app, host="127.0.0.1", port=7860, log_level="warning"))
    threading.Thread(target=local.run, daemon=True, name="voice-editor").start()
    print("Voice editor: http://127.0.0.1:7860/longform", flush=True)
    print("Gateway key is stored locally; it is never printed.", flush=True)
    app = make_app(studio, runtime, Path(__file__).with_name("voice-studio-worker.py"), token)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
