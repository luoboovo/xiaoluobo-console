const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const {monitorDesktop}=require(path.join(packageRoot,'lib/desktop-diagnostics.cjs'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.setPath('userData',path.join(root,'work','recovery-profile-'+process.pid));
app.on('window-all-closed',()=>{});
let runtime,window,dir,stop;
app.whenReady().then(async()=>{
  dir=await fs.mkdtemp(path.join(root,'work','recovery-smoke-'));
  runtime=await startServer({dataDir:dir});
  await runtime.noodle.action({action:'preset_create',name:'恢复测试',template_id:'saozi'});
  await runtime.noodle.action({action:'start'});
  await runtime.noodle.action({action:'demo_noodles'});
  const events=[];
  stop=monitorDesktop(app,{log:(level,event,data)=>events.push({level,event,data})});
  window=new BrowserWindow({show:false,width:1280,height:720,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await window.loadURL(runtime.url+'/noodle/');
  const ready=()=>window.webContents.executeJavaScript('document.querySelectorAll(".customer").length').catch(()=>0);
  for(let i=0;i<100&&!await ready();i++)await delay(50);
  const customers=await ready();assert.ok(customers>0);
  const crashed=new Promise(resolve=>window.webContents.once('render-process-gone',resolve));
  window.webContents.forcefullyCrashRenderer();await crashed;
  for(let i=0;i<100;i++){
    if(events.some(row=>row.event==='renderer.recovered')&&await ready()===customers)break;
    await delay(50);
  }
  assert.ok(events.some(row=>row.event==='renderer.recovered'),'渲染进程崩溃后没有恢复，画面一直白屏');
  assert.equal(await ready(),customers,'恢复后顾客数据丢失');
  assert.equal((await fetch(runtime.url+'/api/state')).status,200);
  console.log(JSON.stringify({recovered:true,customers,events:events.filter(row=>row.event.startsWith('renderer.'))}));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  stop?.();window?.destroy();await runtime?.close();
  if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(root,'work')+path.sep+'recovery-smoke-'));await fs.rm(dir,{recursive:true,force:true});}
  app.exit(process.exitCode||0);
});
