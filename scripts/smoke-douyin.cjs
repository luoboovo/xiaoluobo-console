const {app,BrowserWindow,session}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const packageRoot=process.env.LUOBO_SMOKE_PACKAGE||path.join(__dirname,'..');
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const {createDouyinDesktop}=require(path.join(packageRoot,'lib','douyin-desktop.cjs'));
const root=path.join(__dirname,'..','work','douyin-electron-smoke');
app.setPath('userData',path.join(root,'browser'));
let runtime,transport,win;
function report(value){require('node:fs').appendFileSync(path.join(root,'result.log'),typeof value==='string'?value+'\n':JSON.stringify(value)+'\n');}
async function readyUI(condition){
  const deadline=Date.now()+15000;
    while(Date.now()<deadline){try{if(await win.webContents.executeJavaScript(condition))return;}catch{}await new Promise(r=>setTimeout(r,100));}
  throw new Error('控制台界面未完成加载');
}
app.whenReady().then(async()=>{
  await fs.mkdir(root,{recursive:true});
  await fs.writeFile(path.join(root,'result.log'),'');
  transport=createDouyinDesktop({BrowserWindow,session});
  const bootstrap=transport.bootstrap;
  transport.bootstrap=async room=>{
    const result=await bootstrap(room),url=new URL(result.url);
    report({bootstrapRoom:url.searchParams.get('room_id'),cookiePresent:Object.entries(result.headers).some(([key,value])=>key.toLowerCase()==='cookie'&&Boolean(value)),parameterNames:[...url.searchParams.keys()]});return result;
  };
  runtime=await startServer({dataDir:path.join(root,'data'),douyin:transport});
  if(runtime.services.platform!=='bilibili')await fetch(runtime.url+'/api/platform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({platform:'bilibili'})});
  win=new BrowserWindow({width:1280,height:1000,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)errors.push(message.slice(0,250));});
  await win.loadURL(runtime.url);
  await readyUI("document.querySelector('#gift-total')?.textContent !== '0'");
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(root,'bilibili.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('#live-platform').value='douyin';document.querySelector('#live-platform').dispatchEvent(new Event('change'))");
  await readyUI("document.querySelector('#live-heading')?.textContent === '抖音直播' && document.querySelector('#gift-total')?.textContent !== '0'");
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(root,'douyin.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('[data-view=noodle]').click()");
  await readyUI("!document.querySelector('#noodle-view').hidden && document.querySelector('#noodle-gift').textContent.includes('小心心')");
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(root,'douyin-game.png'),(await win.webContents.capturePage()).toPNG());
  assert.equal(errors.filter(e=>!e.includes('404')).length,0,JSON.stringify(errors));
  report({ui:'passed',platform:runtime.services.platform,gifts:runtime.services.gifts.length,errors});
  if(process.env.LUOBO_VERIFY_ROOM){
    let count=0;const types=new Set();runtime.services.on('event',event=>{if(event.type!=='system'){count++;types.add(event.type);}});
    const begin=Date.now();report('live-bootstrap-start');
    try{await runtime.services.connectLive(process.env.LUOBO_VERIFY_ROOM);}catch(error){
      if(error.message.includes('未开播')){report({offlineRoomRejected:true,message:error.message});return;}
      throw error;
    }
    let frames=0;runtime.services.liveSocket?.on('message',bytes=>{
      frames++;
      try{
        const map=require('../lib/protocol.cjs').protobufFields(bytes);
        report({frame:frames,keys:[...map.keys()],type:map.get(7)?.[0]?.toString().slice(0,30),bytes:bytes.length,payloadBytes:map.get(8)?.[0]?.length||0});
      }catch(error){report({frameError:error.message});}
    });
    const deadline=Date.now()+25000;
    while(Date.now()<deadline&&count<5)await new Promise(r=>setTimeout(r,500));
    report({liveStatus:runtime.services.state.live.status,title:runtime.services.state.live.title,frames,firstBatchMs:Date.now()-begin,count,types:[...types],error:runtime.services.state.live.error||''});
  }
}).catch(error=>{report(error.stack);process.exitCode=1;}).finally(async()=>{
  if(win&&!win.isDestroyed())win.destroy();transport?.close();await runtime?.close();app.exit(process.exitCode||0);
});
