const Layout = require('../../public/noodle/layout.js');
const Sign = require('../../public/noodle/sign.js');

const THROW_KINDS = ['leaf', 'egg', 'cockroach'];
const SHOP_GIFTS = ['raid', 'restock', 'review', 'praise', 'thief', 'help', 'clearqueue'];
const EMPTY_SHOP = { points: 500, sealed: false, raid_at: 0, sealed_until: 0 };
const DEFAULTS = { gift_name: '小花花', gift_id: 0, people_per_gift: 1, cook_seconds: 2, layout: Layout.defaults, sign: Sign.defaults, throw_gifts: { leaf: { gift_id: 31039, gift_name: '牛哇牛哇', match_name: true }, egg: { gift_id: 31212, gift_name: '打call', match_name: true } }, water_gift: { gift_id: 31036, gift_name: '小花花', match_name: true }, tip_gift: { gift_id: 35638, gift_name: '送花花', match_name: true }, gift_defaults_version: 1,
  thief_min: 10, thief_max: 50, raid_seconds: 30, raid_gift: { gift_id: 32251, gift_name: '心动盲盒', match_name: true }, restock_gift: { gift_id: 36062, gift_name: '波仔盲盒', match_name: true }, review_gift: { gift_id: 33987, gift_name: '人气票', match_name: true }, praise_gift: { gift_id: 31039, gift_name: '牛哇牛哇', match_name: true }, thief_gift: null, help_gift: { gift_id: 30758, gift_name: '这个好诶', match_name: true }, clearqueue_gift: { gift_id: 34685, gift_name: '冲鸭', match_name: true }, shop_gift_defaults_version: 1, cafe_sign_defaults_version: 1 };
function config(input) {
  if (!input || typeof input.gift_name !== 'string' || !input.gift_name.trim() || input.gift_name.length > 60 || !Number.isSafeInteger(input.gift_id) || input.gift_id < 0 || !Number.isInteger(input.people_per_gift) || input.people_per_gift < 1 || input.people_per_gift > 20) throw new Error('请选择排队礼物，每份礼物可排队 1–20 位');
  const rules = input.throw_gifts === undefined ? DEFAULTS.throw_gifts : input.throw_gifts;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules) || Object.keys(rules).some(key => !THROW_KINDS.includes(key))) throw new Error('投掷礼物配置无效');
  const throw_gifts = {};
  for (const kind of THROW_KINDS) {
    const rule = rules[kind];
    if (kind==='cockroach' && rule===undefined) continue;
    if (rule === null) { throw_gifts[kind] = null; continue; }
    if (!rule || !Number.isSafeInteger(rule.gift_id) || rule.gift_id < 1 || typeof rule.gift_name !== 'string' || !rule.gift_name.trim() || rule.gift_name.length > 60 || (rule.match_name!==undefined && typeof rule.match_name!=='boolean')) throw new Error('请从礼物库选择投掷礼物');
    throw_gifts[kind] = { gift_id: rule.gift_id, gift_name: rule.gift_name.trim(), ...(rule.match_name?{match_name:true}:{}) };
  }
  const water = input.water_gift;
  if (water != null && (!Number.isSafeInteger(water.gift_id) || water.gift_id < 1 || typeof water.gift_name !== 'string' || !water.gift_name.trim() || water.gift_name.length > 60 || (water.match_name!==undefined && typeof water.match_name!=='boolean'))) throw new Error('请从礼物库选择圣水礼物');
  const tip = input.tip_gift === undefined ? DEFAULTS.tip_gift : input.tip_gift;
  if (tip != null && (!Number.isSafeInteger(tip.gift_id) || tip.gift_id < 1 || typeof tip.gift_name !== 'string' || !tip.gift_name.trim() || tip.gift_name.length > 60 || (tip.match_name!==undefined && typeof tip.match_name!=='boolean'))) throw new Error('请从礼物库选择打赏礼物');
  if (input.gift_defaults_version!==undefined && ![0,1].includes(input.gift_defaults_version)) throw new Error('礼物默认配置版本无效');
  if (input.shop_gift_defaults_version!==undefined && ![0,1].includes(input.shop_gift_defaults_version)) throw new Error('店铺礼物默认配置版本无效');
  if (input.cafe_sign_defaults_version!==undefined && ![0,1].includes(input.cafe_sign_defaults_version)) throw new Error('咖啡厅招牌配置版本无效');
  const template_id=input.template_id ?? 'saozi';
  const thief_min = input.thief_min === undefined ? 10 : input.thief_min;
  const thief_max = input.thief_max === undefined ? 50 : input.thief_max;
  if (![thief_min, thief_max].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 100000000) || thief_min > thief_max) throw new Error('偷钱金额需为 1–100000000 元的整数，最小值不能大于最大值');
  const raid_seconds = input.raid_seconds === undefined ? DEFAULTS.raid_seconds : input.raid_seconds;
  const cook_seconds = input.cook_seconds === undefined ? DEFAULTS.cook_seconds : input.cook_seconds;
  if (!Number.isInteger(cook_seconds) || cook_seconds < 1 || cook_seconds > 60) throw new Error('煮面时长需为 1–60 秒的整数');
  if (!Number.isInteger(raid_seconds) || raid_seconds < 1 || raid_seconds > 3600) throw new Error('查封时长需为 1–3600 秒的整数');
  const shop_gifts = {};
  for (const kind of SHOP_GIFTS) {
    const rule = input[kind+'_gift'] === undefined ? DEFAULTS[kind+'_gift'] : input[kind+'_gift'];
    if (rule != null && (!Number.isSafeInteger(rule.gift_id) || rule.gift_id < 1 || typeof rule.gift_name !== 'string' || !rule.gift_name.trim() || rule.gift_name.length > 60 || (rule.match_name !== undefined && typeof rule.match_name !== 'boolean'))) throw new Error('请从礼物库选择店铺礼物');
    shop_gifts[kind+'_gift'] = rule == null ? null : { gift_id: rule.gift_id, gift_name: rule.gift_name.trim(), ...(rule.match_name ? { match_name: true } : {}) };
  }
  if(template_id!=='saozi' && (typeof template_id!=='string' || !/^t-[a-f0-9]{32}$/.test(template_id))) throw new Error('面馆模板编号无效');
  return { ...shop_gifts, thief_min, thief_max, raid_seconds, cook_seconds, gift_name: input.gift_name.trim(), gift_id: input.gift_id, people_per_gift: input.people_per_gift, layout: Layout.validate(input.layout), sign: Sign.validate(input.sign), throw_gifts, water_gift: water == null ? null : { gift_id: water.gift_id, gift_name: water.gift_name.trim(), ...(water.match_name?{match_name:true}:{}) }, tip_gift: tip == null ? null : { gift_id: tip.gift_id, gift_name: tip.gift_name.trim(), ...(tip.match_name?{match_name:true}:{}) }, gift_defaults_version: input.gift_defaults_version||0, shop_gift_defaults_version: input.shop_gift_defaults_version||0, cafe_sign_defaults_version: input.cafe_sign_defaults_version||0, template_id };
}
function presetName(input) {
  if (typeof input !== 'string' || !input.trim() || input.trim().length > 16 || /[\u0000-\u001f]/.test(input)) throw new Error('面馆名称需为 1–16 字');
  return input.trim();
}
module.exports = { DEFAULTS, THROW_KINDS, SHOP_GIFTS, EMPTY_SHOP, config, presetName };
