const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
require('node:v8').setFlagsFromString('--expose_gc');
const collectFixtureGarbage=require('node:vm').runInNewContext('gc');
app.setPath('userData',path.join(root,'work','footprint-profile-'+process.pid));app.on('window-all-closed',()=>{});
let runtime,consoleWindow,scene,dir;const rows=[],errors=[];
const timeout=setTimeout(()=>app.exit(1),120000);timeout.unref();
async function waitFor(check){for(let i=0;i<150;i++){if(await check())return;await delay(50);}throw Error('内存基线画面加载超时');}
function createWindow(){const win=new BrowserWindow({show:false,width:1280,height:880,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});win.webContents.on('render-process-gone',(_event,detail)=>errors.push(detail));win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});return win;}
async function sample(name){
  await delay(1000);
  await waitFor(()=>consoleWindow.webContents.executeJavaScript(`(()=>{const docs=[document,...[...document.querySelectorAll('iframe')].map(f=>f.contentDocument).filter(Boolean)];return docs.every(d=>[...d.images].filter(img=>img.getClientRects().length).every(img=>img.complete))})()`));
  if(scene)await waitFor(()=>scene.webContents.executeJavaScript(`[...document.images].filter(img=>img.getClientRects().length).every(img=>img.complete)`));
  const pages=await consoleWindow.webContents.executeJavaScript(`(()=>{const frames=[...document.querySelectorAll('iframe')];return {loadedFrames:frames.filter(f=>f.getAttribute('src')&&f.getAttribute('src')!=='about:blank').map(f=>f.id),images:[document,...frames.map(f=>f.contentDocument).filter(Boolean)].flatMap(d=>[...d.images].filter(img=>img.naturalWidth).map(img=>({url:img.currentSrc,w:img.naturalWidth,h:img.naturalHeight})))}})()`);
  const sceneImages=scene?await scene.webContents.executeJavaScript(`[...document.images].filter(img=>img.naturalWidth).map(img=>({url:img.currentSrc,w:img.naturalWidth,h:img.naturalHeight}))`):[];
  const images=[...new Map([...pages.images,...sceneImages].map(img=>[img.url,img])).values()];
  collectFixtureGarbage();await delay(50);
  const metrics=app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,workingMiB:+(p.memory.workingSetSize/1024).toFixed(2),privateMiB:+(p.memory.privateBytes/1024).toFixed(2)}));
  const row={name,loadedFrames:pages.loadedFrames,sourcePixelMiB:+(images.reduce((sum,img)=>sum+img.w*img.h*4,0)/1048576).toFixed(2),metrics};rows.push(row);console.log(JSON.stringify(row));
  return row;
}
app.whenReady().then(async()=>{
  dir=await fs.mkdtemp(path.join(root,'work','footprint-'));runtime=await startServer({dataDir:dir});
  const template=await runtime.noodle.templates.install(JSON.parse(await fs.readFile(path.join(root,'artifacts/美式汉堡店-v1.0.3.luobo'),'utf8')));
  await runtime.noodle.action({action:'preset_create',name:'内存基线',template_id:template.id});await runtime.noodle.action({action:'start'});
  runtime.noodle.enqueue('测试顾客',20);runtime.noodle.objects=[{id:1,kind:'bowl',x:500,y:500,bun:true,patty:true,closed:true,toppings:['tomato','lettuce','cheese','mustard'],noodles:0,sauce:0}];runtime.noodle.serial=1;runtime.noodle.revision++;
  consoleWindow=createWindow();await consoleWindow.loadURL(runtime.url+'/');
  const home=await sample('console_home');
  await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-view="noodle"]').click()`);
  await waitFor(()=>consoleWindow.webContents.executeJavaScript(`!!document.querySelector('#noodle-frame').contentDocument?.querySelector('[data-object-id="1"]')`));
  const shop=await sample('console_shop');
  await fs.writeFile(path.join(root,'artifacts','low-memory-'+(process.env.LUOBO_FOOTPRINT_LABEL||'current')+'-console.png'),(await consoleWindow.webContents.capturePage()).toPNG());
  await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-view="console"]').click()`);
  const returned=await sample('console_home_after_shop');
  scene=createWindow();await scene.loadURL(runtime.url+'/noodle/');
  await waitFor(()=>scene.webContents.executeJavaScript(`!!document.querySelector('[data-object-id="1"]')`));
  const independent=await sample('console_with_independent_shop');
  await fs.writeFile(path.join(root,'artifacts','low-memory-'+(process.env.LUOBO_FOOTPRINT_LABEL||'current')+'-scene.png'),(await scene.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(root,'artifacts','memory-footprint-'+(process.env.LUOBO_FOOTPRINT_LABEL||'current')+'.json'),JSON.stringify({packageRoot,rows,errors},null,2));
  const layers=[];
  for(const layer of ['background','customers','counter']){
    scene.destroy();scene=createWindow();await scene.loadURL(runtime.url+'/noodle/?layer='+layer);await delay(800);
    await waitFor(()=>scene.webContents.executeJavaScript(`document.title.includes('美式汉堡店')&&[...document.images].filter(img=>img.getClientRects().length).every(img=>img.complete)`));
    const loaded=await scene.webContents.executeJavaScript(`[...document.images].filter(img=>img.naturalWidth).map(img=>img.currentSrc)`);layers.push({layer,images:loaded});
    assert.equal(await scene.webContents.executeJavaScript(`document.getElementById('game-served').nextElementSibling.textContent`),'个');
    if(layer==='background')assert.equal(loaded.length,1,'背景层加载了额外素材');
    if(layer==='customers')assert.ok(!loaded.some(url=>/\/(griddle|oven|cabinet|bun_raw)\.png/.test(url)),'顾客层加载了厨房素材');
    if(layer==='counter')assert.ok(!loaded.some(url=>url.endsWith('/background.png')),'桌台层加载了背景');
  }
  for(const [view,expected]of [['feeding',['feeding-frame']],['overtime',['overtime-frame','overtime-media-frame']],['number-bomb',['bomb-frame']],['lottery',['lottery-frame']],['console',[]],['feeding',['feeding-frame']],['lottery',['lottery-frame']],['console',[]]]){
    await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-view="${view}"]').click()`);
    await waitFor(()=>consoleWindow.webContents.executeJavaScript(`(()=>{const frames=[...document.querySelectorAll('iframe')].filter(f=>f.hasAttribute('src'));return JSON.stringify(frames.map(f=>f.id))===${JSON.stringify(JSON.stringify(expected))}&&frames.every(f=>f.contentDocument?.readyState==='complete'&&f.contentWindow.location.pathname===new URL(f.dataset.src,location.href).pathname)})()`));
    if(view==='feeding')await consoleWindow.webContents.executeJavaScript(`(()=>{const field=document.querySelector('#feeding-settings').elements.manual_step;if(globalThis.savedDraft) {if(field.value!=='456')throw Error('切换预览丢失了未保存配置');}else{field.value='456';field.dispatchEvent(new Event('input',{bubbles:true}));globalThis.savedDraft=true;}return true})()`);
    if(view==='lottery'){
      await consoleWindow.webContents.executeJavaScript(`document.querySelector('[data-lottery-mode="scratch"]').click()`);
      await waitFor(()=>consoleWindow.webContents.executeJavaScript(`document.querySelector('#lottery-frame').contentDocument?.title.includes('刮刮乐')`));
    }
  }
  await fs.writeFile(path.join(root,'artifacts','memory-footprint-'+(process.env.LUOBO_FOOTPRINT_LABEL||'current')+'.json'),JSON.stringify({packageRoot,rows,layers,navigation:true,errors},null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(home.loadedFrames,[],'未打开功能就加载了预览页面');assert.ok(home.sourcePixelMiB<8,'首页加载了未使用的大图');assert.deepEqual(shop.loadedFrames,['noodle-frame']);assert.deepEqual(returned.loadedFrames,[],'切换功能后仍保留旧预览页面');assert.ok(independent.sourcePixelMiB<48,'小尺寸画面仍载入过大的原图：'+independent.sourcePixelMiB+' MiB');
}).catch(error=>{console.error(error,errors);process.exitCode=1;}).finally(async()=>{scene?.destroy();consoleWindow?.destroy();await runtime?.close();if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(root,'work')+path.sep+'footprint-'));await fs.rm(dir,{recursive:true,force:true});}app.exit(process.exitCode||0);});
