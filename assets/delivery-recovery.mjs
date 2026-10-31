// Never replay a message with an unknown receipt. Only later messages may resume.
export class DeliveryRecovery {
  constructor({now=Date.now}={}){this.now=now;this.holds=new Map();}
  key(event){return String(event.message_type)+':'+String(event.group_id||event.user_id);}
  fail(event){const key=this.key(event),previous=this.holds.get(key),at=this.now(),failures=Math.min(5,(previous?.failures||0)+1);
    const hold={at,until:at+Math.min(300000,30000*2**(failures-1)),failures};this.holds.delete(key);this.holds.set(key,hold);if(this.holds.size>200)this.holds.delete(this.holds.keys().next().value);return hold;}
  allowed(event,connected,verifiedAt){const hold=this.holds.get(this.key(event));if(!hold)return true;return connected&&this.now()>=hold.until&&verifiedAt>=hold.at;}
  success(event){this.holds.delete(this.key(event));}
  state(connected=true,verifiedAt=Infinity){const values=[...this.holds.values()].filter(v=>this.now()<v.until||!connected||verifiedAt<v.at);return {count:values.length,next:values.length?Math.min(...values.map(v=>v.until)):0,message:values.length?'个别会话发送未确认；短暂保护后核验连接，只处理新消息，旧消息不重发':''};}
}
