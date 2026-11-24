const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OvertimeMachine } = require('../lib/overtime.cjs');
const O = require('../public/overtime/shared.js');
const { atomicJson } = require('../lib/services.cjs');
const { startServer } = require('../server.cjs');

const config = { initial_text:'60', time_unit:'分钟', clear_lock_default_unlocked:true, gift_rules:[
  { gift_name:'小花花', gift_id:1, operation:'add', value:5 },
  { gift_name:'减时花', gift_id:2, operation:'subtract', value:1 },
  { gift_name:'锁', gift_id:3, operation:'lock_toggle', value:1 }
] };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'luobo-combo-'));
  t.after(() => fs.rm(dir,{ recursive:true, force:true }));
  await atomicJson(path.join(dir,'seed','overtime.json'),config);
  const machine = await new OvertimeMachine(dir,{ seedDir:path.join(dir,'seed'), clock:() => 0 }).init();
  const gift = (giftId, uid = 1, count = 1) => ({ type:'gift', giftId, uid, user:`观众${uid}`, count });
  return { dir, machine, gift, on:(extra = {}) => machine.action({ action:'combo', combo:{ enabled:true, ...extra } }) };
}

test('合体模式设置：默认关闭、缺项补默认、越界和非法值拒绝', () => {
  assert.equal(O.normalizeCombo().enabled,false);
  assert.deepEqual(O.normalizeCombo(O.normalizeCombo()),O.normalizeCombo());
  const combo = O.normalizeCombo({ enabled:true, panel:{ lines:[1,2], labels:{ 'id:1':' 好运 ', 'id:2':' ' } }, texts:[{ text:' 距离\n成功 ', x:1, y:2, w:50, h:5 }] });
  assert.deepEqual(combo.panel.labels,{ 'id:1':'好运' });
  assert.deepEqual(combo.texts[0],{ text:'距离\n成功', x:1, y:2, w:50, h:5, size:32, color:'#ffffff', stroke:'#000000', bold:true, align:'center' });
  const text = { text:'字', x:0, y:0, w:50, h:5 };
  for (const bad of [null,[],{ enabled:'1' },{ width:10 },{ clock:{ x:0, y:0, w:1, h:20 } },{ panel:{ theme:'toString' } },{ panel:{ flow:'x' } },{ panel:{ per_line:0 } },{ panel:{ lines:[0] } },{ panel:{ title:'字'.repeat(21) } },{ panel:{ order:['x'] } },{ panel:{ labels:{ 'id:1':'字'.repeat(31) } } },{ float:{ seconds:1 } },{ float:{ style:'x' } },{ add_color:'red' },{ texts:[{ ...text, text:' ' }] },{ texts:[{ ...text, color:'red' }] },{ texts:Array(11).fill(text) }])
    assert.throws(() => O.normalizeCombo(bad),undefined,JSON.stringify(bad));
});

test('面板排列：自定义顺序、隐藏、新礼物接在最后、每排个数、自定义文字', () => {
  const combo = O.normalizeCombo({ panel:{ order:['id:3','id:1'], hidden:['id:3'], labels:{ 'id:1':'好运' }, lines:[1], per_line:2 } });
  assert.deepEqual(O.comboRules(combo,config.gift_rules).map(O.ruleKey),['id:1','id:2']);
  assert.deepEqual(O.comboRules(combo,config.gift_rules,true).map(O.ruleKey),['id:3','id:1','id:2']);
  assert.deepEqual(O.comboLines(combo.panel,[1,2,3,4]),[[1],[2,3],[4]]);
  assert.equal(O.comboEffect(config.gift_rules[0]),'+5分钟');
  assert.equal(O.comboEffect(config.gift_rules[1]),'-1分钟');
  assert.equal(O.comboEffect(config.gift_rules[0],combo.panel.labels),'好运');
});

