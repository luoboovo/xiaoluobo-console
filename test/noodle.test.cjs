const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { NoodleShop, config, DEFAULTS, safeFace } = require('../lib/noodle.cjs');
const { startServer } = require('../server.cjs');
const { giftV2 } = require('../lib/protocol.cjs');
const Layout = require('../public/noodle/layout.js');
const Sign = require('../public/noodle/sign.js');
globalThis.NoodleRules = require('../public/noodle/rules.js');
require('../public/noodle/chef-config.js');
require('../public/noodle/chef-systems.js');

test('礼物排队：稳定 ID、连送、交易去重、暂停保留、头像校验、队列上限', () => {
  const shop = new NoodleShop('.'); shop.config.gift_id = 1; shop.config.water_gift = null;
  const event = { type: 'gift', user: '观众', uid: 42, face: 'http://i0.hdslb.com/avatar.jpg', giftId: 1, giftName: '小花花', count: 3, transactionId: 'a' };
  shop.receive(event); assert.equal(shop.queue.length, 0);
  shop.mode = 'running'; shop.receive(event); shop.receive(event); assert.equal(shop.queue.length, 3);
  shop.receive({ ...event, transactionId: 'b' }); assert.equal(shop.queue.length, 6);
  shop.receive({ ...event, giftId: 2, transactionId: 'c' }); assert.equal(shop.queue.length, 6);
  shop.mode = 'paused'; shop.receive({ ...event, count: 2, transactionId: 'd' }); assert.equal(shop.queue.length, 8);
  assert.equal(shop.queue[0].face, 'https://i0.hdslb.com/avatar.jpg');
  shop.receive({ ...event, count: 100000, transactionId: 'e' }); assert.equal(shop.queue.length, 2000);
  for (const face of ['https://evil.com/a', 'https://hdslb.com.evil.com/a', 'http://127.0.0.1/a', 'https://i0.hdslb.com:8080/a', 'data:text/html,a']) assert.equal(safeFace(face), '');
  shop.receive({ type: 'chat', uid: 42, face: 'https://i0.hdslb.com/new.jpg' }); assert.equal(shop.queue[0].face, 'https://i0.hdslb.com/new.jpg');
  const defaults = new NoodleShop('.'); defaults.mode = 'running';
  defaults.receive(event); defaults.receive({ ...event, giftId: 2, transactionId: 'another' });
  assert.equal(defaults.queue.length, 6);
});

test('臊子面试点单：开张后只添加一位要面的顾客', async () => {
  const shop = new NoodleShop('.');
  await assert.rejects(shop.action({ action: 'demo_noodles' }), /请先开始游戏/);
  await shop.action({ action: 'start' }); await shop.action({ action: 'demo_noodles' });
  assert.equal(shop.queue.length, 1); assert.equal(shop.queue[0].order, 'noodles');
});

test('台面与递餐：错误版本不覆盖，碰撞退回，只递给选中的顾客', async () => {
  const shop = new NoodleShop('.'); shop.mode = 'running'; shop.enqueue('前排', 1); shop.enqueue('后排', 1);
  const bowl = { id: 1, kind: 'bowl', x: 500, y: 500, noodles: 2, sauce: 3 };
  shop.workspace({ revision: 0, objects: [bowl], selected: 1 });
  assert.throws(() => shop.workspace({ revision: 0, objects: [], selected: null }), /已更新/);
  assert.throws(() => shop.workspace({ revision: 1, objects: [bowl, { ...bowl, id: 2, x: 510 }], selected: 1 }), /重叠/);
  assert.throws(() => shop.workspace({ revision: 1, objects: [{ ...bowl, x: NaN }], selected: 1 }), /无效/);
  await assert.rejects(shop.feed({ revision: 1, bowl_id: 1, customer_id: 999 }), /已离开/);
  const second = shop.queue[1].id; await shop.feed({ revision: 1, bowl_id: 1, customer_id: second });
  assert.equal(shop.queue.length, 1); assert.equal(shop.queue[0].name, '前排'); assert.equal(shop.served, 1); assert.equal(shop.objects.length, 1); assert.equal(shop.objects[0].kind, 'coin'); assert.equal(shop.lastServed.id, second);
});

