import {$,api,toast,escapeHtml,giftById,image} from './console-shared.js';
import {switchView,state as consoleState} from './app.js';

const settings=$('#mower-settings'),rulesForm=$('#mower-rules-form'),ruleList=$('#mower-rules');
const NUMBERS=['hero_hp','hero_size','hero_speed','monster_growth_percent','level_speed_percent','likes_per_monster','blade_count','blade_damage','blade_radius','blade_speed','auto_spawn_per_second','pickup_interval_seconds','boss_damage','chat_spawn_count','chat_heal_value','user_cooldown_seconds'];
const TEXTS=['control_mode','hero_name','chat_spawn_keyword','chat_heal_keyword','chat_match_mode'];
const VALUE_LABEL={boss:'BOSS血量/个',monster:'怪物等级 1～8',hurt:'扣血/个',disarm:'缴械秒/个',swarm:'小怪数/个',heal:'回血/个',blade:'加刀/个',weapon:'',nuke:''};
let heroImage='',game,pending=false,settingsDirty=false,rulesDirty=false,settingsStamp='',rulesStamp='',duelsStamp='',picking=null;
const note=document.createElement('div');note.className='feeding-pick-note';note.hidden=true;note.innerHTML='正在为萝卜割草选择礼物。<button class="text-button" data-view="mower">返回萝卜割草</button>';$('#gifts-view').prepend(note);

