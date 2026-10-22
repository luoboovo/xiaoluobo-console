const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {TemplateLibrary}=require('../lib/templates.cjs');
const {NoodleShop}=require('../lib/noodle.cjs');
const {startServer}=require('../server.cjs');
const Layout=require('../public/noodle/layout.js');
const {templatePackage,templateSource}=require('./fixtures/templates.cjs');
const source=templateSource('茉莉咖啡厅-v1.0.1.luobo');
const data=JSON.parse(source);

async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-cafe-'));
  t.after(()=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-cafe-'))throw new Error('清理路径无效');return fs.rm(dir,{recursive:true,force:true});});
  const library=await new TemplateLibrary(dir).init(),template=await library.install(data);
  const shop=await new NoodleShop(dir,library).init();
  await shop.action({action:'preset_create',name:'茉莉咖啡厅',template_id:template.id});
  shop.mode='running';
  const act=(action,args={})=>shop.action({action,revision:shop.revision,...args});
  const ingredient=(kind,cup)=>act(kind==='jasmine'?'add_jasmine':'pour_milk',{bowl_id:cup.id,fresh_item:{id:shop.serial+1,kind}});
  return {dir,library,template,shop,act,ingredient};
}
async function coffee(f){
  await f.act('brew_coffee',{fresh_item:{id:f.shop.serial+1,kind:'bowl'}});
  f.shop.cooking[0].ready_at=Date.now()-1;await f.act('take_coffee');
  const cup=f.shop.objects.find(o=>o.kind==='bowl');
  f.shop.workspace({revision:f.shop.revision,objects:[{...cup,x:550,y:475}],selected:cup.id});
  return f.shop.objects.find(o=>o.id===cup.id);
}

test('茉莉拿铁三步制作：萃取计时、加花、倒奶、交付并收钱',async t=>{
  const f=await fixture(t),{shop,act,ingredient}=f;
  assert.equal(shop.config.cook_seconds,2);
  await act('brew_coffee',{fresh_item:{id:shop.serial+1,kind:'bowl'}});
  assert.ok(Math.abs(shop.cooking[0].ready_at-Date.now()-2000)<200);
  await assert.rejects(act('take_coffee'),/萃取/);
  await assert.rejects(act('brew_coffee',{fresh_item:{id:shop.serial+1,kind:'bowl'}}),/正在萃取/);
  shop.cooking[0].ready_at=Date.now()-1;await act('take_coffee');
  const original=shop.objects[0];assert.ok(original.coffee);assert.equal(original.jasmine,false);assert.equal(original.milk,false);
  shop.workspace({revision:shop.revision,objects:[{...original,x:550,y:475}],selected:original.id});
  const cup=shop.objects[0];await ingredient('jasmine',cup);assert.ok(cup.jasmine);assert.equal(cup.milk,false);
  await ingredient('milk',cup);assert.ok(cup.milk);assert.equal(shop.snapshot().cafe_effect.kind,'milk');
  shop.enqueue('喝拿铁的顾客',1);assert.equal(shop.queue[0].recipe,'jasmine-latte');
  await act('feed',{bowl_id:cup.id,customer_id:shop.queue[0].id});assert.equal(shop.served,1);assert.equal(shop.objects[0].kind,'coin');
  await act('deposit',{object_id:shop.objects[0].id});assert.equal(shop.balance,100);
});

test('咖啡厅拒绝省略步骤、重复加料和伪造材料，失败保留原杯',async t=>{
  const f=await fixture(t),cup=await coffee(f),{shop,ingredient,act}=f;
  await assert.rejects(act('add_jasmine',{bowl_id:cup.id,ingredient_id:999}),/先拿起/);
  assert.equal(cup.milk,false);assert.equal(cup.jasmine,false);
  await ingredient('jasmine',cup);await assert.rejects(ingredient('jasmine',cup),/已经放了/);
  await ingredient('milk',cup);await assert.rejects(ingredient('milk',cup),/已经倒了/);
  assert.equal(shop.objects.length,1);
});

