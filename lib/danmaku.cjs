const path = require('node:path');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { readJson, atomicJson } = require('./storage.cjs');

// 弹幕姬：画面设置、背景图和观众用弹幕切换的定制气泡。两个平台各存一份（danmaku.json）。
const THEMES = ['wechat', 'candy', 'night'];
const FITS = ['cover', 'contain', 'custom'];
const WHO = ['all', 'fans', 'guard'];
const DEVICES = ['iphone', 'android', 'none'];
const ASSET = /^\/api\/feeding\/assets\/[a-f0-9]{64}\.(?:png|jpg|gif|webp|bmp)$/;
const BUILTIN = /^\/danmaku\/bubbles\/[a-z0-9-]+\.png$/;
const RESET_WORDS = ['切换默认气泡', '切换普通气泡'];
const MAX_BUBBLES = 20, MAX_USERS = 5000;

const num = (value, fallback, min, max, step = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Number((Math.round(n / step) * step).toFixed(6))));  // toFixed 去掉 42.980000000000004 这种浮点尾巴
};
const text = (value, fallback, max) => { const s = String(value ?? '').trim().slice(0, max); return s || fallback; };
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : fallback;
const image = value => ASSET.test(String(value || '')) ? String(value) : '';
const bubbleImage = value => BUILTIN.test(String(value || '')) ? String(value) : image(value);

// device：手机外壳（iphone 带灵动岛 / android / none 不要外壳）；group：微信群名，空着就用直播间标题；badges：显示全部身份标签。
const DEFAULT_SETTINGS = { theme: 'wechat', bg: true, size: 15, max: 40, fade: 0, big: 50, enter: false, social: true, like: false, device: 'iphone', group: '', badges: true };
const DEFAULT_BACKGROUND = { image: '', fit: 'cover', x: 50, y: 50, scale: 100, opacity: 100, blur: 0 };

