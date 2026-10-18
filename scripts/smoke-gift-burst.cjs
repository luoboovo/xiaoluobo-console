const {app,BrowserWindow} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname,'..');
const packageRoot = process.env.LUOBO_SMOKE_PACKAGE || root;
const { startServer } = require(path.join(packageRoot,'server.cjs'));
const {createDiagnostics}=require(path.join(packageRoot,'lib','diagnostics.cjs'));
const output = path.join(root,'artifacts',process.env.LUOBO_SMOKE_REPORT || 'gift-burst-desktop.json');
const orderCount = Number(process.env.LUOBO_SMOKE_ORDERS || 2000), tipCount = Number(process.env.LUOBO_SMOKE_TIPS || 1000), viewers = Number(process.env.LUOBO_SMOKE_VIEWERS || 20);
let runtime, dataDir, diagnostics;
const windows = [], errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function waitFor(win,condition) {
  const deadline = Date.now()+10000;
  while (Date.now()<deadline) {
    if (await win.webContents.executeJavaScript(condition)) return;
    await delay(50);
  }
  throw new Error('桌面画面未及时更新：' + condition);
}
async function windowFor(url,condition) {
  const win = new BrowserWindow({show:false,width:1280,height:800,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  windows.push(win);
  win.webContents.on('render-process-gone',(_event,details) => errors.push(details.reason));
  await win.loadURL(url); await waitFor(win,condition);
  await win.webContents.executeJavaScript(`window.burstLag=0;window.burstTick=performance.now();setInterval(()=>{const now=performance.now();window.burstLag=Math.max(window.burstLag,now-window.burstTick-16);window.burstTick=now},16)`);
  return win;
}
app.whenReady().then(async () => {
  dataDir = await fs.mkdtemp(path.join(root,'work','gift-desktop-'));
  diagnostics=createDiagnostics(dataDir);await diagnostics.ready;
  runtime = await startServer({dataDir,seedDir:path.join(packageRoot,'data'),diagnostics});
  runtime.noodle.mode = 'running';
  Object.assign(runtime.noodle.config,{gift_id:90001,water_gift:null,tip_gift:{gift_id:90002,gift_name:'打赏'}});
  runtime.overtime.clock = () => 0;
  await runtime.overtime.action({action:'configure',config:{initial_text:'60',time_unit:'分钟',gift_rules:[
    {gift_id:90001,gift_name:'压力礼物',operation:'add',value:1},
    {gift_id:90002,gift_name:'打赏',operation:'add',value:1}
  ]}});
  await runtime.overtime.action({action:'start'});
  const main = await windowFor(runtime.url,"document.querySelector('#app-version')?.textContent.includes('v')");
  const scene = await windowFor(runtime.url+'/noodle/',"document.querySelector('#game-queue')?.textContent === '0'");
  const buttonDelays = [];
  const controls = (async () => {
    for (let i=0;i<12;i++) {
      const start = performance.now();
      const opened = await main.webContents.executeJavaScript(`document.querySelector('#settings-button').click();document.querySelector('#settings-dialog').open`);
      buttonDelays.push(Math.round(performance.now()-start));
      assert.equal(opened,true);
      await main.webContents.executeJavaScript(`document.querySelector('#settings-dialog').close()`);
      await delay(50);
    }
  })();
  const begin = performance.now();
  for (let i=0;i<orderCount;i++) runtime.services.addGift({giftId:90001,giftName:'压力礼物',count:1,uid:i%viewers+1,user:'观众'+(i%viewers),transactionId:'queue-'+i});
  for (let i=0;i<tipCount;i++) runtime.services.addGift({giftId:90002,giftName:'打赏',count:1,uid:i%viewers+1,user:'观众'+(i%viewers),transactionId:'tip-'+i});
  const response = await fetch(runtime.url+'/api/overtime/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});
  assert.equal(response.status,200);
  const settlementMs = Math.round(performance.now()-begin);
  await waitFor(main,`document.querySelector('#received-gift-count').textContent === '${orderCount+tipCount}'`);
  await waitFor(scene,`document.querySelector('#game-queue').textContent === '${Math.min(orderCount,2000)}' && document.querySelector('#workspace-objects').children.length === ${Math.min(tipCount,500)}`);
  await controls;
  const people = runtime.overtime.state.people.length;
  await waitFor(main,`document.querySelector('#overtime-people-page')?.textContent.includes('共 ${people.toLocaleString()} 人')`);
  const visiblePeople = await main.webContents.executeJavaScript(`document.querySelector('#overtime-people').children.length`);
  assert.equal(visiblePeople,Math.min(people,100));
  if (people>100) {
    await main.webContents.executeJavaScript(`document.querySelector('#overtime-people-next').click()`);
    assert.equal(await main.webContents.executeJavaScript(`document.querySelector('#overtime-people small').textContent`),'UID 101');
    await main.webContents.executeJavaScript(`document.querySelector('#overtime-people-prev').click()`);
    assert.equal(await main.webContents.executeJavaScript(`document.querySelector('#overtime-people small').textContent`),'UID 1');
  }
  const result = {version:require(path.join(packageRoot,'package.json')).version,messages:orderCount+tipCount,viewers,visiblePeople,settlementMs,queuedCustomers:runtime.noodle.queue.length,coins:runtime.noodle.objects.length,remaining:runtime.overtime.remaining().toString(),mainLagMs:Math.round(await main.webContents.executeJavaScript('window.burstLag')),sceneLagMs:Math.round(await scene.webContents.executeJavaScript('window.burstLag')),maxButtonDelayMs:Math.max(...buttonDelays),renderErrors:errors};
  assert.equal(result.remaining,String(3600+(orderCount+tipCount)*60));
  assert.equal(result.queuedCustomers,Math.min(orderCount,2000)); assert.equal(result.coins,Math.min(tipCount,500));
  await fs.writeFile(output,JSON.stringify(result,null,2));
  assert.ok(result.mainLagMs<250 && result.sceneLagMs<1000 && result.maxButtonDelayMs<500,JSON.stringify(result));
  assert.deepEqual(errors,[]);
  await fs.writeFile(output,JSON.stringify(result,null,2));
  await fs.writeFile(path.join(root,'artifacts','gift-burst-desktop.png'),(await scene.webContents.capturePage()).toPNG());
  await main.webContents.executeJavaScript(`document.querySelector('#overtime-people-pages').scrollIntoView({block:'center'})`);
  await delay(100);
  await fs.writeFile(path.join(root,'artifacts','console-statistics-paging.png'),(await main.webContents.capturePage()).toPNG());
}).catch(async error => {
  await fs.writeFile(output,JSON.stringify({error:error.stack},null,2)); process.exitCode=1;
}).finally(async () => {
  for (const win of windows) win.destroy();
  await runtime?.close();
  await diagnostics?.close();
  if (dataDir) {
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(root,'work')+path.sep+'gift-desktop-'));
    await fs.rm(dataDir,{recursive:true,force:true});
  }
  app.exit(process.exitCode || 0);
});
