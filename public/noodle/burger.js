const $ = id => document.getElementById(id);
const toppings = { tomato: '番茄', lettuce: '生菜', cheese: '芝士', mustard: '黄芥末酱', ketchup: '番茄酱', salad: '沙拉酱', mayo: '蛋黄酱' };
const tools = [
  ['burger-raw', 'patty_raw', '生肉饼'], ['burger-tomato', 'tomato', '番茄'],
  ['burger-lettuce', 'lettuce', '生菜'], ['burger-cheese', 'cheese', '芝士'],
  ['burger-mustard', 'mustard', '黄芥末酱'], ['burger-top', 'bun_top', '盖上面包'],
  ['burger-ketchup','ketchup','番茄酱'], ['burger-salad','salad','沙拉酱'], ['burger-mayo','mayo','蛋黄酱']
];

export class BurgerScene {
  constructor(context) {
    this.context = context; this.drag = null;
    setInterval(() => this.refreshCooking(), 200);
    addEventListener('blur', () => this.cancel());
    addEventListener('pointercancel', () => this.cancel());
    addEventListener('keydown', e => { if (e.key === 'Escape') this.cancel(); });
    for (const id of ['game-noodles', 'game-sauce', 'bowl-rack', ...tools.map(([id]) => id)]) {
      $(id).addEventListener('click', e => {
        if (e.detail === 0 && this.enabled && this.context.canPlay()) this.activate(this.control(id));
      });
    }
  }
  get state() { return this.context.state(); }
  get layout() { return this.context.layout(); }
  get enabled() { return this.context.visible() && this.state?.template?.workflow === 'burger'; }
  applyTemplate() {
    for (const [id, slot, name] of tools) {
      const el = $(id); el.hidden = !this.enabled;
      if (this.enabled) { el.firstElementChild.src = this.state.template.assets[slot]; el.setAttribute('aria-label', name); }
    }
    for (const id of ['burger-oven-batches', 'burger-griddle-batches']) $(id).hidden = !this.enabled;
    if (!this.enabled) { this.cancel(); return; }
    document.title = '美式汉堡店 · 小萝卜游戏控制台';
    $('template-background').alt = '美式汉堡店背景';
    $('game-served').nextElementSibling.textContent = '个';
    for (const [id, slot, name] of [['game-noodles','griddle','煎台：熟肉饼拖到面包上'],['game-sauce','oven','烤箱：烤好后取出面包胚'],['bowl-rack','bun_raw','生面包胚：拖进烤箱或点击烘烤']]) {
      const el = $(id); el.hidden = false; el.firstElementChild.src = this.state.template.assets[slot]; el.firstElementChild.alt = name; el.setAttribute('aria-label', name);
    }
  }
  render() {
    if (!this.enabled) return;
    if (!this.context.canPlay()) this.cancel();
    for (const [id] of tools) $(id).disabled = !this.context.canPlay();
    this.refreshCooking();
  }
  refreshCooking() {
    if (!this.enabled) return;
    for (const food of ['bun', 'patty']) {
      const layer = $(food === 'bun' ? 'burger-oven-batches' : 'burger-griddle-batches');
      if(layer.dataset.template!==this.state.template.id){layer.dataset.template=this.state.template.id;layer.dataset.paint='';layer.replaceChildren();}
      const batches = this.state.cooking.filter(o => o.food === food);
      const stamp = batches.map(o => o.id + ':' + Math.max(0, Math.ceil((o.ready_at - Date.now()) / 1000))).join(',');
      if (layer.dataset.paint === stamp) continue;
      layer.dataset.paint = stamp;for(const el of layer.children)el.hidden=true;
      for (const [index,batch] of batches.entries()) {
        const ready = Date.now() >= batch.ready_at;
        let el=layer.children[index];
        if(!el){
          el=document.createElement('span');
          for(const slot of food==='bun'?['bun_raw','bun_top']:['patty_raw','patty_cooked']){const img=new Image();img.src=this.state.template.assets[slot];el.append(img);}
          el.append(document.createElement('small'));layer.append(el);
        }
        el.hidden=false;el.children[0].hidden=ready;el.children[1].hidden=!ready;
        el.children[0].alt='制作中';el.children[1].alt='已做好';
        el.className = 'burger-batch' + (ready ? ' ready' : '');
        el.querySelector('small').textContent = ready ? '可取出' : Math.max(1, Math.ceil((batch.ready_at - Date.now()) / 1000)) + '秒';
      }
    }
  }
  paint(el, item) {
    let stack = el.querySelector('.burger-stack');
    if (!this.enabled) { stack?.remove(); return; }
    for(const img of el.querySelectorAll('.bowl-art'))img.hidden=true;
    if (!stack) { stack = document.createElement('div'); stack.className = 'burger-stack'; el.append(stack); }
    const contaminants=item.contaminants??(item.spoiled?['leaf']:[]);
    const result=item.closed&&item.spoiled?(contaminants.includes('cockroach')?'cockroach_burger':'dirty_burger'):null;
    const layers = result?[result]:['bun_bottom', ...(item.patty ? ['patty_cooked'] : []), ...(item.toppings ?? []).map(key => ['mustard','ketchup','salad','mayo'].includes(key) ? key+'_layer' : key), ...contaminants.map(key=>key==='egg'?'egg_splat':key), ...(item.closed ? ['bun_top'] : [])];
    const stamp = JSON.stringify([layers, item.spoiled, this.state.template.id]);
    if (stack.dataset.paint !== stamp) {
      stack.dataset.paint = stamp;for(const img of stack.children)img.hidden=true;
      let bottom = 8;
      for (const [index,slot] of layers.entries()) {
        let img=stack.children[index];if(!img){img=new Image();stack.append(img);}
        const src=this.state.template.assets[slot];if(img.getAttribute('src')!==src)img.src=src;
        img.hidden=false;img.alt=result?(result==='dirty_burger'?'脏脏汉堡':'蟑螂汉堡'):'';
        img.className = result?'burger-result':'burger-layer layer-' + slot;
        img.style.bottom=result?'':bottom+'px';
        bottom += ({ bun_bottom: 15, patty_cooked: 15, cheese: 7, lettuce: 9, tomato: 9, mustard_layer: 5, ketchup_layer: 5, salad_layer: 5, mayo_layer: 5, bun_top: 0 })[slot]??8;
      }
    }
    el.setAttribute('aria-label', `拿起汉堡 ${item.id}，${result==='cockroach_burger'?'蟑螂汉堡':result==='dirty_burger'?'脏脏汉堡':item.spoiled?'已放入脏料，等待盖面包':item.closed?'已盖好':'制作中'}，${item.patty ? '熟肉饼' : '面包底'}${(item.toppings ?? []).map(key => '、' + toppings[key]).join('')}`);
  }
  point(e) {
    const r = $('stage').getBoundingClientRect(); return { x: (e.clientX-r.left)*1280/r.width, y: (e.clientY-r.top)*720/r.height };
  }
  control(id) {
    const kind = ({ 'bowl-rack':'raw-bun', 'game-sauce':'bun', 'burger-raw':'raw-patty', 'game-noodles':'patty', 'burger-top':'top' })[id] ?? id.replace('burger-', '');
    const food = kind === 'bun' ? 'bun' : kind === 'patty' ? 'patty' : null;
    const batch = food && (this.state.cooking.find(o => o.food === food && Date.now() >= o.ready_at) ?? this.state.cooking.find(o => o.food === food));
    return { kind, batch_id: batch?.id };
  }
  activate(held, bowl_id = this.state.selected, position) {
    const send = this.context.send;
    if (held.kind === 'raw-bun') return send('burger_bake');
    if (held.kind === 'raw-patty') return send('burger_grill');
    if (held.kind === 'bun') return send('burger_take_bun', { batch_id: held.batch_id, ...position });
    if (held.kind === 'patty') return send('burger_patty', { batch_id: held.batch_id, bowl_id });
    if (held.kind === 'top') return send('burger_close', { bowl_id });
    return send('burger_topping', { topping: held.kind, bowl_id });
  }
  pointerDown(e) {
    if (!this.enabled || !this.context.canPlay()) return false;
    const el = e.target.closest('.burger-tool,#game-noodles,#game-sauce,#bowl-rack');
    if (!el) return false;
    this.drag = { ...this.control(el.id), start: this.point(e), moved: false };
    $('stage').setPointerCapture(e.pointerId); e.preventDefault(); return true;
  }
  pointerMove(e) {
    const held = this.drag; if (!held) return false;
    const p = this.point(e);
    if (!held.moved && Math.hypot(p.x-held.start.x, p.y-held.start.y) > 6) {
      held.moved = true; const img = new Image();
      const slot = ({ 'raw-bun':'bun_raw', bun:'bun_bottom', 'raw-patty':'patty_raw', patty:'patty_cooked', top:'bun_top' })[held.kind] ?? held.kind;
      img.src = this.state.template.assets[slot]; img.alt = ''; $('burger-ghost').replaceChildren(img); $('burger-ghost').hidden = false;
    }
    Object.assign($('burger-ghost').style, { left: p.x-45+'px', top: p.y-30+'px' });
    this.context.pointer(p); return true;
  }
  pointerUp(e) {
    const held = this.drag; if (!held) return false;
    const target = document.elementFromPoint(e.clientX,e.clientY), bowl = target?.closest('[data-object-id]');
    this.cancel(); if (!this.context.canPlay()) return true;
    if (!held.moved) { this.activate(held); return true; }
    if (held.kind === 'raw-bun' && target?.closest('#game-sauce') || held.kind === 'raw-patty' && target?.closest('#game-noodles')) this.activate(held);
    else if (held.kind === 'bun') {
      const p = NoodleLayout.stageToWorkspace(this.point(e),this.layout,'burger');
      if (NoodleRules.contains(p.x,p.y,54)) this.activate(held,null,p);
    } else if (bowl) this.activate(held,Number(bowl.dataset.objectId));
    return true;
  }
  cancel() { this.drag = null; $('burger-ghost').hidden = true; $('burger-ghost').replaceChildren(); }
}