function settingsOf(input = {}) {
  const d = DEFAULT_SETTINGS;
  return {
    theme: THEMES.includes(input.theme) ? input.theme : d.theme,
    bg: typeof input.bg === 'boolean' ? input.bg : d.bg,
    size: num(input.size, d.size, 10, 32), max: num(input.max, d.max, 5, 200), fade: num(input.fade, d.fade, 0, 600), big: num(input.big, d.big, 1, 100000),
    enter: typeof input.enter === 'boolean' ? input.enter : d.enter,
    social: typeof input.social === 'boolean' ? input.social : d.social,
    like: typeof input.like === 'boolean' ? input.like : d.like,
    device: DEVICES.includes(input.device) ? input.device : d.device,
    group: String(input.group ?? '').trim().slice(0, 30),
    badges: typeof input.badges === 'boolean' ? input.badges : d.badges
  };
}
function backgroundOf(input = {}) {
  const d = DEFAULT_BACKGROUND;
  return {
    image: image(input.image), fit: FITS.includes(input.fit) ? input.fit : d.fit,
    x: num(input.x, d.x, 0, 100), y: num(input.y, d.y, 0, 100), scale: num(input.scale, d.scale, 10, 400),
    opacity: num(input.opacity, d.opacity, 0, 100), blur: num(input.blur, d.blur, 0, 20)
  };
}
// 一个定制气泡：整张气泡图 + 文字放在图里的哪一块（四边留白，按图片宽高的百分比）。
function bubbleOf(input = {}, id) {
  const name = text(input.name, '专属气泡', 12);
  const box = input.box || {};
  const left = num(box.left, 48, 0, 90, 0.5), right = num(box.right, 9, 0, 90, 0.5), top = num(box.top, 33, 0, 90, 0.5), bottom = num(box.bottom, 28, 0, 90, 0.5);
  if (left + right > 95 || top + bottom > 95) throw new Error('文字区太小了，请把四边留白调小一点');
  // cap：左右两端原样不动的宽度（默认就是文字区留白）；比文字区宽时，文字可以伸进两端里空着的气泡部分。
  const cap = { left: Math.max(left, num(input.cap?.left, left, 0, 90, 0.01)), right: Math.max(right, num(input.cap?.right, right, 0, 90, 0.01)) };
  if (cap.left + cap.right > 98) throw new Error('气泡两端太宽了，中间没地方伸缩');
  return {
    id: /^[a-z0-9-]{1,40}$/.test(String(input.id || '')) ? String(input.id) : id || randomUUID(),
    name, keyword: text(input.keyword, `切换${name}`, 20),
    image: bubbleImage(input.image), ratio: num(input.ratio, 2, 0.2, 10, 0.0001),
    box: { left, right, top, bottom },
    cap,
    // tile：中段横向平铺而不是拉长（手绘虚线描边这种，拉长会变形）。
    tile: input.tile === true,
    // fixed：整张图原样显示、不横向伸缩（中间有装饰、花纹没法平铺的名牌框），大小跟着字号等比缩放，文字居中。
    fixed: input.fixed === true,
    width: num(input.width, 360, 120, 600), color: color(input.color, '#2b2b2b'), font: num(input.font, 100, 50, 200),
    who: WHO.includes(input.who) ? input.who : 'all'
  };
}
// 内置气泡：第一次启动时放进列表，之后和自己建的一样可以改、可以删（删了不会再冒出来）。
const BUILTIN_BUBBLES = [
  { id: 'luobo', name: '萝卜专属气泡', keyword: '切换萝卜专属气泡', image: '/danmaku/bubbles/luobo.png', ratio: 1000 / 379, box: { left: 48.5, right: 19, top: 26, bottom: 22 }, width: 360, color: '#2b2b2b', font: 100, who: 'all' },
  // 诉诉专属气泡（scripts/build-susu-bubble.py 生成）：左端狗耳少年和头顶的兔耳小女孩、右端骨头蝴蝶结原样保留，中间虚线段平铺。
  { id: 'susu', name: '诉诉专属气泡', keyword: '切换诉诉专属气泡', image: '/danmaku/bubbles/susu-v3.png', ratio: 577 / 163, box: { left: 29, right: 33, top: 33, bottom: 15.5 }, cap: { left: 42.98, right: 45.93 }, tile: true, width: 600, color: '#3a3a3a', font: 100, who: 'all' },
  // 茵茵专属气泡（scripts/build-yinyin-bubble.py 生成）：对称名牌框，顶上皇冠、底下蝴蝶结居中，整张原样不伸缩。
  { id: 'yinyin', name: '茵茵专属气泡', keyword: '切换茵茵专属气泡', image: '/danmaku/bubbles/yinyin.png', ratio: 1992 / 662, box: { left: 16.5, right: 17, top: 37.5, bottom: 30.5 }, fixed: true, width: 600, color: '#51435f', font: 100, who: 'all' }
];
// 换过图的内置气泡：老图片地址 → 内置气泡 id。存着老图的气泡换成新图和新的切线位置（名字、口令、字号这些自己改过的保留）。
const RETIRED_IMAGES = { '/danmaku/bubbles/susu.png': 'susu', '/danmaku/bubbles/susu-v2.png': 'susu' };
function upgradeBuiltinImage(bubble) {
  const def = BUILTIN_BUBBLES.find(b => b.id === RETIRED_IMAGES[bubble.image]);
  return def ? bubbleOf({ ...bubble, image: def.image, ratio: def.ratio, box: def.box, cap: def.cap, tile: def.tile, fixed: def.fixed }, bubble.id) : bubble;
}
function addBuiltins(state) {
  const seeded = new Set(state.seeded);
  // 倒着放到最前面：全新安装时顺序和列表一致，老用户新加的内置气泡排在最前。
  for (const item of [...BUILTIN_BUBBLES].reverse()) {
    if (seeded.has(item.id)) continue;
    seeded.add(item.id);
    const clash = state.bubbles.some(b => b.id === item.id || b.name === item.name || b.keyword === item.keyword);
    if (!clash && state.bubbles.length < MAX_BUBBLES) state.bubbles.unshift(bubbleOf(item, item.id));
  }
  state.seeded = [...seeded];
  return state;
}
const userKey = event => {
  const uid = String(event.uid ?? '');
  if (uid && uid !== '0') return `${event.platform || ''}:${uid}`;
  return event.user ? `name:${String(event.user).slice(0, 100)}` : '';
};
const allowed = (bubble, event) => bubble.who === 'all' || (bubble.who === 'guard' ? event.guard > 0 : event.guard > 0 || event.medalLevel > 0 || event.fansLevel > 0);
const WHO_TEXT = { fans: '粉丝牌 / 粉丝团', guard: '舰长及以上' };

