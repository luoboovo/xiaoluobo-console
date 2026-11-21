'use strict';
// 闯关模式 · 第一关：泽小酱军团（观众） vs 鱼僵军（系统）。
// 角色占位图由 chars.js 生成，正式生图到位后放进 assets/ 并在 SPRITE_FILES 里登记即可替换。
const W = 1920, H = 1080, SKY_H = 404, GROUND_TOP = 820, GROUND_BOT = 1010;
const cv = document.getElementById('cv'), mainCtx = cv.getContext('2d', { alpha: false });
let ctx = mainCtx;
// 性能参数：?res=720 用 1280x720 渲染（OBS 里再放大），?fps=30 限制帧率
const QS = new URLSearchParams(location.search);
// 默认接小萝卜控制台：开局/暂停听控制台的，弹幕和礼物变成「指令」送过来。?demo 是不连控制台的单机演示（带模拟面板）。
const DEMO = QS.has('demo'), PREVIEW = QS.has('preview');
const srv = { mode: DEMO ? 'running' : 'idle', round: null, platform: 'bilibili' };
let lastSeq = null, matchNo = 1;
const RES = QS.get('res') === '720' ? 720 / 1080 : 1;
const FPS = Math.max(20, Math.min(60, +QS.get('fps') || 60));
cv.width = Math.round(W * RES); cv.height = Math.round(H * RES); ctx.imageSmoothingQuality = 'low';
// 数量上限：超过就不再加入，保证弹幕刷屏时帧率稳定
const LIMIT = { L: 90, clown: 60, R: 45, parts: 320, texts: 45, bubbles: 6 };
const FONT = '"Microsoft YaHei","PingFang SC",sans-serif';
const IMG = {}, META = {};
const TEX_KEYS = ['tex_blue_suit', 'tex_clown_bow', 'tex_clown_pants', 'tex_clown_scarf', 'tex_clown_wig', 'tex_giant_suit', 'tex_gourd_top', 'tex_spear_pants', 'tex_spear_vest', 'tex_venom_mask', 'tex_venom_suit', 'tex_web_mask', 'tex_web_suit', 'tex_white_uniform'];

const TEAM = {
  L: { name: '泽小酱军团', color: '#3b8fe8', dark: '#0f2f5c', dir: 1, juice: ['#ffd54a', '#ff6b9a', '#6fd3ff', '#9cff6b'] },
  R: { name: '鱼僵军', color: '#d8343a', dark: '#5a1014', dir: -1, juice: ['#ff4a4a', '#ffb02e', '#ffffff'] }
};
const FOE = { L: 'R', R: 'L' };
const TYPES = {
  ze: { team: 'L', name: '泽小酱', sp: 'ze', hp: 900, atk: 16, range: 380, cd: 1.3, speed: 0, scale: 0.84, proj: 'shock' },
  clown: { team: 'L', name: '小丑兵', sp: 'clown', hp: 45, atk: 7, range: 190, cd: 1.1, speed: 82, scale: 0.56, proj: 'hat' },
  web: { team: 'L', name: '蛛网侠', sp: 'web', hp: 70, atk: 6, range: 320, cd: 1.4, speed: 74, scale: 0.6, proj: 'web' },
  venom: { team: 'L', name: '黑毒侠', sp: 'venom', hp: 260, atk: 11, range: 72, cd: 1.1, speed: 56, scale: 0.68, armor: 0.45 },
  blue: { team: 'L', name: '蓝皮侠', sp: 'blue', hp: 60, atk: 14, range: 470, cd: 1.5, speed: 66, scale: 0.62, proj: 'arrow' },
  spear: { team: 'L', name: '红肚兜小将', sp: 'spear', hp: 120, atk: 18, range: 95, cd: 1.3, speed: 92, scale: 0.64, pierce: 180 },
  gourd: { team: 'L', name: '紫葫芦娃', sp: 'gourd', hp: 450, atk: 16, range: 85, cd: 1.2, speed: 56, scale: 0.76, special: 'suck', spCd: 7 },
  white: { team: 'L', name: '白毛大佬', sp: 'white', hp: 400, atk: 26, range: 320, cd: 1.3, speed: 56, scale: 0.76, proj: 'orb', special: 'domain', spCd: 9 },
  thug: { team: 'R', name: '条纹小弟', sp: 'thug', hp: 48, atk: 6, range: 70, cd: 1.0, speed: 72, scale: 0.58 },
  guard: { team: 'R', name: '抱胸亲卫', sp: 'guard', hp: 220, atk: 12, range: 74, cd: 1.2, speed: 56, scale: 0.68, armor: 0.4 },
  yu: { team: 'R', name: '鱼僵军', sp: 'yu', hp: 5200, atk: 34, range: 125, cd: 1.4, speed: 40, scale: 1.05, splash: 140, boss: true }
};
const GIFTS = [['小礼物', ['web', 'venom']], ['中礼物', ['blue', 'spear']], ['大礼物', ['gourd', 'white']], ['超级礼物', ['giant']]];
// 右边（鱼僵军阵营）观众送礼：小礼物召唤亲卫，中礼物放虾线，大礼物放辣椒水
const GIFTS_R = [['小礼物', 'guard'], ['中礼物', 'whip'], ['大礼物', 'spray']];
// 兵种和技能的名字，控制台「兵种名字」里可以改（画面、播报、礼物说明都用这里）
const UNIT_NAMES = { clown: '小丑兵', web: '蛛网侠', venom: '黑毒侠', blue: '蓝皮侠', spear: '红肚兜小将', gourd: '紫葫芦娃', white: '白毛大佬', giant: '胖光之巨人', thug: '条纹小弟', guard: '抱胸亲卫', whip: '虾线攻击', spray: '辣椒水' };
const WAVES = [
  { title: '第 1 波', list: [['thug', 8, 1.5]] },
  { title: '第 2 波', list: [['thug', 10, 1.2], ['guard', 2, 7]] },
  { title: '鱼僵军 亲自出战！', list: [['yu', 1, 0], ['thug', 6, 1.8]], boss: true }
];
const NAMES = ['小番茄爱吃糖', '夜猫子', '路过的阿杰', '今天也要加油', '奶茶三分糖', '摸鱼达人', '咸鱼翻身', '老王不在家', '小鹿乱撞', '星星点灯', '吃瓜群众', '柠檬不酸', '阿伟', '可乐加冰', '南风知意', '月半弯', '土豆丝', '大橘为重', '一只小熊', '起风了', '芝士就是力量', '早睡早起', '奶盖', '云朵棉花糖', '火锅底料', '周末快乐', '雨天的猫', '小透明', '饭团', '打工人'];
const TAUNTS = ['就这？', '过来啊！', '一群 Cos 仔', '泽小酱，你不行', '还有谁？'];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.random() * a.length | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const depth = y => 0.86 + 0.28 * (y - GROUND_TOP) / (GROUND_BOT - GROUND_TOP);

let S;
function newState() {
  const s = {
    t: 0, intro: 0, wave: -1, queue: [], waveT: 0, nextWaveT: 0,
    units: [], bullets: [], parts: [], texts: [], rings: [], feed: [], bubbles: [], domains: [], vortex: [], ults: [], giants: [], whips: [], sprays: [],
    viewers: {}, shake: 0, banner: null, over: null, endT: 0, autoT: 1, ze: null, boss: null, pendingCues: [], delayed: [], uid: 0
  };
  S = s;
  s.ze = addUnit('ze', 230, 925, '泽小酱');
  return s;
}

// ---------- 素材 ----------
async function load() {
  const meta = await (await fetch('assets/sprites.json')).json();
  const loadImg = src => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = src; });
  IMG.bg_battlefield = await loadImg('assets/bg_battlefield.png'); META.bg_battlefield = meta.bg_battlefield;
  const TEX = {};
  await Promise.all(TEX_KEYS.map(async k => { try { TEX[k] = await loadImg('assets/' + k + '.png'); } catch (e) { /* 缺纹理时用纯色 */ } }));
  for (const [k, v] of Object.entries(makeChars(TEX))) { IMG[k] = v.img; META[k] = v.meta; }
  // 正式生图：chars.json 里登记的 PNG 覆盖代码占位图；norm 把高清图缩放到和占位图一样的身高
  const real = await (await fetch('assets/chars.json')).json();
  for (const [k, m] of Object.entries(real)) {
    // 角色图会经常替换，PNG 默认被浏览器缓存一天，所以加时间戳强制取最新
    try { IMG[k] = await loadImg('assets/' + k + '.png?v=' + Date.now()); META[k] = { ...m, norm: 0.78 * FOOT_Y / m.h, real: true }; } catch (e) { /* 缺图时保留占位图 */ }
  }
  // 鱼僵军目前只有站立图：攻击、狂暴、认输先复用站立图，动作由代码做
  if (META.yu_idle.real) for (const k of ['yu_attack', 'yu_rage', 'yu_kneel']) if (!(META[k] && META[k].real)) { IMG[k] = IMG.yu_idle; META[k] = { ...META.yu_idle, alias: k }; }
  bakeSprites();
}

// 性能关键：战场上每帧大量“大图缩小绘制”非常慢。加载时把每个兵种的图预先缩放到战场最大显示尺寸，
// 战斗中按接近 1:1 贴图；开场、结算等需要放大的地方仍用原图（ORIG）。
const ORIG_IMG = {}, ORIG_META = {};
function bakeSprites() {
  const giant = { scale: 2.0 };
  for (const T of [...Object.values(TYPES), giant]) {
    const sp = T.sp || 'giant';
    for (const pose of ['idle', 'attack', 'rage', 'kneel']) {
      const key = sp + '_' + pose, im = IMG[key], m = META[key]; if (!im || ORIG_IMG[key]) continue;
      ORIG_IMG[key] = im; ORIG_META[key] = m;
      const k = T.scale * 1.14 * (m.norm || 1);
      const c = document.createElement('canvas'); c.width = Math.ceil(im.width * k); c.height = Math.ceil(im.height * k);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
      IMG[key] = c; META[key] = { ...m, w: c.width, h: m.h * k, footX: m.footX * k, norm: (m.norm || 1) / k, baked: true };
    }
  }
}

