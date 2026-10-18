const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {PNG}=require('node:module').createRequire(require.resolve('qrcode'))('pngjs');
const root=path.join(__dirname,'..'),packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
app.setPath('userData',path.join(root,'.live-verification','feeding-layer-'+process.pid));
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,label){const until=Date.now()+12000;while(Date.now()<until){if(await check())return;await delay(40);}throw Error('界面验证超时：'+label);}
let runtime,dir;const windows=[],errors=[];
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  dir=await fs.mkdtemp(path.join(root,'work','feeding-layer-'));runtime=await startServer({dataDir:dir,seedDir:path.join(dir,'seed')});
  const upload=async pixel=>{const gif=Buffer.from('47494638396101000100800000ff00000000ff2c0000000001000100000202'+pixel+'01003b','hex');const response=await fetch(runtime.url+'/api/feeding/assets',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:gif});assert.equal(response.status,200);return (await response.json()).url;};
  const food=await upload('44'),consumer=await upload('4c');
  await runtime.feeding.action({action:'configure',config:{...runtime.feeding.state.config,initial_food_count:1,food_images:[food],consumer_image:consumer,stats_visible:false,sound_enabled:false}});await runtime.feeding.action({action:'reset'});
  Object.assign(runtime.feeding.objects[0],{x:300,y:500,vx:0,vy:0,spin:0,angle:0,rest:10});runtime.feeding.awake=false;
  for(const query of ['','?capture=1']){
    const win=new BrowserWindow({show:false,width:1280,height:720,useContentSize:true,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});windows.push(win);
    win.webContents.on('console-message',(_event,details)=>{if(details.level==='error')errors.push(details.message);});await win.loadURL(runtime.url+'/feeding/'+query);
    await waitFor(()=>win.webContents.executeJavaScript(`typeof state!=='undefined'&&state?.consumerImage?.complete&&[...sprites.values()][0]?.image.complete`),'素材加载');
  }
  const main=windows[0];main.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:300,y:500});main.webContents.sendInputEvent({type:'mouseMove',x:1040,y:500});
  await waitFor(()=>runtime.feeding.hold?.x===1040,'握住食物拖到食用者面前');
  await waitFor(()=>windows[1].webContents.executeJavaScript(`[...sprites.values()][0]?.x>1039`),'透明来源拖动同步');
  const colors=[];
  for(const win of windows){const image=PNG.sync.read((await win.webContents.capturePage()).toPNG()),ratio=image.width/1280,offset=(Math.round(500*ratio)*image.width+Math.round(1040*ratio))*4;colors.push(image.data.subarray(offset,offset+3).toString('hex'));}
  console.log(JSON.stringify({heldFoodColors:colors,expected:'ff0000',errors}));assert.deepEqual(colors,['ff0000','ff0000'],'拖动的红色食物被蓝色食用者挡住了');
  main.webContents.sendInputEvent({type:'mouseMove',x:1040,y:100});await waitFor(()=>runtime.feeding.hold?.y===100,'移到食用者上方');main.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:1040,y:100});
  await waitFor(()=>runtime.feeding.state.eaten===1,'松手后下落经过食用者自动吃掉');assert.equal(runtime.feeding.state.count,0);assert.deepEqual(errors,[]);
  console.log('真实鼠标拖动前景显示、透明来源同步、未开局松手下落投喂均通过');
}).catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  for(const win of windows)if(!win.isDestroyed())win.destroy();await runtime?.close();
  if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(root,'work')+path.sep+'feeding-layer-'));await fs.rm(dir,{recursive:true,force:true});}
  app.exit(process.exitCode||0);
});