class DanmakuBoard extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'danmaku.json');
    this.state = { settings: settingsOf(), background: backgroundOf(), bubbles: [], users: {}, seeded: [] };
  }
  async init() {
    const saved = await readJson(this.file, null);
    if (saved && typeof saved === 'object') {
      const bubbles = [];
      for (const item of Array.isArray(saved.bubbles) ? saved.bubbles.slice(0, MAX_BUBBLES) : []) { try { if (item?.image) bubbles.push(upgradeBuiltinImage(bubbleOf(item, item.id))); } catch {} }
      const ids = new Set(bubbles.map(b => b.id)), users = {};
      for (const [key, id] of Object.entries(saved.users && typeof saved.users === 'object' ? saved.users : {})) if (ids.has(id) && Object.keys(users).length < MAX_USERS) users[key] = id;
      const seeded = Array.isArray(saved.seeded) ? saved.seeded.filter(id => typeof id === 'string').slice(0, 50) : [];
      this.state = { settings: settingsOf(saved.settings), background: backgroundOf(saved.background), bubbles, users, seeded };
    }
    addBuiltins(this.state);
    return this;
  }
  // 画面拿到的状态：观众名单不发，每条消息由服务端标好用哪个气泡。
  snapshot() {
    const { settings, background, bubbles, users } = this.state;
    const builtin = new Set(BUILTIN_BUBBLES.map(b => b.id));
    const used = {};
    for (const id of Object.values(users)) used[id] = (used[id] || 0) + 1;
    return { settings, background, bubbles: bubbles.map(b => ({ ...b, users: used[b.id] || 0, builtin: builtin.has(b.id) })) };
  }
  queueSave() {
    this.saving = (this.saving || Promise.resolve()).then(() => this.save()).catch(error => this.emit('error-message', error.message));
    return this.saving;
  }
  async save() {
    await atomicJson(this.file, { version: 1, ...this.state });
    this.emit('state', this.snapshot());
  }
  async action(input = {}) {
    const next = structuredClone(this.state);
    if (input.action === 'settings') next.settings = settingsOf({ ...next.settings, ...input.settings });
    else if (input.action === 'background') next.background = backgroundOf({ ...next.background, ...input.background });
    else if (input.action === 'save_bubble') {
      const bubble = bubbleOf(input.bubble || {});
      if (!bubble.image) throw new Error('请先上传气泡图片');
      const index = next.bubbles.findIndex(b => b.id === bubble.id);
      if (index < 0 && next.bubbles.length >= MAX_BUBBLES) throw new Error(`最多 ${MAX_BUBBLES} 个定制气泡`);
      const clash = next.bubbles.find(b => b.id !== bubble.id && (b.keyword === bubble.keyword || b.name === bubble.name));
      if (clash) throw new Error(`「${clash.name}」已经用了这个名字或口令`);
      if (RESET_WORDS.includes(bubble.keyword)) throw new Error('这个口令留给「换回默认气泡」了');
      if (index < 0) next.bubbles.push(bubble); else next.bubbles[index] = bubble;
    } else if (input.action === 'delete_bubble') {
      next.bubbles = next.bubbles.filter(b => b.id !== input.id);
      for (const [key, id] of Object.entries(next.users)) if (id === input.id) delete next.users[key];
    } else if (input.action === 'clear_users') {
      next.users = input.id ? Object.fromEntries(Object.entries(next.users).filter(([, id]) => id !== input.id)) : {};
    } else throw new Error('弹幕姬操作无效');
    this.state = next;
    await this.save();
    return this.snapshot();
  }
  // 观众发「切换萝卜专属气泡」就换上；发「切换默认气泡」换回。返回要在画面上提示的话，不是口令返回 null。
  // 同步改状态（这条消息马上就要推给画面），存盘在后台排队。
  command(event) {
    if (event.type !== 'chat' || event.superChat) return null;
    const said = String(event.text || '').trim(), key = userKey(event);
    if (!key) return null;
    if (RESET_WORDS.includes(said)) {
      if (!this.state.users[key]) return { text: '现在用的就是默认气泡' };
      delete this.state.users[key]; this.queueSave();
      return { text: '换回了默认气泡' };
    }
    const bubble = this.state.bubbles.find(b => b.keyword === said);
    if (!bubble) return null;
    if (!allowed(bubble, event)) return { text: `还不能用「${bubble.name}」，${WHO_TEXT[bubble.who]}才能用` };
    if (this.state.users[key] !== bubble.id) {
      if (!this.state.users[key] && Object.keys(this.state.users).length >= MAX_USERS) return { text: '定制气泡的人数满了，请主播清理一下' };
      this.state.users[key] = bubble.id; this.queueSave();
    }
    return { text: `换上了「${bubble.name}」气泡`, bubble: bubble.id };
  }
  // 这位观众现在用哪个定制气泡（没有或没资格了返回空）。
  bubbleFor(event) {
    const id = this.state.users[userKey(event)];
    const bubble = id && this.state.bubbles.find(b => b.id === id);
    return bubble && allowed(bubble, event) ? bubble.id : '';
  }
}

module.exports = { DanmakuBoard, BUILTIN_BUBBLES, settingsOf, backgroundOf, bubbleOf, RESET_WORDS };
