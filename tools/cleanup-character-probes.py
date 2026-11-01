"""Remove only this task's exported native probe directories on the tablet."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import shlex

ROOT=Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output=a.output.resolve();a.output.relative_to(ROOT.parents[1])
    spec=importlib.util.spec_from_file_location('worker',ROOT/'tools/android-codex-worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
    d=w.Device(ROOT.parent/'research/android/toolchain/platform-tools/adb.exe','1987aee5',18768);d.connect()
    dirs=set()
    for receipt in a.output.rglob('tablet-probe-receipt.json'):
        row=json.loads(receipt.read_text(encoding='utf-8'))
        if not row.get('liveReferenceUnchanged') or not row.get('liveSettingsUnchanged'):raise ValueError('Probe failed isolation')
        remote=row['remoteProbe'];folder=remote.removesuffix('/outputs')
        if not remote.endswith('/outputs') or not re.fullmatch('/data/user/0/cn.qqworkbench.assistant/files/voice-preset-probe-20261101-[0-9]{6}',folder):raise ValueError('Unexpected cleanup path')
        local=receipt.parent/'tablet/review.json'
        if not local.is_file():raise ValueError('Missing exported results')
        data=json.loads(local.read_text(encoding='utf-8'))
        if len(data['samples'])!=row['samples'] or not all((local.parent/(sample['sample']+'.wav')).is_file() for sample in data['samples']):raise ValueError('Incomplete exported results')
        dirs.add(folder)
    deleted=[]
    for folder in sorted(dirs):
        # Exact app-private task path, not a symlink; recursive rm does not follow
        # its model symlink. All generated audio and receipts are exported first.
        q=shlex.quote(folder);model=shlex.quote(folder+'/zipvoice-models-v1')
        check='if [ -d '+q+' ] && [ ! -L '+q+' ]; then readlink '+model+'; fi'
        target=d.run('shell','run-as',w.PACKAGE,'sh','-c',shlex.quote(check)).decode().strip()
        if not target:continue
        if target!='/data/user/0/'+w.PACKAGE+'/files/zipvoice-models-v1':raise ValueError('Unexpected model link')
        size=d.run('shell','run-as',w.PACKAGE,'du','-sk',folder).decode().split()[0]
        d.run('shell','run-as',w.PACKAGE,'rm','-rf',folder)
        deleted.append({'directory':folder,'freedKiB':int(size)})
    receipt={'deletedOnlyExportedProbeDirectories':deleted,'freedKiB':sum(row['freedKiB'] for row in deleted),'sharedModelDirectoryDeleted':False,'qqMessagesSent':0}
    (a.output/'device-probe-cleanup.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'directories':len(deleted),'freedMiB':round(receipt['freedKiB']/1024,1),'sharedModelDirectoryDeleted':False}))

if __name__=='__main__':main()
