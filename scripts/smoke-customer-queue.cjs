const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const {NoodleShop}=require(path.join(packageRoot,'lib/noodle.cjs'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),errors=[],results=[];
let runtime,win,scene;
app.on('window-all-closed',()=>{});app.setPath('userData',path.join(root,'work','queue-browser-'+process.pid));
const ui=code=>win.webContents.executeJavaScript(code),live=code=>scene.webContents.executeJavaScript(code);
const d=`document.querySelector('#noodle-frame').contentDocument`;
async function waitFor(check,label){const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await delay(40);}throw Error('排队界面验证超时：'+label);}
async function setQueue(queue){
  await waitFor(()=>ui(`!document.querySelector('#customer-queue-save').disabled`),'设置可用');
  await ui(`document.querySelector('#customer-scale').value=${queue.scale*100};document.querySelector('#customer-rows').value=${queue.rows};document.querySelector('#customer-columns').value=${queue.columns};for(const id of ['customer-scale','customer-rows','customer-columns'])document.getElementById(id).dispatchEvent(new Event('input'));document.querySelector('#customer-queue-form').requestSubmit()`);
  await waitFor(()=>JSON.stringify(runtime.noodle.config.layout.queue)===JSON.stringify(queue),'保存设置');
  await waitFor(()=>ui(`!document.querySelector('#customer-queue-save').disabled&&(!${d}.querySelector('.customer:not(.departing)')||${d}.querySelector('.customer:not(.departing)').style.scale==='${queue.scale}')`),'设置同步到预览');
}
async function dragQueue(dx,dy){
  const p=await ui(`(()=>{const f=document.querySelector('#noodle-frame').getBoundingClientRect(),r=${d}.querySelectorAll('.customer:not(.departing) .customer-head')[4].getBoundingClientRect();return {x:Math.round(f.x+r.x+r.width/2),y:Math.round(f.y+r.y+r.height/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseMove',...p});await delay(30);
  win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});
  for(let i=1;i<=8;i++){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(p.x+dx*i/8),y:Math.round(p.y+dy*i/8),button:'left'});await delay(16);}
  win.webContents.sendInputEvent({type:'mouseUp',x:p.x+dx,y:p.y+dy,button:'left',clickCount:1});await delay(80);
}
const queueRects=()=>ui(`(()=>{const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {people:[...${d}.querySelectorAll('.customer:not(.departing)')].map(rect),boards:['game-stats','gift-rule','thief-board','shop-rating','queue-overflow'].map(id=>rect(${d}.getElementById(id)))}})()`);
async function moveQueue(){
  const shop=runtime.noodle;
  await shop.save({...shop.config,layout:{...shop.config.layout,modules:{...shop.config.layout.modules,customers:{x:60,y:-20,scale:.8,visible:true}}}});
  await waitFor(()=>ui(`${d}.querySelector('[data-module="customers"]').style.transform==='translate(60px, -20px) scale(0.8)'`),'顾客模块缩放同步');
  await ui(`document.querySelector('#noodle-build').click()`);await waitFor(()=>ui(`${d}.body.classList.contains('building')`),'独立拖动搭建');
  const original=structuredClone(shop.config.layout),ids=shop.queue.map(p=>p.id),before=await queueRects();
  await dragQueue(64,-32);
  assert.equal(await ui(`document.querySelector('#builder-item').value`),'queue_customers');
  const after=await queueRects();assert.deepEqual(after.boards,before.boards,'整队拖动不移动榜单和文字');
  assert.equal(after.people.length,before.people.length);
  after.people.forEach((r,i)=>{assert.ok(Math.abs(r.x-before.people[i].x-64)<1);assert.ok(Math.abs(r.y-before.people[i].y+32)<1);});
  await ui(`document.querySelector('#noodle-cancel').click()`);
  await waitFor(()=>ui(`!${d}.body.classList.contains('building')`),'取消独立拖动');
  assert.deepEqual((await queueRects()).people,before.people);assert.deepEqual(shop.config.layout,original);
  await ui(`document.querySelector('#noodle-build').click()`);await waitFor(()=>ui(`${d}.body.classList.contains('building')`),'再次独立拖动');
  await dragQueue(56,-24);
  await ui(`document.querySelector('#module-scale').value=80;document.querySelector('#module-scale').dispatchEvent(new Event('input'));document.querySelector('#noodle-save').click()`);
  await waitFor(()=>ui(`!${d}.body.classList.contains('building')`),'保存队伍位置');
  const saved=shop.config.layout;
  assert.notEqual(saved.props.queue_customers.x,original.props.queue_customers.x);assert.equal(saved.props.queue_customers.scale,.8);
  assert.deepEqual(saved.modules,original.modules);assert.deepEqual(shop.queue.map(p=>p.id),ids);
  for(const key of Object.keys(original.props))if(key!=='queue_customers')assert.deepEqual(saved.props[key],original.props[key]);
  const item=saved.props.queue_customers,transform=`translate(${item.x}px, ${item.y}px) scale(${item.scale})`;
  await waitFor(()=>live(`document.querySelector('#game-customers').style.transform===${JSON.stringify(transform)}`),'顾客输出同步整队位置');
  assert.deepEqual((await new NoodleShop(path.dirname(shop.file),shop.templates).init()).config.layout.props.queue_customers,item);
}
async function feed(scale){
  const shop=runtime.noodle;
  await setQueue({...shop.config.layout.queue,scale});
  await shop.action({action:'clear_queue'});await shop.action({action:'clear_table'});shop.departures=[];
  await shop.save({...shop.config,layout:{...shop.config.layout,modules:{...shop.config.layout.modules,customers:{x:60,y:-20,scale:.8,visible:true}}}});
  shop.enqueue('递餐验证',1,901,'',false);
  const bowl={id:++shop.serial,kind:'bowl',x:600,y:480,noodles:1,sauce:1};
  const workflow=shop.template().workflow;
  if(workflow==='jasmine-latte')Object.assign(bowl,{noodles:0,sauce:0,coffee:true,jasmine:true,milk:true});
  if(workflow==='stir-fry')Object.assign(bowl,{noodles:0,sauce:0,ingredients:['beef'],garnishes:[]});
  if(workflow==='burger')Object.assign(bowl,{noodles:0,sauce:0,bun:true,patty:true,closed:true,toppings:['tomato','lettuce','cheese','mustard']});
  shop.objects=[bowl];shop.selected=bowl.id;shop.revision++;shop.publish();
  await waitFor(()=>ui(`${d}.querySelectorAll('.customer:not(.departing)').length===1&&!!${d}.querySelector('[data-object-id="${bowl.id}"]')`),'递餐演示物品');
  await ui(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await delay(100);
  const points=await ui(`(()=>{const doc=${d},f=document.querySelector('#noodle-frame').getBoundingClientRect(),a=doc.querySelector('[data-object-id="${bowl.id}"]').getBoundingClientRect(),b=doc.querySelector('.customer:not(.departing) .customer-head').getBoundingClientRect();return {from:{x:Math.round(f.x+a.x+a.width/2),y:Math.round(f.y+a.y+a.height/2)},to:{x:Math.round(f.x+b.x+b.width/2),y:Math.round(f.y+b.y+b.height/2)}}})()`);
  const before=shop.served;
  win.webContents.sendInputEvent({type:'mouseMove',...points.from});await delay(30);
  win.webContents.sendInputEvent({type:'mouseDown',...points.from,button:'left',clickCount:1});
  for(let i=1;i<=12;i++){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(points.from.x+(points.to.x-points.from.x)*i/12),y:Math.round(points.from.y+(points.to.y-points.from.y)*i/12),button:'left'});await delay(16);}
  win.webContents.sendInputEvent({type:'mouseUp',...points.to,button:'left',clickCount:1});
  await waitFor(()=>shop.served===before+1&&shop.queue.length===0,workflow+'真实递餐 '+scale);
  assert.ok(shop.departures.at(-1).correct);assert.equal(shop.balance,0);
}
app.whenReady().then(async()=>{
  const dir=await fs.mkdtemp(path.join(root,'work','customer-queue-smoke-'));runtime=await startServer({dataDir:dir,seedDir:path.join(packageRoot,'data')});
  const opts={show:false,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}};
  win=new BrowserWindow({...opts,width:1700,height:1200});scene=new BrowserWindow({...opts,width:1280,height:720});
  for(const target of [win,scene])target.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  const shop=runtime.noodle;
  for(const [index,[name,file]] of [['臊子面馆',null],['刀削面馆','刀削面馆-v1.0.1.luobo'],['咖啡厅','咖啡厅模板-v1.0.2.luobo'],['麻辣香锅','麻辣香锅-v1.0.4.luobo'],['汉堡店','美式汉堡店-v1.0.3.luobo']].entries()){
    if(file){const template=await shop.templates.install(JSON.parse(await fs.readFile(path.join(root,'artifacts',file),'utf8')));await shop.action({action:'preset_create',name,template_id:template.id});}
    await shop.action({action:'start'});await shop.action({action:'clear_queue'});shop.enqueue('排队顾客',100);
    await win.loadURL(runtime.url+'/?queue-smoke='+index+'#noodle');await scene.loadURL(runtime.url+'/noodle/?layer=customers&queue-smoke='+index);
    await waitFor(()=>ui(`!document.querySelector('#noodle-view').hidden&&!!${d}?.querySelector('.customer')`),name+'载入');
    const cases=[];
    for(const queue of [{rows:1,columns:5,scale:.5},{rows:2,columns:7,scale:1.25},{rows:3,columns:8,scale:2},{rows:4,columns:9,scale:.75}]){
      await shop.action({action:'clear_queue'});shop.enqueue('排队顾客',100);await setQueue(queue);
      const capacity=queue.rows*queue.columns;
      await waitFor(()=>ui(`${d}.querySelectorAll('.customer:not(.departing)').length===${capacity}`),name+'展示人数');
      await waitFor(()=>live(`document.querySelectorAll('.customer:not(.departing)').length===${capacity}&&document.querySelector('.customer:not(.departing)').style.scale==='${queue.scale}'`),'顾客层同步');
      const actual=await live(`(()=>{const people=[...document.querySelectorAll('.customer:not(.departing)')],rows={};for(const p of people)rows[p.style.top]=(rows[p.style.top]||0)+1;return {rows:Object.keys(rows).length,columns:Object.values(rows),overflow:document.querySelector('#queue-overflow').textContent}})()`);
      assert.equal(actual.rows,queue.rows);assert.ok(actual.columns.every(n=>n===queue.columns));assert.ok(actual.overflow.includes('还有 '+(100-capacity)+' 位'));
      assert.equal(shop.queue.length,100);
      if(name==='汉堡店'){await delay(150);await fs.writeFile(path.join(root,'artifacts',`v2.7.1-排队-${queue.rows}排.png`),(await scene.webContents.capturePage()).toPNG());}
      cases.push(queue);
    }
    await moveQueue();
    for(const scale of [.5,2])await feed(scale);
    const saved=structuredClone(shop.config.layout.queue);
    await ui(`document.querySelector('#noodle-build').click()`);await waitFor(()=>ui(`${d}.body.classList.contains('building')`),'搭建');
    assert.equal(await ui(`document.querySelector('#customer-queue-save').disabled`),true);
    await ui(`document.querySelector('#noodle-reset').click();document.querySelector('#noodle-save').click()`);
    await waitFor(()=>ui(`!${d}.body.classList.contains('building')`),'恢复默认位置保存');assert.deepEqual(shop.config.layout.queue,saved);
    const reload=await new NoodleShop(dir,shop.templates).init();assert.deepEqual(reload.config.layout.queue,saved);
    await win.loadURL(runtime.url+'/?queue-reload='+index+'#noodle');await waitFor(()=>ui(`!document.querySelector('#noodle-view').hidden&&document.querySelector('#customer-scale').value==='${saved.scale*100}'&&document.querySelector('#customer-rows').value==='${saved.rows}'&&document.querySelector('#customer-columns').value==='${saved.columns}'`),'刷新保留设置');
    results.push({name,cases,realMouseFeedAt:[.5,2],saved});
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(root,'artifacts','v2.7.1-排队设置验证.json'),JSON.stringify({passed:true,packageRoot,results,errors},null,2));
  console.log('五种模板：队伍独立整体拖动、榜单文字不动、取消、保存、输出同步、移动缩放后的真实递餐、行列与重启保存通过');
}).catch(async error=>{console.error(error);if(win)await fs.writeFile(path.join(root,'artifacts','v2.7.1-排队设置失败.png'),(await win.webContents.capturePage()).toPNG());process.exitCode=1;}).finally(async()=>{scene?.destroy();win?.destroy();await runtime?.close();app.exit(process.exitCode||0);});
