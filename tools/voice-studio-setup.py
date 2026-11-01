"""Install the longform overlay into an existing pinned IndexTTS checkout.

All destinations, caches and profiles stay inside the chosen runtime directory.
Upstream code/model licenses are retained. No global pip or system PATH edits.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

PINS = {"studio": "3004e8494c7e783de4bdb7da3f5552d6d5b7c115",
        "longform": "dcaee86bdd572d6db8b5e0bae97cba511534d114",
        "feiyu": "76774b499f7d306454562d56348dd63399b6d7e8",
        "tts": "074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc",
        "rvc": "67a38f6abab3e90a55efa534ea3185a222c102f0"}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def install_overlay(studio, longform):
    installer = load_module("longform_installer", longform / "packaging/install.py")
    receipt = []
    for name in installer.CORE_FILES:
        shutil.copyfile(longform / name, studio / name)
        receipt.append(name)
    for folder in ("web", "assets"):
        source = longform / folder
        if source.is_dir():
            shutil.copytree(source, studio / folder, dirs_exist_ok=True)
    for filename in ("LICENSE", "README.md", "CHANGELOG.md"):
        if (longform / filename).is_file():
            shutil.copyfile(longform / filename, studio / ("LONGFORM-" + filename))
    status, message = installer.patch_server(str(studio))
    if status == "fail":
        raise RuntimeError(message)
    installer.patch_index(str(studio))
    installer.ensure_dirs(str(studio))
    return {"modules": receipt, "server": status, "commit": PINS["longform"]}


def register_runtime(engine, source, python, adapter_source, runtime):
    commit = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if commit != PINS[engine]:
        raise ValueError("Unexpected " + engine + " source revision")
    sys.path.insert(0, str(adapter_source))
    setup = load_module("feiyu_setup", adapter_source / "scripts/setup_runtime.py")
    actual = json.loads(subprocess.check_output([str(python), "-c",
        "import json,torch,torchaudio;print(json.dumps([str(torch.__version__),str(torchaudio.__version__),torch.cuda.is_available()]))"], text=True))
    if not actual[2]:
        raise ValueError("The requested native CUDA runtime is unavailable")
    preset = json.loads((adapter_source / "runtime_profiles/cuda.json").read_text())
    stack = {**preset["engines"][engine], "torch": actual[0], "torchaudio": actual[1]}
    profile = setup.build_profile(preset, stack, engine, python.resolve(), source.resolve(), "native-windows")
    profile.update(adapter_source=str(adapter_source.resolve()),
                   compatibility="QQ Workbench native Windows CUDA; requires local synthesis validation")
    output = runtime / (engine + "-profile.local.json")
    output.write_text(json.dumps(profile, indent=2), encoding="utf-8")
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--studio", type=Path)
    parser.add_argument("--longform", type=Path)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--engine", choices=("tts", "rvc"))
    parser.add_argument("--source", type=Path)
    parser.add_argument("--python", type=Path)
    parser.add_argument("--adapter-source", type=Path)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    runtime.mkdir(parents=True, exist_ok=True)
    if args.studio and args.longform:
        result = install_overlay(args.studio.resolve(), args.longform.resolve())
        (runtime / "longform-install.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print("Longform overlay installed; import and synthesis validation pending.")
    if args.engine:
        if not all((args.source, args.python, args.adapter_source)):
            parser.error("--source, --python and --adapter-source are required for runtime registration")
        register_runtime(args.engine, args.source, args.python, args.adapter_source, runtime)
        print("Runtime registered; synthesis validation pending.")


if __name__ == "__main__":
    main()
