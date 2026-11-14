const {EventEmitter}=require('node:events');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {readJson,atomicJson}=require('./storage.cjs');
const {normalizeMedia}=require('./overtime-media.cjs');

// 直播间机器人：欢迎进场、感谢礼物与关注、@机器人查询盲盒记录、@机器人由 DeepSeek 按人设回复。
// AI 服务商：都走 OpenAI 兼容接口（{base}/chat/completions、{base}/models），免费的排在前面。
// 免费模型名单经常变，模型列表以服务商实时返回为准；free 只是给页面标注用。
const AI_PROVIDERS={
  zhipu:{name:'智谱 BigModel',base:'https://open.bigmodel.cn/api/paas/v4',free:'GLM Flash 系列模型免费',models:['glm-4.7-flash','glm-4.5-flash','glm-4-flash-250414'],isFree:id=>/flash/i.test(id),keyUrl:'https://open.bigmodel.cn/usercenter/apikeys'},
  siliconflow:{name:'硅基流动 SiliconFlow',base:'https://api.siliconflow.cn/v1',free:'有免费模型，以控制台模型广场的 Free 标签为准',models:['THUDM/GLM-4-9B-0414'],isFree:()=>false,keyUrl:'https://cloud.siliconflow.cn/account/ak'},
  openrouter:{name:'OpenRouter',base:'https://openrouter.ai/api/v1',free:'名字带 :free 的模型免费，每天约 50 次',models:[],isFree:(id,m)=>id.endsWith(':free')||Boolean(m?.pricing)&&Number(m.pricing.prompt)===0&&Number(m.pricing.completion)===0,keyUrl:'https://openrouter.ai/keys'},
  ollama:{name:'本机 Ollama',base:'http://127.0.0.1:11434/v1',free:'模型跑在自己电脑上，完全免费，需要先安装 Ollama 并下载模型',noKey:true,editableBase:true,models:[],isFree:()=>true,keyUrl:'https://ollama.com/download',timeout:90000},
  deepseek:{name:'DeepSeek 官方',base:'https://api.deepseek.com',free:'',models:['deepseek-chat','deepseek-reasoner'],isFree:()=>false,keyUrl:'https://platform.deepseek.com/api_keys'},
  custom:{name:'自定义（OpenAI 兼容）',base:'',free:'',optionalKey:true,editableBase:true,models:[],isFree:()=>false,keyUrl:''}
};
// 服务地址只接受 http(s)，去掉末尾的 /。
function baseUrlOf(value){
  if(value===undefined||value===null||value==='')return '';
  let url;try{url=new URL(String(value).trim());}catch{throw new Error('服务地址无效，请填 http:// 或 https:// 开头的地址');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('服务地址无效，请填 http:// 或 https:// 开头的地址');
  return url.href.replace(/\/+$/,'');
}
const DEFAULT_GIFT_TIERS=[
  {min:0,max:10,lines:'谢谢{user}送的{gift}×{count}',use_ai:false},
  {min:10,max:100,lines:'感谢{user}送的{gift}×{count}，老板破费啦！\n谢谢{user}的{gift}×{count}，爱了爱了！',use_ai:false},
  {min:100,max:1000,lines:'哇！{user}送了{gift}×{count}！谢谢老板，老板大气！',use_ai:false},
  {min:1000,max:null,lines:'天哪！！感谢{user}的{gift}×{count}，给老板磕一个！',use_ai:false}
];
const DEFAULTS={
  enabled:false,
  names:'',
  max_length:20,
  interval_seconds:2,
  welcome:{enabled:false,template:'欢迎{user}来到直播间~',merge_seconds:5,user_cooldown_minutes:30,back_days:1,back_template:'好久不见呀{user}，都{ago}没来啦，想你了~'},
  gift:{enabled:false,ai_all:false,tiers:DEFAULT_GIFT_TIERS,template:'谢谢{user}送的{gift}×{count}',blind_template:'谢谢{user}的{box}×{count}，开出了{gift}，{profit}',guard_template:'感谢{user}开通{gift}，欢迎上船！',merge_seconds:3,min_value:0,big_value:30},
  follow:{enabled:false,template:'谢谢{user}的关注~'},
  blindbox:{enabled:false,keyword:'查询盲盒记录',require_mention:true,template:'{user}今天开了{today_count}个盲盒，{today_profit}；累计{count}个，投入{cost}元，开出{value}元，{profit}',empty_template:'{user}还没有盲盒记录哦'},
  cue:{enabled:false,interval_minutes:3,silent_minutes:5,active_minutes:30,user_cooldown_minutes:60,use_ai:false,templates:'来了好一会儿啦，冒个泡聊聊天呗~\n还在吗？弹幕区等你哦\n别潜水啦，来说句话嘛',random_templates:'被我随机点到啦，跟大家打个招呼吧~\n恭喜被点名！今天过得怎么样呀？\n点到你啦，给主播扣个1吧'},
  scene_command:{enabled:false,who:'admin',users:''},
  // 专属进场视频：按 UID 认人（改昵称、戴装扮都不影响），进场时在素材窗口 / OBS 素材源播一段视频。
  entrance:{enabled:false,cooldown_minutes:60,list:[]},
  ai:{enabled:false,model:'deepseek-chat',persona:'你是小萝卜直播间的小助手“萝卜酱”，性格活泼可爱，说话简短俏皮，会热情地和观众聊天。',max_chars:40,user_cooldown_seconds:10}
};
// 机器人页最上面的「功能开关」：每个功能单独开，默认全关。
const FEATURES=['welcome','entrance','gift','follow','blindbox','ai','cue','scene_command'];
// 配置里记着这个版本号；旧版（各功能默认开着）的配置第一次读取时把功能全部关掉，想用哪个再到最上面打开。
const SWITCHES_VERSION=1;
function featuresOff(saved){
  if(!saved||typeof saved!=='object'||Array.isArray(saved)||saved.switches===SWITCHES_VERSION)return saved;
  const out={...saved};
  for(const key of FEATURES)out[key]={...(out[key]&&typeof out[key]==='object'?out[key]:{}),enabled:false};
  return out;
}
const PRIORITY={manual:0,query:0,ai:0,guard:1,gift:2,follow:3,welcome:4,cue:4,scene:4};
// 直播场景：主播切到某个场景（唱歌、跳舞…），机器人按间隔发应援话术并配上这个场景的表情。
const DEFAULT_SCENES=[
  {id:'sing',name:'唱歌',lines:'好听好听！\n打call打call！\n太好听啦，再来一首~',interval_seconds:40,emoticons:[]},
  {id:'dance',name:'跳舞',lines:'跳得太好看了！\n这个舞好绝！\n冲鸭冲鸭~',interval_seconds:40,emoticons:[]},
  {id:'game',name:'打游戏',lines:'加油加油！\n冲冲冲！\n这把稳了~',interval_seconds:60,emoticons:[]}
];
const MAX_SCENES=8;
// 感谢礼物按金额分档：每档有「从多少元」和「到多少元（不含）」，最高一档可以不封顶；
// 每档有自己的话术（每行一句随机挑），也可以让 AI 现写。不在任何档位里的礼物用默认一句。
const MAX_GIFT_TIERS=8,GIFT_VARS=['user','gift','count','value'];
const tierRange=t=>t.max===null?`${t.min}元以上`:`${t.min}～${t.max}元`;
function giftTiers(list){
  if(!Array.isArray(list)||!list.length||list.length>MAX_GIFT_TIERS)throw new Error(`感谢礼物需要1～${MAX_GIFT_TIERS}档`);
  // 旧版只有「从多少元」：到下一档为止，最高一档不封顶。
  if(list.every(t=>t&&typeof t==='object'&&!Object.hasOwn(t,'max'))){
    const sorted=[...list].sort((a,b)=>(Number(a.min)||0)-(Number(b.min)||0));
    list=sorted.map(t=>({...t,max:sorted.find(x=>(Number(x.min)||0)>(Number(t.min)||0))?.min??null}));
  }
  const tiers=list.map(t=>{
    if(!t||typeof t!=='object')throw new Error('礼物档位无效');
    const min=num(t.min,0,0,100000,'档位金额');
    const label=`「${min}元起」这一档`;
    const max=t.max===null||t.max===undefined||t.max===''?null:num(t.max,0,0,100000,`${label}的上限`);
    if(max!==null&&max<=min)throw new Error(`${label}的上限要比起点大`);
    const lines=str(t.lines,'',600,`${label}的话术`),use_ai=bool(t.use_ai,false),parts=cueLines(lines),ai_style=str(t.ai_style,'',100,`${label}的 AI 要求`);
    if(parts.length>10||parts.some(line=>Array.from(line).length>60))throw new Error(`${label}的话术最多10行，每行最多60个字`);
    if(!parts.length&&!use_ai)throw new Error(`${label}还没有话术，填几句或勾上「AI 现写」`);
    const unknown=parts.join('').match(/\{(\w+)\}/g)?.find(v=>!GIFT_VARS.includes(v.slice(1,-1)));
    if(unknown)throw new Error(`${label}的话术里 ${unknown} 不认识，只能用 {user} {gift} {count} {value}`);
    return {min,max,lines,use_ai,ai_style};
  }).sort((a,b)=>a.min-b.min);
  for(let i=1;i<tiers.length;i++){
    const prev=tiers[i-1],cur=tiers[i];
    if(prev.min===cur.min)throw new Error('礼物档位的起点不能重复');
    if(prev.max===null)throw new Error(`「${prev.min}元起」这一档不封顶，会和「${cur.min}元起」那一档重叠，请给它填个上限`);
    if(prev.max>cur.min)throw new Error(`「${tierRange(prev)}」和「${tierRange(cur)}」重叠了`);
  }
  return tiers;
}
// 送礼总价值（厘）落在哪一档（含起点、不含上限）；不在任何档位里返回 -1。
function tierIndex(tiers,milli){
  return tiers.findIndex(t=>milli>=t.min*1000&&(t.max===null||milli<t.max*1000));
}
// 盲盒开出了什么：「小花花×2、棒棒糖×1」。
function boxResults(p){return [...(p.results||[])].map(([name,n])=>`${name}×${n}`).join('、');}
// B站价值换成电池（1 电池 = 0.1 元），人设里按电池写规矩时也对得上。
function battery(milli){const n=Math.round(milli/10)/10;return Number.isInteger(n)?String(n):n.toFixed(1);}
// 让 AI 谢礼物时的要求：说清楚送了什么、值多少，语气按人设来。
// 金额落在哪一档由程序判断好，这一档的「AI 要求」直接交代给 AI，不让模型自己比大小。
function giftInstruction(p,tier,examples,limit,platform){
  const st=p.box&&p.stats;
  const what=p.guard?`开通了${p.gift}${p.count>1?`×${p.count}`:''}，上船成为舰队成员`:p.box?`开了${p.box}×${p.count}，开出了${boxResults(p)}${st?`，花了${yuan(st.cost)}元，开出的礼物值${yuan(st.gain)}元，这次${st.profit}（今天累计${st.today_profit}）。感谢时要说出这次的盈亏，赚了就一起开心，亏了就安慰一下`:''}`:`送了${p.gift}×${p.count}`;
  const worth=!p.box&&p.value>0?`，价值${yuan(p.value)}元${platform==='bilibili'?`（${battery(p.value)}电池）`:''}`:'';
  const rule=p.valueUnknown?'这份礼物的价值查不到，不要猜它值多少钱，也不要说它便宜或贵，正常热情地感谢。':tier?.ai_style?`这份礼物在「${tierRange(tier)}」这一档，这一档的要求必须照做：${tier.ai_style}。语气以这条要求为准，身份和自称还是按人设。`
    :p.value>0?`人设里如果对不同金额有不同的说法，就按这次的${yuan(p.value)}元来判断；没有的话金额越高感谢越隆重热情。`:'';
  const style=examples.length?`可以参考这些话术的内容（不要照抄）：${examples.slice(0,3).join(' / ')}。`:'';
  return `观众「${String(p.user).slice(0,40)}」${what}${worth}。请完全用你人设的身份、自称和说话方式写一句感谢弹幕，要提到观众的名字和礼物，不超过${limit}个字。${rule}${style}`;
}
const SCENE_AI_CHARS=30,GIFT_AI_CHARS=40,GIFT_AI_PARALLEL=3;
// 旧版盲盒感谢的默认话术：没改过的自动换成带盈亏的新默认。
const OLD_BLIND_TEMPLATE='谢谢{user}的{box}×{count}，开出了{gift}';
const DAY=86400000,VISIT_LIMIT=30000;
// 多久没来：不到一天按小时，不到一个月按天，再久按月、按年。
function awayText(ms){
  const days=Math.floor(ms/DAY);
  if(days<1)return `${Math.max(1,Math.floor(ms/3600000))}小时`;
  if(days<30)return `${days}天`;
  if(days<365)return `${Math.floor(days/30)}个月`;
  return `${Math.floor(days/365)}年`;
}
// AI 现编应援时给模型的要求：写好的话术当风格参考，最近发过的别重复。
function sceneInstruction(scene,lines,recent,limit){
  const examples=lines.length?`可以参考这种风格（不要照抄）：${lines.slice(0,5).join(' / ')}。`:'';
  const avoid=recent.length?`不要和这些刚发过的重复：${recent.join(' / ')}。`:'';
  return `主播正在「${scene.name}」，你在直播间给主播应援打call。请写一句新的应援弹幕，不超过${limit}个字，热情、口语化，不要@任何人。${examples}${avoid}`;
}
function liveScenes(value){
  const list=value===undefined?DEFAULT_SCENES:value;
  if(!Array.isArray(list)||list.length>MAX_SCENES)throw new Error(`直播场景最多${MAX_SCENES}个`);
  const scenes=list.map((s,i)=>{
    if(!s||typeof s!=='object')throw new Error('直播场景无效');
    const id=String(s.id||'');if(!/^[a-z0-9-]{1,40}$/.test(id))throw new Error('直播场景编号无效');
    const name=str(s.name,'',12,`第${i+1}个场景的名字`,{required:true});
    const lines=str(s.lines,'',600,`「${name}」的应援话术`);
    const parts=cueLines(lines);
    if(parts.length>10||parts.some(line=>Array.from(line).length>60))throw new Error(`「${name}」的应援话术最多10行，每行最多60个字`);
    return {id,name,lines,use_ai:bool(s.use_ai,false),interval_seconds:num(s.interval_seconds,40,10,600,`「${name}」的发送间隔`),emoticons:emoticonPool(s.emoticons)};
  });
  if(new Set(scenes.map(s=>s.id)).size!==scenes.length)throw new Error('直播场景编号重复');
  return scenes;
}
// 每次发言后按情景配一个表情：每个情景是一组表情，发言时从中挑一个；情景没配就依次用后备情景，最后用「通用」。
const EMOTICON_SLOTS=['default','welcome','gift','gift_big','guard','follow','query_profit','query_loss','query_empty','ai','cue'];
const EMOTICON_FALLBACK={gift_big:['gift'],guard:['gift_big','gift']};
const KIND_SCENE={welcome:'welcome',gift:'gift',guard:'guard',follow:'follow',query:'query_profit',ai:'ai',manual:'default',cue:'cue',scene:'default'};
const MAX_POOL=12;
function emoticonPool(value){
  if(value===null||value===undefined||value==='')return [];
  const list=(Array.isArray(value)?value:[value]).map(emoticonOf).filter(Boolean);
  if(list.length>MAX_POOL)throw new Error(`每个情景最多${MAX_POOL}个表情`);
  return list.filter((e,i)=>list.findIndex(other=>other.unique===e.unique)===i);
}
const bareName=name=>String(name||'').replace(/[[\]【】\s]/g,'');
const EMOTICON_TAG=/[【[]\s*表情\s*[:：]\s*([^】\]]{1,40})[】\]]/;
function emoticonOf(value){
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='object'||Array.isArray(value)||typeof value.unique!=='string'||!/^[\w-]{1,100}$/.test(value.unique))throw new Error('表情无效');
  let url='';
  try{const parsed=new URL(String(value.url||''));if(parsed.protocol==='https:'&&(parsed.hostname==='hdslb.com'||parsed.hostname.endsWith('.hdslb.com')))url=parsed.href;}catch{}
  return {unique:value.unique,name:String(value.name||'表情').slice(0,40),url};
}
const MAX_OUTBOX=20,MAX_LOG=100,MAX_CHUNKS=4;

