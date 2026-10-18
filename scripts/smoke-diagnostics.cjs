const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const {createDiagnostics}=require(path.join(packageRoot,'lib','diagnostics.cjs'));
const {monitorDesktop}=require(path.join(packageRoot,'lib','desktop-diagnostics.cjs'));
const output=path.join(root,'artifacts','diagnostics-desktop.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let runtime,diagnostics,stopMonitoring,win,dir;
async function waitFor(check){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await check())return;await delay(50);}throw new Error('诊断验证超时');}
async function logs(){await diagnostics.flush();let text='';for await(const chunk of diagnostics.export())text+=chunk;return text;}
app.whenReady().then(async()=>{
  dir=await fs.mkdtemp(path.join(root,'work','diagnostics-desktop-'));
  diagnostics=createDiagnostics(dir,{heartbeatMs:100,stallMs:500});await diagnostics.ready;
  stopMonitoring=monitorDesktop(app,diagnostics,{intervalMs:100,stallMs:400});
  let opened=false;
  runtime=await startServer({dataDir:dir,seedDir:path.join(packageRoot,'data'),diagnostics,openLogs:async target=>{assert.equal(target,diagnostics.logDir);opened=true;}});
  win=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
  await win.loadURL(runtime.url);
  await win.webContents.executeJavaScript(`document.querySelector('#settings-button').click()`);
  await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#diagnostics-status').textContent.includes('日志已开启')`));
  await win.webContents.executeJavaScript(`document.querySelector('#diagnostics-open').click()`);
  await waitFor(()=>opened);
  const dialogState=await win.webContents.executeJavaScript(`(()=>{const d=document.querySelector('#settings-dialog'),r=d.getBoundingClientRect();return {open:d.open,width:r.width,height:r.height,display:getComputedStyle(d).display}})()`);
  assert.ok(dialogState.open&&dialogState.width>0,JSON.stringify(dialogState));
  await delay(150);
  await fs.writeFile(path.join(root,'artifacts','diagnostics-settings.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`setTimeout(()=>{throw new Error('diagnostics-ui-smoke https://example.com/?token=smoke-private')},0);void Promise.reject(new Error('diagnostics-promise-smoke'))`);
  await delay(200);
  const block=win.webContents.executeJavaScript(`(()=>{const end=performance.now()+3500;while(performance.now()<end){}return true})()`);
  await delay(900);
  const whileFrozen=await logs();
  assert.ok(whileFrozen.includes('renderer.probe_timeout'),'渲染器卡住时未写日志');
  await block;await delay(1300);
  diagnostics.context({operation:'smoke.block_main'});await diagnostics.flush();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
  assert.ok(require('node:fs').readFileSync(path.join(diagnostics.logDir,'console.log'),'utf8').includes('main.unresponsive'));
  await delay(200);
  win.webContents.forcefullyCrashRenderer();
  await delay(300);
  const exported=await fetch(runtime.url+'/api/diagnostics/export');assert.equal(exported.status,200);
  const text=await exported.text();
  for(const event of ['client.runtime_error','client.promise_error','client.page_stall','renderer.probe_recovered','main.unresponsive','main.responsive','renderer.gone'])assert.ok(text.includes(event),event+' 未记录');
  assert.equal(text.includes('smoke-private'),false);
  const result={version:require(path.join(packageRoot,'package.json')).version,rendererStallRecordedWhileFrozen:true,mainStallRecordedWhileFrozen:true,rendererCrashRecorded:true,frontendErrorsRecorded:true,credentialsRedacted:true,logDirectoryButton:true,exportedBytes:Buffer.byteLength(text)};
  await fs.writeFile(output,JSON.stringify(result,null,2));
  await fs.writeFile(path.join(root,'artifacts','diagnostics-smoke.log'),text);
}).catch(async error=>{process.exitCode=1;await fs.writeFile(output,JSON.stringify({error:error.stack},null,2));}).finally(async()=>{
  stopMonitoring?.();if(win&&!win.isDestroyed())win.destroy();await runtime?.close();await diagnostics?.close();
  if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(root,'work')+path.sep+'diagnostics-desktop-'));await fs.rm(dir,{recursive:true,force:true});}
  app.exit(process.exitCode||0);
});