function liveNote(){$('#mower-live-note').textContent=settingsDirty?'设置未保存':consoleState?.live?.status==='connected'?'':'请先连接直播间，并打开上面的总开关';}
function render(next){
  if(next)game=next;if(!game)return;
  const s=game,c=s.config;
  $('#mower-status').textContent={idle:'等待开始',running:'游戏中',paused:'已暂停'}[s.mode]+(s.mode==='running'?' · 礼物和弹幕实时生效':'');
  $('#mower-start').textContent=s.mode==='paused'?'继续游戏':'开始游戏';$('#mower-start').hidden=s.mode==='running';$('#mower-start').disabled=pending;
  $('#mower-pause').hidden=s.mode!=='running';$('#mower-pause').disabled=pending;$('#mower-reset').disabled=pending;
  const ss=JSON.stringify(c);
  if(!settingsDirty&&settingsStamp!==ss){settingsStamp=ss;for(const key of [...NUMBERS,...TEXTS])settings.elements[key].value=c[key];settings.elements.auto_spawn.checked=c.auto_spawn;settings.elements.pickups.checked=c.pickups;settings.elements.like_spawn.checked=c.like_spawn;heroImage=c.hero_image;heroPreview();levelSpeedText();}
  const rs=JSON.stringify(c.gift_rules);
  if(!rulesDirty&&rulesStamp!==rs){rulesStamp=rs;ruleList.replaceChildren();for(const rule of c.gift_rules)addRule(rule);}
  $('#mower-rule-count').textContent=ruleList.children.length;
  $('#mower-wins').textContent=s.stats.bosses_defeated;$('#mower-losses').textContent=s.stats.hero_downs;
  const ds=JSON.stringify(s.duels);
  if(ds!==duelsStamp){duelsStamp=ds;$('#mower-duels').innerHTML=s.duels.length?s.duels.map(d=>`<li><span class="mower-duel-avatar">${d.face?`<img src="/api/avatar?url=${encodeURIComponent(d.face)}" alt="" loading="lazy">`:escapeHtml(Array.from(d.user)[0]||'？')}</span><div><strong>${escapeHtml(d.user)}</strong><span>${escapeHtml(d.gift)} ×${d.count} · 血量 ${Number(d.hp).toLocaleString()}</span></div><span class="mower-duel-result ${d.result}">${d.result==='win'?'被割了':'击倒主角'}</span></li>`).join(''):'<li class="lottery-empty">还没有决斗</li>';}
  liveNote();
}
function binding(row){const gift=giftById.get(Number(row.dataset.giftId)),button=row.querySelector('.mower-gift');button.innerHTML=(gift?.icon?`<img loading="lazy" src="${image(gift)}" alt="">`:'')+`<span class="gift-binding-name">${escapeHtml(row.dataset.giftName||'选择礼物')}</span>`;}
function addRule(rule={gift_id:0,gift_name:'',effect:'boss',value:1500}){
  const effects=game?.effects||{boss:'召唤头像BOSS'};
  const row=document.createElement('div');row.className='mower-rule';row.dataset.giftId=rule.gift_id||0;row.dataset.giftName=rule.gift_name||'';
  row.innerHTML=`<button type="button" class="gift-binding mower-gift"></button><select aria-label="礼物作用">${Object.entries(effects).map(([key,name])=>`<option value="${key}"${key===rule.effect?' selected':''}>${name}</option>`).join('')}</select><input type="number" min="1" step="1" value="${Number(rule.value)||1}" required><button type="button" class="text-button mower-test-rule">试送</button><button type="button" class="text-button mower-remove" aria-label="删除这条规则">删除</button>`;
  ruleList.append(row);binding(row);
  const sync=()=>{const effect=row.querySelector('select').value,input=row.querySelector('input');input.disabled=effect==='nuke'||effect==='weapon';input.title=VALUE_LABEL[effect];input.setAttribute('aria-label',VALUE_LABEL[effect]||'数值');input.max={boss:1000000,monster:8,swarm:200,heal:100000,hurt:100000,disarm:60,blade:12,nuke:1}[effect]??1;};
  row.querySelector('select').addEventListener('change',()=>{const effect=row.querySelector('select').value;row.querySelector('input').value={boss:1500,monster:3,swarm:12,heal:100,hurt:100,disarm:5,blade:1,weapon:1,nuke:1}[effect];sync();});sync();
  $('#mower-rule-count').textContent=ruleList.children.length;
}
function readRule(row){const effect=row.querySelector('select').value;return {gift_id:Number(row.dataset.giftId),gift_name:row.dataset.giftName,effect,value:effect==='nuke'||effect==='weapon'?1:Number(row.querySelector('input').value)};}
async function action(input){
  if(pending)return;pending=true;render();
  try{const result=await api('/api/mower/action',input);render(result.state);return result.state;}
  finally{pending=false;render();}
}
const run=work=>async event=>{event?.preventDefault();try{await work(event);}catch(error){toast(error.message,true);}};
const levelSpeedText=()=>{$('#mower-level-speed-value').textContent=settings.elements.level_speed_percent.value+'%';};
settings.addEventListener('input',event=>{if(event.target.name==='level_speed_percent')levelSpeedText();if(event.target.id==='mower-hero-file')return;settingsDirty=true;liveNote();});
function heroPreview(){const img=$('#mower-hero-preview img');img.hidden=!heroImage;if(heroImage)img.src=heroImage;else img.removeAttribute('src');$('#mower-hero-preview').classList.toggle('empty',!heroImage);$('#mower-hero-default').hidden=!heroImage;}
$('#mower-hero-file').addEventListener('change',run(async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  if(!/^image\/(png|gif|webp|jpeg)$/.test(file.type))throw new Error('请选择 PNG、GIF、WebP 或 JPG 图片');
  const response=await fetch('/api/feeding/assets',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Luobo-Platform':consoleState?.config?.platform||'bilibili'},body:file});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'上传失败');
  heroImage=result.url;heroPreview();settingsDirty=true;liveNote();toast('主角图片已上传，点「保存设置」生效');
}));
$('#mower-hero-default').onclick=()=>{heroImage='';heroPreview();settingsDirty=true;liveNote();};
settings.addEventListener('submit',run(async()=>{
  const config={auto_spawn:settings.elements.auto_spawn.checked,pickups:settings.elements.pickups.checked,like_spawn:settings.elements.like_spawn.checked,hero_image:heroImage};
  for(const key of NUMBERS)config[key]=Number(settings.elements[key].value);
  for(const key of TEXTS)config[key]=settings.elements[key].value;
  await action({action:'configure',config});settingsDirty=false;settingsStamp='';render();toast('割草设置已保存');
}));
rulesForm.addEventListener('input',event=>{if(!event.target.closest('.mower-test'))rulesDirty=true;});
rulesForm.addEventListener('change',event=>{if(event.target.closest('.mower-rule'))rulesDirty=true;});
rulesForm.addEventListener('submit',run(async()=>{
  const rules=Array.from(ruleList.children,readRule);
  if(rules.some(r=>!r.gift_name))throw new Error('有规则还没选礼物');
  await action({action:'configure',config:{gift_rules:rules}});rulesDirty=false;rulesStamp='';render();toast('礼物规则已保存');
}));
$('#mower-add-rule').onclick=()=>{if(ruleList.children.length>=50)return toast('礼物规则最多50条',true);addRule();rulesDirty=true;};
ruleList.addEventListener('click',run(async event=>{
  const row=event.target.closest('.mower-rule');if(!row)return;
  if(event.target.closest('.mower-gift')){picking=row;note.hidden=false;switchView('gifts');return;}
  if(event.target.closest('.mower-remove')){row.remove();rulesDirty=true;$('#mower-rule-count').textContent=ruleList.children.length;return;}
  if(event.target.closest('.mower-test-rule')){
    if(rulesDirty)throw new Error('请先保存礼物规则，再试送');
    await action({action:'simulate',rule:readRule(row),user:$('#mower-test-user').value,count:Number($('#mower-test-count').value)});toast('试送成功，看看画面');
  }
}));
window.addEventListener('gift-picked',event=>{if(!picking||note.hidden)return;event.preventDefault();picking.dataset.giftId=event.detail.id;picking.dataset.giftName=event.detail.name;binding(picking);picking=null;note.hidden=true;rulesDirty=true;switchView('mower');});
window.addEventListener('view-changed',event=>{if(event.detail!=='gifts'){note.hidden=true;picking=null;}});
$('#mower-start').onclick=run(()=>action({action:'start'}));
$('#mower-pause').onclick=run(()=>action({action:'pause'}));
$('#mower-reset').onclick=run(()=>action({action:'reset'}));
$('#mower-clear-history').onclick=run(()=>action({action:'clear_history'}));
$('#mower-open').onclick=()=>window.open('/mower/?play=1','_blank');
$('#mower-copy').onclick=run(async()=>{await navigator.clipboard.writeText(location.origin+'/mower/');toast('萝卜割草画面地址已复制：放进 OBS 浏览器源（1280 × 720），会实时显示操作窗口里的这一局');});
window.addEventListener('before-generate-panel',event=>{if(event.detail==='mower'&&rulesDirty){event.preventDefault();toast('请先保存礼物规则，再生成面板',true);}});
addEventListener('mower-state',event=>render(event.detail));
addEventListener('console-state',liveNote);
async function load(){render(await api('/api/mower/state'));}
addEventListener('view-changed',event=>{if(event.detail==='mower')load().catch(error=>toast(error.message,true));});
load().catch(error=>toast(error.message,true));
