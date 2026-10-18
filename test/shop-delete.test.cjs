const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {NoodleShop}=require('../lib/noodle.cjs');
const {startServer}=require('../server.cjs');
async function dir(t){const folder=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-shop-delete-'));t.after(()=>{if(path.dirname(path.resolve(folder))!==path.resolve(os.tmpdir()))throw new Error('清理路径无效');return fs.rm(folder,{recursive:true,force:true});});return folder;}

test('删除非当前店铺保留当前配置和本局，删除当前店铺切换并清空本局，配置先备份',async t=>{
  const folder=await dir(t),shop=await new NoodleShop(folder).init();
  await shop.action({action:'preset_create',name:'第一家'});const first=shop.activePreset;
  await shop.action({action:'preset_create',name:'第二家'});const second=shop.activePreset,config=structuredClone(shop.config);
  shop.mode='running';shop.enqueue('排队顾客',1);shop.objects=[{id:1,kind:'bowl',x:500,y:475,noodles:1,sauce:1}];shop.balance=7;
  const queue=structuredClone(shop.queue),objects=structuredClone(shop.objects);
  await shop.action({action:'preset_delete',id:'saozi'});assert.equal(shop.activePreset,second);assert.deepEqual(shop.config,config);assert.deepEqual(shop.queue,queue);assert.deepEqual(shop.objects,objects);assert.equal(shop.balance,7);
  const before=JSON.stringify(shop.snapshot());await assert.rejects(shop.action({action:'preset_delete',id:'../../outside'}),/不存在/);assert.equal(JSON.stringify(shop.snapshot()),before);
  await shop.action({action:'preset_delete',id:second});assert.equal(shop.activePreset,first);assert.deepEqual(shop.queue,[]);assert.deepEqual(shop.objects,[]);assert.equal(shop.balance,7);
  const backup=JSON.parse(await fs.readFile(shop.file+'.before-shop-delete-'+second+'.json','utf8'));assert.equal(backup.active_preset,second);assert.equal(backup.presets.length,2);
  const reload=await new NoodleShop(folder).init();assert.equal(reload.presets.length,1);assert.equal(reload.activePreset,first);
});

test('最后一家店铺可删除到空列表，重启不补回，空列表不能开局且可从模板重新创建',async t=>{
  const folder=await dir(t),shop=await new NoodleShop(folder).init();
  await shop.action({action:'start'});await shop.action({action:'preset_delete',id:'saozi'});
  assert.deepEqual(shop.presets,[]);assert.equal(shop.activePreset,null);assert.equal(shop.mode,'closed');assert.equal(shop.template().id,'saozi');
  const reload=await new NoodleShop(folder).init();assert.deepEqual(reload.presets,[]);assert.equal(reload.activePreset,null);
  await assert.rejects(reload.action({action:'start'}),/创建店铺/);await assert.rejects(reload.save(reload.config),/创建店铺/);
  await reload.action({action:'preset_create',template_id:'saozi',name:'重新开店'});assert.equal(reload.presets.length,1);assert.equal(reload.presets[0].name,'重新开店');
});

test('删除店铺保留安装的模板，全部店铺删除后仍可导入模板并立即出现在模板库',async t=>{
  const folder=await dir(t);let app=await startServer({dataDir:folder});t.after(()=>app.close());
  const post=(route,body)=>fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const source=JSON.parse(await fs.readFile(path.join(__dirname,'../artifacts/刀削面馆-v1.0.1.luobo'),'utf8'));
  const importResponse=await post('/api/templates/import',source);assert.equal(importResponse.status,200);const imported=await importResponse.json(),id=imported.template.id,shopId=imported.state.active_preset;
  assert.ok(imported.state.templates.some(t=>t.id===id));assert.equal(imported.state.templates.length,2);
  const response=await post('/api/noodle/action',{action:'preset_delete',id:shopId});assert.equal(response.status,200);const result=await response.json();assert.equal(result.state.presets.length,1);assert.ok(result.state.templates.some(t=>t.id===id));
  await fs.access(path.join(folder,'templates',id,'manifest.json'));
  const exported=await (await fetch(app.url+'/api/templates/'+id+'/export')).json();assert.deepEqual(exported.assets,source.assets);
  assert.equal((await post('/api/noodle/action',{action:'preset_delete',id:'saozi'})).status,200);
  await app.close();app=await startServer({dataDir:folder});assert.equal(app.noodle.presets.length,0);assert.equal(app.noodle.templates.list().length,2);
  const reinstalled=await post('/api/templates/import',source);assert.equal(reinstalled.status,200);const latest=await reinstalled.json();assert.equal(latest.state.presets.length,1);assert.equal(latest.state.templates.length,2);assert.equal(latest.state.template.id,id);
  assert.equal((await post('/api/templates/delete',{id})).status,200);assert.equal(app.noodle.activePreset,null);assert.equal(app.noodle.presets.length,0);assert.equal(app.noodle.templates.list().length,1);
});

test('保存失败不会移除店铺或清空本局',async t=>{
  const folder=await dir(t),shop=await new NoodleShop(folder).init();shop.mode='running';shop.enqueue('顾客',1);
  const before=JSON.stringify(shop.snapshot());shop.file=path.join(folder,'blocked');await fs.mkdir(shop.file);
  await assert.rejects(shop.action({action:'preset_delete',id:'saozi'}));assert.equal(JSON.stringify(shop.snapshot()),before);
});
