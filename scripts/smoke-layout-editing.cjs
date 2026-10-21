const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'), packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const {NoodleShop}=require(path.join(packageRoot,'lib/noodle.cjs'));
let runtime,win,scene;
const errors=[],results=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.on('window-all-closed',()=>{});
app.setPath('userData',path.join(root,'work','layout-edit-browser-'+process.pid));
const run=code=>win.webContents.executeJavaScript(code);
const doc=`document.querySelector('#noodle-frame').contentDocument`;
async function waitFor(check,label){const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await delay(40);}throw Error('界面验证超时：'+label);}
async function paint(){await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);}
async function field(id,value,event='input'){await run(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('${event}'))`);await delay(60);}
async function rect(selector){return run(`(()=>{const f=document.querySelector('#noodle-frame').getBoundingClientRect(),r=${doc}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:f.x+r.x,y:f.y+r.y,right:f.x+r.right,bottom:f.y+r.bottom,width:r.width,height:r.height}})()`);}
async function drag(selector,dx,dy){
  await paint();const r=await rect(selector),p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
  win.webContents.sendInputEvent({type:'mouseMove',...p});await delay(30);
  win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});
  for(let i=1;i<=8;i++){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(p.x+dx*i/8),y:Math.round(p.y+dy*i/8),button:'left'});await delay(15);}
  win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(p.x+dx),y:Math.round(p.y+dy),button:'left',clickCount:1});await delay(100);
}
async function shot(name,crop){await paint();await fs.writeFile(path.join(root,'artifacts','v2.6.2-'+name+'.png'),(await win.webContents.capturePage(crop)).toPNG());}
app.whenReady().then(async()=>{
  const dir=await fs.mkdtemp(path.join(root,'work','layout-edit-smoke-'));
  runtime=await startServer({dataDir:dir,seedDir:path.join(packageRoot,'data')});
  const shop=runtime.noodle,template=await shop.templates.install(JSON.parse(await fs.readFile(path.join(root,'artifacts','美式汉堡店-v1.0.3.luobo'),'utf8')));
  await shop.action({action:'preset_create',name:'汉堡店',template_id:template.id});await shop.action({action:'start'});
  for(let i=1;i<=10;i++)await shop.shopAction('praise',i,{uid:i,user:'汉堡常客'+i});
  win=new BrowserWindow({show:false,width:1582,height:1000,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  await win.loadURL(runtime.url+'/#overtime');
  await waitFor(()=>run(`document.querySelectorAll('.nav-item').length===9&&document.querySelector('[data-view="overtime"]').classList.contains('active')&&document.querySelector('[data-view="noodle"]').textContent.includes('汉堡')`),'九个入口载入');
  for(const width of [1582,1280,1024,760,480]){
    win.setContentSize(width,1000);await delay(150);await paint();
    const nav=await run(`(()=>{const n=document.querySelector('.nav'),r=n.getBoundingClientRect(),buttons=[...n.querySelectorAll('.nav-item')].filter(b=>b.parentElement===n),brand=document.querySelector('.brand').getBoundingClientRect(),actions=document.querySelector('.top-actions').getBoundingClientRect();return {width:innerWidth,left:r.left,right:r.right,top:r.top,bottom:r.bottom,brandBottom:brand.bottom,actionsBottom:actions.bottom,rows:new Set(buttons.map(b=>Math.round(b.getBoundingClientRect().top))).size,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,allLabels:buttons.every(b=>getComputedStyle(b).whiteSpace==='nowrap')}})()`);
    assert.equal(nav.rows,1);assert.ok(nav.allLabels);assert.ok(nav.left>=0&&nav.right<=width+1,'导航在窗口内');
    assert.ok(nav.scrollWidth<=nav.clientWidth+1,'多余入口折叠，无需横向滚动');
    if(width<=1100)assert.ok(nav.top>=Math.max(nav.brandBottom,nav.actionsBottom),'窄窗口导航与品牌工具分两行');
    results.push(nav);
    if(width===1582)await shot('顶部导航-桌面',{x:0,y:0,width,height:170});
    if(width===480){await run(`document.querySelector('#nav-more').open=true`);await shot('顶部导航-窄窗口',{x:0,y:0,width,height:420});await run(`document.querySelector('.nav [data-view="gifts"]').click()`);await waitFor(()=>run(`!document.querySelector('#gifts-view').hidden`),'礼物库入口可用');}
  }
  await run(`document.querySelector('#theme-button').click()`);assert.equal(await run(`document.body.classList.contains('dark')`),true);await shot('顶部导航-深色',{x:0,y:0,width:480,height:320});
  await run(`document.querySelector('#theme-button').click()`);
  win.setContentSize(1700,1150);await run(`document.querySelector('[data-view="noodle"]').click();window.scrollTo(0,0)`);
  await waitFor(()=>run(`!document.querySelector('#noodle-view').hidden&&${doc}?.querySelector('#thief-board')?.style.width==='220px'`),'紧凑默认榜单');
  const original=structuredClone(shop.config.layout);
  await run(`document.querySelector('#noodle-build').click()`);await waitFor(()=>run(`${doc}.body.classList.contains('building')`),'场景搭建');
  await field('builder-item','','change');await run(`document.querySelector('[data-select-module="customers"]').click()`);await field('module-scale',80);
  await field('builder-item','thief_board','change');await field('module-scale',120);await field('module-x',200);await field('module-y',-60);
  assert.equal(await run(`document.querySelector('#board-size-fields').hidden`),false);
  for(const edge of ['e','s','w','n','se','nw','ne','sw']){
    const before=await rect('#thief-board'),dx=edge.includes('w')?-20:edge.includes('e')?20:0,dy=edge.includes('n')?-20:edge.includes('s')?20:0;
    await drag(`[data-board-resize="${edge}"]`,dx,dy);const after=await rect('#thief-board');
    if(dx)assert.ok(after.width>before.width+15,edge+'改变宽度');else assert.ok(Math.abs(after.width-before.width)<1);
    if(dy)assert.ok(after.height>before.height+15,edge+'改变高度');else assert.ok(Math.abs(after.height-before.height)<1);
    if(edge.includes('w'))assert.ok(Math.abs(after.right-before.right)<2,edge+'右边固定');
    if(edge.includes('n'))assert.ok(Math.abs(after.bottom-before.bottom)<2,edge+'下边固定');
  }
  assert.deepEqual(shop.config.layout,original,'未保存不写入配置');
  await shot('榜单-自由拖动宽高');await run(`document.querySelector('#noodle-cancel').click()`);
  await waitFor(()=>run(`!${doc}.body.classList.contains('building')&&${doc}.querySelector('#thief-board').style.width==='220px'`),'取消还原尺寸');
  await run(`document.querySelector('#noodle-build').click()`);await waitFor(()=>run(`${doc}.body.classList.contains('building')`),'再次编辑');
  await field('builder-item','thief_board','change');await field('board-width',340);await field('board-height',230);await field('module-x',100);
  await drag('[data-board-resize="se"]',20,15);
  const expected=await run(`({width:Number(document.querySelector('#board-width').value),height:Number(document.querySelector('#board-height').value)})`);
  await run(`document.querySelector('#noodle-save').click()`);await waitFor(()=>shop.config.layout.props.thief_board.width===expected.width,'保存宽高');
  await waitFor(()=>run(`!${doc}.body.classList.contains('building')`),'退出搭建');
  assert.equal(shop.config.layout.props.thief_board.height,expected.height);
  assert.deepEqual((await new NoodleShop(dir,shop.templates).init()).config.layout,shop.config.layout,'重启持久保存');
  scene=new BrowserWindow({show:false,width:1280,height:720,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}});
  await scene.loadURL(runtime.url+'/noodle/?layer=customers');
  await waitFor(()=>scene.webContents.executeJavaScript(`document.querySelector('#thief-board').style.width==='${expected.width}px'&&document.querySelector('#thief-board').style.height==='${expected.height}px'`),'顾客层宽高同步');
  shop.leaderboard={page:1,at:Date.now(),interval:8000};shop.publish();
  await waitFor(()=>run(`${doc}.querySelector('#thief-board').dataset.page==='1'`),'评价榜');
  const list=await rect('#thief-board-list'),point={x:Math.round(list.x+list.width/2),y:Math.round(list.y+list.height/2)};
  win.webContents.sendInputEvent({type:'mouseMove',...point});await delay(100);win.webContents.sendInputEvent({type:'mouseWheel',...point,deltaY:-500,deltaX:0});
  await waitFor(()=>run(`${doc}.querySelector('#thief-board-list').scrollTop>0`),'缩小后的榜单真实滚动');
  await shot('榜单-紧凑布局');
  const loaded=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));win.reload();await loaded;
  await waitFor(()=>run(`!document.querySelector('#noodle-view').hidden&&${doc}?.querySelector('#thief-board')?.style.width==='${expected.width}px'`),'刷新保留宽高');
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(root,'artifacts','v2.6.2-布局编辑验证.json'),JSON.stringify({passed:true,packageRoot,nav:results,resize:expected,errors},null,2));
  console.log('八入口导航五档窗口/深浅色、榜单八方向真实拖拽、模块及榜单缩放换算、取消、保存、重启、输出同步和滚动通过');
}).catch(async error=>{console.error(error);if(win)await shot('布局编辑-失败');process.exitCode=1;}).finally(async()=>{scene?.destroy();win?.destroy();await runtime?.close();app.exit(process.exitCode||0);});