test('移动杯子保留制作状态，台面与拖拽同步无法伪造成品',async t=>{
  const f=await fixture(t),cup=await coffee(f),{shop}=f;
  assert.throws(()=>shop.workspace({revision:shop.revision,objects:[{...cup,jasmine:true,milk:true}],selected:cup.id}),/制作拿铁/);
  assert.throws(()=>shop.workspace({revision:shop.revision,objects:[{...cup,coffee:false}],selected:cup.id}),/制作拿铁/);
  assert.throws(()=>shop.workspace({revision:shop.revision,objects:[{...cup,id:shop.serial+1,jasmine:true,milk:true}],selected:shop.serial+1}),/制作拿铁/);
  assert.throws(()=>shop.workspace({revision:shop.revision,objects:[{...cup,kind:'milk'}],selected:null}),/物品/);
  await f.ingredient('jasmine',cup);
  shop.motion({client:'test-cafe',revision:shop.revision,pointer:null,drag:{...cup,milk:true}});
  assert.equal(shop.motionSnapshot().drag.milk,false);assert.equal(shop.motionSnapshot().drag.jasmine,true);
  shop.workspace({revision:shop.revision,objects:[{...cup,x:700}],selected:cup.id});
  assert.equal(shop.objects[0].coffee,true);assert.equal(shop.objects[0].jasmine,true);assert.equal(shop.objects[0].milk,false);
});

test('未完成拿铁交付扣钱；已放台面的茉莉花可拾起使用',async t=>{
  const f=await fixture(t),cup=await coffee(f),{shop,act}=f;
  const jasmine={id:shop.serial+1,kind:'jasmine',x:730,y:475,noodles:0,sauce:0};
  shop.workspace({revision:shop.revision,objects:[cup,jasmine],selected:cup.id});
  await act('add_jasmine',{bowl_id:cup.id,ingredient_id:jasmine.id});assert.equal(shop.objects.length,1);
  shop.enqueue('等拿铁',1);await act('feed',{bowl_id:cup.id,customer_id:shop.queue[0].id});
  assert.equal(shop.served,0);assert.equal(shop.balance,-100);assert.equal(shop.objects.length,0);
});

test('咖啡机遵守暂停、查封、复原和切换模板，并支持取消取杯',async t=>{
  const f=await fixture(t),{shop,act}=f;
  await act('brew_coffee',{fresh_item:{id:1,kind:'bowl'}});await act('pause');
  await assert.rejects(act('take_coffee'),/先开始游戏/);await act('start');
  shop.cooking[0].ready_at=Date.now()-1;await act('take_coffee');
  const cup=structuredClone(shop.objects[0]);
  shop.workspace({revision:shop.revision,objects:[cup],selected:cup.id});assert.ok(shop.objects[0].at_machine);
  await act('demo_raid');assert.equal(shop.objects.length,0);assert.equal(shop.cooking.length,0);
  await act('restore');assert.equal(shop.snapshot().cafe_effect,null);
  await act('brew_coffee',{fresh_item:{id:shop.serial+1,kind:'bowl'}});
  await act('preset_use',{id:'saozi'});assert.equal(shop.cooking.length,0);
  await assert.rejects(act('brew_coffee',{fresh_item:{id:shop.serial+1,kind:'bowl'}}),/没有咖啡机/);
});

