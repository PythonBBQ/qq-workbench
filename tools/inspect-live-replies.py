"""Read-only reply diagnostics; credentials and conversation contents never print."""
import argparse,json,subprocess,urllib.request,xml.etree.ElementTree as ET
from pathlib import Path

def main():
    p=argparse.ArgumentParser();p.add_argument('--adb',type=Path,required=True);p.add_argument('--serial',required=True);p.add_argument('--output',type=Path);p.add_argument('--brief',action='store_true');a=p.parse_args()
    def adb(*parts,check=True):
        return subprocess.run([str(a.adb),'-s',a.serial,*parts],capture_output=True,check=check,timeout=20).stdout
    package='cn.qqworkbench.assistant';result={}
    for name,allowed in [('runtime',{'requested','qqConnected','lastHealthy','lastSchedulingGap','healthStatus','networkAvailable','deviceIdle','recoveryAttempts'}),('maintenance',{'kind','resume'})]:
        try:
            xml=ET.fromstring(adb('shell','run-as',package,'cat','shared_prefs/'+name+'.xml'))
            result[name]={e.get('name'):e.get('value',e.text) for e in xml if e.get('name') in allowed}
        except Exception:result[name]={'unavailable':True}
    processes=adb('shell','ps','-A','-o','PID,NAME').decode().splitlines()
    token=None
    for line in processes:
        columns=line.split()
        if len(columns)!=2 or columns[1]!='node':continue
        pid=columns[0]
        cmd=adb('shell','run-as',package,'cat','/proc/'+pid+'/cmdline',check=False)
        if b'/opt/qq-workbench/assistant.mjs\0' not in cmd:continue
        env=adb('shell','run-as',package,'cat','/proc/'+pid+'/environ',check=False)
        token=next((v[16:].decode() for v in env.split(b'\0') if v.startswith(b'WORKBENCH_TOKEN=')),None)
        if token:result['assistantPid']=int(pid);break
    if token:
        port=adb('forward','tcp:0','tcp:13480').decode().strip()
        try:
            req=urllib.request.Request('http://127.0.0.1:'+port+'/state',headers={'Authorization':'Bearer '+token})
            with urllib.request.urlopen(req,timeout=8) as response:state=json.load(response)
            result['assistant']={k:state.get(k) for k in ['connected','enabled','queue','deliveryRecovery','voice','processing']}
            result['connection']=state.get('summary','').split('\n')[0]
            # Voice status includes no text input; retain only diagnostic attributes.
            if isinstance(result['assistant'].get('voice'),dict):result['assistant']['voice']={k:state['voice'].get(k) for k in ['status','at','decision','message']}
            result['statusEvents']=[line for line in state.get('recentText','').splitlines() if line.startswith(('状态：','连接：'))][-8:]
        except Exception as e:result['localEndpointError']=type(e).__name__
        finally:adb('forward','--remove','tcp:'+port,check=False)
    else:result['assistantRunning']=False
    for name in ['delivery-journal','usage-ledger']:
        try:
            data=json.loads(adb('shell','run-as',package,'cat','files/linux/rootfs/opt/qq-workbench/'+name+'.json'))
            if name=='delivery-journal':
                values=list(data.values());result['journal']={state:values.count(state) for state in set(values)};result['lastDeliveries']=values[-12:]
            else:result['lastModelCalls']=[{k:row.get(k) for k in ['at','category','ok','ms','input','output']} for row in data[-12:]]
        except Exception:result[name]={'unavailable':True}
    if a.output:a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    if a.brief:
        calls=result.get('lastModelCalls',[])[-3:]
        result={k:result[k] for k in ['runtime','assistantPid','assistant','connection','localEndpointError','journal'] if k in result}
        result['lastModelCalls']=calls if not a.output else '诊断文件中保留调用状态，不含消息正文'
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
