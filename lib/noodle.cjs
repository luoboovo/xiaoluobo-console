const { EventEmitter } = require('node:events');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicJson, readJson } = require('./storage.cjs');
const { safeFace } = require('./avatar.cjs');
const Rules = require('../public/noodle/rules.js');
const { DEFAULTS, THROW_KINDS, SHOP_GIFTS, EMPTY_SHOP, config, presetName } = require('./noodle/config.cjs');
const { cookAction, cafeAction } = require('./noodle/workflows.cjs');
const { stirFryAction } = require('./noodle/stir-fry.cjs');
const { burgerAction } = require('./noodle/burger.cjs');
const StirFryFood = require('../public/noodle/stir-fry-food.js');
const Layout = require('../public/noodle/layout.js');
const { BUILTIN } = require('./templates.cjs');

class NoodleShop extends EventEmitter {
  constructor(dataDir, templates) {
    super(); this.file = path.join(dataDir, 'noodle.json'); this.config = structuredClone(DEFAULTS);
    this.mode = 'closed'; this.queue = []; this.served = 0; this.joined = 0; this.nextId = 0;
    this.objects = []; this.selected = null; this.serial = 0; this.revision = 0; this.seen = new Map();
    this.throws = []; this.throwSerial = 0;
    this.throwsFile = path.join(dataDir, 'throws.json'); this.throwWrites = Promise.resolve();
    this.walletFile = path.join(dataDir, 'wallet.json'); this.balance = 0; this.thieves = []; this.audience = [];
    this.leaderboard = { page: 0, at: Date.now(), interval: 8000 };
    this.statusFile = path.join(dataDir, 'shop-status.json'); this.shopStatuses = {};
    this.departures = []; this.theft = null; this.faces = new Map(); this.faceTimes = new Map();
    this.slice = null; this.cafeEffect = null;
    this.activePreset = 'saozi'; this.presets = [{ id: 'saozi', name: '臊子面馆', config: structuredClone(this.config) }];
    this.templates=templates;  this.cooking=[]; this.stirfry=StirFryFood.empty();
  }
  async init() {
    const saved = await readJson(this.file, null);
    if (saved) this.config = config(saved);
    const migrated = !saved || !this.config.gift_defaults_version;
    if (migrated) {
      if (saved) await atomicJson(this.file+'.before-v1.0.1.json',saved);
      this.config = config({...this.config,throw_gifts:DEFAULTS.throw_gifts,water_gift:DEFAULTS.water_gift,gift_defaults_version:1});
      if (!saved) this.config.sign = { ...this.config.sign, title: '臊子面馆' };
    }
    const wallet = await readJson(this.walletFile, { balance: 0, unit_version: 2 });
    if (!Number.isSafeInteger(wallet.balance)) throw new Error('钱匣记录无效，原文件已保留');
    if (wallet.unit_version !== undefined && wallet.unit_version !== 2) throw new Error('钱匣版本无效，原文件已保留');
    const thieves = wallet.thieves ?? [];
    if (!Array.isArray(thieves) || thieves.some(p => !p || typeof p.uid !== 'string' || !/^\d{1,30}$/.test(p.uid) || typeof p.name !== 'string' || p.name.length > 40 || typeof p.face !== 'string' || (p.face && safeFace(p.face) !== p.face) || !Number.isSafeInteger(p.amount) || p.amount < 1) || new Set(thieves.map(p => p.uid === '0' ? 'name:'+p.name : p.uid)).size !== thieves.length) throw new Error('偷钱榜记录无效，原文件已保留');
    this.thieves = thieves;
    const audience = wallet.audience ?? [];
    if (!Array.isArray(audience) || audience.some(p => !p || typeof p.uid !== 'string' || !/^\d{1,30}$/.test(p.uid) || typeof p.name !== 'string' || p.name.length > 40 || typeof p.face !== 'string' || (p.face && safeFace(p.face) !== p.face) || !['praise','review','eaten'].every(key => Number.isSafeInteger(p[key]) && p[key] >= 0) || !Number.isSafeInteger(p.praise + p.review)) || new Set(audience.map(p => p.uid === '0' ? 'name:'+p.name : p.uid)).size !== audience.length) throw new Error('观众榜单记录无效，原文件已保留');
    this.audience = audience;
    this.balance = wallet.unit_version === 2 ? wallet.balance : wallet.balance * 100;
    if (!Number.isSafeInteger(this.balance)) throw new Error('旧钱匣金额超出范围，原文件已保留');
    if (wallet.unit_version === undefined) {
      await atomicJson(this.walletFile + '.before-yuan-v256.json', wallet);
      await this.saveWallet(this.balance);
    }
    const statuses = await readJson(this.statusFile, {});
    if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses) || Object.entries(statuses).some(([id,s]) => !/^[a-zA-Z0-9-]{1,64}$/.test(id) || !s || !Number.isInteger(s.points) || s.points < 0 || s.points > 500 || typeof s.sealed !== 'boolean' || !Number.isSafeInteger(s.raid_at) || s.raid_at < 0 || (s.points === 0 && !s.sealed) || (s.sealed_until !== undefined && (!Number.isSafeInteger(s.sealed_until) || (s.sealed ? s.sealed_until <= s.raid_at : s.sealed_until !== 0))))) throw new Error('店铺评分记录无效，原文件已保留');
    this.shopStatuses = statuses;
    const litter = await readJson(this.throwsFile, { serial: 0, items: [] });
    if (!Number.isSafeInteger(litter.serial) || litter.serial < 0 || !Array.isArray(litter.items) || litter.items.some(item => !THROW_KINDS.includes(item.kind) || !Number.isSafeInteger(item.id) || item.id < 1 || item.id > litter.serial || !Number.isSafeInteger(item.revision) || item.revision < 0 || ![item.x,item.y,item.angle,item.at].every(Number.isFinite) || item.x < 0 || item.x > 1280 || item.y < 0 || item.y > 720) || new Set(litter.items.map(item=>item.id)).size !== litter.items.length) throw new Error('投掷物记录无效，原文件已保留');
    this.throws = litter.items; this.throwSerial = litter.serial;
    if (saved?.presets !== undefined) {
      if (!Array.isArray(saved.presets) || saved.presets.length > 50) throw new Error('面馆预设记录无效，原文件已保留');
      const presets = saved.presets.map(preset => {
        if (!preset || typeof preset.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(preset.id)) throw new Error('面馆预设记录无效，原文件已保留');
        const next=config(preset.config);this.template(next.template_id);
        return { id: preset.id, name: presetName(preset.name), config: next };
      });
      const active = presets.find(preset => preset.id === saved.active_preset);
      if ((!active && (presets.length || saved.active_preset!==null || this.config.template_id!=='saozi')) || new Set(presets.map(p=>p.id)).size !== presets.length || new Set(presets.map(p=>p.name)).size !== presets.length) throw new Error('面馆预设记录无效，原文件已保留');
      if(active)active.config = structuredClone(this.config);
      this.presets = presets; this.activePreset = active?.id ?? null;
    } else this.presets[0].config = structuredClone(this.config);
    const migratedShopGifts = this.presets.some(p => !p.config.shop_gift_defaults_version);
    if (migratedShopGifts) {
      if (saved) await atomicJson(this.file+'.before-shop-gifts-v1.json', saved);
      this.presets = this.presets.map(p => p.config.shop_gift_defaults_version ? p : { ...p, config: config({ ...p.config, ...Object.fromEntries(SHOP_GIFTS.map(kind => [kind+'_gift', p.config[kind+'_gift'] ?? DEFAULTS[kind+'_gift']])), shop_gift_defaults_version: 1 }) });
      this.config = this.presets.find(p => p.id === this.activePreset).config;
    }
    const migratedCafeSigns = !this.config.cafe_sign_defaults_version || this.presets.some(preset => !preset.config.cafe_sign_defaults_version);
    if (migratedCafeSigns) {
      if (saved) await atomicJson(this.file + '.before-cafe-sign-v2.3.4.json', saved);
      this.presets = this.presets.map(preset => {
        if (preset.config.cafe_sign_defaults_version) return preset;
        const previous = preset.config.sign;
        const sign = this.template(preset.config.template_id).workflow === 'jasmine-latte' && previous.title === '茉莉咖啡厅'
          ? { ...previous, title: '' } : previous;
        return { ...preset, config: config({ ...preset.config, sign, cafe_sign_defaults_version: 1 }) };
      });
      this.config = this.presets.find(preset => preset.id === this.activePreset)?.config ?? config({ ...this.config, cafe_sign_defaults_version: 1 });
    }
    this.template();
    let migratedSeals = false;
    for (const [id, status] of Object.entries(this.shopStatuses)) {
      if (status.sealed_until !== undefined) continue;
      const seconds = this.presets.find(p => p.id === id)?.config.raid_seconds ?? DEFAULTS.raid_seconds;
      status.sealed_until = status.sealed ? status.raid_at + seconds * 1000 : 0;
      migratedSeals = true;
    }
    if (migratedSeals) await atomicJson(this.statusFile, this.shopStatuses);
    await this.releaseExpired();
    if (migrated || migratedShopGifts || migratedCafeSigns || saved?.presets === undefined) await atomicJson(this.file, { ...this.config, active_preset: this.activePreset, presets: this.presets });
    return this;
  }
  snapshot() {
    const visibleCount=this.config.layout.queue.rows*this.config.layout.queue.columns;
    // Bulk help gifts and manual serving can otherwise stack hundreds of departure sprites.
    this.departures = this.departures.filter(person=>Date.now()-person.at<4200).slice(-visibleCount);
    const status = { ...this.status, stirfry:this.stirfry, cafe_effect: this.cafeEffect?.preset === this.activePreset && Date.now()-this.cafeEffect.at < 1200 ? this.cafeEffect : null };
    const slice = this.slice?.preset === this.activePreset && Date.now() - this.slice.at < 650 ? this.slice : null;
    const withFace = p => ({ ...p, face: this.faces.get(p.uid) || this.faces.get(Number(p.uid)) || p.face });
    const review_board = this.audience.filter(p => p.praise + p.review > 0).sort((a,b) => (b.praise + b.review) - (a.praise + a.review) || a.uid.localeCompare(b.uid) || a.name.localeCompare(b.name)).slice(0,10).map(withFace);
    const eater_board = this.audience.filter(p => p.eaten > 0).sort((a,b) => b.eaten - a.eaten || a.uid.localeCompare(b.uid) || a.name.localeCompare(b.name)).slice(0,10).map(withFace);
    return { ...status, slice, theft: this.theft?.preset === this.activePreset && Date.now()-this.theft.at < 12000 ? this.theft : null, stars: status.points > 0 ? Math.max(1, Math.floor(status.points / 100)) : 0, mode: this.mode, queue: this.queue.slice(0, this.config.layout.queue.rows * this.config.layout.queue.columns), queue_count: this.queue.length, served: this.served, joined: this.joined, objects: this.objects, selected: this.selected, object_serial: this.serial, workspace_revision: this.revision, balance: this.balance, leaderboard: this.leaderboard, review_board, eater_board, thief_board: [...this.thieves].sort((a,b) => b.amount - a.amount || a.uid.localeCompare(b.uid)).slice(0,10).map(withFace), throws: this.throws, departures: this.departures, last_served: this.lastServed && Date.now() - this.lastServedAt < 3000 ? this.lastServed : null, config: this.config, template:this.template(), cooking:this.cooking, templates:this.templates?.list() ?? [{id:'saozi',name:BUILTIN.name,version:BUILTIN.version,workflow:BUILTIN.workflow,dish_name:BUILTIN.dish_name,image:BUILTIN.assets.bowl}], active_preset: this.activePreset, presets: this.presets.map(p=>({ id: p.id, name: p.name, title: p.config.sign.title, template_id:p.config.template_id ?? 'saozi' })) };
  }
  template(id=this.config.template_id ?? 'saozi') { if(this.templates) return this.templates.get(id); if(id==='saozi') return BUILTIN; throw new Error('这个模板尚未安装，请重新导入'); }
  async saveWallet(balance, thieves = this.thieves, audience = this.audience) {
    if (!Number.isSafeInteger(balance)) throw new Error('余额超出范围');
    await atomicJson(this.walletFile, { balance, unit_version: 2, thieves, audience });
    this.balance = balance; this.thieves = thieves; this.audience = audience;
  }
  audienceWith(sender, kind, count) {
    const uid = Number.isSafeInteger(sender.uid) && sender.uid > 0 || typeof sender.uid === 'string' && /^\d{1,30}$/.test(sender.uid) ? String(sender.uid) : '0';
    const name = String(sender.user || sender.name || '试玩观众').slice(0,40), audience = structuredClone(this.audience);
    let person = audience.find(p => p.uid === uid && (uid !== '0' || p.name === name));
    if (!person) { person = { uid, name, face:'', praise:0, review:0, eaten:0 }; audience.push(person); }
    if (!Number.isSafeInteger(person[kind] + count) || kind !== 'eaten' && !Number.isSafeInteger(person.praise + person.review + count)) throw new Error('榜单累计数量超出范围');
    Object.assign(person, { name, face: safeFace(sender.face) || this.faces.get(sender.uid) || this.faces.get(uid) || person.face, [kind]: person[kind] + count });
    return audience;
  }
  get status() { return Object.hasOwn(this.shopStatuses, this.activePreset) ? this.shopStatuses[this.activePreset] : EMPTY_SHOP; }
  async setStatus(status) {
    const statuses = { ...this.shopStatuses, [this.activePreset]: status };
    await atomicJson(this.statusFile, statuses);
    this.shopStatuses = statuses;
  }
  async releaseExpired(now = Date.now()) {
    const expired = Object.entries(this.shopStatuses).filter(([, s]) => s.sealed && s.sealed_until <= now);
    if (!expired.length) return;
    const statuses = { ...this.shopStatuses };
    for (const [id] of expired) statuses[id] = { ...EMPTY_SHOP };
    await atomicJson(this.statusFile, statuses);
    this.shopStatuses = statuses;
    if (expired.some(([id]) => id === this.activePreset)) { this.mode = 'running'; this.revision++; }
    this.publish();
  }
  async shopAction(kind, count = 1, sender = {}) {
    if (!SHOP_GIFTS.includes(kind) || !Number.isSafeInteger(count) || count < 1) throw new Error('店铺操作无效');
    if (kind === 'thief') { await this.steal(sender); return; }
    if (kind === 'help') { await this.help(); return; }
    if (kind === 'clearqueue') { this.queue = []; this.publish(); return; }
    const previous = this.status, next = { ...previous };
    if (kind === 'restock') Object.assign(next, EMPTY_SHOP);
    else {
      if (kind === 'review') next.points = Math.max(0, next.points - count);
      if (kind === 'praise' && !next.sealed) next.points = Math.min(500, next.points + count);
      if ((kind === 'raid' || next.points === 0) && !next.sealed) { next.sealed = true; next.raid_at = Date.now(); next.sealed_until = next.raid_at + this.config.raid_seconds * 1000; }
    }
    if (kind === 'praise' || kind === 'review') await this.saveWallet(this.balance, this.thieves, this.audienceWith(sender, kind, count));
    if (next.points !== previous.points || next.sealed !== previous.sealed || next.raid_at !== previous.raid_at) await this.setStatus(next);
    const reopening = kind === 'restock' && this.mode !== 'running';
    if (kind === 'restock') this.mode = 'running';
    if (next.sealed) {
      this.objects = this.objects.filter(o => o.kind === 'coin' || (o.kind === 'bowl' && !o.noodles && !o.sauce && !o.coffee && !o.bun));
      this.cooking = []; this.selected = null; this.stirfry=StirFryFood.empty();
    }
    if (next.sealed !== previous.sealed || reopening) this.revision++;
    this.publish();
  }
  async steal(sender = {}) {
    const requested = this.config.thief_min + Math.floor(Math.random() * (this.config.thief_max - this.config.thief_min + 1));
    const amount = Math.min(Math.max(0, this.balance), requested);
    const uid = Number.isSafeInteger(sender.uid) && sender.uid > 0 || typeof sender.uid==='string' && /^\d{1,30}$/.test(sender.uid) ? sender.uid : 0;
    const person = { uid: String(uid), name: String(sender.user || '试玩小偷').slice(0,40), face: safeFace(sender.face) || (uid && this.faces.get(uid)) || '' };
    if (amount) {
      const thieves = structuredClone(this.thieves);
      let entry = thieves.find(p => uid ? p.uid === person.uid : p.uid === '0' && p.name === person.name);
      if (!entry) { entry = { ...person, amount: 0 }; thieves.push(entry); }
      if (!Number.isSafeInteger(entry.amount + amount)) throw new Error('偷钱累计金额超出范围');
      Object.assign(entry, person, { face: person.face || entry.face, amount: entry.amount + amount });
      await this.saveWallet(this.balance - amount, thieves);
    }
    this.theft = { id: randomUUID(), preset: this.activePreset, at: Date.now(), amount, coins: [], sender: { ...person, uid } };
    this.publish();
  }
  requireFood() { if (this.status.sealed) throw new Error('店铺已查封，请等待倒计时结束或提前补货'); }
  publish() {
    if (this.pointerState && (this.mode !== 'running' || this.pointerState.revision !== this.revision || (THROW_KINDS.includes(this.pointerState.drag?.kind) && !this.throws.some(item=>item.id===this.pointerState.drag.id && item.revision===this.pointerState.drag.throw_revision)))) {
      this.pointerState = this.mode === 'running' ? { ...this.pointerState, revision: this.revision, drag: null, pointer: this.pointerState.pointer && { ...this.pointerState.pointer, pressed: false } } : null;
      this.emit('motion', this.motionSnapshot());
    }
    this.emit('state', this.snapshot());
  }
  motionSnapshot() { return Date.now() - this.pointerAt < 2500 ? this.pointerState : null; }
  motion(input) {
    if (!input || typeof input.client !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(input.client) || !Number.isInteger(input.revision)) throw new Error('操作同步格式无效');
    if (input.pointer === null && input.drag === null) {
      if (this.pointerState?.client !== input.client) return false;
      this.pointerState = null; this.emit('motion', null); return true;
    }
    if (this.mode !== 'running' || input.revision !== this.revision) return false;
    const p = input.pointer, item = input.drag;
    if (p !== null && (!p || !Number.isFinite(p.x) || p.x < 0 || p.x > 1280 || !Number.isFinite(p.y) || p.y < 0 || p.y > 720 || typeof p.pressed !== 'boolean')) throw new Error('鼠标位置无效');
    let drag = null;
    if (item !== null) {
      if (!item || !['bowl', 'noodles', 'sauce', 'water', 'coin', 'raw', 'cooked', 'scallions', 'cilantro', 'jasmine', 'milk', ...THROW_KINDS].includes(item.kind) || !Number.isSafeInteger(item.id) || item.id < 1 || item.id > 1e9 || ![item.x, item.y].every(n => Number.isFinite(n) && Math.abs(n) <= 20000)) throw new Error('拖拽物品无效');
      if (this.status.sealed && (!['coin', 'bowl', ...THROW_KINDS].includes(item.kind) || (item.kind === 'bowl' && (item.noodles || item.sauce || item.coffee)))) this.requireFood();
      if (THROW_KINDS.includes(item.kind)) {
        const saved = this.throws.find(o=>o.id===item.id);
        if (!saved || saved.kind!==item.kind || saved.revision!==item.throw_revision || item.noodles!==0 || item.sauce!==0) throw new Error('投掷物已更新');
      } else {
        const saved = this.objects.find(o => o.id === item.id);
        if (saved ? saved.kind !== item.kind || saved.noodles !== item.noodles || saved.sauce !== item.sauce : ['coin','raw','cooked'].includes(item.kind) || item.id !== this.serial + 1 || item.noodles !== 0 || item.sauce !== 0) throw new Error('拖拽物品已更新');
      }
      const saved=this.objects.find(o=>o.id===item.id);
      drag = { id: item.id, kind: item.kind, x: item.x, y: item.y, noodles: item.noodles, sauce: item.sauce, ...(saved?.spoiled?{spoiled:true}:{}), ...(saved?.scallions?{scallions:true}:{}),...(saved?.cilantro?{cilantro:true}:{}), ...(THROW_KINDS.includes(item.kind)?{throw_revision:item.throw_revision}:{}) };
      if (this.template().workflow==='jasmine-latte' && item.kind==='bowl') Object.assign(drag,{coffee:!!saved?.coffee,jasmine:!!saved?.jasmine,milk:!!saved?.milk});
      if (this.template().workflow==='stir-fry') Object.assign(drag,{...(item.kind==='bowl'?{ingredients:saved?.ingredients??[],garnishes:saved?.garnishes??[]}:{}),...(saved?.drink?{drink:saved.drink}:{})});
      if (this.template().workflow==='burger' && item.kind==='bowl') Object.assign(drag,{bun:!!saved?.bun,patty:!!saved?.patty,toppings:saved?.toppings??[],closed:!!saved?.closed});
      if (this.template().workflow==='burger' && saved?.contaminants) drag.contaminants=[...saved.contaminants];
    }
    this.pointerState = { client: input.client, revision: this.revision, pointer: p && { x: p.x, y: p.y, pressed: p.pressed }, drag };
    this.pointerAt = Date.now(); this.emit('motion', this.pointerState); return true;
  }
  async save(input) {
    if(!this.presets.length)throw new Error('请先从我的模板创建店铺');
    const next = config(input);
    this.template(next.template_id);
    if(next.template_id !== (this.config.template_id ?? 'saozi')) throw new Error('请从面馆模板切换玩法');
    await this.savePresets(this.presets.map(p=>p.id === this.activePreset ? { ...p, config: next } : p), this.activePreset);
  }
  async installTemplate(input) {
    if (this.presets.length >= 50) throw new Error('最多保存 50 个面馆');
    const template = await this.templates.install(input);
    let name = template.name, number = 2;
    while (this.presets.some(preset => preset.name === name)) {
      const suffix = ' ' + number++;
      name = template.name.slice(0, 16 - suffix.length) + suffix;
    }
    const state = await this.action({ action: 'preset_create', name, template_id: template.id });
    return { state, template };
  }
  async deleteTemplate(id) {
    this.templates.removable(id);
    const presets = this.presets, active = this.activePreset;
    const workspace = Object.fromEntries([
      'mode', 'queue', 'objects', 'departures', 'selected', 'cooking',
      'served', 'joined', 'lastServed', 'lastServedAt',
      'theft', 'slice', 'cafeEffect', 'pointerState', 'pointerAt', 'stirfry'
    ].map(key => [key, this[key]]));
    const remaining = presets.filter(preset => (preset.config.template_id ?? 'saozi') !== id);
    const next = remaining.some(preset => preset.id === active) ? active :
      remaining.find(preset => (preset.config.template_id ?? 'saozi') === 'saozi')?.id ?? remaining[0]?.id ?? null;
    await atomicJson(this.file + '.before-template-delete-' + id + '.json', { ...this.config, active_preset: active, presets });
    await this.savePresets(remaining, next);
    try { await this.templates.remove(id); }
    catch (error) {
      await this.savePresets(presets, active);
      Object.assign(this, workspace);
      // Keep revisions increasing so every scene can render the restored workspace.
      if (this.pointerState) this.pointerState = { ...this.pointerState, revision: this.revision };
      this.publish();
      this.emit('motion', this.motionSnapshot());
      throw error;
    }
    this.publish();
    return this.snapshot();
  }
  async savePresets(presets, activeId) {
    const active = presets.find(p=>p.id === activeId);
    if((presets.length && !active) || (!presets.length && activeId!==null))throw new Error('当前店铺不存在');
    const next=active?.config ?? config({...this.defaults||DEFAULTS,template_id:'saozi',sign:BUILTIN.sign,gift_defaults_version:1,shop_gift_defaults_version:1});
    await atomicJson(this.file, { ...next, active_preset: activeId, presets });
    if(!active || (next.template_id ?? 'saozi') !== (this.config.template_id ?? 'saozi')) {
      this.queue=[];this.objects=[];this.departures=[];this.selected=null;this.cooking=[];this.served=0;this.joined=0;this.lastServed=null;
      this.stirfry=StirFryFood.empty();
    }
    if(activeId!==this.activePreset && (this.template(next.template_id).workflow==='stir-fry' || (this.templates?.list().some(t=>t.id===(this.config.template_id??'saozi')) && this.template().workflow==='stir-fry')))this.stirfry=StirFryFood.empty();
    this.presets = presets; this.activePreset = activeId; this.config = next;
    if(!active)this.mode='closed';
    if (this.status.sealed) { this.objects = this.objects.filter(o => o.kind === 'coin' || (o.kind === 'bowl' && !o.noodles && !o.sauce && !o.coffee && !o.bun)); this.cooking = []; this.selected = null; }
    this.revision++; this.publish();
  }
  async presetAction(input) {
    if (input.action === 'preset_create') {
      const template=this.template(input.template_id ?? this.config.template_id ?? 'saozi');
      const name = presetName(input.name);
      if (this.presets.length >= 50) throw new Error('最多保存 50 个面馆预设');
      if (this.presets.some(p=>p.name === name)) throw new Error('已有同名面馆');
      const different=input.template_id !== undefined;
      const sign = { ...(different ? template.sign : this.config.sign) };
      if (template.workflow === 'jasmine-latte') {
        if (different && sign.title === '茉莉咖啡厅') sign.title = '';
      } else sign.title = name;
      const preset = { id: randomUUID(), name, config: config({ ...this.config, template_id: template.id, ...(different ? { layout: template.layout } : {}), sign }) };
      if(different && ['jasmine-latte','stir-fry','burger'].includes(template.workflow)) preset.config.cook_seconds=template.cook_seconds;
      if(template.workflow==='jasmine-latte') preset.config.water_gift=null;
      if(different && template.workflow==='stir-fry'){
        preset.config.water_gift ??= structuredClone((this.defaults||DEFAULTS).water_gift);
        for(const kind of THROW_KINDS)preset.config.throw_gifts[kind] ??= structuredClone((this.defaults||DEFAULTS).throw_gifts[kind]);
      }
      await this.savePresets([...this.presets, preset], preset.id); return;
    }
    const preset = this.presets.find(p=>p.id === input.id);
    if (!preset) throw new Error('这个面馆预设不存在');
    if(input.action==='preset_delete') {
      const current=preset.id===this.activePreset,remaining=this.presets.filter(p=>p.id!==preset.id);
      await atomicJson(this.file+'.before-shop-delete-'+preset.id+'.json',{...this.config,active_preset:this.activePreset,presets:this.presets});
      await this.savePresets(remaining,current?(remaining.find(p=>(p.config.template_id ?? 'saozi')==='saozi')?.id ?? remaining[0]?.id ?? null):this.activePreset);
      if(current) {
        this.queue=[];this.objects=[];this.departures=[];this.selected=null;this.cooking=[];this.served=0;this.joined=0;this.lastServed=null;this.theft=null;this.slice=null;this.cafeEffect=null;
        this.stirfry=StirFryFood.empty();
        this.publish();
      }
    } else if (input.action === 'preset_use') {
      if (preset.id !== this.activePreset) await this.savePresets(this.presets, preset.id);
    } else {
      const name = presetName(input.name);
      if (this.presets.some(p=>p.id !== preset.id && p.name === name)) throw new Error('已有同名面馆');
      const updated = { ...preset, name };
      if (preset.config.sign.title === preset.name) updated.config = config({ ...preset.config, sign: { ...preset.config.sign, title: name } });
      await this.savePresets(this.presets.map(p=>p.id === preset.id ? updated : p), this.activePreset);
    }
  }
  rememberFace(event) {
    const face = safeFace(event.face), uid = Number.isSafeInteger(event.uid) && event.uid > 0 || typeof event.uid==='string' && /^\d{1,30}$/.test(event.uid) ? event.uid : 0;
    if (!uid || !face) return;
    this.faceTimes.set(uid, Date.now());
    if (uid && face && this.faces.get(uid) !== face) {
      this.faces.delete(uid); this.faces.set(uid, face);
      // shortcut: 保留最近2000位用户的头像地址，超大直播间再扩大缓存。
      if (this.faces.size > 2000) { const old = this.faces.keys().next().value; this.faces.delete(old); this.faceTimes.delete(old); }
      let changed = [...this.thieves, ...this.audience].some(p => p.uid === String(uid) && p.face !== face);
      for (const customer of this.queue) if (customer.uid === uid && customer.face !== face) { customer.face = face; changed = true; }
      if (this.theft?.sender?.uid === uid && this.theft.preset === this.activePreset && Date.now()-this.theft.at < 12000 && this.theft.sender.face !== face) { this.theft.sender.face = face; changed = true; }
      if (changed) this.publish();
    }
  }
  cleanup(now = Date.now()) {
    for (const [key, at] of this.seen) if (now - at > 300000) this.seen.delete(key);
    const activeUsers = new Set(this.queue.map(person => person.uid));
    if (this.theft && now - this.theft.at < 12000) activeUsers.add(this.theft.sender.uid);
    for (const [uid, at] of this.faceTimes) if (now - at > 1800000 && !activeUsers.has(uid)) { this.faces.delete(uid); this.faceTimes.delete(uid); }
    const previous = this.departures.length;
    this.departures = this.departures.filter(person => now - person.at < 4200);
    let changed = previous !== this.departures.length;
    if (this.theft && now - this.theft.at >= 12000) { this.theft = null; changed = true; }
    if (this.slice && now - this.slice.at >= 650) this.slice = null;
    if (this.lastServed && now - this.lastServedAt >= 3000) { this.lastServed = null; changed = true; }
    if (this.pointerState && now - this.pointerAt >= 2500) { this.pointerState = null; this.emit('motion', null); }
    if (changed) this.publish();
  }
  async receive(event, updateFace = true) {
    if (updateFace) this.rememberFace(event);
    if (event.type !== 'gift' || this.mode === 'closed') return;
    const face = safeFace(event.face), uid = Number.isSafeInteger(event.uid) && event.uid > 0 || typeof event.uid==='string' && /^\d{1,30}$/.test(event.uid) ? event.uid : 0;
    const sameId = id => event.giftId === id || event.giftAliases?.includes(id);
    const match = this.config.gift_id ? sameId(this.config.gift_id) : event.giftName === this.config.gift_name;
    const queueMatch = match || event.blindGiftName === this.config.gift_name;
    const matches = rule => !!rule && (sameId(rule.gift_id) || (rule.match_name && [event.giftName,event.blindGiftName].includes(rule.gift_name)));
    const waterMatch = this.template().workflow!=='jasmine-latte' && matches(this.config.water_gift);
    const tipMatch = matches(this.config.tip_gift);
    const throws = THROW_KINDS.filter(kind => matches(this.config.throw_gifts[kind]));
    const shopGift = SHOP_GIFTS.find(kind => matches(this.config[kind+'_gift']));
    if (!queueMatch && !waterMatch && !tipMatch && !throws.length && !shopGift) return;
    const now = Date.now();
    // Insertion order keeps expiry cleanup proportional to expired gifts, not all live gifts.
    for (const [key, time] of this.seen) { if (now - time <= 300000) break; this.seen.delete(key); }
    if (event.transactionId) {
      const key = `${event.uid}:${event.giftId}:${event.transactionId}`;
      if (this.seen.has(key)) return;
      this.seen.set(key, now);
      // shortcut: retain 50,000 recent transactions; use a disk ledger if a room exceeds this within five minutes.
      if (this.seen.size > 50000) this.seen.delete(this.seen.keys().next().value);
    }
    const count = Number.isSafeInteger(event.count) && event.count > 0 ? event.count : 1;
    if (shopGift) { await this.shopAction(shopGift, count, event); return; }
    if (tipMatch) this.tip(count);
    for (const kind of throws) await this.throwFood(kind, count);
    if (waterMatch || queueMatch) {
      if (!this.enqueue(event.user || '观众', Math.min(2000, count * this.config.people_per_gift), uid, face || this.faces.get(uid) || '', false, waterMatch ? 'water' : 'noodles') && tipMatch) this.publish();
    }
    else if (tipMatch) this.publish();
  }
  tip(count = 1) {
    if (!Number.isSafeInteger(count) || count < 1 || this.objects.length + count > 500) throw new Error('台面最多放置 500 件物品，请先收钱');
    const at = Date.now();
    for (let i = 0; i < count; i++) this.objects.push({ id: ++this.serial, kind: 'coin', x: 370 + Math.random()*440, y: 450 + Math.random()*100, noodles: 0, sauce: 0, tip_at: at });
    this.revision++;
  }
  updateThrows(change, publish = true) {
    const write = this.throwWrites.then(async () => {
      const next = change(structuredClone(this.throws), this.throwSerial);
      if (next.serial === this.throwSerial && JSON.stringify(next.items) === JSON.stringify(this.throws)) return;
      await atomicJson(this.throwsFile, next);
      this.throws = next.items; this.throwSerial = next.serial; if (publish) this.publish();
    });
    this.throwWrites = write.catch(()=>{}); return write;
  }
  throwFood(kind, count = 1) {
    if (!THROW_KINDS.includes(kind)) throw new Error('投掷物不存在');
    return this.updateThrows((items, serial) => {
      const available = 36-items.filter(item=>item.kind===kind).length;
      for (let i = 0; i < Math.min(count, available); i++) {
        const id = ++serial;
        items.push({ id, kind, x: 80+(id*197%1120), y: 80+(id*113%580), angle: id*67%100-50, at: Date.now(), revision: 0 });
      }
      return { items, serial };
    });
  }
  moveThrow(input) {
    return this.updateThrows((items, serial) => {
      this.checkRevision(input);
      const item = items.find(o=>o.id===input.throw_id);
      if (!item || item.revision!==input.throw_revision) throw new Error('这件投掷物已更新');
      if (![input.x,input.y].every(Number.isFinite) || input.x<0 || input.x>1280 || input.y<0 || input.y>720 || typeof input.discard!=='boolean') throw new Error('投掷物位置无效');
      if (input.discard) {
        if (!Layout.trashContains({x:input.x,y:input.y},this.config.layout,this.template().workflow)) throw new Error('请把投掷物放进垃圾桶');
        items = items.filter(o=>o.id!==item.id);
      } else { item.x=input.x; item.y=input.y; item.revision++; if(item.kind==='cockroach')item.at=Date.now()-1000; }
      return { items, serial };
    });
  }
  enqueue(name, count, uid = 0, face = '', demo = true, order = 'noodles') {
    // shortcut: 队列上限 2000，画面按配置行列展示，超大直播间再增加分页。
    const accepted = Math.min(count, 2000 - this.queue.length);
    if (accepted <= 0) return;
    const workflow=this.template().workflow;
    const customer = { uid, name: String(name).slice(0,40), face: safeFace(face), demo, order, ...(order !== 'water' && workflow!=='mix' ? { recipe:workflow } : {}) };
    for (let i = 0; i < accepted; i++) {
      const id=++this.nextId;
      this.queue.push({ id, ...customer });
    }
    this.joined += accepted; this.publish(); return accepted;
  }
  checkRevision(input) {
    if (this.mode !== 'running') throw new Error('请先开始游戏');
    if (!Number.isInteger(input.revision) || input.revision !== this.revision) throw new Error('台面已更新，请重试');
  }
  placeBowl() {
    if(this.template().workflow==='burger')throw new Error('请先把面包胚放进烤箱，烤好后取出');
    if(this.mode!=='running')throw new Error('请先开始或继续游戏');
    if(this.objects.length>=500)throw new Error('台面最多放置 500 件物品，请先收钱或清理');
    // A single centered row also fits the narrow tray in the stir-fry template.
    const spot=[410,530,650,770].map(x=>({x,y:475})).find(point=>!this.objects.some(item=>['bowl','water'].includes(item.kind)&&Rules.overlaps(item,{...point,kind:'bowl'})));
    if(!spot)throw new Error('托盘碗位已满，请先出餐或整理');
    const workflow=this.template().workflow;
    const bowl={id:++this.serial,kind:'bowl',...spot,noodles:0,sauce:0,
      ...(workflow==='stir-fry'?{ingredients:[],garnishes:[]}:{}),
      ...(workflow==='jasmine-latte'?{coffee:false,jasmine:false,milk:false}:{})};
    this.objects.push(bowl);this.selected=bowl.id;this.revision++;
  }
  workspace(input) {
    this.checkRevision(input);
    const burger=this.template().workflow==='burger';
    const cafe=this.template().workflow==='jasmine-latte';
    const stir=this.template().workflow==='stir-fry';
    if (!Array.isArray(input.objects) || input.objects.length > 500) throw new Error('台面最多放置 500 件物品');
    const ids = new Set(), objects = [];
    for (const item of input.objects) {
      const kinds=stir||burger?['bowl','water','coin']:cafe?['bowl','coin','jasmine']:this.template().workflow==='knife-noodles'?['bowl','water','coin','raw','cooked','scallions','cilantro']:['bowl','noodles','sauce','water','coin'];
      if (!item || !kinds.includes(item.kind) || !Number.isSafeInteger(item.id) || item.id <= 0 || item.id > 1e9 || ids.has(item.id) || !Number.isFinite(item.x) || !Number.isFinite(item.y)) throw new Error('台面物品无效');
      const radius = Rules.radius(item);
      const saved = this.objects.find(o => o.id === item.id);
      if(burger && (saved?saved.kind!==item.kind:item.kind!=='water'||item.id!==this.serial+1||objects.some(o=>!this.objects.some(old=>old.id===o.id))))throw new Error('请使用烤箱和煎台制作汉堡');
      if (this.status.sealed && (item.kind !== 'coin' && (item.kind !== 'bowl' || item.noodles || item.sauce || saved?.coffee))) this.requireFood();
      if (cafe && (saved ? saved.kind!==item.kind : item.id!==this.serial+1 || objects.some(o=>!this.objects.some(old=>old.id===o.id)))) throw new Error('咖啡厅物品已更新');
      if(stir && (saved?saved.kind!==item.kind:item.kind!=='bowl'||item.id!==this.serial+1||objects.some(o=>!this.objects.some(old=>old.id===o.id))))throw new Error('台面物品已更新');
      if (item.kind === 'coin' ? saved?.kind !== 'coin' : saved?.kind === 'coin') throw new Error('付款只能由顾客或打赏产生');
      if(['raw','cooked'].includes(item.kind) && saved?.kind!==item.kind) throw new Error('请先削面，再下锅煮熟');
      const restingCooked = (saved?.kind === 'cooked' || cafe && saved?.at_machine) && item.x === saved.x && item.y === saved.y;
      if (!restingCooked && !Rules.contains(item.x, item.y, radius)) throw new Error('物品应放在中间台面');
      const bowl = { id: item.id, kind: item.kind, x: item.x, y: item.y, noodles: 0, sauce: 0, ...(saved?.spoiled ? { spoiled: true } : {}), ...(saved?.tip_at ? { tip_at: saved.tip_at } : {}) };
      if(cafe && saved?.at_machine && restingCooked) bowl.at_machine=true;
      if(stir && saved?.drink)bowl.drink=saved.drink;
      if (item.kind === 'bowl') {
        if(burger){
          for(const key of ['bun','patty','toppings','closed','noodles','sauce','spoiled','contaminants'])if(JSON.stringify(item[key])!==JSON.stringify(saved[key]))throw new Error('请使用烤箱、煎台和配料制作汉堡');
          if(this.status.sealed)this.requireFood();
          Object.assign(bowl,{bun:saved.bun,patty:saved.patty,toppings:[...saved.toppings],closed:saved.closed});
          if(saved.contaminants)bowl.contaminants=[...saved.contaminants];
        }
        if (![item.noodles, item.sauce].every(n => Number.isInteger(n) && n >= 0 && n <= 1e9)) throw new Error('份数无效');
        bowl.noodles = item.noodles; bowl.sauce = item.sauce;
        if(stir){
          if(item.noodles!==(saved?.noodles??0)||item.sauce!==0||JSON.stringify(item.ingredients??[])!==JSON.stringify(saved?.ingredients??[])||JSON.stringify(item.garnishes??[])!==JSON.stringify(saved?.garnishes??[]))throw new Error('请使用铁锅制作香锅，再撒配料');
          bowl.ingredients=[...(saved?.ingredients??[])];bowl.garnishes=[...(saved?.garnishes??[])];
        }
        if(cafe) {
          if(item.noodles!==0 || item.sauce!==0) throw new Error('咖啡杯不能装面条或臊子');
          for(const key of ['coffee','jasmine','milk']) {
            if((item[key] ?? false)!==(saved?.[key] ?? false)) throw new Error('请使用咖啡机、茉莉花和牛奶制作拿铁');
            bowl[key]=saved?.[key] ?? false;
          }
        }
        if(this.template().workflow==='knife-noodles') {
          const added=item.noodles-(saved?.noodles ?? 0);
          if(![0,1].includes(added) || item.sauce!==0) throw new Error('请先下锅煮面，再装入碗');
          for(const key of ['scallions','cilantro']) { if(item[key]!==undefined && typeof item[key]!=='boolean') throw new Error('配料无效'); bowl[key]=item[key] ?? false; }
        }
      }
      if (['bowl', 'water'].includes(item.kind) && objects.some(other => ['bowl', 'water'].includes(other.kind) && Rules.overlaps(other, item))) throw new Error('商品不能重叠');
      ids.add(item.id); objects.push(bowl);
    }
    if(this.template().workflow==='knife-noodles') {
      const portions=this.objects.filter(o=>o.kind==='cooked' && !objects.some(next=>next.id===o.id)).length;
      const filled=objects.filter(o=>o.kind==='bowl').reduce((count,o)=>count+Math.max(0,o.noodles-(this.objects.find(old=>old.id===o.id)?.noodles??0)),0);
      if(filled>portions)throw new Error('请先从锅里取出煮熟的面');
    }
    if (input.selected !== null && !objects.some(o => o.id === input.selected && ['bowl', 'water'].includes(o.kind))) throw new Error('选中的商品不存在');
    this.objects = objects; this.selected = input.selected;
    this.serial = Math.max(this.serial, ...objects.map(o => o.id)); this.revision++; this.publish();
  }
  async feed(input) {
    this.checkRevision(input);
    this.requireFood();
    let bowl = this.objects.find(o => o.id === (input.object_id ?? input.bowl_id));
    const customer = this.queue.find(p => p.id === input.customer_id);
    if (!customer) throw new Error('这位顾客已离开');
    const fresh = input.fresh_item;
    const freshKinds=this.template().workflow==='burger'?['water']:this.template().workflow==='stir-fry'?['bowl']:this.template().workflow==='jasmine-latte'?['bowl','jasmine']:this.template().workflow==='knife-noodles'?['bowl','water','scallions','cilantro']:['bowl','water','noodles','sauce'];
    if (!bowl && fresh?.id === this.serial + 1 && freshKinds.includes(fresh.kind)) bowl = { id: fresh.id, kind: fresh.kind, x: 500, y: 550, noodles: 0, sauce: 0 };
    if (!bowl || !['bowl','water','noodles','sauce','raw','cooked','scallions','cilantro','jasmine','milk'].includes(bowl.kind)) throw new Error('这件商品不在台面');
    const correct = Rules.accepts(bowl, customer);
    if (!correct) {
      await this.saveWallet(this.balance - 100);
    }
    await this.completeOrder(customer, bowl, correct);
  }
  async help() {
    if (this.mode !== 'running' || this.status.sealed || this.objects.length >= 500) return false;
    const customer = this.queue.find(person => person.order !== 'water');
    if (!customer) return false;
    const bowl = { id: this.serial + 1, kind: 'bowl', x: 500, y: 550, noodles: 1, sauce: customer.recipe === 'knife-noodles' ? 0 : 1 };
    if(customer.recipe==='jasmine-latte') Object.assign(bowl,{noodles:0,sauce:0,coffee:true,jasmine:true,milk:true});
    if(customer.recipe==='burger') Object.assign(bowl,{noodles:0,sauce:0,bun:true,patty:true,toppings:['tomato','lettuce','cheese','mustard'],closed:true});
    await this.completeOrder(customer, bowl, true, true);
    return true;
  }
  async completeOrder(customer, bowl, correct, helped = false) {
    if (correct && customer.order !== 'water') await this.saveWallet(this.balance, this.thieves, this.audienceWith(customer, 'eaten', 1));
    this.departures.push({...customer,index:this.queue.indexOf(customer),correct,spoiled:!!bowl.spoiled,...(helped ? { helped: true } : {}),at:Date.now()});
    this.objects = this.objects.filter(o => o !== bowl); this.queue = this.queue.filter(p => p !== customer);
    if (this.selected === bowl.id) this.selected = null;
    this.serial = Math.max(this.serial, bowl.id);
    if (correct) this.objects.push({ id: ++this.serial, kind: 'coin', x: bowl.x, y: bowl.y, noodles: 0, sauce: 0 });
    if (correct) this.served++;
    this.lastServed = customer; this.lastServedAt = Date.now(); this.revision++; this.publish();
  }
  async deposit(input) {
    this.checkRevision(input);
    const coin = this.objects.find(o => o.id === input.object_id && o.kind === 'coin');
    if (!coin) throw new Error('这枚钱已收走');
    await this.saveWallet(this.balance + 100);
    this.objects = this.objects.filter(o => o !== coin); this.revision++;
  }
  discard(input) {
    this.checkRevision(input);
    if (!Number.isSafeInteger(input.object_id) || !this.objects.some(o => o.id === input.object_id)) throw new Error('这件物品已不在台面');
    this.objects = this.objects.filter(o => o.id !== input.object_id);
    if (this.selected === input.object_id) this.selected = null;
    this.revision++;
  }
  async spoil(input) {
    this.checkRevision(input); this.requireFood();
    const bowl = this.objects.find(o => o.id === input.bowl_id && o.kind === 'bowl' && (o.noodles > 0 || o.coffee || o.bun || this.template().workflow==='jasmine-latte' && (o.milk || o.jasmine)));
    if (!bowl) throw new Error(this.template().workflow==='jasmine-latte'?'请把臭鸡蛋或臭生菜放入装有咖啡的杯子':'请把鸡蛋或菜叶放进装了面的碗');
    const burger=this.template().workflow==='burger';
    if(burger && bowl.closed)throw new Error('请在盖上面包前放入');
    let contaminant;
    await this.updateThrows((items, serial) => {
      const litter = items.find(o => o.id === input.throw_id && o.revision === input.throw_revision);
      if (!litter) throw new Error('这件投掷物已被捡走');
      contaminant=litter.kind;
      return { serial, items: items.filter(o => o !== litter) };
    }, false);
    bowl.spoiled = true;
    if(burger){bowl.contaminants??=[];if(!bowl.contaminants.includes(contaminant))bowl.contaminants.push(contaminant);}
    this.cafeEffect=null; this.revision++;
  }
  dropCooked(input) {
    this.checkRevision(input);
    const cooked=this.objects.find(o=>o.id===input.object_id && o.kind==='cooked');
    if(!cooked)throw new Error('这份熟面已被拿走');
    if(!Number.isFinite(input.x) || input.x<0 || input.x>1280)throw new Error('落地位置无效');
    Object.assign(cooked,Layout.stageToWorkspace({x:Math.max(40,Math.min(1240,input.x)),y:665+(cooked.id%3)*13},this.config.layout));
    this.revision++;
  }
  async action(input) {
    if(!this.presets.length && input.action!=='preset_create')throw new Error('请先从我的模板创建店铺');
    switch (input.action) {
      case 'start': this.mode = 'running'; break;
      case 'pause': if (this.mode === 'running') this.mode = 'paused'; break;
      case 'demo':
        if (this.mode === 'closed') throw new Error('请先开始游戏');
        ['小萝卜', '面馆常客', '来碗热面', '吃面同学', '汤要多一点'].forEach((name, i) => this.enqueue(name, 1, i + 1)); break;
      case 'demo_noodles':
        if (this.mode === 'closed') throw new Error('请先开始游戏');
        this.enqueue(this.template().dish_name+'顾客', 1, 7, '', true, 'noodles'); break;
      case 'demo_water':
        if(this.template().workflow==='jasmine-latte') throw new Error('当前店铺不提供矿泉水');
        if (this.mode === 'closed') throw new Error('请先开始游戏');
        this.enqueue(this.template().workflow==='stir-fry'?'饮料顾客':'圣水顾客', 1, 6, '', true, 'water'); break;
      case 'demo_tip': if (this.mode === 'closed') throw new Error('请先开始游戏'); this.tip(); break;
      case 'demo_help':
        if (this.mode !== 'running') throw new Error('请先开始或继续游戏');
        this.requireFood();
        if (this.objects.length >= 500) throw new Error('请先收钱或清理台面');
        if (!await this.help()) throw new Error('目前没有排队的点面顾客');
        break;
      case 'demo_raid': case 'demo_restock': case 'demo_review': case 'demo_praise': case 'demo_thief': case 'demo_clearqueue': await this.shopAction(input.action.slice(5)); break;
      case 'slice': case 'boil': case 'take_pot': cookAction(this, input); break;
      case 'brew_coffee': case 'take_coffee': case 'add_jasmine': case 'pour_milk': cafeAction(this, input); break;
      case 'stir_pick': case 'stir_add': case 'stir_toss': case 'stir_bowl': case 'stir_move_bowl': case 'stir_plate': case 'stir_garnish': case 'stir_drink': case 'stir_discard': stirFryAction(this,input); break;
      case 'burger_bake': case 'burger_grill': case 'burger_take_bun': case 'burger_patty': case 'burger_topping': case 'burger_close': burgerAction(this,input); break;
      case 'drop_cooked': this.dropCooked(input); break;
      case 'place_bowl': this.placeBowl(); break;
      case 'workspace': this.workspace(input); break;
      case 'feed': await this.feed(input); break;
      case 'discard': this.discard(input); break;
      case 'deposit': await this.deposit(input); break;
      case 'test_throw': await this.throwFood(input.kind); break;
      case 'move_throw': await this.moveThrow(input); break;
      case 'spoil': await this.spoil(input); break;
      case 'clear_queue': this.queue = []; break;
      case 'clear_table': this.objects = []; this.selected = null; if(this.template().workflow==='burger')this.cooking=[]; this.stirfry=StirFryFood.empty(); this.revision++; break;
      case 'restore':
        await this.setStatus({ ...EMPTY_SHOP });
        await this.updateThrows((items, serial) => ({ serial, items: [] }));
        await this.saveWallet(0, [], []);
        this.queue = []; this.objects = []; this.departures = []; this.selected = null; this.theft = null; this.slice = null; this.cafeEffect=null;
        this.served = 0; this.joined = 0; this.lastServed = null; this.revision++;
        this.cooking=[];this.stirfry=StirFryFood.empty();
        this.pointerState = null; this.emit('motion', null); break;
      case 'save':
        if (input.preset_id !== undefined && input.preset_id !== this.activePreset) throw new Error('面馆已切换，请重新配置');
        await this.save(input.config); break;
      case 'leaderboard_page': {
        if (input.direction !== -1 && input.direction !== 1) throw new Error('榜单翻页方向无效');
        const elapsed = Math.max(0, Math.floor((Date.now() - this.leaderboard.at) / this.leaderboard.interval));
        this.leaderboard = { ...this.leaderboard, page: (this.leaderboard.page + elapsed + input.direction + 3) % 3, at: Date.now() };
        break;
      }
      case 'preset_create': case 'preset_use': case 'preset_rename': case 'preset_delete': await this.presetAction(input); break;
      default: throw new Error('操作不存在');
    }
    this.publish(); return this.snapshot();
  }
}
module.exports = { NoodleShop, DEFAULTS, config, safeFace };
