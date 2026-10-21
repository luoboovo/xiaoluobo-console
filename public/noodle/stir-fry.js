const $=id=>document.getElementById(id),Food=globalThis.StirFryFood;

// 香锅只负责选菜、翻炒和撒料；碗、顾客、收钱与礼物共用原场景。
export class StirFryScene {
  constructor(context){this.context=context;this.template='';this.mix='';this.effect='';this.drag=null;setInterval(()=>this.refreshCooking(),160);addEventListener('blur',()=>this.cancel());addEventListener('pointercancel',()=>this.cancel());addEventListener('keydown',e=>{if(e.key==='Escape')this.cancel();});}
  get state(){return this.context.state();}
  get layout(){return this.context.layout();}
  get enabled(){return this.context.visible()&&this.state?.template?.workflow==='stir-fry';}
  sprite(id){
    const item=Food.ingredients.find(food=>food.id===id),el=document.createElement('span');el.className='food-sprite';el.dataset.category=item.category;
    el.style.backgroundImage=`url("${this.state.template.assets.ingredient_sheet}")`;el.style.backgroundPosition=`${item.index%4*100/3}% ${Math.floor(item.index/4)*50}%`;return el;
  }
  fillMix(container,items){
    container.replaceChildren();for(let i=0;i<Math.min(42,items.length*3);i++){
      const el=this.sprite(items[i%items.length]),angle=i*2.39996;Object.assign(el.style,{left:105+Math.cos(angle)*(24+i%5*10)+'px',top:18+Math.sin(angle)*13+'px'});
      el.style.setProperty('--mix-x',Math.cos(i*1.8)*24+'px');el.style.setProperty('--mix-up',-25-i%4*7+'px');el.style.setProperty('--mix-roll',(i%2?1:-1)*(16+i%4*6)+'deg');el.style.setProperty('--mix-delay',-i*97+'ms');container.append(el);
    }
  }
  applyTemplate(){
    if(!this.enabled){delete $('stir-basket-food').dataset.paint;this.sheet=null;this.template='';}
    for(const id of ['stir-cabinet','stir-fridge-shelves'])$(id).hidden=!this.enabled;
    if(!this.enabled){this.cancel();$('stir-basket-food').replaceChildren();$('stir-wok-food').replaceChildren();$('game-noodles').classList.remove('stir-cooking','stir-ready');$('game-sauce').setAttribute('aria-label','拖出臊子');$('game-sauce').firstElementChild.alt='臊子保温桶';$('water-fridge').setAttribute('aria-label','取一瓶圣水');$('water-fridge').firstElementChild.alt='圣水冰柜';return;}
    document.title='麻辣香锅 · 小萝卜游戏控制台';
    $('stir-cabinet-art').src=this.state.template.assets.cabinet;
    $('game-sauce').firstElementChild.src=this.state.template.assets.sesame;$('game-sauce').setAttribute('aria-label','拿起芝麻撒进香锅');
    $('game-noodles').setAttribute('aria-label','把炒熟的食材拖进空碗');
    $('game-noodles').firstElementChild.alt='大铁锅与炉灶';$('game-sauce').firstElementChild.alt='芝麻';$('water-fridge').firstElementChild.alt='上层可乐下层冰红茶的冰柜';$('water-fridge').setAttribute('aria-label','饮料冰柜');$('template-background').alt='麻辣香锅店背景';
    if(this.template!==this.state.template.id){
      this.template=this.state.template.id;this.mix='';this.effect='';$('stir-ingredients').replaceChildren();
      // 篮子和锅同时清空时仍保留精灵图引用，避免下一锅重新生成解码缓存。
      this.sheet=new Image();this.sheet.src=this.state.template.assets.ingredient_sheet;
      for(const item of Food.ingredients){const el=document.createElement('button');el.dataset.stirIngredient=item.id;el.setAttribute('aria-label','取'+item.name);$('stir-ingredients').append(el);}
    }
  }
  applyLayout(){
    if(!this.enabled)return;
    const r=NoodleLayout.propRect(this.layout,'dough','stir-fry');Object.assign($('stir-cabinet').style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});
    const f=NoodleLayout.propRect(this.layout,'fridge','stir-fry');Object.assign($('stir-fridge-shelves').style,{left:f.x+'px',top:f.y+'px',width:f.width+'px',height:f.height+'px'});
    $('game-noodles').style.setProperty('--stir-pot-scale',NoodleLayout.stations(this.layout,'stir-fry').find(s=>s.kind==='noodles').width/347);
    this.cancel();
  }
  render(){
    if(!this.enabled)return;const scene=this.state.stirfry,stamp=JSON.stringify(scene.wok.ingredients);
    if(stamp!==this.mix){this.mix=stamp;this.fillMix($('stir-wok-food'),scene.wok.ingredients);}
    const basket=$('stir-basket-food'),basketStamp=JSON.stringify([this.state.template.id,scene.basket.slice(-14)]);
    if(basket.dataset.paint!==basketStamp){basket.dataset.paint=basketStamp;basket.replaceChildren(...scene.basket.slice(-14).map(id=>this.sprite(id)));}
    for(const el of document.querySelectorAll('#stir-ingredients button,#stir-fridge-shelves button'))el.disabled=!this.context.canPlay();
    const effect=scene.garnish_effect;
    if(effect&&effect.id!==this.effect){this.effect=effect.id;if(Date.now()-effect.at<1050)this.pour(effect);}
    this.refreshCooking();
  }
  refreshCooking(){
    if(!this.enabled)return;const wok=this.state.stirfry.wok,ready=Food.ready(wok),cooking=!!wok.ingredients.length&&!ready&&this.state.mode==='running'&&!this.state.sealed;
    $('game-noodles').classList.toggle('stir-cooking',cooking);$('game-noodles').classList.toggle('stir-ready',ready);
    $('stir-wok-food').classList.toggle('mixing',cooking);$('stir-wok-food').classList.toggle('cooked',ready||!!(wok.started_at&&Date.now()-wok.started_at>900));
  }
  pour(effect){
    const p=NoodleLayout.fromStage(NoodleLayout.workspaceToStage(effect,this.layout,'stir-fry'),this.layout.modules.counter),layer=$('stir-effects'),pour=document.createElement('div');pour.className='garnish-pour';Object.assign(pour.style,{left:p.x-34+'px',top:p.y-116+'px'});
    const img=new Image();img.src=this.state.template.assets['portion_'+effect.garnish];img.alt='';pour.append(img);layer.append(pour);setTimeout(()=>pour.remove(),1100);
    for(let i=0;i<22;i++){const seed=effect.garnish==='sesame',el=seed?document.createElement('i'):new Image();el.className='sprinkle-particle '+(seed?'sesame-particle':'herb-particle');if(!seed){el.src=this.state.template.assets['portion_'+effect.garnish];el.alt='';}Object.assign(el.style,{left:p.x-45+i*37%90+'px',top:p.y-70+'px'});el.style.setProperty('--fall-x',(i%5-2)*6+'px');el.style.setProperty('--fall-delay',i%7*35+'ms');layer.append(el);setTimeout(()=>el.remove(),1150);}
  }
  point(e){const r=$('stage').getBoundingClientRect();return{x:(e.clientX-r.left)*1280/r.width,y:(e.clientY-r.top)*720/r.height};}
  pointerDown(e){
    if(!this.enabled||!this.context.canPlay())return false;
    const el=e.target.closest('[data-stir-ingredient],[data-stir-drink],#game-noodles,#game-sauce,#scallions-bowl,#cilantro-bowl,#bowl-area');if(!el)return false;
    const kind=el.dataset.stirIngredient?'ingredient':el.dataset.stirDrink?'drink':el.id==='game-noodles'?'cooked':el.id==='bowl-area'?'basket':'garnish';
    if(kind==='cooked'&&!Food.ready(this.state.stirfry.wok)||kind==='basket'&&!this.state.stirfry.basket.length)return true;
    const value=el.dataset.stirIngredient||el.dataset.stirDrink||({'game-sauce':'sesame','scallions-bowl':'scallions','cilantro-bowl':'cilantro'}[el.id]);
    this.drag={kind,value,start:this.point(e),moved:false,wok_id:this.state.stirfry.wok.id};$('stage').setPointerCapture(e.pointerId);e.preventDefault();return true;
  }
  pointerMove(e){
    if(!this.drag)return false;const p=this.point(e),held=this.drag;
    if(!held.moved&&Math.hypot(p.x-held.start.x,p.y-held.start.y)>6){
      held.moved=true;const ghost=$('stir-ghost');ghost.hidden=false;ghost.replaceChildren();
      if(held.kind==='ingredient')ghost.append(this.sprite(held.value));
      else if(held.kind==='basket')ghost.append(...this.state.stirfry.basket.slice(0,3).map(id=>this.sprite(id)));
      else if(held.kind==='cooked'){const mix=document.createElement('div');mix.className='stir-ghost-mix cooked';this.fillMix(mix,this.state.stirfry.wok.ingredients);ghost.append(mix);}
      else{const img=new Image();img.src=this.state.template.assets[held.kind==='garnish'?'portion_'+held.value:held.value];img.alt='';ghost.append(img);}
    }
    Object.assign($('stir-ghost').style,{left:p.x-40+'px',top:p.y-40+'px'});return true;
  }
  pointerUp(e){
    const held=this.drag;if(!held)return false;const target=document.elementFromPoint(e.clientX,e.clientY),bowl=target?.closest('[data-object-id]'),customer=target?.closest('[data-customer-id]');this.cancel();
    if(!this.context.canPlay())return true;const send=this.context.send;
    if(!held.moved){
      if(held.kind==='ingredient')send('stir_pick',{ingredient:held.value});
      if(held.kind==='drink')send('stir_drink',{drink:held.value});
      if(held.kind==='garnish')send('stir_garnish',{garnish:held.value,bowl_id:this.state.selected});return true;
    }
    if(target?.closest('#trash-bin')){if(held.kind==='basket')send('stir_discard',{target:'basket'});return true;}
    if(target?.closest('#game-noodles')){if(held.kind==='ingredient')send('stir_add',{ingredient:held.value});if(held.kind==='basket')send('stir_add');return true;}
    if(bowl){const id=Number(bowl.dataset.objectId);if(held.kind==='cooked')send('stir_plate',{bowl_id:id,wok_id:held.wok_id});if(held.kind==='garnish')send('stir_garnish',{bowl_id:id,garnish:held.value});return true;}
    if(held.kind==='ingredient'&&target?.closest('#bowl-area'))send('stir_pick',{ingredient:held.value});
    if(held.kind==='drink')send('stir_drink',{drink:held.value}).then(next=>{if(customer&&next)send('feed',{object_id:next.selected,customer_id:Number(customer.dataset.customerId)});});
    return true;
  }
  cancel(){this.drag=null;$('stir-ghost').hidden=true;$('stir-ghost').replaceChildren();}
}