// ---------- 单位 ----------
function viewer(name, team) {
  if (!S.viewers[name]) S.viewers[name] = { name, team, dmg: 0, kills: 0 };
  return S.viewers[name];
}
function feed(text, team) { S.feed.unshift({ text, team, t: 0 }); S.feed.length = Math.min(S.feed.length, 5); }
function bubble(u, text, dur = 2.2) { S.bubbles = S.bubbles.filter(b => b.u !== u); S.bubbles.push({ u, text, t: 0, dur }); if (S.bubbles.length > LIMIT.bubbles) S.bubbles.shift(); }

function addUnit(type, x, y, owner) {
  const T = TYPES[type], dir = TEAM[T.team].dir;
  const u = { id: ++S.uid, type, T, team: T.team, dir, owner, x, y, hp: T.hp, max: T.hp, cd: rand(0, 0.5), atk: -1, hitDone: false, age: 0, walk: rand(0, 6), flash: 0, knock: 0, dead: false, deadT: 0, vx: 0, vy: 0, rot: 0, dy: 0, slowT: 0, frozenT: 0, forcedT: 0, forced: null, spT: T.spCd ? T.spCd * 0.5 : 0, moved: false };
  S.units.push(u);
  return u;
}

function spawnL(type, name) {
  if (S.over || S.intro < INTRO_LEN) return;
  if (type === 'giant') return castGiant(name);
  if (type === 'clown' && S.units.some(u => u.owner === name && u.type === 'clown' && !u.dead)) return;
  const mine = S.units.filter(u => u.team === 'L' && !u.dead && u.type !== 'ze');
  if (mine.length >= LIMIT.L) return;
  if (type === 'clown' && mine.filter(u => u.type === 'clown').length >= LIMIT.clown) return;
  viewer(name, 'L');
  const u = addUnit(type, rand(120, 200), rand(GROUND_TOP + 10, GROUND_BOT - 10), name);
  puff(u.x, u.y, type === 'clown' ? 6 : 14);
  if (type !== 'clown') { feed(`${name} 送出礼物，召唤 ${TYPES[type].name}`, 'L'); ring(u.x, u.y, TEAM.L.color, 160); }
  if (type === 'gourd' || type === 'white') { S.shake = Math.max(S.shake, 8); bubble(u, type === 'gourd' ? '葫芦，收！' : '交给我吧'); }
}
function spawnViewerR(type, name) {
  if (S.over || S.intro < INTRO_LEN) return;
  if (type === 'whip' || type === 'spray') return castGiftSkill(type, name);
  if (type === 'thug' && S.units.some(u => u.owner === name && u.type === 'thug' && !u.dead)) return;
  const u = spawnR(type); if (!u) return;
  u.owner = name; viewer(name, 'R');
  if (type !== 'thug') { feed(`${name} 送出礼物，召唤 ${TYPES[type].name}`, 'R'); ring(u.x, u.y, TEAM.R.color, 160); }
}
// 送礼释放鱼僵军技能：鱼僵军在场就由他放；还没登场时从右边营地放出
function castGiftSkill(kind, name) {
  viewer(name, 'R');
  const origin = S.boss && !S.boss.dead ? S.boss : { x: 1830, y: 930, dir: -1, team: 'R', virtual: true };
  (kind === 'whip' ? castWhip : castSpray)(origin, name);
}
function spawnR(type) {
  if (type !== 'yu' && S.units.filter(u => u.team === 'R' && !u.dead).length >= LIMIT.R) return null;
  const u = addUnit(type, rand(1960, 2020), rand(GROUND_TOP + 10, GROUND_BOT - 10), null);
  if (type === 'yu') { u.y = 930; S.boss = u; u.tauntT = 6; u.ultT = 0; u.skillT = 4; u.skillN = 0; bubble(u, '谁敢来我的地盘？', 3); }
  return u;
}

function castGiant(name) {
  viewer(name, 'L');
  S.giants.push({ owner: name, t: 0, x: 380, y: 960, hit: false });
  feed(`${name} 召唤了「${UNIT_NAMES.giant}」！`, 'L');
}

// ---------- 特效 ----------
function budget(n) { return Math.max(0, Math.min(n, LIMIT.parts - S.parts.length)); }
function puff(x, y, n) { n = budget(n); for (let i = 0; i < n; i++) S.parts.push({ x: x + rand(-30, 30), y: y + rand(-6, 4), vx: rand(-90, 90), vy: rand(-70, -10), g: 60, life: rand(0.4, 0.8), max: 0.8, size: rand(8, 16), color: 'rgba(235,225,200,0.8)', soft: true }); }
function burst(x, y, team, n, confetti) { n = budget(n); const c = TEAM[team].juice; for (let i = 0; i < n; i++) S.parts.push({ x, y, vx: rand(-280, 280), vy: rand(-420, -80), g: 900, life: rand(0.5, 0.9), max: 0.9, size: rand(4, 9), color: pick(c), rect: confetti, rot: rand(0, 6) }); }
function ring(x, y, color, r) { S.rings.push({ x, y, color, r, t: 0 }); }
function floatText(text, x, y, color, size) { if (S.texts.length >= LIMIT.texts) S.texts.shift(); S.texts.push({ text, x: x + rand(-12, 12), y, color, size, t: 0 }); }

// ---------- 战斗 ----------
function damage(target, dmg, src) {
  if (S.over || target.dead) return;
  const real = dmg * (1 - (target.T.armor || 0));
  target.hp -= real; target.flash = 0.16; target.knock = target.T.boss ? 0.3 : 1;
  const owner = src && src.owner ? viewer(src.owner, src.team) : null;
  if (owner) owner.dmg += real;
  floatText('-' + Math.round(real), target.x, target.y - 165 * target.T.scale * depth(target.y), target.T.boss ? '#ffb347' : '#ffe14d', target.T.boss ? 38 : 30);
  burst(target.x, target.y - 60, target.team, target.T.boss ? 4 : 6);
  if (target.hp > 0) return;
  target.dead = true; target.deadT = 0;
  if (owner) owner.kills++;
  if (target.T.boss) {
    target.kneel = true; S.shake = 30; burst(target.x, target.y - 80, 'R', 40);
    bubble(target, '服了……', 4); feed(`${src && src.owner || '军团'} 打出最后一击，鱼僵军认输了！`, 'L');
    S.endT = 2.6; S.ending = 'win';
    for (const u of S.units) if (u.team === 'R' && !u.dead && u !== target) { u.hp = 0; u.dead = true; u.deadT = 0; u.vx = rand(200, 400); u.vy = -rand(500, 700); }
    return;
  }
  if (target.type === 'ze') { S.shake = 20; S.endT = 1.8; S.ending = 'lose'; bubble(target, '我还会回来的……', 3); return; }
  target.vx = -target.dir * rand(260, 420); target.vy = -rand(520, 720);
  burst(target.x, target.y - 60, target.team, target.type === 'clown' ? 26 : 14, target.type === 'clown');
}

function enemiesOf(u) { return S.units.filter(e => !e.dead && !e.flee && e.team !== u.team); }

