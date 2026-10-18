import {customerAt, queuePosition, shirts, portrait, toast, requestAction} from './shared.js';
import { food, cafeCupAsset } from './food.js';
import { StirFryScene } from './stir-fry.js';
import { BurgerScene } from './burger.js';
const $ = id=>document.getElementById(id);
const workspace = new ChefSystems.GameState();
const drag = new ChefSystems.DragSystem(workspace);
const actors = new Map();
const effects = new Map();
let state, busy=false, revision=-1, keyboardDrag=false, presentationStamp='', raidStamp='', raidTimer;
let theftStamp='', theftTimer;
let sliceStamp='', sliceTimer;
let cafeStamp='', cafeTimer;
let bowlClicks=0, placingBowl=false;
let layout=structuredClone(NoodleLayout.defaults), building=false, selectedModule='counter', selectedItem='', buildDrag;
function applySign(sign) {
  for(const [key,size,spacing] of [['top',12,3],['title',36,5],['bottom',11,4]]) {
    const el=$('sign-'+key);
    el.textContent=sign[key];el.hidden=!sign[key];
    el.style.fontSize=size+'px';el.style.letterSpacing=spacing+'px';
    if(el.clientWidth && el.scrollWidth>el.clientWidth) {
      const fit=el.clientWidth/el.scrollWidth;
      el.style.fontSize=size*fit+'px';el.style.letterSpacing=spacing*fit+'px';
    }
  }
}
const params=new URLSearchParams(location.search), output=params.get('layer');
let previewActive = !params.has('preview') || !parent.document.getElementById('noodle-view')?.hidden;
const showsBackground=!output || output==='background',showsCounter=!output || output==='counter',showsCustomers=!output || output==='customers';
const motionClient=crypto.randomUUID();
let motionDirty=false, motionSending=false, motionSentAt=0, motionWarning=false, remoteMotion=null, motionTimer;
let localPointer=null, throwDrag=null;
let pendingPot=null;
let motionFrame;
function paintMotion() {
  if(motionFrame)return;
  motionFrame=requestAnimationFrame(()=>{motionFrame=null;drawObjects();renderThrows(state?.throws||[]);highlight();});
}
const knifeRecipe=()=>state?.template?.workflow==='knife-noodles';
const cafeRecipe=()=>state?.template?.workflow==='jasmine-latte';
const stirRecipe=()=>state?.template?.workflow==='stir-fry';
const burgerRecipe=()=>state?.template?.workflow==='burger';
const stir=new StirFryScene({state:()=>state,layout:()=>layout,canPlay:()=>!building&&!output&&!busy&&state?.mode==='running'&&!state?.sealed,send:(name,args)=>send(name,{revision,...args})});
const burger=new BurgerScene({state:()=>state,layout:()=>layout,canPlay:()=>!building&&!output&&!busy&&state?.mode==='running'&&!state?.sealed,send:(name,args)=>send(name,{revision,...args}),pointer:p=>{localPointer=p;motionDirty=true;drawChef();}});
const asset=(key,fallback)=>state?.template?.assets[key] || '/noodle/assets/'+fallback+'.png';
function applyTemplate() {
  ChefConfig.workflow=state.template?.workflow || 'mix';
  document.body.classList.toggle('cafe',cafeRecipe());
  document.body.classList.toggle('stir-fry',stirRecipe());
  document.body.classList.toggle('burger',burgerRecipe());
  document.title=cafeRecipe()?'茉莉咖啡厅 · 小萝卜游戏控制台':'弹幕面馆 · 小萝卜游戏控制台';
  $('game-served').nextElementSibling.textContent=cafeRecipe()?'杯':'碗';
  const custom=Boolean(state.template?.assets.background);
  $('template-background').alt=cafeRecipe()?'咖啡厅背景':'面馆背景';
  document.body.classList.toggle('custom-background',custom);
  $('template-background').hidden=!custom;
  if(!showsBackground)$('template-background').removeAttribute('src');
  else if(custom && $('template-background').getAttribute('src')!==state.template.assets.background) $('template-background').src=state.template.assets.background;
  for(const [selector,key,file] of [['.counter>img','counter','counter'],['#game-noodles>img','pot','pot'],['#game-sauce>img','sauce','sauce'],['#bowl-rack>img','bowl_stack','bowl-stack'],['#water-fridge>img','fridge','water-fridge'],['#trash-bin>img','trash','trash-bin'],['#cash-box>img','cash','cash-box'],['#cash-box .cash-total img','coin','payment-coin'],['#bowl-area>img','tray','bowl-area']]) {
    const empty=state.sealed && ['pot','sauce','fridge'].includes(key);
    const cafeKey=cafeRecipe() && key==='pot'?'coffee_machine':key;
    const image=document.querySelector(selector),src=asset(cafeRecipe() && key==='pot'?cafeKey:empty?key+'_empty':cafeKey,empty?file+'-empty':file);
    if(key==='pot')image.alt=cafeRecipe()?'咖啡机':'面条锅';
    if(key==='bowl_stack')image.alt=cafeRecipe()?'咖啡杯架':'空碗架';
    if(key==='tray')image.alt=cafeRecipe()?'放杯托盘':'放碗区';
    if(!showsCounter || cafeRecipe() && key==='fridge') {image.removeAttribute('src');continue;}
    if(image.getAttribute('src')!==src)image.src=src;
  }
  $('game-sauce').hidden=knifeRecipe()||cafeRecipe();
  $('bowl-rack').setAttribute('aria-label',cafeRecipe()?'点击杯架，自动摆放一个空杯':'点击碗架，自动摆放一个空碗');
  $('game-noodles').setAttribute('aria-label',knifeRecipe()?'把削好的生面拖进煮面锅':'拖出面条');
  if(knifeRecipe()){$('game-noodles').dataset.templateTool='pot';$('game-noodles').setAttribute('aria-label','把生面拖进锅里煮，煮熟后按住锅把熟面拖到碗里');}
  else if(cafeRecipe()){$('game-noodles').dataset.templateTool='coffee';$('game-noodles').setAttribute('aria-label','把杯子放入咖啡机，萃取完成后拿起杯子');}
  else delete $('game-noodles').dataset.templateTool;
  document.querySelectorAll('.template-tool').forEach(el=>{
    if(el.classList.contains('burger-tool'))return;
    const cafeTool=el.classList.contains('cafe-tool');
    el.hidden=el.classList.contains('burger-tool')?!burgerRecipe():cafeTool?!cafeRecipe():!(knifeRecipe() || stirRecipe()&&['scallions','cilantro'].includes(el.dataset.layoutItem));
    if(!showsCounter)el.firstElementChild.removeAttribute('src');
    else if(!el.hidden) {
      const key=!cafeTool && state.sealed?(el.dataset.layoutItem==='dough'?'dough_empty':'condiment_empty'):el.dataset.layoutItem;
      const src=asset(key,key.replaceAll('_','-'));
      if(el.firstElementChild.getAttribute('src')!==src)el.firstElementChild.src=src;
    }
    if(cafeRecipe())el.removeAttribute('title');else el.title=el.getAttribute('aria-label');
  });
  drawCooking();
  stir.applyTemplate();
  burger.applyTemplate();
  document.body.classList.toggle('sealed',!!state.sealed);
}
function drawShop() {
  if(!showsCustomers)return;
  $('shop-stars').textContent='★'.repeat(state.stars ?? 5)+'☆'.repeat(5-(state.stars ?? 5));
  $('shop-points').textContent=state.points ?? 500;
  $('shop-title').textContent=state.sealed ? '已查封' : ['','一星店铺','二星店铺','三星店铺','四星店铺','五星店铺'][state.stars ?? 5];
  drawSealCountdown();
  $('shop-rating').classList.toggle('five-star',(state.stars ?? 5)===5 && !state.sealed);
  $('shop-seal').hidden=!state.sealed;
  const seal=asset('seal','shop-seal');
  if($('shop-seal').getAttribute('src')!==seal)$('shop-seal').src=seal;
  const stamp=state.active_preset+':'+state.raid_at,age=Date.now()-state.raid_at;
  if(stamp!==raidStamp) {
    raidStamp=stamp;clearTimeout(raidTimer);$('shop-raid').replaceChildren();$('shop-raid').hidden=true;
    if(state.sealed && age>=0 && age<3200) {
      const car=document.createElement('img');car.src='/noodle/assets/police-car.gif';car.alt='警察小车';
      car.style.animationDelay=-age+'ms';$('shop-raid').append(car);$('shop-raid').hidden=false;
      raidTimer=setTimeout(()=>{$('shop-raid').hidden=true;$('shop-raid').replaceChildren();},3200-age);
    }
  }
}
function drawThiefBoard() {
  const list = $('thief-board-list'), entries = state.thief_board || [];
  const stamp = JSON.stringify(entries);
  if (list.dataset.paint === stamp) return;
  list.dataset.paint = stamp; list.replaceChildren();
  if (!entries.length) { const empty = document.createElement('li'); empty.textContent = '还没有人偷到钱'; list.append(empty); }
  for (const [index, person] of entries.entries()) {
    const row = document.createElement('li'), name = document.createElement('span'), amount = document.createElement('b');
    name.textContent = `${index + 1}. ${person.name}`; amount.textContent = `${person.amount} 元`;
    row.append(name, amount); list.append(row);
  }
}
function drawSealCountdown() {
  if (!previewActive || !state?.sealed || !showsCustomers) return;
  const title = `查封 ${Math.max(0, Math.ceil((state.sealed_until - Date.now()) / 1000))} 秒`;
  if ($('shop-title').textContent !== title) $('shop-title').textContent = title;
}
setInterval(drawSealCountdown, 1000);
function updateThiefFace(body, sender) {
  const stamp=JSON.stringify([sender?.uid,sender?.face]);
  if(body.dataset.face===stamp)return;
  body.dataset.face=stamp;body.querySelector('.thief-head')?.remove();
  if(sender?.face)body.append(portrait(sender,'thief-head'));
}
async function drawTheft() {
  if(!showsCustomers)return;
  const event=state.theft,stage=$('shop-thief');
  if(!event) {clearTimeout(theftTimer);stage.hidden=true;stage.replaceChildren();return;}
  if(event.id===theftStamp) {const body=stage.querySelector('.thief-body');if(body)updateThiefFace(body,event.sender);return;}
  theftStamp=event.id;
  const image=new Image();image.src='/noodle/assets/thief.png';image.alt='小偷';
  try {await image.decode();} catch {image.alt='小偷来了';}
  if(!previewActive || state.theft?.id!==event.id)return;
  clearTimeout(theftTimer);stage.replaceChildren();
  const cash = NoodleLayout.propRect(layout,'cash',state?.template?.workflow);
  const points=event.amount ? [NoodleLayout.toStage({x:cash.x+cash.width/2,y:cash.y+cash.height/2},layout.modules.counter)] : [];
  const fallback=NoodleLayout.workspaceToStage({x:590,y:475},layout,state?.template?.workflow);
  const x=Math.max(150,Math.min(1130,points.length?points.reduce((sum,p)=>sum+p.x,0)/points.length:fallback.x));
  const y=Math.max(160,Math.min(620,points.length?points.reduce((sum,p)=>sum+p.y,0)/points.length:fallback.y));
  if(layout.modules.counter.visible) for(const p of points) {
    const coin=new Image(),size=55*layout.modules.counter.scale*layout.props.tray.scale;
    coin.src=asset('coin','payment-coin');coin.alt='';coin.className='thief-coin';
    Object.assign(coin.style,{left:p.x-size/2+'px',top:p.y-size/2+'px',width:size+'px',height:size+'px'});
    coin.style.setProperty('--loot-x',x+44-p.x+'px');coin.style.setProperty('--loot-y',y-40-p.y+'px');
    stage.append(coin);
  }
  const actor=document.createElement('div');actor.className='thief-character';
  Object.assign(actor.style,{left:x-94+'px',top:y-130+'px'});
  actor.style.setProperty('--enter-x',1520-x+'px');actor.style.setProperty('--exit-x',-x-240+'px');
  const result=document.createElement('output');result.className='thief-result';
  result.textContent=event.amount?`偷走 ${event.amount} 元`:'钱匣里没有钱';
  const body=document.createElement('div');body.className='thief-body';body.append(image);
  updateThiefFace(body,state.theft.sender);
  actor.append(body,result);stage.append(actor);stage.hidden=false;
  theftTimer=setTimeout(()=>{stage.hidden=true;stage.replaceChildren();},4800);
}
function drawCooking() {
  if(!previewActive || !showsCounter)return;
  const batches=state?.cooking || [],ready=batches.filter(b=>Date.now()>=b.ready_at).length;
  const label=$('cooking-status');label.hidden=!(knifeRecipe()||cafeRecipe()) || !batches.length;
  if(batches.length) {
    label.textContent=cafeRecipe()?(ready?'咖啡好了 · 拿起杯子':`萃取 ${Math.max(1,Math.ceil((batches[0].ready_at-Date.now())/1000))} 秒`):ready?`可取 ${ready} 份`:`煮面 ${Math.max(1,Math.ceil((Math.min(...batches.map(b=>b.ready_at))-Date.now())/1000))} 秒`;
    label.classList.toggle('ready',!!ready);
  }
  $('game-noodles').classList.toggle('brewing',cafeRecipe() && !!batches.length && !ready);
  let cup=$('game-noodles').querySelector('.machine-cup');
  if(cafeRecipe() && batches.length) {
    if(!cup){cup=document.createElement('img');cup.className='machine-cup';cup.alt='咖啡机中的杯子';$('game-noodles').append(cup);}
    const src=asset(cafeCupAsset({...batches[0].cup,coffee:!!ready}),'bowl-empty');if(cup.getAttribute('src')!==src)cup.src=src;
  }else cup?.remove();
}
function drawCafeEffect() {
  const event=state.cafe_effect,layer=$('cafe-effects');
  if(!showsCounter || !cafeRecipe() || !event){clearTimeout(cafeTimer);layer.replaceChildren();cafeStamp='';return;}
  if(event.id===cafeStamp)return;
  cafeStamp=event.id;clearTimeout(cafeTimer);layer.replaceChildren();
  const age=Date.now()-event.at;if(age<0 || age>=1200)return;
  const el=document.createElement('div');el.className='cafe-effect '+(event.kind==='milk'?'milk-pour':'jasmine-drop');
  el.style.left=event.x*1280/1200+'px';el.style.top=event.y*720/740+'px';el.style.setProperty('--cafe-age',-age+'ms');
  const img=document.createElement('img');img.src=asset(event.kind==='milk'?'milk':'portion_jasmine',event.kind);img.alt='';el.append(img);
  if(event.kind==='milk'){const stream=document.createElement('i');stream.className='milk-stream';el.append(stream);}
  layer.append(el);cafeTimer=setTimeout(()=>layer.replaceChildren(),1200-age);
}
function drawSlice() {
  const event = state.slice;
  if (!showsCounter || !knifeRecipe() || !event || event.preset + ':' + event.id === sliceStamp) return;
  sliceStamp = event.preset + ':' + event.id;
  const board = $('dough-board'), age = Date.now() - event.at;
  if (age < 0 || age >= 650) return;
  clearTimeout(sliceTimer); board.classList.remove('slicing'); void board.offsetWidth;
  board.style.setProperty('--slice-age', -age + 'ms'); board.classList.add('slicing');
  sliceTimer = setTimeout(() => board.classList.remove('slicing'), 650 - age);
}
setInterval(drawCooking,250);
function heldItem() {
  if (throwDrag) {
    const p=NoodleLayout.stageToWorkspace(throwDrag.o,layout,state?.template?.workflow);
    return {id:throwDrag.o.id,kind:throwDrag.o.kind,x:p.x,y:p.y,noodles:0,sauce:0,throw_revision:throwDrag.o.revision};
  }
  return drag.drag?.o;
}
async function sendMotion() {
  if(!previewActive || output || motionSending || !state || (!motionDirty && ((!drag.drag&&!throwDrag&&!localPointer) || Date.now()-motionSentAt<1000))) return;
  motionDirty=false;motionSending=true;motionSentAt=Date.now();
  try {
    const res=await fetch('/api/noodle/motion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client:motionClient,revision,pointer:!building&&localPointer?{...localPointer,pressed:!!(drag.drag||throwDrag)}:null,drag:building?null:heldItem()||null})});
    if(!res.ok) throw new Error('操作同步失败，请重启控制台并刷新画面');
    motionWarning=false;
  } catch(error) {if(!motionWarning){toast(error.message);motionWarning=true;}}
  finally {motionSending=false;}
}
setInterval(sendMotion,50);
function renderMotion(next) {
  clearTimeout(motionTimer);
  remoteMotion=next && next.client!==motionClient?next:null;
  paintMotion();
  if(remoteMotion) motionTimer=setTimeout(()=>renderMotion(null),2500);
}
if(params.has('preview')) document.body.classList.add('preview-mode');
if(output && ['background','counter','customers'].includes(output)) document.body.classList.add('layer-output', 'output-'+output);
function drawQueueOverflow() {
  if(!showsCustomers)return;
  const remaining=Math.max(0,(state?.queue_count || 0)-120);
  $('queue-overflow').style.display=building || remaining>0?'block':'none';
  $('queue-overflow').textContent='还有 '+remaining+(burgerRecipe()?' 位在等汉堡':cafeRecipe()?' 位在等咖啡':stirRecipe()?' 位在等香锅':' 位在等面');
}
function applyLayout() {
  for(const [key,item] of Object.entries(layout.modules)) {
    const el=document.querySelector(`[data-module="${key}"]`);
    el.style.transform=`translate(${item.x}px,${item.y}px) scale(${item.scale})`;
    el.style.display=item.visible?'block':'none';
    el.classList.toggle('build-selected',building && !selectedItem && key===selectedModule);
  }
  const sources=NoodleLayout.stations(layout,state?.template?.workflow);
  const rating=layout.props.rating;
  $('shop-rating').style.transform=`translate(${rating.x}px,${rating.y}px) scale(${rating.scale})`;
  for (const [key, id] of [['stats','game-stats'],['gift_rule','gift-rule'],['thief_board','thief-board'],['sign_top','sign-top'],['sign_title','sign-title'],['sign_bottom','sign-bottom'],['cash_text','cash-total'],['queue_overflow','queue-overflow']]) {
    const item = layout.props[key];
    $(id).style.transform = `translate(${item.x}px,${item.y}px) scale(${item.scale})`;
  }
  const trash=NoodleLayout.trashRect(layout,state?.template?.workflow), background=layout.modules.background;
  Object.assign($('trash-module').style,{transform:`translate(${background.x}px,${background.y}px) scale(${background.scale})`,display:background.visible?'block':'none'});
  Object.assign($('trash-bin').style,{left:trash.x+'px',top:trash.y+'px',width:trash.width+'px',height:trash.height+'px'});
  $('trash-bin').disabled=!building && (state?.mode!=='running'||busy);
  Object.assign($('fridge-module').style,{transform:`translate(${background.x}px,${background.y}px) scale(${background.scale})`,display:background.visible && !cafeRecipe()?'block':'none'});
  for(const [key,id] of [['fridge','water-fridge'],['cash','cash-box'],['tray','bowl-area']]) {
    const r=NoodleLayout.propRect(layout,key,state?.template?.workflow);
    Object.assign($(id).style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});
    $(id).style.setProperty('--item-scale',r.scale);
  }
  $('water-fridge').disabled=$('cash-box').disabled=!building && (state?.mode!=='running'||busy);
  const counter=layout.modules.counter;
  Object.assign($('chef-arm-module').style,{transform:`translate(${counter.x}px,${counter.y}px) scale(${counter.scale})`,display:counter.visible?'block':'none'});
  const tray=NoodleLayout.propRect(layout,'tray',state?.template?.workflow);
  $('workspace-objects').style.transform=stirRecipe()||burgerRecipe()?'none':`translate(${tray.x-320*1280/1200*tray.scale}px,${tray.y-370*720/740*tray.scale}px) scale(${tray.scale})`;
  const sourceRect=(kind,r,module)=>{
    const center=NoodleLayout.stageToWorkspace(NoodleLayout.toStage({x:r.x+r.width/2,y:r.y+r.height/2},module),layout,state?.template?.workflow);
    const start=NoodleLayout.stageToWorkspace(NoodleLayout.toStage(r,module),layout,state?.template?.workflow);
    const end=NoodleLayout.stageToWorkspace(NoodleLayout.toStage({x:r.x+r.width,y:r.y+r.height},module),layout,state?.template?.workflow);
    return {kind,x:center.x,y:center.y,left:start.x,right:end.x,top:start.y,bottom:end.y};
  };
  ChefConfig.sources=sources.filter(p=>p.kind!=='bowl'&&!(knifeRecipe()||cafeRecipe()||stirRecipe()||burgerRecipe())).map(p=>sourceRect(p.kind,{x:p.x-p.width/2,y:p.y-p.height/2,width:p.width,height:p.height},counter));
  if(!cafeRecipe()&&!stirRecipe())ChefConfig.sources.push(sourceRect('water',NoodleLayout.propRect(layout,'fridge',state?.template?.workflow),background));
  if(state?.sealed)ChefConfig.sources=ChefConfig.sources.filter(s=>s.kind==='bowl');
  for(const el of document.querySelectorAll('.template-tool')) {
    const r=NoodleLayout.propRect(layout,el.dataset.layoutItem,state?.template?.workflow);
    Object.assign(el.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});
    el.disabled=!building && (state?.mode!=='running'||busy||state?.sealed);
    if(!stirRecipe() && !el.hidden && !state?.sealed && el.dataset.source)ChefConfig.sources.push(sourceRect(el.dataset.source,r,counter));
  }
  $('cafe-effects').style.transform=$('workspace-objects').style.transform;
  for(const p of sources) {
    const el=document.querySelector(`[data-source="${p.kind}"]`);
    Object.assign(el.style,{left:p.x-p.width/2+'px',top:p.y-p.height/2+'px',width:p.width+'px',height:p.height+'px'});
    el.disabled=!building && (state?.mode!=='running'||busy&&!(p.kind==='bowl'&&placingBowl)||(state?.sealed && p.kind!=='bowl'));
    if(p.kind==='noodles')Object.assign($('cooking-status').style,{left:p.x+'px',top:p.y+p.height/2+'px'});
  }
  document.querySelectorAll('[data-layout-item]').forEach(el=>el.classList.toggle('build-item-selected',building && el.dataset.layoutItem===selectedItem));
  document.body.classList.toggle('building',building);
  stir.applyLayout();
  if(stirRecipe()||burgerRecipe())drawObjects();
  if(state?.sealed && !building)$('water-fridge').disabled=true;
  drawQueueOverflow();
  drawChef();
}
function drawChef() {
  if(!showsCounter)return;
  const motion=remoteMotion?.revision===state?.workspace_revision?remoteMotion:null;
  const held=heldItem()||motion?.drag;
  let target=held?NoodleLayout.workspaceToStage(held,layout,state?.template?.workflow):localPointer||motion?.pointer;
  if(target) target=NoodleLayout.fromStage(target,layout.modules.counter);
  const armItem=layout.props.chef;
  const pose=NoodleChef.pose(!building&&state?.mode==='running'?target:null,!!held,armItem);
  for(const [id,arm] of [['chef-upper',pose.upper],['chef-lower',pose.lower]]) Object.assign($(id).style,{left:arm.x+'px',top:arm.y+'px',width:arm.length+(id==='chef-upper'?31:25)+'px',transform:`rotate(${arm.angle}deg)`});
  Object.assign($('chef-hand').style,{left:pose.hand.x+'px',top:pose.hand.y+'px',width:35*armItem.scale+'px',height:35*armItem.scale+'px',transform:`translate(-50%,-50%) rotate(${Math.max(-60,Math.min(60,pose.lower.angle))}deg)`});
}
function stagePosition(e) {
  const r=$('stage').getBoundingClientRect();
  return {x:(e.clientX-r.left)*1280/r.width,y:(e.clientY-r.top)*720/r.height};
}
function resize() {
  const scale=Math.min(innerWidth/1280,innerHeight/720);
  Object.assign($('stage').style,{zoom:scale,left:(innerWidth/scale-1280)/2+'px',top:(innerHeight/scale-720)/2+'px'});
}
resize();addEventListener('resize',resize);
function worldPosition(e) {
  return NoodleLayout.stageToWorkspace(stagePosition(e),layout,state?.template?.workflow);
}
function drawObjects() {
  if(!showsCounter)return;
  const layer=$('workspace-objects');
  const rendered=new Map(Array.from(layer.children,el=>[Number(el.dataset.objectId),el]));
  const candidate=drag.drag?.o || (!building && remoteMotion && remoteMotion.revision===state?.workspace_revision?remoteMotion.drag:null);
  const active=['leaf','egg','cockroach'].includes(candidate?.kind)?null:candidate;
  const ordered=workspace.objects.filter(o=>o.id!==active?.id);
  if(active) ordered.push(active);
  for(const [index,o] of ordered.entries()) {
    let el=rendered.get(o.id);rendered.delete(o.id);
    if(el && el.dataset.kind!==o.kind) {el.remove();el=null;}
    if(!el) {
      el=document.createElement('div');el.dataset.kind=o.kind;el.dataset.objectId=o.id;
      el.tabIndex=0;el.setAttribute('role','button');
      if(o.kind==='bowl') {const img=document.createElement('img');img.className='bowl-art';el.append(img);for(const key of ['scallions','cilantro','jasmine']){const garnish=document.createElement('img');garnish.className='garnish garnish-'+key;garnish.alt={scallions:'葱花',cilantro:'香菜',jasmine:'茉莉花'}[key];garnish.hidden=true;el.append(garnish);}}
      else el.append(food(o.kind, asset));
      layer.append(el);
    }
    const stamp=[o.x,o.y,index,o.id===workspace.selected,o===active,o.noodles,o.sauce,o.scallions,o.cilantro,o.coffee,o.jasmine,o.milk,o.spoiled,!!(o.tip_at && o!==active && Date.now()-o.tip_at<850),state?.template?.id,burgerRecipe()?JSON.stringify([o.bun,o.patty,o.toppings,o.closed,o.contaminants,layout.props.tray]):stirRecipe()?JSON.stringify([o.ingredients,o.garnishes,o.drink,layout.props.tray]):''].join(':');
    if(el.dataset.paint===stamp)continue;
    el.dataset.paint=stamp;
    el.className='workspace-object '+(o.kind==='bowl'?'workspace-bowl':['water','coin'].includes(o.kind)?'workspace-'+o.kind:'ingredient')+(o.id===workspace.selected?' selected':'')+(o===active?' dragging':'');
    el.classList.toggle('tip-coin',o.kind==='coin' && o.tip_at && o!==active && Date.now()-o.tip_at<850);
    if(o.tip_at) el.style.setProperty('--tip-age',Math.min(0,o.tip_at-Date.now())+'ms');
    const p=stirRecipe()||burgerRecipe()?NoodleLayout.fromStage(NoodleLayout.workspaceToStage(o,layout,state.template.workflow),layout.modules.counter):{x:o.x*1280/1200,y:o.y*720/740};
    el.style.left=p.x+'px';el.style.top=p.y+'px';el.style.zIndex=index;el.style.scale=stirRecipe()||burgerRecipe()?layout.props.tray.scale:'';
    if(o.kind==='bowl') {
      el.setAttribute('aria-label',knifeRecipe()?`拿起碗 ${o.id}，${o.noodles?'刀削面':'空碗'}，${o.scallions?'有':'无'}葱花，${o.cilantro?'有':'无'}香菜`:`拿起碗 ${o.id}，面条 ${o.noodles} 份，臊子 ${o.sauce} 份`);
      const ready=ChefSystems.RecipeSystem.ready(o);
      const img=el.firstElementChild,src=o.spoiled?asset('evil_bowl','evil-noodles'):ready?asset('bowl','bowl'):!o.noodles&&!o.sauce?asset('bowl_empty','bowl-empty'):asset(o.noodles?'bowl_noodles':'bowl_sauce',o.noodles?'bowl-noodles':'bowl-sauce');
      if(img.getAttribute('src')!==src) img.src=src;
      img.alt=o.spoiled?'邪恶臭面条':ready?(state?.template?.dish_name||'臊子面'):o.noodles?'只装面条的碗':o.sauce?'只装臊子的碗':'空碗';
      if(cafeRecipe()) {
        const step=cafeCupAsset(o);
        const src=asset(step,'bowl-empty');if(img.getAttribute('src')!==src)img.src=src;
        img.alt=o.spoiled?'邪恶咖啡':ready?'茉莉花拿铁':o.coffee?(o.milk?'咖啡加牛奶':o.jasmine?'咖啡加茉莉花':'萃取好的咖啡'):o.milk?(o.jasmine?'牛奶加茉莉花':'牛奶杯'):o.jasmine?'放了茉莉花的杯子':'空咖啡杯';
        el.setAttribute('aria-label',`拿起咖啡杯 ${o.id}，${img.alt}`);el.classList.toggle('spoiled-cup',!!o.spoiled);
      }
      if(stirRecipe()){
        const src=asset(o.spoiled?'evil_bowl':o.ingredients?.length?StirFryFood.bowlAssets[StirFryFood.garnishMask(o.garnishes??[])]:'bowl_empty','bowl-empty');if(img.getAttribute('src')!==src)img.src=src;
        img.alt=o.spoiled?'变质的香锅':o.ingredients?.length?'麻辣香锅':'空碗';el.setAttribute('aria-label',`拿起碗 ${o.id}，${img.alt}`);
      }
      el.classList.toggle('milk-in-cup',cafeRecipe() && !o.coffee && !!o.milk);
      el.classList.toggle('both-garnishes',!!(o.scallions && o.cilantro));
      for(const key of ['scallions','cilantro','jasmine']) {
        const garnish=el.querySelector('.garnish-'+key);garnish.hidden=o.spoiled||!o[key]||(key==='jasmine'?!cafeRecipe()||o.coffee:!knifeRecipe());
        if(!garnish.hidden){const src=asset('portion_'+key,'portion-'+key);if(garnish.getAttribute('src')!==src)garnish.src=src;}
      }
      burger.paint(el,o);
    } else {if(stirRecipe()&&o.kind==='water'){el.firstElementChild.src=asset(o.drink||'cola','mineral-water');el.firstElementChild.alt=StirFryFood.drinks[o.drink]||'饮料';}el.setAttribute('aria-label','拿起'+el.firstElementChild.alt);}
  }
  for(const el of rendered.values()) el.remove();
  drawChef();
}
function render(next,force=false) {
  if(next.workspace_revision>revision && drag.drag) {drag.up(true);keyboardDrag=false;motionDirty=true;force=true;}
  if(state && JSON.stringify(state.config.layout)!==JSON.stringify(next.config.layout) && drag.drag) {drag.up(true);keyboardDrag=false;force=true;}
  state=next;
  document.body.classList.toggle('no-shop',next.active_preset===null);
  const stamp=JSON.stringify([next.config,next.template?.id,next.mode,next.sealed,building,busy]);
  if(throwDrag && (state.mode!=='running' || !state.throws.some(item=>item.id===throwDrag.o.id && item.revision===throwDrag.o.revision))) {throwDrag=null;keyboardDrag=false;motionDirty=true;}
  renderThrows(next.throws || []);
  if(state.mode!=='running') renderMotion(null);
  if(stamp!==presentationStamp) {
    presentationStamp=stamp;applyTemplate();
    if(!building) layout=NoodleLayout.validate(state.config.layout);
    applyLayout();if(!building) applySign(NoodleSign.validate(state.config.sign));
  }
  drawCooking();drawShop();drawThiefBoard();drawTheft();drawSlice();drawCafeEffect();stir.render();burger.render();
  $('game-queue').textContent=state.queue_count;$('game-served').textContent=state.served;
  $('cash-balance').textContent=(state.balance||0)+' 元';$('cash-balance').classList.toggle('negative',(state.balance||0)<0);$('cash-box').setAttribute('aria-label',`把金币放进钱匣，每枚 100 元，余额 ${state.balance||0} 元`);
  $('game-gift').textContent=state.config.gift_name;$('game-rule').textContent=`每个礼物排队 ${state.config.people_per_gift} 位`;
  if(!drag.drag && !busy && (force || state.workspace_revision>revision)) {
    workspace.objects=showsCounter?structuredClone(state.objects || []):[];
    workspace.selected=state.selected;workspace.serial=state.object_serial;
    revision=state.workspace_revision;drawObjects();
  }
  if(showsCustomers) {
  const departures=state.departures||[];
  const shown=new Set([...state.queue,...departures].map(p=>p.id));
  for(const [id,actor] of actors) if(!shown.has(id)){clearTimeout(actor.departureTimer);actor.remove();actors.delete(id);}
  [...state.queue.map((person,index)=>({...person,index})),...departures].forEach(person=>{
    let actor=actors.get(person.id);
    if(!actor){
      actor=document.createElement('div');actor.className='customer';actor.tabIndex=0;actor.setAttribute('role','button');
      actor.dataset.customerId=person.id;actor.dataset.name=person.name;actor.dataset.face=person.face;actor.setAttribute('aria-label',`递给 ${person.name}`);
      actor.style.setProperty('--shirt',shirts[person.uid%shirts.length]);
      actor.style.setProperty('--face',['#ebccb3','#f1d5b9','#dbcab8'][person.uid%3]);
      actor.style.setProperty('--hair',['#675b55','#977a5d','#5f6469','#bd976c'][person.uid%4]);
      for(const cls of ['customer-shadow','customer-feet','customer-body']) {const el=document.createElement('div');el.className=cls;actor.append(el);}
      actor.append(portrait(person,'customer-head'));
      const label=document.createElement('span');label.className='customer-name';label.textContent=person.name;actor.append(label);
      const dish=state.template?.dish_name||'臊子面';
      const order=document.createElement('img');order.className='customer-order'+(person.order==='water'?' water-order':'');order.src=person.order==='water'?asset(stirRecipe()?'cola':'water','mineral-water'):asset('bowl','bowl');order.alt=person.order==='water'?(stirRecipe()?'点单饮料':'点单圣水'):'点单'+dish;actor.append(order);
      actor.setAttribute('aria-label',`递给 ${person.name}，点单${person.order==='water'?(stirRecipe()?'饮料':'圣水'):dish}`);
      $('game-customers').append(actor);actors.set(person.id,actor);
    }
    if(actor.dataset.face!==person.face) {actor.querySelector('.customer-head').replaceWith(portrait(person,'customer-head'));actor.dataset.face=person.face;}
    const p=queuePosition(person.index),position=person.index+':'+!!person.at;
    if(actor.dataset.position!==position) {actor.dataset.position=position;actor.style.left=p.x+'px';actor.style.top=p.y+'px';actor.style.zIndex=person.at?200:p.layer;}
    if(person.at && actor.dataset.departureAt!==String(person.at)) {
      actor.dataset.departureAt=person.at;actor.tabIndex=-1;actor.setAttribute('role','img');
      actor.classList.add('departing',person.correct?'satisfied':'angry');actor.style.zIndex=200;
      actor.style.setProperty('--exit-x',(p.x<640?-1400:1400)+'px');actor.style.animationDelay=-Math.max(0,Date.now()-person.at)+'ms';
      const phrases=person.correct?(person.order==='water'?['圣水到位，老板真贴心！','冰冰凉凉，太舒服了！']:person.recipe==='burger'?['汉堡真香，下次还来！','肉饼煎得真好，老板手艺棒！']:person.recipe==='jasmine-latte'?['茉莉花好香，拿铁真好喝！','奶香配花香，下次还来！']:['这碗面真香，下次还来！','料足味道好，老板手艺棒！']):(person.order==='water'?['我要圣水，你给的啥呀！','点单都弄错了，不喝了！']:person.recipe==='burger'?['我要熟肉饼汉堡，还没做好呀！','请先把肉饼煎熟，盖好面包！']:person.recipe==='jasmine-latte'?['我要茉莉花拿铁，还没做好呀！','咖啡、茉莉花和牛奶都要有！']:person.recipe==='knife-noodles'?['面都没装好，不吃了！','这不是我点的刀削面！']:['我要面加臊子，这能吃吗！','这不是我要的，气死了！']);
      const bubble=document.createElement('div');bubble.className='customer-reaction';bubble.textContent=person.helped?'有人帮忙做好啦，谢谢！':person.spoiled?(burgerRecipe()?'汉堡变质了，不能吃！':cafeRecipe()?'邪恶咖啡！臭臭的，不喝了！':'臭臭面！老板你认真的吗！'):phrases[person.id%phrases.length];actor.append(bubble);
      const bubbleX=Math.max(105-p.x,Math.min(36,1175-p.x));bubble.style.left=bubbleX+'px';bubble.style.setProperty('--bubble-tip',(36-bubbleX)+'px');
      actor.setAttribute('aria-label',person.name+'：'+bubble.textContent);
      actor.departureTimer=setTimeout(()=>{if(actors.get(person.id)===actor){actor.remove();actors.delete(person.id);}},Math.max(0,4200-(Date.now()-person.at)));
    }
  });
  drawQueueOverflow();
  }
  if(state.mode!=='running' && drag.drag) {drag.up(true);keyboardDrag=false;drawObjects();}
  highlight();
}
async function send(action, payload) {
  busy=true;
  try {
    const next=await requestAction(action,payload);
    busy=false;render(next,true);return next;
  } catch(error) {
    toast(error.message);busy=false;
    try {render(await (await fetch('/api/noodle/state',{cache:'no-store'})).json(),true);} catch {}
  }
}
async function placeBowl() {
  if(state?.template?.workflow==='burger')return;
  if(output||building||state?.mode!=='running'||drag.drag||throwDrag||pendingPot||busy&&!placingBowl)return;
  bowlClicks++;
  if(placingBowl)return;
  placingBowl=true;
  try{
    while(bowlClicks>0){
      if(output||building||state?.mode!=='running'){bowlClicks=0;break;}
      bowlClicks--;
      if(!await send('place_bowl')){bowlClicks=0;break;}
    }
  }finally{placingBowl=false;}
}
$('bowl-rack').addEventListener('click',placeBowl);
function targetCustomer() {
  const o=heldItem() || remoteMotion?.drag;
  if(!o || !['bowl','water','noodles','sauce','raw','cooked','scallions','cilantro','jasmine','milk'].includes(o.kind) || !layout.modules.customers.visible) return null;
  const p=NoodleLayout.fromStage(NoodleLayout.workspaceToStage(o,layout,state?.template?.workflow),layout.modules.customers);
  return customerAt(state.queue,p.x,p.y);
}
function highlight() {
  const o=heldItem() || remoteMotion?.drag;
  const customer=targetCustomer(), target=NoodleRules.accepts(o, customer) && customer;
  for(const [id,actor] of actors) {actor.classList.toggle('feed-target',id===target?.id);actor.classList.toggle('wrong-target',id===customer?.id&&!target);}
  $('trash-bin').classList.toggle('trash-target',inTrash(o));
  $('cash-box').classList.toggle('deposit-target',inCashBox(o));
  $('game-noodles').classList.toggle('boil-target',inPot(o)||inCoffeeMachine(o));
  const bowl=spoilTarget(o);
  const cup=cafeRecipe() && ['jasmine','milk'].includes(o?.kind) && workspace.objects.find(b=>b.kind==='bowl' && Math.hypot(b.x-o.x,b.y-o.y)<48);
  for(const el of $('workspace-objects').children){el.classList.toggle('spoil-target',Number(el.dataset.objectId)===bowl?.id);el.classList.toggle('ingredient-target',Number(el.dataset.objectId)===cup?.id);}
}
function spoilTarget(o) {
  return !state?.sealed && ['leaf','egg','cockroach'].includes(o?.kind) && workspace.objects.find(b=>b.kind==='bowl' && !(burgerRecipe()&&b.closed) && (b.noodles>0 || b.coffee || b.bun || cafeRecipe() && (b.milk || b.jasmine)) && Math.hypot(b.x-o.x,b.y-o.y)<54);
}
function inCoffeeMachine(o) {
  if(!cafeRecipe() || o?.kind!=='bowl' || o.coffee || !layout.modules.counter.visible || state?.sealed)return false;
  const p=NoodleLayout.fromStage(NoodleLayout.workspaceToStage(o,layout,state?.template?.workflow),layout.modules.counter),r=NoodleLayout.stations(layout,state?.template?.workflow).find(s=>s.kind==='noodles');
  return p.x>=r.x-r.width/2&&p.x<=r.x+r.width/2&&p.y>=r.y-r.height/2&&p.y<=r.y+r.height/2;
}
function inPot(o) {
  if(!knifeRecipe() || o?.kind!=='raw' || !layout.modules.counter.visible)return false;
  const p=NoodleLayout.fromStage(NoodleLayout.workspaceToStage(o,layout,state?.template?.workflow),layout.modules.counter),r=NoodleLayout.stations(layout,state?.template?.workflow).find(s=>s.kind==='noodles');
  return p.x>=r.x-r.width/2&&p.x<=r.x+r.width/2&&p.y>=r.y-r.height/2&&p.y<=r.y+r.height/2;
}
function inCashBox(o) {
  if(!o || o.kind!=='coin' || !layout.modules.counter.visible) return false;
  const p=NoodleLayout.fromStage(NoodleLayout.workspaceToStage(o,layout,state?.template?.workflow),layout.modules.counter), r=NoodleLayout.propRect(layout,'cash',state?.template?.workflow);
  return p.x>=r.x && p.x<=r.x+r.width && p.y>=r.y && p.y<=r.y+r.height;
}
function deposit() {
  const o=drag.drag.o;drag.up(true);keyboardDrag=false;drawObjects();highlight();motionDirty=true;sendMotion();send('deposit',{revision,object_id:o.id});
}
function inTrash(o) {
  return !!o && NoodleLayout.trashContains(NoodleLayout.workspaceToStage(o,layout,state?.template?.workflow),layout,state?.template?.workflow);
}
function discard() {
  const {o,fresh}=drag.drag;
  drag.up(true);keyboardDrag=false;
  if(!workspace.objects.some(item=>item.id===workspace.selected && ['bowl','water'].includes(item.kind))) workspace.selected=null;
  drawObjects();highlight();motionDirty=true;sendMotion();
  if(fresh) send('workspace',{revision,objects:workspace.objects,selected:workspace.selected});
  else send('discard',{revision,object_id:o.id});
}
function finish(cancel=false) {
  if(throwDrag) {finishThrow(cancel);return;}
  if(!drag.drag) return;
  if(cafeRecipe() && drag.drag.o.kind==='milk' && (cancel || !workspace.objects.some(b=>b.kind==='bowl' && Math.hypot(b.x-drag.drag.o.x,b.y-drag.drag.o.y)<48))) {
    drag.up(true);keyboardDrag=false;workspace.serial=state.object_serial;workspace.selected=state.selected;
    drawObjects();highlight();motionDirty=true;sendMotion();return;
  }
  if(!cancel && inCoffeeMachine(drag.drag.o)) {
    const {o,fresh}=drag.drag;drag.up(true);keyboardDrag=false;drawObjects();highlight();motionDirty=true;sendMotion();
    send('brew_coffee',{revision,object_id:o.id,...(fresh?{fresh_item:{id:o.id,kind:o.kind}}:{})});return;
  }
  if(!cancel && cafeRecipe() && ['jasmine','milk'].includes(drag.drag.o.kind) && !inTrash(drag.drag.o)) {
    const {o,fresh}=drag.drag,cup=workspace.objects.find(b=>b.kind==='bowl' && Math.hypot(b.x-o.x,b.y-o.y)<48);
    if(cup) {
      drag.up(true);keyboardDrag=false;drawObjects();highlight();motionDirty=true;sendMotion();
      send(o.kind==='jasmine'?'add_jasmine':'pour_milk',{revision,bowl_id:cup.id,ingredient_id:o.id,...(fresh?{fresh_item:{id:o.id,kind:o.kind}}:{})});return;
    }
  }
  if(!cancel && inPot(drag.drag.o)) {
    const id=drag.drag.o.id;drag.up(true);keyboardDrag=false;drawObjects();highlight();motionDirty=true;sendMotion();send('boil',{revision,object_id:id});return;
  }
  if(!cancel && inCashBox(drag.drag.o)) {deposit();return;}
  if(!cancel && inTrash(drag.drag.o)) {discard();return;}
  const {o,fresh}=drag.drag;
  if(o.kind==='cooked' && (cancel || !workspace.objects.some(b=>b.kind==='bowl' && Math.hypot(b.x-o.x,b.y-o.y)<48))) {
    const p=NoodleLayout.workspaceToStage(o,layout,state?.template?.workflow);
    drag.up(true);keyboardDrag=false;drawObjects();highlight();motionDirty=true;sendMotion();
    send('drop_cooked',{revision,object_id:o.id,x:Math.max(0,Math.min(1280,p.x))});return;
  }
  const target=o.kind!=='cooked' && !cancel && targetCustomer();
  if(target) {
    drag.up(true);keyboardDrag=false;drawObjects();highlight();
    motionDirty=true;sendMotion();
    send('feed',{revision,object_id:o.id,...(fresh?{fresh_item:{id:o.id,kind:o.kind}}:{}),customer_id:target.id});return;
  }
  drag.up(cancel);keyboardDrag=false;drawObjects();
  motionDirty=true;sendMotion();
  if(!workspace.objects.some(o=>o.id===workspace.selected && ['bowl','water'].includes(o.kind))) workspace.selected=null;
  highlight();send('workspace',{revision,objects:workspace.objects,selected:workspace.selected});
}
async function takeCooked(pick) {
  pendingPot=pick;
  const next=await send('take_pot',{revision});
  if(pendingPot!==pick)return;
  pendingPot=null;
  const o=workspace.objects.find(o=>o.id===next?.object_serial && o.kind==='cooked');
  if(!o || state.mode!=='running')return;
  const old={x:o.x,y:o.y};Object.assign(o,NoodleLayout.stageToWorkspace(pick.point,layout,state?.template?.workflow));
  drag.drag={o,old,dx:0,dy:0,fresh:false};workspace.selected=null;keyboardDrag=!!pick.keyboard;
  drawObjects();highlight();motionDirty=true;sendMotion();
  if(pick.released)finish(!!pick.cancel);
}
async function takeCoffee(pick) {
  pendingPot=pick;
  const next=await send('take_coffee',{revision});
  if(pendingPot!==pick)return;
  pendingPot=null;
  const o=workspace.objects.find(o=>o.id===next?.selected && o.kind==='bowl');
  if(!o || state.mode!=='running')return;
  const old={x:o.x,y:o.y};Object.assign(o,NoodleLayout.stageToWorkspace(pick.point,layout,state?.template?.workflow));
  drag.drag={o,old,dx:0,dy:0,fresh:false};workspace.selected=o.id;keyboardDrag=!!pick.keyboard;
  drawObjects();highlight();motionDirty=true;sendMotion();
  if(pick.released)finish(!!pick.cancel);
}
$('stage').addEventListener('pointerdown',e=>{
  if(output) return;
  if(building) {
    if(e.button!==0) return;
    selectedItem=e.target.closest('[data-layout-item]')?.dataset.layoutItem || '';
    if(selectedItem) selectedModule=NoodleLayout.itemModule(selectedItem);
    buildDrag={p:stagePosition(e),initial:structuredClone(layout),item:selectedItem,module:selectedModule};
    applyLayout();parent.postMessage({type:'noodle-layout',layout,selected:selectedModule,item:selectedItem},location.origin);
    $('stage').setPointerCapture(e.pointerId);e.preventDefault();return;
  }
  if(e.button!==0||busy||state?.mode!=='running') return;
  if(e.target.closest('#bowl-rack')&&!burgerRecipe())return;
  if(burger.pointerDown(e))return;
  if(stir.pointerDown(e))return;
  if(drag.drag||throwDrag||pendingPot)return;
  const tool=e.target.closest('[data-template-tool]');
  if(tool) {
    if(tool.dataset.templateTool==='pot' && !state.sealed && knifeRecipe()) {
      $('stage').setPointerCapture(e.pointerId);e.preventDefault();
      takeCooked({point:stagePosition(e)});
    }
    if(tool.dataset.templateTool==='coffee' && !state.sealed && cafeRecipe()) {
      $('stage').setPointerCapture(e.pointerId);e.preventDefault();takeCoffee({point:stagePosition(e)});
    }
    return;
  }
  const litter=state.throws.find(item=>item.id===Number(e.target.closest('[data-throw-id]')?.dataset.throwId));
  if(litter) {
    const p=stagePosition(e),position=NoodleRules.throwPosition(litter);throwDrag={o:{...litter,...position},dx:position.x-p.x,dy:position.y-p.y};
    $('stage').setPointerCapture(e.pointerId);e.preventDefault();renderThrows(state.throws);motionDirty=true;sendMotion();drawChef();return;
  }
  const p=worldPosition(e);
  const source=ChefConfig.sources.find(s=>s.kind===(e.target.closest('#water-fridge')?'water':e.target.closest('[data-source]')?.dataset.source));
  let picked=drag.down(p.x,p.y) || (source && drag.down(source.x,source.y));
  const object=workspace.objects.find(o=>o.id===Number(e.target.closest('[data-object-id]')?.dataset.objectId));
  if(!picked && object){picked=drag.down(object.x,object.y);drag.drag.dx=object.x-p.x;drag.drag.dy=object.y-p.y;}
  if(picked) { $('stage').setPointerCapture(e.pointerId);e.preventDefault();drawObjects();motionDirty=true;sendMotion(); }
});
$('stage').addEventListener('pointermove',e=>{
  if(buildDrag) {
    const p=stagePosition(e),base=buildDrag.initial,item=buildDrag.item?NoodleLayout.itemConfig(layout,buildDrag.item):layout.modules[buildDrag.module];
    const original=buildDrag.item?NoodleLayout.itemConfig(base,buildDrag.item):base.modules[buildDrag.module],factor=buildDrag.item?base.modules[buildDrag.module].scale:1;
    const maxX=buildDrag.item?1280:600,maxY=buildDrag.item?720:360;
    item.x=Math.round(Math.max(-maxX,Math.min(maxX,original.x+(p.x-buildDrag.p.x)/factor)));
    item.y=Math.round(Math.max(-maxY,Math.min(maxY,original.y+(p.y-buildDrag.p.y)/factor)));
    applyLayout();parent.postMessage({type:'noodle-layout',layout},location.origin);return;
  }
  if(stir.pointerMove(e))return;
  if(burger.pointerMove(e))return;
  if(!output&&state?.mode==='running') {const p=stagePosition(e);localPointer={x:Math.max(0,Math.min(1280,p.x)),y:Math.max(0,Math.min(720,p.y))};motionDirty=true;paintMotion();}
  if(pendingPot && !pendingPot.released)pendingPot.point=stagePosition(e);
  if(throwDrag&&!keyboardDrag) {
    const p=stagePosition(e);throwDrag.o.x=Math.max(0,Math.min(1280,p.x+throwDrag.dx));throwDrag.o.y=Math.max(0,Math.min(720,p.y+throwDrag.dy));
    paintMotion();motionDirty=true;return;
  }
  if(!drag.drag||keyboardDrag) return;
  const p=worldPosition(e);drag.move(p.x,p.y);paintMotion();motionDirty=true;
});
$('stage').addEventListener('pointerup',e=>{if(buildDrag){buildDrag=null;return;}if(stir.pointerUp(e)||burger.pointerUp(e))return;if(pendingPot){pendingPot.point=stagePosition(e);pendingPot.released=true;return;}finish();motionDirty=true;sendMotion();});
$('stage').addEventListener('wheel',e=>{
  if(!building || output || buildDrag) return;
  const key=e.target.closest('[data-layout-item]')?.dataset.layoutItem || selectedItem;
  if(!key) return;
  e.preventDefault();selectedItem=key;selectedModule=NoodleLayout.itemModule(key);
  const item=NoodleLayout.itemConfig(layout,key);
  item.scale=Math.round(Math.max(.25,Math.min(2,item.scale+(e.deltaY<0?.05:-.05)))*100)/100;
  applyLayout();parent.postMessage({type:'noodle-layout',layout,selected:selectedModule,item:selectedItem},location.origin);
},{passive:false});
$('stage').addEventListener('pointercancel',()=>{if(buildDrag){layout=buildDrag.initial;buildDrag=null;applyLayout();parent.postMessage({type:'noodle-layout',layout},location.origin);return;}if(pendingPot){pendingPot.released=true;pendingPot.cancel=true;}else finish(true);});
$('stage').addEventListener('lostpointercapture',()=>{buildDrag=null;if(pendingPot && !pendingPot.released){pendingPot.released=true;pendingPot.cancel=true;}if((drag.drag||throwDrag)&&!keyboardDrag)finish(true);});
$('stage').addEventListener('pointerleave',()=>{if(!drag.drag&&!throwDrag&&!pendingPot){localPointer=null;motionDirty=true;drawChef();sendMotion();}});
addEventListener('blur',()=>{localPointer=null;if(pendingPot){pendingPot.released=true;pendingPot.cancel=true;}if(drag.drag||throwDrag)finish(true);drawChef();motionDirty=true;sendMotion();});
document.addEventListener('keydown',e=>{
  if(output||building||e.ctrlKey||e.altKey||e.metaKey||busy||state?.mode!=='running')return;
  if(burgerRecipe()&&!drag.drag&&!throwDrag&&e.target.closest('.burger-tool,#game-noodles,#game-sauce,#bowl-rack'))return;
  if(!drag.drag && !throwDrag && e.target.closest('[data-template-tool]'))return;
  if(throwDrag) {
    if(e.key==='Escape'){e.preventDefault();finishThrow(true);return;}
    if(e.key==='Enter') {
      e.preventDefault();
      if(e.target.id==='trash-bin') {const r=NoodleLayout.trashRect(layout,state?.template?.workflow),p=NoodleLayout.toStage({x:r.x+r.width/2,y:r.y+35},layout.modules.background);throwDrag.o.x=p.x;throwDrag.o.y=p.y;}
      finishThrow();return;
    }
    const delta={ArrowLeft:[-15,0],ArrowRight:[15,0],ArrowUp:[0,-15],ArrowDown:[0,15]}[e.key];
    if(delta){e.preventDefault();throwDrag.o.x=Math.max(0,Math.min(1280,throwDrag.o.x+delta[0]));throwDrag.o.y=Math.max(0,Math.min(720,throwDrag.o.y+delta[1]));renderThrows(state.throws);highlight();drawChef();motionDirty=true;}
    return;
  }
  if(drag.drag){
    if(cafeRecipe() && e.key==='Enter') {
      const cup=workspace.objects.find(o=>o.id===Number(e.target.closest('[data-object-id]')?.dataset.objectId) && o.kind==='bowl');
      const machine=e.target.id==='game-noodles' && drag.drag.o.kind==='bowl' && !drag.drag.o.coffee;
      if(machine || cup && ['jasmine','milk'].includes(drag.drag.o.kind)) {
        const p=machine?NoodleLayout.stageToWorkspace(NoodleLayout.toStage(NoodleLayout.stations(layout,state?.template?.workflow).find(s=>s.kind==='noodles'),layout.modules.counter),layout,state?.template?.workflow):cup;
        Object.assign(drag.drag.o,{x:p.x,y:p.y});e.preventDefault();finish();return;
      }
    }
    if(e.key==='Escape'){e.preventDefault();finish(true);return;}
    if(e.key==='Enter'){e.preventDefault();if(e.target.id==='trash-bin')discard();else if(e.target.id==='cash-box'&&drag.drag.o.kind==='coin')deposit();else if(e.target.closest('[data-customer-id]')){const {o,fresh}=drag.drag;drag.up(true);keyboardDrag=false;drawObjects();motionDirty=true;sendMotion();send('feed',{revision,object_id:o.id,...(fresh?{fresh_item:{id:o.id,kind:o.kind}}:{}),customer_id:Number(e.target.closest('[data-customer-id]').dataset.customerId)});}else finish();return;}
    const delta={ArrowLeft:[-15,0],ArrowRight:[15,0],ArrowUp:[0,-15],ArrowDown:[0,15]}[e.key];
    if(delta){e.preventDefault();drag.drag.o.x+=delta[0];drag.drag.o.y+=delta[1];drawObjects();highlight();motionDirty=true;}
  } else if(e.key==='Enter'){
    const litter=state.throws.find(item=>item.id===Number(e.target.closest('[data-throw-id]')?.dataset.throwId));
    if(litter){e.preventDefault();throwDrag={o:{...litter,...NoodleRules.throwPosition(litter)},dx:0,dy:0};keyboardDrag=true;renderThrows(state.throws);drawChef();motionDirty=true;return;}
    const source=e.target.closest('[data-source],#water-fridge');
    if(source?.id==='bowl-rack')return;
    const bowl=e.target.closest('[data-object-id]');
    const customer=e.target.closest('[data-customer-id]');
    if(source){e.preventDefault();const p=ChefConfig.sources.find(s=>s.kind===(source.id==='water-fridge'?'water':source.dataset.source));if(!p)return;drag.down(p.x,p.y);keyboardDrag=true;drawObjects();motionDirty=true;}
    else if(bowl){e.preventDefault();const o=workspace.objects.find(o=>o.id===Number(bowl.dataset.objectId));drag.down(o.x,o.y);keyboardDrag=true;drawObjects();motionDirty=true;}
    else if(customer){e.preventDefault();send('feed',{revision,bowl_id:workspace.selected,customer_id:Number(customer.dataset.customerId)});}
  }
});
[$('dough-board'),$('game-noodles')].forEach(button=>button.addEventListener('click',async event=>{
  if(button.dataset.templateTool==='coffee' && event.detail===0 && !output && !building && !busy && state?.mode==='running' && !state.sealed && !drag.drag && !pendingPot) {
    const machine=NoodleLayout.stations(layout,state?.template?.workflow).find(s=>s.kind==='noodles');await takeCoffee({point:NoodleLayout.toStage(machine,layout.modules.counter),keyboard:true});return;
  }
  if(output || building || busy || state?.mode!=='running' || state?.sealed || !knifeRecipe() || drag.drag || throwDrag || pendingPot)return;
  const tool=button.dataset.templateTool;
  if(tool==='pot') {
    if(event.detail===0) {
      const pot=NoodleLayout.stations(layout,state?.template?.workflow).find(s=>s.kind==='noodles');
      await takeCooked({point:NoodleLayout.toStage(pot,layout.modules.counter),keyboard:true});
    }
    return;
  }
  if(tool==='dough') {
    const r=NoodleLayout.propRect(layout,'dough',state?.template?.workflow);localPointer=NoodleLayout.toStage({x:r.x+r.width/2,y:r.y+r.height/2},layout.modules.counter);drawChef();motionDirty=true;sendMotion();
  }
  await send('slice',{revision});
}));
function finishThrow(cancel=false) {
  const {o}=throwDrag,discard=NoodleLayout.trashContains(o,layout,state?.template?.workflow);
  const bowl=!cancel && !discard && spoilTarget({...o,...NoodleLayout.stageToWorkspace(o,layout,state?.template?.workflow)});
  throwDrag=null;keyboardDrag=false;
  renderThrows(state.throws);highlight();drawChef();motionDirty=true;sendMotion();
  if(!cancel) send(bowl?'spoil':'move_throw',{revision,throw_id:o.id,throw_revision:o.revision,...(bowl?{bowl_id:bowl.id}:{x:o.x,y:o.y,discard})});
}
function renderThrows(items) {
  if(!showsCustomers)return;
  const shown=new Set(items.map(item=>item.id));
  for(const [id,el] of effects) if(!shown.has(id)) {clearTimeout(el.arrivalTimer);el.remove();effects.delete(id);}
  for(const item of items) {
    const age=Date.now()-item.at;
    if(!['leaf','egg','cockroach'].includes(item.kind)) continue;
    let el=effects.get(item.id);
    if(!el) {
      el=document.createElement('div');el.className='throw-effect throw-'+item.kind;
      el.dataset.throwId=item.id;el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',item.kind==='leaf'?'捡起菜叶':'捡起鸡蛋');
      el.style.setProperty('--from',(item.id%2?-180:1460)+'px');el.style.setProperty('--angle',item.angle+'deg');el.style.setProperty('--age',-Math.max(0,age)+'ms');
      if(age<850 && item.revision===0) {el.classList.add('arriving');el.arrivalTimer=setTimeout(()=>el.classList.remove('arriving'),850-Math.max(0,age));}
      const projectile=document.createElement('img');projectile.className='throw-projectile';projectile.alt='';el.append(projectile);
      if(item.kind==='cockroach'){const walk=document.createElement('span');walk.className='cockroach-walk';el.append(walk);}
      if(item.kind==='egg') {const impact=document.createElement('img');impact.className='throw-impact';impact.alt='';el.append(impact);}
      effects.set(item.id,el);$('throw-effects').append(el);
    }
    el.setAttribute('aria-label',item.kind==='cockroach'?'捡起小蟑螂':cafeRecipe()?(item.kind==='leaf'?'捡起臭生菜':'捡起臭鸡蛋'):(item.kind==='leaf'?'捡起菜叶':'捡起鸡蛋'));
    if(item.kind==='cockroach')el.querySelector('.cockroach-walk').style.backgroundImage=`url("${asset('cockroach_walk','cockroach-walk')}")`;
    const projectile=el.querySelector('.throw-projectile'),src=asset(item.kind,'throw-'+item.kind);if(projectile.getAttribute('src')!==src)projectile.src=src;
    const impact=el.querySelector('.throw-impact');if(impact){const src=asset('egg_splat','egg-splat');if(impact.getAttribute('src')!==src)impact.src=src;}
    const motion=remoteMotion?.revision===state?.workspace_revision?remoteMotion.drag:null;
    const moving=motion?.id===item.id && motion.kind===item.kind && motion.throw_revision===item.revision?NoodleLayout.workspaceToStage(motion,layout,state?.template?.workflow):null;
    const held=throwDrag?.o.id===item.id?throwDrag.o:moving,o=held||(item.kind==='cockroach'?NoodleRules.throwPosition(item):item);
    const stamp=[o.x,o.y,!!held,o.angle].join(':');
    if(el.dataset.paint===stamp)continue;
    el.dataset.paint=stamp;
    el.style.left=o.x+'px';el.style.top=o.y+'px';el.style.setProperty('--travel-x',((item.id%2?-180:1460)-o.x)+'px');el.classList.toggle('dragging',!!held);
    if(item.kind==='cockroach')el.style.setProperty('--angle',o.angle+'deg');
    if(held)el.classList.remove('arriving');
  }
}
setInterval(()=>{if(previewActive&&!building&&state?.mode==='running'&&state.throws.some(item=>item.kind==='cockroach'))renderThrows(state.throws);},80);
addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==parent||event.data.type!=='noodle-builder')return;
  try {
    building=Boolean(event.data.enabled);selectedModule=event.data.selected||'counter';selectedItem=event.data.item||'';
    if(building) renderMotion(null);
    if(throwDrag){throwDrag=null;keyboardDrag=false;renderThrows(state.throws);motionDirty=true;sendMotion();}
    if(!['background','counter','customers'].includes(selectedModule))return;
    if(drag.drag){drag.up(true);keyboardDrag=false;drawObjects();}
    layout=NoodleLayout.validate(event.data.layout||state.config.layout);applyLayout();
    applySign(NoodleSign.validate(event.data.sign||state.config.sign));
  }catch(error){toast(error.message);}
});
let source;
function connectScene() {
  source=new LuoboEvents('/api/events?scene=1');
  source.addEventListener('noodle',event=>{if(previewActive)render(JSON.parse(event.data));});
  source.addEventListener('noodle-motion',event=>{if(previewActive)renderMotion(JSON.parse(event.data));});
  source.onerror=()=>{presentationStamp='';toast('连接已断开，正在重连');for(const button of document.querySelectorAll('.station,.template-tool,#water-fridge,#cash-box,#trash-bin'))button.disabled=true;};
}
addEventListener('message', event => {
  if (!params.has('preview') || event.origin !== location.origin || event.source !== parent || event.data.type !== 'noodle-preview-visibility') return;
  const active = Boolean(event.data.visible);
  if (active === previewActive) return;
  previewActive = active;
  if (active) { connectScene(); return; }
  source?.close(); source = null;
  clearTimeout(raidTimer); clearTimeout(theftTimer); clearTimeout(motionTimer); cancelAnimationFrame(motionFrame); motionFrame = null;
  clearTimeout(sliceTimer); $('dough-board').classList.remove('slicing'); sliceStamp = '';
  clearTimeout(cafeTimer);$('cafe-effects').replaceChildren();cafeStamp='';
  for (const actor of actors.values()) { clearTimeout(actor.departureTimer); actor.remove(); }
  for (const effect of effects.values()) { clearTimeout(effect.arrivalTimer); effect.remove(); }
  actors.clear(); effects.clear(); $('workspace-objects').replaceChildren();
  $('shop-raid').replaceChildren(); $('shop-thief').replaceChildren(); $('shop-raid').hidden = true; $('shop-thief').hidden = true;
  if (drag.drag) drag.up(true);
  workspace.objects = []; throwDrag = null; remoteMotion = null; localPointer = null; revision = -1; presentationStamp = ''; raidStamp = ''; theftStamp = '';
});
addEventListener('pagehide', () => source?.close());
addEventListener('pageshow', event => { if (event.persisted && previewActive) connectScene(); });
if (previewActive) connectScene();
parent.postMessage({type:'noodle-ready'},location.origin);
