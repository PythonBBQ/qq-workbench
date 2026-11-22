import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../assets/qq-login-keyboard.js',import.meta.url),'utf8');
async function setup(overrides={}) {
    const sent=[];const input={value:'___',setAttribute(){},focus(){document.activeElement=this;},setSelectionRange(){}};
    const document={activeElement:null,getElementById:()=>input};
    const UI={connected:true,rfb:{viewOnly:false,sendKey:(...args)=>sent.push(args)}};
    const window={};const location={protocol:'http:',hostname:'127.0.0.1',port:'16080',...overrides};
    const load=async name=>{assert.match(name,/^http:\/\/127\.0\.0\.1:1608[0-3]\//);return {default:name.endsWith('/ui.js')?UI:{lookup:cp=>cp<=255?cp:0x1000000|cp}};};
    Function('window','location','document','load',source.replace(/\bimport\(/g,'load('))(window,location,document,load);
    if(window.qqwbLoginInput)await window.qqwbLoginInput.prepare;
    return {window,UI,input,sent,document};
}
test('login adapter restricts loading to the four loopback account windows',async()=>{
    for(const p of ['16080','16081','16082','16083'])assert((await setup({port:p})).window.qqwbLoginInput);
    for(const change of [{hostname:'example.com'},{port:'16084'},{protocol:'https:'}])assert.equal((await setup(change)).window.qqwbLoginInput,undefined);
});
test('keyboard focus reaches the noVNC text input',async()=>{
    const s=await setup();assert.equal(s.window.qqwbLoginInput.showKeyboard(),true);assert.equal(s.document.activeElement,s.input);
});
test('account text replaces selected field without pressing Enter',async()=>{
    const s=await setup();assert(s.window.qqwbLoginInput.sendText('12345678'));
    assert.deepEqual(s.sent.slice(0,3),[[0xffe3,'ControlLeft',true],[0x61,'KeyA'],[0xffe3,'ControlLeft',false]]);
    assert.deepEqual(s.sent.slice(3),[...'12345678'].map(c=>[c.codePointAt(0)]));
    assert(!s.sent.some(([key])=>key===0xff0d));
});
test('password punctuation and Unicode are delivered literally',async()=>{
    const s=await setup();const text='a\"\\\');window.hacked=true;//中😀';
    assert(s.window.qqwbLoginInput.sendText(text));assert.equal(s.window.hacked,undefined);
    assert.equal(s.sent.length,3+[...text].length);assert.equal(s.sent.at(-1)[0],0x101f600);
});
test('disconnected and read-only sessions reject all input',async()=>{
    for(const readonly of [false,true]){const s=await setup();s.UI.connected=readonly;s.UI.rfb.viewOnly=readonly;
        assert.equal(s.window.qqwbLoginInput.sendText('12345'),false);assert.equal(s.window.qqwbLoginInput.showKeyboard(),false);assert.equal(s.sent.length,0);}
});
test('empty, control-containing, and overlong values cause no remote keys',async()=>{
    const s=await setup();for(const text of ['','x\nlogin','\t','\0','x'.repeat(513)])assert.equal(s.window.qqwbLoginInput.sendText(text),false);assert.equal(s.sent.length,0);
});
test('a failed select-all releases Control before reporting failure',async()=>{
    const s=await setup();s.UI.rfb.sendKey=(...key)=>{s.sent.push(key);if(key[0]===0x61)throw Error('test transport failure');};
    assert.throws(()=>s.window.qqwbLoginInput.sendText('12345'));assert.deepEqual(s.sent.at(-1),[0xffe3,'ControlLeft',false]);
});