// 鱼僵军技能一：虾线攻击——甩出一根长长的虾线，横扫前方一整排
function castWhip(u, owner) {
  S.whips.push({ u, x: u.x, y: u.y - 120, dir: u.dir, len: 760, t: 0, hit: false, src: { owner, team: 'R' } });
  if (!u.virtual) { bubble(u, '吃我虾线！', 1.6); u.atk = 0; u.hitDone = true; }
  feed(owner ? `${owner} 送出礼物，鱼僵军使出「${UNIT_NAMES.whip}」！` : `鱼僵军 使出「${UNIT_NAMES.whip}」！`, 'R');
}
// 鱼僵军技能二：辣椒水攻击——前方扇形喷射，小丑兵全部吓跑
function castSpray(u, owner) {
  S.sprays.push({ u, x: u.x + u.dir * 40, y: u.y - 130, dir: u.dir, t: 0, hit: false, src: { owner, team: 'R' } });
  if (!u.virtual) { bubble(u, '辣椒水伺候！', 1.8); u.atk = 0; u.hitDone = true; }
  feed(owner ? `${owner} 送出礼物，鱼僵军喷出「${UNIT_NAMES.spray}」！${UNIT_NAMES.clown}全跑了！` : `鱼僵军 喷出「${UNIT_NAMES.spray}」！${UNIT_NAMES.clown}全跑了！`, 'R');
}
function updateWhip(w, dt) {
  w.t += dt;
  if (w.t >= 0.28 && !w.hit) {
    w.hit = true; S.shake = Math.max(S.shake, 12);
    for (const e of S.units) {
      if (e.dead || e.flee || e.team === w.u.team) continue;
      const dx = (e.x - w.x) * w.dir;
      if (dx > 0 && dx < w.len && Math.abs(e.y - (w.y + 120)) < 140) { damage(e, e.type === 'ze' ? 30 : 45, w.src); if (!e.dead) e.knock = 1; }
    }
  }
  if (w.t > 0.9) w.done = true;
}
function updateSpray(s, dt) {
  s.t += dt;
  if (s.t < 1) for (let i = 0, n = budget(3); i < n; i++) {
    const a = rand(-0.35, 0.35), sp = rand(500, 900);
    S.parts.push({ x: s.x, y: s.y, vx: Math.cos(a) * sp * s.dir, vy: Math.sin(a) * sp, g: 120, life: rand(0.5, 0.8), max: 0.8, size: rand(4, 9), color: pick(['#ff3b1f', '#ff6a2a', '#ffb02e', 'rgba(255,80,40,0.6)']) });
  }
  if (s.t >= 0.25 && !s.hit) {
    s.hit = true;
    let n = 0;
    for (const e of S.units) {
      if (e.dead || e.flee || e.team === s.u.team) continue;
      if (e.type === 'clown') { e.flee = true; e.fleeT = 0; e.atk = -1; if (n++ % 3 === 0) bubble(e, pick(['辣眼睛！', '快跑啊！', '呜呜呜', '扛不住了']), 1.4); continue; }
      const dx = (e.x - s.x) * s.dir;
      if (dx > 0 && dx < 650) { damage(e, e.type === 'ze' ? 25 : 30, s.src); e.slowT = Math.max(e.slowT, 2.5); }
    }
  }
  if (s.t > 1.4) s.done = true;
}
function findTarget(u) {
  if (u.forced && !u.forced.dead && u.forcedT > 0) return u.forced;
  let best = null, bd = 1e9;
  for (const e of S.units) {
    if (e.dead || e.flee || e.team === u.team) continue;
    if ((e.x - u.x) * u.dir < -60 && !(u.team === 'R' && e.type === 'ze')) continue;
    const d = Math.abs(e.x - u.x) + Math.abs(e.y - u.y) * 0.3;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function attackHit(u, t) {
  const T = u.T, s = T.scale * depth(u.y), atk = T.atk * (u.rage ? 1.3 : 1);
  if (T.proj) {
    S.bullets.push({ kind: T.proj, team: u.team, owner: u.owner, x: u.x + u.dir * 50 * s, y: u.y - 120 * s, sx: u.x + u.dir * 50 * s, sy: u.y - 120 * s, tx: t.x, ty: t.y - 70, target: t, t: 0, dur: clamp(Math.abs(t.x - u.x) / 750, 0.25, 0.7), dmg: atk, dir: u.dir });
  } else if (T.pierce) {
    u.x += u.dir * 40;
    for (const e of enemiesOf(u)) { const dx = (e.x - u.x) * u.dir; if (dx > -30 && dx < T.pierce && Math.abs(e.y - u.y) < 130) damage(e, atk, u); }
    for (let i = 0, n = budget(6); i < n; i++) S.parts.push({ x: u.x - u.dir * rand(0, 60), y: u.y - rand(0, 20), vx: -u.dir * rand(40, 120), vy: rand(-60, -10), g: 0, life: 0.4, max: 0.4, size: rand(5, 10), color: pick(['#ff9a2a', '#ffd23a', '#ff4a2a']) });
  } else if (T.splash) {
    for (const e of enemiesOf(u)) if (Math.abs(e.x - t.x) < T.splash && Math.abs(e.y - t.y) < 150) damage(e, atk, u);
    ring(t.x, t.y, TEAM[u.team].color, T.splash); S.shake = Math.max(S.shake, 6);
  } else damage(t, atk, u);
}

function special(u) {
  const foes = enemiesOf(u).filter(e => { const dx = (e.x - u.x) * u.dir; return dx > -40 && dx < 420; });
  if (!foes.length) return false;
  if (u.T.special === 'suck') {
    const cx = u.x + u.dir * 100;
    S.vortex.push({ x: cx, y: u.y - 60, t: 0 });
    for (const e of foes) { if (!e.T.boss) { e.pullX = cx + u.dir * rand(10, 50); e.pullT = 0.8; } damage(e, 20, u); }
    bubble(u, '收！', 1.2); u.atk = 0; u.hitDone = true;
  } else if (u.T.special === 'domain') {
    const c = foes.reduce((s, e) => s + e.x, 0) / foes.length;
    S.domains.push({ x: c, y: 930, r: 290, t: 0, dur: 3 });
    for (const e of enemiesOf(u)) if (Math.abs(e.x - c) < 290) { e.frozenT = e.T.boss ? 1.5 : 3; damage(e, 15, u); }
    bubble(u, '结界展开', 1.6); S.shake = Math.max(S.shake, 8); u.atk = 0; u.hitDone = true;
  }
  return true;
}

function updateBoss(u, dt) {
  if (!u.rage && u.hp < u.max * 0.5) {
    u.rage = true; S.shake = 22; bubble(u, '你们惹毛我了！', 2.5); feed('鱼僵军 狂暴了！亲卫出动！', 'R');
    for (let i = 0; i < 4; i++) { const g = spawnR('guard'); if (g) g.x = u.x + rand(40, 160); }
  }
  u.skillT -= dt;
  if (u.skillT <= 0 && u.atk < 0) {
    const clowns = S.units.filter(e => e.type === 'clown' && !e.dead && !e.flee).length;
    // 交替释放；场上小丑多的时候优先喷辣椒水
    if (u.skillN % 2 === 1 || clowns >= 8) castSpray(u); else castWhip(u);
    u.skillN++; u.skillT = u.rage ? 5 : 7;
    return;
  }
  u.tauntT -= dt;
  if (u.tauntT <= 0) {
    u.tauntT = 10; bubble(u, pick(TAUNTS));
    for (const e of enemiesOf(u)) if (Math.abs(e.x - u.x) < 460 && e.type !== 'ze') { e.forced = u; e.forcedT = 3; }
    ring(u.x, u.y, '#ff4a4a', 460);
  }
  if (u.hp < u.max * 0.2) {
    u.ultT -= dt;
    if (u.ultT <= 0) {
      u.ultT = 9;
      const near = enemiesOf(u).filter(e => Math.abs(e.x - u.x) < 1000);
      const x = near.length ? near.reduce((s, e) => s + e.x, 0) / near.length : S.ze.x;
      S.ults.push({ x: clamp(x, 200, 1700), y: 930, r: 240, t: -1.3, hit: false });
      bubble(u, '吃我一拳！', 1.8);
    }
  }
}

function updateUnit(u, dt) {
  u.age += dt; u.flash = Math.max(0, u.flash - dt); u.knock = Math.max(0, u.knock - dt * 5);
  if (u.dead) {
    u.deadT += dt;
    if (!u.kneel && u.type !== 'ze') { u.x += u.vx * dt; u.dy += u.vy * dt; u.vy += 1500 * dt; u.rot += -u.dir * 11 * dt; }
    return;
  }
  if (u.flee) {
    u.fleeT += dt; u.x -= 320 * dt; u.walk += dt * 1.6; u.moved = true;
    if (Math.random() < dt * 6 && S.parts.length < LIMIT.parts) S.parts.push({ x: u.x + rand(-10, 10), y: u.y - 120 * u.T.scale * depth(u.y), vx: rand(-60, 60), vy: rand(-160, -60), g: 700, life: 0.5, max: 0.5, size: 5, color: '#6fc8ff' });
    return;
  }
  u.slowT = Math.max(0, u.slowT - dt); u.forcedT = Math.max(0, u.forcedT - dt);
  if (u.frozenT > 0) { u.frozenT -= dt; return; }
  if (u.pullT > 0) { u.pullT -= dt; u.x += (u.pullX - u.x) * Math.min(1, dt * 6); u.moved = true; return; }
  if (u.T.boss) updateBoss(u, dt);
  u.cd -= dt;
  if (u.T.special) u.spT -= dt;
  u.moved = false;
  if (u.atk >= 0) {
    u.atk += dt;
    if (u.atk / 0.55 >= 0.5 && !u.hitDone) { u.hitDone = true; if (u.target && !u.target.dead) attackHit(u, u.target); }
    if (u.atk >= 0.55) u.atk = -1;
    return;
  }
  const t = findTarget(u); u.target = t;
  if (u.T.special && u.spT <= 0 && special(u)) { u.spT = u.T.spCd; return; }
  const speed = u.T.speed * (u.slowT > 0 ? 0.4 : 1) * (u.rage ? 1.5 : 1);
  if (!t) {
    if (u.team === 'L' && u.x < 1300 && speed) { u.x += u.dir * speed * dt; u.walk += dt; u.moved = true; }
    return;
  }
  const d = Math.abs(t.x - u.x) - (t.T.boss ? 40 : 15);
  if (d <= u.T.range) {
    if (u.cd <= 0) { u.atk = 0; u.hitDone = false; u.cd = u.T.cd * rand(0.9, 1.1) / (u.rage ? 1.3 : 1); }
  } else if (speed) {
    u.x += Math.sign(t.x - u.x) * speed * dt; u.walk += dt; u.moved = true;
    if (u.T.range < 200) u.y += clamp(t.y - u.y, -1, 1) * 30 * dt;
  }
}

function updateBullet(b, dt) {
  b.t += dt; const p = Math.min(1, b.t / b.dur);
  if (b.target && !b.target.dead) { b.tx = b.target.x; b.ty = b.target.y - 70; }
  const arc = b.kind === 'orb' || b.kind === 'shock' ? 0 : Math.sin(p * Math.PI) * Math.min(150, Math.abs(b.tx - b.sx) * 0.22);
  const nx = b.sx + (b.tx - b.sx) * p, ny = b.sy + (b.ty - b.sy) * p - arc;
  b.ang = Math.atan2(ny - b.y, nx - b.x); b.x = nx; b.y = ny;
  if (p < 1) return;
  b.done = true;
  let hit = b.target && !b.target.dead ? b.target : S.units.find(e => !e.dead && e.team !== b.team && Math.abs(e.x - b.x) < 50);
  if (!hit) return;
  damage(hit, b.dmg, b);
  if (b.kind === 'web') { hit.slowT = 3; }
  if (b.kind === 'orb') ring(b.x, hit.y, '#6fb8ff', 70);
}

function updateUlt(k, dt) {
  k.t += dt;
  if (k.t >= 0.4 && !k.hit) {
    k.hit = true; S.shake = 26; ring(k.x, k.y, '#ff3030', k.r); puff(k.x, k.y, 24); burst(k.x, k.y - 40, 'R', 26);
    for (const e of S.units) if (!e.dead && e.team === 'L' && Math.abs(e.x - k.x) < k.r && Math.abs(e.y - k.y) < 190) damage(e, e.type === 'ze' ? 60 : 90, null);
  }
  if (k.t > 1.2) k.done = true;
}

function updateGiant(g, dt) {
  g.t += dt;
  if (g.t >= 0.95 && !g.hit) {
    g.hit = true; S.shake = 30;
    for (const e of S.units) if (!e.dead && e.team === 'R') damage(e, e.T.boss ? 320 : 170, { owner: g.owner, team: 'L' });
  }
  if (g.t > 3.3) g.done = true;
}

// ---------- 波次 ----------
function startWave(i) {
  S.wave = i; S.waveT = 0; S.queue = [];
  for (const [type, n, gap] of WAVES[i].list) for (let k = 0; k < n; k++) S.queue.push({ type, at: 1 + k * gap + (type === 'guard' ? 3 : 0) });
  S.queue.sort((a, b) => a.at - b.at);
  S.banner = { text: WAVES[i].title, t: 0, boss: !!WAVES[i].boss };
  if (WAVES[i].boss) S.shake = 16;
}
function updateWaves(dt) {
  S.waveT += dt;
  while (S.queue.length && S.queue[0].at <= S.waveT) spawnR(S.queue.shift().type);
  if (S.wave === WAVES.length - 1 && S.waveT > 12 && S.waveT % 5 < dt) spawnR('thug');
  const alive = S.units.some(u => u.team === 'R' && !u.dead && !u.owner); // 观众加入的小弟不算在波次里
  if (!S.queue.length && !alive && S.wave < WAVES.length - 1) {
    S.nextWaveT += dt; if (S.nextWaveT > 2.5) { S.nextWaveT = 0; startWave(S.wave + 1); }
  }
}

function autoSim(dt) {
  S.autoT -= dt; if (S.autoT > 0) return;
  S.autoT = rand(0.3, 0.85);
  const name = pick(NAMES), r = Math.random();
  if (Math.random() < 0.3) {
    if (r < 0.01) spawnViewerR('spray', name);
    else if (r < 0.025) spawnViewerR('whip', name);
    else if (r < 0.07) spawnViewerR('guard', name);
    else spawnViewerR('thug', name);
    return;
  }
  if (r < 0.003) spawnL('giant', name);
  else if (r < 0.009) spawnL(pick(['gourd', 'white']), name);
  else if (r < 0.04) spawnL(pick(['blue', 'spear']), name);
  else if (r < 0.11) spawnL(pick(['web', 'venom']), name);
  else spawnL('clown', name);
}

const INTRO_LEN = 4.6;
function update(dt) {
  if (srv.mode !== 'running') return; // 控制台没开始或暂停时画面停住
  S.t += dt;
  if (S.intro < INTRO_LEN) { S.intro += dt; if (S.intro >= INTRO_LEN) { startWave(0); for (const c of S.pendingCues.splice(0)) applyCue(c); } return; }
  for (const d of S.delayed) if (d.at <= S.t) { d.done = true; d.fn(); }
  S.delayed = S.delayed.filter(d => !d.done);
  if (!S.over) {
    if (S.endT > 0) { S.endT -= dt; if (S.endT <= 0) finish(S.ending === 'win'); }
    else { updateWaves(dt); if (DEMO && document.getElementById('auto').checked) autoSim(dt); }
  } else { S.over.t += dt; if (S.over.t > 12) { newState(); matchNo++; } }
  for (const u of S.units) updateUnit(u, dt);
  for (const b of S.bullets) updateBullet(b, dt);
  for (const k of S.ults) updateUlt(k, dt);
  for (const g of S.giants) updateGiant(g, dt);
  for (const w of S.whips) updateWhip(w, dt);
  for (const s of S.sprays) updateSpray(s, dt);
  S.whips = S.whips.filter(w => !w.done); S.sprays = S.sprays.filter(s => !s.done);
  for (const p of S.parts) { p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.rect) p.rot += dt * 8; }
  for (const a of [S.texts, S.rings, S.feed, S.bubbles, S.domains, S.vortex]) for (const o of a) o.t += dt;
  if (S.banner) S.banner.t += dt;
  S.units = S.units.filter(u => !(u.dead && u.deadT > 1.1 && !u.kneel && u.type !== 'ze') && !(u.flee && u.x < -120));
  S.bullets = S.bullets.filter(b => !b.done); S.ults = S.ults.filter(k => !k.done); S.giants = S.giants.filter(g => !g.done);
  S.parts = S.parts.filter(p => p.life > 0);
  S.texts = S.texts.filter(t => t.t < 0.9); S.rings = S.rings.filter(r => r.t < 0.5);
  S.bubbles = S.bubbles.filter(b => b.t < b.dur && !(b.u.dead && !b.u.kneel && b.u.type !== 'ze'));
  S.domains = S.domains.filter(d => d.t < d.dur); S.vortex = S.vortex.filter(v => v.t < 0.9);
  S.shake = Math.max(0, S.shake - dt * 40);
  // 场上超过 45 个单位时切到简化绘制，低于 35 再切回（留缓冲避免来回抖）
  const n = S.units.length;
  if (n > 45) S.lodOn = true; else if (n < 35) S.lodOn = false;
}

function finish(win) {
  const top = Object.values(S.viewers).filter(v => v.team === (win ? 'L' : 'R')).sort((a, b) => b.dmg - a.dmg).slice(0, 3);
  S.over = { win, t: 0, top };
  // 战绩回报给控制台（预览和单机演示不报；同一局开着多个画面时控制台只记第一次）
  if (!DEMO && leader) fetch('/api/battle/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Luobo-Platform': srv.platform }, body: JSON.stringify({ action: 'report', match: matchNo, result: win ? 'win' : 'lose', mvp: top.map(v => ({ name: v.name, dmg: v.dmg })) }) }).catch(() => {});
}

