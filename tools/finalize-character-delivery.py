"""Verify matching native, MP3, APK and delta artifacts for the local handoff."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parents[1]

def sha(file):
    with file.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--tablet',type=Path,required=True);a=p.parse_args()
    a.output=a.output.resolve();a.output.relative_to(ROOT.parents[1]);a.tablet=a.tablet.resolve();a.tablet.relative_to(a.output)
    load=lambda file:json.loads(file.read_text(encoding='utf-8'))
    package=load(a.output/'package-receipt.json');pack=a.output/package['package'];assert sha(pack)==package['sha256']
    native=load(a.tablet.parent/'tablet-probe-receipt.json');assert native['packSHA256']==package['sha256'] and native['samples']==97
    assert native['liveReferenceUnchanged'] and native['liveSettingsUnchanged'] and native['qqMessagesSent']==0
    delivery=load(a.output/'实际发送音频/delivery-receipt.json');checks=load(a.output/'实际发送音频/audio-verification.json');assert len(delivery['samples'])==checks['samples']==97
    for row in delivery['samples']:
        assert sha(a.tablet/(row['sample']+'.wav'))==row['sourceSHA256']
        assert sha(Path(row['output']))==row['outputSHA256']
    build=load(a.output/'apk-build-receipt.json');apk=Path(build['output']['apk']);assert sha(apk)==build['output']['sha256']
    with zipfile.ZipFile(apk) as z:
        assert hashlib.sha256(z.read('assets/character-daily-references.zip')).hexdigest()==package['sha256']
        assert b'apad=pad_dur=1.5' in z.read('assets/voice.mjs')
    patches=[]
    for file,patch in [('patch-receipt.json','QQWorkbench-1.0.1-to-1.0.2-声音预设.qqpatch'),('patch-1.0.0-receipt.json','QQWorkbench-1.0.0-to-1.0.2-声音预设.qqpatch')]:
        row=load(a.output/file);assert row['targetSha256']==build['output']['sha256'];assert sha(a.output/patch)==row['patchSha256']
        with zipfile.ZipFile(a.output/patch) as z:assert json.loads(z.read('manifest.json'))['targetSha256']==build['output']['sha256']
        patches.append({'baseSHA256':row['baseSha256'],'bytes':row['patchBytes'],'sha256':row['patchSha256']})
    node=(a.output/'node-regression.log').read_text(encoding='utf-8');assert 'pass 29' in node and 'fail 0' in node
    original=load(ROOT/'build/v1-restore-receipt.json');assert original['restored']=='first-version-six-mood-feiyu' and original['qqConnected']
    asr=load(a.tablet.parent/'分析/two-asr-audit.json');assert asr['samples']==88 and not asr['below0.85'] and not asr['tailNotRecognizedByEither']
    report={'version':'1.0.2','localPersonalPreset':True,'preset':package,'nativeProbe':native,'deliverySamplesVerified':97,'twoASRReviewedSamples':88,'tailPaddingSeconds':1.5,'nativeRegressionGroups':11,'voiceJavaScriptTests':29,'apk':build['output'],'patches':patches,'originalFeiyuV1Preserved':True,'installedOnTablet':False,'publishedToGitHub':False,'qqMessagesSent':0,'weightsTrained':False,'limitations':'Reference conditioning, not weight training. Naturalness requires listening; small-model synthesis may still mispronounce words. Silence cannot restore words the model did not generate.'}
    (a.output/'final-delivery-receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['version','deliverySamplesVerified','tailPaddingSeconds','originalFeiyuV1Preserved','installedOnTablet','publishedToGitHub','qqMessagesSent']},ensure_ascii=False))

if __name__=='__main__':main()
