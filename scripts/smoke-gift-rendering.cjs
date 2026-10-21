const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.setPath('userData',path.join(root,'work','gift-render-profile-'+process.pid));app.on('window-all-closed',()=>{});
let runtime,win,dir;
async function waitFor(check){for(let i=0;i<100;i++){if(await check())return;await delay(50);}throw Error('并发送礼画面验证超时');}
app.whenReady().then(async()=>{
  dir=await fs.mkdtemp(path.join(root,'work','gift-render-'));
  runtime=await startServer({dataDir:dir});
  const template=await runtime.noodle.templates.install(JSON.parse(await fs.readFile(path.join(root,'artifacts/美式汉堡店-v1.0.3.luobo'),'utf8')));
  await runtime.noodle.action({action:'preset_create',name:'并发贴图测试',template_id:template.id});await runtime.noodle.action({action:'start'});
  win=new BrowserWindow({show:false,width:1280,height:720,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
  await win.loadURL(runtime.url+'/noodle/');const ui=code=>win.webContents.executeJavaScript(code);
  await waitFor(()=>ui(`document.body.classList.contains('burger')&&document.querySelector('#game-sauce>img').complete`));
  await ui(`globalThis.fixedLoads=[];const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){if(this.closest('.station,.burger-tool'))fixedLoads.push(value);descriptor.set.call(this,value);}});globalThis.originalFetch=fetch;globalThis.actionStarted=false;globalThis.releaseAction=null;fetch=async(...args)=>{const response=await originalFetch(...args);if(args[0]==='/api/noodle/action'){actionStarted=true;await new Promise(resolve=>releaseAction=resolve);}return response;};document.querySelector('#bowl-rack').click();`);
  await waitFor(()=>ui('actionStarted&&!!releaseAction'));
  runtime.noodle.publish();await delay(200);
  await ui('releaseAction();fetch=originalFetch;true');await delay(200);
  const fixedLoads=await ui('fixedLoads');
  assert.deepEqual(fixedLoads,[],'收礼推送与制作请求重叠时，未变化的固定贴图被反复重载');
  const burgerPreset=runtime.noodle.activePreset;
  await runtime.noodle.action({action:'preset_create',name:'切换贴图测试',template_id:'saozi'});
  await waitFor(()=>ui(`!document.body.classList.contains('burger')&&document.querySelector('#game-noodles>img').getAttribute('src')==='/noodle/render/pot.png'`));
  await runtime.noodle.action({action:'demo_raid'});
  await waitFor(()=>ui(`document.body.classList.contains('sealed')&&document.querySelector('#game-noodles>img').getAttribute('src')==='/noodle/render/pot-empty.png'`));
  await runtime.noodle.action({action:'demo_restock'});
  await waitFor(()=>ui(`!document.body.classList.contains('sealed')&&document.querySelector('#game-noodles>img').getAttribute('src')==='/noodle/render/pot.png'`));
  await runtime.noodle.action({action:'preset_use',id:burgerPreset});
  await waitFor(()=>ui(`document.body.classList.contains('burger')&&document.querySelector('#game-noodles>img').getAttribute('src').endsWith('/griddle.png')`));
  console.log(JSON.stringify({passed:true,unnecessaryFixedImageLoads:fixedLoads.length,templateSwitch:true,sealAndRestock:true}));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  win?.destroy();await runtime?.close();
  if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(root,'work')+path.sep+'gift-render-'));await fs.rm(dir,{recursive:true,force:true});}
  app.exit(process.exitCode||0);
});