// ---------- 绘制 ----------
function spr(key, x, y, o) {
  let m = META[key], im = IMG[key]; if (!im) return;
  // 需要放大显示时（开场、结算、头像）改用原图，避免糊
  if (m.baked && o.scale * m.norm * Math.max(o.sx || 1, o.sy || 1) > 1.15) { m = ORIG_META[key]; im = ORIG_IMG[key]; }
  const n = m.norm || 1;
  let rot = o.rot || 0, sy = o.sy || 1, tint = o.tint;
  if (m.alias === 'yu_kneel') { rot += (o.flip ? -1 : 1) * 0.22; sy *= 0.82; }
  if (m.alias === 'yu_rage' && !tint) tint = 'rage';
  ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot);
  ctx.scale((o.flip ? -1 : 1) * o.scale * n * (o.sx || 1), o.scale * n * sy);
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  ctx.drawImage(tint ? tinted(key, tint, im) : im, -m.footX, -m.h);
  if (m.alias === 'yu_kneel') { ctx.fillStyle = '#8fd3ff'; ctx.strokeStyle = '#2b1d16'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-m.footX + 20, -m.h * 0.92); ctx.quadraticCurveTo(-m.footX - 4, -m.h * 0.84, -m.footX + 20, -m.h * 0.8); ctx.quadraticCurveTo(-m.footX + 44, -m.h * 0.84, -m.footX + 20, -m.h * 0.92); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}
// ---------- 渲染缓存（性能） ----------
// ctx.filter 和描边文字都很耗性能：染色版精灵图、描边文字都只渲染一次，之后直接贴图。
const TINTS = { flash: 'rgba(255,255,255,0.72)', ice: 'rgba(150,210,255,0.5)', rage: 'rgba(255,40,30,0.3)', black: '#000' };
const tintCache = new Map();
function tinted(key, kind, im = IMG[key]) {
  const id = key + '|' + kind + '|' + im.width; let c = tintCache.get(id);
  if (!c) {
    c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = TINTS[kind]; g.fillRect(0, 0, c.width, c.height);
    tintCache.set(id, c);
  }
  return c;
}
const textCache = new Map();
function text(str, x, y, size, color, align = 'center', stroke = 'rgba(0,0,0,0.75)', lw = 5) {
  str = String(str);
  const id = str + '|' + size + '|' + color + '|' + stroke + '|' + lw; let c = textCache.get(id);
  if (!c) {
    if (textCache.size > 600) textCache.clear();
    const font = `bold ${size}px ${FONT}`; ctx.font = font;
    const w = Math.ceil(ctx.measureText(str).width + lw * 2 + 4), h = Math.ceil(size * 1.4 + lw * 2);
    c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = h;
    const g = c.getContext('2d'); g.font = font; g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = lw; g.strokeStyle = stroke; g.strokeText(str, lw + 2, h / 2); g.fillStyle = color; g.fillText(str, lw + 2, h / 2);
    textCache.set(id, c);
  }
  const ox = align === 'center' ? c.width / 2 : align === 'right' ? c.width - 2 : 2;
  ctx.drawImage(c, x - ox, y - c.height / 2);
}
let bgCache = null, legendCache = null;
const lodCache = new Map();
function lodSprite(key, T, lvl, flip, tint) {
  const id = key + '|' + lvl + '|' + flip + '|' + (tint || ''); let c = lodCache.get(id);
  if (c) return c;
  const im = ORIG_IMG[key] || IMG[key], m = ORIG_META[key] || META[key];
  const k = T.scale * (0.86 + 0.28 * lvl / 3) * (m.norm || 1);
  const cv2 = document.createElement('canvas'); cv2.width = Math.ceil(im.width * k); cv2.height = Math.ceil(im.height * k);
  const g = cv2.getContext('2d'); g.imageSmoothingQuality = 'high';
  if (flip) { g.translate(cv2.width, 0); g.scale(-1, 1); }
  g.drawImage(im, 0, 0, cv2.width, cv2.height);
  if (tint) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-atop'; g.fillStyle = TINTS[tint]; g.fillRect(0, 0, cv2.width, cv2.height); }
  c = { img: cv2, h: m.h * k, footX: flip ? cv2.width - m.footX * k : m.footX * k };
  lodCache.set(id, c);
  return c;
}
function rr(x, y, w, h, r, fill) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill(); }

