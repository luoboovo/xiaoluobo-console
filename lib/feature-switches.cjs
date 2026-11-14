const path = require('node:path');
const { EventEmitter } = require('node:events');
const { readJson, atomicJson } = require('./storage.cjs');

// 每个直播间玩法一个总开关：关着时不接直播间的礼物和弹幕（页面上的手动按钮照常能用）。
// 默认全关，主播想用哪个就在那个页面最上面打开；两个平台共用一套开关。
const FEATURES = [
  { id: 'noodle', name: '弹幕面馆', hint: '礼物下单做面' },
  { id: 'feeding', name: '小萝卜吃吃吃', hint: '礼物和弹幕投喂食物' },
  { id: 'lottery', name: '抽奖工具', hint: '弹幕口令报名' },
  { id: 'number_bomb', name: '数字炸弹', hint: '弹幕报名和猜数字' },
  { id: 'overtime', name: '加班机', hint: '礼物加减时间、播礼物素材' },
];
const IDS = FEATURES.map(f => f.id);

class FeatureSwitches extends EventEmitter {
  constructor(dataDir, { defaultOn = false } = {}) {
    super();
    this.file = path.join(dataDir, 'features.json');
    this.defaultOn = !!defaultOn;
    this.state = Object.fromEntries(IDS.map(id => [id, this.defaultOn]));
  }
  async init() {
    const saved = await readJson(this.file, null);
    const on = saved && typeof saved === 'object' && saved.on && typeof saved.on === 'object' ? saved.on : {};
    for (const id of IDS) if (typeof on[id] === 'boolean') this.state[id] = on[id];
    return this;
  }
  isOn(id) { return this.state[id] === true; }
  snapshot() { return FEATURES.map(f => ({ ...f, enabled: this.state[f.id] === true })); }
  async set(id, enabled) {
    if (!IDS.includes(id)) throw new Error('没有这个功能');
    if (typeof enabled !== 'boolean') throw new Error('开关只能是开或关');
    if (this.state[id] === enabled) return this.snapshot();
    const next = { ...this.state, [id]: enabled };
    await atomicJson(this.file, { version: 1, on: next });
    this.state = next;
    const list = this.snapshot();
    this.emit('change', list, id, enabled);
    return list;
  }
}

module.exports = { FeatureSwitches, FEATURES };
