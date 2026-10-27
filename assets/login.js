const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
history.replaceState(null,'','/login');
const status=document.getElementById('status'),accounts=document.getElementById('accounts'),qr=document.getElementById('qr'),refresh=document.getElementById('refresh');
let loading=false,acting=false,accountsKey='';
async function api(route,body){
  if(!token)throw new Error('请返回工作台，再打开 QQ 登录页面');
  const response=await fetch(route,{headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    method:body===undefined?'GET':'POST',...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('本机 QQ 接入正在准备，请稍候；若持续不变，请返回查看运行诊断');
  return response.json();
}
async function poll(){
  if(loading||acting)return;loading=true;
  try{
    const data=await api('/qq/login'),s=data.status;
    status.textContent=data.connected?`QQ ${data.uin} 已连接，身份与在线状态核验通过。可以返回工作台。`:
      s.isLogin?`QQ ${data.uin} 已登录，正在连接消息接口…`:
      s.loginError?`QQ 登录提示：${s.loginError}`:
      s.qrLoginAccepted?'QQ 已接受登录，正在初始化消息接口…':'请选择已有账号快速登录，或扫码登录。';
    qr.hidden=s.isLogin||!data.qr;refresh.hidden=s.isLogin;
    if(data.qr&&!s.isLogin&&qr.src!==data.qr)qr.src=data.qr;
    const list=s.isLogin?[]:data.accounts||[],key=JSON.stringify(list.map(a=>a.uin));
    if(key!==accountsKey){accountsKey=key;accounts.replaceChildren();for(const account of list){
      const button=document.createElement('button');button.textContent=`快速登录 QQ ${account.uin}`;
      button.onclick=async()=>{acting=true;button.disabled=true;try{const r=await api('/connect',{uin:account.uin});status.textContent=r.message;}catch(e){status.textContent=e.message;}finally{acting=false;button.disabled=false;}};
      accounts.append(button);
    }}
  }catch(e){status.textContent=e.message;qr.hidden=true;}
  finally{loading=false;}
}
refresh.onclick=async()=>{acting=true;refresh.disabled=true;try{const r=await api('/qq/refresh',{});status.textContent=r.message;}catch(e){status.textContent=e.message;}finally{acting=false;refresh.disabled=false;void poll();}};
void poll();setInterval(()=>{if(!document.hidden)void poll();},3000);