function drawBackground() {
  if (!bgCache) {
    bgCache = document.createElement('canvas'); bgCache.width = W; bgCache.height = H;
    const b = bgCache.getContext('2d'), g = b.createLinearGradient(0, 0, 0, SKY_H);
    g.addColorStop(0, '#4f98dc'); g.addColorStop(1, '#a9d8f5');
    b.fillStyle = g; b.fillRect(0, 0, W, SKY_H + 4); b.imageSmoothingQuality = 'high';
    b.drawImage(IMG.bg_battlefield, 0, SKY_H, W, H - SKY_H);
  }
  ctx.drawImage(bgCache, 0, 0);
  flag(70, 940, '泽', TEAM.L.color, 1); flag(1850, 940, '鱼', TEAM.R.color, -1);
}
function flag(x, y, ch, color, dir) {
  ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 230); ctx.stroke();
  const w = Math.sin(S.t * 3 + x) * 8;
  ctx.beginPath(); ctx.moveTo(x, y - 225); ctx.quadraticCurveTo(x + dir * 60, y - 240 + w, x + dir * 120, y - 225 + w); ctx.lineTo(x + dir * 120, y - 150 + w); ctx.quadraticCurveTo(x + dir * 60, y - 165 - w, x, y - 150); ctx.closePath();
  ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#222'; ctx.lineWidth = 4; ctx.stroke();
  text(ch, x + dir * 60, y - 188 + w / 2, 46, '#fff', 'center', '#222', 6);
}

function unitPose(u) {
  const s = u.T.scale * depth(u.y), sp = u.T.sp;
  let x = u.x, y = u.y, rot = 0, sx = 1, sy = 1, key = sp + (u.rage ? '_rage' : '_idle'), alpha = 1;
  if (u.age < 0.35) { const p = u.age / 0.35; sx = sy = p < 0.7 ? p / 0.7 * 1.15 : 1.15 - 0.15 * (p - 0.7) / 0.3; }
  if (u.kneel) key = 'yu_kneel';
  else if (u.type === 'ze' && u.dead) { rot = -Math.min(1, u.deadT / 0.5) * 1.4; }
  else if (u.type === 'ze' && S.over && S.over.win) { y -= Math.abs(Math.sin(S.t * 7)) * 30; key = 'ze_attack'; }
  else if (u.dead) { y += u.dy; rot = u.rot; alpha = Math.max(0, 1 - u.deadT / 1.1); }
  else if (u.frozenT > 0) { /* 定身：不动 */ }
  else if (u.atk >= 0) {
    const p = Math.min(1, u.atk / 0.55);
    if (p > 0.3) key = sp + '_attack';
    if (u.T.proj) { x -= u.dir * (p > 0.5 && p < 0.8 ? 10 : 0); rot = u.dir * (p < 0.4 ? -0.08 : 0.05); }
    else {
      const l = p < 0.35 ? -12 * (p / 0.35) : p < 0.55 ? -12 + 52 * ((p - 0.35) / 0.2) : 40 * (1 - (p - 0.55) / 0.45);
      x += u.dir * l * s; rot = u.dir * (p < 0.35 ? -0.12 : p < 0.6 ? 0.14 : 0.14 * (1 - (p - 0.6) / 0.4));
      if (p > 0.35 && p < 0.6) { sx *= 1.1; sy *= 0.93; }
    }
  } else if (u.moved) {
    const k = Math.abs(Math.sin(u.walk * 9));
    y -= k * 10 * s; rot = u.dir * Math.sin(u.walk * 9) * 0.08; sy *= 0.94 + 0.1 * k; sx *= 2 - (0.94 + 0.1 * k);
  } else { const b = 1 + 0.03 * Math.sin(S.t * 4 + u.walk); sy *= b; sx *= 2 - b; }
  if (u.knock > 0 && !u.dead) { x -= u.dir * u.knock * 14; rot -= u.dir * u.knock * 0.15; }
  return { key, x, y, rot, sx, sy, s, alpha };
}

function drawUnit(u) {
  const p = unitPose(u);
  if (!u.dead || u.kneel || u.type === 'ze') { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(u.x, u.y, 46 * p.s, 11 * p.s, 0, 0, Math.PI * 2); ctx.fill(); }
  if (u.rage && !u.dead) { const r = 1 + 0.08 * Math.sin(S.t * 10); ctx.fillStyle = 'rgba(255,40,40,0.28)'; ctx.beginPath(); ctx.ellipse(u.x, u.y - 110 * p.s, 120 * p.s * r, 150 * p.s * r, 0, 0, 7); ctx.fill(); }
  let tint = null;
  if (u.flash > 0.06) tint = 'flash';
  else if (u.frozenT > 0) tint = 'ice';
  else if (u.rage) tint = 'rage';
  const flip = (u.dir < 0) !== !!u.flee;
  if (S.lodOn && !u.T.boss && u.type !== 'ze' && !u.dead) {
    // 人多时的简化模式：按远近分 4 档预先缩放好的图直接贴，不做旋转和压扁（只保留颠步和冲刺位移）
    const lvl = Math.round(clamp((u.y - GROUND_TOP) / (GROUND_BOT - GROUND_TOP), 0, 1) * 3);
    const c = lodSprite(p.key, u.T, lvl, flip, tint);
    ctx.drawImage(c.img, Math.round(p.x - c.footX), Math.round(p.y - c.h));
  } else spr(p.key, p.x, p.y, { scale: p.s, flip: (u.dir < 0) !== !!u.flee, rot: u.flee ? -p.rot : p.rot, sx: p.sx, sy: p.sy, alpha: p.alpha, tint });
  if (u.frozenT > 0) { ctx.fillStyle = 'rgba(140,210,255,0.35)'; ctx.beginPath(); ctx.roundRect(u.x - 60 * p.s, u.y - 240 * p.s, 120 * p.s, 240 * p.s, 20); ctx.fill(); }
  if (u.slowT > 0 && !u.dead) { ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(u.x, u.y - 40); ctx.lineTo(u.x + Math.cos(a) * 38, u.y - 40 + Math.sin(a) * 28); ctx.stroke(); } }
  if (u.dead || u.type === 'ze' || u.T.boss) return;
  const top = u.y - 175 * p.s;
  if (u.hp < u.max) { const w = 60; ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(u.x - w / 2, top - 4, w, 7); ctx.fillStyle = TEAM[u.team].color; ctx.fillRect(u.x - w / 2 + 1, top - 3, (w - 2) * u.hp / u.max, 5); }
  if (u.forcedT > 0) text('!', u.x + 26, top - 26, 30, '#ff4a4a', 'center', '#fff', 5);
  if (u.owner) { const big = !['clown', 'thug'].includes(u.type); text(u.owner, u.x, top - 20, big ? 22 : 18, big ? '#ffd84a' : '#fff', 'center', TEAM[u.team].dark, 5); }
}

function drawBullet(b) {
  ctx.save(); ctx.translate(b.x, b.y);
  if (b.kind === 'hat') { ctx.rotate(S.t * 14); drawHat(ctx, 0, 0, 0.7); }
  else if (b.kind === 'web') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 22, Math.sin(a) * 22); ctx.stroke(); } for (const r of [9, 18]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); } }
  else if (b.kind === 'arrow') { ctx.rotate(b.ang); ctx.strokeStyle = '#7a4a1e'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-36, 0); ctx.lineTo(18, 0); ctx.stroke(); ctx.fillStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(14, -7); ctx.lineTo(14, 7); ctx.fill(); ctx.fillStyle = '#4fb3ff'; ctx.fillRect(-38, -6, 10, 12); }
  else if (b.kind === 'orb') { for (const [r, c] of [[26, 'rgba(90,170,255,0.3)'], [16, 'rgba(120,200,255,0.8)'], [8, '#fff']]) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); } }
  else if (b.kind === 'shock') { ctx.rotate(b.ang); ctx.strokeStyle = 'rgba(110,200,255,0.9)'; ctx.lineWidth = 7; for (const r of [18, 30]) { ctx.beginPath(); ctx.arc(-r / 2, 0, r, -1, 1); ctx.stroke(); } }
  ctx.restore();
}

function drawEffectsBack() {
  for (const d of S.domains) {
    const a = Math.min(1, d.t / 0.25) * Math.min(1, (d.dur - d.t) / 0.4);
    ctx.globalAlpha = a; ctx.fillStyle = 'rgba(120,100,255,0.22)'; ctx.strokeStyle = 'rgba(160,190,255,0.9)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(d.x, d.y + 40, d.r, d.r * 0.9, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; for (let i = 0; i < 14; i++) { const ang = Math.PI + (i / 14) * Math.PI, rr2 = d.r * (0.3 + (i * 37 % 10) / 14); ctx.fillRect(d.x + Math.cos(ang + d.t) * rr2, d.y + 40 + Math.sin(ang) * rr2 * 0.8, 4, 4); }
    ctx.globalAlpha = 1;
  }
  for (const k of S.ults) if (k.t < 0.4) {
    const blink = 0.35 + 0.25 * Math.sin(S.t * 20);
    ctx.fillStyle = `rgba(255,40,40,${blink})`; ctx.beginPath(); ctx.ellipse(k.x, k.y, k.r, k.r * 0.3, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#ff2020'; ctx.lineWidth = 5; ctx.stroke();
  }
}

function drawShrimp(x, y, dir, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir * s, s);
  ctx.lineWidth = 4; ctx.strokeStyle = '#3a1a0a';
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-i * 13, -Math.sin(i * 0.7) * 6, 14 - i * 1.6, 0, 7); ctx.fillStyle = i % 2 ? '#ff8a5a' : '#ff6a3a'; ctx.fill(); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(-60, 0); ctx.lineTo(-78, -12); ctx.lineTo(-76, 10); ctx.closePath(); ctx.fillStyle = '#ff6a3a'; ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(6, -6, 3, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(10, -4); ctx.quadraticCurveTo(40, -30, 60, -10); ctx.moveTo(10, 0); ctx.quadraticCurveTo(44, -16, 64, 4); ctx.stroke();
  ctx.restore();
}

