const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {PNG}=require('node:module').createRequire(require.resolve('qrcode'))('pngjs');
const root=path.join(__dirname,'..'),packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
app.setPath('userData',path.join(root,'.live-verification','feeding-animation-'+process.pid));
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let runtime,dir;const windows=[],results=[],errors=[];
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  dir=await fs.mkdtemp(path.join(root,'work','feeding-animation-'));
  runtime=await startServer({dataDir:dir,seedDir:path.join(dir,'seed')});
  // A one-pixel GIF alternates red/blue every 100 ms and loops forever.
  const gif=Buffer.from('47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b','hex');
  const response=await fetch(runtime.url+'/api/feeding/assets',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:gif});
  assert.equal(response.status,200);const {url}=await response.json();
  assert.deepEqual(Buffer.from(await (await fetch(runtime.url+url)).arrayBuffer()),gif);
  await runtime.feeding.action({action:'configure',config:{...runtime.feeding.state.config,initial_food_count:1,food_images:[url],consumer_image:url,stats_visible:false}});
  await runtime.feeding.action({action:'reset'});
  Object.assign(runtime.feeding.objects[0],{x:300,y:500,vx:0,vy:0,spin:0,angle:0,rest:10});runtime.feeding.awake=false;
  for(const query of ['','?preview=1','?capture=1']){
    const win=new BrowserWindow({show:false,width:1280,height:720,useContentSize:true,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});windows.push(win);
    win.webContents.on('console-message',(_event,details)=>{if(details.level==='error')errors.push(details.message);});
    await win.loadURL(runtime.url+'/feeding/'+query);
    await win.webContents.executeJavaScript(`new Promise(resolve=>{const check=()=>{if(typeof state!=='undefined'&&state?.consumerImage?.complete&&state.consumerImage.naturalWidth){const native=document.createElement('img');native.src=${JSON.stringify(url)};native.style.cssText='position:absolute;left:0;top:0;width:40px;height:40px';document.body.append(native);resolve();}else setTimeout(check,20)};check()})`);
    const colors={native:new Set(),food:new Set(),consumer:new Set()};
    for(let i=0;i<20;i++){
      await delay(40);
      const image=PNG.sync.read((await win.webContents.capturePage()).toPNG()),ratio=image.width/1280;
      for(const [key,x,y]of [['native',20,20],['food',300,500],['consumer',1040,500]]){const offset=(Math.round(y*ratio)*image.width+Math.round(x*ratio))*4;colors[key].add(image.data.subarray(offset,offset+3).toString('hex'));}
    }
    if(!query)await fs.writeFile(path.join(root,'artifacts','feeding-animation.png'),(await win.webContents.capturePage()).toPNG());
    results.push({page:query||'interactive',colors:Object.fromEntries(Object.entries(colors).map(([key,value])=>[key,[...value]]))});
  }
  console.log(JSON.stringify({results,errors},null,2));
  for(const result of results)for(const kind of ['native','food','consumer'])assert.ok(result.colors[kind].length>1,`${result.page}: ${kind} GIF 没有播放`);
  assert.deepEqual(errors,[]);
}).catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  for(const win of windows)if(!win.isDestroyed())win.destroy();await runtime?.close();
  if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(root,'work')+path.sep+'feeding-animation-'));await fs.rm(dir,{recursive:true,force:true});}
  app.exit(process.exitCode||0);
});
