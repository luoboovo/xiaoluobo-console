const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname,'..'), packageRoot = process.env.LUOBO_SMOKE_PACKAGE || root;
const { startServer } = require(path.join(packageRoot,'server.cjs'));
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
let runtime, win, scene;
const errors = [], results = [];
app.on('window-all-closed',()=>{});
app.setPath('userData',path.join(root,'work','shop-layout-browser-'+process.pid));
async function waitFor(check, label) {
  const end = Date.now()+12000;
  while (Date.now()<end) { if (await check()) return; await delay(40); }
  throw Error('界面验证超时：'+label);
}
const run = code => win.webContents.executeJavaScript(code);
async function center(selector, frame = true) {
  return run(`(()=>{const f=document.querySelector('#noodle-frame'),d=${frame?'f.contentDocument':'document'},r=d.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),o=${frame?'f.getBoundingClientRect()':'{x:0,y:0}'};return {x:Math.round(o.x+r.x+r.width/2),y:Math.round(o.y+r.y+r.height/2)}})()`);
}
async function drag(selector, dx, dy) {
  const start = await center(selector);
  win.webContents.sendInputEvent({type:'mouseMove',...start});
  win.webContents.sendInputEvent({type:'mouseDown',...start,button:'left',clickCount:1});
  for(let i=1;i<=10;i++) { win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(start.x+dx*i/10),y:Math.round(start.y+dy*i/10),button:'left'}); await delay(16); }
  win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(start.x+dx),y:Math.round(start.y+dy),button:'left',clickCount:1});
  await delay(100);
}
async function shot(name, target=win) {
  await target.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await delay(200);
  await fs.writeFile(path.join(root,'artifacts','v2.5.6-'+name+'.png'),(await target.webContents.capturePage()).toPNG());
}
app.whenReady().then(async()=>{
  const dir = await fs.mkdtemp(path.join(root,'work','shop-layout-smoke-'));
  runtime = await startServer({dataDir:dir,seedDir:path.join(packageRoot,'data')});
  win = new BrowserWindow({show:false,width:1700,height:1250,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  for (const [name,file] of [['臊子面馆',null],['刀削面馆','刀削面馆-v1.0.1.luobo'],['咖啡厅','咖啡厅模板-v1.0.2.luobo'],['麻辣香锅','麻辣香锅-v1.0.4.luobo'],['汉堡店','美式汉堡店-v1.0.1.luobo']]) {
    if(file) {
      const template = await runtime.noodle.templates.install(JSON.parse(await fs.readFile(path.join(root,'artifacts',file),'utf8')));
      await runtime.noodle.action({action:'preset_create',name,template_id:template.id});
    }
    await runtime.noodle.action({action:'save',config:{...runtime.noodle.config,sign:{top:'欢迎光临',title:name,bottom:'今天也要开心'},thief_min:20,thief_max:20}});
    await runtime.noodle.action({action:'start'}); await runtime.noodle.saveWallet(600); runtime.noodle.publish();
    await win.loadURL(runtime.url+'/#noodle');
    await waitFor(()=>run(`document.querySelector('#noodle-frame')?.contentDocument?.querySelector('#cash-balance')?.textContent==='600 元'`),name+'载入');
    await run(`document.querySelector('#thief-min').value='10';document.querySelector('#thief-max').value='10';document.querySelector('#thief-range-form').requestSubmit()`);
    await waitFor(()=>runtime.noodle.config.thief_min===10&&runtime.noodle.config.thief_max===10,'保存偷钱金额');
    await waitFor(()=>run(`!document.querySelector('#noodle-build').disabled`),'金额保存完成');
    await run(`document.querySelector('#noodle-build').click()`);
    await waitFor(()=>run(`document.querySelector('#noodle-frame').contentDocument.body.classList.contains('building')`),'搭建模式');
    for (const [key,id] of [['chef','chef-hand'],['stats','game-stats'],['gift_rule','gift-rule'],['thief_board','thief-board'],['sign_title','sign-title'],['sign_top','sign-top'],['sign_bottom','sign-bottom'],['cash_text','cash-total']]) {
      await drag('#'+id,32,16);
      const changed = await run(`({key:document.querySelector('#builder-item').value,x:Number(document.querySelector('#module-x').value),y:Number(document.querySelector('#module-y').value)})`);
      assert.equal(changed.key,key,name+': '+id+'可选中'); assert.ok(changed.x>0&&changed.y>0,name+': '+id+'可移动');
    }
    await run(`document.querySelector('#builder-item').value='sign_title';document.querySelector('#builder-item').dispatchEvent(new Event('change'))`);
    const wheel = await center('#sign-title');
    win.webContents.sendInputEvent({type:'mouseMove',...wheel}); await delay(100);
    win.webContents.sendInputEvent({type:'mouseWheel',...wheel,deltaY:-80,deltaX:0});
    await waitFor(()=>run(`Number(document.querySelector('#module-scale').value)!==100`),'文字滚轮缩放');
    await shot(name+'-搭建');
    await run(`document.querySelector('#noodle-save').click()`);
    await waitFor(()=>run(`document.querySelector('#builder-fields').hidden`),'保存场景');
    const saved = structuredClone(runtime.noodle.config.layout);
    for(const key of ['chef','stats','gift_rule','thief_board','sign_title','sign_top','sign_bottom','cash_text'])assert.ok(saved.props[key].x>0,name+': 已保存 '+key);
    await waitFor(()=>run(`!document.querySelector('[data-shop-test="thief"]').disabled`),'保存后礼物按钮恢复');
    await run(`document.querySelector('[data-shop-test="thief"]').click()`);
    await waitFor(()=>runtime.noodle.balance===590,'偷钱匣');
    await waitFor(()=>run(`document.querySelector('#noodle-frame').contentDocument.querySelector('#thief-board-list').textContent.includes('元')`),'榜单显示');
    if(name==='汉堡店') {
      const act=(action,args={})=>runtime.noodle.action({action,revision:runtime.noodle.revision,...args});
      await act('burger_bake');runtime.noodle.cooking[0].ready_at=Date.now()-1;
      await act('burger_take_bun',{batch_id:runtime.noodle.cooking[0].id});
      const item=runtime.noodle.objects.find(o=>o.bun);
      for(const kind of ['ketchup','salad','mayo']) {
        await waitFor(()=>run(`!!document.querySelector('#noodle-frame').contentDocument.querySelector('[data-object-id="${item.id}"]')`),'面包显示');
        const target=await center(`[data-object-id="${item.id}"]`), source=await center('#burger-'+kind);
        await drag('#burger-'+kind,target.x-source.x,target.y-source.y);
        await waitFor(()=>item.toppings.includes(kind),'添加酱料 '+kind);
      }
      await act('burger_grill');const batch=runtime.noodle.cooking.at(-1);batch.ready_at=Date.now()-1;
      await act('burger_patty',{bowl_id:item.id,batch_id:batch.id});await act('burger_close',{bowl_id:item.id});
      await waitFor(()=>run(`document.querySelector('#noodle-frame').contentDocument.querySelectorAll('.layer-ketchup_layer,.layer-salad_layer,.layer-mayo_layer').length===3`),'三种酱料图层');
    }
    await win.loadURL(runtime.url+'/?verify='+Date.now()+'#noodle');
    await waitFor(()=>run(`document.querySelector('#noodle-frame')?.contentDocument?.querySelector('#cash-balance')?.textContent==='590 元'`),'刷新持久化');
    assert.deepEqual(runtime.noodle.config.layout,saved);
    const visible = await run(`(()=>{const d=document.querySelector('#noodle-frame').contentDocument;return ['game-stats','gift-rule','thief-board'].every(id=>getComputedStyle(d.getElementById(id)).display!=='none'&&d.getElementById(id).getBoundingClientRect().width>0)})()`);
    assert.equal(visible,true,name+'显示牌和榜单可见');
    await waitFor(()=>run(`Array.from(document.querySelector('#noodle-frame').contentDocument.images).filter(img=>img.getClientRects().length&&!img.closest('[hidden]')).every(img=>img.complete&&img.naturalWidth)`),'图片加载');
    const slot=({burger:'griddle','jasmine-latte':'coffee_machine'})[runtime.noodle.template().workflow] || 'pot';
    assert.equal(await run(`document.querySelector('#noodle-frame').contentDocument.querySelector('#game-noodles>img').getAttribute('src')`),runtime.noodle.template().assets[slot]);
    await shot(name+'-完成');
    results.push({name,passed:true,balance:runtime.noodle.balance,layout:saved.props});
  }
  scene = new BrowserWindow({show:false,width:1280,height:720,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  for(const layer of ['background','counter','customers']) {
    await scene.loadURL(runtime.url+'/noodle/?layer='+layer);
    await waitFor(()=>scene.webContents.executeJavaScript(`document.querySelector('#cash-balance').textContent==='590 元'`),'独立输出 '+layer);
    const actual=await scene.webContents.executeJavaScript(`document.querySelector('#sign-title').style.transform`);
    const item=runtime.noodle.config.layout.props.sign_title;
    assert.equal(actual,`translate(${item.x}px, ${item.y}px) scale(${item.scale})`);
  }
  await scene.loadURL(runtime.url+'/noodle/');
  await waitFor(()=>scene.webContents.executeJavaScript(`document.querySelector('#cash-balance').textContent==='590 元'&&Array.from(document.images).filter(img=>img.getClientRects().length&&!img.closest('[hidden]')).every(img=>img.complete&&img.naturalWidth)`),'独立画面素材');
  await shot('独立画面',scene);
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'artifacts','v2.5.6-界面验证.json'),JSON.stringify({passed:true,packageRoot,results,errors},null,2));
  console.log('五种模板手、牌子、文字真实拖拽，文字滚轮缩放、偷钱榜单、三种酱料、保存与独立输出验证通过');
}).catch(async error=>{console.error(error);if(win)await shot('失败');process.exitCode=1;}).finally(async()=>{scene?.destroy();win?.destroy();await runtime?.close();app.exit(process.exitCode||0);});