test('操作同步：拖拽仅作预览、限制坐标和物品、旧版本无效、取消暂停与超时清理', async () => {
  const shop = new NoodleShop('.');
  const item = { id: 1, kind: 'bowl', x: 700, y: 490, noodles: 0, sauce: 0 };
  const motion = { client: 'controller-a', revision: 0, pointer: { x: 746, y: 477, pressed: true }, drag: item };
  assert.equal(shop.motion(motion), false);
  await shop.action({ action: 'start' });
  assert.equal(shop.motion(motion), true);
  assert.deepEqual(shop.motionSnapshot().drag, item);
  assert.equal(shop.motion({ ...motion, pointer: null }), true);
  assert.equal(shop.motionSnapshot().pointer, null);
  assert.deepEqual(shop.motionSnapshot().drag, item);
  shop.motion(motion);
  assert.equal(shop.objects.length, 0); assert.equal(shop.revision, 0);
  for (const invalid of [{ ...motion, pointer: { x: -1, y: 20, pressed: false } }, { ...motion, pointer: { x: 20, y: Infinity, pressed: false } }, { ...motion, drag: { ...item, x: NaN } }, { ...motion, drag: { ...item, kind: 'script' } }, { ...motion, drag: { ...item, id: 2 } }, { ...motion, drag: { ...item, noodles: 99 } }]) assert.throws(() => shop.motion(invalid), /无效|已更新/);
  assert.equal(shop.motion({ client: 'other', revision: 0, pointer: null, drag: null }), false);
  shop.workspace({ revision: 0, objects: [item], selected: 1 });
  assert.equal(shop.motionSnapshot().drag, null); assert.equal(shop.motionSnapshot().pointer.pressed, false);
  assert.equal(shop.motion(motion), false);
  assert.equal(shop.motion({ ...motion, revision: 1, drag: { ...item, x: 100 } }), true);
  assert.equal(shop.objects[0].x, 700);
  assert.equal(shop.motion({ ...motion, revision: 1, drag: null, pointer: { x: 200, y: 200, pressed: false } }), true);
  assert.equal(shop.motionSnapshot().drag, null);
  shop.pointerAt = Date.now() - 2600; assert.equal(shop.motionSnapshot(), null);
  shop.motion({ ...motion, revision: 1 });
  await shop.action({ action: 'pause' }); assert.equal(shop.motionSnapshot(), null);
  await shop.action({ action: 'start' }); shop.motion({ ...motion, revision: 1 });
  assert.equal(shop.motion({ client: 'controller-a', revision: 0, pointer: null, drag: null }), true);
  assert.equal(shop.motionSnapshot(), null); assert.equal(shop.objects.length, 1);
});

test('搭建：左右取料区、模块坐标逆变换、前排顾客优先命中、配置边界', async () => {
  const layout = structuredClone(Layout.defaults);
  layout.stations.noodles.side = 'right'; layout.stations.sauce.side = 'left';
  const stations = Layout.stations(layout);
  assert.ok(stations.find(s => s.kind === 'noodles').x > 900); assert.ok(stations.find(s => s.kind === 'sauce').x < 320);
  const module = { x: 70, y: -20, scale: .8 }, point = { x: 500, y: 400 };
  assert.deepEqual(Layout.fromStage(Layout.toStage(point, module), module), point);
  const positions = Array.from({ length: 120 }, (_, i) => Layout.position(i));
  assert.equal(new Set(positions.map(p => `${p.x},${p.y}`)).size, 120);
  assert.ok(positions.every(p => p.x >= 0 && p.x + 72 <= 1280 && p.y >= 480 && p.y + 94 <= 720));
  globalThis.NoodleLayout = Layout;
  const source = await fs.readFile(path.join(__dirname, '../public/noodle/shared.js'), 'utf8');
  const shared = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const queue = Array.from({ length: 21 }, (_, i) => ({ id: i }));
  assert.equal(shared.customerAt(queue, 70, 620).id, 0);
  assert.equal(shared.customerAt(queue, -10, -10), undefined);
  assert.throws(() => config({ ...DEFAULTS, people_per_gift: 21 }));
  assert.throws(() => Layout.validate({ ...layout, modules: { ...layout.modules, counter: { ...layout.modules.counter, scale: 0 } } }));
});

test('原做面回归：重复加料、重拾、整碗移动、碰撞和取消', () => {
  const { GameState, DragSystem, RecipeSystem } = globalThis.ChefSystems;
  const s = new GameState(), d = new DragSystem(s);
  d.down(1110, 460); d.move(500, 500); d.up(); const bowl = s.objects[0];
  for (const kind of ['sauce', 'noodles', 'noodles', 'sauce']) { d.down(kind === 'sauce' ? 945 : 155, 430); d.move(bowl.x, bowl.y); d.up(); }
  assert.equal(bowl.noodles, 2); assert.equal(bowl.sauce, 2); assert.ok(RecipeSystem.ready(bowl));
  d.down(1110, 460); d.move(800, 500); d.up(); const second = s.objects.at(-1);
  d.down(second.x, second.y); d.move(bowl.x, bowl.y); d.up(); assert.equal(second.x, 800);
  d.down(bowl.x, bowl.y); d.move(650, 480); d.up(); assert.equal(bowl.x, 650); assert.equal(bowl.sauce, 2);
  d.down(155, 430); d.up(true); assert.equal(s.objects.length, 2);
});

