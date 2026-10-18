const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { TemplateLibrary } = require('../lib/templates.cjs');
const { NoodleShop } = require('../lib/noodle.cjs');
const Rules = require('../public/noodle/rules.js');
const Layout = require('../public/noodle/layout.js');
const source = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'../artifacts/美式汉堡店-v1.0.1.luobo'),'utf8'));

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-burger-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const templates = await new TemplateLibrary(dir).init(), template = await templates.install(source);
  const shop = await new NoodleShop(dir, templates).init();
  await shop.action({ action:'preset_create', name:'汉堡测试', template_id:template.id });
  await shop.action({ action:'start' });
  const act = (action, args={}) => shop.action({ action, revision:shop.revision, ...args });
  const bake = async () => {
    await act('burger_bake'); const batch = shop.cooking.at(-1); batch.ready_at = Date.now()-1;
    await act('burger_take_bun', { batch_id:batch.id }); return shop.objects.at(-1);
  };
  const patty = async item => {
    await act('burger_grill'); const batch = shop.cooking.at(-1); batch.ready_at = Date.now()-1;
    await act('burger_patty', { batch_id:batch.id, bowl_id:item.id });
  };
  return { dir, templates, template, shop, act, bake, patty };
}

test('三种新酱料可先后加入，移动和出餐保留制作状态，旧模板也能加载素材', async t => {
  const { shop, act, bake, patty, template } = await fixture(t);
  const item = await bake();
  for (const topping of ['ketchup','salad','mayo']) {
    await act('burger_topping', { bowl_id:item.id, topping });
    await assert.rejects(act('burger_topping', { bowl_id:item.id, topping }), /已经放过/);
    assert.match(template.assets[topping], new RegExp('/'+topping+'\\.png$'));
    assert.notEqual(template.assets[topping], template.assets.mustard);
    assert.match(template.assets[topping+'_layer'], /\.svg$/);
  }
  await patty(item); await act('burger_close', { bowl_id:item.id });
  assert.deepEqual(item.toppings, ['ketchup','salad','mayo']);
  await act('demo_noodles'); await act('feed', { bowl_id:item.id, customer_id:shop.queue[0].id });
  await act('deposit', {object_id:shop.objects[0].id}); assert.equal(shop.balance, 100); assert.equal(shop.served, 1);
});

test('汉堡模板：完整素材安装、重启与导出，缺少设备时拒绝导入', async t => {
  const { dir, templates, template } = await fixture(t);
  const exported = await templates.export(template.id); assert.deepEqual(exported.assets, source.assets);
  assert.equal((await new TemplateLibrary(dir).init()).get(template.id).workflow, 'burger');
  const { oven, ...assets } = source.assets;
  await assert.rejects(templates.install({ ...source, assets }), /汉堡制作素材/);
});

test('面包和肉饼分别计时，不能取未熟食材、重复取用或绕过烤箱', async t => {
  const { shop, act, bake } = await fixture(t);
  await act('burger_bake'); const bun = shop.cooking[0];
  await assert.rejects(act('burger_take_bun', { batch_id:bun.id }), /还在烤/);
  await assert.rejects(act('place_bowl'), /烤箱/);
  const item = await bake(); await act('burger_grill'); const patty = shop.cooking.at(-1);
  await assert.rejects(act('burger_patty', { batch_id:patty.id, bowl_id:item.id }), /没煎熟/);
  patty.ready_at = Date.now()-1;
  await act('burger_patty', { batch_id:patty.id, bowl_id:item.id });
  await assert.rejects(act('burger_patty', { batch_id:patty.id, bowl_id:item.id }), /已被取走/);
  assert.equal(shop.cooking.length, 1);
});

test('烤箱和煎台独立容量、满托盘取面包失败不消耗食材', async t => {
  const { shop, act, bake } = await fixture(t);
  for (let i=0;i<4;i++) await bake();
  await act('burger_bake'); const batch = shop.cooking.at(-1); batch.ready_at = Date.now()-1;
  await assert.rejects(act('burger_take_bun', { batch_id:batch.id }), /托盘已满/);
  assert.ok(shop.cooking.includes(batch));
  for(let i=0;i<3;i++)await act('burger_bake');
  await assert.rejects(act('burger_bake'), /最多烤/);
  for(let i=0;i<4;i++)await act('burger_grill');
  await assert.rejects(act('burger_grill'), /最多煎/);
});