test('咖啡厅模板素材可导出、按需安装，服务器重启保留原店铺',async t=>{
  const f=await fixture(t),exported=await f.library.export(f.template.id);
  assert.deepEqual(exported.assets,data.assets);
  const noMilk={...data,assets:{...data.assets}};delete noMilk.assets.milk;
  await assert.rejects(f.library.install(noMilk),/缺少/);
  const dataDir=path.join(f.dir,'server');let app=await startServer({dataDir});t.after(()=>app.close());
  assert.equal(app.noodle.presets.length,1);assert.equal(app.noodle.activePreset,'saozi');
  const imported=await fetch(app.url+'/api/templates/import',{method:'POST',headers:{'Content-Type':'application/json'},body:source});assert.equal(imported.status,200);await imported.json();
  const cafe=app.noodle.presets.find(p=>p.name==='茉莉咖啡厅');assert.equal(app.noodle.activePreset,cafe.id);
  const config=structuredClone(app.noodle.config);config.layout.props.milk.x=30;config.sign.title='我的咖啡厅';await app.noodle.save(config);
  const res=await fetch(app.url+'/api/templates/'+cafe.config.template_id+'/assets/coffee_machine.png');assert.equal(res.status,200);await res.arrayBuffer();
  await app.close();app=await startServer({dataDir});assert.equal(app.noodle.presets.length,2);assert.equal(app.noodle.activePreset,cafe.id);assert.deepEqual(app.noodle.config,config);
});

test('臭鸡蛋或臭生菜入杯变成邪恶咖啡，不能洗掉或继续加料，递餐后顾客拒绝',async t=>{
  for(const kind of ['egg','leaf']){
    const f=await fixture(t),cup=await coffee(f),{shop,act,ingredient}=f;
    await ingredient('jasmine',cup);await ingredient('milk',cup);
    await shop.throwFood(kind,1);const litter=shop.throws[0];
    await act('spoil',{bowl_id:cup.id,throw_id:litter.id,throw_revision:litter.revision});
    assert.ok(cup.spoiled);assert.equal(shop.throws.length,0);
    await assert.rejects(act('spoil',{bowl_id:cup.id,throw_id:litter.id,throw_revision:litter.revision}),/已被捡走/);
    shop.workspace({revision:shop.revision,objects:[{...cup,spoiled:false}],selected:cup.id});assert.ok(shop.objects[0].spoiled);
    await assert.rejects(ingredient('milk',shop.objects[0]),/变质/);
    shop.enqueue('拿铁顾客',1);await act('feed',{bowl_id:cup.id,customer_id:shop.queue[0].id});
    assert.equal(shop.served,0);assert.equal(shop.balance,-100);assert.ok(shop.departures[0].spoiled);assert.equal(shop.objects.length,0);
  }
});

test('三种原料的六种制作顺序均能做成拿铁，配料不必先有咖啡',async t=>{
  for(const order of [['coffee','milk','jasmine'],['coffee','jasmine','milk'],['milk','coffee','jasmine'],['milk','jasmine','coffee'],['jasmine','coffee','milk'],['jasmine','milk','coffee']]){
    const f=await fixture(t),{shop,act,ingredient}=f;
    shop.workspace({revision:shop.revision,objects:[{id:1,kind:'bowl',x:550,y:475,noodles:0,sauce:0}],selected:1});
    for(const key of order){
      let cup=shop.objects[0];
      if(key==='coffee'){
        await act('brew_coffee',{object_id:cup.id});shop.cooking[0].ready_at=Date.now()-1;await act('take_coffee');
        cup=shop.objects[0];shop.workspace({revision:shop.revision,objects:[{...cup,x:550,y:475}],selected:cup.id});
      }else await ingredient(key,cup);
    }
    assert.ok(shop.objects[0].coffee && shop.objects[0].milk && shop.objects[0].jasmine,order.join(','));
    shop.enqueue('顾客',1);await act('feed',{bowl_id:1,customer_id:shop.queue[0].id});assert.equal(shop.served,1);
  }
});