test('招牌：兼容旧配置、空白可隐藏、限制长度与类型、拒绝多行', () => {
  const { sign, ...legacy } = DEFAULTS;
  assert.deepEqual(config(legacy).sign, Sign.defaults);
  assert.deepEqual(config({ ...legacy, sign: { top: '   ', title: '  萝卜面馆  ', bottom: '' } }).sign, { top: '', title: '萝卜面馆', bottom: '' });
  for (const invalid of [null, [], '招牌', {}, { ...sign, title: 12 }, { ...sign, title: '面'.repeat(17) }, { ...sign, top: '面'.repeat(25) }, { ...sign, bottom: '面'.repeat(33) }, { ...sign, title: '面\n馆' }]) assert.throws(() => config({ ...legacy, sign: invalid }), /招牌/);
  assert.equal(config({ ...legacy, sign: { top: '', title: '<img src=x>', bottom: '' } }).sign.title, '<img src=x>');
});

test('本机集成：B站礼物直接排队、游戏状态、配置持久保存、三层地址和安全边界', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-noodle-'));
  await fs.writeFile(path.join(dir, 'gifts.json'), JSON.stringify({ list: [{ id: 1, name: '小花花', icon: '', price: 0 }] }));
  const runtime = await startServer({ dataDir: dir, seedDir: dir });
  const post = input => fetch(runtime.url + '/api/noodle/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  try {
    await post({ action: 'start' });
    const message = { cmd: 'SEND_GIFT', data: { uname: '真人观众', uid: 42, face: 'https://i0.hdslb.com/a.jpg', giftId: runtime.noodle.config.gift_id, giftName: runtime.noodle.config.gift_name, num: 2, tid: 'one' } };
    runtime.services.liveMessage(message); runtime.services.liveMessage(message);
    const state = await (await fetch(runtime.url + '/api/noodle/state')).json(); assert.equal(state.queue_count, 2); assert.equal(state.queue[0].name, '真人观众'); assert.equal(state.queue[0].uid, 42);
    const motion = { client: 'test-drag', revision: state.workspace_revision, pointer: null, drag: { id: 1, kind: 'bowl', x: 500, y: 450, noodles: 0, sauce: 0 } };
    const sendMotion = body => fetch(runtime.url + '/api/noodle/motion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const stop = new AbortController(), timeout = setTimeout(() => stop.abort(), 3000);
    try {
      const response = await fetch(runtime.url + '/api/events', { signal: stop.signal });
      const reader = response.body.getReader(); await reader.read();
      assert.equal((await (await sendMotion(motion)).json()).accepted, true);
      let stream = '';
      while (!stream.includes('test-drag')) stream += new TextDecoder().decode((await reader.read()).value);
      assert.match(stream, /event: noodle-motion/); assert.match(stream, /"pointer":null,"drag":\{"id":1,"kind":"bowl","x":500/);
      assert.equal(runtime.noodle.objects.length, 0); assert.equal(runtime.noodle.revision, state.workspace_revision);
      assert.equal((await sendMotion({ ...motion, pointer: { x: 2000, y: 400, pressed: true } })).status, 400);
      await reader.cancel();
    } finally { clearTimeout(timeout); stop.abort(); }
    const next = structuredClone(state.config); next.layout.stations.noodles.side = 'right'; next.layout.modules.counter.y = 20;
    next.sign = { top: '', title: '萝卜面馆', bottom: '欢迎来吃面' };
    assert.equal((await post({ action: 'save', config: next })).status, 200);
    assert.deepEqual((await new NoodleShop(dir, runtime.noodle.templates).init()).config, next);
    assert.equal((await post({ action: 'save', config: { ...next, people_per_gift: -1 } })).status, 400);
    assert.equal((await post({ action: 'save', config: { ...next, sign: { ...next.sign, title: '面'.repeat(17) } } })).status, 400);
    assert.deepEqual((await new NoodleShop(dir, runtime.noodle.templates).init()).config, next);
    const legacy = structuredClone(next); delete legacy.sign;
    await fs.writeFile(path.join(dir, 'noodle.json'), JSON.stringify(legacy));
    assert.deepEqual((await new NoodleShop(dir).init()).config.sign, Sign.defaults);
    for (const layer of ['background', 'counter', 'customers']) {
      const response = await fetch(runtime.url + '/noodle/?layer=' + layer); assert.equal(response.status, 200); assert.match(await response.text(), /data-module="customers"/); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    }
    assert.equal((await fetch(runtime.url + '/noodle/assets/pot.png')).headers.get('content-type'), 'image/png');
    assert.equal((await fetch(runtime.url + '/noodle/sign.js')).headers.get('content-type'), 'text/javascript');
    const blocked = await fetch(runtime.url + '/api/noodle/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.com' }, body: '{"action":"clear_queue"}' }); assert.equal(blocked.status, 403);
    assert.equal((await fetch(runtime.url + '/noodle/assets/settings.local.json')).status, 404);
  } finally { await runtime.close(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.match(path.basename(dir), /^xiaoluobo-noodle-/); await fs.rm(dir, { recursive: true, force: true }); }
});

