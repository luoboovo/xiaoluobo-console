import {$,api,toast,escapeHtml} from './console-shared.js';
import {state as consoleState} from './app.js';

const settings=$('#lottery-settings'),titles={wheel:'大转盘',duel:'决斗',scratch:'刮刮乐'},games={},drafts={};
for(const mode of Object.keys(titles))drafts[mode]={dirty:false,config:null,names:''};
let selected='wheel',stamp='',playersStamp='',historyStamp='';
const pending=new Set(),time=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
try{const saved=localStorage.getItem('lottery-game');if(Object.hasOwn(titles,saved))selected=saved;}catch{}
const formConfig=()=>({keyword:settings.elements.keyword.value,match:settings.elements.match.value,duration:Number(settings.elements.duration.value),remove_winner:settings.elements.remove_winner.checked});
function render(next){
  if(next)games[next.game]=next;
  if(next&&next.game!==selected)return;
  const game=games[selected];
  for(const button of document.querySelectorAll('[data-lottery-mode]')){const active=button.dataset.lotteryMode===selected;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.disabled=pending.has(selected);}
  if(!game){
    $('#lottery-source-note').textContent=`正在读取${titles[selected]}独立数据源…`;
    for(const el of document.querySelectorAll('#lottery-settings input,#lottery-settings select,#lottery-settings button,#lottery-add-form textarea,#lottery-add-form button,#lottery-start,#lottery-reset,#lottery-clear,#lottery-enroll'))el.disabled=true;
    return;
  }
  const c=game.config,r=game.round,busy=!!r&&r.status!=='done',waiting=r?.status==='choosing',revealing=r?.status==='revealing',working=pending.has(selected),draft=drafts[selected];
  $('#lottery-source-note').textContent=`${titles[selected]}独立数据源 · 名单、设置、报名和结果分别保存`;
  $('#lottery-duration').hidden=selected==='scratch';
  document.querySelector('label[for=lottery-names]').textContent=selected==='scratch'?'每行填写奖项，可写「奶茶 * 5」或「#A 大奖 * 1」':'每行一项，可填写名字、奖项或任务';
  $('#lottery-names').placeholder=selected==='scratch'?'惊喜大奖 * 1\n奶茶一杯 * 5\n幸运贴纸 * 20':'小萝卜\n好运锦鲤\n今天也开心';
  $('#lottery-export').href='/api/lottery/export?game='+selected;
  $('#lottery-live-status').textContent=busy?(waiting?'等待选签':revealing?'等待撕开':'好戏进行中'):game.enrolling?'● 弹幕报名中':game.players.length?'准备就绪':'等待录入';
  $('#lottery-start').textContent=waiting?'随机抽一张 ↗':revealing?'撕开签卡 ↗':busy?'好运正在揭晓…':{wheel:'转动转盘 ↗',duel:'开始决斗 ↗',scratch:'摆放签卡 ↗'}[selected];
  $('#lottery-start').disabled=working||busy&&!revealing&&!waiting||!busy&&(game.players.length<(selected==='duel'?2:1)||draft.dirty);
  $('#lottery-count').textContent=game.players.length;
  $('#lottery-enroll').textContent=game.enrolling?'停止弹幕报名':'开启弹幕报名';
  $('#lottery-round-note').textContent=waiting?'点选签卡，或随机抽一张；画面中可摇动洗牌':revealing?'向右拖动签面撕开，未撕前可以放回':busy?'本轮数据源已锁定':r?.status==='done'?`本次抽中：${r.players.find(p=>p.id===r.winner_id)?.name}`:game.enrolling?`发送「${c.keyword}」加入${titles[selected]}`:`${game.players.length} 项数据 · 仅用于${titles[selected]}`;
  for(const el of document.querySelectorAll('#lottery-settings input,#lottery-settings select,#lottery-settings button,#lottery-add-form textarea,#lottery-add-form button,#lottery-clear,#lottery-enroll'))el.disabled=busy||working;
  $('#lottery-reset').disabled=working||busy&&!waiting;$('#lottery-reset').textContent=waiting?'取消本轮':'收起结果';
  if(draft.dirty)$('#lottery-enroll').disabled=true;
  const cfg=draft.dirty?draft.config:c,configStamp=JSON.stringify(cfg);
  if(stamp===''||!draft.dirty&&stamp!==configStamp){stamp=configStamp;settings.elements.keyword.value=cfg.keyword;settings.elements.match.value=cfg.match;settings.elements.duration.value=cfg.duration;settings.elements.remove_winner.checked=cfg.remove_winner;}
  const ps=JSON.stringify([selected,game.players,busy,working]);
  if(ps!==playersStamp){playersStamp=ps;$('#lottery-players').innerHTML=game.players.length?game.players.map((p,i)=>`<div class="lottery-player"><span class="lottery-dot dot-${i%6}"></span><span title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span><button data-remove-player="${escapeHtml(p.id)}" aria-label="移除${escapeHtml(p.name)}" ${busy||working?'disabled':''}>×</button></div>`).join(''):'<p class="lottery-empty">当前数据源为空，开启报名或在右侧录入，每行一项。</p>';}
  const hs=JSON.stringify([selected,game.history]);
  if(hs!==historyStamp){historyStamp=hs;$('#lottery-history').innerHTML=game.history.length?game.history.map(h=>`<li><span class="lottery-history-icon">${{wheel:'◉',duel:'⚔',scratch:'✦'}[selected]}</span><div><strong>${escapeHtml(h.winner.name)}</strong><span>${titles[selected]}结果 · ${h.count} 项参与</span></div><time>${time.format(h.time)}</time></li>`).join(''):'<li class="lottery-empty">这个玩法还没有抽取记录。</li>';}
  connectionNote();
}
function connectionNote(){
  const game=games[selected],live=consoleState?.live?.status==='connected';
  $('#lottery-signup-note').textContent=drafts[selected].dirty?'当前玩法设置尚未保存，请先保存再报名或开局。':game?.enrolling&&!live?'报名已开启 · 请在控制台连接直播间':`仅加入${titles[selected]} · 同一账号只报一次 · 最多200项`;
}
async function action(input,mode=selected){
  if(pending.has(mode))return;
  pending.add(mode);render();
  try{const result=await api('/api/lottery/action',{...input,game:mode});render(result.state);return result.state;}
  finally{pending.delete(mode);render();}
}
const run=work=>async event=>{event?.preventDefault();try{await work(event);}catch(error){toast(error.message,true);}};
async function load(mode=selected){render(await api('/api/lottery/state?game='+mode));}
function selectMode(mode){
  drafts[selected].names=$('#lottery-names').value;
  selected=mode;stamp=playersStamp=historyStamp='';$('#lottery-names').value=drafts[mode].names;
  try{localStorage.setItem('lottery-game',mode);}catch{}
  $('#lottery-frame').dataset.src='/lottery/?preview=1&game='+mode;
  if(!$('#lottery-view').hidden)$('#lottery-frame').src=$('#lottery-frame').dataset.src;
  render();load(mode).catch(error=>toast(error.message,true));
}
settings.addEventListener('input',()=>{drafts[selected].dirty=true;drafts[selected].config=formConfig();render();});
settings.addEventListener('submit',run(async()=>{const mode=selected;await action({action:'configure',config:formConfig()},mode);drafts[mode].dirty=false;drafts[mode].config=null;stamp='';render();toast(`${titles[mode]}设置已保存`);}));
for(const button of document.querySelectorAll('[data-lottery-mode]'))button.onclick=()=>{if(button.dataset.lotteryMode!==selected)selectMode(button.dataset.lotteryMode);};
$('#lottery-enroll').onclick=run(()=>action({action:'enroll',open:!games[selected].enrolling}));
$('#lottery-start').onclick=run(()=>action(['choosing','revealing'].includes(games[selected].round?.status)?{action:games[selected].round.status==='choosing'?'pick':'reveal',round_id:games[selected].round.id}:{action:'start'}));
$('#lottery-reset').onclick=run(()=>action({action:'reset'}));
$('#lottery-names').addEventListener('input',()=>{drafts[selected].names=$('#lottery-names').value;});
$('#lottery-add-form').onsubmit=run(async()=>{const mode=selected,before=games[mode].players.length;await action({action:'add',names:$('#lottery-names').value},mode);drafts[mode].names='';if(selected===mode)$('#lottery-names').value='';toast(`${titles[mode]}已加入 ${games[mode].players.length-before} 项${mode==='scratch'?'':'，重复内容自动跳过'}`);});
$('#lottery-players').onclick=run(event=>{const button=event?.target.closest('[data-remove-player]');if(button)return action({action:'remove',id:button.dataset.removePlayer});});
$('#lottery-clear').onclick=()=>{if(!games[selected]?.players.length)return;$('#lottery-clear-title').textContent=`清空${titles[selected]}数据源？`;$('#lottery-clear-dialog').showModal();};
$('#lottery-confirm-clear').onclick=run(async()=>{await action({action:'clear'});$('#lottery-clear-dialog').close();});
$('#lottery-open').onclick=()=>window.open('/lottery/?game='+selected,'_blank');
$('#lottery-copy').onclick=run(async()=>{await navigator.clipboard.writeText(location.origin+'/lottery/?game='+selected+'&capture=1');toast(`${titles[selected]}独立网页地址已复制，直播软件使用 1280 × 720`);});
addEventListener('lottery-state',event=>render(event.detail));
addEventListener('console-state',connectionNote);
addEventListener('view-changed',event=>{if(event.detail==='lottery')load().catch(error=>toast(error.message,true));});
$('#lottery-frame').addEventListener('load',()=>$('#lottery-frame').contentWindow.postMessage({type:'lottery-preview-visibility',visible:!$('#lottery-view').hidden},location.origin));
$('#lottery-frame').dataset.src='/lottery/?preview=1&game='+selected;
load().catch(error=>toast(error.message,true));
