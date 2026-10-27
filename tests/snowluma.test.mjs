import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readyAccount,oneBotConfig,needsRelaunchRecovery} from '../assets/snowluma-bridge.mjs';

test('recover only a completed launcher with an unhooked QQ relaunch',()=>{
  const relaunch={launcherExited:true,args:['/opt/QQ/qq','--relaunch'],nativeLoaded:false};
  assert.equal(needsRelaunchRecovery(relaunch),true);
  assert.equal(needsRelaunchRecovery({...relaunch,nativeLoaded:true}),false);
  assert.equal(needsRelaunchRecovery({...relaunch,launcherExited:false}),false);
  assert.equal(needsRelaunchRecovery({...relaunch,args:['/opt/QQ/qq']}),false);
});

test('SnowLuma pipe connection or identity hint alone never establishes login',()=>{
  const p={pid:42,uin:'123456',connected:true,loggedIn:true};
  assert.equal(readyAccount([p]),p);
  assert.equal(readyAccount([{...p,loggedIn:false}]),null);
  assert.equal(readyAccount([{...p,connected:false}]),null);
  assert.equal(readyAccount([{...p,uin:'0'}]),null);
  assert.equal(readyAccount([p,{...p,pid:43,uin:'654321'}]),null);
});
test('SnowLuma OneBot is authenticated and limited to the local assistant',()=>{
  const config={storage:{retention:30},networks:{wsClients:[{url:'https://old.example'}],httpServers:[{host:'0.0.0.0'}]}};
  const saved=oneBotConfig(config,'test-token');
  assert.deepEqual(saved.storage,config.storage);
  assert.equal(saved.networks.wsServers[0].host,'127.0.0.1');
  assert.equal(saved.networks.wsServers[0].accessToken,'test-token');
  assert.equal(saved.networks.wsServers[0].port,13001);
  assert.deepEqual(saved.networks.wsClients,[]);assert.deepEqual(saved.networks.httpServers,[]);
  assert.equal(config.networks.wsClients.length,1);
  assert.throws(()=>oneBotConfig({},'test-token'));
});