test('新版礼物保留头像、用户、交易 ID 与盲盒，避免重复触发', () => {
  const str = (tag, value) => { const bytes = Buffer.from(value); return Buffer.concat([Buffer.from([tag * 8 + 2, bytes.length]), bytes]); };
  const item = Buffer.concat([Buffer.from([8, 1, 24, 2]), str(2, '小花花'), str(9, 'transaction')]);
  const blind = str(3, '盲盒');
  const pb = Buffer.concat([Buffer.from([8, 42]), str(2, '观众'), str(3, 'https://i0.hdslb.com/a.jpg'), Buffer.from([74, blind.length]), blind, Buffer.from([82, item.length]), item]);
  const gift = giftV2(pb.toString('base64'))[0];
  assert.equal(gift.uid, 42); assert.equal(gift.transactionId, 'transaction'); assert.equal(gift.blindGiftName, '盲盒'); assert.equal(gift.count, 2); assert.match(gift.face, /hdslb/);
});

test('垃圾桶：左右位置跟随背景，台面拖拽坐标可命中，隐藏后不接收', () => {
  const layout = structuredClone(Layout.defaults);
  const legacy = structuredClone(layout); delete legacy.trash;
  assert.deepEqual(Layout.validate(legacy).trash, { side: 'right' });
  for (const side of ['left', 'right']) {
    layout.trash.side = side;
    layout.modules.background = { x: -40, y: 20, scale: .8, visible: true };
    layout.modules.counter = { x: 70, y: -30, scale: 1.2, visible: true };
    const r = Layout.trashRect(layout), target = Layout.toStage({ x: r.x + r.width / 2, y: r.y + 35 }, layout.modules.background);
    const world = Layout.fromStage(target, layout.modules.counter);
    assert.ok(Layout.trashContains(Layout.toStage(world, layout.modules.counter), layout));
    assert.equal(Layout.trashContains({ x: 640, y: 450 }, layout), false);
    layout.modules.background.visible = false;
    assert.equal(Layout.trashContains(target, layout), false);
  }
  assert.throws(() => Layout.validate({ ...layout, trash: { side: 'middle' } }), /垃圾桶/);
});

test('丢弃：删除指定食材或碗，旧版本和暂停不误删，不影响顾客与出餐', async () => {
  const shop = new NoodleShop('.'); shop.mode = 'running'; shop.enqueue('观众', 2);
  const bowl = { id: 1, kind: 'bowl', x: 500, y: 480, noodles: 1, sauce: 1 };
  const food = { id: 2, kind: 'noodles', x: 700, y: 480, noodles: 0, sauce: 0 };
  shop.workspace({ revision: 0, objects: [bowl, food], selected: 1 });
  assert.throws(() => shop.discard({ revision: 0, object_id: 1 }), /已更新/);
  assert.throws(() => shop.discard({ revision: 1, object_id: 999 }), /不在台面/);
  assert.equal(shop.objects.length, 2);
  await shop.action({ action: 'discard', revision: 1, object_id: 2 });
  assert.deepEqual(shop.objects, [bowl]); assert.equal(shop.selected, 1);
  shop.mode = 'paused'; assert.throws(() => shop.discard({ revision: 2, object_id: 1 }), /开始游戏/);
  shop.mode = 'running'; await shop.action({ action: 'discard', revision: 2, object_id: 1 });
  assert.equal(shop.objects.length, 0); assert.equal(shop.selected, null);
  assert.equal(shop.queue.length, 2); assert.equal(shop.served, 0); assert.equal(shop.revision, 3);
});