test('组装与出餐：配料先放、熟肉饼最后放，盖好后交付并收钱', async t => {
  const { shop, act, bake, patty } = await fixture(t);
  const item = await bake();
  for(const topping of ['tomato','lettuce','cheese','mustard'])await act('burger_topping', { topping, bowl_id:item.id });
  await patty(item); assert.equal(Rules.ready(item,'burger'), false);
  await assert.rejects(act('burger_topping', { topping:'mustard', bowl_id:item.id }), /已经放过/);
  await act('burger_close', { bowl_id:item.id }); assert.ok(Rules.ready(item,'burger'));
  await assert.rejects(act('burger_topping', { topping:'tomato', bowl_id:item.id }), /已经盖好/);
  shop.enqueue('汉堡顾客',1,123); await act('feed', { object_id:item.id, customer_id:shop.queue[0].id });
  assert.equal(shop.served,1); const coin=shop.objects[0]; assert.equal(coin.kind,'coin');
  await act('deposit', { object_id:coin.id }); assert.equal(shop.balance,100); assert.equal(shop.objects.length,0);
  assert.ok(Rules.ready({kind:'bowl',bun:true,patty:true,closed:true,toppings:[]},'burger'));
});

test('台面同步不能伪造熟肉饼和配料；位置变动、变质、查封与清空沿用规则', async t => {
  const { shop, act, bake, patty } = await fixture(t);
  const item = await bake();
  await assert.rejects(act('workspace', { objects:[{...item,patty:true}], selected:item.id }), /制作汉堡/);
  await assert.rejects(act('workspace', { objects:[{...item,toppings:['cheese']}], selected:item.id }), /制作汉堡/);
  const objects = structuredClone(shop.objects); objects[0].x+=10;
  await act('workspace', {objects,selected:item.id}); assert.equal(shop.objects[0].x,item.x+10);
  await patty(shop.objects[0]); shop.objects[0].spoiled=true;
  await act('burger_topping',{bowl_id:item.id,topping:'cheese'});
  await act('burger_close',{bowl_id:item.id});assert.equal(Rules.ready(shop.objects[0],'burger'),false);
  await act('demo_raid'); assert.equal(shop.objects.length,0); assert.equal(shop.cooking.length,0);
  await assert.rejects(act('burger_bake'), /查封/);
  await act('demo_restock'); await act('burger_grill'); await act('clear_table'); assert.equal(shop.cooking.length,0);
});

test('汉堡场景转换支持制作台及托盘移动缩放，旧模板可继续使用', async t => {
  const { shop, act, bake } = await fixture(t);
  const layout=structuredClone(shop.config.layout); layout.modules.counter={x:90,y:25,scale:.8,visible:true}; layout.props.tray={x:30,y:-20,scale:.75};
  const point={x:530,y:475}; const restored=Layout.stageToWorkspace(Layout.workspaceToStage(point,layout,'burger'),layout,'burger');
  assert.ok(Math.abs(point.x-restored.x)<1e-8 && Math.abs(point.y-restored.y)<1e-8);
  await bake(); await act('burger_grill'); await act('preset_use',{id:'saozi'});
  assert.equal(shop.template().workflow,'mix'); assert.equal(shop.objects.length,0); assert.equal(shop.cooking.length,0);
  await act('place_bowl'); assert.equal(shop.objects[0].kind,'bowl');
});

test('原有矿泉水、错餐和拖动同步继续可用，不能伪造新汉堡', async t => {
  const {shop,act,bake,patty}=await fixture(t);
  const water={id:shop.serial+1,kind:'water',x:410,y:475,noodles:0,sauce:0};
  await act('workspace',{objects:[water],selected:water.id});
  await act('demo_water');await act('feed',{object_id:water.id,customer_id:shop.queue[0].id});assert.equal(shop.served,1);
  await act('clear_table');const item=await bake();await patty(item);await act('burger_close',{bowl_id:item.id});
  shop.motion({client:'burger-test',revision:shop.revision,pointer:{x:500,y:500,pressed:true},drag:{...item}});
  assert.equal(shop.pointerState.drag.patty,true);assert.equal(shop.pointerState.drag.closed,true);
  const fake={...item,id:shop.serial+1};await assert.rejects(act('workspace',{objects:[...shop.objects,fake],selected:fake.id}),/制作汉堡/);
  await act('demo_water');await act('feed',{object_id:item.id,customer_id:shop.queue[0].id});assert.equal(shop.balance,-100);assert.equal(shop.served,1);
});

test('鸡蛋或菜叶先放进面包也能继续加料，盖好后仍按脏餐拒收', async t => {
  const {shop,act,bake,patty}=await fixture(t);
  for(const kind of ['egg','leaf']){
    await act('clear_table');const item=await bake();
    await act('test_throw',{kind});const litter=shop.throws.at(-1);
    await act('spoil',{bowl_id:item.id,throw_id:litter.id,throw_revision:litter.revision});
    assert.ok(item.spoiled);assert.deepEqual(item.contaminants,[kind]);assert.equal(item.closed,false);
    await act('burger_topping',{bowl_id:item.id,topping:'lettuce'});await patty(item);
    const objects=structuredClone(shop.objects);objects[0].x+=8;await act('workspace',{objects,selected:item.id});
    assert.deepEqual(shop.objects[0].contaminants,[kind]);
    await act('burger_close',{bowl_id:item.id});assert.equal(Rules.ready(shop.objects[0],'burger'),false);
    shop.enqueue('脏餐测试',1,123);await act('feed',{object_id:item.id,customer_id:shop.queue[0].id});
  }
  assert.equal(shop.balance,-200);assert.equal(shop.served,0);
});

