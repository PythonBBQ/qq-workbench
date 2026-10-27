// Only the assistant uses Android networking; QQ/SnowLuma keep their own transport.
export function androidFetch(original,token){
  return async(input,options={})=>{
    const url=new URL(input);
    if(url.protocol!=='https:')return original(input,options);
    const headers=Object.fromEntries(new Headers(options.headers||{}));
    const response=await original('http://127.0.0.1:13481/fetch',{method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({url:url.href,method:options.method||'GET',headers,body:options.body||'',...(Number.isFinite(options.networkTimeoutMs)?{timeoutMs:Math.max(500,Math.min(90000,options.networkTimeoutMs))}:{})}),
      signal:options.signal||AbortSignal.timeout(95000),redirect:'error'});
    const data=await response.json();
    if(!response.ok){const type=['timeout','dns','tls'].includes(data.error)?data.error:'network';throw new Error('安卓网络连接失败：'+({timeout:'连接超时，请检查 VPN 是否覆盖工作台及中转站地址',dns:'域名解析失败',tls:'HTTPS 证书校验失败',network:'请检查网络和 VPN 分流设置'}[type]));}
    const result=new Response([204,205,304].includes(data.status)?null:Buffer.from(data.body,'base64'),{status:data.status,headers:data.headers});
    if(options.redirect==='error'&&result.status>=300&&result.status<400)throw new Error('服务返回跳转，请填写最终 HTTPS 地址');
    return result;
  };
}
