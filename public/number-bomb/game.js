const $=selector=>document.querySelector(selector),stage=$('#bomb-stage'),rows=new Map();
const colors=['#dbe9d2','#e3eacc','#d0e4de','#e9d8cb','#dcd8e9','#e8e0bf'];
let game,clockOffset=0,page=0,gridStamp='',lastGuess='';
function fit(){const scale=Math.min(innerWidth/1280,innerHeight/720);stage.style.transform=`scale(${scale})`;stage.style.left=(innerWidth-1280*scale)/2+'px';stage.style.top=(innerHeight-720*scale)/2+'px';}
addEventListener('resize',fit);fit();
function avatar(player){
  const el=document.createElement('div');el.className='avatar';el.textContent=Array.from(player.name)[0]||'？';
  if(player.face){const img=document.createElement('img');img.alt=player.name+'的头像';img.src='/api/avatar?url='+encodeURIComponent(player.face);img.onerror=()=>img.remove();el.append(img);}
  return el;
}
function showAvatar(holder,player){
  const key=JSON.stringify([player.id,player.face]);
  if(holder.dataset.avatar!==key){holder.replaceChildren(avatar(player));holder.dataset.avatar=key;}
}
function renderPlayers(){
  const ids=new Set(game.players.map(p=>p.id));
  for(const [id,row]of rows)if(!ids.has(id)){row.remove();rows.delete(id);}
  const latest=[null,null];
  game.players.forEach((p,i)=>{
    let row=rows.get(p.id);
    if(!row){
      row=document.createElement('div');row.className='player';row.style.setProperty('--avatar-color',colors[i%colors.length]);
      const portrait=document.createElement('div');portrait.className='portrait';const name=document.createElement('span');name.className='player-name';name.textContent=p.name;name.title=p.name;const position=document.createElement('span');position.className='queue-position';portrait.append(avatar(p),position,name);
      const speech=document.createElement('div');speech.className='speech';speech.hidden=true;speech.append(document.createElement('strong'),document.createElement('small'));
      row.append(portrait,speech);rows.set(p.id,row);row.face=p.face;
    }
    const parent=i%2?$('#players-right'):$('#players-left'),before=parent.children[Math.floor(i/2)];if(before!==row)parent.insertBefore(row,before||null);
    const queued=game.config.guess_mode==='queue',current=queued&&(['running','paused'].includes(game.phase)?game.round.turn_id:game.phase==='enrolling'?game.players[0]?.id:null)===p.id;
    row.classList.toggle('current-turn',current);row.querySelector('.queue-position').hidden=!queued;row.querySelector('.queue-position').textContent=i+1;
    if(current)row.setAttribute('aria-current','step');else row.removeAttribute('aria-current');
    if(row.face!==p.face){row.querySelector('.avatar').replaceWith(avatar(p));row.face=p.face;}
    const m=p.message,speech=row.querySelector('.speech'),fresh=m&&game.phase!=='paused'&&Date.now()+clockOffset-m.time<8000;
    speech.hidden=!fresh;
    if(fresh&&row.sequence!==m.sequence){
      row.sequence=m.sequence;speech.querySelector('strong').textContent=m.text;speech.querySelector('small').textContent={low:'',high:'',hit:'💥',outside:'超出范围',cooldown:'CD 中',turn:'未轮到你',chat:''}[m.kind];speech.className='speech '+m.kind;
      void speech.offsetWidth;speech.classList.add('pop');
      const side=i%2;if(!latest[side]||m.sequence>latest[side].sequence)latest[side]={row,sequence:m.sequence};
    }
  });
  for(const message of latest)if(message){const row=message.row,parent=row.parentElement,top=row.offsetTop-parent.offsetTop;if(top<parent.scrollTop||top+row.offsetHeight>parent.scrollTop+parent.clientHeight)parent.scrollTop=Math.max(0,top-parent.clientHeight/2+row.offsetHeight/2);}
}
function renderGrid(){
  const {config:c,round:r,players}=game,stamp=JSON.stringify([game.platform,c.min,c.max,page]),grid=$('#number-grid');
  if(stamp!==gridStamp){
    gridStamp=stamp;grid.replaceChildren();
    const start=c.min+page*100,end=Math.min(c.max,start+99);
    for(let value=start;value<=end;value++){
      const cell=document.createElement('div');cell.className='number-cell';cell.dataset.number=value;cell.setAttribute('role','listitem');
      const portrait=document.createElement('div');portrait.className='tile-avatar';const number=document.createElement('span');number.textContent=value;cell.append(portrait,number);grid.append(cell);
    }
  }
  const byId=new Map(players.map(p=>[p.id,p])),last=r?.guesses[0],guessedBy=r?.guessed_by||Object.fromEntries((r?.guesses||[]).map(g=>[g.value,g.id]));
  for(const cell of grid.children){
    const value=Number(cell.dataset.number),player=byId.get(guessedBy[value]);
    cell.className='number-cell'+(r&&(value<r.min||value>r.max)?' outside':'')+(player?' guessed':'')+(last?.value===value?' latest':'')+(game.phase==='exploded'&&value===r.secret?' hit':'')+(value>9999?' wide':'');
    if(player)showAvatar(cell.querySelector('.tile-avatar'),player);
    cell.setAttribute('aria-label',value+(player?'，'+player.name+'猜过':r&&(value<r.min||value>r.max)?'，已排除':'，可猜'));
  }
  $('#grid-pages').hidden=c.max-c.min<100;$('#grid-previous').disabled=page===0;$('#grid-next').disabled=c.min+(page+1)*100>c.max;
}
function update(next){
  const changed=game&&(game.platform!==next.platform||game.config.min!==next.config.min||game.config.max!==next.config.max);
  if(changed){for(const row of rows.values())row.remove();rows.clear();page=0;lastGuess='';}
  const last=next.round?.guesses[0],key=last?JSON.stringify([last.time,last.value]):'';
  if(key!==lastGuess){page=last?Math.floor((last.value-next.config.min)/100):0;lastGuess=key;}
  game=next;clockOffset=next.now-Date.now();stage.className=next.phase;
  const done=next.phase==='exploded';$('#explosion').hidden=!done;
  if(done){const loser=next.players.find(p=>p.id===next.round.loser_id);showAvatar($('#loser-avatar'),loser);$('#loser-name').textContent=loser.name;$('#secret-number').textContent=next.round.secret;}
  $('#bomb-announcement').textContent=done?`${$('#loser-name').textContent}踩中${next.round.secret}`:next.phase==='enrolling'?'等待开始':next.phase==='paused'?'已暂停':`可猜范围${next.round.min}到${next.round.max}`;
  if(next.config.guess_mode==='queue'&&next.phase==='running')$('#bomb-announcement').textContent+='，轮到'+next.players.find(p=>p.id===next.round.turn_id)?.name;
  renderGrid();renderPlayers();
}
$('#grid-previous').onclick=()=>{if(page>0){page--;renderGrid();}};
$('#grid-next').onclick=()=>{if(game.config.min+(page+1)*100<=game.config.max){page++;renderGrid();}};
const source=new LuoboEvents('/api/events?bomb=1');
source.addEventListener('number-bomb',event=>update(JSON.parse(event.data)));
source.onopen=()=>$('#bomb-connection').hidden=true;
source.onerror=()=>{$('#bomb-connection').textContent='连接中断，正在重连…';$('#bomb-connection').hidden=false;};
setInterval(()=>{if(game&&!document.hidden)renderPlayers();},1000);
