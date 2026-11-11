import {$,api,toast,escapeHtml} from './console-shared.js';
import {state as consoleState} from './app.js';

const form=$('#robot-settings'),testForm=$('#robot-test-form');
// 表单字段与配置路径一一对应；数字字段提交时转成数字。
const FIELDS=['names','max_length','interval_seconds','welcome.enabled','welcome.template','welcome.merge_seconds','welcome.user_cooldown_minutes','gift.enabled','gift.template','gift.blind_template','gift.guard_template','gift.merge_seconds','gift.min_value','gift.big_value','follow.enabled','follow.template','blindbox.enabled','blindbox.keyword','blindbox.require_mention','blindbox.template','blindbox.empty_template','ai.enabled','ai.model','ai.persona','ai.max_chars','ai.user_cooldown_seconds','cue.enabled','cue.interval_minutes','cue.silent_minutes','cue.active_minutes','cue.user_cooldown_minutes','cue.templates','cue.random_templates','cue.use_ai'];
const KINDS={welcome:'欢迎',gift:'谢礼',guard:'大航海',follow:'关注',query:'盲盒',ai:'AI',manual:'手动',cue:'点名'};
const STATUS={queued:'待发送',sending:'发送中',sent:'已发送',failed:'失败',skipped:'已跳过',preview:'仅显示'};
const time=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
let robot,pending=false,dirty=false,configStamp='',logStamp='',blindStamp='';
const get=(object,key)=>key.split('.').reduce((value,part)=>value?.[part],object);
function readForm(){
  const config={};
  for(const key of FIELDS){
    const el=form.elements[key],value=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;
    const [head,tail]=key.split('.');
    if(tail)(config[head]??={})[tail]=value;else config[head]=value;
  }
  return config;
}
const yuan=milli=>{const value=Math.round(milli/10)/100;return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0$/,'');};
function note(){
  if(!robot)return;
  const live=consoleState?.live?.status==='connected',douyin=robot.platform==='douyin',account=consoleState?.account;
  $('#robot-note').textContent=dirty?'设置还没保存':douyin?'抖音暂不支持机器人发言：回复只显示在这里，可以由主播念出来。':!account?.loggedIn?'请先在控制台扫码登录 B 站账号，机器人会用这个账号发弹幕。':!live?'连接直播间后才会发言。':robot.config.enabled?'机器人正在值班。':'机器人已关闭。';
  $('#robot-names').textContent=robot.names.length?`当前触发昵称：${robot.names.join('、')}`:'登录 B 站后，默认用登录账号的昵称触发。';
}
function render(next){
  if(next)robot=next;if(!robot)return;
  const on=robot.config.enabled;
  $('#robot-status').textContent=on?'值班中':'已关闭';$('#robot-status').classList.toggle('on',on);
  $('#robot-toggle').textContent=on?'停止机器人':'启动机器人';$('#robot-toggle').disabled=pending;
  $('#robot-outbox').textContent=`${robot.outbox} 条待发`;
  $('#robot-key-status').textContent=robot.hasKey?`已保存 ${robot.keyHint}（留空不修改）`:'未填写';
  $('#robot-key-clear').hidden=!robot.hasKey;
  const stamp=JSON.stringify(robot.config);
  if(!dirty&&stamp!==configStamp){
    configStamp=stamp;setModelOptions(modelList,robot.config.ai.model);
    for(const key of FIELDS){const el=form.elements[key],value=get(robot.config,key);if(el.type==='checkbox')el.checked=!!value;else el.value=value??'';}
  }
  const nextLog=JSON.stringify(robot.log);
  if(nextLog!==logStamp){
    logStamp=nextLog;
    $('#robot-log').innerHTML=robot.log.length?robot.log.map(entry=>`<li class="robot-entry ${escapeHtml(entry.status)}"><span class="robot-kind">${KINDS[entry.kind]||'发言'}</span><div><strong>${escapeHtml(entry.to?`@${entry.to} `:'')}${escapeHtml(entry.text)}${entry.emoticon?`<span class="robot-log-emo">${emoImage(entry.emoticon)}</span>`:''}</strong>${entry.question?`<span>问：${escapeHtml(entry.question)}</span>`:''}${entry.error?`<span class="robot-error">${escapeHtml(entry.error)}</span>`:''}</div><span class="robot-state">${STATUS[entry.status]||''}<time>${time.format(entry.time)}</time></span></li>`).join(''):'<li class="lottery-empty">还没有发言。启动后，欢迎、感谢和回复都会记在这里。</li>';
  }
  renderBlind();renderImport();renderSlots();renderCue();note();
  if(robot.hasKey&&!modelsTried){modelsTried=true;loadModels(false);}
}
// 模型下拉：DeepSeek 返回的全部模型 + 当前选中的（即使已下线也保留，方便看出来）。
let modelList=['deepseek-chat','deepseek-reasoner'],modelsTried=false;
function setModelOptions(list,selected){
  const select=form.elements['ai.model'],value=selected??select.value,names=[...new Set([...list,value].filter(Boolean))];
  select.innerHTML=names.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}${list.includes(name)?'':'（不在列表里）'}</option>`).join('');
  select.value=value;
}
async function loadModels(report=true){
  const note=$('#robot-models-note'),button=$('#robot-models-refresh');
  button.disabled=true;note.textContent='正在读取模型列表…';
  try{
    modelList=(await api('/api/robot/action',{action:'models'})).models;
    setModelOptions(modelList);
    note.textContent=`你的账号可用 ${modelList.length} 个模型：${modelList.join('、')}`;
    if(report)toast('模型列表已更新');
  }catch(error){note.textContent=`读取模型列表失败：${error.message}`;if(report)toast(error.message,true);}
  finally{button.disabled=false;}
}
function renderCue(){
  const cue=robot.cue;if(!cue)return;
  const ago=time=>{const minutes=Math.max(0,Math.round((Date.now()-time)/60000));return minutes?`${minutes} 分钟前`:'刚刚';};
  const names=cue.waiting.slice(0,5).map(v=>`${v.name}（${ago(v.entered_at)}进场）`).join('、');
  $('#robot-cue-status').textContent=!cue.tracked?'还没记录到观众进场。连上直播间后，进场的观众会出现在这里。':`房间里大约有 ${cue.present_count} 位观众可以随机点名，其中 ${cue.waiting_count} 位进场后还没说过话${names?`：${names}${cue.waiting_count>5?' 等':''}`:''}。${cue.last_at?` 上次点名 ${stamp(cue.last_at)}。`:''}`;
  $('#robot-cue-random').disabled=pending||!cue.present_count;
}
// 情景表情组：与服务端 EMOTICON_SLOTS / EMOTICON_FALLBACK 一致。
const SLOTS={default:'通用',welcome:'欢迎进场',gift:'谢礼物',gift_big:'谢大礼物',guard:'谢大航海',follow:'谢关注',query_profit:'盲盒 · 赚了',query_loss:'盲盒 · 亏了',query_empty:'盲盒 · 没记录',ai:'AI 回复',cue:'点名冒泡'};
const FALLBACK={gift_big:['gift'],guard:['gift_big','gift']};
let emoticons=[],slotStamp='';
const emoImage=e=>e?.url?`<img src="${escapeHtml(e.url)}" alt="${escapeHtml(e.name)}" loading="lazy">`:'';
const target=()=>$('#robot-emo-target').value;
function usedSlot(slot){for(const s of [slot,...(FALLBACK[slot]||[]),'default'])if(robot.config.emoticons?.[s]?.length)return s;return null;}
function renderSlots(){
  const current=target(),next=JSON.stringify([robot.config.emoticons,robot.platform,current]);if(next===slotStamp)return;slotStamp=next;
  $('#robot-emo-slots').innerHTML=Object.entries(SLOTS).map(([slot,label])=>{
    const pool=robot.config.emoticons?.[slot]||[],used=usedSlot(slot);
    const body=pool.length?pool.map(e=>`<button type="button" class="robot-emo-chip" data-emo-remove="${slot}" data-unique="${escapeHtml(e.unique)}" title="移除「${escapeHtml(e.name)}」">${emoImage(e)}</button>`).join(''):`<em class="muted-emo">${used?`没配，用「${SLOTS[used]}」`:'不发表情'}</em>`;
    return `<div class="robot-emo-slot${slot===current?' active':''}" data-emo-slot="${slot}"><span>${label}<b>${pool.length||''}</b></span><div>${body}</div></div>`;
  }).join('');
  const hint=current==='send'?'点下面的表情会直接发到直播间。':`正在编辑「${SLOTS[current]}」：点下面的表情加入这一组，再点一次移出；点上面已选的小图也能移出。`;
  $('#robot-emo-hint').textContent=hint;
  if(emoticons.length)renderGrid();
}
function renderGrid(){
  const picked=new Set((robot?.config.emoticons?.[target()]||[]).map(e=>e.unique));
  $('#robot-emo-grid').innerHTML=emoticons.length?emoticons.map((pkg,p)=>`<div class="robot-emo-pkg"><h3>${escapeHtml(pkg.name)}</h3><div>${pkg.items.map((e,i)=>`<button type="button" class="robot-emo${picked.has(e.unique)?' picked':''}" data-emo="${p}:${i}" title="${escapeHtml(e.name)}${e.usable?'':`（${escapeHtml(e.lock||'暂不可用')}）`}" aria-pressed="${picked.has(e.unique)}" ${e.usable?'':'disabled'}>${emoImage(e)}</button>`).join('')}</div></div>`).join(''):'<p class="lottery-empty">这个直播间没有可用的表情。</p>';
}
const stamp=time=>new Date(time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
function renderImport(){
  const s=robot.import,meta=robot.imported,running=s?.status==='running',bili=robot.platform==='bilibili';
  $('#robot-import').textContent=running?'停止补录':'补录历史盲盒';
  $('#robot-import').disabled=pending||!bili;$('#robot-probe').disabled=pending||running||!bili;$('#robot-import-days').disabled=running;
  const shortage=box=>box?`另有 ${box} 条流水只记了盲盒本身、看不出开出了什么，没有计入。`:'';
  let text;
  if(!bili)text='礼物流水补录只支持 B 站。';
  else if(running)text=`正在补录：${s.done}/${s.days} 天（${s.day||'今天'}），读到 ${s.rows} 条流水，找到 ${s.found} 个盲盒…`;
  else if(s?.status==='failed')text=`补录失败：${s.error}。已有记录没有改动。`;
  else if(s?.status==='cancelled')text='已停止补录，已有记录没有改动。';
  else if(s?.status==='done')text=s.found?`补录完成：读了 ${s.days} 天共 ${s.rows} 条流水，补上 ${meta?.users||0} 位观众的 ${s.found} 个盲盒。${shortage(s.box_only)}`:s.box_only?`流水里的 ${s.box_only} 条盲盒只记了盲盒本身，看不到开出了什么，算不了盈亏，所以没有补录。`:`读了 ${s.days} 天共 ${s.rows} 条流水，没有找到盲盒。`;
  else if(meta)text=`上次补录 ${stamp(meta.at)}：近 ${meta.days} 天，${meta.users} 位观众 ${meta.found} 个盲盒。${shortage(meta.box_only)}`;
  else text='用主播本人的 B 站账号读取后台「礼物流水」，补上机器人开始记账之前的盲盒（B站只保留近 180 天）。';
  if(bili&&robot.live_since&&!running)text+=` 实时记账从 ${stamp(robot.live_since)} 开始，补录只取这之前的流水，不会重复。`;
  $('#robot-import-status').textContent=text;
}
function showProbe(probe){
  const box=$('#robot-probe-result');box.hidden=false;
  const verdict=!probe.rows?'近 7 天的礼物流水都是空的。请确认登录的是主播本人的账号，或者等有礼物后再试。':probe.parsed?`能认出盲盒开出的礼物（${probe.date} 有 ${probe.parsed} 条），可以补录。`:probe.box_only?`流水只记了盲盒本身（${probe.date} 有 ${probe.box_only} 条），看不出开出了什么，补录后算不了盈亏。`:probe.blind_rows?`${probe.date} 有 ${probe.blind_rows} 条流水提到盲盒，但没认出格式，请把下面的内容发给开发者。`:`${probe.date} 的 ${probe.rows} 条流水里没有盲盒。可以换个有人开盲盒的日子再看。`;
  box.innerHTML=`<strong>${escapeHtml(verdict)}</strong><span>流水字段：${escapeHtml(probe.keys.join('、')||'无')}</span>${probe.samples.length?`<pre>${escapeHtml(JSON.stringify(probe.samples,null,2))}</pre>`:''}`;
}
function renderBlind(){
  const query=$('#robot-blind-search').value.trim(),list=robot.blindbox.filter(r=>!query||r.name.includes(query));
  const stamp=JSON.stringify([robot.blindbox,query]);if(stamp===blindStamp)return;blindStamp=stamp;
  $('#robot-blind-count').textContent=robot.blindbox.length;
  $('#robot-blind').innerHTML=list.length?`<table><thead><tr><th>观众</th><th>盲盒</th><th>投入</th><th>开出</th><th>盈亏</th><th>今天</th></tr></thead><tbody>${list.map(r=>{const diff=r.value-r.cost,today=r.today;return `<tr title="${escapeHtml(r.recent.map(x=>`${x.box}→${x.gift}×${x.count}`).join('\n'))}"><td>${escapeHtml(r.name)}</td><td>${r.count}</td><td>¥${yuan(r.cost)}</td><td>¥${yuan(r.value)}</td><td class="${diff>0?'up':diff<0?'down':''}">${diff>0?'+':diff<0?'-':''}¥${yuan(Math.abs(diff))}</td><td>${today?`${today.count}个 ${today.value-today.cost>=0?'+':'-'}¥${yuan(Math.abs(today.value-today.cost))}`:'—'}</td></tr>`;}).join('')}</tbody></table>`:`<p class="lottery-empty">${query?'没有找到这位观众。':'还没有盲盒记录。'}</p>`;
}
async function action(input){
  pending=true;render();
  try{const result=await api('/api/robot/action',input);if(result.state)render(result.state);return result;}
  finally{pending=false;render();}
}
const run=work=>async event=>{event?.preventDefault();try{await work(event);}catch(error){toast(error.message,true);}};
form.addEventListener('input',()=>{dirty=true;note();});
form.addEventListener('submit',run(async()=>{
  const key=form.elements.ai_key.value.trim();
  if(key){await action({action:'set_key',key});form.elements.ai_key.value='';modelsTried=true;loadModels(false);}
  await action({action:'configure',config:readForm()});
  dirty=false;configStamp='';render();toast('机器人设置已保存');
}));
$('#robot-cue-random').onclick=run(async()=>{
  if(dirty)throw new Error('请先保存机器人设置');
  const {picked}=await action({action:'cue_random'});
  toast(`随机点到了「${picked}」，结果见发言记录`);
});
$('#robot-models-refresh').onclick=event=>{event.preventDefault();loadModels();};
$('#robot-key-clear').onclick=run(async()=>{await action({action:'set_key',key:''});toast('DeepSeek Key 已清除');});
$('#robot-toggle').onclick=run(async()=>{
  if(dirty)throw new Error('请先保存机器人设置');
  const enabled=!robot.config.enabled;
  await action({action:'toggle',enabled});
  toast(enabled?'机器人已启动':'机器人已停止');
});
$('#robot-clear-log').onclick=run(()=>action({action:'clear_log'}));
$('#robot-clear-blind').onclick=run(async()=>{if(!confirm('清空当前平台的全部盲盒记录？此操作不能撤销。'))return;await action({action:'clear_blindbox'});toast('盲盒记录已清空');});
$('#robot-blind-search').addEventListener('input',()=>robot&&renderBlind());
$('#robot-import').onclick=run(async()=>{
  if(robot.import?.status==='running'){await action({action:'cancel_import'});return;}
  const days=Number($('#robot-import-days').value);
  if(!confirm(`用当前登录的 B 站账号读取近 ${days} 天的礼物流水并补录盲盒？\n需要登录主播本人的账号；每天要请求一次，${days} 天大约需要 ${Math.ceil(days*0.9/60)} 分钟。`))return;
  await action({action:'import_history',days});
});
$('#robot-emo-load').onclick=run(async()=>{
  const button=$('#robot-emo-load');button.disabled=true;button.textContent='读取中…';
  try{emoticons=(await api('/api/robot/action',{action:'emoticons'})).emoticons;renderGrid();}
  finally{button.disabled=false;button.textContent='重新读取';}
});
$('#robot-emo-grid').onclick=run(async event=>{
  const button=event.target.closest('[data-emo]');if(!button||button.disabled)return;
  const [p,i]=button.dataset.emo.split(':').map(Number),e=emoticons[p]?.items[i];if(!e)return;
  const emoticon={unique:e.unique,name:e.name,url:e.url},slot=target();
  if(slot==='send'){await action({action:'say',emoticon});toast(`已加入发言队列：${e.name}`);return;}
  const had=(robot.config.emoticons?.[slot]||[]).some(x=>x.unique===e.unique);
  await action({action:'toggle_emoticon',slot,emoticon});
  toast(had?`已从「${SLOTS[slot]}」移出「${e.name}」`:`「${SLOTS[slot]}」加入「${e.name}」`);
});
$('#robot-emo-slots').onclick=run(async event=>{
  const chip=event.target.closest('[data-emo-remove]');
  if(chip){const slot=chip.dataset.emoRemove,e=(robot.config.emoticons?.[slot]||[]).find(x=>x.unique===chip.dataset.unique);if(e)await action({action:'toggle_emoticon',slot,emoticon:e});return;}
  const row=event.target.closest('[data-emo-slot]');
  if(row){$('#robot-emo-target').value=row.dataset.emoSlot;slotStamp='';renderSlots();}
});
$('#robot-emo-target').addEventListener('change',()=>{slotStamp='';renderSlots();});
$('#robot-probe').onclick=run(async()=>{
  const button=$('#robot-probe');button.textContent='检查中…';
  try{showProbe((await action({action:'probe_stream'})).probe);}
  finally{button.textContent='先检查流水';}
});
testForm.addEventListener('submit',run(async()=>{
  const mode=testForm.elements.mode.value,user=testForm.elements.user.value.trim()||'测试观众',text=testForm.elements.text.value.trim();
  const output=$('#robot-test-result'),button=testForm.querySelector('button');
  if(mode!=='blindbox'&&!text)throw new Error('请填写内容');
  button.disabled=true;output.hidden=false;output.textContent=mode==='ai'?'DeepSeek 思考中…':'处理中…';
  try{
    if(mode==='say'){await action({action:'say',text});output.textContent='已加入发言队列，结果见发言记录。';}
    else{const result=await action({action:mode==='ai'?'test':'test_blindbox',user,text});output.textContent=result.reply;}
  }catch(error){output.textContent=error.message;throw error;}
  finally{button.disabled=false;}
}));
testForm.elements.mode.addEventListener('change',()=>{const mode=testForm.elements.mode.value;testForm.elements.text.placeholder=mode==='blindbox'?'填上面的观众昵称即可，这里可不填':mode==='say'?'要发到直播间的弹幕':'比如：主播今天吃什么？';});
addEventListener('robot-state',event=>render(event.detail));
addEventListener('console-state',note);
async function load(){render(await api('/api/robot/state'));}
addEventListener('view-changed',event=>{if(event.detail==='robot')load().catch(error=>toast(error.message,true));});
load().catch(error=>toast(error.message,true));
