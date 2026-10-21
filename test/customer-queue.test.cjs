const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const vm=require('node:vm');
const {NoodleShop}=require('../lib/noodle.cjs');
const Layout=require('../public/noodle/layout.js');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-queue-'));t.after(async()=>{assert.ok(dir.startsWith(path.join(os.tmpdir(),'luobo-queue-')));await fs.rm(dir,{recursive:true,force:true});});return {dir,shop:await new NoodleShop(dir).init()};}

test('旧布局补默认4排20人及原大小，拒绝无效行列和缩放',()=>{
  const old=structuredClone(Layout.defaults);delete old.queue;
  assert.deepEqual(Layout.validate(old).queue,{rows:4,columns:20,scale:1});
  for(const [key,values] of [['rows',[0,7,1.5,null,'3']],['columns',[0,41,2.5,null,'12']],['scale',[.49,2.01,NaN,null,'1']]])for(const value of values){
    assert.throws(()=>Layout.validate({...old,queue:{...Layout.defaults.queue,[key]:value}}),/排队设置/);
  }
  for(const queue of [null,[],false])assert.throws(()=>Layout.validate({...old,queue}),/排队设置/);
});

test('减少展示行列不删除排队，扩大后恢复显示；各店铺单独保存并重启保留',async t=>{
  const {dir,shop}=await fixture(t);shop.enqueue('观众',200);
  const ids=shop.queue.map(p=>p.id),first=shop.activePreset;
  for(const rows of [1,2,3,4]){
    const queue={rows,columns:7,scale:1.25};await shop.save({...shop.config,layout:{...shop.config.layout,queue}});
    assert.equal(shop.snapshot().queue.length,rows*7);assert.equal(shop.snapshot().queue_count,200);assert.deepEqual(shop.queue.map(p=>p.id),ids);
  }
  await shop.save({...shop.config,layout:{...shop.config.layout,queue:{rows:6,columns:40,scale:.5}}});assert.equal(shop.snapshot().queue.length,200);
  await shop.action({action:'preset_create',name:'第二家'});
  await shop.save({...shop.config,layout:{...shop.config.layout,queue:{rows:1,columns:10,scale:2}}});
  await shop.action({action:'preset_use',id:first});assert.deepEqual(shop.config.layout.queue,{rows:6,columns:40,scale:.5});
  const reload=await new NoodleShop(dir).init();assert.deepEqual(reload.config.layout.queue,shop.config.layout.queue);
  assert.deepEqual(reload.presets.find(p=>p.id!==first).config.layout.queue,{rows:1,columns:10,scale:2});
});

test('顾客缩放后位置与命中区域一致，隐藏顾客不能命中，重叠时选中前排上层',async()=>{
  globalThis.NoodleLayout=Layout;
  const source=await fs.readFile(path.join(__dirname,'../public/noodle/shared.js'),'utf8');
  const {customerAt}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const queue=Array.from({length:240},(_,id)=>({id}));
  for(const scale of [.5,1,2])for(const columns of [1,7,20,40]){
    const settings={rows:3,columns,scale},p=Layout.position(0,settings);
    assert.equal(customerAt(queue,p.x+36.5*scale,p.y+29.5*scale,settings).id,0);
    assert.equal(customerAt(queue,-10,-10,settings),undefined);
    const hidden=Layout.position(settings.rows*columns,settings);assert.equal(customerAt(queue,hidden.x+36.5*scale,hidden.y+1*scale,settings),undefined);
    const last=Layout.position(settings.rows*columns-1,settings);assert.ok(last.x+72*scale<=1246.01);assert.ok(p.y+104*scale<=720);
    assert.ok(Layout.position(0,settings).layer>Layout.position(1,settings).layer);
  }
});

test('整队独立移动缩放后，各店铺递餐命中跟随小人位置',async()=>{
  globalThis.NoodleLayout=Layout;
  const shared=await fs.readFile(path.join(__dirname,'../public/noodle/shared.js'),'utf8');
  const {customerAt}=await import('data:text/javascript;base64,'+Buffer.from(shared).toString('base64'));
  const source=await fs.readFile(path.join(__dirname,'../public/noodle/game.js'),'utf8');
  const target=source.match(/function targetCustomer\(\) \{[\s\S]*?\n\}/)[0];
  for(const workflow of ['saozi','knife-noodles','jasmine-latte','stir-fry','burger'])for(const scale of [.5,2]) {
    const layout=structuredClone(Layout.defaults),person={id:9};
    layout.queue.scale=scale;
    layout.modules.customers={x:60,y:-20,scale:.8,visible:true};
    layout.modules.counter={x:-45,y:30,scale:1.2,visible:true};
    layout.props.queue_customers={x:120,y:-150,scale:1.3};
    const p=Layout.position(0,layout.queue),head={x:p.x+36.5*scale,y:p.y+29.5*scale};
    const stage=Layout.toStage(Layout.toStage(head,layout.props.queue_customers),layout.modules.customers);
    const held={kind:'bowl',...Layout.stageToWorkspace(stage,layout,workflow)};
    const context=vm.createContext({NoodleLayout:Layout,layout,state:{queue:[person],template:{workflow}},heldItem:()=>held,customerAt});
    vm.runInContext(target,context);
    assert.equal(context.targetCustomer(),person);
    Object.assign(held,Layout.stageToWorkspace({x:stage.x+1000,y:stage.y},layout,workflow));
    assert.equal(context.targetCustomer(),undefined);
    layout.modules.customers.visible=false;assert.equal(context.targetCustomer(),null);
  }
});
