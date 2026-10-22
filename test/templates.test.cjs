const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {TemplateLibrary,metadata,png}=require('../lib/templates.cjs');
const {NoodleShop}=require('../lib/noodle.cjs');
const {startServer}=require('../server.cjs');
const Layout=require('../public/noodle/layout.js');
const {templatePackage}=require('./fixtures/templates.cjs');

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-template-'));
  t.after(()=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-template-'))throw new Error('清理路径无效');return fs.rm(dir,{recursive:true,force:true});});
  const templates=await new TemplateLibrary(dir).init();
  const data=templatePackage('刀削面馆-v1.0.0.luobo');
  const template=await templates.install(data);
  const shop=await new NoodleShop(dir,templates).init();
  await shop.action({action:'preset_create',name:'刀削面馆',template_id:template.id});
  shop.mode='running';return {dir,templates,data,template,shop};
}
test('模板边界：只收 PNG 与支持的玩法，不接受路径或外部素材网址',async t=>{
  const {templates,data}=await fixture(t);
  assert.throws(()=>metadata({...data,workflow:'javascript'}),/玩法/);
  assert.throws(()=>png('https://example.com/pot.png'),/PNG/);
  assert.throws(()=>png('AAAA'),/PNG/);
  await assert.rejects(templates.install({...data,assets:{...data.assets,'../outside':'AAAA'}}),/素材配置/);
  await assert.rejects(templates.asset('../../outside','pot'),/尚未安装/);
});
test('模板安装、导出与重启：去重素材，面馆独立持久化，原面馆保留',async t=>{
  const {dir,templates,data,template,shop}=await fixture(t);
  assert.equal((await templates.install(data)).id,template.id);
  assert.equal(templates.list().length,2);
  const exported=await templates.export(template.id);
  assert.deepEqual(exported.assets,data.assets);
  await shop.action({action:'preset_create',name:'第二家刀削面馆',template_id:template.id});
  const reload=await new NoodleShop(dir,await new TemplateLibrary(dir).init()).init();
  assert.equal(reload.presets.length,3);
  assert.equal(reload.presets[0].name,'臊子面馆');
  assert.equal(reload.template().id,template.id);
  await reload.action({action:'preset_use',id:'saozi'});
  assert.equal(reload.template().workflow,'mix');
});
test('导入入口：接收完整模板并创建新面馆，无效导入不覆盖当前配置',async t=>{
  const {dir,data}=await fixture(t);
  const app=await startServer({dataDir:dir});t.after(()=>app.close());
  const post=body=>fetch(app.url+'/api/templates/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const count=app.noodle.presets.length;
  const response=await post(data);assert.equal(response.status,200);
  const imported=await response.json();assert.equal(imported.state.presets.length,count+1);
  assert.equal(imported.state.template.workflow,'knife-noodles');
  const before=app.noodle.activePreset;
  const invalid=await post({...data,assets:{...data.assets,pot:'https://example.com/pot.png'}});
  assert.equal(invalid.status,400);assert.equal(app.noodle.activePreset,before);assert.equal(app.noodle.presets.length,count+1);
});

test('新安装只有基础模板，外部模板按需导入，重启保留已有面馆和布局',async t=>{
  const {dir}=await fixture(t),dataDir=path.join(dir,'fresh');
  let app=await startServer({dataDir,seedDir:dir});t.after(()=>app.close());
  assert.deepEqual(app.noodle.templates.list().map(t=>t.id),['saozi']);assert.equal(app.noodle.presets.length,1);
  const data=templatePackage('刀削面馆-v1.0.1.luobo');
  const response=await fetch(app.url+'/api/templates/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal(response.status,200);await response.json();
  const knife=app.noodle.snapshot().presets.find(p=>p.name==='刀削面馆');assert.ok(knife);
  assert.equal(app.noodle.activePreset,knife.id);
  assert.equal(app.noodle.templates.get(knife.template_id).workflow,'knife-noodles');
  await app.noodle.action({action:'preset_use',id:knife.id});
  const config=structuredClone(app.noodle.config);config.layout.props.rating.x=180;config.sign.title='我的刀削面馆';
  await app.noodle.save(config);await app.close();app=await startServer({dataDir,seedDir:dir});
  assert.equal(app.noodle.activePreset,knife.id);assert.deepEqual(app.noodle.config,config);
  assert.equal(app.noodle.presets.length,2);assert.equal(app.noodle.templates.list().length,2);
});

test('删除模板移除关联店铺与素材，保存备份，重启不补回并可重新安装',async t=>{
  const {dir,data,template}=await fixture(t);let app=await startServer({dataDir:dir});t.after(()=>app.close());
  const post=(route,body)=>fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  await app.noodle.action({action:'preset_create',name:'第二家刀削面馆',template_id:template.id});
  const active=app.noodle.activePreset;app.noodle.queue=[{id:1}];app.noodle.cooking=[{id:2}];
  const exported=await (await fetch(app.url+'/api/templates/'+template.id+'/export')).json();assert.deepEqual(exported.assets,data.assets);
  const removed=await post('/api/templates/delete',{id:template.id});assert.equal(removed.status,200);
  const result=await removed.json();assert.equal(result.state.active_preset,'saozi');assert.equal(result.state.presets.length,1);assert.equal(result.state.templates.length,1);
  assert.deepEqual(app.noodle.queue,[]);assert.deepEqual(app.noodle.cooking,[]);
  await assert.rejects(fs.access(path.join(dir,'templates',template.id)),{code:'ENOENT'});
  const backup=JSON.parse(await fs.readFile(app.noodle.file+'.before-template-delete-'+template.id+'.json'));assert.equal(backup.active_preset,active);assert.equal(backup.presets.length,3);
  const invalid=await post('/api/templates/delete',{id:'../../outside'});assert.equal(invalid.status,400);
  const base=await post('/api/templates/delete',{id:'saozi'});assert.equal(base.status,400);assert.equal(app.noodle.presets.length,1);
  await app.close();app=await startServer({dataDir:dir});assert.equal(app.noodle.templates.list().length,1);assert.equal(app.noodle.presets.length,1);
  const imported=await post('/api/templates/import',exported);assert.equal(imported.status,200);const reinstalled=await imported.json();assert.equal(reinstalled.template.id,template.id);assert.equal(reinstalled.state.presets.length,2);
});

test('删除非当前模板保留当前店铺、配置和物品；卸载失败保留原模板与店铺',async t=>{
  const {dir,template}=await fixture(t);const app=await startServer({dataDir:dir});t.after(()=>app.close());
  await app.noodle.action({action:'preset_use',id:'saozi'});const config=structuredClone(app.noodle.config);
  const objects=[{id:1,kind:'bowl',x:550,y:475,noodles:0,sauce:0}];app.noodle.objects=objects;
  const remove=app.noodle.templates.remove.bind(app.noodle.templates),presets=structuredClone(app.noodle.presets);
  app.noodle.templates.remove=async()=>{throw new Error('模拟素材被占用');};
  const post=()=>fetch(app.url+'/api/templates/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:template.id})});
  assert.equal((await post()).status,400);assert.deepEqual(app.noodle.presets,presets);assert.equal(app.noodle.templates.list().length,2);
  app.noodle.templates.remove=remove;assert.equal((await post()).status,200);
  assert.equal(app.noodle.activePreset,'saozi');assert.deepEqual(app.noodle.config,config);assert.deepEqual(app.noodle.objects,objects);
  assert.equal((await post()).status,400);
});

test('当前模板删除失败时恢复原店铺配置和游戏进度',async t=>{
  const {dir,template}=await fixture(t);const app=await startServer({dataDir:dir});t.after(()=>app.close());
  await app.noodle.action({action:'start'});
  const config=structuredClone(app.noodle.config),active=app.noodle.activePreset;
  app.noodle.queue=[{id:1}];app.noodle.objects=[{id:2,kind:'bowl'}];app.noodle.cooking=[{id:3}];app.noodle.served=4;
  const queue=app.noodle.queue,objects=app.noodle.objects,cooking=app.noodle.cooking;
  const revision=app.noodle.revision;
  const motion={client:'rollback-test',revision,pointer:{x:100,y:100,pressed:false},drag:null};
  app.noodle.pointerState=motion;app.noodle.pointerAt=Date.now();
  const revisions=[];app.noodle.on('state',state=>revisions.push(state.workspace_revision));
  app.noodle.templates.remove=async()=>{await new Promise(resolve=>setTimeout(resolve,150));throw new Error('模拟删除失败');};
  const response=await fetch(app.url+'/api/templates/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:template.id})});assert.equal(response.status,400);
  assert.equal(app.noodle.activePreset,active);assert.deepEqual(app.noodle.config,config);assert.equal(app.noodle.served,4);
  assert.deepEqual(app.noodle.queue,queue);assert.deepEqual(app.noodle.objects,objects);assert.deepEqual(app.noodle.cooking,cooking);
  assert.ok(app.noodle.revision>revision);assert.deepEqual(app.noodle.motionSnapshot(),{...motion,revision:app.noodle.revision});
  assert.ok(revisions.every((value,index)=>index===0 || value>=revisions[index-1]));
  const stored=JSON.parse(await fs.readFile(app.noodle.file,'utf8'));assert.equal(stored.active_preset,active);
});
test('削面、煮面与取面：单击削面，未熟不能拿，熟面只允许填入一份',async t=>{
  const {shop}=await fixture(t);
  await shop.action({action:'slice',revision:shop.revision});
  const raw=shop.objects[0];assert.equal(raw.kind,'raw');
  assert.equal(shop.snapshot().slice.id,raw.id);assert.equal(shop.config.cook_seconds,2);
  await shop.action({action:'boil',revision:shop.revision,object_id:raw.id});
  assert.ok(Math.abs(shop.cooking[0].ready_at-Date.now()-2000)<100);
  assert.equal(shop.objects.length,0);assert.equal(shop.cooking.length,1);
  await assert.rejects(shop.action({action:'take_pot',revision:shop.revision}),/没煮熟/);
  shop.cooking[0].ready_at=Date.now()-1;
  await shop.action({action:'take_pot',revision:shop.revision});
  const cooked=shop.objects[0];assert.equal(cooked.kind,'cooked');assert.equal(shop.cooking.length,0);
  const pot=Layout.stations(shop.config.layout).find(s=>s.kind==='noodles');
  assert.deepEqual(Layout.workspaceToStage(cooked,shop.config.layout),Layout.toStage(pot,shop.config.layout.modules.counter));
  const bowl={id:++shop.serial,kind:'bowl',x:650,y:475,noodles:0,sauce:0};
  shop.workspace({revision:shop.revision,objects:[cooked,bowl],selected:bowl.id});
  assert.throws(()=>shop.workspace({revision:shop.revision,objects:[cooked,{...bowl,noodles:1}],selected:bowl.id}),/先从锅里取出/);
  shop.workspace({revision:shop.revision,objects:[{...bowl,noodles:1,scallions:true}],selected:bowl.id});
  assert.equal(shop.objects[0].noodles,1);
});

test('熟面拖空后落地，普通操作保留落地位置，不能伪造位置或份数',async t=>{
  const {shop}=await fixture(t);
  shop.cooking=[{id:1,ready_at:Date.now()-1}];
  await shop.action({action:'take_pot',revision:shop.revision});
  const id=shop.objects[0].id, revision=shop.revision;
  for(const x of [NaN,-1,1281,'700'])await assert.rejects(shop.action({action:'drop_cooked',revision,object_id:id,x}),/位置无效/);
  await assert.rejects(shop.action({action:'drop_cooked',revision,object_id:id+1,x:500}),/已被拿走/);
  await shop.action({action:'drop_cooked',revision,object_id:id,x:700});
  const cooked=structuredClone(shop.objects[0]),p=Layout.workspaceToStage(cooked,shop.config.layout);
  assert.equal(p.x,700);assert.ok(p.y>=665 && p.y<=691);
  const bowl={id:++shop.serial,kind:'bowl',x:650,y:475,noodles:0,sauce:0};
  shop.workspace({revision:shop.revision,objects:[cooked,bowl],selected:bowl.id});
  assert.deepEqual(shop.objects[0],cooked);
  assert.throws(()=>shop.workspace({revision:shop.revision,objects:[{...cooked,x:cooked.x+1},bowl],selected:bowl.id}),/中间台面/);
  assert.throws(()=>shop.workspace({revision:shop.revision,objects:[cooked,{...bowl,noodles:1}],selected:bowl.id}),/先从锅里取出/);
  await shop.action({action:'discard',revision:shop.revision,object_id:id});
  assert.equal(shop.objects.length,1);assert.equal(shop.objects[0].kind,'bowl');
});

test('台面没有空位仍能从锅里取面，落地位置跟随搭建布局换算',async t=>{
  const {shop}=await fixture(t);
  shop.objects=[360,450,540,630,720,810].flatMap(x=>[420,490,550].map(y=>({id:++shop.serial,kind:'raw',x,y,noodles:0,sauce:0})));
  shop.cooking=[{id:99,ready_at:Date.now()-1}];
  const layout=shop.config.layout;layout.modules.counter={x:100,y:30,scale:.8,visible:true};layout.props.tray={x:50,y:20,scale:.75};
  await shop.action({action:'take_pot',revision:shop.revision});
  const cooked=shop.objects.at(-1);
  await shop.action({action:'drop_cooked',revision:shop.revision,object_id:cooked.id,x:1239});
  const p=Layout.workspaceToStage(cooked,layout);
  assert.ok(Math.abs(p.x-1239)<.00001 && p.y>=665 && p.y<=691);
  shop.workspace({revision:shop.revision,objects:structuredClone(shop.objects),selected:null});
});

test('煮面时长独立保存、验证范围、修改只影响下一份，取面后碗仍为空',async t=>{
  const {shop,dir,templates}=await fixture(t);
  for(const seconds of [0,-1,1.5,61,null,'2'])await assert.rejects(shop.save({...shop.config,cook_seconds:seconds}),/煮面时长/);
  await shop.save({...shop.config,cook_seconds:3});await shop.action({action:'slice',revision:shop.revision});
  const raw=shop.objects[0];await shop.action({action:'boil',revision:shop.revision,object_id:raw.id});const deadline=shop.cooking[0].ready_at;
  assert.ok(Math.abs(deadline-Date.now()-3000)<100);await shop.save({...shop.config,cook_seconds:1});assert.equal(shop.cooking[0].ready_at,deadline);
  const reload=await new NoodleShop(dir,templates).init();assert.equal(reload.config.cook_seconds,1);
  const bowl={id:++shop.serial,kind:'bowl',x:650,y:475,noodles:0,sauce:0};shop.objects.push(bowl);shop.cooking[0].ready_at=Date.now()-1;
  await shop.action({action:'take_pot',revision:shop.revision});assert.equal(bowl.noodles,0);assert.equal(shop.objects.filter(o=>o.kind==='cooked').length,1);
});
test('刀削面配料自由：四种组合都满意，错餐扣钱，收钱和一键复原复用',async t=>{
  const {shop}=await fixture(t);
  for(const scallions of [false,true])for(const cilantro of [false,true]) {
    shop.enqueue('顾客',1);
    const bowl={id:++shop.serial,kind:'bowl',x:500,y:500,noodles:1,sauce:0,scallions,cilantro};
    shop.objects=[bowl];
    await shop.feed({revision:shop.revision,object_id:bowl.id,customer_id:shop.queue[0].id});
    assert.equal(shop.departures.at(-1).correct,true);
    await shop.deposit({revision:shop.revision,object_id:shop.objects[0].id});
  }
  assert.equal(shop.balance,400);
  shop.enqueue('顾客',1);const water={id:++shop.serial,kind:'water',x:500,y:500,noodles:0,sauce:0};shop.objects=[water];
  await shop.feed({revision:shop.revision,object_id:water.id,customer_id:shop.queue[0].id});
  assert.equal(shop.balance,300);assert.equal(shop.departures.at(-1).correct,false);
  const templateId=shop.config.template_id;
  await shop.action({action:'restore'});
  assert.equal(shop.balance,0);assert.equal(shop.config.template_id,templateId);assert.equal(shop.objects.length,0);
});
