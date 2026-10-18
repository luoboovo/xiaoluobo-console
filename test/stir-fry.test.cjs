const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {TemplateLibrary}=require('../lib/templates.cjs'),{NoodleShop}=require('../lib/noodle.cjs'),{startServer}=require('../server.cjs');
const Food=require('../public/noodle/stir-fry-food.js'),Layout=require('../public/noodle/layout.js');
const source=require('node:fs').readFileSync(path.join(__dirname,'../artifacts/麻辣香锅-v1.0.4.luobo'),'utf8'),data=JSON.parse(source);
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-stir-'));
  t.after(async()=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-stir-'))throw new Error('清理路径无效');await fs.rm(dir,{recursive:true,force:true});});
  const library=await new TemplateLibrary(dir).init(),template=await library.install(data),shop=await new NoodleShop(dir,library).init();
  await shop.action({action:'preset_create',name:'麻辣香锅',template_id:template.id});await shop.action({action:'start'});
  const act=(action,args={})=>shop.action({action,revision:shop.revision,...args});
  const plate=id=>act('stir_plate',{wok_id:shop.stirfry.wok.id,bowl_id:id??shop.selected});
  return {dir,shop,act,plate,library,template};
}
async function cook(f,id){
  if(!id){await f.act('stir_bowl',{x:400,y:475});id=f.shop.selected;}
  await f.act('stir_add',{ingredient:'beef'});await f.act('stir_add',{ingredient:'broccoli'});
  f.shop.stirfry.wok.ready_at=Date.now()-1;await f.plate(id);return f.shop.objects.find(o=>o.id===id);
}

test('香锅共用多碗台面：分别装碗和撒料，原版出餐与收钱',async t=>{
  const f=await fixture(t),{shop,act,plate}=f;
  for(const x of [390,510,630,750])await act('stir_bowl',{x,y:475});
  const bowls=shop.objects.filter(o=>o.kind==='bowl');assert.equal(bowls.length,4);
  for(const item of Food.ingredients)await act('stir_pick',{ingredient:item.id});await act('stir_add');
  assert.equal(shop.stirfry.basket.length,0);assert.equal(shop.stirfry.wok.ingredients.length,12);assert.equal(Food.ready(shop.stirfry.wok),false);
  await assert.rejects(plate(bowls[0].id),/没炒熟/);shop.stirfry.wok.ready_at=Date.now()-1;await plate(bowls[0].id);
  for(const garnish of Object.keys(Food.garnishes))await act('stir_garnish',{bowl_id:bowls[0].id,garnish});
  assert.equal(bowls[0].ingredients.length,12);assert.equal(bowls[0].garnishes.length,3);assert.deepEqual(bowls[1].ingredients,[]);
  await cook(f,bowls[1].id);assert.deepEqual(bowls[1].garnishes,[]);
  shop.enqueue('香锅朋友',1);await act('feed',{object_id:bowls[0].id,customer_id:shop.queue[0].id});
  assert.equal(shop.served,1);assert.equal(shop.objects.filter(o=>o.kind==='bowl').length,3);assert.equal(shop.departures[0].correct,true);
  await act('deposit',{object_id:shop.objects.find(o=>o.kind==='coin').id});assert.equal(shop.balance,100);
});

test('台面沿用原版碰撞、移动和版本校验，不能伪造香锅和配料',async t=>{
  const f=await fixture(t),{shop,act}=f;const bowl=await cook(f);
  const move=()=>act('workspace',{objects:structuredClone(shop.objects),selected:bowl.id});await move();
  let objects=structuredClone(shop.objects);objects[0].x=530;await act('workspace',{objects,selected:bowl.id});assert.equal(shop.objects[0].x,530);
  objects=structuredClone(shop.objects);objects[0].garnishes=['sesame'];await assert.rejects(act('workspace',{objects,selected:bowl.id}),/铁锅/);
  objects=structuredClone(shop.objects);objects[0].ingredients=['chicken'];await assert.rejects(act('workspace',{objects,selected:bowl.id}),/铁锅/);
  await assert.rejects(act('stir_bowl',{x:530,y:475}),/重叠/);await assert.rejects(act('stir_bowl',{x:0,y:0}),/托盘/);
  await assert.rejects(shop.action({action:'stir_pick',revision:shop.revision-1,ingredient:'beef'}),/台面已更新/);
  await act('stir_add',{ingredient:'chicken'});shop.stirfry.wok.ready_at=Date.now()-1;await assert.rejects(f.plate(bowl.id),/已经装了/);
});

test('八种独立成品素材仍可按每个碗的配料切换',async t=>{
  const f=await fixture(t),hashes=new Set();
  for(let mask=0;mask<8;mask++){
    const bowl=await cook(f);for(const [key,bit]of [['cilantro',4],['scallions',2],['sesame',1]])if(mask&bit)await f.act('stir_garnish',{bowl_id:bowl.id,garnish:key});
    assert.equal(Food.garnishMask(bowl.garnishes),mask);hashes.add(crypto.createHash('sha256').update(data.assets[Food.bowlAssets[mask]]).digest('hex'));
    await f.act('discard',{object_id:bowl.id});
  }
  assert.equal(hashes.size,8);
});