test('礼物投掷：按 ID 绑定、各 36 个、不会过期或替换、移动与垃圾桶清理持久保存', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'noodle-throws-'));
  try {
  const shop = await new NoodleShop(dir).init(); shop.config.gift_id = 7;
  shop.config.throw_gifts = { leaf: { gift_id: 2, gift_name: '菜叶礼物' }, egg: { gift_id: 7, gift_name: '鸡蛋礼物' } };
  const event = { type: 'gift', uid: 42, user: '观众', giftId: 2, giftName: '改过名称', count: 3, transactionId: 'leaf-a' };
  await shop.receive(event); assert.equal(shop.throws.length, 0);
  shop.mode = 'running'; await shop.receive(event); await shop.receive(event);
  assert.equal(shop.throws.length, 3); assert.ok(shop.throws.every(item => item.kind === 'leaf')); assert.equal(shop.queue.length, 0);
  await shop.receive({ ...event, giftId: 9, giftName: '菜叶礼物', transactionId: 'wrong-id' }); assert.equal(shop.throws.length, 3);
  shop.mode = 'paused'; await shop.receive({ ...event, giftId: 7, count: 2, transactionId: 'egg-a' });
  assert.equal(shop.queue.length, 2); assert.equal(shop.throws.length, 5); assert.equal(shop.throws.at(-1).kind, 'egg');
  await shop.receive({ ...event, count: 1000000, transactionId: 'many-a' }); assert.equal(shop.throws.length, 38);
  await shop.receive({ ...event, giftId:7, count:1000000, transactionId:'many-eggs' });
  const before=structuredClone(shop.throws);
  await shop.receive({ ...event, count:1000000, transactionId:'full-leaves' });assert.deepEqual(shop.throws,before);
  assert.equal(shop.throws.length, 72); assert.equal(new Set(shop.throws.map(item => item.id)).size, 72);
  for (const item of shop.throws) item.at -= 5000;
  assert.equal(shop.snapshot().throws.length, 72);
  await shop.action({ action: 'test_throw', kind: 'egg' }); assert.equal(shop.snapshot().throws.length, 72);
  shop.mode='running'; const item=shop.throws[0];
  await shop.moveThrow({revision:shop.revision,throw_id:item.id,throw_revision:0,x:650,y:500,discard:false});
  assert.equal(shop.throws[0].x,650);assert.equal((await new NoodleShop(dir).init()).throws.length,72);
  await assert.rejects(shop.moveThrow({revision:shop.revision,throw_id:item.id,throw_revision:0,x:1180,y:290,discard:true}),/已更新/);
  await assert.rejects(shop.moveThrow({revision:shop.revision,throw_id:item.id,throw_revision:1,x:650,y:500,discard:true}),/垃圾桶/);
  await shop.moveThrow({revision:shop.revision,throw_id:item.id,throw_revision:1,x:1180,y:290,discard:true});
  await shop.action({action:'clear_table'}); await shop.action({action:'clear_queue'});
  assert.equal(shop.throws.length,71);assert.equal((await new NoodleShop(dir).init()).throws.length,71);
  await assert.rejects(shop.action({ action: 'test_throw', kind: '../other' }), /不存在/);
  const { throw_gifts, ...legacy } = DEFAULTS;
  assert.deepEqual(config(legacy).throw_gifts, DEFAULTS.throw_gifts);
  for (const rules of [null, [], {}, { ...throw_gifts, tomato: null }, { ...throw_gifts, leaf: { gift_id: 0, gift_name: 'x' } }, { ...throw_gifts, egg: { gift_id: 1, gift_name: '' } }]) assert.throws(() => config({ ...legacy, throw_gifts: rules }), /投掷/);
  } finally { assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true}); }
});

test('圣水点单：礼物 ID、连送去重、同礼物优先点水、出餐付款', async () => {
  const shop = new NoodleShop('.'); shop.mode = 'running'; shop.config.gift_id = 7;
  shop.config.water_gift = { gift_id: 7, gift_name: '点水礼物' };
  const event = { type:'gift', giftId:7, giftName:'不同名称', count:2, uid:42, user:'观众', transactionId:'water-1' };
  shop.receive(event); shop.receive(event);
  assert.equal(shop.queue.length,2); assert(shop.queue.every(p=>p.order==='water'));
  shop.receive({...event,giftId:8,giftName:'点水礼物',transactionId:'wrong-id'}); assert.equal(shop.queue.length,2);
  const bowl = {id:1,kind:'bowl',x:500,y:480,noodles:1,sauce:1};
  shop.workspace({revision:0,objects:[bowl],selected:1});
  assert.equal(shop.served,0); assert.equal(shop.objects[0].kind,'bowl');
  const water = {id:2,kind:'water',x:700,y:480,noodles:0,sauce:0};
  shop.workspace({revision:1,objects:[bowl,water],selected:2});
  await shop.feed({revision:2,object_id:2,customer_id:shop.queue[0].id});
  assert.equal(shop.served,1); assert.equal(shop.queue.length,1); assert.equal(shop.objects.find(o=>o.id===3).kind,'coin');
  await shop.feed({revision:3,fresh_item:{id:4,kind:'water'},customer_id:shop.queue[0].id});
  assert.equal(shop.objects.at(-1).id,5); assert.equal(shop.objects.at(-1).kind,'coin');
  const {water_gift,...legacy}=DEFAULTS; assert.equal(config(legacy).water_gift,null);
  for(const water_gift of [{gift_id:0,gift_name:'x'},{gift_id:2,gift_name:''},[],false]) assert.throws(()=>config({...DEFAULTS,water_gift}),/圣水/);
});

