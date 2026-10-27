import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readQqLocks,installProcLocksCompatibility} from '../assets/proc-locks-compat.mjs';
import {completionUrl,verifiedConnection} from '../assets/assistant.mjs';

test('relay bases and full endpoints retain their path without duplicating chat/completions',()=>{
  assert.equal(completionUrl('https://api.deepseek.com'),'https://api.deepseek.com/chat/completions');
  assert.equal(completionUrl('https://relay.example/v1/'),'https://relay.example/v1/chat/completions');
  assert.equal(completionUrl('https://relay.example/custom/chat/completions/'),'https://relay.example/custom/chat/completions');
  for(const url of ['http://relay.example/v1','https://key@relay.example','https://relay.example/?key=secret','file:///tmp/key'])assert.throws(()=>completionUrl(url));
});
test('OneBot socket cannot establish a verified connection with the wrong account or offline status',()=>{
  const login={status:'ok',retcode:0,data:{user_id:765432}};
  const status={status:'ok',retcode:0,data:{online:true,good:false}};
  assert.equal(verifiedConnection(login,status,'765432'),true);
  assert.equal(verifiedConnection(login,status,'123456'),false);
  assert.equal(verifiedConnection(login,{...status,data:{online:false}},'765432'),false);
  assert.equal(verifiedConnection({...login,retcode:1},status,'765432'),false);
  assert.equal(verifiedConnection({},status,'765432'),false);
});
test('kernel lock fallback excludes other app processes, renderers and binaries with mismatched mapped inodes',async()=>{
  const files={
    '/proc/1/cmdline':'/opt/QQ/qq\0--no-sandbox\0',
    '/proc/1/maps':'1000-2000 r-xp 0000 fe:37 123 /data/data/cn.qqworkbench.assistant/files/linux/rootfs/opt/QQ/qq',
    '/proc/1/fdinfo/8':'pos:\t0\nlock:\t1: POSIX ADVISORY READ 1 fe:37:999 128 128\n',
    '/proc/2/cmdline':'/opt/QQ/qq\0--type=renderer\0',
    '/proc/3/cmdline':'/opt/QQ/qq\0',
    '/proc/3/maps':'1000-2000 r-xp 0000 fe:37 124 /data/data/cn.qqworkbench.assistant/files/linux/rootfs/opt/QQ/qq',
  };
  const io={
    stat:async p=>p==='/opt/QQ/qq'?{uid:0,dev:0xfe37,ino:123}:{uid:p==='/proc/4'?400:0},
    readdir:async p=>p==='/tmp/qqwb-runtime'?['mojo.1.control.sock','qqwb-snow-status-1','mojo.2.control.sock','qqwb-snow-status-3','mojo.4.control.sock','unrelated']:['8'],
    readFile:async p=>{assert.ok(p in files,'Unexpected read: '+p);return files[p];},
  };
  assert.equal(await readQqLocks(io),'1: POSIX ADVISORY READ 1 fe:37:999 128 128\n');
});
test('fallback only handles denied global lock reads and retains Buffer/string semantics',async()=>{
  let probes=0;
  const io={readFile:async p=>{if(p==='/proc/locks')throw Object.assign(new Error('denied'),{code:'EACCES'});if(p==='/missing')throw Object.assign(new Error('missing'),{code:'ENOENT'});return 'original';}};
  installProcLocksCompatibility(io,async()=>{probes++;return 'actual kernel locks\n';});
  assert.equal(await io.readFile('/proc/locks','utf8'),'actual kernel locks\n');
  assert.equal((await io.readFile('/proc/locks')).toString(),'actual kernel locks\n');
  assert.equal(probes,1);
  assert.equal(await io.readFile('/ordinary','utf8'),'original');
  await assert.rejects(io.readFile('/missing'),{code:'ENOENT'});
});
