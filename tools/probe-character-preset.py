"""Exercise the production native preset engine in an isolated tablet directory."""
import argparse
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--pack',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--serial',default='1987aee5');p.add_argument('--long-only',action='store_true');p.add_argument('--focus',action='store_true');p.add_argument('--calibrate',action='store_true');p.add_argument('--calibrate-second',action='store_true');p.add_argument('--fragile',action='store_true');p.add_argument('--quality',action='store_true');p.add_argument('--tablet',action='store_true')
    args=p.parse_args();args.output=args.output.resolve();args.output.relative_to(ROOT.parents[1]);args.output.mkdir(parents=True,exist_ok=True)
    subprocess.run([sys.executable,str(ROOT/'tests/run-native-settings.py'),'--compile-only','--character-preset'],check=True)
    spec=importlib.util.spec_from_file_location('worker',ROOT/'tools/android-codex-worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
    d=w.Device(ROOT.parent/'research/android/toolchain/platform-tools/adb.exe',args.serial,18768);d.connect()
    original=d.run('exec-out','run-as',w.PACKAGE,'cat','files/voice-references/slot-0/pack.json')
    config_before=d.run('exec-out','run-as',w.PACKAGE,'cat','files/settings.json')
    ident=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
    check='/data/local/tmp/qqwb-character-probe.jar';pack='/data/local/tmp/qqwb-character-probe.zip'
    # Files created by this diagnostic are immutable before loading dex on API35.
    d.run('shell','sh','-c',shlex.quote('if [ -f '+check+' ]; then chmod 644 '+check+'; fi'))
    d.run('push',str(ROOT/'build/native-settings-check/check.jar'),check);d.run('shell','chmod','444',check)
    d.run('push',str(args.pack.resolve()),pack)
    package=d.run('shell','dumpsys','package',w.PACKAGE).decode('utf-8',errors='replace')
    library=re.search(r'legacyNativeLibraryDir=(.*)',package).group(1).strip()+'/arm64'
    if sum([args.long_only,args.focus,args.calibrate,args.calibrate_second,args.fragile,args.quality,args.tablet])>1:raise ValueError('Select one probe mode')
    command=shlex.join(['run-as',w.PACKAGE,'sh','-c',shlex.join(['env','CLASSPATH='+check,'LD_LIBRARY_PATH='+library,'/system/bin/app_process64','/system/bin','cn.qqworkbench.assistant.CharacterPresetProbe',ident,pack]+(['tablet'] if args.tablet else ['quality'] if args.quality else ['long'] if args.long_only else ['focus'] if args.focus else ['calibrate'] if args.calibrate else ['calibrate-b'] if args.calibrate_second else ['fragile'] if args.fragile else []))])
    log=args.output/'native-probe.log'
    with log.open('w',encoding='utf-8') as output:
        proc=subprocess.run([str(d.adb),'-s',args.serial,'shell',command],stdout=output,stderr=subprocess.STDOUT,timeout=1100)
    text=log.read_text(encoding='utf-8',errors='replace')
    if proc.returncode or 'QQWB_CHARACTER_PRESET_OK' not in text:
        print(text[-6000:]);raise RuntimeError('Native preset probe did not confirm completion')
    remote='/data/user/0/'+w.PACKAGE+'/files/voice-preset-probe-'+ident+'/outputs'
    # run-as can read the outputs without changing their application ownership.
    dest=args.output/'tablet';dest.mkdir(exist_ok=True)
    review=json.loads(d.run('exec-out','run-as',w.PACKAGE,'cat',remote+'/review.json'))
    for row in review['samples']:
        name=row['sample']+'.wav';(dest/name).write_bytes(d.run('exec-out','run-as',w.PACKAGE,'cat',remote+'/'+name))
    (dest/'review.json').write_text(json.dumps(review,ensure_ascii=False,indent=2),encoding='utf-8')
    unchanged=original==d.run('exec-out','run-as',w.PACKAGE,'cat','files/voice-references/slot-0/pack.json')
    config_unchanged=config_before==d.run('exec-out','run-as',w.PACKAGE,'cat','files/settings.json')
    if not unchanged or not config_unchanged:raise RuntimeError('Live voice or settings changed during isolated probe')
    report={'samples':len(review['samples']),'liveReferenceUnchanged':unchanged,'liveSettingsUnchanged':config_unchanged,'qqConnectedAfter':d.api('/state').get('connected'),'qqMessagesSent':0,'remoteProbe':remote,'packSHA256':hashlib.sha256(args.pack.read_bytes()).hexdigest()}
    (args.output/'tablet-probe-receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
