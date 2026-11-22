import crypto from 'node:crypto';
import {memoryTerms} from './conversation-memory.mjs';
const minute=60000,day=1440*minute;
export const ownerChatCategories={
  company:{label:'陪伴与心情',points:26},interest:{label:'兴趣闲聊',points:24},
  daily:{label:'日常生活',points:22},plan:{label:'安排与进展',points:18},
  help:{label:'工作与求助',points:10},lookup:{label:'一次性查询',points:2},
  general:{label:'其他聊天',points:8}
};
export const ownerChatTimeBands=[
  {from:0,to:6,label:'深夜',points:-24},{from:6,to:9,label:'清晨',points:4},
  {from:9,to:11,label:'上午',points:8},{from:11,to:14,label:'午间',points:18},
  {from:14,to:17,label:'下午',points:6},{from:17,to:19,label:'傍晚',points:18},
  {from:19,to:22,label:'晚间',points:22},{from:22,to:24,label:'夜间',points:0}
];
const returned=/^(?:我(?:已经)?(?:回来了|回来啦|忙完了|醒了|睡醒了)|回来了|回来啦|忙完了|忙完啦|醒了|睡醒了|开完会了|可以找我(?:聊天)?了|可以主动(?:找我|聊天)了)/;
export function ownerChatEnding(text){
  const value=String(text).trim().replace(/^[嗯好呀，,。\s]+/,'');
  if(returned.test(value))return {reason:'back',duration:0,penalty:0};
  if(/^(?:我(?:先|要|去)?午睡|午睡一会|我眯一会)/.test(value))return {reason:'sleep',duration:120*minute,penalty:85};
  if(/^(?:(?:那我|我|先|准备)?(?:先|要|去|先去|要去)?(?:睡了|睡啦|睡觉(?:了|啦)?)(?=[，,。！!～~\s]|$)|晚安[！!。呀～~\s]*$)/.test(value))return {reason:'sleep',duration:480*minute,penalty:85};
  if(/^(?:我(?:先|要|去)?忙了|(?:我(?:先|要|去|先去)?)?开会去了|暂时不方便)/.test(value))return {reason:'busy',duration:120*minute,penalty:55};
  if(/^(?:先这样|不聊了|不想聊了|回头聊|回头再聊|下次聊|改天聊|晚点聊|再见|拜拜)[！!。呀吧～~\s]*$/.test(value))return {reason:'ending',duration:90*minute,penalty:35};
  return null;
}
function classify(text){
  if(/难过|失落|孤独|心情|委屈|想你|陪我|陪伴|聊聊天|压力|开心|烦恼/.test(text))return 'company';
  if(/(?:查一下|查询|搜一下|搜索|多少钱|几点|是什么|怎么用|翻译|天气|汇率)/.test(text))return 'lookup';
  if(/计划|准备|打算|约好|考试|面试|旅行|进度|(?:今天|今晚|明天|明早|明晚|后天|周末|下周|这周|周[一二三四五六日天]).{0,18}(?:去|要|做|看|见|出发|开会)/.test(text))return 'plan';
  if(/报错|修复|代码|bug|工作|作业|帮我|加班/i.test(text))return 'help';
  if(/喜欢|爱好|研究|游戏|电影|音乐|小说|动漫|摄影|面条|做饭|美食|宠物|猫咪|追剧|球赛|书/.test(text))return 'interest';
  if(/吃饭|早饭|午饭|晚饭|早餐|午餐|晚餐|散步|下班|上班|出门|回家|起床|今天.{0,12}(?:吃|玩|逛)/.test(text))return 'daily';
  return 'general';
}
const complete=/(?:搞定|解决|做完|完成|通关|吃过|吃完|考完|看完|结束)(?:了|啦)|不用再问|现在好多了|不难过了|心情好多了/;
const declined=/不聊这个|不想聊|没兴趣|不(?:再)?喜欢|别再问|不要再问/;
const trivial=/^(?:你好|嗨|在吗|嗯+|啊+|哦+|好[的呀吧啊]?|行|知道了|收到|谢谢|哈哈+|[ok]+)[！!，,。？?～~\s]*$/i;
const topicStop=new Set('研究 试试 准备 打算 计划 安排 以后 之后 回头 等会 继续 搞定 解决 做完 完了 完成 结束 通关 吃过 吃完 考完 不用 再问 兴趣 最近 一直 真的 感觉 事情 问题 聊聊 聊天 这个 那个 原来 这样 可以 很好 想到 还是 后来 怎么样 喜欢 时候 一点 发现 我还'.split(' '));
const termsOf=text=>memoryTerms(text).filter(t=>!topicStop.has(t));
const topicKey=terms=>crypto.createHash('sha256').update([...terms].sort().join('|')).digest('hex').slice(0,24);
const ownText=text=>!/^(?:[@＃#\[]|https?:\/\/|[“”「」『』"`]|引用|他说|她说|台词|翻译)/i.test(text);

// A reply is feedback only for the latest real proactive message, never a model judgement.
export function ownerChatReplyQuality(text){
  if(/别问|别烦|不要问|不想聊|别发|不要发|打扰/.test(text))return 0;
  return text.trim().length>=6&&!ownerChatEnding(text)&&!trivial.test(text)?1:.5;
}
function calendar(now,clock){
  const offset=clock.day?Date.parse(clock.day+'T00:00:00Z')+clock.minutes*minute-Math.floor(now/minute)*minute:0;
  return {offset,localDay:Math.floor((now+offset)/day),weekday:new Date(now+offset).getUTCDay()};
}
const chineseHour=value=>/^\d+$/.test(value)?Number(value):value==='十'?10:value.includes('十')?(value.startsWith('十')?10:({'一':1,'二':2}[value[0]]||0)*10)+({'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}[value.at(-1)]||0):({'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}[value]||0);
export function ownerChatTiming(text,recordedAt,offset=0){
  const recordedDay=Math.floor((recordedAt+offset)/day),weekday=new Date(recordedAt+offset).getUTCDay();
  const relative=text.match(/后天|明天|明早|明晚|今天|今晚|今早/),week=text.match(/(下周|这周|周|星期)([一二三四五六日天])/);
  const hour=text.match(/(\d{1,2}|[一二三四五六七八九十两]{1,3})(?:点|时)(半|[0-5]?\d分)?/);
  if(!relative&&!week&&!hour)return null;
  let targetDay=recordedDay;
  if(relative)targetDay+=relative[0]==='后天'?2:/^明/.test(relative[0])?1:0;
  else if(week){const target='日一二三四五六'.indexOf(week[2]==='天'?'日':week[2]),monday=recordedDay-((weekday+6)%7);targetDay=week[1]==='下周'?monday+7+((target+6)%7):week[1]==='这周'?monday+((target+6)%7):recordedDay+(target-weekday+7)%7;}
  let h=hour?chineseHour(hour[1]):/晚上|今晚|明晚/.test(text)?20:/下午/.test(text)?15:/早上|上午|明早|今早/.test(text)?9:12;
  if(hour&&h===12&&/晚上|今晚|明晚/.test(text)){h=0;targetDay++;}
  else if(hour&&h===12&&/凌晨/.test(text))h=0;
  else if(/下午|晚上|今晚|明晚/.test(text)&&h<12)h+=12;
  if(/中午/.test(text)&&h<11)h+=12;
  if(h>23)return null;
  const at=targetDay*day+h*60*minute+(hour?.[2]==='半'?30:parseInt(hour?.[2]||'0',10))*minute-offset;
  return {at,precise:!!hour};
}
function feedbackScore(feedback,category,now){
  const samples=feedback.filter(f=>f.category===category&&f.at<=now&&now-f.at<=14*day&&(f.repliedAt>f.at||now-f.at>=120*minute));
  const answered=samples.filter(f=>f.repliedAt>f.at),balance=samples.reduce((n,f)=>n+(f.repliedAt>f.at?2*f.quality-1:-1),0);
  return {points:Math.round(8*balance/(samples.length+3)),answered:answered.length,ignored:samples.length-answered.length};
}
function habitScore(sessions,local,minutes){
  const starts=[...sessions.values()],days=new Set(starts.map(at=>Math.floor((at+local.offset)/day)));
  const matching=starts.filter(at=>{const m=((at+local.offset)%day+day)%day/minute,d=Math.abs(m-minutes);return Math.min(d,1440-d)<=120;});
  const learned=days.size>=3&&starts.length>=4;
  return {points:learned?(matching.length>=2?Math.min(8,Math.round(16*matching.length/starts.length)):matching.length?0:-3):0,
    days:days.size,sessions:starts.length,matching:matching.length,learned};
}

// A fresh calculation from real user turns, never a counter that rises on every timer tick.
export function evaluateOwnerChat({now,clock,turns=[],initiated=[],state={},activity=0,interval=180*minute,threshold=60,weights={}}){
  const local=calendar(now,clock);
  const evidence=turns.filter(t=>typeof t.user==='string'&&!t.partial&&t.at>0&&t.at<=now&&now-t.at<=30*day).sort((a,b)=>a.at-b.at);
  const groups=[],usage=new Map(),sessions=new Map();let session=0,previous=0,latestEnding=null;
  for(const turn of evidence){
    if(!previous||turn.at-previous>=30*minute)session=turn.at;
    previous=turn.at;
    const text=turn.user.trim(),ending=ownerChatEnding(text);
    if(ending)latestEnding={...ending,at:turn.at};
    if(!ownText(text)||text.length<2||trivial.test(text)||ending)continue;
    if(!sessions.has(session))sessions.set(session,turn.at);
    let category=classify(text);const terms=termsOf(text),lastGroup=groups.reduce((last,g)=>!last||g.latest.at>last.latest.at?g:last,null);
    const match=groups.map(group=>({group,overlap:terms.filter(t=>group.terms.has(t)).length})).filter(g=>g.overlap>0).sort((a,b)=>b.overlap-a.overlap||(b.group.category===category?1:0)-(a.group.category===category?1:0)||b.group.latest.at-a.group.latest.at)[0];
    const isComplete=complete.test(text.replace(/(?:还|并|其实)?没(?:有)?(?:完全)?(?:搞定|解决|做完|完成|通关|吃完|考完|结束)(?:了)?/g,'')),isDeclined=declined.test(text);
    const shorthand=(isComplete||isDeclined||/^(?:这个|那个|它|还没|还在)/.test(text))&&lastGroup&&turn.at-lastGroup.latest.at<6*60*minute&&(terms.length===0||/(?:这个|那个|这件事|那件事|这个话题)/.test(text)||/^它/.test(text));
    let group=match?.group||(shorthand?lastGroup:null);
    if(group)category=group.category;
    else {group={category,key:topicKey(terms.length?terms:[text]),terms:new Set(terms),latest:turn,turns:[],status:'open'};groups.push(group);}
    terms.forEach(t=>group.terms.add(t));group.latest=turn;group.turns.push(turn);
    group.status=isDeclined?'declined':isComplete?'completed':'open';
    const used=usage.get(category)||{sessions:new Set(),days:new Set()};used.sessions.add(session);used.days.add(Math.floor((turn.at+local.offset)/day));usage.set(category,used);
  }
  let away=latestEnding;
  if(state.snoozeReason!=='manual'&&state.snooze>now&&(!away||state.awayAt>away.at)){
    const duration=state.snoozeSpan||(state.snoozeReason==='sleep'?480:state.snoozeReason==='busy'?120:90)*minute;
    away={reason:state.snoozeReason,at:state.awayAt||state.snooze-duration,duration,penalty:state.snoozeReason==='sleep'?85:state.snoozeReason==='busy'?55:35};
  }
  const latestUser=evidence.at(-1);
  if(away&&latestUser&&latestUser.at>away.at+2*minute&&latestUser.user.trim().length>=2&&ownText(latestUser.user.trim())&&!trivial.test(latestUser.user)&&!ownerChatEnding(latestUser.user))away=null;
  const closed=away&&away.reason!=='back'?Math.round(-away.penalty*Math.max(0,1-(now-away.at)/away.duration)):0;
  const hour=clock.minutes/60;
  const band=ownerChatTimeBands.find(b=>hour>=b.from&&hour<b.to),time=band.points;
  const weekend=[0,6].includes(local.weekday)&&hour>=9&&hour<22?3:0;
  const habit=habitScore(sessions,local,clock.minutes);
  const last=state.last||0,since=last?Math.max(0,now-last):Infinity;
  const unanswered=last&&activity<=last?Math.max(1,state.unanswered||state.recent?.filter(r=>r.at>activity).length||1):0;
  const pressure=unanswered?-Math.round(Math.min(36,12+8*(unanswered-1))*Math.exp(-since/(360*minute))):0;
  // Both terms describe the same recent contact. Show their maximum, not their sum.
  const contact=last?Math.min(0,-Math.round(18*Math.exp(-since/(60*minute)))-pressure):0;
  const gap=Math.max(0,now-Math.max(activity,last));
  const waiting=Math.min(10,Math.floor(gap/Math.max(30*minute,interval)*5));
  const candidates=groups.map(group=>{
    const age=now-group.latest.at,kind=ownerChatCategories[group.category];
    const used=usage.get(group.category),frequency=Math.min(20,Math.max(0,used.sessions.size-1)*4+Math.max(0,used.days.size-1)*2);
    const freshness=age<=6*60*minute?14:age<=day?8:age<=3*day?0:age<=7*day?-24:-48;
    const key=group.key,feedback=feedbackScore(state.feedback||[],group.category,now);
    const recentCategory=(state.recent||[]).filter(r=>r.category===group.category&&r.at<=now).at(-1);
    const previousInitiated=initiated.filter(r=>r.at<=now&&classify(r.content||'')===group.category).at(-1);
    const repeatAt=Math.max(recentCategory?.at||0,previousInitiated?.at||0);
    const repeated=(state.recent||[]).filter(r=>r.topicKey===key&&r.at<=now).at(-1);
    const repeat=!repeated&&repeatAt?-Math.round(6*Math.exp(-(now-repeatAt)/(360*minute))):0;
    const exactRepeat=repeated?-Math.round(14*Math.exp(-(now-repeated.at)/(360*minute))):0;
    const timing=group.category==='plan'&&group.status==='open'?group.turns.map(t=>ownerChatTiming(t.user,t.at,local.offset)).filter(Boolean).at(-1)||null:null;
    const pending=group.status==='open'&&age<3*day&&(timing||/(?:还没|还在|打算|想试|准备|计划|待办|回头|之后|等会)/.test(group.latest.user))?8:0;
    const timingGap=timing?now-timing.at:0,timely=timing?(timingGap>12*60*minute?-18:timingGap< -day?-8:Math.abs(timingGap)<=(timing.precise?2:6)*60*minute?12:0):0;
    const ending=group.status==='declined'?-80:group.status==='completed'?-28:0;
    const preference=Number.isFinite(Number(weights[group.category]))?Math.max(-15,Math.min(15,Number(weights[group.category]))):0;
    const basis=['company','interest','daily','plan'].includes(group.category)?10:0;
    const components=[{label:'当前时段',points:time},{label:kind.label,points:kind.points},{label:'真实续聊依据',points:basis},
      {label:'周末时段',points:weekend},{label:`常聊时段（${habit.days}天 / ${habit.matching}次附近会话）`,points:habit.points},
      {label:`使用程度：${used.sessions.size}次会话 / ${used.days.size}天`,points:frequency},
      {label:'主人设置的类型偏好',points:preference},
      {label:'话题新鲜度',points:freshness},{label:'未完话题',points:pending},{label:'安排时间相关性',points:timely},{label:'自然间隔',points:waiting},
      {label:away?.reason==='sleep'?'睡觉结束语':away?.reason==='busy'?'忙碌结束语':'聊天结束语',points:closed},
      {label:group.status==='declined'?'明确不想聊此话题':'话题已结束',points:ending},{label:`未回复压力（${unanswered}次）`,points:pressure},
      {label:'刚联系过',points:contact},{label:'近期同类话题',points:repeat},{label:'近期相同话题',points:exactRepeat},
      {label:`此类主动反馈（回应${feedback.answered} / 未回${feedback.ignored}）`,points:feedback.points}];
    const recommendation=group.status==='completed'?'旧事已结束，不追问结果；有相关新想法才分享':pending?'自然接住尚未结束的话题，不把计划当成已经发生':group.category==='company'?'轻松陪伴或分享，不诊断主人此刻的情绪':group.category==='lookup'||group.category==='help'?'只有新的有用补充才开场，不重复处理已结束的问题':'结合兴趣分享一个想法，不一定提问';
    return {category:group.category,label:kind.label,topic:group.latest.user.replace(/\s+/g,' ').slice(0,56),topicKey:key,status:group.status,
      evidenceAt:group.latest.at,evidenceAts:group.turns.slice(-2).map(t=>t.at),recommendation,
      score:components.reduce((sum,c)=>sum+c.points,0),components};
  }).sort((a,b)=>b.score-a.score||b.evidenceAt-a.evidenceAt);
  const best=candidates[0];
  return {at:now,stamp:clock.stamp,threshold,score:best?.score||0,shortfall:Math.max(0,threshold-(best?.score||0)),eligible:!!best&&best.score>=threshold,
    category:best?.category||'',label:best?.label||'没有适合续聊的话题',topic:best?.topic||'',topicKey:best?.topicKey||'',status:best?.status||'',recommendation:best?.recommendation||'',
    evidenceAt:best?.evidenceAt||0,evidenceAts:best?.evidenceAts||[],unanswered,habit,components:best?.components||[],candidates,
    policy:{timeBands:ownerChatTimeBands,categories:Object.entries(ownerChatCategories).map(([id,c])=>({id,...c,adjustment:Number(weights[id])||0}))}};
}