test('蟑螂投掷礼物可保存重启，污染分类不能伪造或洗掉，已盖面包不消耗投掷物',async t=>{
  const {dir,templates,shop,act,bake}=await fixture(t);
  const binding={gift_id:98765,gift_name:'蟑螂测试礼物'};
  await act('save',{config:{...shop.config,throw_gifts:{...shop.config.throw_gifts,cockroach:binding}}});
  const reload=await new NoodleShop(dir,templates).init();assert.deepEqual(reload.config.throw_gifts.cockroach,binding);
  await shop.receive({type:'gift',giftId:98765,giftName:binding.gift_name,count:2,uid:9,transactionId:'roach-test'});
  assert.equal(shop.throws.filter(o=>o.kind==='cockroach').length,2);
  const item=await bake(),litter=shop.throws[0];
  await act('spoil',{bowl_id:item.id,throw_id:litter.id,throw_revision:litter.revision});
  assert.deepEqual(item.contaminants,['cockroach']);
  await assert.rejects(act('workspace',{objects:[{...item,contaminants:['egg']}],selected:item.id}),/制作汉堡/);
  await assert.rejects(act('workspace',{objects:[{...item,spoiled:false}],selected:item.id}),/制作汉堡/);
  await act('burger_close',{bowl_id:item.id});assert.equal(item.closed,true);
  const other=shop.throws[0];await assert.rejects(act('spoil',{bowl_id:item.id,throw_id:other.id,throw_revision:other.revision}),/盖上面包前/);
  assert.equal(shop.throws.length,1);
  const persisted=await new NoodleShop(dir,templates).init();assert.equal(persisted.throws[0].kind,'cockroach');
});

test('蟑螂爬行在各画面采用相同坐标，移动后重置起点且垃圾桶可以清除',async t=>{
  const {shop,act}=await fixture(t);await act('test_throw',{kind:'cockroach'});const litter=shop.throws[0];
  const first=Rules.throwPosition(litter,litter.at+1000),later=Rules.throwPosition(litter,litter.at+3000);
  assert.deepEqual(first,Rules.throwPosition(litter,litter.at+1000));assert.ok(Math.hypot(first.x-later.x,first.y-later.y)>1);
  for(let ms=0;ms<20000;ms+=100){const p=Rules.throwPosition(litter,litter.at+ms);assert.ok(p.x>=32&&p.x<=1248&&p.y>=32&&p.y<=688);}
  await act('move_throw',{throw_id:litter.id,throw_revision:litter.revision,x:500,y:400,discard:false});
  const moved=shop.throws[0],point=Rules.throwPosition(moved,moved.at+1000);assert.equal(point.x,500);assert.equal(point.y,400);
  const r=Layout.trashRect(shop.config.layout,'burger'),target=Layout.toStage({x:r.x+r.width/2,y:r.y+35},shop.config.layout.modules.background);
  await act('move_throw',{throw_id:moved.id,throw_revision:moved.revision,...target,discard:true});assert.equal(shop.throws.length,0);
});

test('旧汉堡模板自动获得新增图片，平台迁移保留蟑螂礼物且旧配置不强加绑定',async t=>{
  const {templates}=await fixture(t);
  const old=JSON.parse(await fs.readFile(path.join(__dirname,'../artifacts/美式汉堡店-v1.0.0.luobo'),'utf8'));
  const template=await templates.install(old);
  assert.equal(template.assets.dirty_burger,'/noodle/assets/dirty-burger.png');
  assert.equal(template.assets.cockroach_walk,'/noodle/assets/cockroach-walk.png');
  const {config,DEFAULTS}=require('../lib/noodle/config.cjs'),{fillConfig}=require('../lib/platform-games.cjs');
  assert.deepEqual(config(DEFAULTS).throw_gifts,DEFAULTS.throw_gifts);
  const rule={gift_id:98765,gift_name:'蟑螂礼物'},input={...DEFAULTS,throw_gifts:{...DEFAULTS.throw_gifts,cockroach:rule}};
  const migrated=fillConfig(input,DEFAULTS,[{id:98766,alias_ids:[98765],name:'蟑螂礼物',price:1}]);
  assert.equal(migrated.throw_gifts.cockroach.gift_id,98766);
});
