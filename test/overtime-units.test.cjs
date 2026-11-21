const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OvertimeMachine, normalizeConfig } = require('../lib/overtime.cjs');
const { parseSeconds, ruleText } = require('../public/overtime/shared.js');
const { atomicJson } = require('../lib/services.cjs');

const rules = [
  { gift_name:'加30秒', gift_id:1, operation:'add', value:30, unit:'秒' },
  { gift_name:'加1小时', gift_id:2, operation:'add', value:1, unit:'小时' },
  { gift_name:'减10秒', gift_id:3, operation:'subtract', value:10, unit:'秒' },
  { gift_name:'老规则', gift_id:4, operation:'add', value:2 },
  { gift_name:'随机秒', gift_id:5, operation:'random_add', value:5, value_max:5, unit:'秒' },
  { gift_name:'翻倍', gift_id:6, operation:'multiply', value:2, unit:'秒' }
];
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-overtime-units-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await atomicJson(path.join(dir, 'seed', 'overtime.json'), { initial_text:'1', time_unit:'分钟', clear_lock_default_unlocked:true, gift_rules:rules });
  const machine = await new OvertimeMachine(dir, { seedDir:path.join(dir, 'seed'), clock:() => 0 }).init();
  const gift = (giftId, count = 1) => machine.receive({ type:'gift', giftId, uid:1, user:'观众', count });
  return { machine, gift, left:() => BigInt(machine.snapshot().remaining) };
}

test('时间单位：秒 / 分钟 / 小时都能选，老规则不写单位就是分钟，倍增不带单位', () => {
  const config = normalizeConfig({ initial_text:'60', gift_rules:rules });
  assert.deepEqual(config.gift_rules.map(r => r.unit), ['秒', '小时', '秒', undefined, '秒', undefined]);
  assert.throws(() => normalizeConfig({ initial_text:'60', gift_rules:[{ gift_name:'坏', gift_id:9, operation:'add', value:1, unit:'天' }] }), /秒、分钟或小时/);
  assert.equal(ruleText({ operation:'add', value:30, unit:'秒' }), '＋30 秒');
  assert.equal(ruleText({ operation:'subtract', value:2, unit:'小时' }), '−2 小时');
  assert.equal(ruleText({ operation:'add', value:5 }), '＋5 分钟');
  assert.equal(ruleText({ operation:'random_both', value:-10, value_max:10, unit:'秒' }), '随机 −10～＋10 秒');
  assert.equal(parseSeconds('30', '秒'), 30n); assert.equal(parseSeconds('2', '小时'), 7200n); assert.equal(parseSeconds('1.5分钟', '秒'), 90n);
  assert.throws(() => parseSeconds('1', '年'));
});

test('送礼按单位加减：30 秒、1 小时、减 10 秒、老规则 2 分钟、随机 5 秒', async t => {
  const { machine, gift, left } = await fixture(t);
  await machine.action({ action:'start' });
  assert.equal(left(), 60n);
  await gift(1); assert.equal(left(), 90n);
  await gift(1, 2); assert.equal(left(), 150n);
  await gift(2); assert.equal(left(), 3750n);
  await gift(3); assert.equal(left(), 3740n);
  await gift(4); assert.equal(left(), 3860n);
  await gift(5, 3); assert.equal(left(), 3875n);
  assert.match(machine.snapshot().history[0].effect, /随机加 15 秒/);
  await gift(6); assert.equal(left(), 7750n, '倍增照旧');
});

test('手动加减可以选单位，不选就是分钟', async t => {
  const { machine, left } = await fixture(t);
  await machine.action({ action:'manual', operation:'add', minutes:'45', unit:'秒' }); assert.equal(left(), 105n);
  await machine.action({ action:'manual', operation:'subtract', minutes:'1', unit:'分钟' }); assert.equal(left(), 45n);
  await machine.action({ action:'manual', operation:'add', minutes:'1' }); assert.equal(left(), 105n);
  await machine.action({ action:'manual', operation:'add', minutes:'1', unit:'天' }); assert.equal(left(), 86505n);
  await assert.rejects(machine.action({ action:'manual', operation:'add', minutes:'1', unit:'光年' }));
});