test('旧模板互动全部复用：错单、饮料、打赏、小偷、臭料、帮忙、评分与查封',async t=>{
  const f=await fixture(t),{shop,act}=f;
  await act('save',{config:{...shop.config,water_gift:null,throw_gifts:{leaf:null,egg:null}}});await act('preset_create',{name:'完整玩法香锅',template_id:f.template.id});await act('start');
  assert.ok(shop.config.throw_gifts.leaf);assert.ok(shop.config.throw_gifts.egg);assert.ok(shop.config.water_gift);
  await act('stir_bowl',{x:400,y:475});shop.enqueue('空碗错单',1);await act('feed',{object_id:shop.selected,customer_id:shop.queue[0].id});assert.equal(shop.balance,-100);assert.equal(shop.departures.at(-1).correct,false);
  for(const drink of ['cola','iced_tea']){await act('stir_drink',{drink});const item=shop.objects.find(o=>o.id===shop.selected);assert.equal(item.drink,drink);await act('demo_water');await act('feed',{object_id:item.id,customer_id:shop.queue[0].id});}
  assert.equal(shop.served,2);await act('demo_tip');const before=shop.objects.filter(o=>o.kind==='coin').length;await act('demo_thief');assert.equal(shop.objects.filter(o=>o.kind==='coin').length,before);assert.equal(shop.theft.amount,0);assert.ok(shop.theft);
  const bowl=await cook(f);await act('test_throw',{kind:'egg'});const egg=shop.throws[0];await act('spoil',{bowl_id:bowl.id,throw_id:egg.id,throw_revision:egg.revision});assert.equal(bowl.spoiled,true);assert.equal(shop.throws.length,0);
  shop.enqueue('帮忙顾客',1);await act('demo_help');assert.equal(shop.departures.at(-1).helped,true);
  await act('demo_review');assert.equal(shop.status.points,499);await act('demo_praise');assert.equal(shop.status.points,500);
  await act('demo_raid');assert.equal(shop.status.sealed,true);assert.deepEqual(shop.stirfry,Food.empty());await assert.rejects(act('stir_pick',{ingredient:'beef'}),/查封/);await act('demo_restock');assert.equal(shop.status.sealed,false);
  shop.enqueue('清队顾客',2);await act('demo_clearqueue');assert.equal(shop.queue.length,0);
});

test('锅、托盘与模块移动缩放使用同一布局，坐标往返和投掷清理一致',async t=>{
  const {shop,act}=await fixture(t),layout=structuredClone(shop.config.layout);
  layout.stations.noodles={...layout.stations.noodles,x:80,y:-25,scale:.7};layout.props.tray={x:25,y:-10,scale:1.2};layout.modules.counter={x:20,y:-5,scale:.9,visible:true};
  await act('save',{config:{...shop.config,layout}});const pot=Layout.stations(layout,'stir-fry').find(s=>s.kind==='noodles');assert.equal(pot.width,347*.7);assert.equal(pot.x,441+347/2+80);
  const p={x:540,y:475},actual=Layout.stageToWorkspace(Layout.workspaceToStage(p,layout,'stir-fry'),layout,'stir-fry');assert.ok(Math.abs(actual.x-p.x)<1e-8&&Math.abs(actual.y-p.y)<1e-8);
  await act('test_throw',{kind:'leaf'});const leaf=shop.throws[0],r=Layout.trashRect(layout,'stir-fry');await act('move_throw',{throw_id:leaf.id,throw_revision:leaf.revision,x:r.x+r.width/2,y:r.y+35,discard:true});assert.equal(shop.throws.length,0);
});

test('生食添加重新计时，暂停、清理和店铺切换均保留原规则',async t=>{
  const {shop,act}=await fixture(t);await act('stir_add',{ingredient:'beef'});shop.stirfry.wok.ready_at=Date.now()-1;await act('stir_add',{ingredient:'chicken'});assert.equal(Food.ready(shop.stirfry.wok),false);
  const readyAt=shop.stirfry.wok.ready_at;await act('save',{config:{...shop.config,cook_seconds:1}});assert.equal(shop.stirfry.wok.ready_at,readyAt);
  await act('pause');await assert.rejects(act('stir_pick',{ingredient:'beef'}),/开始游戏/);await act('start');await act('clear_table');assert.deepEqual(shop.stirfry,Food.empty());
  for(let i=0;i<24;i++)await act('stir_pick',{ingredient:'beef'});await assert.rejects(act('stir_pick',{ingredient:'lamb'}),/已满/);await act('stir_add');await assert.rejects(act('stir_add',{ingredient:'lamb'}),/24/);
  await act('preset_use',{id:'saozi'});await assert.rejects(act('stir_pick',{ingredient:'beef'}),/没有麻辣香锅/);
});

test('独立模板导入导出完整，香锅直接加载原版场景',async t=>{
  const {dir,library,template}=await fixture(t);assert.deepEqual((await library.export(template.id)).assets,data.assets);
  const app=await startServer({dataDir:path.join(dir,'server')});t.after(()=>app.close());
  const res=await fetch(app.url+'/api/templates/import',{method:'POST',headers:{'Content-Type':'application/json'},body:source});assert.equal(res.status,200);await res.json();
  const html=await(await fetch(app.url+'/noodle/')).text();assert.match(html,/game\.js/);assert.match(html,/game-customers/);assert.match(html,/stir-fry-food/);
});
