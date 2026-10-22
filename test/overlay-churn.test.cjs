const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFile(path.join(__dirname,'..','public',file),'utf8');
// 吸收任意属性和调用的假元素，只记录测试关心的 innerHTML 写入。
function element(log = {}) {
  const target = { style:{ setProperty(){} }, dataset:{}, classList:{ toggle(){}, add(){}, remove(){}, contains:()=>false } };
  return new Proxy(target,{
    get:(object,key) => key in object ? object[key] : key === 'getContext' ? () => element() : typeof key === 'symbol' ? undefined : (...args) => args.length ? element() : undefined,
    set:(object,key,value) => { if (key === 'innerHTML') log.innerHTML = (log.innerHTML || 0) + 1; object[key] = value; return true; }
  });
}
function events(context) {
  context.sources = [];
  context.LuoboEvents = class extends EventTarget { static OPEN = 1; constructor(url) { super(); this.url = url; context.sources.push(this); } close() {} };
  context.emit = (type, data) => { for (const source of context.sources) source.dispatchEvent(new MessageEvent(type,{ data:JSON.stringify(data) })); };
}

test('礼物面板内容不变时不重建礼物图片，规则或样式变化时照常更新', async () => {
  const log = {}, rules = element(log), overlay = element(), title = element();
  const elements = { '#rules':rules, '.overtime-overlay':overlay, '#title':title };
  const context = vm.createContext({ location:{ search:'?panel=p1' }, URLSearchParams, JSON, MessageEvent, EventTarget, CustomEvent:Event,
    document:{ title:'', body:element(), querySelector:selector => elements[selector] ??= element(), querySelectorAll:() => [], addEventListener(){} } });
  context.window = context.globalThis = context; context.dispatchEvent = () => true;
  events(context);
  vm.runInContext(await read('overtime/shared.js'),context);
  vm.runInContext(await read('overtime/overlay.js'),context);
  const panel = { id:'p1', name:'加班面板', columns:2, all_rules:true, gift_keys:[], style:{} };
  const state = (gift_rules, extra = {}) => ({ mode:'running', remaining:'60', config:{ gift_panels:[{ ...panel, ...extra }], gift_rules } });
  const giftRules = [{ gift_id:1, gift_name:'加班花', operation:'add', value:30 }];
  for (let i = 0; i < 50; i++) context.emit('overtime',state(giftRules));
  assert.equal(log.innerHTML,1);
  assert.match(rules.innerHTML,/\/api\/gifts\/1\/image/);
  context.emit('overtime',state([...giftRules,{ gift_id:2, gift_name:'翻倍', operation:'multiply', value:2 }]));
  assert.equal(log.innerHTML,2);
  assert.match(rules.innerHTML,/\/api\/gifts\/2\/image/);
  context.emit('overtime',state(giftRules,{ name:'新名字' }));
  assert.equal(title.textContent,'新名字');
  assert.equal(context.document.title,'新名字 · 浮窗');
});

test('吃吃吃同一音效复用一个播放器，最多保留 8 个，切平台和离开页面时释放', async () => {
  const created = [];
  class FakeAudio {
    constructor(src) { this.src = src; this.plays = 0; this.released = false; this.currentTime = 5; created.push(this); }
    play() { this.plays++; return Promise.resolve(); }
    pause() {}
    removeAttribute(name) { if (name === 'src') { this.src = ''; this.released = true; } }
    load() {}
  }
  const listeners = {};
  const context = vm.createContext({ location:{ search:'' }, URLSearchParams, JSON, MessageEvent, EventTarget, Map, Set, Math, Date, Promise,
    crypto:{ randomUUID:() => 'client' }, innerWidth:1280, innerHeight:720, devicePixelRatio:1, performance:{ now:() => 0 },
    requestAnimationFrame(){}, setInterval(){}, setTimeout(){}, fetch:() => new Promise(() => {}), Image:class { decode() { return Promise.resolve(); } }, Audio:FakeAudio,
    addEventListener:(type, listener) => { listeners[type] = listener; }, dispatchEvent:() => true, CustomEvent:Event,
    document:{ getElementById:() => element() } });
  context.globalThis = context;
  events(context);
  vm.runInContext(await read('feeding/shared.js'),context);
  vm.runInContext(await read('feeding/game.js'),context);
  let cue = 0;
  const sounds = Object.fromEntries(Array.from({ length:10 },(_,i) => [`eat${i}`,`/api/feeding/assets/s${i}.mp3`]));
  const state = (kind, platform = 'bilibili') => ({ platform, revision:1, objects:[], consumer:{ x:0, y:0 }, stats:{ x:0, y:0 }, eaten:0, count:0,
    cue:{ id:String(++cue), kind, time:Date.now() },
    config:{ sound_enabled:true, sound_files:{ eat:sounds[kind] || sounds.eat0, ...sounds }, food_sound_files:{}, food_images:[], active_theme_id:context.Feeding.themes[0].id, consumer_image:'' } });
  for (let i = 0; i < 200; i++) context.emit('feeding',state('eat0'));
  assert.equal(created.length,1);
  assert.equal(created[0].plays,200);
  assert.equal(created[0].currentTime,0);
  // 不同音效各自一个播放器，超过 8 个时释放最久未用的那个。
  for (let i = 1; i < 10; i++) context.emit('feeding',state(`eat${i}`));
  assert.equal(created.length,10);
  assert.deepEqual(created.filter(clip => clip.released).map(clip => clip.src),['','']);
  assert.equal(created.filter(clip => !clip.released).length,8);
  context.emit('feeding',state('eat9','douyin'));
  assert.equal(created.filter(clip => !clip.released).length,1);
  listeners.pagehide();
  assert.ok(created.every(clip => clip.released));
});
