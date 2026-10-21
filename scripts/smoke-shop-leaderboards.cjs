const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root=path.join(__dirname,'..'), packageRoot=process.env.LUOBO_SMOKE_PACKAGE || root;
const { startServer }=require(path.join(packageRoot,'server.cjs'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const errors=[], results=[];
let runtime, win, scene, capture;
app.on('window-all-closed',()=>{});
app.setPath('userData',path.join(root,'work','leaderboards-browser-'+process.pid));
async function waitFor(check,label,timeout=12000) {
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await check())return;await delay(50);}
  throw Error('界面验证超时：'+label);
}
function window() {
  const win=new BrowserWindow({show:false,width:1280,height:720,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message);});
  return win;
}
const run=code=>scene.webContents.executeJavaScript(code);
const page=target=>target.webContents.executeJavaScript(`document.querySelector('#thief-board')?.dataset.page`);
async function click(direction) {
  await waitFor(()=>run(`!document.querySelector('[data-board-direction="${direction}"]').disabled`),'翻页按钮就绪');
  await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const p=await run(`(()=>{const r=document.querySelector('[data-board-direction="${direction}"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  const at=runtime.noodle.leaderboard.at;
  scene.webContents.sendInputEvent({type:'mouseMove',...p}); await delay(50);
  scene.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});
  await delay(30);
  scene.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1});
  await waitFor(()=>runtime.noodle.leaderboard.at!==at,'真实鼠标翻页生效',3000);
}
async function shot(name) {await delay(200);await fs.writeFile(path.join(root,'artifacts','v2.6.2-榜单-'+name+'.png'),(await scene.webContents.capturePage()).toPNG());}
app.whenReady().then(async()=>{
  const dir=await fs.mkdtemp(path.join(root,'work','leaderboards-smoke-'));
  const avatar=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW2QAAAAASUVORK5CYII=','base64');
  runtime=await startServer({dataDir:dir,seedDir:path.join(packageRoot,'data'),requestImpl:async()=>({body:avatar,headers:{}})});
  const shop=runtime.noodle;
  await shop.action({action:'start'});await shop.saveWallet(5000);
  const names=['常客小桃','番茄同学','萝卜粉丝','小熊饿了','吃饭冠军','夜宵来了','热面加辣','芝士爱好者','店铺老朋友','最后一口'];
  for(let i=0;i<10;i++) {
    const person={uid:i+1,user:names[i],face:`https://i0.hdslb.com/leader-${i}.png`};
    await shop.shopAction('praise',i+1,person);await shop.shopAction('review',i%3+1,person);
    shop.config.thief_min=shop.config.thief_max=(i+1)*10;await shop.steal(person);
    shop.enqueue(names[i],i+1,i+1,person.face,false);
    for(let n=0;n<=i;n++)await shop.help();
  }
  shop.theft=null;shop.departures=[];shop.lastServed=null;shop.objects=[];
  await shop.save({...shop.config,thief_min:10,thief_max:50});
  scene=window();capture=window();win=window();
  win.setContentSize(1700,1100);
  await win.loadURL(runtime.url+'/#noodle');
  await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#noodle-frame')?.contentDocument?.querySelector('#leaderboard-title')?.textContent`),'控制台预览');
  for(const [name,file] of [['臊子面馆',null],['刀削面馆','刀削面馆-v1.0.1.luobo'],['咖啡厅','咖啡厅模板-v1.0.2.luobo'],['麻辣香锅','麻辣香锅-v1.0.4.luobo'],['汉堡店','美式汉堡店-v1.0.3.luobo']]) {
    if(file){const template=await shop.templates.install(JSON.parse(await fs.readFile(path.join(root,'artifacts',file),'utf8')));await shop.action({action:'preset_create',name,template_id:template.id});}
    await shop.save({...shop.config,layout:{...shop.config.layout,props:{...shop.config.layout.props,thief_board:{x:10,y:10,scale:.85}}}});
    shop.leaderboard={page:0,at:Date.now(),interval:8000};shop.publish();
    await scene.loadURL(runtime.url+'/noodle/');await capture.loadURL(runtime.url+'/noodle/?layer=customers');
    await waitFor(async()=>await page(scene)==='0'&&await page(capture)==='0',name+'偷钱榜');
    const bounds=[];
    for(let i=0;i<3;i++) {
      await waitFor(async()=>await page(scene)===String(i)&&await page(capture)===String(i),name+'切页同步');
      const expected=['偷钱榜','好评差评榜','大胃袋榜'][i];
      assert.equal(await run(`document.querySelector('#leaderboard-title').textContent`),expected);
      assert.equal(await run(`document.querySelector('#thief-board-list').children.length`),10);
      await waitFor(()=>run(`Array.from(document.querySelectorAll('.leader-avatar img')).every(img=>img.complete&&img.naturalWidth)`),'观众头像');
      assert.equal(await run(`document.querySelectorAll('.leader-avatar img').length`),10);
      const rect=await run(`(()=>{const el=document.querySelector('#thief-board'),r=el.getBoundingClientRect(),list=el.querySelector('ol').getBoundingClientRect(),last=el.querySelector('li:last-child').getBoundingClientRect(),footer=el.querySelector('footer').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,noOverflow:list.bottom<=footer.top+1,scrollable:el.querySelector('ol').scrollHeight>el.querySelector('ol').clientHeight,transform:el.style.transform}})()`);
      assert.ok(rect.noOverflow,name+'名单区域不挤占页脚');assert.ok(rect.scrollable,name+'缩小榜单可滚动查看全部十名');assert.equal(rect.transform,'translate(10px, 10px) scale(0.85)');bounds.push([rect.x,rect.y,rect.width,rect.height]);
      await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#noodle-frame').contentDocument.querySelector('#thief-board').dataset.page==='${i}'`),'预览同步');
      if(name==='汉堡店')await shot(expected);
      await click(1);
    }
    assert.deepEqual(bounds[0],bounds[1]);assert.deepEqual(bounds[1],bounds[2]);
    await waitFor(async()=>await page(scene)==='0',name+'回到首页');
    await click(-1);await waitFor(async()=>await page(scene)==='2'&&await page(capture)==='2',name+'上一页循环');
    results.push({name,passed:true,bounds:bounds[0]});
  }
  const revision=shop.revision;
  await waitFor(async()=>await page(scene)==='0'&&await page(capture)==='0','真实8秒自动轮播',10000);
  assert.equal(shop.revision,revision);
  await click(1);await waitFor(async()=>await page(scene)==='1','手动切换后自动继续');
  await waitFor(async()=>await page(scene)==='2'&&await page(capture)==='2','翻页后重新8秒轮播',10000);
  await run(`document.querySelector('#thief-board-list .leader-avatar img').dispatchEvent(new Event('error'))`);
  assert.ok(await run(`document.querySelector('#thief-board-list .leader-avatar').textContent`),'头像加载失败有昵称首字兜底');
  await win.webContents.executeJavaScript(`document.querySelector('#noodle-build').click()`);
  await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#noodle-frame').contentDocument.body.classList.contains('building')`),'搭建模式');
  await win.webContents.executeJavaScript(`document.querySelector('#builder-item').value='thief_board';document.querySelector('#builder-item').dispatchEvent(new Event('change'));document.querySelector('#module-x').value='75';document.querySelector('#module-x').dispatchEvent(new Event('input'));document.querySelector('#noodle-save').click()`);
  await waitFor(()=>shop.config.layout.props.thief_board.x===75,'保存榜单位置');
  await waitFor(()=>run(`document.querySelector('#thief-board').style.transform==='translate(75px, 10px) scale(0.85)'`),'独立画面跟随位置');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(root,'artifacts','v2.6.2-榜单验证.json'),JSON.stringify({passed:true,packageRoot,results,errors},null,2));
  console.log('五种模板：头像昵称、十名不溢出、固定面板、手动前后翻页、8秒自动轮播、预览/独立/顾客层同步、保存位置验证通过');
}).catch(async error=>{console.error(error);if(scene)await shot('失败');process.exitCode=1;}).finally(async()=>{capture?.destroy();scene?.destroy();win?.destroy();await runtime?.close();app.exit(process.exitCode||0);});