function drawEffectsFront() {
  for (const w of S.whips) {
    const ext = w.t < 0.28 ? w.t / 0.28 : w.t < 0.55 ? 1 : Math.max(0, 1 - (w.t - 0.55) / 0.35), L = w.len * ext;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) { const f = i / 40, px = w.x + w.dir * (60 + L * f), py = w.y + Math.sin(f * 14 - w.t * 30) * 14 * f + f * 90; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.strokeStyle = '#2b1408'; ctx.lineWidth = 16; ctx.stroke(); ctx.strokeStyle = '#7a3a1a'; ctx.lineWidth = 8; ctx.stroke();
    drawShrimp(w.x + w.dir * (60 + L), w.y + 90 + Math.sin(14 - w.t * 30) * 14, w.dir, 1.1);
  }
  for (const s of S.sprays) if (s.t < 1) {
    drawBottle(s.x, s.y, s.dir, 1);
    ctx.save(); ctx.translate(s.x, s.y); ctx.scale(s.dir, 1);
    ctx.globalAlpha = 0.35 * (1 - s.t); ctx.fillStyle = '#ff4a1f'; ctx.beginPath(); ctx.moveTo(14, -18); ctx.lineTo(680, -230); ctx.lineTo(680, 230); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  for (const v of S.vortex) {
    const a = 1 - v.t / 0.9; ctx.strokeStyle = `rgba(170,90,255,${a})`; ctx.lineWidth = 6;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(v.x, v.y, 30 + i * 28 + (1 - v.t) * 40, S.t * 8 + i, S.t * 8 + i + 4); ctx.stroke(); }
  }
  for (const k of S.ults) if (k.t > -0.1 && k.t < 1.2) {
    const p = clamp((k.t + 0.1) / 0.5, 0, 1), y = -200 + (k.y + 200) * p * p, a = k.t > 0.8 ? 1 - (k.t - 0.8) / 0.4 : 1;
    ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.translate(k.x, y); ctx.scale(2.2, 2.2);
    ctx.fillStyle = '#e83030'; ctx.strokeStyle = '#3a0a0a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(-40, -90, 80, 80, 26); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-26, -150, 52, 64, 12); ctx.fill(); ctx.stroke();
    for (const fx of [-24, -8, 8, 24]) { ctx.beginPath(); ctx.moveTo(fx, -60); ctx.lineTo(fx, -30); ctx.stroke(); }
    ctx.restore();
  }
  for (const g of S.giants) {
    const grow = clamp(g.t / 0.6, 0, 1), fade = g.t > 2.7 ? 1 - (g.t - 2.7) / 0.6 : 1, sc = 0.7 + grow * 1.3;
    if (g.t > 0.6 && g.t < 2.7) {
      const by = g.y - 150 * sc, w = 70 + 20 * Math.sin(S.t * 40);
      ctx.globalAlpha = fade; ctx.fillStyle = 'rgba(120,200,255,0.5)'; ctx.fillRect(g.x + 80 * sc, by - w, W, w * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(g.x + 80 * sc, by - w * 0.4, W, w * 0.8); ctx.globalAlpha = 1;
    }
    spr(g.t > 0.6 && g.t < 2.7 ? 'giant_attack' : 'giant_idle', g.x, g.y, { scale: sc, alpha: Math.max(0, fade) });
  }
}

function drawBubble(b) {
  const u = b.u, s = u.T.scale * depth(u.y), x = u.x, y = u.y - 215 * s - (u.type === 'ze' ? 10 : 0);
  ctx.font = `bold 30px ${FONT}`; const w = ctx.measureText(b.text).width + 36;
  const a = Math.min(1, b.t / 0.15) * Math.min(1, (b.dur - b.t) / 0.3);
  ctx.globalAlpha = a; rr(x - w / 2, y - 64, w, 52, 18, '#fff');
  ctx.beginPath(); ctx.moveTo(x - 10, y - 14); ctx.lineTo(x + 6, y + 4); ctx.lineTo(x + 12, y - 14); ctx.fill();
  ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.text, x, y - 38); ctx.globalAlpha = 1;
}

function portrait(key, cx, cy, r, color, flip) {
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip();
  ctx.translate(cx, cy); if (flip) ctx.scale(-1, 1);
  const m = ORIG_META[key] || META[key], side = m.h * 0.5;
  ctx.drawImage(ORIG_IMG[key] || IMG[key], m.footX - side * 0.5, 0, side, side, -r * 1.1, -r * 1.05, r * 2.2, r * 2.2);
  ctx.restore(); ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
}
function bar(x, y, w, h, frac, color, rtl) {
  rr(x, y, w, h, h / 2, 'rgba(0,0,0,0.5)'); const fw = Math.max(0.1, (w - 8) * clamp(frac, 0, 1));
  rr(rtl ? x + 4 + (w - 8 - fw) : x + 4, y + 4, fw, h - 8, (h - 8) / 2, color);
}

function drawHUD() {
  const ze = S.ze;
  portrait('ze_idle', 110, 105, 72, TEAM.L.color);
  text('泽小酱', 210, 60, 44, '#fff', 'left', TEAM.L.dark, 8);
  bar(205, 92, 640, 40, ze.hp / ze.max, '#4fd16a');
  text(`${Math.max(0, Math.ceil(ze.hp))} / ${ze.max}`, 525, 112, 22, '#fff', 'center', 'rgba(0,0,0,0.6)', 4);
  text(`军团在场 ${S.units.filter(u => u.team === 'L' && !u.dead && !u.flee && u.type !== 'ze').length} 人`, 210, 160, 26, '#fff', 'left', TEAM.L.dark, 6);
  text('第一关 · 鱼僵军的地盘', 1700, 40, 30, '#ffe07a', 'right', '#3a1a0a', 6);
  const boss = S.boss;
  if (boss) {
    portrait(boss.rage ? 'yu_rage' : 'yu_idle', 1810, 115, 72, TEAM.R.color, true);
    text(boss.rage ? '鱼僵军 · 狂暴' : '鱼僵军', 1710, 78, 40, boss.rage ? '#ff8a80' : '#fff', 'right', TEAM.R.dark, 8);
    bar(1075, 104, 640, 40, Math.max(0, boss.hp) / boss.max, boss.rage ? '#ff3b3b' : '#e8553a', true);
    text(`${Math.max(0, Math.ceil(boss.hp))}`, 1395, 124, 22, '#fff', 'center', 'rgba(0,0,0,0.6)', 4);
  } else if (S.wave >= 0) {
    text(`第 ${S.wave + 1} / ${WAVES.length} 波`, 1700, 100, 38, '#fff', 'right', TEAM.R.dark, 8);
    text(`敌人剩余 ${S.units.filter(u => u.team === 'R' && !u.dead && !u.owner).length + S.queue.length}`, 1700, 150, 26, '#fff', 'right', TEAM.R.dark, 6);
  }
  text('发弹幕「1」加入泽小酱军团', 620, 230, 34, '#d4ecff', 'center', TEAM.L.dark, 8);
  text('发弹幕「2」加入鱼僵军', 1300, 230, 34, '#ffd0cb', 'center', TEAM.R.dark, 8);
  if (!legendCache) {
    legendCache = document.createElement('canvas'); legendCache.width = W; legendCache.height = 150;
    const main = ctx; ctx = legendCache.getContext('2d'); ctx.translate(0, -260);
    drawLegend();
    ctx = main;
  }
  ctx.drawImage(legendCache, 0, 260);
  drawFeedAndBanner();
}
// 控制台绑定的礼物规则：说明栏逐条显示「礼物图标 + 礼物名 + 召唤谁」
let giftRules = [], rulesStamp = '';
const giftIcons = new Map();
const SIDE_OF = { web: 'L', venom: 'L', blue: 'L', spear: 'L', gourd: 'L', white: 'L', giant: 'L', guard: 'R', whip: 'R', spray: 'R' };
function applyRules(rules) {
  if (!Array.isArray(rules)) return;
  const stamp = JSON.stringify(rules); if (stamp === rulesStamp) return;
  rulesStamp = stamp;
  // 左边阵营在前，右边在后；同一礼物绑两个作用就各占一张
  giftRules = rules.filter(r => SIDE_OF[r.effect]).sort((a, b) => (SIDE_OF[a.effect] === 'L' ? 0 : 1) - (SIDE_OF[b.effect] === 'L' ? 0 : 1));
  for (const r of giftRules) if (r.gift_id && !giftIcons.has(r.gift_id)) {
    const im = new Image(); im.onload = () => { legendCache = null; }; im.src = `/api/gifts/${r.gift_id}/image?platform=${srv.platform}`;
    giftIcons.set(r.gift_id, im);
  }
  legendCache = null;
}
function ruleLabel(r) {
  const name = UNIT_NAMES[r.effect] || r.effect;
  if (r.effect === 'whip' || r.effect === 'spray' || r.effect === 'giant') return name;
  return '召唤' + name + (r.value > 1 ? '×' + r.value : '');
}
function drawLegend() {
  if (!giftRules.length) return drawTierLegend();
  const MAX = 12, list = giftRules.slice(0, MAX), n = list.length;
  const step = Math.min(236, Math.floor((W - 80) / n)), cw = step - 14, x0 = (W - step * n) / 2 + step / 2;
  list.forEach((r, i) => {
    const cx = x0 + i * step, left = SIDE_OF[r.effect] === 'L';
    rr(cx - cw / 2, 268, cw, 122, 18, left ? 'rgba(70,140,230,0.4)' : 'rgba(230,60,60,0.4)');
    const icon = r.gift_id && giftIcons.get(r.gift_id);
    if (icon && icon.complete && icon.naturalWidth) ctx.drawImage(icon, cx - 26, 274, 52, 52);
    else text('礼', cx, 300, 30, '#fff', 'center', '#333', 5);
    const gift = r.gift_name.length > 7 ? r.gift_name.slice(0, 7) + '…' : r.gift_name;
    text('送「' + gift + '」', cx, 342, cw < 160 ? 16 : 19, '#ffe07a', 'center', '#333', 5);
    const label = ruleLabel(r);
    text(label, cx, 370, label.length > 8 || cw < 160 ? 15 : 19, '#fff', 'center', left ? '#123a6b' : '#5a1014', 5);
  });
  if (giftRules.length > MAX) text(`还有 ${giftRules.length - MAX} 个礼物…`, W - 40, 396, 16, '#fff', 'right', '#333', 4);
}
function drawTierLegend() {
  // 单机演示没有礼物规则时：按小/中/大礼物分档显示
  // 左边 4 张（泽小酱军团），右边 3 张（鱼僵军阵营）
  const step = 236, x0 = (W - step * 6 - 216) / 2 + 108;
  GIFTS.forEach(([gift, types], i) => {
    const cx = x0 + i * step;
    rr(cx - 108, 270, 216, 118, 18, 'rgba(70,140,230,0.35)');
    text(gift, cx, 292, 22, '#ffe07a', 'center', '#333', 5);
    types.forEach((t, j) => spr(t + '_idle', cx + (types.length === 1 ? 0 : (j ? 50 : -50)), 392, { scale: 0.3, sx: 1.2, sy: 1.2 }));
    text(types.map(t => UNIT_NAMES[t]).join(' / '), cx, 320, 17, '#fff', 'center', '#333', 4);
  });
  GIFTS_R.forEach(([gift, kind], i) => {
    const label = UNIT_NAMES[kind];
    const cx = x0 + (i + 4) * step;
    rr(cx - 108, 270, 216, 118, 18, 'rgba(230,60,60,0.35)');
    text(gift, cx, 292, 22, '#ffe07a', 'center', '#333', 5);
    text(label, cx, 320, 17, '#fff', 'center', '#333', 4);
    if (kind === 'guard') spr('guard_idle', cx, 392, { scale: 0.3, sx: 1.2, sy: 1.2, flip: true });
    else if (kind === 'whip') drawShrimp(cx + 30, 362, -1, 0.75);
    else drawBottle(cx, 352, -1, 0.9);
  });
}
function drawBottle(x, y, dir, sc) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir * sc, sc);
  ctx.fillStyle = '#e8e8e8'; ctx.strokeStyle = '#222'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(-20, -14, 36, 50, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e02a1a'; ctx.fillRect(-16, 4, 28, 18); ctx.beginPath(); ctx.roundRect(-8, -26, 18, 14, 4); ctx.fillStyle = '#333'; ctx.fill();
  ctx.restore();
}
function drawFeedAndBanner() {
  S.feed.forEach((f, i) => {
    const a = clamp(1 - (f.t - 5), 0, 1); if (!a) return;
    ctx.globalAlpha = a; text(f.text, 40, 450 + i * 36, 26, f.team === 'L' ? '#d4ecff' : '#ffd0cb', 'left', 'rgba(0,0,0,0.7)', 5); ctx.globalAlpha = 1;
  });
  if (S.banner && S.banner.t < 2.2) {
    const b = S.banner, sc = b.t < 0.25 ? b.t / 0.25 * 1.3 : 1.3 - Math.min(0.3, (b.t - 0.25)), a = b.t > 1.7 ? 1 - (b.t - 1.7) / 0.5 : 1;
    ctx.save(); ctx.globalAlpha = a;
    if (b.boss) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 480, W, 160); }
    ctx.translate(960, 560); ctx.scale(sc, sc);
    text(b.text, 0, 0, b.boss ? 96 : 80, b.boss ? '#ff6b6b' : '#fff', 'center', b.boss ? '#3a0a0a' : '#123a6b', 14);
    ctx.restore();
  }
}

