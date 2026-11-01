"""Run the upstream Feiyu adapters in their own pinned, isolated environments."""
import argparse
import json
import os
from pathlib import Path
import shutil
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--engine", choices=("tts", "rvc"), required=True)
    parser.add_argument("--request", type=Path, required=True)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    for key, name in {"HF_HOME":"hf-cache", "MODELSCOPE_CACHE":"modelscope-cache",
                      "TORCH_HOME":"torch-cache", "TORCH_EXTENSIONS_DIR":"torch-extensions",
                      "XDG_CACHE_HOME":"cache", "MPLCONFIGDIR":"matplotlib", "NLTK_DATA":"nltk-data"}.items():
        directory = runtime / name
        directory.mkdir(parents=True, exist_ok=True)
        os.environ[key] = str(directory)
    profile = json.loads((runtime / (args.engine + "-profile.local.json")).read_text(encoding="utf-8"))
    server = Path(profile["adapter_source"]).resolve()
    sys.path.insert(0, str(server))
    request = json.loads(args.request.read_text(encoding="utf-8"))
    output = Path(request["output_dir"]).resolve()
    output.relative_to(runtime / "jobs")
    if args.engine == "tts":
        from feiyu_runtime.tts import main as run
        return run(runtime / "models/FeiyuVoice-CosyVoice3", profile, ["--request", str(args.request)])
    from feiyu_runtime.rvc import main as run
    result = run(runtime / "models/FeiyuVoice-RVC", profile,
                 ["--input", request["input"], "--output-dir", str(output)])
    # The RVC adapter writes a verified PCM playback file and an audit receipt.
    receipt = json.loads((output / "cover_result.json").read_text(encoding="utf-8"))
    if receipt.get("status") != "success":
        raise ValueError("RVC conversion did not finish")
    import soundfile as sf
    audio, rate = sf.read(output / "rvc_native.wav", dtype="float32")
    sf.write(output / "speech.wav", audio, rate, subtype="PCM_16")
    return result


if __name__ == "__main__":
    raise SystemExit(main())
