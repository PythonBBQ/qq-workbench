"""Select the explicitly requested device, or the sole connected device; never assume the old tablet."""
import subprocess,os

def select_device(adb,serial=None):
    explicit=serial or os.environ.get('QQWB_DEVICE_SERIAL')
    result=subprocess.run([str(adb),'devices','-l'],check=True,capture_output=True,text=True,encoding='utf-8',errors='replace')
    entries=[line.split()[:2] for line in result.stdout.splitlines()[1:] if len(line.split())>=2]
    ready=[row[0] for row in entries if row[1]=='device']
    if explicit:
        if explicit not in ready:raise RuntimeError('Requested Android device is not online; unlock it and authorize USB debugging.')
        return explicit
    if len(ready)==1:return ready[0]
    if not ready:raise RuntimeError('No authorized ADB device; unlock the phone and authorize USB debugging.')
    raise RuntimeError('Multiple ADB devices; specify QQWB_DEVICE_SERIAL for the intended phone.')
