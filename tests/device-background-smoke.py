"""Opt-in device smoke: screen-off/Doze and Wi-Fi recovery. Never send QQ/model requests.
Temporary battery simulation, idle forcing and screen/Wi-Fi changes are restored in finally.
Run only on the explicitly selected connected tablet, not as a routine unit test.
"""
from pathlib import Path
import argparse,json,os,re,subprocess,sys,time,xml.etree.ElementTree as ET
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from adb_device import select_device
parser=argparse.ArgumentParser();parser.add_argument('--idle-seconds',type=int,default=90);parser.add_argument('--network-cycle',action='store_true')
args=parser.parse_args();assert 60<=args.idle_seconds<=180
adb=root.parent/'research/android/toolchain/platform-tools/adb.exe';serial=select_device(adb);env=dict(os.environ,QQWB_DEVICE_SERIAL=serial)
def run(*a):
    r=subprocess.run([str(adb),'-s',serial,*a],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=30,check=True);return r.stdout

def state():
    r=subprocess.run([sys.executable,'-X','utf8',str(root/'device_container.py'),'--accelerated','node /opt/qq-workbench/device-background-state.mjs'],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=30,check=True)
    result=json.loads(next(line for line in r.stdout.splitlines() if line.startswith('{')))
    prefs=ET.fromstring(run('shell','run-as','cn.qqworkbench.assistant','cat','shared_prefs/runtime.xml'))
    allowed={'wifiProtected','networkAvailable','lastHealthy','lastSchedulingGap','lastNetworkResume'}
    for entry in prefs:
        if entry.get('name') in allowed:
            value=entry.get('value','0');result[entry.get('name')]=value=='true' if entry.tag=='boolean' else int(value)
    for name in allowed:result.setdefault(name,False if name in {'wifiProtected','networkAvailable'} else 0)
    return result
def wait(seconds):
    end=time.monotonic()+seconds
    while time.monotonic()<end:time.sleep(min(30,max(0,end-time.monotonic())))
def online(timeout=100):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        try:
            s=state()
            if s['connected']:return s
        except (ValueError,subprocess.SubprocessError):pass
        wait(5)
    raise RuntimeError('QQ did not verify online before deadline')

power=run('shell','dumpsys','power');was_awake='mWakefulness=Awake' in power
battery=run('shell','dumpsys','battery');assert 'UPDATES STOPPED' not in battery,'Existing battery simulation: preserve it, do not start this test'
wifi_enabled=run('shell','settings','get','global','wifi_on').strip()=='1'
run('push',str(root/'tests/device-background-state.mjs'),'/data/local/tmp/qqwb-background-state.mjs')
run('shell','run-as','cn.qqworkbench.assistant','cp','/data/local/tmp/qqwb-background-state.mjs','files/linux/rootfs/opt/qq-workbench/device-background-state.mjs')
evidence={'noDiagnosticQQMessages':True,'noModelCalls':True,'secondsScreenOff':args.idle_seconds}
forced=False;unplugged=False;wifi_changed=False
try:
    evidence['before']=online();assert evidence['before']['enabled'];assert evidence['before']['wifiProtected'],'Wi-Fi lock not active'
    run('shell','input','keyevent','KEYCODE_HOME');run('shell','input','keyevent','KEYCODE_SLEEP')
    run('shell','dumpsys','battery','unplug');unplugged=True
    idle=run('shell','dumpsys','deviceidle','force-idle');forced=True
    evidence['forcedIdle']='IDLE' in idle.upper();print(json.dumps({'phase':'screen-off-idle-observation','forcedIdle':evidence['forcedIdle']}),flush=True)
    wait(args.idle_seconds)
    evidence['duringIdle']=state()
    idle_state=run('shell','dumpsys','deviceidle');evidence['deepIdleAtReadback']=bool(re.search(r'mState=IDLE(?:\s|$)',idle_state))
    assert evidence['duringIdle']['connected'],'QQ disconnected during screen-off/idle'
    assert evidence['duringIdle']['assistantPid']==evidence['before']['assistantPid'],'Assistant restarted during screen-off/idle'
    assert evidence['duringIdle']['lastHealthy']>=evidence['before']['at']+60000,'Health checks did not continue during idle'
    run('shell','dumpsys','deviceidle','unforce');forced=False
    run('shell','dumpsys','battery','reset');unplugged=False
    evidence['afterIdle']=online()
    if args.network_cycle and wifi_enabled:
        run('shell','svc','wifi','disable');wifi_changed=True;wait(8)
        evidence['wifiOff']=state();assert not evidence['wifiOff']['networkAvailable'],'Default network still active: cannot prove Wi-Fi-off case'
        run('shell','svc','wifi','enable');wifi_changed=False
        start=time.monotonic();previous=evidence['wifiOff']['lastNetworkResume'];end=start+90
        while time.monotonic()<end:
            current=state()
            if current['connected'] and current['networkAvailable'] and current['wifiProtected'] and current['lastNetworkResume']>previous:break
            wait(3)
        else:raise RuntimeError('Wi-Fi recovery callback not observed')
        evidence['afterWifi']=current;evidence['wifiRecoverySeconds']=round(time.monotonic()-start,2)
        assert current['assistantPid']==evidence['before']['assistantPid'],'Assistant restarted on Wi-Fi change'
    evidence['passed']=True
finally:
    if wifi_changed:run('shell','svc','wifi','enable')
    if forced:run('shell','dumpsys','deviceidle','unforce')
    if unplugged:run('shell','dumpsys','battery','reset')
    if was_awake:run('shell','input','keyevent','KEYCODE_WAKEUP')
    evidence['temporaryPowerSettingsRestored']=True
    output=root/'build/device-background-smoke.json';output.write_bytes(json.dumps(evidence,ensure_ascii=False,indent=2).encode('utf-8'))
print(json.dumps(evidence,ensure_ascii=False),flush=True)
