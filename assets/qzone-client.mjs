// SnowLuma supplies the signed-in account's cookies. Android handles HTTPS/DNS.
// This adapter deliberately exposes just a self-space read and a single text post.
const gateways=['https://user.qzone.qq.com/proxy/domain/taotao.qq.com/','https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/'];
function payload(text){
  if(text.length>262144)throw new Error('QQ空间响应过大');
  let s=text.trim();const jsonp=s.match(/^_preloadCallback\(([\s\S]*)\);?$/);if(jsonp)s=jsonp[1];
  let data;try{data=JSON.parse(s);}catch{throw new Error('QQ空间响应结构异常');}
  if(!data||Array.isArray(data)||typeof data!=='object')throw new Error('QQ空间响应结构异常');
  if(typeof data.code!=='number')throw new Error('QQ空间响应结构异常');
  if(data.code!==0||data.subcode!=null&&Number(data.subcode)!==0){
    if([-3,-100,-3000,-10001].includes(data.code))throw new Error('QQ空间登录凭据暂不可用');
    if(/验证|频繁|captcha|risk/.test(String(data.message||'')))throw new Error('QQ空间要求验证或限制了操作');
    throw new Error('QQ空间拒绝请求，错误码 '+data.code);
  }
  return data;
}
export class QzoneClient {
  constructor(rpc,identity,{fetcher=(...args)=>fetch(...args)}={}){this.rpc=rpc;this.identity=identity;this.fetcher=fetcher;this.cached=null;this.route=null;}
  async credentials(bot){
    if(this.cached?.bot===bot&&Date.now()-this.cached.at<60000)return this.cached;
    const r=await this.rpc('get_cookies',{domain:'qzone.qq.com'},60000);
    const cookie=r?.data?.cookies;
    if(r?.status!=='ok'||Number(r.retcode)!==0||typeof cookie!=='string'||cookie.length>16384||/[\r\n]/.test(cookie))throw new Error('QQ空间登录凭据暂不可用');
    const jar=Object.fromEntries(cookie.split(';').map(x=>{const p=x.indexOf('=');return [x.slice(0,p).trim(),x.slice(p+1)];}));
    const accounts=[jar.uin,jar.p_uin].filter(Boolean).map(s=>s.replace(/^o0*/,''));
    if(!accounts.length||accounts.some(s=>s!==bot)||!this.current(bot))throw new Error('QQ空间登录账号不一致，请重新连接');
    const skey=jar.p_skey||jar.skey;if(!skey)throw new Error('QQ空间登录凭据暂不可用');
    let hash=5381;for(const x of skey)hash+=(hash<<5)+x.charCodeAt(0);
    return this.cached={bot,cookie,bkn:String(hash&2147483647),at:Date.now()};
  }
  current(bot){return /^\d{5,12}$/.test(bot)&&this.identity()===bot;}
  async request(action,params={}){
    if(!['get_qzone_msg_list','send_qzone_msg'].includes(action))throw new Error('不支持的空间操作');
    const bot=this.identity();if(!this.current(bot))throw new Error('QQ尚未连接');
    const credentials=await this.credentials(bot);if(!this.current(bot))throw new Error('QQ空间账号已切换');
    const gateway=this.route?.bot===bot&&Date.now()-this.route.at<60000?this.route.gateway:gateways[0];
    let url,options;const headers={Cookie:credentials.cookie,Referer:'https://user.qzone.qq.com/'+bot};
    if(action==='get_qzone_msg_list'){
      url=gateway+'cgi-bin/emotion_cgi_msglist_v6?'+new URLSearchParams({uin:bot,ftype:'0',sort:'0',pos:'0',num:'1',replynum:'0',g_tk:credentials.bkn,format:'json',code_version:'1'});
      options={method:'GET',headers};
    }else{
      if(typeof params.content!=='string'||!params.content.trim()||params.content.length>1000||![1,4,64].includes(params.ugc_right))throw new Error('说说参数无效');
      url=gateway+'cgi-bin/emotion_cgi_publish_v6?g_tk='+credentials.bkn;
      options={method:'POST',headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({syn_tweet_verson:'1',paramstr:'1',pic_template:'',richtype:'',richval:'',special_url:'',subrichtype:'',con:params.content,feedversion:'1',ver:'1',ugc_right:String(params.ugc_right),to_sign:'0',who:'1',hostuin:bot,code_version:'1',format:'json',qzreferrer:'https://user.qzone.qq.com/'+bot}).toString()};
    }
    // No redirect or write retry: an interrupted POST may already have succeeded.
    const read=async(address,timeout)=>{
      const response=await this.fetcher(address,{...options,redirect:'error',signal:AbortSignal.timeout(timeout+2000),networkTimeoutMs:timeout});
      if(!response.ok)throw new Error('QQ空间网络请求失败');
      return payload(await response.text());
    };
    let data;
    try{
      try{data=await read(url,action==='get_qzone_msg_list'?10000:40000);}
      catch(e){
        if(action!=='get_qzone_msg_list'||!this.current(bot))throw e;
        const alternate=gateways.find(g=>g!==gateway);url=url.replace(gateway,alternate);
        data=await read(url,15000);
      }
    }catch(e){this.cached=null;this.route=null;throw e;}
    if(!this.current(bot))throw new Error('QQ空间账号已切换');
    if(action==='get_qzone_msg_list'){
      const empty=data.msglist===null&&data.total===0&&String(data.logininfo?.uin)===bot;
      if(!Array.isArray(data.msglist)&&!empty||!Number.isInteger(data.total)||data.total<0)throw new Error('QQ空间响应结构异常');
      this.route={bot,gateway:gateways.find(g=>url.startsWith(g)),at:Date.now()};
      return {status:'ok',retcode:0,data:{total:data.total,msglist:[]}};
    }
    const tid=data.t1_tid??data.tid;
    if(typeof tid!=='string'||!tid.trim()||tid.length>160)throw new Error('QQ空间发布响应缺少tid，结果未确认');
    return {status:'ok',retcode:0,data:{tid,time:Number(data.t1_time??data.now??0)}};
  }
}
