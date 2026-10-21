const canvas=document.getElementById('lottery-canvas'),ctx=canvas.getContext('2d');
const params=new URLSearchParams(location.search),preview=params.has('preview'),capture=params.has('capture');
const gameMode=['wheel','duel','scratch'].includes(params.get('game'))?params.get('game'):'wheel';
const gameTitle={wheel:'大转盘',duel:'决斗',scratch:'刮刮乐'}[gameMode];
document.title=gameTitle+' · 小萝卜';
document.body.classList.toggle('capture',capture);
const colors=['#df614f','#64af80','#579ede','#f0c64e','#a675c4','#eb9957','#73bfc3','#dc85a7'];
const ink='#74594f',cream='#fffaf0',tau=Math.PI*2;
const demo=['好运将至','开心加倍','幸运时刻','心想事成','锦鲤附体','好事发生'];
let state,clockOffset=0,active=!preview,raf=0,lastPaint=0,settledPaint=false;
const avatars=new Map();
const connection=document.getElementById('lottery-connection');
const pile=new TicketPile(ctx),ticketDialog=document.getElementById('scratch-dialog');
let scratchBusy=false,dragging=false,dragStart=0,localPeel=0,dragRound='',peelSending=false,peelWanted=null,selection=null,pendingPick=null;
const byId=id=>document.getElementById(id);
async function scratchAction(input){
  if(capture)return;
  const response=await fetch('/api/lottery/action',{method:'POST',headers:{'Content-Type':'application/json','X-Luobo-Platform':state.platform},body:JSON.stringify({...input,game:gameMode})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'签卡操作失败');
  update(result.state);connection.hidden=true;return result.state;
}
async function choose(input){
  if(scratchBusy||capture||!state)return;
  if(input.action==='pick'&&Number.isInteger(input.card)){
    pendingPick={card:input.card,platform:state.platform};
    selection={card:input.card,round:state.round?.id,at:performance.now()};wake();
  }
  scratchBusy=true;renderScratchControls();
  try{
    if(['pick','shake'].includes(input.action)&&(!state.round||state.round.status==='done'))await scratchAction({action:'start'});
    await scratchAction({...input,round_id:state.round?.id});
  }catch(error){connection.textContent=error.message;connection.hidden=false;}
  finally{pendingPick=null;scratchBusy=false;renderScratchControls();wake();}
}
function renderScratchControls(){
  if(gameMode!=='scratch')return;
  const r=state?.round,selected=pendingPick||r&&['revealing','tearing','done'].includes(r.status);
  byId('scratch-controls').hidden=capture;
  byId('scratch-result').hidden=!selected;
  for(const el of document.querySelectorAll('.draw-controls button,#scratch-reset,.top-controls button'))el.hidden=!!selected;
  for(const el of document.querySelectorAll('#scratch-controls button'))el.disabled=scratchBusy;
  byId('scratch-draw').disabled=byId('scratch-shake').disabled=scratchBusy||!state?.players.length;
  byId('scratch-cancel').hidden=r?.status==='done';
  byId('scratch-cancel').disabled=scratchBusy||r?.status==='tearing'||(r?.peel||0)>0||localPeel>0;
  byId('scratch-open').textContent=r?.status==='done'?'确认':r?.status==='tearing'?'正在撕开…':'撕开';
  byId('scratch-open').disabled=scratchBusy||r?.status==='tearing';
  byId('scratch-accessible').hidden=!!selected||!state?.players.length;
  byId('scratch-card').max=state?.players.length||1;
}
byId('scratch-draw').onclick=()=>choose({action:'pick'});
byId('scratch-shake').onclick=()=>choose({action:'shake'});
byId('scratch-reset').onclick=()=>choose({action:'shake'});
byId('scratch-select').onclick=()=>choose({action:'pick',card:Number(byId('scratch-card').value)-1});
byId('scratch-cancel').onclick=()=>choose({action:'cancel'});
byId('scratch-open').onclick=()=>choose({action:state.round.status==='done'?'reset':'reveal'});
function ticketTab(tab){
  for(const el of document.querySelectorAll('[data-ticket-tab]'))el.classList.toggle('active',el.dataset.ticketTab===tab);
  byId('scratch-form').hidden=tab!=='edit';byId('scratch-items').hidden=tab!=='list';byId('scratch-history').hidden=tab!=='history';
}
function ticketSettings(tab){
  if(!state||scratchBusy)return;
  const groups=new Map();
  for(const p of state.players){const key=(p.level||'')+'\0'+p.name;if(!groups.has(key))groups.set(key,{...p,count:0});groups.get(key).count++;}
  byId('scratch-names').value=[...groups.values()].map(p=>(p.level?'#'+p.level+' ':'')+p.name+' * '+p.count).join('\n');
  byId('scratch-remove').checked=state.config.remove_winner;
  for(const [id,rows] of [['scratch-items',[...groups.values()]],['scratch-history',state.history]]){
    const box=byId(id);box.replaceChildren();
    for(const p of rows){const row=document.createElement('div');row.className='ticket-row';const name=document.createElement('strong'),note=document.createElement('span');
      const item=p.winner||p;name.textContent=(item.level?item.level+' 奖 · ':'')+item.name;note.textContent=p.winner?new Date(p.time).toLocaleTimeString('zh-CN'):'× '+p.count;
      row.append(name,note);box.append(row);
    }
    if(!rows.length){const empty=document.createElement('p');empty.textContent=id==='scratch-history'?'还没有抽取记录':'签卡已空，去奖项设定里添加吧';box.append(empty);}
  }
  byId('scratch-dialog-error').textContent='';ticketTab(tab);ticketDialog.showModal();
}
byId('scratch-settings').onclick=()=>ticketSettings('edit');byId('scratch-list').onclick=()=>ticketSettings('list');
byId('scratch-help').onclick=()=>{connection.textContent='点击一张签卡，或按「抽奖」随机选取；从左向右拖动签面撕开，也可按「撕开」。没撕开前可以放回。「摇动」重新洗牌。';connection.hidden=false;};
byId('scratch-close').onclick=()=>ticketDialog.close();
for(const el of document.querySelectorAll('[data-ticket-tab]'))el.onclick=()=>ticketTab(el.dataset.ticketTab);
byId('scratch-form').onsubmit=async event=>{
  event.preventDefault();if(scratchBusy)return;scratchBusy=true;
  const button=event.submitter;button.disabled=true;
  try{await scratchAction({action:'replace',names:byId('scratch-names').value.trim(),remove_winner:byId('scratch-remove').checked});if(state.players.length)await scratchAction({action:'start'});ticketDialog.close();}
  catch(error){byId('scratch-dialog-error').textContent=error.message;}
  finally{scratchBusy=false;button.disabled=false;renderScratchControls();}
};
function scratch(players){
  const r=state.round,confirmed=r&&['revealing','tearing','done'].includes(r.status),selected=confirmed||pendingPick,time=Date.now()+clockOffset;
  pile.draw({count:players.length,seed:r?.layout_seed??players.length+17,age:r?time-r.shaken_at:2000,dim:selected});
  if(!players.length){label('签卡已经空了',640,310,32,ink);label('点击右下角「设定」添加奖项',640,361,18,'#b49d8a');return;}
  if(!selected){label('CLICK CARD TO OPEN',640,76,15,'#b4a298');if(state.enrolling)label(`发送「${state.config.keyword}」加入`,640,118,19,ink);return;}
  const phase=confirmed?r.status:'revealing';
  let peel=Math.max(r?.peel||0,localPeel);
  if(phase==='tearing')peel=(r.tear_from||0)+(1-(r.tear_from||0))*Math.min(1,(time-r.tear_at)/(r.ends_at-r.tear_at));
  if(phase==='done')peel=1;
  pile.opened({index:confirmed?r.card_index:pendingPick.card,phase,progress:peel,level:r?.ticket_level,arrive:selection?(performance.now()-selection.at)/450:1,elapsed:Math.max(0,time-(r?.ends_at||time))});
  label(phase==='done'?'LUCKY YOU!':phase==='tearing'?'GOOD LUCK IS ON THE WAY':'PEEL TO REVEAL',640,96,15,'#b4a298');
  if(phase==='revealing')label('从左向右撕开签面，看看你的好运',640,530,19,'#b49d8a');
  if(phase==='done'){const winner=r.players.find(p=>p.id===r.winner_id);label((winner?.level?winner.level+' 奖 · ':'')+short(winner?.name||'',28),640,530,30,ink);}
}
function ticketPoint(event){const rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*1280/rect.width,y:(event.clientY-rect.top)*720/rect.height};}
async function sendPeel(){
  if(peelSending||peelWanted===null)return;
  const progress=peelWanted,round=dragRound;peelWanted=null;peelSending=true;
  try{await scratchAction({action:'peel',round_id:round,progress});}
  catch(error){connection.textContent=error.message;connection.hidden=false;dragging=false;localPeel=0;peelWanted=null;}
  finally{peelSending=false;if(peelWanted!==null)sendPeel();}
}
canvas.addEventListener('pointerdown',event=>{
  if(gameMode!=='scratch'||capture||scratchBusy||event.button!==0||!state)return;
  const p=ticketPoint(event),r=state.round;
  if(r?.status==='revealing'&&p.x>=390&&p.x<=890&&p.y>=175&&p.y<=455){
    dragging=true;dragRound=r.id;localPeel=r.peel||0;dragStart=p.x-localPeel*450;canvas.setPointerCapture(event.pointerId);wake();return;
  }
  if(!r||r.status==='choosing'){const card=pile.hit(p.x,p.y);if(card>=0)choose({action:'pick',card});}
});
canvas.addEventListener('pointermove',event=>{
  if(gameMode!=='scratch'||capture)return;const p=ticketPoint(event);
  if(dragging){localPeel=Math.max(localPeel,Math.min(1,(p.x-dragStart)/450));peelWanted=localPeel;renderScratchControls();wake();return;}
  const hover=(!state?.round||state.round.status==='choosing')?pile.hit(p.x,p.y):-1;
  if(hover!==pile.hover){pile.hover=hover;canvas.style.cursor=hover>=0?'pointer':state?.round?.status==='revealing'?'ew-resize':'default';paint(performance.now());}
});
function stopPeel(event){if(!dragging)return;dragging=false;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);peelWanted=localPeel;sendPeel();}
canvas.addEventListener('pointerup',stopPeel);canvas.addEventListener('pointercancel',stopPeel);canvas.addEventListener('lostpointercapture',()=>{if(dragging){dragging=false;peelWanted=localPeel;sendPeel();}});
setInterval(()=>{if(dragging)sendPeel();},120);
function prepareAvatars(){
  if(!active)return;
  const players=(state.round?.mode||state.config.mode)==='duel'?[...state.players,...(state.round?.players||[])]:[];
  const wanted=new Set(players.map(p=>p.face).filter(Boolean));
  for(const [face,entry] of avatars)if(!wanted.has(face)||entry.retryAt&&Date.now()>=entry.retryAt){entry.image.onload=entry.image.onerror=null;entry.image.removeAttribute('src');avatars.delete(face);}
  for(const face of wanted)if(!avatars.has(face)){
    const image=new Image(),entry={image,ready:false,retryAt:0};avatars.set(face,entry);
    image.onload=()=>{entry.ready=true;paint(performance.now());wake();};
    image.onerror=()=>{entry.retryAt=Date.now()+30000;};
    image.src='/api/avatar?url='+encodeURIComponent(face);
  }
}
function label(text,x,y,size=22,color=ink,outline=false){
  ctx.font=`700 ${size}px "Microsoft YaHei", "Segoe UI", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
  if(outline){ctx.strokeStyle=ink;ctx.lineWidth=5;ctx.strokeText(text,x,y);}
  ctx.fillStyle=color;ctx.fillText(text,x,y);
}
const short=(name,n=12)=>Array.from(name).length>n?Array.from(name).slice(0,n-1).join('')+'…':name;
function ellipse(x,y,rx,ry,fill,stroke=ink,width=5){ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,tau);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}}
function progress(){const r=state?.round;return !r?0:r.status==='done'?1:Math.max(0,Math.min(1,(Date.now()+clockOffset-r.started_at)/(r.ends_at-r.started_at)));}
function participants(){return state.round?.players||state.players;}
function wheel(players,t){
  const r=state.round,items=players.length?players:demo.map(name=>({name})),n=items.length,step=tau/n;
  const winner=r?items.findIndex(p=>p.id===r.winner_id):-1;
  const target=winner<0?0:7*tau+((Math.PI/2-(winner+.5)*step)%tau+tau)%tau;
  const rotation=r?target*(1-(1-t)**5):-.32;
  ellipse(640,458,345,200,'#eee0b7',null);
  const sector=(i,depth)=>{
    ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,305,i*step+rotation,(i+1)*step+rotation);ctx.closePath();
    ctx.fillStyle=colors[i%colors.length];ctx.fill();if(depth){ctx.fillStyle='#63483c42';ctx.fill();}
    if(n<=80){ctx.lineWidth=n>40?1.5:3.5;ctx.strokeStyle=ink;ctx.stroke();}
  };
  ctx.save();ctx.translate(640,416);ctx.scale(1,.66);
  for(let i=0;i<n;i++)sector(i,true);
  ctx.beginPath();ctx.arc(0,0,305,0,tau);ctx.strokeStyle=ink;ctx.lineWidth=7;ctx.stroke();ctx.restore();
  ctx.save();ctx.translate(640,385);ctx.scale(1,.66);
  for(let i=0;i<n;i++)sector(i,false);
  ctx.beginPath();ctx.arc(0,0,305,0,tau);ctx.strokeStyle=ink;ctx.lineWidth=7;ctx.stroke();
  // shortcut: Narrow slices sample labels; use the full roster to inspect every name.
  const stride=Math.max(1,Math.ceil(n/36));
  for(let i=0;i<n;i+=stride){
    const angle=(i+.5)*step+rotation,d=n>12?224:187;
    ctx.save();ctx.translate(Math.cos(angle)*d,Math.sin(angle)*d);ctx.scale(1,1/.66);
    if(n>12){ctx.rotate(angle);if(Math.cos(angle)<0)ctx.rotate(Math.PI);}
    label(short(items[i].name,n>24?7:11),0,0,n>24?15:n>12?19:24,cream,true);ctx.restore();
  }
  ctx.restore();
  ellipse(640,385,21,16,cream,ink,5);
  ctx.beginPath();ctx.moveTo(640,586);ctx.lineTo(610,630);ctx.quadraticCurveTo(640,645,670,630);ctx.closePath();ctx.fillStyle='#df614f';ctx.fill();ctx.strokeStyle=ink;ctx.lineWidth=7;ctx.stroke();
  if(!players.length)label('等待第一位幸运儿入场',640,139,22,'#a38c79');
}
function pawn(player,x,y,index,scale=1,damage=0,alpha=1){
  ctx.save();ctx.globalAlpha=alpha;ctx.translate(x,y);ctx.scale(scale,scale);
  ellipse(1,43,27,8,'#705b5120',null);
  ctx.fillStyle=colors[index%colors.length];ctx.strokeStyle=ink;ctx.lineWidth=4;
  ctx.beginPath();ctx.moveTo(-12,7);ctx.lineTo(-18,36);ctx.quadraticCurveTo(0,48,18,36);ctx.lineTo(12,7);ctx.closePath();ctx.fill();ctx.stroke();
  ellipse(0,-9,24,24,colors[index%colors.length],ink,4);
  const avatar=avatars.get(player.face);
  if(avatar?.ready){
    const image=avatar.image,size=Math.min(image.naturalWidth,image.naturalHeight);
    ctx.save();ctx.beginPath();ctx.arc(0,-9,21,0,tau);ctx.clip();ctx.drawImage(image,(image.naturalWidth-size)/2,(image.naturalHeight-size)/2,size,size,-21,-30,42,42);ctx.restore();
  }else{ctx.fillStyle=ink;ctx.beginPath();ctx.arc(-7,-10,2.4,0,tau);ctx.arc(7,-10,2.4,0,tau);ctx.fill();}
  label(short(player.name,10),0,-52,18,cream,true);
  if(damage)label(damage+'%',0,65,15,'#b55b47');ctx.restore();
}
function duel(players,t,now){
  const r=state.round,items=players.length?players:demo.slice(0,5).map((_,i)=>({name:['红色战士','绿色射手','蓝色队长','黄色闪光','紫色魔王'][i],id:'demo'+i}));
  const battle=Math.max(0,Math.min(1,(t-.14)/.77));
  const dead=r?Math.floor(battle*(items.length-1)):0;
  const order=new Map((r?.order||[]).map((id,i)=>[id,i]));
  ellipse(640,462,476,202,'#eee0b7',null);
  ellipse(640,425,464,203,'#74594f',ink,6);
  ellipse(640,405,464,203,'#df614f',ink,6);
  ellipse(640,400,443,182,'#fffdf7',ink,4);
  ctx.save();ctx.globalAlpha=.16;ellipse(640,400,250,95,'transparent','#c9b69a',3);ctx.restore();
  const elapsed=r?(Date.now()+clockOffset-r.started_at)/1000:now/1000;
  const fighters=items.map((p,i)=>{
    const seed=i*2.399963,rank=order.get(p.id)??items.length;
    const lost=r&&rank<dead,eliminateAt=.14+.77*(rank+1)/Math.max(1,items.length-1);
    const fly=lost?Math.min(1,(t-eliminateAt)*12):0;
    const a=seed+elapsed*(r?1.6:.22),rad=items.length>35?.9:.4+.4*((i%3)/2);
    let x=640+Math.cos(a)*355*rad,y=395+Math.sin(a)*125*rad;
    if(r&&battle>.96&&!lost){x=640;y=390;}
    if(lost){x+=Math.cos(seed)*fly*570;y-=Math.sin(fly*Math.PI)*210;y+=fly*170;}
    return {p,i,x,y,lost,fly,scale:(items.length>60?.5:items.length>25?.65:1)*(0.85+(y-260)/800)};
  }).filter(f=>!f.lost||f.fly<1).sort((a,b)=>a.y-b.y);
  for(const f of fighters){
    const hit=r&&t>.14&&!f.lost&&Math.sin(elapsed*8+f.i)>0.88;
    if(hit){ctx.save();ctx.translate(f.x+25,f.y);ctx.rotate(elapsed);ctx.fillStyle='#f0c64e';ctx.beginPath();for(let j=0;j<10;j++){const a=j*Math.PI/5,d=j%2?10:26;ctx.lineTo(Math.cos(a)*d,Math.sin(a)*d);}ctx.closePath();ctx.fill();ctx.restore();}
    pawn(f.p,f.x,f.y+(r?Math.sin(elapsed*9+f.i)*5:0),f.i,f.scale,r?Math.floor(t*90+f.i%17):0,1-f.fly);
  }
  if(r&&t<.14)label(t<.035?'3':t<.07?'2':t<.105?'1':'GO!',640,345,66,'#df614f',true);
  label(players.length?`场上剩余 ${Math.max(1,items.length-dead)} 人`:'小人已就位，等待你的观众',640,650,20,'#a38c79');
}
function confetti(t){
  const elapsed=(Date.now()+clockOffset-(state.round?.ends_at||Date.now()))/1000;
  if(elapsed>6)return;
  for(let i=0;i<55;i++){
    const seed=i*193.37,x=(seed*17+Math.sin(elapsed+i)*22)%1280,y=((i*79+elapsed*(65+i%40))%720+720)%720;
    ctx.save();ctx.translate(x,y);ctx.rotate(i+elapsed);ctx.fillStyle=colors[i%colors.length];ctx.fillRect(-4,-8,8,16);ctx.restore();
  }
}
function paint(now=0){
  ctx.clearRect(0,0,1280,720);if(!state)return;
  const r=state.round,items=participants(),t=progress(),mode=r?.mode||state.config.mode,done=r&&(r.status==='done'||mode!=='scratch'&&t>=1);
  if(mode==='wheel')wheel(items,t);else if(mode==='duel')duel(items,t,now);else scratch(items);
  const winner=done?r.players.find(p=>p.id===r.winner_id):null;
  if(winner&&mode!=='scratch'){confetti(t);label(mode==='duel'?'本 局 冠 军':'好 运 揭 晓',640,55,18,'#b19b83');label(short(winner.name,24),640,105,42,'#bb634c');}
  else if(mode!=='scratch'){label(mode==='duel'?'READY TO RUMBLE':'LET THE GOOD TIMES SPIN',640,54,16,'#b19b83');label(r?'好戏进行中':state.enrolling?`发送「${state.config.keyword}」加入`:'你的好运，即将登场',640,100,27,ink);}
  if(mode==='wheel')label(r&&!done?'每个人都有一份好运':items.length?`${items.length} 位参与者 · 好运正在路上`:'开启报名，或在控制台添加名字',640,682,17,'#a38c79');
  const announcement=winner?`${gameTitle}结果：${winner.name}`:r?(r.status==='choosing'?'请选择一张签卡':r.status==='revealing'?'从左向右撕开签卡':'本轮正在进行'):`${gameTitle}，${state.players.length}项数据${state.enrolling?'，发送'+state.config.keyword+'报名':''}`;
  if(canvas.getAttribute('aria-label')!==announcement){canvas.setAttribute('aria-label',announcement);document.getElementById('lottery-announcement').textContent=announcement;}
}
function frame(now){
  raf=0;if(!active||document.hidden||!state)return;
  const done=state.round?.status==='done',age=Date.now()+clockOffset-(state.round?.ends_at||0);
  if(done&&age>6500&&settledPaint)return;
  if(gameMode==='scratch'||now-lastPaint>1000/30){paint(now);lastPaint=now;if(done&&age>6500)settledPaint=true;}
  if(!state.round&&state.config.mode==='wheel')return;
  if(gameMode==='scratch'){const r=state.round,time=Date.now()+clockOffset,zoom=selection&&performance.now()-selection.at<500;if(!zoom&&!dragging&&r?.status!=='tearing'&&!(r?.status==='choosing'&&time-r.shaken_at<1800)&&!(done&&age<900))return;}
  raf=requestAnimationFrame(frame);
}
function wake(){settledPaint=false;if(!raf)raf=requestAnimationFrame(frame);}
function update(next){
  if(next.game!==gameMode)return;
  const r=next.round,selected=r&&['revealing','tearing','done'].includes(r.status);
  if(selected&&(!selection||selection.round!==r.id||selection.card!==r.card_index)){
    const at=pendingPick?.card===r.card_index&&pendingPick.platform===next.platform?selection?.at:undefined;
    selection={round:r.id,card:r.card_index,at:at??performance.now()};
  }else if(!selected&&!pendingPick)selection=null;
  state=next;clockOffset=next.now-Date.now();if(state.round?.id!==dragRound||state.round?.status!=='revealing'){localPeel=0;dragging=false;peelWanted=null;}prepareAvatars();renderScratchControls();paint(performance.now());wake();
}
const source=new LuoboEvents('/api/events?lottery=1&game='+gameMode);
source.addEventListener('lottery',event=>update(JSON.parse(event.data)));
source.onopen=()=>{connection.hidden=true;};
source.onerror=()=>{connection.textContent='控制台连接中断，正在重连…';connection.hidden=false;};
addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='lottery-preview-visibility'){active=!!event.data.visible;if(active){if(state)prepareAvatars();wake();}}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake();});