function drawIntro() {
  const t = S.intro, a = t > INTRO_LEN - 0.5 ? (INTRO_LEN - t) / 0.5 : 1;
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(10,10,20,0.75)'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = TEAM.L.color; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(1000, 0); ctx.lineTo(880, H); ctx.lineTo(0, H); ctx.fill();
  ctx.fillStyle = TEAM.R.color; ctx.beginPath(); ctx.moveTo(1040, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(920, H); ctx.fill();
  const slide = p => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
  spr('ze_attack', -400 + 900 * slide(t / 0.6), 1080, { scale: 3.4 });
  spr('yu_idle', W + 400 - 900 * slide((t - 0.2) / 0.6), 1080, { scale: 3.4, flip: true });
  const vs = clamp((t - 0.7) / 0.25, 0, 1);
  if (vs > 0) { ctx.save(); ctx.translate(960, 470); ctx.scale(3 - 2 * vs, 3 - 2 * vs); text('VS', 0, 0, 190, '#ffe14d', 'center', '#222', 18); ctx.restore(); }
  text('泽小酱', 360, 140, 88, '#fff', 'center', TEAM.L.dark, 14);
  text('鱼僵军', 1560, 140, 88, '#fff', 'center', TEAM.R.dark, 14);
  if (t > 1.4) speech(560, 330, '就你？');
  if (t > 2.3) speech(1360, 330, '来试试');
  if (t > 3.1) text('第一关 · 鱼僵军的地盘', 960, 980, 64, '#ffe07a', 'center', '#222', 12);
  ctx.restore();
}
function speech(x, y, s) { ctx.font = `bold 60px ${FONT}`; const w = ctx.measureText(s).width + 70; rr(x - w / 2, y - 55, w, 110, 40, '#fff'); ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); }

