const path = require('node:path');
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { atomicJson, readJson } = require('./storage.cjs');
const { parseMinutes, operations, normalizePanelStyle } = require('../public/overtime/shared.js');
const { safeFace } = require('./avatar.cjs');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { normalizeMedia } = require('./overtime-media.cjs');

// shortcut: 节目时间与累计统计最多1000位，超出时拒绝该次结算；需要更大数字时再提高上限。
const LIMIT = 10n ** 1000n - 1n;
function seconds(value) {
  if (typeof value !== 'string' || !/^\d{1,1000}$/.test(value)) throw new Error('加班记录中的时间无效，原文件已保留');
  return BigInt(value);
}
function normalizeVolume(value) {
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('素材音量须为0到100的整数');
  return value;
}
function normalizePanels(panels = []) {
  if (!Array.isArray(panels) || panels.length > 20) throw new Error('最多创建20个礼物面板');
  const ids = new Set();
  return panels.map(panel => {
    if (!panel || typeof panel !== 'object' || typeof panel.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(panel.id) || ids.has(panel.id)) throw new Error('礼物面板编号无效或重复');
    const name = String(panel.name ?? '').trim(), template = panel.template ?? 'overtime';
    if (!name || name.length > 40 || ![1,2,3].includes(panel.columns) || !['overtime','custom'].includes(template)) throw new Error('请填写面板名称、列数并选择有效模板');
    ids.add(panel.id);
    const base = {id:panel.id,name,columns:panel.columns,template,style:normalizePanelStyle(panel.style)};
    if (template === 'custom') {
      if (!Array.isArray(panel.entries) || panel.entries.length > 100) throw new Error('每个自定义面板最多配置100个礼物');
      const entries = panel.entries.map(entry => {
        if (!entry || typeof entry !== 'object') throw new Error('自定义礼物条目无效');
        const gift_name = String(entry.gift_name ?? '').trim(), gift_id = Number(entry.gift_id || 0), text = String(entry.text ?? '').trim();
        if (!gift_name || gift_name.length > 100 || !Number.isSafeInteger(gift_id) || gift_id < 0 || gift_id > 999999999 || !text || text.length > 200) throw new Error('请选择礼物，并填写1–200字的作用说明');
        return {gift_name,gift_id,text};
      });
      return {...base,entries};
    }
    if (typeof panel.all_rules !== 'boolean' || !Array.isArray(panel.gift_keys) || panel.gift_keys.length > 100 || panel.gift_keys.some(key => typeof key !== 'string' || !/^(id:\d{1,9}|name:.{1,100})$/u.test(key))) throw new Error('请选择加班机面板的展示礼物');
    return {...base,all_rules:panel.all_rules,gift_keys:[...new Set(panel.gift_keys)]};
  });
}
function normalizeConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('加班机配置无效');
  const initial_text = String(input.initial_text ?? input.initial_minutes ?? '60').trim();
  const time_unit = input.time_unit ?? '分钟';
  const initial = parseMinutes(initial_text, time_unit);
  if (!Array.isArray(input.gift_rules) || input.gift_rules.length > 100) throw new Error('最多配置100条礼物规则');
  const ids = new Set(), names = new Set();
  const gift_rules = input.gift_rules.map(rule => {
    if (!rule || typeof rule !== 'object') throw new Error('礼物规则无效');
    const gift_name = String(rule.gift_name ?? '').trim(), gift_id = Number(rule.gift_id || 0);
    const operation = ({ lock:'lock_toggle', '+':'add', '*':'multiply', x:'multiply', '×':'multiply', '/':'divide', '÷':'divide' })[rule.operation] || rule.operation;
    const value = ['clear','lock_toggle','media'].includes(operation) ? 1 : Number(rule.value);
    if (!gift_name || gift_name.length > 100 || !Number.isSafeInteger(gift_id) || gift_id < 0 || gift_id > 999999999 || !Object.hasOwn(operations, operation) || !Number.isSafeInteger(value) || value < (['multiply','divide'].includes(operation) ? 2 : 1) || value > 1e12) throw new Error('礼物名称、ID、操作或数值无效');
    if (gift_id ? ids.has(gift_id) : names.has(gift_name)) throw new Error('同一个礼物只能绑定一条加班规则');
    (gift_id ? ids : names).add(gift_id || gift_name);
    const media = rule.media ? normalizeMedia(rule.media) : undefined;
    if (operation === 'media' && !media) throw new Error('播放素材规则需要选择图片或视频');
    return { gift_name, gift_id, operation, value, ...(media ? {media} : {}) };
  });
  if (input.clear_lock_default_unlocked !== undefined && typeof input.clear_lock_default_unlocked !== 'boolean') throw new Error('清空锁配置无效');
  return { initial_text, time_unit, initial_minutes:initial.toString(), clear_lock_default_unlocked:input.clear_lock_default_unlocked !== false, media_volume:normalizeVolume(input.media_volume ?? 100), gift_rules, gift_panels:normalizePanels(input.gift_panels) };
}

