"""Prepare the optional desktop voice stack without touching a global Python.

Run with Python 3.11+ and uv installed. Large downloads are pinned and resumable.
Models stay on the desktop; this is not an Android CUDA runtime.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
SOURCES = {
    "studio": ("lfandrh/indextts2-studio", "3004e8494c7e783de4bdb7da3f5552d6d5b7c115"),
    "longform": ("Mars-1438/indextts2-longform-workbench", "dcaee86bdd572d6db8b5e0bae97cba511534d114"),
    "feiyu": ("Esmerubphire/astrbot_plugin_feiyu_voice", "76774b499f7d306454562d56348dd63399b6d7e8"),
    "tts": ("FunAudioLLM/CosyVoice", "074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc"),
    "rvc": ("IAHispano/Applio", "67a38f6abab3e90a55efa534ea3185a222c102f0"),
}


def run(command, env):
    subprocess.run(list(map(str, command)), env=env, check=True)


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--uv", default=shutil.which("uv"))
    parser.add_argument("--proxy")
    parser.add_argument("--start", action="store_true")
    parser.add_argument("--keep-package-cache", action="store_true",
                        help="Keep redownloadable uv cache after setup for frequent offline environment rebuilds")
    args = parser.parse_args()
    if not args.uv or not shutil.which("git"):
        parser.error("Install uv and Git first; no global Python packages will be changed")
    runtime = args.runtime.resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "UV_CACHE_DIR": str(runtime / "uv-cache"),
           "UV_PYTHON_INSTALL_DIR": str(runtime / "python"),
           "UV_PYTHON_BIN_DIR": str(runtime / "python-bin"), "UV_LINK_MODE": "hardlink",
           "OMP_NUM_THREADS": "4", "MKL_NUM_THREADS": "4", "GIT_LFS_SKIP_SMUDGE": "1"}
    if args.proxy:
        env.update(HTTPS_PROXY=args.proxy, HTTP_PROXY=args.proxy)
    sources = {}
    for name, (repo, revision) in SOURCES.items():
        target = runtime / "sources" / name
        if not (target / ".git").is_dir():
            target.parent.mkdir(parents=True, exist_ok=True)
            run(["git", "-c", "http.version=HTTP/1.1", "clone", "--filter=blob:none", "--no-checkout", "https://github.com/" + repo + ".git", target], env)
            run(["git", "-C", target, "-c", "http.version=HTTP/1.1", "checkout", "--detach", revision], env)
        actual = subprocess.check_output(["git", "-C", str(target), "rev-parse", "HEAD"], env=env, text=True).strip()
        if actual != revision:
            raise ValueError("Source changed; refusing to reset user files: " + name)
        sources[name] = target
    run(["git", "-C", sources["tts"], "-c", "http.version=HTTP/1.1", "submodule", "update", "--init", "--recursive"], env)
    run([args.uv, "sync", "--project", sources["studio"], "--extra", "server", "--python", "3.11", "--frozen"], env)
    python = sources["studio"] / (".venv/Scripts/python.exe" if os.name == "nt" else ".venv/bin/python")
    run([args.uv, "pip", "install", "--python", python, "imageio-ffmpeg==0.6.0"], env)
    ffmpeg = Path(subprocess.check_output([str(python), "-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], env=env, text=True).strip())
    (runtime / "bin").mkdir(exist_ok=True)
    shutil.copyfile(ffmpeg, runtime / "bin" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg"))
    setup = module("voice_setup", HERE / "voice-studio-setup.py")
    setup.install_overlay(sources["studio"], sources["longform"])
    adapter = sources["feiyu"] / "server"
    overlay = adapter / "runtime_compat/Applio"
    pins = json.loads((overlay.parent / "source_sha256.json").read_text())
    import hashlib
    for name, digest in pins.items():
        source = overlay / name
        if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise ValueError("RVC compatibility source checksum mismatch")
        target = sources["rvc"] / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    downloader = module("voice_models", HERE / "voice-studio-models.py")
    run([sys.executable, HERE / "voice-studio-models.py", "--runtime", runtime,
         *(["--proxy", args.proxy] if args.proxy else [])], env)
    for asset in json.loads((overlay.parent / "upstream_assets.json").read_text()):
        source = runtime / "models/RVC-assets" / Path(asset["destination"]).name
        with source.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != asset["sha256"]:
                raise ValueError("RVC frontend asset checksum mismatch")
        target = sources["rvc"] / asset["destination"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    constraint = runtime / "torch-constraints.txt"
    constraint.write_text("torch==2.8.0+cu128\ntorchaudio==2.8.0+cu128\n", encoding="ascii")
    for engine in ("tts", "rvc"):
        venv = runtime / ("feiyu-" + engine + "-venv")
        executable = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        if not executable.exists():
            run([args.uv, "venv", "--python", "3.11", venv], env)
        run([args.uv, "pip", "install", "--python", executable, "--index-url", "https://download.pytorch.org/whl/cu128", "torch==2.8.0+cu128", "torchaudio==2.8.0+cu128"], env)
        requirements = adapter / ("runtime_profiles/requirements-" + engine + ".txt")
        if engine == "tts":
            # 0.0.4 attempts an unpinned network snapshot at every process start.
            # 0.1.0 includes its normalization FSTs and keeps the same public API.
            adapted = runtime / "requirements-tts-local.txt"
            adapted.write_text(requirements.read_text().replace("wetext==0.0.4", "wetext==0.1.0"), encoding="utf-8")
            requirements = adapted
        run([args.uv, "pip", "install", "--python", executable, "-r", requirements, "--constraint", constraint,
             *(["setuptools==80.9.0"] if engine == "tts" else [])], env)
        setup.register_runtime(engine, sources[engine], executable, adapter, runtime)
    launch = {"python": str(python), "studio": str(sources["studio"]), "runtime": str(runtime)}
    (runtime / "launcher.local.json").write_text(json.dumps(launch, indent=2), encoding="utf-8")
    # uv installs unlink/replace managed files on upgrades. Same-volume hardlinks
    # share identical package binaries; removing the cache leaves venv links valid.
    # Models and Hugging Face data are separate and are never cleaned here.
    if not args.keep_package_cache:
        run([args.uv, "cache", "clean", "--cache-dir", runtime / "uv-cache"], env)
    print("Environment and models prepared. Real voice validation is still required.")
    if args.start:
        run([python, HERE / "voice-studio-gateway.py", "--studio", sources["studio"], "--runtime", runtime], env)


if __name__ == "__main__":
    main()