function drawOver() {
  const o = S.over, a = clamp(o.t / 0.6, 0, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.6 * a})`; ctx.fillRect(0, 0, W, H);
  const sc = o.t < 0.5 ? o.t / 0.5 * 1.2 : 1.2 - Math.min(0.2, o.t - 0.5);
  ctx.save(); ctx.translate(960, 200); ctx.scale(sc, sc);
  text(o.win ? '第一关 通关！' : '闯关失败', 0, 0, 120, o.win ? '#ffe14d' : '#ff8a80', 'center', '#222', 16);
  ctx.restore();
  if (o.win) {
    spr('ze_attack', 760, 620 - Math.abs(Math.sin(o.t * 6)) * 24, { scale: 1.5 * a });
    spr('yu_kneel', 1160, 620, { scale: 1.5 * a, flip: true });
  } else {
    spr('yu_rage', 960, 620, { scale: 1.6 * a, flip: true });
    text('泽小酱倒下了……', 960, 330, 48, '#fff', 'center', '#000', 8);
  }
  text(o.win ? '本关 MVP · 泽小酱军团' : '本关 MVP · 鱼僵军阵营', 960, 710, 40, '#ffe07a', 'center', '#333', 8);
  o.top.forEach((v, i) => text(`${['冠军', '亚军', '季军'][i]} ${v.name}  伤害 ${Math.round(v.dmg)}  击倒 ${v.kills}`, 960, 772 + i * 54, 34, o.win ? '#d4ecff' : '#ffd0cb', 'center', 'rgba(0,0,0,0.8)', 6));
  if (o.win) { ctx.save(); ctx.globalAlpha = a; spr('yu_idle', 1700, 1020, { scale: 1.1, flip: true, tint: 'black' }); ctx.restore(); text('第二关 ???', 1700, 1040, 34, '#fff', 'center', '#000', 6); }
  text(`${Math.ceil(12 - o.t)} 秒后${o.win ? '重玩本关（第二关待制作）' : '重新挑战'}`, 960, 1000, 28, '#fff', 'center', '#000', 5);
}

function draw() {
  ctx.setTransform(RES, 0, 0, RES, 0, 0);
  ctx.save();
  if (S.shake > 0) ctx.translate(rand(-1, 1) * S.shake, rand(-1, 1) * S.shake);
  drawBackground();
  drawEffectsBack();
  for (const r of S.rings) { const p = r.t / 0.5; ctx.strokeStyle = r.color; ctx.globalAlpha = 1 - p; ctx.lineWidth = 10 * (1 - p) + 2; ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r * p, r.r * p * 0.3, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
  for (const u of S.units.slice().sort((a, b) => a.y - b.y)) drawUnit(u);
  for (const b of S.bullets) drawBullet(b);
  drawEffectsFront();
  for (const p of S.parts) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color;
    if (p.rect) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.soft ? 1 + (1 - p.life / p.max) : 1), 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  for (const t of S.texts) { ctx.globalAlpha = clamp(1 - (t.t - 0.5) / 0.4, 0, 1); const pop = t.t < 0.12 ? 0.6 + t.t / 0.12 * 0.6 : 1.2 - Math.min(0.2, t.t); ctx.save(); ctx.translate(t.x, t.y - t.t * 70); ctx.scale(pop, pop); text(t.text, 0, 0, t.size, t.color, 'center', 'rgba(0,0,0,0.8)', 6); ctx.restore(); }
  ctx.globalAlpha = 1;
  for (const b of S.bubbles) drawBubble(b);
  ctx.restore();
  drawHUD();
  if (S.intro < INTRO_LEN && srv.mode === 'running') drawIntro();
  if (S.over) drawOver();
  if (srv.mode !== 'running') {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
    text(srv.mode === 'paused' ? '已暂停' : '泽小酱闯关', 960, 470, 110, '#ffe14d', 'center', '#222', 14);
    text(srv.mode === 'paused' ? '主播马上回来' : '等待主播开始 · 发弹幕「1」帮泽小酱，发「2」帮鱼僵军', 960, 600, 40, '#fff', 'center', '#222', 8);
  }
}

let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  // 限帧：高刷屏也只按 FPS 渲染，省一半以上的 CPU/GPU
  acc += now - last; last = now;
  if (acc < 1000 / FPS - 1) return;
  const dt = Math.min(0.05, acc / 1000); acc = 0;
  if (leader) { update(dt); sendFrame(now); }
  else if (mirror) showMirror(now, dt);
  draw();
}

// ---------- 模拟面板 ----------
let seq = 1;
document.getElementById('panel').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  if (b.dataset.team === 'R') { spawnViewerR(b.dataset.act, '测试观众' + (seq++)); return; }
  if (b.dataset.act === 'boss') { if (S.intro < INTRO_LEN) S.intro = INTRO_LEN - 0.01; else { S.queue = []; for (const u of S.units) if (u.team === 'R') u.dead = true; startWave(WAVES.length - 1); } return; }
  spawnL(b.dataset.act, '测试观众' + (seq++));
});
document.getElementById('restart').onclick = () => newState();
addEventListener('keydown', e => {
  if (!DEMO) return;
  if (e.key === 'h' || e.key === 'H') document.getElementById('panel').classList.toggle('hide');
  if (e.key === '1') spawnL('clown', '测试观众' + (seq++));
  if (e.key === '2') spawnViewerR('thug', '测试观众' + (seq++));
});
if (!DEMO || QS.has('obs')) document.getElementById('panel').classList.add('hide');

// ---------- 多个画面同步（主画面算，其他画面照着显示） ----------
// 服务端只选一个主画面算战斗，它每 50ms 把这一局的状态发出来；独立窗口、OBS、控制台预览里的其他画面
// 收到后照着画（位置在两帧之间平滑过渡），所以三个画面永远是同一局。主画面关掉或卡住，别的画面从最后一帧接着算。
let leader = DEMO, lastGame = null, mirror = null, sentAt = 0, sendSocket = null;
const UNIT_KEYS = ['id', 'type', 'owner', 'x', 'y', 'hp', 'max', 'atk', 'age', 'walk', 'flash', 'knock', 'dead', 'deadT', 'vx', 'vy', 'rot', 'dy', 'slowT', 'frozenT', 'forcedT', 'rage', 'kneel', 'flee', 'moved', 'cd', 'spT', 'tauntT', 'skillT', 'ultT', 'skillN'];
const LERP_KEYS = ['x', 'y', 'walk', 'atk', 'age', 'deadT', 'dy', 'rot', 'knock'];
const round2 = (k, v) => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v;
function frameOfState() {
  const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== false) r[k] = o[k]; return r; };
  return {
    round: srv.round, seq: lastSeq, match: matchNo,
    t: S.t, intro: S.intro, wave: S.wave, queue: S.queue, waveT: S.waveT, nextWaveT: S.nextWaveT, endT: S.endT, ending: S.ending, shake: S.shake, lodOn: S.lodOn, uid: S.uid,
    ze: S.ze && S.ze.id, boss: S.boss && S.boss.id,
    units: S.units.map(u => pick(u, UNIT_KEYS)),
    bullets: S.bullets.map(b => ({ kind: b.kind, team: b.team, x: b.x, y: b.y, ang: b.ang || 0 })),
    parts: S.parts, texts: S.texts, rings: S.rings, feed: S.feed, domains: S.domains, vortex: S.vortex, ults: S.ults, giants: S.giants,
    whips: S.whips.map(w => ({ x: w.x, y: w.y, dir: w.dir, len: w.len, t: w.t })),
    sprays: S.sprays.map(w => ({ x: w.x, y: w.y, dir: w.dir, t: w.t })),
    bubbles: S.bubbles.map(b => ({ id: b.u.id, text: b.text, t: b.t, dur: b.dur })),
    banner: S.banner, over: S.over, viewers: S.viewers
  };
}
function sendFrame(now) {
  if (DEMO || !sendSocket || now - sentAt < 50) return;
  sentAt = now;
  sendSocket(JSON.stringify({ type: 'battle-frame', platform: srv.platform, frame: frameOfState() }, round2));
}
function stateFromFrame(f, prev) {
  const before = new Map(prev ? prev.units.map(u => [u.id, u]) : []);
  const s = {
    ...f, queue: f.queue || [], pendingCues: [], delayed: [], autoT: 1,
    units: f.units.map(d => {
      const T = TYPES[d.type], u = { atk: -1, dead: false, flee: false, rage: false, kneel: false, moved: false, flash: 0, knock: 0, slowT: 0, frozenT: 0, forcedT: 0, vx: 0, vy: 0, rot: 0, dy: 0, cd: 0, spT: 0, ...d, T, team: T.team, dir: TEAM[T.team].dir, hitDone: true };
      const p = before.get(d.id);
      u._c = Object.fromEntries(LERP_KEYS.map(k => [k, u[k]]));
      u._p = p ? Object.fromEntries(LERP_KEYS.map(k => [k, p[k]])) : u._c;
      return u;
    })
  };
  const byId = new Map(s.units.map(u => [u.id, u]));
  s.ze = byId.get(f.ze) || s.units.find(u => u.type === 'ze') || null;
  s.boss = byId.get(f.boss) || null;
  s.bubbles = (f.bubbles || []).map(b => ({ ...b, u: byId.get(b.id) })).filter(b => b.u);
  for (const k of ['texts', 'rings', 'feed', 'domains', 'vortex', 'ults', 'giants', 'whips', 'sprays']) s[k] = (f[k] || []).map(o => ({ ...o, _t: o.t }));
  if (s.banner) s.banner._t = s.banner.t;
  if (s.over) s.over._t = s.over.t;
  s._t = f.t; s._intro = f.intro;
  return s;
}
function receiveFrame(f) {
  if (f.round !== srv.round) return;
  lastFrameSeq = f.seq; lastFrameMatch = f.match || 1;
  const now = performance.now();
  S = stateFromFrame(f, S);
  mirror = { at: now, span: mirror ? Math.min(200, Math.max(16, now - mirror.at)) : 50 };
}
// 两帧之间：单位位置和动作平滑过渡，特效的计时往前推，粒子自己飞
function showMirror(now, dt) {
  const a = clamp((now - mirror.at) / mirror.span, 0, 1), e = Math.min(0.2, (now - mirror.at) / 1000);
  for (const u of S.units) for (const k of LERP_KEYS) { const p = u._p[k], c = u._c[k]; u[k] = typeof p === 'number' && typeof c === 'number' ? p + (c - p) * a : c; }
  for (const k of ['texts', 'rings', 'feed', 'domains', 'vortex', 'ults', 'giants', 'whips', 'sprays']) for (const o of S[k]) o.t = o._t + e;
  for (const b of S.bubbles) if (b._t === undefined) b._t = b.t; else b.t = b._t + e;
  if (S.banner) S.banner.t = S.banner._t + e;
  if (S.over) S.over.t = S.over._t + e;
  S.t = S._t + e;
  if (S._intro < INTRO_LEN) S.intro = Math.min(INTRO_LEN, S._intro + e);
  for (const p of S.parts) { p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.rect) p.rot += dt * 8; }
}
// 成为主画面：从最后一帧接着算，再补上交接空档里到的弹幕和礼物
function takeOver() {
  if (mirror && S && S._t !== undefined) {
    for (const u of S.units) { delete u._p; delete u._c; u.atk = -1; }
    S.t = S._t; S.intro = S._intro; delete S._t; delete S._intro;
    matchNo = Math.max(matchNo, lastFrameMatch || 1);
    if (lastGame) for (const c of lastGame.cues) {
      if (c.seq <= (lastFrameSeq ?? lastSeq) || c.round !== srv.round) continue;
      if (lastGame.mode === 'running' && lastGame.now - c.time < 20000) applyCue(c);
    }
  }
  mirror = null;
}
let lastFrameSeq = null, lastFrameMatch = 1;

// ---------- 接小萝卜控制台 ----------
// 一条指令 = 一条弹幕加入或一份礼物效果。开场动画期间到的指令先攒着，开打后再放。
function applyCue(c) {
  if (S.over) return;
  if (S.intro < INTRO_LEN) { if (S.pendingCues.length < 200) S.pendingCues.push(c); return; }
  const name = String(c.user || '观众').slice(0, 24), n = Math.max(1, Math.min(20, c.value | 0 || 1));
  if (c.kind === 'join') return c.side === 'L' ? spawnL('clown', name) : spawnViewerR('thug', name);
  if (c.kind === 'giant' || c.kind === 'whip' || c.kind === 'spray') {
    for (let i = 0; i < n; i++) S.delayed.push({ at: S.t + i * 1.4, fn: () => c.kind === 'giant' ? spawnL('giant', name) : spawnViewerR(c.kind, name) });
    return;
  }
  for (let i = 0; i < n; i++) c.kind === 'guard' ? spawnViewerR('guard', name) : spawnL(c.kind, name);
}
function applyNames(names) {
  if (!names || typeof names !== 'object') return;
  let changed = false;
  for (const key of Object.keys(UNIT_NAMES)) {
    const v = typeof names[key] === 'string' && names[key].trim() ? names[key].trim().slice(0, 8) : null;
    if (v && v !== UNIT_NAMES[key]) { UNIT_NAMES[key] = v; changed = true; }
  }
  if (!changed) return;
  for (const key of Object.keys(TYPES)) if (UNIT_NAMES[key]) TYPES[key].name = UNIT_NAMES[key];
  legendCache = null; // 礼物说明栏重画
}
function receive(next) {
  lastGame = next;
  const restarted = lastSeq !== null && next.seq < lastSeq;
  if (srv.round !== next.round || restarted) {
    // 刚打开画面时跳过旧指令；控制台点了「重新开局」就整局重来
    const fresh = next.cues.find(c => c.round === next.round);
    lastSeq = srv.round !== null && fresh ? fresh.seq - 1 : next.seq;
    if (srv.round !== null && srv.round !== next.round) { newState(); matchNo = 1; }
    srv.round = next.round;
  }
  srv.mode = next.mode; srv.platform = next.platform || srv.platform;
  applyNames(next.config && next.config.names);
  applyRules(next.config && next.config.gift_rules);
  if (lastSeq === null) lastSeq = next.seq;
  for (const c of next.cues) {
    if (c.seq <= lastSeq || c.round !== next.round) continue;
    lastSeq = c.seq;
    if (leader && next.mode === 'running' && next.now - c.time < 20000) applyCue(c);
  }
}
if (!DEMO && typeof LuoboEvents === 'function') {
  const source = new LuoboEvents('/api/events?battle=1');
  source.addEventListener('battle', event => receive(JSON.parse(event.data)));
  source.addEventListener('battle-role', event => { const was = leader; leader = JSON.parse(event.data).leader === true; if (leader && !was) takeOver(); });
  source.addEventListener('battle-frame', event => { if (!leader) receiveFrame(JSON.parse(event.data)); });
  sendSocket = data => { if (source.socket && source.socket.readyState === 1) source.socket.send(data); };
}

newState();
load().then(() => requestAnimationFrame(frame)).catch(err => { document.body.insertAdjacentHTML('beforeend', '<p style="color:#fff;padding:20px">素材加载失败：' + err + '</p>'); });