test('钱匣：付款只生成一次、防伪造、重复入账拒绝、保存失败不吞钱、重启保留', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xiaoluobo-wallet-'));
  try {
    const shop=await new NoodleShop(dir).init(); shop.mode='running'; shop.enqueue('顾客',1);
    const bowl={id:1,kind:'bowl',x:500,y:480,noodles:1,sauce:1};
    shop.workspace({revision:0,objects:[bowl],selected:1});
    const customer=shop.queue[0].id; await shop.feed({revision:1,object_id:1,customer_id:customer});
    await assert.rejects(shop.feed({revision:2,object_id:1,customer_id:customer}),/已离开/);
    const coin=shop.objects[0];
    assert.throws(()=>shop.workspace({revision:2,objects:[{...coin,id:999}],selected:null}),/付款/);
    assert.throws(()=>shop.motion({client:'test',revision:2,pointer:null,drag:{...coin,id:999}}),/已更新/);
    shop.workspace({revision:2,objects:[{...coin,x:700}],selected:null});
    const walletFile=shop.walletFile; shop.walletFile=path.join(dir,'blocked'); await fs.mkdir(shop.walletFile);
    await assert.rejects(shop.deposit({revision:3,object_id:coin.id})); assert.equal(shop.balance,0); assert.equal(shop.objects.length,1);
    shop.walletFile=walletFile; await shop.action({action:'deposit',revision:3,object_id:coin.id});
    assert.equal(shop.balance,100); assert.equal(shop.objects.length,0);
    await assert.rejects(shop.deposit({revision:4,object_id:coin.id}),/已收走/); assert.equal(shop.balance,100);
    assert.equal((await new NoodleShop(dir).init()).balance,100);
    await fs.writeFile(walletFile,'{"balance":1.5}'); await assert.rejects(new NoodleShop(dir).init(),/钱匣记录/);
  } finally {assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});}
});

test('取水和拖钱：点击冰柜放到空位、水不能加进碗、商品碰撞退回、钱不当臊子', () => {
  const {GameState,DragSystem,RecipeSystem}=globalThis.ChefSystems;
  const sources=globalThis.ChefConfig.sources;
  globalThis.ChefConfig.sources=[...sources,{kind:'water',left:290,right:360,top:230,bottom:340,x:325,y:285}];
  try {
    const s=new GameState(),d=new DragSystem(s);
    d.down(1110,460); d.move(500,500); d.up(); const bowl=s.objects[0];
    d.down(325,285); d.up(); const water=s.objects.at(-1); assert.equal(water.kind,'water');assert(RecipeSystem.ready(water));assert(water.y>=394);
    d.down(water.x,water.y);d.move(bowl.x,bowl.y);d.up();assert.equal(bowl.sauce,0);assert.equal(s.objects.length,2);assert.notEqual(water.x,bowl.x);
    const coin=s.create('coin',700,500);d.down(700,500);d.move(bowl.x,bowl.y);d.up();assert.equal(bowl.sauce,0);assert(s.objects.includes(coin));assert.equal(RecipeSystem.ready(coin),false);
    d.down(water.x,water.y);d.up(true);assert(s.objects.includes(water));
  } finally {globalThis.ChefConfig.sources=sources;}
});

test('错餐扣款：缺料、错误商品、裸食材、负数持久保存、重复递餐不扣两次', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'xiaoluobo-penalty-'));
  try {
    const shop=await new NoodleShop(dir).init(); shop.mode='running';
    const cases=[['noodles','bowl',0,0],['noodles','bowl',1,0],['noodles','bowl',0,1],['noodles','water',0,0],['water','bowl',1,1],['water','noodles',0,0],['noodles','sauce',0,0]];
    for(const [order,kind,noodles,sauce] of cases){
      shop.enqueue('顾客',1,0,'',true,order); const id=shop.serial+1,person=shop.queue[0].id;
      shop.workspace({revision:shop.revision,objects:[{id,kind,x:500,y:480,noodles,sauce}],selected:['bowl','water'].includes(kind)?id:null});
      await shop.feed({revision:shop.revision,object_id:id,customer_id:person});
      const balance=shop.balance;
      await assert.rejects(shop.feed({revision:shop.revision,object_id:id,customer_id:person}),/已离开/);assert.equal(shop.balance,balance);
      assert.equal(shop.objects.length,0);assert.equal(shop.queue.length,0);
    }
    assert.equal(shop.balance,-cases.length*100); assert.equal(shop.served,0);assert.equal((await new NoodleShop(dir).init()).balance,-cases.length*100);
    shop.enqueue('顾客',1);const revision=shop.revision;
    await shop.feed({revision,fresh_item:{id:shop.serial+1,kind:'bowl'},customer_id:shop.queue[0].id}); assert.equal(shop.balance,-(cases.length+1)*100);
    shop.enqueue('顾客',1);const person=shop.queue[0].id;
    await assert.rejects(shop.feed({revision:shop.revision,fresh_item:{id:shop.serial+99,kind:'bowl'},customer_id:person}),/不在台面/);
    shop.walletFile=path.join(dir,'blocked');await fs.mkdir(shop.walletFile);
    await assert.rejects(shop.feed({revision:shop.revision,fresh_item:{id:shop.serial+1,kind:'water'},customer_id:person}));assert.equal(shop.queue.length,1);assert.equal(shop.balance,-(cases.length+1)*100);
  } finally {assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true,force:true});}
});