test('飘字：送礼和手动加减写明谁送了什么、加减多少；没开合体模式不飘；试飘不改时间和统计', async t => {
  const { machine, gift, on } = await fixture(t);
  await machine.action({ action:'start' });
  await machine.receive(gift(1)); assert.equal(machine.snapshot().floats.length,0);
  await assert.rejects(machine.action({ action:'float_demo' }),/开启合体模式/);
  await on();
  await machine.receiveBatch([gift(1,7,2),gift(2,8),gift(3,9)]);
  await machine.action({ action:'manual', operation:'subtract', minutes:'1' });
  const texts = machine.snapshot().floats.map(item => { const { who, what, amounts } = O.floatText(item); return [who,what,...amounts.map(a => a.text)].filter(Boolean).join(' '); });
  assert.deepEqual(texts,['观众7 小花花 ×2 +10分钟','观众8 减时花 -1分钟','减时 -1分钟'],'锁不加减时间，不飘');
  assert.equal(O.floatText(machine.snapshot().floats[0],false).who,'');
  const { remaining, people, history } = machine.snapshot();
  await machine.action({ action:'float_demo' });
  const after = machine.snapshot();
  assert.equal(after.floats.length,4); assert.equal(after.remaining,remaining); assert.deepEqual(after.people,people); assert.deepEqual(after.history,history);
  await machine.action({ action:'reset' }); assert.equal(machine.snapshot().floats.length,0);
  await machine.action({ action:'float_demo' }); await on({ float:{ enabled:false } }); assert.equal(machine.snapshot().floats.length,0);
});

test('飘字排队：同一条道不重叠，同一人连送合并，高峰合成一条且总数不丢', async t => {
  const { machine, on } = await fixture(t); await on();
  const now = Date.now(), add = key => machine.addFloat({ source:'gift', key, user:key, gift_id:1, gift_name:'小花花', count:1, added:'300', reduced:'0' },now);
  for (let i = 0; i < 3; i++) add('a');
  for (let i = 0; i < 100; i++) add(`u${i}`);
  const floats = machine.floats, combo = machine.state.config.combo, lanes = new Map();
  for (const item of floats) { assert.ok(item.at >= (lanes.get(item.lane) || 0)); lanes.set(item.lane,item.at + O.floatClear(item,combo) * 1000); }
  assert.equal(floats.filter(item => item.source === 'more').length,1);
  assert.ok(floats.every(item => item.at <= now + 20000));
  assert.equal(floats.reduce((sum,item) => sum + Number(item.added),0),103 * 300);
});

test('合体设置：保存不动倒计时，改别的设置和重启都还在', async t => {
  const { dir, machine, on } = await fixture(t);
  const { remaining } = machine.snapshot();
  await on({ width:800, panel:{ order:['id:2','id:1'] } });
  assert.equal(machine.snapshot().remaining,remaining);
  await machine.action({ action:'configure', config });
  assert.equal(machine.snapshot().config.combo.width,800);
  await assert.rejects(on({ width:1 }),/画面宽度/);
  const again = await new OvertimeMachine(dir).init();
  assert.deepEqual(again.snapshot().config.combo.panel.order,['id:2','id:1']); assert.equal(again.snapshot().config.combo.enabled,true);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'overtime.json'),'utf8')).floats,undefined,'飘字不存档');
});

test('服务整合：各画面收到同一份布局和飘字，昵称打码，资源能打开', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'luobo-combo-'));
  const app = await startServer({ port:0, dataDir:dir });
  t.after(async () => { await app.close(); await fs.rm(dir,{ recursive:true, force:true }); });
  for (const file of ['overtime/combo.js','overtime/combo.css','overtime-combo-console.js','overtime-combo-console.css']) assert.equal((await fetch(`${app.url}/${file}`)).status,200,file);
  await app.overtime.action({ action:'combo', combo:{ enabled:true } });
  app.overtime.addFloat({ source:'gift', key:'uid:9', user:'小**', gift_id:1, gift_name:'小花花', count:1, added:'300', reduced:'0' });
  const first = async () => {
    const abort = new AbortController(), response = await fetch(`${app.url}/api/events?overtime=1`,{ signal:abort.signal }), reader = response.body.getReader();
    let text = ''; const decoder = new TextDecoder();
    while (!/event: overtime\ndata: .*\n\n/.test(text)) text += decoder.decode((await reader.read()).value,{ stream:true });
    abort.abort(); return JSON.parse(text.match(/event: overtime\ndata: (.*)\n/)[1]);
  };
  const [one,two] = [await first(),await first()];
  assert.deepEqual(one.floats,two.floats); assert.deepEqual(one.config.combo,two.config.combo);
  assert.equal(one.floats[0].user,'小***'); assert.equal(one.floats[0].key,undefined);
});