class OvertimeMachine extends EventEmitter {
  constructor(dataDir, { seedDir, legacyFiles = [], clock = () => performance.now() } = {}) {
    super(); this.file = path.join(dataDir, 'overtime.json'); this.seedDir = seedDir; this.legacyFiles = legacyFiles; this.clock = clock;
    this.mediaDir = path.join(dataDir,'overtime-media'); this.mediaQueue = []; this.mediaCue = null;
  }
  async init() {
    let stored = await readJson(this.file, null);
    if (!stored) {
      let legacy;
      for (const file of this.legacyFiles) { legacy = await readJson(file, null); if (legacy) break; }
      const config = normalizeConfig(legacy || await readJson(path.join(this.seedDir || path.join(__dirname, '..', 'data'), 'overtime.json'), null) || await readJson(path.join(__dirname, '..', 'data', 'overtime.json'), null));
      stored = { config, remaining:(BigInt(config.initial_minutes) * 60n).toString(), mode:'idle', clear_locked:!config.clear_lock_default_unlocked, people:[], history:[], seen:[] };
    }
    const config = normalizeConfig(stored.config);
    seconds(stored.remaining);
    if (!['idle','running','paused','finished'].includes(stored.mode) || typeof stored.clear_locked !== 'boolean' || !Array.isArray(stored.people) || !Array.isArray(stored.history) || !Array.isArray(stored.seen)) throw new Error('加班记录无效，原文件已保留');
    for (const person of stored.people) { seconds(person.added); seconds(person.reduced); if (typeof person.key !== 'string' || typeof person.user !== 'string') throw new Error('观众记录无效'); }
    for (const record of stored.history) { seconds(record.added); seconds(record.reduced); }
    this.state = { ...stored, config, people:stored.people.map(person => ({...person,face:safeFace(person.face)})), history:stored.history.map(record => ({...record,face:safeFace(record.face)})), mode:stored.mode === 'running' ? 'paused' : stored.mode };
    this.anchor = this.clock();
    await atomicJson(this.file, this.state, {compact:true});
    return this;
  }
  remaining(state = this.state, anchor = this.anchor) {
    const elapsed = state.mode === 'running' ? BigInt(Math.max(0, Math.floor((this.clock() - anchor) / 1000))) : 0n;
    const value = BigInt(state.remaining) - elapsed;
    return value > 0n ? value : 0n;
  }
  snapshot() {
    const remaining = this.remaining().toString();
    return { ...this.state, seen:undefined, media_cue:this.mediaCue ? {...this.mediaCue,volume:this.state.config.media_volume} : null, remaining, mode:this.state.mode === 'running' && remaining === '0' ? 'finished' : this.state.mode, now:Date.now() };
  }
  async checkMedia(media) { await fs.access(path.join(this.mediaDir,media.asset)).catch(() => { throw new Error(`找不到素材“${media.name}”，请重新选择文件`); }); }
  playMedia(media, count = 1, preview = false) {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('礼物数量无效');
    if (!preview && this.snapshot().mode !== 'running') return;
    // 同素材的连续礼物只累计次数，避免大额连送创建海量播放对象。
    const last = this.mediaQueue.at(-1);
    if (last && JSON.stringify(last.media) === JSON.stringify(media)) last.count += BigInt(count);
    else this.mediaQueue.push({media,count:BigInt(count),preview});
    this.nextMedia();
  }
  nextMedia() {
    if (this.mediaCue || !this.mediaQueue.length) return;
    if (!this.mediaQueue[0].preview && this.snapshot().mode !== 'running') { this.stopMedia(); return; }
    const batch = this.mediaQueue[0], media = batch.media, started_at = Date.now();
    if (--batch.count === 0n) this.mediaQueue.shift();
    this.mediaCue = {...media,preview:batch.preview,volume:this.state.config.media_volume,id:randomUUID(),started_at,ends_at:started_at+Math.ceil(media.duration*1000)};
    this.emit('media',this.mediaCue);
    this.mediaTimer = setTimeout(() => { this.mediaCue = null; this.emit('media',null); this.nextMedia(); },Math.ceil(media.duration*1000));
    this.mediaTimer.unref();
  }
  stopMedia() { clearTimeout(this.mediaTimer); this.mediaCue = null; this.mediaQueue = []; this.emit('media',null); }
  stopInactiveMedia() {
    if (this.mediaCue && !this.mediaCue.preview && (this.state.mode !== 'running' || this.remaining() === 0n)) this.stopMedia();
  }
  close() { this.stopMedia(); }
  async commit(next, anchor) {
    await atomicJson(this.file, next, {compact:true});
    this.state = next; this.anchor = anchor; this.stopInactiveMedia(); this.emit('state', this.snapshot());
    return this.snapshot();
  }
  async checkpoint() {
    const next = { ...this.state, remaining:this.remaining().toString() }, anchor = this.clock();
    await atomicJson(this.file, next, {compact:true}); this.state = next; this.anchor = anchor;
  }
  async action(input) {
    if (!input || typeof input !== 'object') throw new Error('操作无效');
    if (input.action === 'stop_media') { this.stopMedia(); return this.snapshot(); }
    if (input.action === 'preview_media') { const media = normalizeMedia(input.media); await this.checkMedia(media); this.stopMedia(); this.playMedia(media, 1, true); return this.snapshot(); }
    if (['volume','panels'].includes(input.action)) {
      const config = input.action === 'volume' ? {...this.state.config,media_volume:normalizeVolume(input.volume)} : {...this.state.config,gift_panels:normalizePanels(input.panels)};
      // 展示配置只改配置，保留倒计时的秒内进度与当前清空锁。
      await atomicJson(this.file,{...this.state,config,remaining:this.remaining().toString()},{compact:true});
      this.state = {...this.state,config}; this.emit('state',this.snapshot()); return this.snapshot();
    }
    if (input.action === 'simulate') {
      const rule = this.state.config.gift_rules[input.rule];
      if (!rule || !Number.isSafeInteger(input.count) || input.count < 1 || !String(input.user || '').trim() || String(input.user).length > 100) throw new Error('请选择礼物并填写观众和数量');
      await this.receive({ type:'gift', user:input.user, giftId:rule.gift_id, giftName:rule.gift_name, count:input.count, simulated:true });
      return this.snapshot();
    }
    const anchor = this.clock(), next = { ...this.state, remaining:this.remaining().toString() };
    switch (input.action) {
      case 'configure': case 'import':
        next.config = normalizeConfig(input.config);
        if (input.config.gift_panels === undefined) next.config.gift_panels = this.state.config.gift_panels;
        next.clear_locked = !next.config.clear_lock_default_unlocked;
        for (const rule of next.config.gift_rules) if (rule.media) await this.checkMedia(rule.media);
        break;
      case 'start': if (next.remaining === '0') next.remaining = (BigInt(next.config.initial_minutes) * 60n).toString(); next.mode = 'running'; break;
      case 'pause': next.mode = 'paused'; break;
      case 'reset':
        next.remaining = (BigInt(next.config.initial_minutes) * 60n).toString(); next.people = []; next.history = []; next.clear_locked = !next.config.clear_lock_default_unlocked;
        // 保留交易去重，防止重置后迟到的同一礼物被再次结算。
        if (next.mode === 'finished') next.mode = 'paused'; break;
      case 'clear': next.remaining = '0'; next.mode = 'finished'; break;
      case 'lock': next.clear_locked = !next.clear_locked; break;
      case 'manual': {
        if (!['add','subtract'].includes(input.operation)) throw new Error('手动操作无效');
        const amount = parseMinutes(input.minutes) * 60n;
        const value = BigInt(next.remaining) + (input.operation === 'add' ? amount : -amount);
        if (value > LIMIT) throw new Error('时间超过1000位，操作未执行');
        next.remaining = (value > 0n ? value : 0n).toString();
        if (next.mode === 'finished' && value > 0n) next.mode = 'paused';
        break;
      }
      case 'clear_stats': next.people = []; next.history = []; break;
      default: throw new Error('加班机操作不存在');
    }
    const state = await this.commit(next, anchor);
    if (['pause','reset','clear'].includes(input.action)) { this.stopMedia(); return this.snapshot(); }
    return state;
  }
  async receive(event) { return this.receiveBatch([event]); }
  async receiveBatch(events, onError = error => { throw error; }) {
    let state = this.state, anchor = this.anchor;
    const now = Date.now(), seen = new Map(this.state.seen.filter(item => now - item.time < 300000).map(item => [item.key,item.time]));
    // One working copy of the viewer list per batch: copying and scanning it for every gift was O(viewers) per gift.
    const media = [], draft = {};
    for (const event of events) {
      try {
        const playEffects = state.mode === 'running' && this.remaining(state, anchor) > 0n;
        const result = this.prepareGift(event, state, anchor, seen, draft);
        if (!result) continue;
        state = result.next; anchor = result.anchor;
        if (result.transaction) {
          seen.set(result.transaction,result.time);
          if (seen.size > 50000) seen.delete(seen.keys().next().value);
        }
        if (playEffects && result.rule.media) media.push({media:result.rule.media,count:event.count});
      } catch (error) { onError(error); }
    }
    if (state === this.state) return;
    state.seen = Array.from(seen, ([key,time]) => ({key,time}));
    // Publish and play only after the entire batch is safely saved.
    await this.commit(state, anchor);
    const checked = new Map();
    for (const item of media) {
      try {
        if (!checked.has(item.media.asset)) checked.set(item.media.asset,this.checkMedia(item.media));
        await checked.get(item.media.asset);
        this.playMedia(item.media,item.count);
      } catch (error) { onError(error); }
    }
  }
  prepareGift(event, state, previousAnchor, seen, draft) {
    if (event.type !== 'gift' || state.mode === 'idle') return;
    const rule = state.config.gift_rules.find(rule => rule.gift_id ? rule.gift_id === event.giftId || event.giftAliases?.includes(rule.gift_id) : rule.gift_name === event.giftName);
    if (!rule) return;
    const count = event.count;
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('礼物数量无效');
    const uid = Number.isSafeInteger(event.uid) && event.uid > 0 || typeof event.uid==='string' && /^\d{1,30}$/.test(event.uid) ? event.uid : 0;
    const user = String(event.user || '未知观众').trim().slice(0,100) || '未知观众';
    const key = event.simulated ? `test:${user}` : uid ? `uid:${uid}` : `name:${user}`;
    const transaction = event.transactionId ? `${key}:${event.giftId}:${String(event.transactionId).slice(0,200)}` : '';
    const time = Date.now();
    if (transaction && seen.has(transaction)) return;
    const anchor = this.clock(), before = this.remaining(state, previousAnchor), next = { ...state }, value = BigInt(rule.value);
    let after = before, effect = '', blocked = false;
    if (!before && !['add','lock_toggle','media'].includes(rule.operation)) effect = '加班已结束，操作无效';
    else switch (rule.operation) {
      case 'add': after += value * BigInt(count) * 60n; break;
      case 'subtract': after -= value * BigInt(count) * 60n; if (after < 0n) after = 0n; break;
      case 'multiply':
        if (count * Math.log10(rule.value) + before.toString().length > 1000) throw new Error('倍增后超过1000位，礼物未结算');
        after *= value ** BigInt(count); break;
      case 'divide': {
        const floor = before < 60n ? before : 60n;
        for (let i = 0; i < count && after > floor; i++) { after /= value; if (after < floor) after = floor; }
        break;
      }
      case 'clear': if (next.clear_locked) { blocked = true; effect = '清空被禁止 🚫'; } else after = 0n; break;
      case 'lock_toggle': if (count % 2) next.clear_locked = !next.clear_locked; effect = next.clear_locked ? '清空已上锁 🔒' : '清空已解锁 🔓'; break;
      case 'media': effect = state.mode === 'running' && before > 0n ? '播放素材' : '加班机未运行，未播放素材'; break;
    }
    const added = after > before ? after - before : 0n, reduced = before > after ? before - after : 0n;
    if (after > LIMIT) throw new Error('时间超过1000位，礼物未结算');
    // A batch draft is shared by the gifts of one batch and only replaces this.state after the batch is saved.
    // Every check runs before the draft changes, so a rejected gift leaves it untouched.
    if (draft && !draft.people) {
      draft.people = state.people.slice(); draft.history = state.history.slice(0,200); draft.index = new Map();
      draft.people.forEach((person,i) => { if (!draft.index.has(person.key)) draft.index.set(person.key,i); });
    }
    const people = draft ? draft.people : state.people.slice();
    let index = draft ? draft.index.get(key) ?? -1 : people.findIndex(person => person.key === key);
    if (added || reduced) {
      const base = index < 0 ? { key, uid, user, simulated:!!event.simulated, face:'', added:'0', reduced:'0' } : people[index];
      const totalAdded = BigInt(base.added) + added, totalReduced = BigInt(base.reduced) + reduced;
      if (totalAdded > LIMIT || totalReduced > LIMIT) throw new Error('累计统计超过1000位，礼物未结算');
      const person = {...base, user, face:safeFace(event.face) || base.face, added:totalAdded.toString(), reduced:totalReduced.toString()};
      if (index < 0) { index = people.length; people.push(person); draft?.index.set(key,index); } else people[index] = person;
    }
    next.people = people;
    const record = { time, key, uid, user, face:safeFace(event.face) || (index < 0 ? '' : people[index].face) || '', gift_name:rule.gift_name, count, operation:rule.operation, added:added.toString(), reduced:reduced.toString(), effect:effect || (added ? '加班' : reduced ? '减班' : '时间未改变'), blocked, simulated:!!event.simulated };
    // shortcut: 保留最近200条明细与五分钟内5万笔去重记录；全量历史需求再增加独立流水文件。
    if (draft) { draft.history.unshift(record); if (draft.history.length > 200) draft.history.pop(); next.history = draft.history; }
    else next.history = [record, ...state.history].slice(0,200);
    next.remaining = after.toString();
    if (state.mode === 'finished' && added) next.mode = 'running';
    return {next,anchor,rule,transaction,time};
  }
}
module.exports = { OvertimeMachine, normalizeConfig };
