import {$,api,toast,escapeHtml} from './console-shared.js';
import {state as consoleState} from './app.js';

const form=$('#bomb-settings'),order=$('#bomb-order');
let game,pending=false,dirty=false,stamp='',historyStamp='',orderStamp='',draggedId=null;
function connectionNote(){
  $('#bomb-live-note').textContent=dirty?'设置未保存':consoleState?.live?.status==='connected'?'':'请先连接直播间';
}
function render(next){
  if(next)game=next;if(!game)return;
  const s=game,enrolling=s.phase==='enrolling';
  $('#bomb-status').textContent={enrolling:'弹幕报名中',running:'正在接收数字',paused:'游戏已暂停',exploded:'本轮已结束'}[s.phase];
  const current=s.config.guess_mode==='queue'&&s.phase==='running'?s.players.find(p=>p.id===s.round.turn_id):null;
  if(current)$('#bomb-status').textContent='轮到 '+current.name;
  $('#bomb-start').textContent=s.phase==='paused'?'继续游戏':'开始游戏';
  $('#bomb-start').disabled=pending||dirty||!['enrolling','paused'].includes(s.phase)||!s.players.length;
  $('#bomb-pause').hidden=s.phase!=='running';$('#bomb-pause').disabled=pending;
  $('#bomb-reset').disabled=pending;
  for(const el of form.elements)el.disabled=pending||!enrolling;
  $('#bomb-count').textContent=s.players.length;
  const configStamp=JSON.stringify(s.config);
  if(!dirty&&stamp!==configStamp){stamp=configStamp;for(const key of ['keyword','min','max','user_cooldown_seconds','guess_mode'])form.elements[key].value=s.config[key]??(key==='guess_mode'?'free':'');}
  const hs=JSON.stringify(s.round?.guesses||[]);
  if(hs!==historyStamp){
    historyStamp=hs;$('#bomb-history').innerHTML=s.round?.guesses.length?s.round.guesses.map(g=>`<li><span class="bomb-guess-value ${g.kind}">${g.value}</span><div><strong>${escapeHtml(g.name)}</strong><span>${{low:'小了 ↑',high:'大了 ↓',hit:'💥 踩中炸弹'}[g.kind]}</span></div><span class="bomb-guess-range">${g.kind==='hit'?'本轮结束':`${g.min} — ${g.max}`}</span></li>`).join(''):'<li class="lottery-empty">暂无记录</li>';
  }
  connectionNote();
  renderOrder();
}
function renderOrder(){
  const queued=game.config.guess_mode==='queue';$('#bomb-queue').hidden=!queued;
  if(!queued||draggedId)return;
  const current=game.phase==='enrolling'?game.players[0]?.id:['running','paused'].includes(game.phase)?game.round.turn_id:null;
  const locked=pending||game.phase==='exploded',nextStamp=JSON.stringify([game.players.map(p=>[p.id,p.name,p.face]),current,locked]);
  if(nextStamp===orderStamp)return;orderStamp=nextStamp;
  order.innerHTML=game.players.length?game.players.map((p,i)=>`<li data-player-id="${escapeHtml(p.id)}" draggable="${!locked}" class="${p.id===current?'current-turn':''}" ${p.id===current?'aria-current="step"':''}><span class="bomb-drag-handle" aria-hidden="true">⠿</span><span class="bomb-order-number">${i+1}</span><span class="bomb-order-avatar">${p.face?`<img src="/api/avatar?url=${encodeURIComponent(p.face)}" alt="" draggable="false" loading="lazy">`:escapeHtml(Array.from(p.name)[0])}</span><span class="bomb-order-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span><span class="bomb-order-moves"><button data-move-bomb="-1" aria-label="上移${escapeHtml(p.name)}" ${locked||i===0?'disabled':''}>↑</button><button data-move-bomb="1" aria-label="下移${escapeHtml(p.name)}" ${locked||i===game.players.length-1?'disabled':''}>↓</button></span></li>`).join(''):'<li class="lottery-empty">暂无玩家</li>';
}
async function action(input){
  if(pending)return;
  pending=true;render();
  try{const result=await api('/api/number-bomb/action',input);render(result.state);return result.state;}
  finally{pending=false;render();}
}
const run=work=>async event=>{event?.preventDefault();try{await work(event);}catch(error){toast(error.message,true);}};
form.addEventListener('input',()=>{dirty=true;render();});
form.addEventListener('submit',run(async()=>{
  await action({action:'configure',config:{keyword:form.elements.keyword.value,min:Number(form.elements.min.value),max:Number(form.elements.max.value),user_cooldown_seconds:Number(form.elements.user_cooldown_seconds.value),guess_mode:form.elements.guess_mode.value}});
  dirty=false;stamp='';render();toast('数字炸弹设置已保存');
}));
async function movePlayer(id,to){
  const ids=game.players.map(p=>p.id),from=ids.indexOf(id);
  if(pending||from<0||to<0||to>=ids.length||from===to)return;
  ids.splice(from,1);ids.splice(to,0,id);await action({action:'reorder',ids});
}
order.onclick=run(event=>{const button=event.target.closest('[data-move-bomb]');if(button&&!button.disabled){const id=button.closest('[data-player-id]').dataset.playerId;return movePlayer(id,game.players.findIndex(p=>p.id===id)+Number(button.dataset.moveBomb));}});
order.ondragstart=event=>{
  const row=event.target.closest('[data-player-id]');
  if(!row||pending||game.phase==='exploded'){event.preventDefault();return;}
  draggedId=row.dataset.playerId;event.dataTransfer.setData('text/plain',draggedId);event.dataTransfer.effectAllowed='move';row.classList.add('dragging');
};
order.ondragover=event=>{const row=event.target.closest('[data-player-id]');if(!draggedId||!row)return;event.preventDefault();event.dataTransfer.dropEffect='move';order.querySelector('.drop-target')?.classList.remove('drop-target');row.classList.add('drop-target');};
order.ondrop=run(async event=>{const id=draggedId,row=event.target.closest('[data-player-id]');draggedId=null;if(id&&row)await movePlayer(id,game.players.findIndex(p=>p.id===row.dataset.playerId));orderStamp='';render();});
order.ondragend=()=>{draggedId=null;orderStamp='';render();};
$('#bomb-start').onclick=run(()=>action({action:game.phase==='paused'?'resume':'start'}));
$('#bomb-pause').onclick=run(()=>action({action:'pause'}));
$('#bomb-reset').onclick=()=>$('#bomb-reset-dialog').showModal();
$('#bomb-confirm-reset').onclick=run(async()=>{await action({action:'reset'});dirty=false;stamp='';render();$('#bomb-reset-dialog').close();});
$('#bomb-open').onclick=()=>window.open('/number-bomb/','_blank');
$('#bomb-copy').onclick=run(async()=>{await navigator.clipboard.writeText(location.origin+'/number-bomb/');toast('数字炸弹画面地址已复制，直播软件使用 1280 × 720');});
addEventListener('number-bomb-state',event=>render(event.detail));
addEventListener('console-state',connectionNote);
async function load(){render(await api('/api/number-bomb/state'));}
addEventListener('view-changed',event=>{if(event.detail==='number-bomb')load().catch(error=>toast(error.message,true));});
load().catch(error=>toast(error.message,true));
