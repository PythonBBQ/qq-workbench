import {AsyncLocalStorage} from 'node:async_hooks';

// Bound reply work as well as its I/O. A late model result must never send after
// a paused/replaced/timed-out task has released the queue to a later message.
export class ReplyTasks {
  constructor(){this.scope=new AsyncLocalStorage();this.active=null;this.lastError='';}
  check(){this.scope.getStore()?.controller.signal.throwIfAborted();}
  phase(value){this.check();const task=this.scope.getStore();if(task){task.phase=value;task.phaseAt=Date.now();}}
  beginDelivery(){this.check();const task=this.scope.getStore();if(task)task.deliveryStarted=true;}
  cancel(message='本次回复已取消',{finishStarted=false}={}){if(this.active&&!(finishStarted&&this.active.deliveryStarted))this.active.controller.abort(new Error(message));}
  async wait(value,timeoutMs=180000){
    const task=this.scope.getStore();if(!task)return value;
    const signal=task.controller.signal;
    let timer,abort;
    const failure=new Promise((_,reject)=>{
      abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
      timer=setTimeout(()=>task.controller.abort(new Error('本次'+task.phase+'等待超时，已释放回复队列；后续新消息继续处理')),timeoutMs);
    });
    try{const result=await Promise.race([value,failure]);this.check();return result;}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
  }
  fetch(original){return async(input,options={})=>{
    this.check();const task=this.scope.getStore();
    const signal=task?AbortSignal.any([task.controller.signal,...(options.signal?[options.signal]:[])]):options.signal;
    return this.wait(original(input,{...options,...(signal?{signal}:{})}));
  };}
  async run(work,{timeoutMs=15*60000,kind='reply'}={}){
    const task={controller:new AbortController(),kind,at:Date.now(),phase:'准备回复',phaseAt:Date.now()};this.active=task;
    const timer=setTimeout(()=>task.controller.abort(new Error('本次处理超过时限，已释放回复队列；后续新消息继续处理')),timeoutMs);
    try{return await this.scope.run(task,()=>this.wait(Promise.resolve().then(work),timeoutMs));}
    catch(e){this.lastError=e.message;throw e;}
    finally{clearTimeout(timer);if(this.active===task)this.active=null;}
  }
  state(){const task=this.active;return {active:!!task,phase:task?.phase||'空闲',since:task?.at||0,phaseSince:task?.phaseAt||0,lastError:this.lastError};}
}

// Unknown receipts never replay. Keep later messages queued for a fresh
// connection check instead of discarding them during a timed silence window.
export class DeliveryRecovery {
  constructor({now=Date.now}={}){this.now=now;this.holds=new Map();}
  key(event){return String(event.message_type)+':'+String(event.group_id||event.user_id);}
  fail(event){const key=this.key(event),previous=this.holds.get(key),at=this.now(),failures=Math.min(5,(previous?.failures||0)+1);
    const hold={at,until:at+Math.min(300000,30000*2**(failures-1)),failures};this.holds.delete(key);this.holds.set(key,hold);if(this.holds.size>200)this.holds.delete(this.holds.keys().next().value);return hold;}
  allowed(event,connected,verifiedAt){const hold=this.holds.get(this.key(event));if(!hold)return true;return connected&&verifiedAt>=hold.at;}
  success(event){this.holds.delete(this.key(event));}
  state(connected=true,verifiedAt=Infinity){const values=[...this.holds.values()].filter(v=>!connected||verifiedAt<v.at);return {count:values.length,next:0,message:values.length?'上一条发送未确认；新消息等待连接核验，旧消息不重发':''};}
}