test('先放牛奶或茉莉花的杯子也能被臭食材污染，不能重新萃取恢复',async t=>{
  for(const kind of ['milk','jasmine']){
    const f=await fixture(t),{shop,act,ingredient}=f;
    shop.workspace({revision:shop.revision,objects:[{id:1,kind:'bowl',x:550,y:475,noodles:0,sauce:0}],selected:1});
    await ingredient(kind,shop.objects[0]);await shop.throwFood('egg',1);const litter=shop.throws[0];
    await act('spoil',{bowl_id:1,throw_id:litter.id,throw_revision:litter.revision});assert.ok(shop.objects[0].spoiled);
    await assert.rejects(act('brew_coffee',{object_id:1}),/杯子/);
  }
});

test('咖啡厅没有矿泉水点单，也不能把牛奶壶作为新台面物品保存',async t=>{
  const f=await fixture(t),{shop,act}=f;
  assert.equal(shop.config.water_gift,null);
  await assert.rejects(act('demo_water'),/不提供矿泉水/);
  for(const kind of ['milk','water'])assert.throws(()=>shop.workspace({revision:shop.revision,objects:[{id:1,kind,x:550,y:475,noodles:0,sauce:0}],selected:null}),/物品/);
  await shop.receive({type:'gift',giftName:'小花花',giftId:31036,count:1,uid:1,user:'咖啡顾客',transactionId:'cafe-no-water'});
  assert.equal(shop.queue.length,1);assert.equal(shop.queue[0].recipe,'jasmine-latte');assert.equal(shop.queue[0].order,'noodles');
});

test('程序升级保留已安装旧咖啡厅，不自动安装或替换独立模板',async t=>{
  const f=await fixture(t),old=templatePackage('茉莉咖啡厅-v1.0.0.luobo');
  const legacy=await f.library.install(old),oldShop=await new NoodleShop(f.dir,f.library).init();
  await oldShop.action({action:'preset_create',name:'我的旧咖啡厅',template_id:legacy.id});
  const id=oldShop.activePreset,custom=structuredClone(oldShop.config);
  custom.cook_seconds=3;custom.gift_id=123;custom.gift_name='我的点单礼物';custom.sign.title='我的招牌';custom.layout.modules.counter.x=185;
  await oldShop.save(custom);
  const app=await startServer({dataDir:f.dir});t.after(()=>app.close());
  assert.equal(app.noodle.activePreset,id);assert.equal(app.noodle.template().version,'1.0.0');assert.equal(app.noodle.config.cook_seconds,3);
  assert.equal(app.noodle.config.gift_id,123);assert.equal(app.noodle.config.sign.title,'我的招牌');assert.deepEqual(app.noodle.config.layout,custom.layout);
  assert.equal(app.noodle.config.template_id,legacy.id);
  for(const key of ['gift_id','gift_name','layout','sign','cook_seconds','people_per_gift','template_id'])assert.deepEqual(app.noodle.config[key],custom[key]);
  assert.ok(app.noodle.config.thief_gift?.gift_id);assert.equal(app.noodle.config.water_gift,null);
  const count=app.noodle.presets.length;await app.close();const reload=await startServer({dataDir:f.dir});t.after(()=>reload.close());assert.equal(reload.noodle.presets.length,count);assert.equal(reload.noodle.activePreset,id);
});

test('咖啡厅客户端只将咖啡、茉莉花和牛奶齐全的杯子标为成品',()=>{
  const context=vm.createContext({ChefConfig:{workflow:'jasmine-latte'},NoodleRules:require('../public/noodle/rules.js')});
  vm.runInContext(require('node:fs').readFileSync(require.resolve('../public/noodle/chef-systems.js'),'utf8'),context);
  const ready=context.ChefSystems.RecipeSystem.ready;
  for(const missing of ['coffee','jasmine','milk'])assert.ok(!ready({kind:'bowl',coffee:true,jasmine:true,milk:true,[missing]:false}));
  assert.ok(ready({kind:'bowl',coffee:true,jasmine:true,milk:true}));assert.ok(!ready({kind:'bowl',coffee:true,jasmine:true,milk:true,spoiled:true}));
  assert.ok(ready({kind:'water'}));
});
