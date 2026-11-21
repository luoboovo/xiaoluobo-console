import {$,api,toast,escapeHtml,giftById,image} from './console-shared.js';
import {switchView,state as consoleState} from './app.js';

// 泽小酱闯关的控制台页面：开始/暂停/重开、弹幕口令、礼物规则（试送）、战绩。
const settings=$('#battle-settings'),rulesForm=$('#battle-rules-form'),ruleList=$('#battle-rules');
const TEXTS=['chat_left_keyword','chat_right_keyword','chat_match_mode'],NUMBERS=['user_cooldown_seconds'];
const SKILLS=new Set(['giant','whip','spray']);
let effectsStamp='',game,pending=false,settingsDirty=false,rulesDirty=false,settingsStamp='',rulesStamp='',historyStamp='',picking=null;
const note=document.createElement('div');note.className='feeding-pick-note';note.hidden=true;note.innerHTML='正在为泽小酱闯关选择礼物。<button class="text-button" data-view="battle">返回泽小酱闯关</button>';$('#gifts-view').prepend(note);

function liveNote(){$('#battle-live-note').textContent=settingsDirty?'设置未保存':consoleState?.live?.status==='connected'?'':'请先连接直播间，并打开上面的总开关';}
function render(next){
  if(next)game=next;if(!game)return;
  const s=game,c=s.config;
  $('#battle-status').textContent={idle:'等待开始',running:'游戏中',paused:'已暂停'}[s.mode]+(s.mode==='running'?' · 弹幕和礼物实时生效':'');
  $('#battle-start').textContent=s.mode==='paused'?'继续游戏':'开始游戏';$('#battle-start').hidden=s.mode==='running';$('#battle-start').disabled=pending;
  $('#battle-pause').hidden=s.mode!=='running';$('#battle-pause').disabled=pending;$('#battle-reset').disabled=pending;
  const ss=JSON.stringify(c);
  if(!settingsDirty&&settingsStamp!==ss){settingsStamp=ss;for(const key of [...TEXTS,...NUMBERS])settings.elements[key].value=c[key];renderNames(c.names,s.nameDefaults);}
  const rs=JSON.stringify(c.gift_rules);
  // 名字改了，礼物规则下拉框里的文字也要跟着换
  const es=JSON.stringify(s.effects);
  if(!rulesDirty&&(rulesStamp!==rs||effectsStamp!==es)){rulesStamp=rs;effectsStamp=es;ruleList.replaceChildren();for(const rule of c.gift_rules)addRule(rule);}
  $('#battle-rule-count').textContent=ruleList.children.length;
  $('#battle-wins').textContent=s.stats.wins;$('#battle-losses').textContent=s.stats.losses;
  const hs=JSON.stringify(s.history);
  if(hs!==historyStamp){historyStamp=hs;$('#battle-history').innerHTML=s.history.length?s.history.map(h=>`<li><div><strong>${h.result==='win'?'泽小酱通关':'鱼僵军守住了'}</strong><span>${h.mvp.length?'MVP：'+h.mvp.map(v=>`${escapeHtml(v.name)}（${v.dmg}）`).join('、'):'没有 MVP'} · ${new Date(h.time).toLocaleTimeString()}</span></div></li>`).join(''):'<li class="lottery-empty">还没有战绩</li>';}
  liveNote();
}
// 兵种名字：左边泽小酱阵营 8 个，右边鱼僵军阵营 2 个兵 + 2 个技能
const NAME_GROUPS=[['泽小酱军团',['clown','web','venom','blue','spear','gourd','white','giant']],['鱼僵军阵营',['thug','guard','whip','spray']]];
function renderNames(names,defaults={}){
  $('#battle-names').innerHTML=NAME_GROUPS.map(([title,keys])=>`<p class="battle-names-group">${title}</p><div class="battle-names-grid">${keys.map(key=>`<label>${escapeHtml(defaults[key]||key)}<input name="name_${key}" maxlength="8" value="${escapeHtml(names?.[key]||'')}" placeholder="${escapeHtml(defaults[key]||'')}" autocomplete="off"></label>`).join('')}</div>`).join('');
}
function binding(row){const gift=giftById.get(Number(row.dataset.giftId)),button=row.querySelector('.mower-gift');button.innerHTML=(gift?.icon?`<img loading="lazy" src="${image(gift)}" alt="">`:'')+`<span class="gift-binding-name">${escapeHtml(row.dataset.giftName||'选择礼物')}</span>`;}
function addRule(rule={gift_id:0,gift_name:'',effect:'web',value:1}){
  const effects=game?.effects||{web:'召唤蛛网侠'};
  const row=document.createElement('div');row.className='mower-rule';row.dataset.giftId=rule.gift_id||0;row.dataset.giftName=rule.gift_name||'';
  row.innerHTML=`<button type="button" class="gift-binding mower-gift"></button><select aria-label="礼物作用">${Object.entries(effects).map(([key,name])=>`<option value="${key}"${key===rule.effect?' selected':''}>${name}</option>`).join('')}</select><input type="number" min="1" max="10" step="1" value="${Number(rule.value)||1}" required aria-label="每个礼物召唤几个"><button type="button" class="text-button mower-test-rule">试送</button><button type="button" class="text-button mower-remove" aria-label="删除这条规则">删除</button>`;
  ruleList.append(row);binding(row);
  const sync=()=>{const input=row.querySelector('input'),skill=SKILLS.has(row.querySelector('select').value);input.disabled=skill;input.title=skill?'技能每个礼物放一次':'每个礼物召唤几个';if(skill)input.value=1;};
  row.querySelector('select').addEventListener('change',sync);sync();
  $('#battle-rule-count').textContent=ruleList.children.length;
}
function readRule(row){const effect=row.querySelector('select').value;return {gift_id:Number(row.dataset.giftId),gift_name:row.dataset.giftName,effect,value:SKILLS.has(effect)?1:Number(row.querySelector('input').value)};}
async function action(input){
  if(pending)return;pending=true;render();
  try{const result=await api('/api/battle/action',input);render(result.state);return result.state;}
  finally{pending=false;render();}
}
const run=work=>async event=>{event?.preventDefault();try{await work(event);}catch(error){toast(error.message,true);}};
settings.addEventListener('input',()=>{settingsDirty=true;liveNote();});
settings.addEventListener('submit',run(async()=>{
  const config={};
  for(const key of TEXTS)config[key]=settings.elements[key].value;
  for(const key of NUMBERS)config[key]=Number(settings.elements[key].value);
  config.names=Object.fromEntries([...settings.querySelectorAll('[name^="name_"]')].map(input=>[input.name.slice(5),input.value.trim()]));
  await action({action:'configure',config});settingsDirty=false;settingsStamp='';render();toast('闯关设置已保存');
}));
rulesForm.addEventListener('input',event=>{if(!event.target.closest('.mower-test'))rulesDirty=true;});
rulesForm.addEventListener('change',event=>{if(event.target.closest('.mower-rule'))rulesDirty=true;});
rulesForm.addEventListener('submit',run(async()=>{
  const rules=Array.from(ruleList.children,readRule);
  if(rules.some(r=>!r.gift_name))throw new Error('有规则还没选礼物');
  await action({action:'configure',config:{gift_rules:rules}});rulesDirty=false;rulesStamp='';render();toast('礼物规则已保存');
}));
$('#battle-add-rule').onclick=()=>{if(ruleList.children.length>=50)return toast('礼物规则最多50条',true);addRule();rulesDirty=true;};
ruleList.addEventListener('click',run(async event=>{
  const row=event.target.closest('.mower-rule');if(!row)return;
  if(event.target.closest('.mower-gift')){picking=row;note.hidden=false;switchView('gifts');return;}
  if(event.target.closest('.mower-remove')){row.remove();rulesDirty=true;$('#battle-rule-count').textContent=ruleList.children.length;return;}
  if(event.target.closest('.mower-test-rule')){
    if(rulesDirty)throw new Error('请先保存礼物规则，再试送');
    await action({action:'simulate',rule:readRule(row),user:$('#battle-test-user').value,count:Number($('#battle-test-count').value)});toast('试送成功，看看画面');
  }
}));
const testJoin=side=>run(async()=>{await action({action:'simulate',join:side,user:$('#battle-test-user').value+Math.floor(Math.random()*1000)});toast('已模拟一条弹幕');});
$('#battle-test-left').onclick=testJoin('L');
$('#battle-test-right').onclick=testJoin('R');
window.addEventListener('gift-picked',event=>{if(!picking||note.hidden)return;event.preventDefault();picking.dataset.giftId=event.detail.id;picking.dataset.giftName=event.detail.name;binding(picking);picking=null;note.hidden=true;rulesDirty=true;switchView('battle');});
window.addEventListener('view-changed',event=>{if(event.detail!=='gifts'){note.hidden=true;picking=null;}});
$('#battle-start').onclick=run(()=>action({action:'start'}));
$('#battle-pause').onclick=run(()=>action({action:'pause'}));
$('#battle-reset').onclick=run(()=>action({action:'reset'}));
$('#battle-clear-history').onclick=run(()=>action({action:'clear_history'}));
$('#battle-open').onclick=()=>window.open('/battle/','_blank');
$('#battle-copy').onclick=run(async()=>{await navigator.clipboard.writeText(location.origin+'/battle/');toast('泽小酱闯关画面地址已复制：放进 OBS 浏览器源（1440 × 1080，4:3）');});
window.addEventListener('before-generate-panel',event=>{if(event.detail==='battle'&&rulesDirty){event.preventDefault();toast('请先保存礼物规则，再生成面板',true);}});
addEventListener('battle-state',event=>render(event.detail));
addEventListener('console-state',liveNote);
async function load(){render(await api('/api/battle/state'));}
addEventListener('view-changed',event=>{if(event.detail==='battle')load().catch(error=>toast(error.message,true));});
load().catch(error=>toast(error.message,true));
