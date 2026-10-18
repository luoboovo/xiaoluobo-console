const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname,'..'), packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
const { startServer } = require(path.join(packageRoot,'server.cjs'));
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
let runtime, win;
const errors=[];
app.on('window-all-closed',()=>{});
app.setPath('userData',path.join(root,'work','burger-browser-'+process.pid));
async function waitFor(check) { const end=Date.now()+12000; while(Date.now()<end){ if(await check())return; await delay(40); } throw Error('汉堡界面验证超时'); }
async function center(selector) { return win.webContents.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`); }
async function click(selector) { const p=await center(selector); win.webContents.sendInputEvent({type:'mouseMove',...p}); win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1});await delay(120); }
async function drag(from,to) {
  const a=await center(from),b=await center(to);
  win.webContents.sendInputEvent({type:'mouseMove',...a});win.webContents.sendInputEvent({type:'mouseDown',...a,button:'left',clickCount:1});
  for(let i=1;i<=12;i++){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(a.x+(b.x-a.x)*i/12),y:Math.round(a.y+(b.y-a.y)*i/12),button:'left'});await delay(15);}
  if(['#burger-ketchup','#burger-salad','#burger-mayo'].includes(from)){const ghost=await win.webContents.executeJavaScript(`({source:document.querySelector('#burger-ghost>img')?.src,bottle:document.querySelector(${JSON.stringify(from+' img')}).src})`);assert.equal(ghost.source,ghost.bottle);}
  win.webContents.sendInputEvent({type:'mouseUp',...b,button:'left',clickCount:1});await delay(150);
}
async function shot(name){win.webContents.sendInputEvent({type:'mouseMove',x:1270,y:50});await delay(250);await fs.writeFile(path.join(root,'artifacts','v2.5.7-汉堡店-'+name+'.png'),(await win.webContents.capturePage()).toPNG());}
async function keyboard(selector){const prevented=await win.webContents.executeJavaScript(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});el.dispatchEvent(event);if(!event.defaultPrevented)el.click();return event.defaultPrevented})()`);assert.equal(prevented,false);}
app.whenReady().then(async()=>{
  const dir=await fs.mkdtemp(path.join(root,'work','burger-smoke-'));
  runtime=await startServer({dataDir:dir,seedDir:path.join(packageRoot,'data')});
  const source=JSON.parse(await fs.readFile(path.join(root,'artifacts',process.env.LUOBO_BURGER_TEMPLATE||'美式汉堡店-v1.0.3.luobo'),'utf8'));
  const template=await runtime.noodle.templates.install(source);
  await runtime.noodle.action({action:'preset_create',name:'美式汉堡店',template_id:template.id});
  await runtime.noodle.action({action:'save',config:{...runtime.noodle.config,cook_seconds:2}});
  await runtime.noodle.action({action:'start'});await runtime.noodle.action({action:'demo_noodles'});
  win=new BrowserWindow({show:false,width:1280,height:720,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  await win.loadURL(runtime.url+'/noodle/');
  await waitFor(()=>win.webContents.executeJavaScript(`document.body.classList.contains('burger')&&!document.querySelector('#bowl-rack').disabled&&Array.from(document.querySelectorAll('.burger-tool img,.counter>img,#game-noodles>img,#game-sauce>img,#template-background')).every(img=>img.complete&&img.naturalWidth)`));
  const bottles=await win.webContents.executeJavaScript(`['ketchup','salad','mayo'].map(kind=>{const image=document.querySelector('#burger-'+kind+'>img'),mustard=document.querySelector('#burger-mustard>img');return {kind,sameSource:image.src===mustard.src,sameSize:image.naturalWidth===mustard.naturalWidth&&image.naturalHeight===mustard.naturalHeight,sameDisplaySize:Math.abs(image.getBoundingClientRect().width-mustard.getBoundingClientRect().width)<.1&&Math.abs(image.getBoundingClientRect().height-mustard.getBoundingClientRect().height)<.1,filter:getComputedStyle(image).filter,mustardFilter:getComputedStyle(mustard).filter,width:image.naturalWidth,height:image.naturalHeight}})`);
  for(const bottle of bottles){assert.equal(bottle.sameSource,false);assert.equal(bottle.sameSize,true);assert.equal(bottle.sameDisplaySize,true);assert.equal(bottle.filter,bottle.mustardFilter);assert.ok(bottle.width>0&&bottle.height>0);}
  win.webContents.focus(); await shot('空场景');
  await drag('#bowl-rack','#game-sauce'); await waitFor(()=>runtime.noodle.cooking.length===1);
  await drag('#burger-raw','#game-noodles'); await waitFor(()=>runtime.noodle.cooking.length===2);
  await shot('烘烤与煎制'); await delay(2100);
  await click('#game-sauce'); await waitFor(()=>runtime.noodle.objects.some(o=>o.bun));
  const item=runtime.noodle.objects.find(o=>o.bun),selector=`[data-object-id="${item.id}"]`;
  await waitFor(()=>win.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`));
  for(const topping of ['tomato','lettuce','cheese','mustard','ketchup','salad','mayo']){await drag('#burger-'+topping,selector);await waitFor(()=>item.toppings.includes(topping));}
  await drag('#game-noodles',selector); await waitFor(()=>item.patty);
  await shot('加料组装');await drag('#burger-top',selector);await waitFor(()=>item.closed);
  await shot('完整汉堡');
  const broken=await win.webContents.executeJavaScript(`Array.from(document.images).filter(img=>img.getClientRects().length&&getComputedStyle(img).visibility!=='hidden'&&!img.hidden&&img.closest('[hidden]')===null&&(!img.complete||!img.naturalWidth)).map(img=>img.src)`);
  assert.deepEqual(broken,[]);
  await drag(selector,'[data-customer-id]');await waitFor(()=>runtime.noodle.served===1);
  const coin=runtime.noodle.objects.find(o=>o.kind==='coin'); assert.ok(coin);
  await drag(`[data-object-id="${coin.id}"]`,'#cash-box');await waitFor(()=>runtime.noodle.balance===100);
  await shot('出餐收钱');
  await keyboard('#bowl-rack');
  await waitFor(()=>runtime.noodle.cooking.some(o=>o.food==='bun'));
  await delay(2100);await keyboard('#game-sauce');
  await waitFor(()=>runtime.noodle.objects.some(o=>o.bun));
  for(const kind of ['egg','leaf','cockroach']){
    if(!runtime.noodle.objects.some(o=>o.bun)){
      await keyboard('#bowl-rack');await delay(2100);await keyboard('#game-sauce');
      await waitFor(()=>runtime.noodle.objects.some(o=>o.bun));
    }
    const burger=runtime.noodle.objects.find(o=>o.bun),sel=`[data-object-id="${burger.id}"]`;
    await waitFor(()=>win.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(sel)})`));
    await click('#burger-cheese');await waitFor(()=>burger.toppings.includes('cheese'));
    await runtime.noodle.action({action:'test_throw',kind});const litter=runtime.noodle.throws.at(-1),bug=`[data-throw-id="${litter.id}"]`;
    await waitFor(()=>win.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(bug)})`));await delay(1000);
    if(kind==='cockroach'){
      const before=await center(bug);await delay(450);const after=await center(bug);assert.ok(Math.hypot(before.x-after.x,before.y-after.y)>1);
      assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.cockroach-walk')).animationName`),'cockroach-steps');
      await shot('可爱蟑螂爬行');
    }
    await drag(bug,sel);await waitFor(()=>burger.spoiled);assert.deepEqual(burger.contaminants,[kind]);
    assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(sel+' .burger-result')})`),false);
    await drag('#burger-top',sel);await waitFor(()=>burger.closed);
    const alt=kind==='cockroach'?'蟑螂汉堡':'脏脏汉堡';
    await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(sel+' .burger-result')})?.alt===${JSON.stringify(alt)}`));
    await shot(alt+'-'+kind);
    await runtime.noodle.action({action:'demo_noodles'});await waitFor(()=>win.webContents.executeJavaScript(`!!document.querySelector('[data-customer-id]')`));
    await drag(sel,'[data-customer-id]');await waitFor(()=>!runtime.noodle.objects.some(o=>o.id===burger.id));
  }
  assert.equal(runtime.noodle.served,1);assert.equal(runtime.noodle.balance,-200);
  await win.loadURL(runtime.url+'/#noodle');
  await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#cockroach-gift-setting')?.hidden===false`));
  await win.webContents.executeJavaScript(`document.querySelector('[data-throw-test="cockroach"]').scrollIntoView({block:'center'})`);
  await click('[data-throw-test="cockroach"]');await waitFor(()=>runtime.noodle.throws.some(o=>o.kind==='cockroach'));await shot('丢蟑螂按钮');
  await win.loadURL(runtime.url+'/#presets');
  await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#preset-list')?.textContent.includes('汉堡店')&&document.querySelector('#template-list')?.textContent.includes('烤面包')`));
  await shot('控制台');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'artifacts','v2.5.7-汉堡店-验证.json'),JSON.stringify({passed:true,packageRoot,served:runtime.noodle.served,balance:runtime.noodle.balance,assets:26,errors,checks:['先放配料后放肉饼','正常汉堡出餐收钱','鸡蛋/菜叶先放进去仍可盖面包','盖好前不显示特殊成品','脏脏汉堡和蟑螂汉堡图片','两种脏餐按错餐扣钱','蟑螂真实爬行与四帧动画','拖入汉堡消费投掷物','丢蟑螂按钮','模板管理界面']},null,2));
  console.log('汉堡真实鼠标操作、图片加载与控制台验证通过');
}).catch(async error=>{console.error(error);if(win)await shot('失败诊断');process.exitCode=1;}).finally(async()=>{if(win){await win.loadURL('about:blank');win.destroy();}await runtime?.close();app.exit(process.exitCode||0);});