test('一键复原：清空本局、垃圾与余额，保留配置与营业状态，旧操作不可恢复物品', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-restore-'));
  try {
    const shop = await new NoodleShop(dir).init(); shop.mode = 'running';
    await shop.save({ ...shop.config, sign: { top: '', title: '我的面馆', bottom: '' }, layout: { ...shop.config.layout, trash: { side: 'left' } } });
    shop.balance = -3; await fs.writeFile(shop.walletFile, JSON.stringify({ balance: -3 }));
    shop.enqueue('顾客', 1); shop.served = 5;
    const bowl = { id: 1, kind: 'bowl', x: 500, y: 480, noodles: 1, sauce: 1 };
    shop.workspace({ revision: shop.revision, objects: [bowl], selected: 1 });
    const before = shop.snapshot(), savedConfig = structuredClone(shop.config); shop.mode = 'paused';
    shop.departures = [{ ...shop.queue[0], at: Date.now() }]; shop.lastServed = shop.queue[0];
    const throwPending = shop.throwFood('egg', 3);
    const restored = await shop.action({ action: 'restore' }); await throwPending;
    assert.deepEqual(restored.objects, []); assert.deepEqual(restored.throws, []); assert.deepEqual(restored.departures, []);
    assert.equal(restored.queue_count, 0); assert.equal(restored.served, 0); assert.equal(restored.joined, 0);
    assert.equal(restored.selected, null); assert.equal(restored.last_served, null);
    assert.equal(restored.balance, 0); assert.equal(restored.mode, 'paused'); assert.deepEqual(restored.config, savedConfig);
    shop.mode = 'running';
    assert.throws(() => shop.workspace({ revision: before.workspace_revision, objects: [bowl], selected: 1 }), /已更新/);
    const reloaded = await new NoodleShop(dir).init();
    assert.deepEqual(reloaded.throws, []); assert.deepEqual(reloaded.config, savedConfig); assert.equal(reloaded.balance, 0);
    shop.enqueue('不能丢失的顾客', 1); await shop.throwFood('egg'); shop.throwsFile = path.join(dir, 'blocked'); await fs.mkdir(shop.throwsFile);
    await assert.rejects(shop.action({ action: 'restore' })); assert.equal(shop.queue.length, 1);
  } finally { assert.equal(path.dirname(dir), os.tmpdir()); await fs.rm(dir, { recursive: true, force: true }); }
});

test('独立物品：旧配置兼容、位置缩放独立、托盘物品坐标往返、垃圾命中跟随', () => {
  const layout = structuredClone(Layout.defaults), legacy = structuredClone(layout); delete legacy.props;
  assert.deepEqual(Layout.validate(legacy).props, Layout.defaults.props);
  layout.stations.noodles = { ...layout.stations.noodles, x: 700, y: -180, scale: 1.8 };
  layout.props.trash = { x: -700, y: 130, scale: 1.7 };
  layout.props.fridge = { x: 430, y: 160, scale: .6 };
  layout.props.cash = { x: -600, y: -200, scale: .5 };
  layout.props.tray = { x: -120, y: 75, scale: .65 };
  layout.modules.counter = { x: 60, y: -30, scale: 1.2, visible: true };
  layout.modules.background = { x: -20, y: 15, scale: .8, visible: true };
  assert.deepEqual(Layout.validate(layout), layout);
  const normal = Layout.stations(Layout.defaults), changed = Layout.stations(layout);
  assert.deepEqual(changed.find(s=>s.kind==='bowl'), normal.find(s=>s.kind==='bowl'));
  assert.equal(changed.find(s=>s.kind==='noodles').width, normal.find(s=>s.kind==='noodles').width*1.8);
  const point = { x: 640, y: 490 }, back = Layout.stageToWorkspace(Layout.workspaceToStage(point, layout), layout);
  assert(Math.abs(back.x-point.x)<1e-9 && Math.abs(back.y-point.y)<1e-9);
  const trash = Layout.trashRect(layout), target = Layout.toStage({ x: trash.x+trash.width/2, y: trash.y+30*trash.scale }, layout.modules.background);
  assert(Layout.trashContains(target, layout)); assert(!Layout.trashContains({ x: 1200, y: 700 }, layout));
  for (const key of Object.keys(layout.props)) assert.throws(()=>Layout.validate({ ...layout, props: { ...layout.props, [key]: { x: NaN, y: 0, scale: 1 } } }), /物品/);
});

