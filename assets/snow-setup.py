"""Prepare a dedicated SnowLuma QQ profile without changing existing data."""
from pathlib import Path
import os
import shutil

target = Path('/root/.local/share/qqwb-snow/.config/QQ')
if not target.exists():
    source = next((p for p in [Path('/root/.local/share/qqwb-napcat/.config/QQ'), Path('/root/.config/QQ')] if p.is_dir()), None)
    target.parent.mkdir(parents=True, exist_ok=True)
    if source:
        stage = target.with_name('QQ.stage')
        shutil.copytree(source, stage, symlinks=True, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('SingletonLock', 'SingletonCookie', 'SingletonSocket'))
        os.rename(stage, target)
    else:
        target.mkdir()
print('QQWB:SnowLuma 独立登录环境已准备，已有 QQ 数据保留', flush=True)
