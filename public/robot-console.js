import {$,api,toast,escapeHtml} from './console-shared.js';
import {state as consoleState} from './app.js';

const form=$('#robot-settings'),testForm=$('#robot-test-form');
// 表单字段与配置路径一一对应；数字字段提交时转成数字。
const FIELDS=['names','max_length','interval_seconds','welcome.enabled','welcome.template','welcome.merge_seconds','welcome.user_cooldown_minutes','gift.enabled','gift.template','gift.blind_template','gift.guard_template','gift.merge_seconds','gift.min_value','gift.big_value','follow.enabled','follow.template','blindbox.enabled','blindbox.keyword','blindbox.require_mention','blindbox.template','blindbox.empty_template','ai.enabled','ai.provider','ai.base_url','ai.model','ai.persona','ai.max_chars','ai.user_cooldown_seconds','cue.enabled','cue.interval_minutes','cue.silent_minutes','cue.active_minutes','cue.user_cooldown_minutes','cue.templates','cue.random_templates','cue.use_ai'];
const KINDS={welcome:'欢迎',gift:'谢礼',guard:'大航海',follow:'关注',query:'盲盒',ai:'AI',manual:'手动',cue:'点名',scene:'场景'};
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
  renderProviderOptions();
  const stamp=JSON.stringify(robot.config);
  if(!dirty&&stamp!==configStamp){
    configStamp=stamp;
    if(modelProvider!==robot.config.ai.provider){modelProvider=robot.config.ai.provider;modelList=providerInfo(modelProvider)?.models||[];freeModels=new Set(providerInfo(modelProvider)?.free_models||[]);modelsTried=false;}
    setModelOptions(modelList,robot.config.ai.model);
    for(const key of FIELDS){const el=form.elements[key],value=get(robot.config,key);if(el.type==='checkbox')el.checked=!!value;else el.value=value??'';}
  }
  renderProvider();
  const nextLog=JSON.stringify(robot.log);
  if(nextLog!==logStamp){
    logStamp=nextLog;
    $('#robot-log').innerHTML=robot.log.length?robot.log.map(entry=>`<li class="robot-entry ${escapeHtml(entry.status)}"><span class="robot-kind">${KINDS[entry.kind]||'发言'}</span><div><strong>${escapeHtml(entry.to?`@${entry.to} `:'')}${escapeHtml(entry.text)}${entry.emoticon?`<span class="robot-log-emo">${emoImage(entry.emoticon)}</span>`:''}</strong>${entry.question?`<span>问：${escapeHtml(entry.question)}</span>`:''}${entry.error?`<span class="robot-error">${escapeHtml(entry.error)}</span>`:''}</div><span class="robot-state">${STATUS[entry.status]||''}<time>${time.format(entry.time)}</time></span></li>`).join(''):'<li class="lottery-empty">还没有发言。启动后，欢迎、感谢和回复都会记在这里。</li>';
  }
  renderBlind();renderImport();renderSlots();renderCue();renderScenes();note();
  if(robot.aiReady&&!modelsTried&&modelProvider===robot.config.ai.provider){modelsTried=true;loadModels(false);}
}
// —— AI 服务商：下拉里免费的排前面；切换后先存服务商，再读这家的模型 ——
let providerStamp='';
const providerInfo=id=>robot?.providers?.find(p=>p.id===id);
function renderProviderOptions(){
  const next=JSON.stringify(robot.providers.map(p=>[p.id,p.name,p.free]));if(next===providerStamp)return;providerStamp=next;
  const select=$('#robot-provider'),value=select.value||robot.config.ai.provider;
  select.innerHTML=robot.providers.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${p.free?'（有免费模型）':''}</option>`).join('');
  select.value=value;
}
function renderProvider(){
  const p=providerInfo($('#robot-provider').value);if(!p)return;
  $('#robot-provider-note').textContent=p.free?`免费：${p.free}。`:p.id==='deepseek'?'按用量付费，机器人回复很短，花费很少。':'填写任意兼容 OpenAI 接口的服务地址，例如自己部署的模型。';
  const base=form.elements['ai.base_url'];$('#robot-base-label').hidden=!p.editableBase;base.placeholder=p.base||'https://…/v1';
  $('#robot-key-block').hidden=p.noKey;
  $('#robot-key-label').textContent=`${p.name} API Key${p.optionalKey?'（没有可不填）':''}`;
  $('#robot-key-link').hidden=!p.keyUrl;if(p.keyUrl)$('#robot-key-link').href=p.keyUrl;
  $('#robot-key-status').textContent=p.keyHint?`已保存 ${p.keyHint}（留空不修改）`:'未填写';
  $('#robot-key-clear').hidden=!p.keyHint;
}
// 模型下拉：服务商返回的全部模型（免费的标出来）+ 当前选中的（即使已下线也保留，方便看出来）。
let modelList=[],freeModels=new Set(),modelsTried=false,modelProvider='';
function setModelOptions(list,selected){
  const select=form.elements['ai.model'],value=selected??select.value,names=[...new Set([...list,value].filter(Boolean))];
  select.innerHTML=names.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)}${freeModels.has(name)?'（免费）':list.includes(name)?'':'（不在列表里）'}</option>`).join('');
  select.value=value;
}
async function loadModels(report=true){
  const note=$('#robot-models-note'),button=$('#robot-models-refresh'),p=providerInfo(robot.config.ai.provider);
  button.disabled=true;note.textContent=`正在读取 ${p?.name||''} 的模型列表…`;
  try{
    const result=await api('/api/robot/action',{action:'models'});
    modelList=result.models;freeModels=new Set(result.free||[]);
    setModelOptions(modelList);
    const shown=modelList.slice(0,8).join('、');
    note.textContent=`可用 ${modelList.length} 个模型${freeModels.size?`，其中 ${freeModels.size} 个免费（排在最前面）`:''}：${shown}${modelList.length>8?' 等':''}`;
    if(report)toast('模型列表已更新');
  }catch(error){note.textContent=`读取模型列表失败：${error.message}`;if(report)toast(error.message,true);}
  finally{button.disabled=false;}
}
// —— 直播场景：在页面上编辑草稿，点「保存场景」才生效；表情直接用已保存的那份 ——
let scenesDraft=null,scenesDirty=false,scenesStamp='';
function renderScenes(){
  if(!scenesDirty&&JSON.stringify(robot.config.live_scenes.map(({emoticons,...s})=>s))!==JSON.stringify((scenesDraft||[]).map(({emoticons,...s})=>s)))scenesDraft=structuredClone(robot.config.live_scenes);
  const active=robot.active_scene,next=JSON.stringify([scenesDraft,robot.config.live_scenes.map(s=>[s.id,s.emoticons]),active,scenesDirty,pending]);
  if(next===scenesStamp)return;scenesStamp=next;
  const container=$('#robot-scenes'),focused=document.activeElement?.closest?.('[data-scene-field]'),focus=focused&&{id:focused.closest('[data-scene]').dataset.scene,field:focused.dataset.sceneField,start:focused.selectionStart,end:focused.selectionEnd};
  container.innerHTML=scenesDraft.length?scenesDraft.map(s=>{
    const saved=robot.config.live_scenes.find(x=>x.id===s.id),running=active?.id===s.id,emos=saved?.emoticons||[];
    return `<div class="robot-scene${running?' running':''}" data-scene="${escapeHtml(s.id)}">
      <div class="robot-scene-head"><input data-scene-field="name" maxlength="12" value="${escapeHtml(s.name)}" aria-label="场景名字" placeholder="场景名字"><label>每<input data-scene-field="interval_seconds" type="number" min="10" max="600" step="5" value="${s.interval_seconds}" aria-label="发送间隔（秒）">秒一次</label>
      <button type="button" class="button ${running?'dark-button':'white-button'}" data-scene-toggle ${pending||!saved?'disabled':''}>${running?'停止':'开始'}</button></div>
      ${running?`<p class="robot-scene-live">● 进行中 · 已发 ${active.sent} 条</p>`:''}
      <textarea data-scene-field="lines" rows="3" maxlength="600" placeholder="应援话术，每行一句，随机发；不填就只发表情" aria-label="应援话术">${escapeHtml(s.lines)}</textarea>
      <div class="robot-scene-foot"><span class="robot-scene-emos">${emos.length?emos.map(emoImage).join(''):`<em>${saved?'还没配表情，会用「通用」组':'保存后才能配表情'}</em>`}</span><span><button type="button" class="text-button" data-scene-emo ${saved?'':'disabled'}>配表情</button><button type="button" class="text-button" data-scene-delete>删除</button></span></div>
    </div>`;}).join(''):'<p class="lottery-empty">还没有场景，点「新增场景」。</p>';
  if(focus){const el=container.querySelector(`[data-scene="${CSS.escape(focus.id)}"] [data-scene-field="${focus.field}"]`);if(el){el.focus();try{el.setSelectionRange(focus.start,focus.end);}catch{}}}
  $('#robot-scenes-save').disabled=pending||!scenesDirty;
  $('#robot-scenes-note').textContent=scenesDirty?'场景还没保存':'';
  $('#robot-scene-add').disabled=scenesDraft.length>=8;
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
// 「live:编号」是直播场景的表情组，其余是固定情景。
const liveScene=slot=>slot?.startsWith('live:')?robot.config.live_scenes.find(s=>s.id===slot.slice(5)):null;
const poolOf=slot=>(slot?.startsWith('live:')?liveScene(slot)?.emoticons:robot.config.emoticons?.[slot])||[];
const slotLabel=slot=>slot?.startsWith('live:')?`场景 · ${liveScene(slot)?.name||''}`:SLOTS[slot];
function usedSlot(slot){for(const s of [slot,...(FALLBACK[slot]||[]),'default'])if(robot.config.emoticons?.[s]?.length)return s;return null;}
// 编辑下拉里加上各个直播场景。
let sceneOptionStamp='';
function renderSceneOptions(){
  const next=JSON.stringify(robot.config.live_scenes.map(s=>[s.id,s.name]));if(next===sceneOptionStamp)return;sceneOptionStamp=next;
  const select=$('#robot-emo-target'),value=select.value;
  select.querySelectorAll('[data-live-option]').forEach(option=>option.remove());
  const send=select.querySelector('option[value="send"]');
  for(const s of robot.config.live_scenes){const option=document.createElement('option');option.value='live:'+s.id;option.textContent=`场景 · ${s.name}`;option.dataset.liveOption='';select.insertBefore(option,send);}
  select.value=[...select.options].some(o=>o.value===value)?value:'default';
}
function renderSlots(){
  renderSceneOptions();
  const current=target(),next=JSON.stringify([robot.config.emoticons,robot.config.live_scenes,robot.platform,current]);if(next===slotStamp)return;slotStamp=next;
  $('#robot-emo-slots').innerHTML=Object.entries(SLOTS).map(([slot,label])=>{
    const pool=robot.config.emoticons?.[slot]||[],used=usedSlot(slot);
    const body=pool.length?pool.map(e=>`<button type="button" class="robot-emo-chip" data-emo-remove="${slot}" data-unique="${escapeHtml(e.unique)}" title="移除「${escapeHtml(e.name)}」">${emoImage(e)}</button>`).join(''):`<em class="muted-emo">${used?`没配，用「${SLOTS[used]}」`:'不发表情'}</em>`;
    return `<div class="robot-emo-slot${slot===current?' active':''}" data-emo-slot="${slot}"><span>${label}<b>${pool.length||''}</b></span><div>${body}</div></div>`;
  }).join('');
  const hint=current==='send'?'点下面的表情会直接发到直播间。':`正在编辑「${slotLabel(current)}」：点下面的表情加入这一组，再点一次移出；${current.startsWith('live:')?'已选的表情显示在「直播场景」里。':'点上面已选的小图也能移出。'}`;
  $('#robot-emo-hint').textContent=hint;
  if(emoticons.length)renderGrid();
}
function renderGrid(){
  const picked=new Set((robot?poolOf(target()):[]).map(e=>e.unique));
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
  const key=form.elements.ai_key.value.trim(),provider=$('#robot-provider').value;
  if(key){await action({action:'set_key',provider,key});form.elements.ai_key.value='';}
  await action({action:'configure',config:readForm()});
  dirty=false;configStamp='';render();toast('机器人设置已保存');
  if(key||!modelList.length&&robot.aiReady){modelsTried=true;loadModels(false);}
}));
// 换服务商：先把服务商存下来（模型先用这家的推荐），再读这家的模型列表。
$('#robot-provider').addEventListener('change',run(async()=>{
  const p=providerInfo($('#robot-provider').value);renderProvider();
  if(p.id==='custom'&&!form.elements['ai.base_url'].value.trim()){$('#robot-models-note').textContent='填好服务地址后点「保存机器人设置」，再刷新模型列表。';return;}
  const model=p.models[0]||form.elements['ai.model'].value;
  await action({action:'configure',config:{ai:{provider:p.id,model,base_url:p.editableBase?form.elements['ai.base_url'].value.trim():''}}});
  modelProvider=p.id;modelList=p.models;freeModels=new Set(p.free_models);setModelOptions(modelList,model);
  if(robot.aiReady){modelsTried=true;await loadModels(false);}
  else $('#robot-models-note').textContent=`填好 ${p.name} 的 API Key 后点「保存机器人设置」，会自动读取模型列表。`;
}));
$('#robot-scenes').addEventListener('input',event=>{
  const field=event.target.closest('[data-scene-field]');if(!field)return;
  const scene=scenesDraft.find(s=>s.id===field.closest('[data-scene]').dataset.scene);if(!scene)return;
  scene[field.dataset.sceneField]=field.type==='number'?Number(field.value):field.value;
  scenesDirty=true;$('#robot-scenes-save').disabled=false;$('#robot-scenes-note').textContent='场景还没保存';
});
$('#robot-scenes').addEventListener('click',run(async event=>{
  const row=event.target.closest('[data-scene]');if(!row)return;
  const id=row.dataset.scene;
  if(event.target.closest('[data-scene-delete]')){scenesDraft=scenesDraft.filter(s=>s.id!==id);scenesDirty=true;scenesStamp='';renderScenes();return;}
  if(event.target.closest('[data-scene-emo]')){$('#robot-emo-target').value='live:'+id;slotStamp='';renderSlots();$('#robot-emo-target').scrollIntoView({block:'center',behavior:'smooth'});return;}
  if(event.target.closest('[data-scene-toggle]')){
    if(robot.active_scene?.id===id){await action({action:'scene_stop'});toast('场景已停止');return;}
    if(scenesDirty)throw new Error('请先保存场景');
    await action({action:'scene_start',id});toast(`「${robot.config.live_scenes.find(s=>s.id===id)?.name}」开始了`);
  }
}));
$('#robot-scene-add').onclick=()=>{scenesDraft.push({id:'s-'+Date.now().toString(36),name:'新场景',lines:'',interval_seconds:40,emoticons:[]});scenesDirty=true;scenesStamp='';renderScenes();};
$('#robot-scenes-save').onclick=run(async()=>{
  // 表情以已保存的为准，避免编辑草稿时覆盖刚配好的表情。
  const scenes=scenesDraft.map(s=>({...s,emoticons:robot.config.live_scenes.find(x=>x.id===s.id)?.emoticons||[]}));
  await action({action:'save_scenes',scenes});scenesDirty=false;scenesDraft=null;scenesStamp='';render();toast('直播场景已保存');
});
$('#robot-cue-random').onclick=run(async()=>{
  if(dirty)throw new Error('请先保存机器人设置');
  const {picked}=await action({action:'cue_random'});
  toast(`随机点到了「${picked}」，结果见发言记录`);
});
$('#robot-models-refresh').onclick=event=>{event.preventDefault();loadModels();};
$('#robot-key-clear').onclick=run(async()=>{const p=providerInfo($('#robot-provider').value);await action({action:'set_key',provider:p.id,key:''});toast(`${p.name} 的 Key 已清除`);});
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
  const had=poolOf(slot).some(x=>x.unique===e.unique);
  await action({action:'toggle_emoticon',slot,emoticon});
  toast(had?`已从「${slotLabel(slot)}」移出「${e.name}」`:`「${slotLabel(slot)}」加入「${e.name}」`);
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
