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
  const keys = ['chef','stats','gift_rule','thief_board','sign_top','sign_title','sign_bottom','cash_text','ketchup','salad','mayo','queue_overflow','queue_customers'];
  for (const key of keys) delete layout.props[key];
  const next = Layout.validate(layout);
  for (const key of keys) {
    assert.deepEqual(next.props[key], Layout.defaults.props[key]);
    next.props[key] = {...next.props[key],x:123,y:-45,scale:1.4};
    assert.throws(() => Layout.validate({...next,props:{...next.props,[key]:{x:0,y:0,scale:0}}}), /物品/);
  }
  await shop.save({ ...shop.config, layout:next });
  assert.deepEqual((await new NoodleShop(dir).init()).config.layout, next);
  assert.equal(Layout.itemModule('queue_customers'), 'customers'); assert.equal(Layout.itemModule('queue_overflow'), 'customers'); assert.equal(Layout.itemModule('thief_board'), 'customers'); assert.equal(Layout.itemModule('sign_title'), 'background'); assert.equal(Layout.itemModule('chef'), 'counter');
  const rest = Chef.pose(null, false, {x:120,y:80,scale:1});
  assert.deepEqual(rest.hand, {x:875,y:482});
  assert.deepEqual(Chef.pose({x:300,y:400},false,{x:120,y:80,scale:1}).hand, {x:300,y:400});
});

test('榜单旧位置缩放保留，宽高独立验证并持久保存', async t => {
  const {dir,shop}=await fixture(t), layout=structuredClone(Layout.defaults);
  layout.props.thief_board={x:45,y:-20,scale:1.3};
  const migrated=Layout.validate(layout);
  assert.deepEqual(migrated.props.thief_board,{x:45,y:-20,scale:1.3,width:220,height:300});
  for(const [key,values] of [['width',[179,1281,NaN,null,'220']],['height',[159,721,Infinity,null,'300']]])for(const value of values) {
    assert.throws(()=>Layout.validate({...migrated,props:{...migrated.props,thief_board:{...migrated.props.thief_board,[key]:value}}}),/榜单宽高/);
  }
  Object.assign(migrated.props.thief_board,{width:360,height:210});
  await shop.save({...shop.config,layout:migrated});
  assert.deepEqual((await new NoodleShop(dir).init()).config.layout.props.thief_board,migrated.props.thief_board);
});

test('榜单八方向拖动独立调整宽高，左上边保持对边不动，最小最大尺寸受限', () => {
  const original={x:40,y:20,scale:1.5,width:300,height:300};
  for(const edge of ['n','ne','e','se','s','sw','w','nw']) {
    const next=Layout.resizeBoard(original,edge,30,20);
    assert.equal(next.width,edge.includes('w')?270:edge.includes('e')?330:300);
    assert.equal(next.height,edge.includes('n')?280:edge.includes('s')?320:300);
    assert.equal(next.x,edge.includes('w')?85:40); assert.equal(next.y,edge.includes('n')?50:20);
    if(edge.includes('w'))assert.equal(next.x+next.width*next.scale,original.x+original.width*original.scale);
    if(edge.includes('n'))assert.equal(next.y+next.height*next.scale,original.y+original.height*original.scale);
    assert.equal(next.scale,original.scale);
  }
  assert.deepEqual(Layout.resizeBoard(original,'se',-1000,-1000),{...original,width:180,height:160});
  assert.deepEqual(Layout.resizeBoard(original,'se',2000,2000),{...original,width:1280,height:720});
  assert.deepEqual(original,{x:40,y:20,scale:1.5,width:300,height:300});
});