function str(value,fallback,max,label,{required=false}={}){
  if(value===undefined)return fallback;
  if(typeof value!=='string')throw new Error(`${label}格式无效`);
  const text=value.trim();
  if(required&&!text)throw new Error(`请填写${label}`);
  if(Array.from(text).length>max)throw new Error(`${label}最多${max}个字`);
  return text;
}
function num(value,fallback,min,max,label,integer=false){
  if(value===undefined)return fallback;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))throw new Error(`${label}需要${min}～${max}${integer?'的整数':''}`);
  return value;
}
const bool=(value,fallback)=>typeof value==='boolean'?value:fallback;
const MAX_ENTRANCE=50;
function entranceConfig(e,base){
  const list=e.list===undefined?base.list:e.list;
  if(!Array.isArray(list)||list.length>MAX_ENTRANCE)throw new Error(`专属进场视频最多设 ${MAX_ENTRANCE} 个人`);
  const seen=new Set();
  return {enabled:bool(e.enabled,base.enabled),cooldown_minutes:num(e.cooldown_minutes,base.cooldown_minutes,0,1440,'同一个人多久内不重复播'),list:list.map(item=>{
    if(!item||typeof item!=='object')throw new Error('专属进场视频设置无效');
    const text=String(item.uid??'').trim(),uid=/^\d{1,16}$/.test(text)?Number(text):0;
    if(!Number.isSafeInteger(uid)||uid<=0)throw new Error(`进场视频的 UID 要填数字（B站个人空间网址里的那串数字），「${text.slice(0,20)}」不对`);
    if(seen.has(uid))throw new Error(`UID ${uid} 重复了`);seen.add(uid);
    if(!item.media)throw new Error(`UID ${uid} 还没选视频`);
    return {uid,note:str(item.note,'',30,'备注'),media:normalizeMedia(item.media)};
  })};
}
function normalizeConfig(input={},base=DEFAULTS){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('机器人设置无效');
  const part=key=>{const value=input[key]??{};if(typeof value!=='object'||Array.isArray(value))throw new Error('机器人设置无效');return value;};
  const w=part('welcome'),g=part('gift'),f=part('follow'),b=part('blindbox'),a=part('ai'),q=part('cue'),qb=base.cue||DEFAULTS.cue,sc=part('scene_command'),scb=base.scene_command||DEFAULTS.scene_command;
  const config={
    enabled:bool(input.enabled,base.enabled),
    names:str(input.names,base.names,100,'机器人昵称'),
    max_length:num(input.max_length,base.max_length,10,100,'单条弹幕字数',true),
    interval_seconds:num(input.interval_seconds,base.interval_seconds,1,30,'发言间隔'),
    welcome:{enabled:bool(w.enabled,base.welcome.enabled),template:str(w.template,base.welcome.template,60,'欢迎语',{required:true}),merge_seconds:num(w.merge_seconds,base.welcome.merge_seconds,0,60,'欢迎合并时间'),user_cooldown_minutes:num(w.user_cooldown_minutes,base.welcome.user_cooldown_minutes,0,1440,'同一观众欢迎间隔'),back_days:num(w.back_days,base.welcome.back_days??DEFAULTS.welcome.back_days,0,365,'多久没来算好久不见'),back_template:str(w.back_template,base.welcome.back_template??DEFAULTS.welcome.back_template,60,'好久不见欢迎语',{required:true})},
    gift:{enabled:bool(g.enabled,base.gift.enabled),ai_all:bool(g.ai_all,base.gift.ai_all??false),template:str(g.template,base.gift.template,60,'谢礼物话术',{required:true}),blind_template:str(g.blind_template===OLD_BLIND_TEMPLATE?undefined:g.blind_template,base.gift.blind_template===OLD_BLIND_TEMPLATE?DEFAULTS.gift.blind_template:base.gift.blind_template,80,'盲盒感谢话术',{required:true}),guard_template:str(g.guard_template,base.gift.guard_template,60,'大航海感谢话术',{required:true}),merge_seconds:num(g.merge_seconds,base.gift.merge_seconds,0,30,'礼物合并时间'),min_value:num(g.min_value,base.gift.min_value,0,100000,'感谢的最低价值'),big_value:num(g.big_value,base.gift.big_value??DEFAULTS.gift.big_value,0,100000,'大礼物价值')},
    follow:{enabled:bool(f.enabled,base.follow.enabled),template:str(f.template,base.follow.template,60,'关注感谢话术',{required:true})},
    blindbox:{enabled:bool(b.enabled,base.blindbox.enabled),keyword:str(b.keyword,base.blindbox.keyword,20,'盲盒查询口令',{required:true}),require_mention:bool(b.require_mention,base.blindbox.require_mention),template:str(b.template,base.blindbox.template,120,'盲盒查询回复',{required:true}),empty_template:str(b.empty_template,base.blindbox.empty_template,60,'无记录回复',{required:true})},
    ai:{enabled:bool(a.enabled,base.ai.enabled),provider:a.provider??base.ai.provider??'deepseek',base_url:baseUrlOf(a.base_url??base.ai.base_url),model:str(a.model,base.ai.model,100,'模型名称',{required:true}),persona:str(a.persona,base.ai.persona,2000,'人设',{required:true}),max_chars:num(a.max_chars,base.ai.max_chars,10,200,'回复字数',true),user_cooldown_seconds:num(a.user_cooldown_seconds,base.ai.user_cooldown_seconds,0,600,'每人提问间隔')}
  };
  if(!/^[\w.:/@+-]+$/.test(config.ai.model))throw new Error('模型名称只能包含字母、数字和 . _ - : / @ +');
  if(!Object.hasOwn(AI_PROVIDERS,config.ai.provider))throw new Error('AI 服务商无效');
  if(config.ai.provider==='custom'&&!config.ai.base_url)throw new Error('自定义服务商需要填写服务地址');
  config.cue={enabled:bool(q.enabled,qb.enabled),interval_minutes:num(q.interval_minutes,qb.interval_minutes,0.5,120,'点名间隔'),silent_minutes:num(q.silent_minutes,qb.silent_minutes,1,240,'没说话多久'),active_minutes:num(q.active_minutes,qb.active_minutes,5,600,'进场多久内'),user_cooldown_minutes:num(q.user_cooldown_minutes,qb.user_cooldown_minutes,0,1440,'同一观众点名间隔'),use_ai:bool(q.use_ai,qb.use_ai),templates:str(q.templates,qb.templates,600,'点名话术',{required:true}),random_templates:str(q.random_templates,qb.random_templates??DEFAULTS.cue.random_templates,600,'随机点名话术',{required:true})};
  for(const [key,label] of [['templates','点名话术'],['random_templates','随机点名话术']]){
    const lines=cueLines(config.cue[key]);
    if(!lines.length||lines.length>10||lines.some(line=>Array.from(line).length>60))throw new Error(`${label}需要1～10行，每行最多60个字`);
  }
  if(config.cue.active_minutes<=config.cue.silent_minutes)throw new Error('“进场多久内”要大于“没说话多久”');
  const emoticons={...(input.emoticons??base.emoticons??{})};
  if(typeof emoticons!=='object'||Array.isArray(emoticons))throw new Error('表情设置无效');
  // 旧版只有一个「盲盒查询」表情：赚、亏、无记录都沿用它。
  if(emoticons.query!==undefined)for(const slot of ['query_profit','query_loss','query_empty'])emoticons[slot]??=emoticons.query;
  config.emoticons=Object.fromEntries(EMOTICON_SLOTS.map(slot=>[slot,emoticonPool(emoticons[slot])]));
  config.live_scenes=liveScenes(input.live_scenes??base.live_scenes);
  config.entrance=entranceConfig(part('entrance'),base.entrance||DEFAULTS.entrance);
  // 旧版只有一句「礼物」话术：改过的话放进最低一档。
  const oldTemplate=g.tiers===undefined&&typeof g.template==='string'&&g.template.trim()&&g.template!==DEFAULTS.gift.template?g.template:'';
  config.gift.tiers=giftTiers(g.tiers??(oldTemplate?[{...DEFAULT_GIFT_TIERS[0],lines:oldTemplate},...DEFAULT_GIFT_TIERS.slice(1)]:base.gift.tiers??DEFAULT_GIFT_TIERS));
  const who=sc.who??scb.who;if(!['admin','all'].includes(who))throw new Error('谁能开启场景的设置无效');
  config.scene_command={enabled:bool(sc.enabled,scb.enabled),who,users:str(sc.users,scb.users,500,'可以开启场景的观众')};
  config.switches=SWITCHES_VERSION;
  return config;
}
const cueLines=text=>String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
const fill=(template,vars)=>template.replace(/\{(\w+)\}/g,(all,key)=>Object.hasOwn(vars,key)?String(vars[key]):all);
const userKey=event=>{const uid=String(event.uid??'');return uid&&uid!=='0'?'uid:'+uid:'name:'+String(event.user||'').trim();};
const yuan=milli=>{const value=Math.round(milli/10)/100;return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0$/,'');};
const profit=milli=>milli>0?`赚了${yuan(milli)}元`:milli<0?`亏了${yuan(-milli)}元`:'不赚不亏';
const dayOf=time=>{const d=new Date(time);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
// 按字数切成多条弹幕，尽量在标点处断开。
function splitText(input,max){
  const chars=Array.from(String(input).replace(/\s+/g,' ').trim()),chunks=[];
  while(chars.length){
    if(chars.length<=max){chunks.push(chars.splice(0).join(''));break;}
    let cut=max;
    for(let i=max;i>max-8&&i>0;i--)if(/[，。！？、,.!?；;~ ]/.test(chars[i-1])){cut=i;break;}
    chunks.push(chars.splice(0,cut).join('').trim());
  }
  return chunks.filter(Boolean);
}
// 礼物流水的字段没有公开文档：把一条流水里所有字符串/数字字段（含嵌套和 JSON 字符串）摊平后再找盲盒信息。
function streamFields(value,depth=0,prefix='',out=[]){
  if(depth>3||!value||typeof value!=='object')return out;
  for(const [key,item] of Object.entries(value)){
    const name=prefix?`${prefix}.${key}`:key;
    if(typeof item==='string'){
      if(/^\s*[{[]/.test(item)){try{streamFields(JSON.parse(item),depth+1,name,out);continue;}catch{}}
      out.push({key:name,value:item.trim()});
    }else if(typeof item==='number')out.push({key:name,value:item});
    else if(item&&typeof item==='object')streamFields(item,depth+1,name,out);
  }
  return out;
}
// 返回 {box,gift,count}：盲盒开出的礼物；{boxOnly:true}：流水只记了盲盒本身；null：不是盲盒。
function parseStreamItem(item,catalog){
  if(!item||typeof item!=='object')return null;
  const giftName=String(item.gift_name||'').trim(),count=Number.isSafeInteger(Number(item.gift_num))&&Number(item.gift_num)>0?Number(item.gift_num):1;
  const fields=streamFields(item).filter(f=>!['gift_name','uname'].includes(f.key));
  if(catalog.boxNames.has(giftName)){
    const result=fields.find(f=>typeof f.value==='string'&&f.value!==giftName&&catalog.priceByName.has(f.value)&&!catalog.boxNames.has(f.value));
    return result?{box:giftName,gift:result.value,count}:{boxOnly:true};
  }
  let box=fields.find(f=>typeof f.value==='string'&&catalog.boxNames.has(f.value))?.value;
  if(!box){const idField=fields.find(f=>typeof f.value==='number'&&/blind|original|box/i.test(f.key)&&catalog.boxIds.has(f.value));if(idField)box=catalog.boxIds.get(idField.value);}
  return box&&giftName?{box,gift:giftName,count}:null;
}
// 流水时间是北京时间字符串（"2026-11-10 20:01:02"），也兼容秒/毫秒时间戳。
function streamTime(value){
  if(typeof value==='number'&&Number.isFinite(value))return value<1e12?value*1000:value;
  const text=String(value||'').trim();
  if(/^\d{9,13}$/.test(text))return streamTime(Number(text));
  const m=text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m?Date.UTC(+m[1],+m[2]-1,+m[3],+m[4]-8,+m[5],+(m[6]||0)):NaN;
}
function cleanReply(text,max){
  let reply=String(text||'').replace(/<think>[\s\S]*?<\/think>/g,'').replace(/[*#`>_~]+/g,'').replace(/\s+/g,' ').trim();
  reply=reply.replace(/^(萝卜酱|助手|机器人|回复)[:：]\s*/,'');
  const chars=Array.from(reply);
  if(chars.length<=max)return reply;
  // 超长时尽量在标点处截断（至少留一半），不把一句话从中间切开；句末的逗号顿号去掉。
  const cut=chars.slice(0,max);
  for(let i=cut.length;i>=Math.ceil(max/2);i--){
    if(/[。！？!?~～，,；;、 ]/.test(cut[i-1]))return cut.slice(0,i).join('').replace(/[，,；;、\s]+$/,'');
  }
  return cut.join('');
}

class LiveRobot extends EventEmitter{
  constructor(dir,{services,keyStore={get:()=>'',set:async()=>{}},fetchImpl=globalThis.fetch,now=Date.now,diagnostics,sleep=ms=>new Promise(resolve=>this.timer(resolve,ms)),random=Math.random}={}){
    super();this.sleep=sleep;this.random=random;
    this.file=path.join(dir,'robot.json');this.blindFile=path.join(dir,'robot-blindbox.json');this.visitsFile=path.join(dir,'robot-visitors.json');
    this.services=services;this.keyStore=keyStore;this.fetch=fetchImpl;this.now=now;this.diagnostics=diagnostics;
    this.outbox=[];this.log=[];this.welcomed=new Map();this.welcomeNames=[];this.welcomeBack=[];this.giftPending=new Map();this.cooldowns=new Map();this.memory=new Map();this.seen=new Map();this.recentSent=new Map();
    this.aiBusy=0;this.lastSent=0;this.saving=Promise.resolve();this.viewers=new Map();
  }
  async init(){
    const saved=await readJson(this.file,null);
    try{this.config=normalizeConfig(featuresOff(saved)||{});}catch{this.config=normalizeConfig({});}
    const visits=await readJson(this.visitsFile,null);
    this.visits=visits?.version===1&&visits.platforms&&typeof visits.platforms==='object'?visits:{version:1,platforms:{}};
    const blind=await readJson(this.blindFile,null);
    this.blind=blind?.version===1&&blind.platforms&&typeof blind.platforms==='object'?blind:{version:1,platforms:{}};
    for(const key of ['imported','imported_meta','live_since'])if(!this.blind[key]||typeof this.blind[key]!=='object')this.blind[key]={};
    // 旧存档没有“实时记账起点”：取已记录里最早的一条。
    for(const [platform,records] of Object.entries(this.blind.platforms)){
      if(this.blind.live_since[platform])continue;
      const times=Object.values(records).flatMap(r=>(r.recent||[]).map(x=>x.time)).filter(Number.isFinite);
      if(times.length)this.blind.live_since[platform]=Math.min(...times);
    }
    this.importState=null;
    // 每 20 秒看一次要不要点名；真正的间隔由「点名间隔」决定。
    this.cueTimer=setInterval(async()=>{
      try{await this.cueTick();}catch(error){this.diagnostics?.log('warn','robot.cue_failed',{error});}
      // 随着时间推移会有新的人“没说话满 N 分钟”，名单变了就刷新页面。
      const count=`${this.cueCandidates().length}:${this.presentViewers().length}`;
      if(count!==this.cueWaiting){this.cueWaiting=count;this.publish();}
    },20000);this.cueTimer.unref?.();
    return this;
  }
  get platform(){return this.services?.platform||'bilibili';}
  names(){
    const account=this.services?.state?.account;
    return [...new Set([account?.loggedIn?account.name:'',...this.config.names.split(/[\s,，、]+/)].map(n=>String(n||'').trim()).filter(Boolean))];
  }
  snapshot(){
    const key=this.apiKey(),hint=value=>value?'••••'+value.slice(-4):'';
    // 各服务商只给页面看是否保存过 Key 和末四位，不回传 Key 本身。
    const providers=Object.entries(AI_PROVIDERS).map(([id,p])=>({id,name:p.name,free:p.free,noKey:!!p.noKey,optionalKey:!!p.optionalKey,editableBase:!!p.editableBase,base:p.base,keyUrl:p.keyUrl,models:p.models,free_models:p.models.filter(id=>p.isFree(id)),keyHint:p.noKey?'':hint(this.apiKey(id))}));
    return {config:structuredClone(this.config),hasKey:!!key,keyHint:hint(key),aiReady:this.aiReady(),providers,platform:this.platform,canSend:this.platform==='bilibili',names:this.names(),outbox:this.outbox.length,log:this.log.slice(0,60),blindbox:this.blindList(),import:this.importState,imported:this.blind.imported_meta[this.platform]||null,live_since:this.blind.live_since[this.platform]||null,cue:this.cueSummary(),active_scene:this.activeScene?{id:this.activeScene.id,started_at:this.activeScene.started_at,sent:this.activeScene.sent}:null,likes_today:this.likesToday(),recent_members:this.recentMembers||[],can_entrance:this.listenerCount('entrance')>0,live:{status:this.services?.state?.live?.status||'disconnected',title:this.services?.state?.live?.title||'',room_id:this.services?.state?.live?.roomId||null}};
  }
  cueSummary(){
    const waiting=this.cueCandidates();
    return {waiting:waiting.slice(0,20).map(v=>({name:v.name,entered_at:v.entered_at})),waiting_count:waiting.length,present_count:this.presentViewers().length,tracked:this.viewers.size,last_at:this.lastCueAt||null};
  }
  // 一位观众的盲盒账 = 实时记录 + 补录的历史（补录只取实时记账开始之前的流水，两者不重叠）。
  blindRecord(key,platform=this.platform){
    const live=this.blind.platforms[platform]?.[key],old=this.blind.imported[platform]?.[key];
    if(!live&&!old)return null;
    if(!old)return live;if(!live)return old;
    const days={...old.days};
    for(const [day,d] of Object.entries(live.days||{})){const o=days[day]||{count:0,cost:0,value:0};days[day]={count:o.count+d.count,cost:o.cost+d.cost,value:o.value+d.value};}
    return {name:live.name||old.name,count:live.count+old.count,cost:live.cost+old.cost,value:live.value+old.value,days,updated_at:Math.max(live.updated_at||0,old.updated_at||0),recent:[...(live.recent||[]),...(old.recent||[])].sort((a,b)=>b.time-a.time).slice(0,20)};
  }
  blindList(){
    if(this.blindCache?.platform===this.platform&&this.blindCache.version===this.blindVersion)return this.blindCache.list;
    const today=dayOf(this.now()),keys=new Set([...Object.keys(this.blind.platforms[this.platform]||{}),...Object.keys(this.blind.imported[this.platform]||{})]);
    const list=[...keys].map(id=>{const r=this.blindRecord(id);return {id,name:r.name,count:r.count,cost:r.cost,value:r.value,today:r.days?.[today]||null,updated_at:r.updated_at,recent:(r.recent||[]).slice(0,5)};}).sort((a,b)=>b.updated_at-a.updated_at).slice(0,200);
    this.blindCache={platform:this.platform,version:this.blindVersion,list};
    return list;
  }
  publish(){this.emit('state',this.snapshot());}
  // —— 给直播间点赞（用登录的B站账号）——
  likesToday(){return this.likes?.day===dayOf(this.now())?this.likes.count:0;}
  async like(count){
    const clicks=num(count,10,1,1000,'点赞次数');
    if(!Number.isInteger(clicks))throw new Error('点赞次数要是整数');
    if(this.liking)throw new Error('上一次点赞还没完成');
    this.liking=true;
    try{
      await this.services.likeRoom(clicks);
      const day=dayOf(this.now());
      this.likes=this.likes?.day===day?{day,count:this.likes.count+clicks}:{day,count:clicks};
      this.addLog({kind:'like',text:`给直播间点赞 ×${clicks}`,status:'sent'});
      return {liked:clicks,likes_today:this.likes.count};
    }catch(error){
      this.addLog({kind:'like',text:`给直播间点赞 ×${clicks}`,status:'failed',error:error.message});
      throw error;
    }finally{this.liking=false;this.publish();}
  }
  addLog(entry){
    const item={id:randomUUID(),time:this.now(),status:'queued',...entry};
    this.log.unshift(item);this.log.length=Math.min(this.log.length,MAX_LOG);
    return item;
  }
  // —— 收到直播事件 ——
  receive(event){
    if(!event||typeof event!=='object')return;
    try{
      if(event.type==='gift')this.handleGift(event);
      if(this.isSelf(event))return;
      this.trackViewer(event);
      const last=this.visit(event);
      if(event.type==='member')this.handleEntrance(event);
      if(!this.config.enabled)return;
      if(event.type==='chat')this.handleChat(event);
      else if(event.type==='member')this.handleMember(event,last);
      else if(event.type==='social'&&(event.follow||event.text==='关注了主播'))this.handleFollow(event);
    }catch(error){this.diagnostics?.log('warn','robot.receive_failed',{error});}
  }
  // —— 点名：记下谁进了直播间、谁说过话或送过礼，找出进场后一直没说话的人 ——
  trackViewer(event){
    if(!['member','chat','gift','like','social'].includes(event.type)||!event.user)return;
    const key=userKey(event);if(key==='name:')return;
    const now=this.now(),active=this.config.cue.active_minutes*60000;
    let v=this.viewers.get(key);
    if(!v){v={name:'',uid:0,entered_at:0,spoke_at:0,cued_at:0,last_seen:0};}
    this.viewers.delete(key);this.viewers.set(key,v);
    if(this.viewers.size>5000)this.viewers.delete(this.viewers.keys().next().value);
    v.name=String(event.user).slice(0,100);v.uid=Number(event.uid)||0;
    // 隔了很久再进来算重新进场。
    if(event.type==='member'&&(!v.entered_at||now-v.last_seen>active))v.entered_at=now;
    // 发言或送礼才算“说过话”；点赞、关注只说明人还在。
    if(event.type==='chat'||event.type==='gift')v.spoke_at=now;
    v.last_seen=now;
  }
  cueCandidates(){
    const c=this.config.cue,now=this.now(),list=[];
    for(const [key,v] of this.viewers){
      if(!v.entered_at||v.spoke_at>=v.entered_at)continue;
      if(now-v.entered_at<c.silent_minutes*60000||now-v.last_seen>c.active_minutes*60000)continue;
      if(v.cued_at&&now-v.cued_at<c.user_cooldown_minutes*60000)continue;
      list.push({key,...v});
    }
    // 最近还出现过（进场或重新进场）的更可能还在直播间。
    return list.sort((a,b)=>b.last_seen-a.last_seen||b.entered_at-a.entered_at);
  }
  async cueTick(force=false){
    const c=this.config.cue,now=this.now();
    if(!this.config.enabled||!c.enabled||this.cueBusy)return null;
    if(!force&&now-(this.lastCueAt||0)<c.interval_minutes*60000)return null;
    if(this.services?.state?.live?.status!=='connected')return null;
    // 排队的消息多时先不点名，免得刷屏。
    if(this.outbox.length>=3)return null;
    const target=this.cueCandidates()[0];
    if(!target)return null;
    this.lastCueAt=now;this.viewers.get(target.key).cued_at=now;this.cueBusy=true;
    try{
      const text=await this.cueText(target,false);
      if(!this.config.enabled||!c.enabled)return null;
      this.enqueue('cue',text,{to:{user:target.name,uid:target.uid}});
      return target.name;
    }finally{this.cueBusy=false;}
  }
  // 点名说的话：开了 AI 就按人设搭话，否则（或 AI 出错）从话术里随机挑一句。
  async cueText(target,random){
    const c=this.config.cue,name=target.name.slice(0,40);
    if(c.use_ai&&this.config.ai.enabled&&this.aiReady()){
      const instruction=random?`你在直播间随机点名，点到了观众「${name}」。请你热情地跟他互动一下，可以问个轻松的问题，或者邀请他跟主播打个招呼。`:`观众「${name}」进直播间好一会儿了，一直没说话。请你主动跟他搭话，找个轻松的话题邀请他发弹幕聊天。`;
      try{return (await this.ask(target.name,'',target.key,{instruction})).reply;}
      catch(error){this.diagnostics?.log('warn','robot.cue_ai_failed',{error});}
    }
    const lines=cueLines(random?c.random_templates:c.templates);
    return fill(lines[Math.min(lines.length-1,Math.floor(this.random()*lines.length))],{user:target.name});
  }
  // —— 直播场景 ——
  startScene(id,announce){
    const scene=this.config.live_scenes.find(s=>s.id===id);
    if(!scene)throw new Error('找不到这个直播场景，请先保存场景');
    if(scene.use_ai&&!this.aiReady())throw new Error(`「${scene.name}」开了 AI 现编，请先在「AI 聊天」里填好 ${this.provider().name} 的 API Key`);
    if(!scene.use_ai&&!cueLines(scene.lines).length&&!scene.emoticons.length&&!this.config.emoticons.default.length)throw new Error(`「${scene.name}」还没有应援话术，也没有配表情`);
    if(this.services?.state?.live?.status!=='connected')throw new Error('直播间未连接');
    this.stopScene(false);
    this.activeScene={id,started_at:this.now(),sent:0,lastLine:'',lastEmoticon:'',recent:[]};
    announce?.();
    this.sceneTick();
  }
  stopScene(publish=true){
    clearTimeout(this.sceneTimer);this.sceneTimer=null;
    if(!this.activeScene)return;
    this.activeScene=null;if(publish)this.publish();
  }
  // 发一条应援：开了 AI 现编就让模型按场景现写一句（并从场景表情里按语气挑一个），
  // 否则（或 AI 出错）随机一句写好的话术（不连着重复）+ 这个场景的表情；场景没配表情就用「通用」。
  async sceneTick(){
    this.sceneTimer=null;
    const active=this.activeScene,scene=active&&this.config.live_scenes.find(s=>s.id===active.id);
    if(!scene){this.stopScene();return;}
    if(this.services?.state?.live?.status==='connected'&&this.outbox.length<3){
      const lines=cueLines(scene.lines),choose=(list,last)=>{const pool=list.length>1?list.filter(x=>x!==last):list;return pool[Math.min(pool.length-1,Math.floor(this.random()*pool.length))];};
      const pickEmo=()=>scene.emoticons.length?scene.emoticons.find(e=>e.unique===choose(scene.emoticons.map(x=>x.unique),active.lastEmoticon)):this.pickEmoticon('default');
      let line='',emo;
      if(scene.use_ai&&this.aiReady()){
        try{
          const limit=this.aiLimit(SCENE_AI_CHARS),result=await this.ask('','','',{instruction:sceneInstruction(scene,lines,active.recent,limit),emoticons:scene.emoticons.length?scene.emoticons:undefined,maxChars:limit});
          line=result.reply;emo=result.emoticon;
        }catch(error){this.diagnostics?.log('warn','robot.scene_ai_failed',{error});}
        // 等 AI 期间场景被停掉或换了，就不发了。
        if(this.activeScene!==active)return;
      }
      if(!line&&lines.length)line=choose(lines,active.lastLine);
      if(emo===undefined||emo&&scene.emoticons.length&&!scene.emoticons.some(e=>e.unique===emo.unique))emo=pickEmo();
      if(line||emo){
        active.lastLine=line;active.lastEmoticon=emo?.unique||'';active.sent++;
        if(line)active.recent=[...active.recent,line].slice(-6);
        this.enqueue('scene',line,{emoticon:emo||null});
      }
    }
    if(this.activeScene===active)this.sceneTimer=this.timer(()=>this.sceneTick(),scene.interval_seconds*1000);
  }
  // 让 AI 按场景写几句应援话术，给主播挑着填进「应援话术」。
  async sceneLines(name,count=5){
    const sceneName=str(name,'',12,'场景名字',{required:true});
    return this.aiLines(`主播正在「${sceneName}」。请写${count}句不同的应援弹幕，每句不超过${Math.min(SCENE_AI_CHARS,this.config.max_length)}个字，口语化、热情，不要编号、不要引号、不要表情符号，每句单独一行，只输出这${count}行。`,Math.min(SCENE_AI_CHARS,this.config.max_length),count);
  }
  // 按人设让 AI 一次写几句话术（每行一句），去掉编号、引号和重复。
  async aiLines(prompt,maxChars,count){
    const data=await this.aiRequest('/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:this.config.ai.model,messages:[
      {role:'system',content:`${this.config.ai.persona}\n\n你在${this.platform==='douyin'?'抖音':'B站'}直播间里帮主播写弹幕话术。`},
      {role:'user',content:prompt}
    ],max_tokens:/reason|r1|think|z1/i.test(this.config.ai.model)?2000:500,temperature:1,stream:false})});
    const raw=String(data?.choices?.[0]?.message?.content||'').replace(/<think>[\s\S]*?<\/think>/g,'');
    const lines=[...new Set(raw.split(/\r?\n/).map(line=>cleanReply(line.replace(/^\s*(\d+[.、)）]|[-*•])\s*/,'').replace(/^["“「]|["”」]$/g,''),maxChars)).filter(Boolean))].slice(0,count);
    if(!lines.length)throw new Error(`${this.provider().name} 没有返回内容`);
    return lines;
  }
  // 最近「进场多久内」出现过（进场、发言、送礼）的观众，视为还在直播间。
  presentViewers(){
    const now=this.now(),limit=this.config.cue.active_minutes*60000,list=[];
    for(const [key,v] of this.viewers)if(now-v.last_seen<=limit)list.push({key,...v});
    return list;
  }
  // 随机点名：房间里任意一位观众（说没说过话都可以），尽量不连着点同一个人。
  async cueRandom(){
    if(this.services?.state?.live?.status!=='connected')throw new Error('直播间未连接');
    if(this.cueBusy)throw new Error('正在点名，请稍等');
    const present=this.presentViewers();
    if(!present.length)throw new Error(`最近 ${this.config.cue.active_minutes} 分钟内还没有观众进场或发言`);
    const choices=present.length>1?present.filter(v=>v.key!==this.lastRandomKey):present;
    const target=choices[Math.min(choices.length-1,Math.floor(this.random()*choices.length))];
    this.lastRandomKey=target.key;this.lastCueAt=this.now();this.viewers.get(target.key).cued_at=this.now();this.cueBusy=true;
    try{this.enqueue('cue',await this.cueText(target,true),{to:{user:target.name,uid:target.uid}});}
    finally{this.cueBusy=false;}
    return target.name;
  }
  isSelf(event){
    const self=this.platform==='bilibili'?this.services?.selfUid:0;
    if(self&&Number(event.uid)===self)return true;
    const sent=this.recentSent.get(String(event.text||'').trim());
    return event.type==='chat'&&!!sent&&this.now()-sent<60000;
  }
  mentioned(event){
    const text=String(event.text||'');
    return this.names().some(name=>event.mention?.name===name||text.includes('@'+name)||text.includes('＠'+name));
  }
  cooling(key,seconds){
    const now=this.now(),last=this.cooldowns.get(key);
    if(last!==undefined&&now-last<seconds*1000)return true;
    this.cooldowns.set(key,now);
    if(this.cooldowns.size>5000)this.cooldowns.delete(this.cooldowns.keys().next().value);
    return false;
  }
  handleChat(event){
    const c=this.config,text=String(event.text||'').trim();
    if(event.superChat&&c.gift.enabled){const value=Math.max(0,Number(event.price)||0)*1000;this.giftThanks({user:event.user||'观众',gift:'醒目留言',count:1,value},this.giftScene(value));}
    const mentioned=this.mentioned(event),b=c.blindbox;
    if(b.enabled&&text.includes(b.keyword)&&(mentioned||!b.require_mention)){
      if(!this.cooling('query:'+userKey(event),5)){const answer=this.blindAnswer(event);this.enqueue('query',answer.text,{to:event,scene:answer.scene});}
      return;
    }
    if(mentioned&&this.sceneCommand(event,text))return;
    if(mentioned&&c.ai.enabled)this.replyAi(event);
  }
  // @机器人「开启唱歌模式」「唱歌打call」「关闭打call」：开关直播场景。识别成指令就返回 true，不再交给 AI。
  sceneCommand(event,text){
    const sc=this.config.scene_command;
    if(!sc.enabled)return false;
    const body=this.names().reduce((t,name)=>t.split('@'+name).join(' ').split('＠'+name).join(' '),text);
    const stop=/(关闭|关掉|停止|停下|结束|别再?|不要再?|退出)/.test(body)&&/(模式|打\s*call|应援|场景)/i.test(body);
    const scene=[...this.config.live_scenes].sort((a,b)=>b.name.length-a.name.length).find(s=>body.includes(s.name));
    const start=!stop&&scene&&/(开启|开始|打开|切换|切到|进入|模式|打\s*call|应援)/i.test(body);
    if(!stop&&!start)return false;
    if(this.cooling('scene_cmd:'+userKey(event),5))return true;
    if(!this.canCommandScene(event)){
      if(!this.cooling('scene_cmd_denied:'+userKey(event),60))this.enqueue('manual',sc.who==='admin'?'只有主播和房管可以切换场景哦~':'你还不能切换场景哦~',{to:event});
      return true;
    }
    const active=this.activeScene&&this.config.live_scenes.find(s=>s.id===this.activeScene.id);
    if(stop){
      if(!active){this.enqueue('manual','现在没有在打call哦~',{to:event});return true;}
      this.stopScene();
      this.enqueue('manual',`好的，${active.name}模式结束啦~`,{to:event});
      return true;
    }
    if(active?.id===scene.id){this.enqueue('manual',`已经在${scene.name}模式啦，一起打call~`,{to:event});return true;}
    try{
      this.startScene(scene.id,()=>this.enqueue('manual',`收到！${scene.name}模式开启，一起打call~`,{to:event}));
      this.publish();
    }catch(error){this.enqueue('manual',`开启失败：${String(error.message||error).slice(0,40)}`,{to:event});}
    return true;
  }
  // 谁能用 @机器人 切换场景：主播、房管，或名单里的观众；设成「所有观众」就都可以。
  canCommandScene(event){
    const sc=this.config.scene_command;
    if(sc.who==='all')return true;
    const anchor=Number(this.services?.state?.live?.anchorUid)||0;
    if(event.admin||anchor&&Number(event.uid)===anchor)return true;
    const users=String(sc.users||'').split(/[\s,，、]+/).filter(Boolean);
    return users.includes(String(event.user||''))||!!event.uid&&users.includes(String(event.uid));
  }
  // —— 记住每位观众最后一次出现的时间（存盘，重启后也记得），欢迎时用来判断是不是好久没来 ——
  visit(event){
    if(!['member','chat','gift','like','social'].includes(event.type)||!event.user)return 0;
    const key=userKey(event);if(key==='name:')return 0;
    const list=this.visits.platforms[this.platform]??={},prev=list[key];
    list[key]=[String(event.user).slice(0,100),this.now()];
    this.saveVisits();
    return Array.isArray(prev)?Number(prev[1])||0:0;
  }
  saveVisits(){
    if(this.visitsTimer)return;
    this.visitsTimer=setTimeout(()=>{this.visitsTimer=null;this.writeVisits();},10000);this.visitsTimer.unref?.();
  }
  writeVisits(){
    // 人太多时只留最近来过的。
    for(const [platform,list] of Object.entries(this.visits.platforms)){
      const keys=Object.keys(list);
      if(keys.length<=VISIT_LIMIT)continue;
      this.visits.platforms[platform]=Object.fromEntries(keys.map(k=>[k,list[k]]).sort((a,b)=>b[1][1]-a[1][1]).slice(0,Math.floor(VISIT_LIMIT*0.8)));
    }
    this.saving=this.saving.then(()=>atomicJson(this.visitsFile,this.visits,{compact:true})).catch(error=>this.diagnostics?.log('warn','robot.visitors_save_failed',{error}));
  }
  // —— 专属进场视频：名单里的 UID 进场就播（机器人关着也播），同一个人冷却时间内不重复 ——
  handleEntrance(event){
    const uid=Number(event.uid)||0;
    if(uid){
      this.recentMembers=(this.recentMembers||[]).filter(m=>m.uid!==uid);
      this.recentMembers.unshift({uid,name:String(event.user||'').slice(0,40),time:this.now()});
      this.recentMembers.length=Math.min(this.recentMembers.length,30);
    }
    const e=this.config.entrance;
    // 没人接收（机器人的其他直播间）就不播。
    if(!e.enabled||!uid||!this.listenerCount('entrance'))return;
    const item=e.list.find(x=>x.uid===uid);if(!item)return;
    this.entranceAt??=new Map();
    const last=this.entranceAt.get(uid),now=this.now();
    if(last!==undefined&&now-last<e.cooldown_minutes*60000)return;
    this.entranceAt.set(uid,now);
    this.playEntrance(item,event.user);
  }
  playEntrance(item,user){
    const who=item.note||user||`UID ${item.uid}`;
    const entry=this.addLog({kind:'entrance',text:`${who} 进场，播放「${item.media.name}」`,status:'sent'});
    this.emit('entrance',{uid:item.uid,user:user||'',media:item.media,fail:error=>{entry.status='failed';entry.error=error.message;this.publish();}});
    this.publish();
  }
  handleMember(event,lastVisit=0){
    const w=this.config.welcome;
    if(!w.enabled||!event.user)return;
    const key=userKey(event),now=this.now(),last=this.welcomed.get(key);
    if(last!==undefined&&now-last<w.user_cooldown_minutes*60000)return;
    this.welcomed.delete(key);this.welcomed.set(key,now);
    if(this.welcomed.size>20000)this.welcomed.delete(this.welcomed.keys().next().value);
    const away=lastVisit?now-lastVisit:0;
    if(w.back_days>0&&away>=w.back_days*DAY){if(!this.welcomeBack.some(b=>b.user===event.user))this.welcomeBack.push({user:event.user,away});}
    else if(!this.welcomeNames.includes(event.user))this.welcomeNames.push(event.user);
    if(!this.welcomeTimer)this.welcomeTimer=this.timer(()=>this.flushWelcome(),w.merge_seconds*1000);
  }
  flushWelcome(){
    this.welcomeTimer=null;
    const names=this.welcomeNames.splice(0),back=this.welcomeBack.splice(0),w=this.config.welcome;
    if(!names.length&&!back.length||!this.config.enabled||!w.enabled)return;
    // 消息排队太多时先保证感谢和回复，跳过这一批欢迎。
    if(this.outbox.length>=8){this.addLog({kind:'welcome',text:`欢迎 ${names.length+back.length} 位观众`,status:'skipped',error:'待发消息较多，已跳过'});this.publish();return;}
    // 好久没来的单独打招呼（一批最多 3 位），再多的并进普通欢迎。
    for(const b of back.slice(0,3))this.enqueue('welcome',fill(w.back_template,{user:b.user,days:Math.max(1,Math.floor(b.away/DAY)),ago:awayText(b.away)}));
    names.unshift(...back.slice(3).map(b=>b.user));
    if(!names.length)return;
    const user=names.length===1?names[0]:`${names.slice(0,2).join('、')}${names.length>2?`等${names.length}位`:''}`;
    this.enqueue('welcome',fill(w.template,{user}));
  }
  handleFollow(event){
    const f=this.config.follow;
    if(!f.enabled||!event.user||this.cooling('follow:'+userKey(event),3600))return;
    this.enqueue('follow',fill(f.template,{user:event.user}));
  }
  // 知不知道这份礼物的价格：消息里带了单价、是免费的银瓜子礼物，或者礼物库里查得到。
  priceKnown(event){
    if(event.giftFree||event.giftPrice>0)return true;
    const ids=[event.giftId,...(event.giftAliases||[])].filter(Boolean);
    return Boolean(this.services?.gifts?.some(g=>ids.includes(g.id)&&g.price>0));
  }
  giftPrice(event){
    if(event.giftFree)return 0;
    if(event.giftPrice)return event.giftPrice;
    const ids=[event.giftId,...(event.giftAliases||[])].filter(Boolean);
    return this.services?.gifts?.find(g=>ids.includes(g.id))?.price||0;
  }
  // 礼物价格换算成“厘”（千分之一元）：B站金瓜子 1000=1元，抖币 1=0.1元。
  milli(price){return this.platform==='douyin'?price*100:price;}
  duplicate(event){
    if(!event.transactionId)return false;
    const key=`${event.uid}:${event.giftId}:${event.transactionId}`,now=this.now();
    for(const [id,at] of this.seen){if(now-at<=300000)break;this.seen.delete(id);}
    if(this.seen.has(key))return true;
    this.seen.set(key,now);return false;
  }
  handleGift(event){
    if(this.duplicate(event))return;
    const count=Number.isSafeInteger(event.count)&&event.count>0?event.count:1;
    if(event.blindGiftName)this.recordBlind(event,count);
    const g=this.config.gift;
    if(!this.config.enabled||!g.enabled||this.isSelf(event))return;
    const guard=!!event.guardName,box=event.blindGiftName||'';
    const key=`${userKey(event)}:${guard?'guard:'+event.guardName:box?'box:'+box:'gift:'+event.giftName}`;
    let pending=this.giftPending.get(key);
    if(!pending){pending={user:event.user||'观众',key:userKey(event),gift:guard?event.guardName:event.giftName||'礼物',box,guard,count:0,value:0,gain:0,results:new Map(),started:this.now()};this.giftPending.set(key,pending);}
    pending.count+=count;
    if(box){pending.results.set(event.giftName,(pending.results.get(event.giftName)||0)+count);pending.value+=this.milli(this.boxPrice(event))*count;pending.gain+=this.milli(this.giftPrice(event))*count;}
    else if(this.priceKnown(event))pending.value+=this.milli(this.giftPrice(event))*count;
    // 价格不知道的先记下来，发感谢前再去查。
    else{const id=Number(event.giftId)||0;(pending.unknown??=new Map()).set(id,(pending.unknown.get(id)||0)+count);}
    clearTimeout(pending.timer);
    // 连击期间不断顺延，最多等 15 秒合并成一句。
    const wait=Math.max(0,Math.min(g.merge_seconds*1000,pending.started+15000-this.now()));
    pending.timer=this.timer(()=>this.flushGift(key),wait);
  }
  flushGift(key){
    const p=this.giftPending.get(key);this.giftPending.delete(key);
    if(!p)return;
    if(p.unknown?.size)return this.findUnknownPrices(p).then(()=>this.finishGift(p));
    return this.finishGift(p);
  }
  // 礼物库里没有的礼物：问一下 B站这个直播间的礼物面板（最多等 5 秒）。还是查不到就当「价值不清楚」，不归进任何档。
  async findUnknownPrices(p){
    for(const [id,count] of p.unknown){
      let price=null;
      if(id&&typeof this.services?.giftPriceOf==='function'){
        try{price=await Promise.race([this.services.giftPriceOf(id),new Promise(resolve=>this.timer(()=>resolve(null),5000))]);}
        catch(error){this.diagnostics?.log('warn','robot.gift_price_failed',{error});}
      }
      if(Number.isFinite(price)&&price>=0){p.value+=this.milli(price)*count;p.unknown.delete(id);}
    }
    p.valueUnknown=p.unknown.size>0;
  }
  finishGift(p){
    const g=this.config.gift;
    if(!this.config.enabled||!g.enabled)return;
    if(!p.guard&&!p.valueUnknown&&p.value<g.min_value*1000)return;
    if(p.box)p.stats=this.boxStats(p);
    this.giftThanks(p,p.guard?KIND_SCENE.guard:this.giftScene(p.value));
  }
  // 发礼物感谢：AI 现写，或从写好的话术里挑（大航海、盲盒用各自的话术）。
  giftThanks(p,scene){
    const kind=p.guard?'guard':'gift';
    const send=({text,emoticon})=>{if(text&&this.config.enabled&&this.config.gift.enabled)this.enqueue(kind,text,{scene,...(emoticon!==undefined?{emoticon}:{})});};
    // 不用 AI 的当场发，保持和其他消息的先后顺序。
    if(!this.giftUsesAi(p))return send(this.giftLine(p));
    return this.giftText(p,scene).then(send);
  }
  // 打开「每个礼物都用 AI 谢」时，礼物、盲盒、大航海、醒目留言全都交给 AI，忙的时候排队等，不换成话术。
  // 没打开时只有勾了「AI 现写」的档用 AI，同时最多 3 个，送礼高峰时其余的直接用写好的话术。
  giftUsesAi(p){
    if(!this.aiReady())return false;
    const g=this.config.gift;
    if(g.ai_all)return true;
    if(p.guard||p.box)return false;
    const index=p.valueUnknown?-1:tierIndex(g.tiers,p.value);
    return index>=0&&g.tiers[index].use_ai&&(this.giftAiBusy||0)<GIFT_AI_PARALLEL;
  }
  // 占一个 AI 名额：有空位马上占上，没有就排队，等前面的写完把名额交过来。
  giftAiTurn(){
    if((this.giftAiBusy||0)<GIFT_AI_PARALLEL){this.giftAiBusy=(this.giftAiBusy||0)+1;return;}
    return new Promise(resolve=>(this.giftAiWait??=[]).push(resolve));
  }
  giftAiDone(){const next=this.giftAiWait?.shift();if(next)next();else this.giftAiBusy--;}
  async giftText(p,scene,{test=false}={}){
    if(!this.giftUsesAi(p))return this.giftLine(p);
    const tiers=this.config.gift.tiers,index=p.guard||p.box||p.valueUnknown?-1:tierIndex(tiers,p.value),tier=tiers[index];
    const vars={user:p.user,gift:p.gift,count:p.count,value:yuan(p.value)};
    // 只有勾了「AI 现写」的档，写好的话术才给 AI 当参考；其余的话术只在 AI 出错时用。
    const examples=tier?.use_ai?cueLines(tier.lines).map(line=>fill(line,vars)):[],limit=this.aiLimit(GIFT_AI_CHARS);
    await this.giftAiTurn();
    try{
      const pool=this.platform==='bilibili'?this.emoticonPoolFor(scene):[];
      const {reply,emoticon}=await this.ask('','','',{instruction:giftInstruction(p,tier,examples,limit,this.platform),emoticons:pool.length?pool:undefined,maxChars:limit,task:'gift'});
      return {text:reply,emoticon:pool.length?emoticon:undefined,tier:index,ai:true};
    }catch(error){
      this.diagnostics?.log('warn','robot.gift_ai_failed',{error});
      if(!test){this.addLog({kind:p.guard?'guard':'gift',text:`${p.user} 的${p.box||p.gift}×${p.count}`,status:'failed',error:`AI 没写出来（${error.message}），改用写好的话术`});this.publish();}
    }
    finally{this.giftAiDone();}
    return this.giftLine(p);
  }
  // 从这一档写好的话术里挑一句（不连着重复）；大航海、盲盒用各自的话术。
  giftLine(p){
    const g=this.config.gift;
    if(p.guard)return {text:fill(g.guard_template,{user:p.user,gift:p.gift,count:p.count}),tier:-1,ai:false};
    if(p.box){const st=p.stats||this.boxStats(p);return {text:fill(g.blind_template,{user:p.user,box:p.box,count:p.count,gift:boxResults(p),cost:yuan(st.cost),value:yuan(st.gain),profit:st.profit,today_profit:st.today_profit,total_profit:st.total_profit}),tier:-1,ai:false};}
    const tiers=g.tiers,index=p.valueUnknown?-1:tierIndex(tiers,p.value);
    const vars={user:p.user,gift:p.gift,count:p.count,value:yuan(p.value)};
    // 不在任何档位里：用默认一句。这一档没写话术（只开了 AI）又用不了 AI：往下找有话术的档，再不行用默认一句。
    let pool=index>=0?cueLines(tiers[index].lines):[];
    for(let i=index-1;!pool.length&&i>=0;i--)pool=cueLines(tiers[i].lines);
    if(!pool.length)pool=[DEFAULTS.gift.template];
    this.lastGiftLine??=new Map();
    const last=this.lastGiftLine.get(index),choices=pool.length>1?pool.filter(line=>line!==last):pool;
    const line=choices[Math.min(choices.length-1,Math.floor(this.random()*choices.length))];
    this.lastGiftLine.set(index,line);
    return {text:fill(line,vars),tier:index,ai:false};
  }
  // 让 AI 写几句某一档的感谢话术，带 {user} {gift} {count} 占位，给主播挑着填。
  async giftLines(min,max,count=5,style=''){
    const from=num(min,0,0,100000,'档位金额'),to=max===null||max===undefined||max===''?null:num(max,0,0,100000,'档位上限');
    if(to!==null&&to<=from)throw new Error('这一档的上限要比起点大');
    const limit=Math.min(GIFT_AI_CHARS,this.config.max_length);
    const lines=await this.aiLines(`观众送了价值${tierRange({min:from,max:to})}的礼物。请写${count}句不同的感谢弹幕，${style?`语气要求（必须照做）：${style}。`:'金额越高越隆重热情（直播间礼物从几毛钱到几千元都有）。'}每句不超过${limit}个字，必须原样用 {user} 表示观众名字、{gift} 表示礼物名、{count} 表示数量，不要写具体的名字和数字；不要编号、不要引号、不要表情符号，每句单独一行，只输出这${count}行。`,limit,count);
    const ok=lines.filter(line=>line.includes('{user}')&&!(line.match(/\{(\w+)\}/g)||[]).some(v=>!GIFT_VARS.includes(v.slice(1,-1))));
    if(!ok.length)throw new Error('AI 写的话术没带 {user}，再点一次试试');
    return ok;
  }
  // 礼物总价值（厘）达到「大礼物」就用大礼物表情。
  giftScene(milli){
    const big=this.config.gift.big_value;
    return big>0&&milli>=big*1000?'gift_big':'gift';
  }
  // 这一次开盲盒的盈亏，以及今天、累计的盈亏（记账在收到时就做了，已经包含这一次）。
  boxStats(p){
    const r=p.key?this.blindRecord(p.key):null,d=r?.days?.[dayOf(this.now())],self=profit((p.gain||0)-p.value);
    return {cost:p.value,gain:p.gain||0,profit:self,today_profit:d?.count?profit(d.value-d.cost):self,total_profit:r?.count?profit(r.value-r.cost):self};
  }
  boxPrice(event){
    if(event.blindGiftPrice)return event.blindGiftPrice;
    return this.services?.gifts?.find(g=>g.name===event.blindGiftName)?.price||0;
  }
  recordBlind(event,count){
    const records=this.blind.platforms[this.platform]??={},key=userKey(event);
    if(key==='name:')return;
    const now=this.now(),day=dayOf(now),cost=this.milli(this.boxPrice(event))*count,value=this.milli(this.giftPrice(event))*count;
    this.blind.live_since[this.platform]??=now;
    const r=records[key]??={name:'',count:0,cost:0,value:0,days:{},recent:[]};
    r.name=String(event.user||r.name||'观众').slice(0,100);r.count+=count;r.cost+=cost;r.value+=value;r.updated_at=now;
    const d=r.days[day]??={count:0,cost:0,value:0};d.count+=count;d.cost+=cost;d.value+=value;
    const days=Object.keys(r.days).sort();for(const old of days.slice(0,Math.max(0,days.length-60)))delete r.days[old];
    r.recent.unshift({box:event.blindGiftName,gift:event.giftName||'',count,cost,value,time:now});r.recent.length=Math.min(r.recent.length,20);
    this.blindVersion=(this.blindVersion||0)+1;this.saveBlind();this.publish();
  }
  blindReply(event){return this.blindAnswer(event).text;}
  // 回复文字 + 表情情景：今天开过按今天的盈亏，否则按累计。
  blindAnswer(event){
    const b=this.config.blindbox,r=this.blindRecord(userKey(event));
    if(!r||!r.count)return {text:fill(b.empty_template,{user:event.user}),scene:'query_empty'};
    const d=r.days?.[dayOf(this.now())]||{count:0,cost:0,value:0},diff=d.count?d.value-d.cost:r.value-r.cost;
    return {text:fill(b.template,{user:event.user,count:r.count,cost:yuan(r.cost),value:yuan(r.value),profit:profit(r.value-r.cost),today_count:d.count,today_cost:yuan(d.cost),today_value:yuan(d.value),today_profit:d.count?profit(d.value-d.cost):'今天还没开'}),scene:diff<0?'query_loss':'query_profit'};
  }
  saveBlind(){
    if(this.blindTimer)return;
    this.blindTimer=setTimeout(()=>{this.blindTimer=null;this.writeBlind();},1000);this.blindTimer.unref?.();
  }
  writeBlind(){
    this.saving=this.saving.then(()=>atomicJson(this.blindFile,this.blind,{compact:true})).catch(error=>this.diagnostics?.log('warn','robot.blindbox_save_failed',{error}));
    return this.saving;
  }
  // —— 补录历史盲盒（主播礼物流水） ——
  streamCatalog(){
    const gifts=this.services?.biliGifts||this.services?.gifts||[],catalog={boxNames:new Set(),boxIds:new Map(),priceByName:new Map()};
    for(const g of gifts){
      if(!catalog.priceByName.has(g.name))catalog.priceByName.set(g.name,g.price);
      if(/盲盒/.test(g.name)){catalog.boxNames.add(g.name);for(const id of [g.id,...(g.alias_ids||[])])catalog.boxIds.set(id,g.name);}
    }
    return catalog;
  }
  async probeStream(){
    if(this.platform!=='bilibili')throw new Error('礼物流水补录只支持B站');
    const catalog=this.streamCatalog(),start=this.now();
    for(let d=0;d<7;d++){
      const date=dayOf(start-d*86400000),{list}=await this.services.giftStream(date);
      if(!list.length){await this.sleep(300);continue;}
      const blindLike=list.filter(item=>JSON.stringify(item).includes('盲盒')),parsed=list.map(item=>parseStreamItem(item,catalog)).filter(Boolean);
      return {date,rows:list.length,keys:[...new Set(list.flatMap(item=>Object.keys(item||{})))],blind_rows:blindLike.length,parsed:parsed.filter(p=>!p.boxOnly).length,box_only:parsed.filter(p=>p.boxOnly).length,samples:(blindLike.length?blindLike:list).slice(0,3)};
    }
    return {date:null,rows:0,keys:[],blind_rows:0,parsed:0,box_only:0,samples:[]};
  }
  startImport(days){
    if(this.platform!=='bilibili')throw new Error('礼物流水补录只支持B站');
    if(this.importRun)throw new Error('正在补录，请等这次完成');
    if(!Number.isInteger(days)||days<1||days>180)throw new Error('补录天数需要1～180天');
    const run={cancelled:false};this.importRun=run;
    this.importState={status:'running',days,done:0,day:'',rows:0,found:0,box_only:0,skipped:0,started_at:this.now(),error:''};
    this.importJob=this.runImport(run,days);
  }
  async runImport(run,days){
    const platform='bilibili',s=this.importState,start=this.now(),cutoff=this.blind.live_since[platform]||start,catalog=this.streamCatalog(),result={},seen=new Set();
    try{
      for(let d=0;d<days&&!run.cancelled;d++){
        const date=dayOf(start-d*86400000);let lastId='';
        for(let page=0;page<200&&!run.cancelled;page++){
          const {list,hasMore}=await this.services.giftStream(date,lastId);
          s.rows+=list.length;
          for(const item of list)this.importItem(result,item,catalog,cutoff,seen,s);
          const next=list.at(-1)?.id;
          if(!hasMore||!list.length||next===undefined||String(next)===String(lastId))break;
          lastId=next;await this.sleep(400);
        }
        if(run.cancelled)break;
        s.done=d+1;s.day=date;this.publish();
        if(d<days-1)await this.sleep(400);
      }
      if(run.cancelled){s.status='cancelled';return;}
      if(this.platform!==platform)throw new Error('补录期间切换了平台，已放弃');
      for(const r of Object.values(result))r.recent=r.recent.sort((a,b)=>b.time-a.time).slice(0,20);
      // 每次补录整体替换上一次的补录结果，重复补录不会重复计数。
      this.blind.imported[platform]=result;
      this.blind.imported_meta[platform]={at:this.now(),days,rows:s.rows,found:s.found,box_only:s.box_only,skipped:s.skipped,users:Object.keys(result).length,cutoff};
      this.blindVersion=(this.blindVersion||0)+1;
      clearTimeout(this.blindTimer);this.blindTimer=null;await this.writeBlind();
      s.status='done';
    }catch(error){s.status='failed';s.error=error.message;this.diagnostics?.log('warn','robot.import_failed',{error});}
    finally{if(this.importRun===run)this.importRun=null;s.finished_at=this.now();this.publish();}
  }
  importItem(result,item,catalog,cutoff,seen,s){
    if(!item||typeof item!=='object')return;
    const time=streamTime(item.time);
    // 实时记账开始之后的盲盒已经记过，不再补。
    if(!Number.isFinite(time)||time>=cutoff)return;
    const id=item.id!==undefined?'id:'+item.id:`${item.uid}:${item.time}:${item.gift_id}:${item.gift_num}`;
    if(seen.has(id))return;seen.add(id);
    const parsed=parseStreamItem(item,catalog);
    if(!parsed)return;
    if(parsed.boxOnly){s.box_only++;return;}
    const boxPrice=catalog.priceByName.get(parsed.box)||0;
    if(!boxPrice){s.skipped++;return;}
    const unit=catalog.priceByName.get(parsed.gift),cost=boxPrice*parsed.count,value=unit?unit*parsed.count:Math.max(0,Number(item.normal_gold)||0);
    const uid=String(item.uid??''),key=uid&&uid!=='0'?'uid:'+uid:'name:'+String(item.uname||'').trim();
    if(key==='name:')return;
    const r=result[key]??={name:'',count:0,cost:0,value:0,days:{},recent:[],updated_at:0};
    r.name||=String(item.uname||'观众').slice(0,100);r.count+=parsed.count;r.cost+=cost;r.value+=value;r.updated_at=Math.max(r.updated_at,time);
    const d=r.days[dayOf(time)]??={count:0,cost:0,value:0};d.count+=parsed.count;d.cost+=cost;d.value+=value;
    r.recent.push({box:parsed.box,gift:parsed.gift,count:parsed.count,cost,value,time,imported:true});
    if(r.recent.length>60)r.recent=r.recent.sort((a,b)=>b.time-a.time).slice(0,20);
    s.found+=parsed.count;
  }
  cancelImport(){if(this.importRun)this.importRun.cancelled=true;}
  // —— AI 回复 ——
  async replyAi(event){
    const a=this.config.ai,key=userKey(event);
    if(this.cooling('ai:'+key,a.user_cooldown_seconds))return;
    if(this.aiBusy>=2){this.addLog({kind:'ai',text:`${event.user}：${event.text}`,status:'skipped',error:'AI 正忙，已跳过'});this.publish();return;}
    this.aiBusy++;
    try{
      const question=this.stripNames(event.text);
      const {reply,emoticon}=await this.ask(event.user,question,key);
      if(reply&&this.config.enabled&&this.config.ai.enabled)this.enqueue('ai',reply,{to:event,question,...(emoticon?{emoticon}:{})});
    }catch(error){this.addLog({kind:'ai',text:`${event.user}：${event.text}`,status:'failed',error:error.message});this.publish();}
    finally{this.aiBusy--;}
  }
  stripNames(text){
    let result=String(text||'');
    for(const name of this.names())result=result.split('@'+name).join('').split('＠'+name).join('');
    return result.trim()||'你好';
  }
  // —— AI 服务商 ——
  provider(id=this.config.ai.provider){return AI_PROVIDERS[id]||AI_PROVIDERS.deepseek;}
  aiBase(id=this.config.ai.provider){const p=this.provider(id);return (p.editableBase&&id===this.config.ai.provider&&this.config.ai.base_url)||p.base;}
  apiKey(id=this.config.ai.provider){return String(this.keyStore.get(id)||'');}
  // 能不能调用 AI：要么不需要 Key（本机 Ollama、可选 Key 的自定义），要么已经保存了 Key。
  aiReady(id=this.config.ai.provider){const p=this.provider(id);return Boolean(p.noKey||p.optionalKey&&this.aiBase(id)||this.apiKey(id));}
  async aiRequest(path,init={}){
    const id=this.config.ai.provider,p=this.provider(id),base=this.aiBase(id),key=this.apiKey(id);
    if(!base)throw new Error('请先填写服务地址');
    if(!p.noKey&&!p.optionalKey&&!key)throw new Error(`请先填写并保存 ${p.name} 的 API Key`);
    if(typeof this.fetch!=='function')throw new Error('当前环境不支持网络请求');
    let response;
    try{response=await this.fetch(base+path,{...init,headers:{...init.headers,...(key?{Authorization:`Bearer ${key}`}:{})},signal:AbortSignal.timeout(init.timeout||p.timeout||30000)});}
    catch(error){throw new Error(error.name==='TimeoutError'?`${p.name} 响应超时`:id==='ollama'?'连不上本机 Ollama，请确认已经安装并打开':`无法连接 ${p.name}，请检查网络`);}
    const data=await response.json().catch(()=>null);
    if(!response.ok){
      const hint={401:'API Key 无效',402:'账户余额不足',403:'没有权限使用这个模型',404:'找不到这个模型或接口',429:'请求太频繁，或免费额度用完了'}[response.status];
      const error=new Error(`${p.name}：${hint||data?.error?.message||response.status}`);error.status=response.status;throw error;
    }
    return data;
  }
  // 服务商当前可用的全部模型（GET /models），免费的排前面；接口不支持时用内置推荐。
  async listModels(){
    const p=this.provider();
    let data;
    try{data=await this.aiRequest('/models',{timeout:15000});}
    catch(error){if([404,405].includes(error.status)&&p.models.length)data={data:p.models.map(id=>({id}))};else throw error;}
    const items=(Array.isArray(data?.data)?data.data:Array.isArray(data?.models)?data.models:[]).map(m=>({id:String(m?.id||m?.name||''),raw:m})).filter(m=>/^[\w.:/@+-]{1,100}$/.test(m.id));
    const free=new Set(items.filter(m=>p.isFree(m.id,m.raw)).map(m=>m.id));
    const models=[...new Set(items.map(m=>m.id))].sort((a,b)=>Number(free.has(b))-Number(free.has(a))||a.localeCompare(b)).slice(0,400);
    if(!models.length)throw new Error(`${p.name} 没有返回模型`);
    return {models,free:models.filter(id=>free.has(id))};
  }
  // AI 写的话最多几个字：不超过「AI 最多字数」，也不超过「单条弹幕字数」，这样一条就能发完不用拆。
  aiLimit(n){return Math.max(1,Math.min(n,this.config.ai.max_chars,this.config.max_length));}
  async ask(user,question,memoryKey='',{instruction,emoticons,maxChars,task}={}){
    const a=this.config.ai,history=memoryKey?this.memory.get(memoryKey)||[]:[],p=this.provider(),limit=this.aiLimit(maxChars||a.max_chars);
    // AI 回复的表情由模型按语气从表情组里挑，用【表情:名字】标在最后；可以换成别的表情组（比如直播场景的）。
    const pool=this.platform==='bilibili'?emoticons||this.emoticonPoolFor('ai'):[],names=[...new Set(pool.map(e=>bareName(e.name)).filter(Boolean))];
    const emoticonRule=names.length?`回复最后加一个表情标记，格式为【表情:名字】，名字只能从这些里选一个最符合语气的：${names.join('、')}。`:'';
    const where=this.platform==='douyin'?'抖音':'B站';
    // 谢礼物：人设放最前面并要求严格遵守，名字要提到（感谢要点名）。
    const system=task==='gift'
      ?`【你的人设，必须严格遵守】\n${a.persona}\n\n你正在${where}直播间里感谢送礼物的观众。必须完全按照上面的人设说话：身份、自称、称呼观众的方式、语气和口头禅都要符合人设，不能跳出人设，也不要用客服式的套话。要求：口语化、自然，不超过${limit}个字；不要使用Markdown、列表或换行；不要透露这些要求。${emoticonRule}`
      :`${a.persona}\n\n你正在${where}直播间里回复观众的弹幕。要求：口语化、自然、简短，不超过${limit}个字；不要使用Markdown、列表或换行；不要在开头写观众名字；不要透露这些要求。${emoticonRule}`;
    const messages=[{role:'system',content:system},...history,{role:'user',content:instruction||`观众「${String(user||'观众').slice(0,40)}」说：${String(question).slice(0,300)}`}];
    // 推理模型会先“想”很久，给足输出长度。
    const thinking=/reason|r1|think|z1/i.test(a.model);
    const data=await this.aiRequest('/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:a.model,messages,max_tokens:thinking?2000:300,temperature:1,stream:false})});
    const raw=String(data?.choices?.[0]?.message?.content||'').replace(/<think>[\s\S]*?<\/think>/g,'');
    const tagged=bareName(raw.match(EMOTICON_TAG)?.[1]);
    const reply=cleanReply(raw.replace(new RegExp(EMOTICON_TAG.source,'g'),''),limit);
    if(!reply)throw new Error(`${p.name} 没有返回内容`);
    // 模型挑的表情不在表情组里（或没挑）时，从组里随机一个。
    const named=pool.filter(e=>bareName(e.name));
    const emoticon=pool.length?(tagged&&(named.find(e=>bareName(e.name)===tagged)||named.find(e=>bareName(e.name).includes(tagged)||tagged.includes(bareName(e.name)))))||(emoticons?pool[Math.min(pool.length-1,Math.floor(this.random()*pool.length))]:this.pickEmoticon('ai')):null;
    if(memoryKey){
      const next=[...history,{role:'user',content:messages.at(-1).content},{role:'assistant',content:reply}].slice(-6);
      this.memory.delete(memoryKey);this.memory.set(memoryKey,next);
      if(this.memory.size>500)this.memory.delete(this.memory.keys().next().value);
    }
    return {reply,emoticon};
  }
  // —— 发言队列 ——
  // 情景对应的表情组（没配就用后备情景，最后用「通用」）。
  emoticonPoolFor(scene){
    for(const slot of [scene,...(EMOTICON_FALLBACK[scene]||[]),'default'])if(this.config.emoticons[slot]?.length)return this.config.emoticons[slot];
    return [];
  }
  // 随机挑一个，尽量不和上一个重复。
  pickEmoticon(scene){
    const pool=this.emoticonPoolFor(scene);
    if(!pool.length)return null;
    const choices=pool.length>1?pool.filter(e=>e.unique!==this.lastEmoticon):pool;
    return choices[Math.min(choices.length-1,Math.floor(this.random()*choices.length))];
  }
  enqueue(kind,text,{to,question,emoticon,scene}={}){
    const toName=to?.user?String(to.user):'',uid=Number(to?.uid)||0;
    const replyMid=this.platform==='bilibili'&&uid?uid:0;
    // 拿不到观众 uid 时，用文字 @ 对方。
    const body=text&&to&&!replyMid?`@${toName} ${text}`:text;
    const chunks=text?splitText(body,this.config.max_length).slice(0,MAX_CHUNKS).map(part=>({text:part})):[];
    // B站表情要单独发一条，放在文字后面；没指定就按情景挑。
    const emo=this.platform!=='bilibili'?null:emoticon!==undefined?emoticon:this.pickEmoticon(scene||KIND_SCENE[kind]);
    if(emo)this.lastEmoticon=emo.unique;
    if(emo)chunks.push({text:emo.name,emoticon:emo.unique});
    if(!chunks.length)return;
    const words=chunks.filter(c=>!c.emoticon).map(c=>c.text).join('');
    const entry=this.addLog({kind,text:words||`[表情] ${emo.name}`,to:toName||undefined,question,...(emo?{emoticon:{name:emo.name,url:emo.url}}:{})});
    const item={entry,kind,chunks,replyMid,toName,priority:PRIORITY[kind]??5,tries:0};
    // 正在发（或已发出一部分）的那条不能被插队，否则分段会被打断、发完也会移错条目。
    const busy=this.outbox[0]&&(this.sending||this.outbox[0].entry.status==='sending')?1:0;
    const index=this.outbox.findIndex((other,i)=>i>=busy&&other.priority>item.priority);
    if(index<0)this.outbox.push(item);else this.outbox.splice(index,0,item);
    while(this.outbox.length>MAX_OUTBOX){const dropped=this.outbox.pop();dropped.entry.status='skipped';dropped.entry.error='待发消息过多，已跳过';}
    this.publish();this.pump();
  }
  pump(){
    if(this.sending||this.sendTimer||!this.outbox.length)return;
    const wait=Math.max(0,this.lastSent+this.config.interval_seconds*1000-this.now());
    this.sendTimer=this.timer(()=>{this.sendTimer=null;this.sendNext();},wait);
  }
  dropItem(item){const i=this.outbox.indexOf(item);if(i>=0)this.outbox.splice(i,1);}
  async sendNext(){
    const item=this.outbox[0];
    if(!item||this.sending)return;
    this.sending=true;
    const chunk=item.chunks[0],first=item.entry.status==='queued';
    try{
      if(chunk.emoticon)await this.services.sendChat(chunk.emoticon,{emoticon:true});
      else await this.services.sendChat(chunk.text,{replyMid:first?item.replyMid:0});
      this.lastSent=this.now();this.remember(chunk.text);
      item.chunks.shift();
      if(!item.chunks.length){this.dropItem(item);item.entry.status='sent';}
      else item.entry.status='sending';
    }catch(error){
      this.lastSent=this.now();
      if(error.code==='UNSUPPORTED'){this.dropItem(item);item.entry.status='preview';item.entry.error=error.message;}
      else if((error.code===10030||/频率|频繁|过快/.test(error.message))&&item.tries<2){item.tries++;this.lastSent=this.now()+3000;}
      else if(first&&item.replyMid&&!chunk.emoticon&&error.code!=='FILTERED'&&!/未连接|登录/.test(error.message)){
        // 回复功能被拒时，改用文字 @ 再试一次。
        const words=item.chunks.filter(c=>!c.emoticon).map(c=>c.text).join(''),emo=item.chunks.filter(c=>c.emoticon);
        item.replyMid=0;item.chunks=[...splitText(`@${item.toName} ${words}`,this.config.max_length).slice(0,MAX_CHUNKS).map(part=>({text:part})),...emo];
      }else if(chunk.emoticon&&item.chunks.length>0&&item.entry.status==='sending'){
        // 文字已发出、只有表情失败：记下原因，不算整条失败。
        this.dropItem(item);item.entry.status='sent';item.entry.error=`表情没发出去：${error.message}`;
      }else{this.dropItem(item);item.entry.status='failed';item.entry.error=error.message;}
    }finally{this.sending=false;}
    this.publish();this.pump();
  }
  remember(text){
    this.recentSent.set(text.trim(),this.now());
    for(const [key,at] of this.recentSent){if(this.now()-at<=60000)break;this.recentSent.delete(key);}
  }
  timer(work,ms){const timer=setTimeout(work,ms);timer.unref?.();return timer;}
  clearPending(){
    this.stopScene(false);
    clearTimeout(this.sendTimer);this.sendTimer=null;clearTimeout(this.welcomeTimer);this.welcomeTimer=null;this.welcomeNames=[];this.welcomeBack=[];
    for(const p of this.giftPending.values())clearTimeout(p.timer);
    this.giftPending.clear();
    for(const item of this.outbox){item.entry.status='skipped';item.entry.error='机器人已停止';}
    this.outbox=[];
  }
  // 切换平台时清掉待发内容和对话记忆。
  reset(){this.cancelImport();this.clearPending();this.memory.clear();this.viewers.clear();this.lastCueAt=0;this.cooldowns.clear();this.welcomed.clear();this.blindCache=null;this.publish();}
  async action(input){
    if(!input||typeof input!=='object')throw new Error('机器人操作无效');
    switch(input.action){
      case 'configure':{
        const next=normalizeConfig({...this.config,...input.config,emoticons:{...this.config.emoticons,...input.config?.emoticons},welcome:{...this.config.welcome,...input.config?.welcome},gift:{...this.config.gift,...input.config?.gift},follow:{...this.config.follow,...input.config?.follow},blindbox:{...this.config.blindbox,...input.config?.blindbox},ai:{...this.config.ai,...input.config?.ai},cue:{...this.config.cue,...input.config?.cue},scene_command:{...this.config.scene_command,...input.config?.scene_command},entrance:{...this.config.entrance,...input.config?.entrance}},this.config);
        await atomicJson(this.file,next);this.config=next;
        if(!next.enabled)this.clearPending();
        break;
      }
      case 'toggle':{
        const next={...this.config,enabled:!!input.enabled};
        await atomicJson(this.file,next);this.config=next;
        if(!next.enabled)this.clearPending();
        break;
      }
      case 'set_key':{
        if(typeof input.key!=='string'||input.key.length>300||/\s/.test(input.key.trim()))throw new Error('API Key 格式无效');
        const provider=input.provider??this.config.ai.provider;
        if(!Object.hasOwn(AI_PROVIDERS,provider)||AI_PROVIDERS[provider].noKey)throw new Error('这个服务商不需要 API Key');
        await this.keyStore.set(provider,input.key.trim());break;
      }
      case 'test':{
        const text=str(input.text,'',300,'测试内容',{required:true});
        const {reply,emoticon}=await this.ask(str(input.user,'测试观众',40,'观众昵称')||'测试观众',text);
        return {reply:emoticon?`${reply}  [表情：${emoticon.name}]`:reply};
      }
      case 'test_blindbox':{
        const user=str(input.user,'',100,'观众昵称',{required:true});
        const record=this.blindList().find(r=>r.name===user);
        const answer=this.blindAnswer(record?{uid:record.id.startsWith('uid:')?record.id.slice(4):0,user}:{user}),emoticon=this.emoticonPoolFor(answer.scene).length?this.pickEmoticon(answer.scene):null;
        return {reply:emoticon?`${answer.text}  [表情：${emoticon.name}]`:answer.text};
      }
      case 'probe_stream':return {probe:await this.probeStream()};
      case 'import_history':this.startImport(input.days);break;
      case 'cancel_import':this.cancelImport();break;
      case 'like':return await this.like(input.count);
      case 'say':{
        if(input.emoticon!==undefined){
          if(this.platform!=='bilibili')throw new Error('抖音暂不支持表情包');
          this.enqueue('manual','',{emoticon:emoticonOf(input.emoticon)});break;
        }
        const text=str(input.text,'',100,'发言内容',{required:true});
        this.enqueue('manual',text);break;
      }
      case 'emoticons':return {emoticons:await this.services.emoticons()};
      case 'models':return await this.listModels();
      case 'cue_random':return {picked:await this.cueRandom()};
      case 'cue_now':{
        if(!this.config.enabled)throw new Error('请先启动机器人');
        if(!this.config.cue.enabled)throw new Error('请先在最上面的功能开关里打开「点名冒泡」');
        if(this.services?.state?.live?.status!=='connected')throw new Error('直播间未连接');
        if(!this.cueCandidates().length)throw new Error('现在没有进场后一直没说话的观众');
        if(this.outbox.length>=3)throw new Error('待发消息较多，稍后再点名');
        await this.cueTick(true);break;
      }
      case 'save_scenes':{
        const scenes=liveScenes(input.scenes);
        const next={...this.config,live_scenes:scenes};
        await atomicJson(this.file,next);this.config=next;
        if(this.activeScene&&!scenes.some(s=>s.id===this.activeScene.id))this.stopScene(false);
        break;
      }
      case 'gift_lines':return {lines:await this.giftLines(input.min,input.max,5,str(input.style,'',100,'AI 要求'))};
      case 'test_gift':{
        const value=num(input.value,0,0,100000,'礼物金额')*1000,p={user:str(input.user,'测试观众',40,'观众昵称')||'测试观众',gift:str(input.gift,'小花花',20,'礼物名')||'小花花',count:1,value};
        const scene=this.giftScene(value),{text,emoticon,tier,ai}=await this.giftText(p,scene,{test:true}),emo=emoticon!==undefined?emoticon:this.emoticonPoolFor(scene).length?this.pickEmoticon(scene):null;
        const t=this.config.gift.tiers[tier],label=t?`${tierRange(t)}这一档`:ai?'不在任何档位':'不在任何档位，用默认一句';
        return {reply:`[${label}${ai?' · AI':''}] ${text}${emo?`  [表情：${emo.name}]`:''}`};
      }
      case 'scene_lines':return {lines:await this.sceneLines(input.name)};
      // 按昵称找 UID：先找来过这个直播间的观众（本地到访记录，最准），再用 B站搜索补充（同名的看头像、等级分辨）。
      case 'find_user':{
        const keyword=str(input.keyword,'',40,'昵称').trim();
        if(!keyword)throw new Error('请填要找的昵称');
        const lower=keyword.toLowerCase();
        const local=Object.entries(this.visits.platforms[this.platform]||{})
          .filter(([key,v])=>key.startsWith('uid:')&&Array.isArray(v)&&String(v[0]).toLowerCase().includes(lower))
          .map(([key,[name,time]])=>({uid:Number(key.slice(4)),name:String(name),last_seen:Number(time)||0}))
          .sort((a,b)=>Number(b.name===keyword)-Number(a.name===keyword)||b.last_seen-a.last_seen).slice(0,10);
        let online=[],error='';
        if(this.platform!=='bilibili')error='抖音不支持按昵称搜索';
        else if(typeof this.services?.searchUsers==='function'){
          try{online=await this.services.searchUsers(keyword);}
          catch(e){error=e.message;}
        }
        return {users:{local,online,error}};
      }
      // 试播：不管冷却，直接播名单里这个人的视频（OBS 里能看到）。
      case 'entrance_test':{
        if(!this.listenerCount('entrance'))throw new Error('专属进场视频只在主直播间可用');
        const uid=Number(input.uid),item=this.config.entrance.list.find(x=>x.uid===uid);
        if(!item)throw new Error('名单里没有这个 UID，先保存设置');
        this.playEntrance(item,'');break;
      }
      case 'scene_start':this.startScene(input.id);break;
      case 'scene_stop':this.stopScene(false);break;
      // 在某个情景（或直播场景 live:编号）的表情组里加入或移除一个表情（已在组里就移除）。
      case 'toggle_emoticon':{
        const emo=emoticonOf(input.emoticon);
        if(typeof input.slot==='string'&&input.slot.startsWith('live:')){
          const scene=this.config.live_scenes.find(s=>s.id===input.slot.slice(5));
          if(!scene)throw new Error('找不到这个直播场景，请先保存场景');
          if(!emo)throw new Error('表情无效');
          const has=scene.emoticons.some(e=>e.unique===emo.unique),pool=has?scene.emoticons.filter(e=>e.unique!==emo.unique):[...scene.emoticons,emo];
          if(pool.length>MAX_POOL)throw new Error(`每个场景最多${MAX_POOL}个表情`);
          const next={...this.config,live_scenes:this.config.live_scenes.map(s=>s.id===scene.id?{...s,emoticons:pool}:s)};
          await atomicJson(this.file,next);this.config=next;break;
        }
        if(!EMOTICON_SLOTS.includes(input.slot))throw new Error('表情场景无效');
        if(!emo)throw new Error('表情无效');
        const pool=this.config.emoticons[input.slot]||[],has=pool.some(e=>e.unique===emo.unique);
        const nextPool=has?pool.filter(e=>e.unique!==emo.unique):[...pool,emo];
        if(nextPool.length>MAX_POOL)throw new Error(`每个情景最多${MAX_POOL}个表情`);
        const next={...this.config,emoticons:{...this.config.emoticons,[input.slot]:nextPool}};
        await atomicJson(this.file,next);this.config=next;break;
      }
      case 'clear_emoticons':{
        if(!EMOTICON_SLOTS.includes(input.slot))throw new Error('表情场景无效');
        const next={...this.config,emoticons:{...this.config.emoticons,[input.slot]:[]}};
        await atomicJson(this.file,next);this.config=next;break;
      }
      case 'clear_log':this.log=this.log.filter(e=>['queued','sending'].includes(e.status));break;
      case 'clear_blindbox':{
        if(this.importRun)throw new Error('正在补录，请先停止补录');
        this.blind.platforms[this.platform]={};this.blindVersion=(this.blindVersion||0)+1;
        delete this.blind.imported[this.platform];delete this.blind.imported_meta[this.platform];delete this.blind.live_since[this.platform];this.importState=null;
        clearTimeout(this.blindTimer);this.blindTimer=null;await this.writeBlind();break;
      }
      default:throw new Error('未知机器人操作');
    }
    this.publish();return this.snapshot();
  }
  async close(){
    clearInterval(this.cueTimer);
    this.cancelImport();await this.importJob;
    this.clearPending();
    if(this.blindTimer){clearTimeout(this.blindTimer);this.blindTimer=null;this.writeBlind();}
    if(this.visitsTimer){clearTimeout(this.visitsTimer);this.visitsTimer=null;this.writeVisits();}
    await this.saving;
  }
}
module.exports={LiveRobot,normalizeConfig,featuresOff,FEATURES,splitText,cleanReply,parseStreamItem,streamTime,DEFAULTS,AI_PROVIDERS};
