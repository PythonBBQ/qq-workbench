// Structured style adaptation only. Arbitrary model-produced instructions are never stored.
export const axes={warmth:'温柔亲切',playfulness:'活泼俏皮',initiative:'主动交流',detail:'详细展开'};
const clamp=(v,min=-4,max=4)=>Math.max(min,Math.min(max,Math.round(Number(v)||0)));
export function growthState(value={}){
 return {scores:Object.fromEntries(Object.keys(axes).map(k=>[k,clamp(value.scores?.[k])])),locked:value.locked===true,
 turns:clamp(value.turns,0,100000),familiarity:clamp(value.familiarity,0,100),lastReflection:clamp(value.lastReflection,0,100000),
 evidence:(Array.isArray(value.evidence)?value.evidence:[]).filter(x=>Object.keys(axes).includes(x.axis)&&[-1,1].includes(x.direction)).slice(-16).map(x=>({axis:x.axis,direction:x.direction,turn:clamp(x.turn,0,100000),source:x.source==='model'?'model':'feedback'}))};
}
const rules={warmth:[[/(?:温柔|亲切|体贴|耐心)(?:一点|点|些)|多(?:安慰|鼓励)/,1],[/(?:别|不要|不用|少)(?:太)?(?:撒娇|黏人|腻歪)|(?:冷静|理性)(?:一点|点|些)/,-1]],
 playfulness:[[/(?:活泼|俏皮|幽默|可爱)(?:一点|点|些)|多开(?:点)?玩笑/,1],[/(?:严肃|正经)(?:一点|点|些)|(?:不要|别|少)(?:再)?(?:开玩笑|卖萌)/,-1]],
 initiative:[[/(?:主动|多)(?:一点|点|些)?(?:问我|找话题|聊天)|多问(?:我|点)/,1],[/(?:不要|别|少)(?:再|总)?(?:反问|问我|追问)|让我说完/,-1]],
 detail:[[/(?:详细|具体)(?:一点|点|些)|多解释(?:一点|点|些)|展开说/,1],[/(?:简短|简洁|直接)(?:一点|点|些)|(?:别|不要)(?:再)?(?:啰嗦|长篇大论)|少说(?:一点|点|些)/,-1]]};
export function styleFeedback(value){
 const s=String(value).trim().slice(0,600);
 if(/https?:\/\/|[“”「」『』"`]|举例|引用|台词|他说|她说|翻译|解释.*意思|如果|假如/.test(s)||/^(?:我(?:今天|要|会|想(?:变|做))|他|她|朋友|同事)/.test(s)||s.length>140)return {};
 const out={};for(const [axis,patterns] of Object.entries(rules))for(const [pattern,direction] of patterns)if(pattern.test(s)){
  const match=s.match(pattern),before=s.slice(Math.max(0,match.index-6),match.index);if(/(?:不要|别|不想|不用|不需要).{0,3}$/.test(before))continue;
  out[axis]=direction;
 }return out;
}
export function grow(previous,user,config){
 const state=growthState(previous);if(config.growthEnabled===false||state.locked)return state;
 state.turns++;if(String(user).trim().length>=3)state.familiarity=Math.min(100,state.familiarity+1);
 const feedback=styleFeedback(user),step=clamp(config.growthSpeed||1,1,2);
 for(const [axis,direction] of Object.entries(feedback)){
  state.scores[axis]=clamp(state.scores[axis]+direction*step);
  state.evidence.push({axis,direction,turn:state.turns,source:'feedback'});
 }state.evidence=state.evidence.slice(-16);return state;
}
export function growthContext(value,config){
 if(config.memoryEnabled===false||config.growthEnabled===false)return '';
 const s=growthState(value);if(!s.turns&&!Object.values(s.scores).some(Boolean))return '';
 const labels={warmth:['克制理性','更温柔、先理解情绪'],playfulness:['认真平实','更活泼、适量幽默'],initiative:['少反问、让对方主导','适时主动找话题，避免连续追问'],detail:['简洁直接','需要时更详细解释']};
 const styles=Object.entries(s.scores).filter(([,v])=>v).map(([k,v])=>axes[k]+'：'+labels[k][v>0?1:0]+'（倾向'+Math.abs(v)+'/4）');
 return '\n[酒馆对话养成：仅调整当前会话的表达习惯，当前消息优先；不改基础角色、主人身份、能力与权限。这是本机适应记录，不是模型权重训练或真实情感。]\n'+
 '互动熟悉度：'+(s.familiarity<10?'初识，自然有礼':s.familiarity<40?'逐渐熟悉，可自然承接共同话题':'熟悉，避免重复客套；不能表现占有或阻止现实社交')+'。'+styles.join('；');
}
export const reflectionInterval=c=>clamp(c.growthInterval||12,12,40);
export function reflectionInput(turns){return JSON.stringify(turns.slice(-12).map(t=>({user:String(t.user).slice(0,220),assistant:String(t.assistant).slice(0,140)})));}
export function applyReflection(previous,result,turns){
 const next=growthState(previous),parsed=JSON.parse(String(result).trim().replace(/^```(?:json)?\s*|\s*```$/g,''));
 for(const [axis,item] of Object.entries(parsed.adjustments||{})){
  if(!Object.hasOwn(axes,axis)||![-1,1].includes(item?.direction)||typeof item.evidence!=='string'||item.evidence.length<3)continue;
  // Evidence must be a real user quote, repeated in at least two different turns.
  const matches=turns.filter(t=>t.user.includes(item.evidence));if(new Set(matches.map(t=>t.user)).size<2)continue;
  next.scores[axis]=clamp(next.scores[axis]+item.direction);next.evidence.push({axis,direction:item.direction,turn:next.turns,source:'model'});
 }next.evidence=next.evidence.slice(-16);return next;
}