test('打赏：默认送花花，每份生成金币，重复消息不重复，收进钱匣才入账', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-tip-'));
  try {
    const shop = await new NoodleShop(dir).init(); shop.mode = 'running';
    assert.equal(shop.config.tip_gift.gift_id, 35638);
    const event = { type: 'gift', uid: 88, user: '打赏顾客', giftId: 35638, giftName: '送花花', count: 3, transactionId: 'tip-1' };
    await shop.receive(event); await shop.receive(event);
    assert.equal(shop.objects.length, 3); assert.equal(shop.balance, 0); assert.equal(shop.queue.length, 0);
    assert(shop.objects.every(o=>o.kind==='coin' && o.tip_at && o.id>0));
    const coin = shop.objects[0]; await shop.action({ action: 'deposit', revision: shop.revision, object_id: coin.id });
    assert.equal(shop.balance, 100); assert.equal(shop.objects.length, 2);
    await shop.action({ action: 'restore' }); assert.equal(shop.balance, 0); assert.equal(shop.objects.length, 0);
    const legacy = { ...DEFAULTS }; delete legacy.tip_gift;
    assert.deepEqual(config(legacy).tip_gift, DEFAULTS.tip_gift);
    assert.equal(config({ ...DEFAULTS, tip_gift: null }).tip_gift, null);
    assert.throws(()=>config({ ...DEFAULTS, tip_gift: { gift_id: 0, gift_name: '送花花' } }), /打赏/);
  } finally { assert.equal(path.dirname(dir), os.tmpdir()); await fs.rm(dir, { recursive: true, force: true }); }
});

test('面馆预设：升级保留原配置、创建切换、各自保存、重命名持久化、失败不覆盖', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-presets-'));
  try {
    const oldConfig = config({ ...DEFAULTS, gift_defaults_version: 1, gift_id: 34001, gift_name: '粉丝团灯牌', sign: { top: '原招牌', title: '我的臊子面馆', bottom: '' } });
    await fs.writeFile(path.join(dir, 'noodle.json'), JSON.stringify(oldConfig));
    const shop = await new NoodleShop(dir).init();
    assert.equal(shop.snapshot().presets[0].name, '臊子面馆'); assert.deepEqual(shop.config, oldConfig);
    shop.mode = 'running'; shop.enqueue('仍在排队的顾客', 1); shop.balance = 8;
    await shop.action({ action: 'preset_create', name: '  萝卜面馆  ' });
    const created = shop.activePreset; assert.notEqual(created, 'saozi'); assert.equal(shop.config.sign.title, '萝卜面馆');
    assert.equal(shop.queue.length, 1); assert.equal(shop.balance, 8);
    const secondConfig = config({ ...shop.config, water_gift: null, layout: { ...shop.config.layout, props: { ...shop.config.layout.props, fridge: { x: 300, y: 20, scale: .8 } } } });
    await shop.action({ action: 'save', preset_id: created, config: secondConfig });
    await shop.action({ action: 'preset_use', id: 'saozi' }); assert.deepEqual(shop.config, oldConfig);
    await assert.rejects(shop.action({ action: 'save', preset_id: created, config: secondConfig }), /已切换/);
    await shop.action({ action: 'preset_use', id: created }); assert.deepEqual(shop.config, secondConfig);
    await shop.action({ action: 'preset_rename', id: created, name: '小萝卜面馆' });
    assert.equal(shop.config.sign.title, '小萝卜面馆');
    const reloaded = await new NoodleShop(dir).init();
    assert.equal(reloaded.activePreset, created); assert.equal(reloaded.presets.length, 2);
    assert.equal(reloaded.config.water_gift, null); assert.deepEqual(reloaded.config.layout, secondConfig.layout);
    await assert.rejects(shop.action({ action: 'preset_create', name: '臊子面馆' }), /同名/);
    await assert.rejects(shop.action({ action: 'preset_create', name: ' ' }), /名称/);
    await assert.rejects(shop.action({ action: 'preset_use', id: 'missing' }), /不存在/);
    const before = shop.snapshot(); shop.file = path.join(dir, 'blocked'); await fs.mkdir(shop.file);
    await assert.rejects(shop.action({ action: 'preset_create', name: '不能写入的面馆' }));
    assert.deepEqual(shop.snapshot().presets, before.presets); assert.equal(shop.activePreset, before.active_preset); assert.deepEqual(shop.config, before.config);
  } finally { assert.equal(path.dirname(dir), os.tmpdir()); await fs.rm(dir, { recursive: true, force: true }); }
});

test('厨师右臂：远近伸缩、身体轻微跟随、拿东西的手偏移、屏幕边界', () => {
 const {pose}=require('../public/noodle/chef.js');
 const near=pose({x:750,y:400}),far=pose({x:100,y:650}),idle=pose(null);
 assert(far.upper.length+far.lower.length>near.upper.length+near.lower.length);
 assert(far.lean<near.lean);assert(Math.abs(far.lean)<=12);
 const held=pose({x:750,y:400},true);assert.equal(held.hand.x-near.hand.x,12);assert.equal(held.hand.y-near.hand.y,18);
 for(const p of [idle,near,far,pose({x:-100,y:900})]) for(const s of [p.upper,p.lower])assert([s.x,s.y,s.length,s.angle].every(Number.isFinite));
 assert.equal(pose({x:-100,y:900}).hand.x,0);assert.equal(pose({x:-100,y:900}).hand.y,720);
});
