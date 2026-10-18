const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { NoodleShop, config, DEFAULTS } = require('../lib/noodle.cjs');
const Layout = require('../public/noodle/layout.js');
const Chef = require('../public/noodle/chef.js');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-money-layout-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, shop: await new NoodleShop(dir).init() };
}

test('旧金币余额只换算一次并备份，负数同样换算，新钱包按元保存', async t => {
  const { dir, shop } = await fixture(t);
  await fs.writeFile(shop.walletFile, JSON.stringify({ balance: -12 }));
  const migrated = await new NoodleShop(dir).init();
  assert.equal(migrated.balance, -1200);
  assert.deepEqual(JSON.parse(await fs.readFile(shop.walletFile + '.before-yuan-v256.json', 'utf8')), { balance: -12 });
  assert.equal((await new NoodleShop(dir).init()).balance, -1200);
  await migrated.saveWallet(123);
  assert.equal((await new NoodleShop(dir).init()).balance, 123);
});

test('偷钱默认含10与50两个端点，金额范围验证、保存和重启', async t => {
  const { dir, shop } = await fixture(t);
  const legacy = { ...DEFAULTS }; delete legacy.thief_min; delete legacy.thief_max;
  assert.equal(config(legacy).thief_min, 10); assert.equal(config(legacy).thief_max, 50);
  for (const [thief_min, thief_max] of [[0,50],[51,50],[10,1.5],[10,100000001],[null,50],['10',50]]) {
    assert.throws(() => config({ ...DEFAULTS, thief_min, thief_max }), /偷钱金额/);
  }
  await shop.saveWallet(1000);
  const random = t.mock.method(Math, 'random', () => 0);
  await shop.shopAction('thief', 1, { uid:1, user:'第一位' }); assert.equal(shop.theft.amount, 10);
  random.mock.mockImplementation(() => 0.9999999);
  await shop.shopAction('thief', 1, { uid:2, user:'第二位' }); assert.equal(shop.theft.amount, 50);
  await shop.save({ ...shop.config, thief_min:7, thief_max:7 });
  await shop.shopAction('thief', 1, { uid:'1', user:'更新名字' }); assert.equal(shop.theft.amount, 7);
  assert.deepEqual(shop.snapshot().thief_board.map(p=>[p.uid,p.amount]), [['2',50],['1',17]]);
  const reloaded = await new NoodleShop(dir).init();
  assert.equal(reloaded.config.thief_min, 7); assert.equal(reloaded.config.thief_max, 7);
  assert.equal(reloaded.balance, 933); assert.equal(reloaded.thieves.length, 2);
  assert.equal(reloaded.thieves[0].name, '更新名字');
});

test('写盘失败不扣钱、不增加榜单，金额溢出不消耗金币', async t => {
  const { dir, shop } = await fixture(t);
  await shop.saveWallet(100); const original = shop.walletFile;
  shop.walletFile = path.join(dir, 'blocked'); await fs.mkdir(shop.walletFile);
  await assert.rejects(shop.steal({ uid:1 }));
  assert.equal(shop.balance, 100); assert.deepEqual(shop.thieves, []); assert.equal(shop.theft, null);
  shop.walletFile = original; shop.mode = 'running'; shop.tip(); shop.balance = Number.MAX_SAFE_INTEGER - 99;
  await assert.rejects(shop.deposit({ revision:shop.revision, object_id:shop.objects[0].id }), /余额/);
  assert.equal(shop.objects.length, 1);
  await fs.writeFile(original, JSON.stringify({balance:0,unit_version:2,thieves:[{uid:'1',name:'坏记录',face:'',amount:-1}]}));
  await assert.rejects(new NoodleShop(dir).init(), /偷钱榜记录/);
});

test('旧布局补齐手、文字、榜单与酱料，所有对象位置大小可验证和保存', async t => {
  const { dir, shop } = await fixture(t);
  const layout = structuredClone(Layout.defaults);
  const keys = ['chef','stats','gift_rule','thief_board','sign_top','sign_title','sign_bottom','cash_text','ketchup','salad','mayo'];
  for (const key of keys) delete layout.props[key];
  const next = Layout.validate(layout);
  for (const key of keys) {
    assert.deepEqual(next.props[key], {x:0,y:0,scale:1});
    next.props[key] = {x:123,y:-45,scale:1.4};
    assert.throws(() => Layout.validate({...next,props:{...next.props,[key]:{x:0,y:0,scale:0}}}), /物品/);
  }
  await shop.save({ ...shop.config, layout:next });
  assert.deepEqual((await new NoodleShop(dir).init()).config.layout, next);
  assert.equal(Layout.itemModule('thief_board'), 'customers'); assert.equal(Layout.itemModule('sign_title'), 'background'); assert.equal(Layout.itemModule('chef'), 'counter');
  const rest = Chef.pose(null, false, {x:120,y:80,scale:1});
  assert.deepEqual(rest.hand, {x:875,y:482});
  assert.deepEqual(Chef.pose({x:300,y:400},false,{x:120,y:80,scale:1}).hand, {x:300,y:400});
});
