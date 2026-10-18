const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const output=path.join(root,'artifacts','auto-bowl-desktop.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.on('window-all-closed',()=>{});
let runtime,dir,win,currentTemplate;
async function waitFor(check){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await delay(30);}throw new Error('自动摆碗界面验证超时');}
async function clickRack(count=1){
  const {x,y}=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#bowl-rack').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  win.webContents.sendInputEvent({type:'mouseMove',x,y});
  for(let i=0;i<count;i++){
    win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});
    win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});
    await delay(30);
  }
}
app.whenReady().then(async()=>{
  dir=await fs.mkdtemp(path.join(root,'work','auto-bowl-desktop-'));
  runtime=await startServer({dataDir:dir,seedDir:path.join(packageRoot,'data')});
  const action=runtime.noodle.action.bind(runtime.noodle);
  runtime.noodle.action=async input=>{if(input.action==='place_bowl')await delay(80);return action(input);};
  const results=[];
  for(const [name,file]of [['臊子面馆',null],['刀削面馆','刀削面馆-v1.0.1.luobo'],['咖啡厅','咖啡厅模板-v1.0.2.luobo'],['麻辣香锅','麻辣香锅-v1.0.4.luobo']]){
    currentTemplate=name;
    if(file){
      const template=await runtime.noodle.templates.install(JSON.parse(await fs.readFile(path.join(root,'artifacts',file),'utf8')));
      await runtime.noodle.action({action:'preset_create',name,template_id:template.id});
    }
    await runtime.noodle.action({action:'start'});
    win=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
    await win.loadURL(runtime.url+'/noodle/');
    await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#bowl-rack').getAttribute('aria-label').includes('点击')&&!document.querySelector('#bowl-rack').disabled`));
    win.webContents.focus();await delay(200);
    await win.webContents.executeJavaScript(`window.bowlEvents=[];for(const type of ['pointerdown','pointerup','click'])document.addEventListener(type,event=>window.bowlEvents.push({type,target:event.target.closest('button')?.id||event.target.id,disabled:document.querySelector('#bowl-rack').disabled}),true)`);
    // Real pointer events cover the old rack drag handler as well as the new click handler.
    await clickRack(4);
    await waitFor(()=>runtime.noodle.objects.length===4);
    await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#workspace-objects').children.length===4`));
    assert.ok(runtime.noodle.objects.every(item=>item.kind==='bowl'&&item.noodles===0&&item.sauce===0));
    const before=structuredClone(runtime.noodle.objects);
    await clickRack();await delay(150);assert.deepEqual(runtime.noodle.objects,before);
    await runtime.noodle.action({action:'discard',revision:runtime.noodle.revision,object_id:before[1].id});
    await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#workspace-objects').children.length===3`));
    await clickRack();await waitFor(()=>runtime.noodle.objects.length===4);
    assert.equal(runtime.noodle.objects.at(-1).x,before[1].x);
    // The game's key handler must leave Enter available for native button activation.
    await runtime.noodle.action({action:'discard',revision:runtime.noodle.revision,object_id:before[2].id});
    await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#workspace-objects').children.length===3`));
    const prevented=await win.webContents.executeJavaScript(`(()=>{const rack=document.querySelector('#bowl-rack');rack.focus();const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});rack.dispatchEvent(event);if(!event.defaultPrevented)rack.click();return event.defaultPrevented})()`);
    assert.equal(prevented,false);
    await waitFor(()=>runtime.noodle.objects.length===4);
    await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#workspace-objects').children.length===4`));
    const oldTrayLeft=await win.webContents.executeJavaScript(`document.querySelector('#bowl-area').getBoundingClientRect().left`);
    await runtime.noodle.action({action:'discard',revision:runtime.noodle.revision,object_id:before[0].id});
    await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#workspace-objects').children.length===3`));
    const config=structuredClone(runtime.noodle.config);
    config.layout.props.tray.x+=40;config.layout.props.tray.y-=10;config.layout.props.tray.scale*=.9;config.layout.stations.bowl.x+=15;
    await runtime.noodle.action({action:'save',config});
    await waitFor(()=>win.webContents.executeJavaScript(`Math.abs(document.querySelector('#bowl-area').getBoundingClientRect().left-${oldTrayLeft})>1`));
    await clickRack();await waitFor(()=>runtime.noodle.objects.length===4);
    await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#workspace-objects').children.length===4`));
    const positions=await win.webContents.executeJavaScript(`Array.from(document.querySelector('#workspace-objects').children,el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})`);
    assert.ok(Math.max(...positions.map(p=>p.y))-Math.min(...positions.map(p=>p.y))<1);
    assert.ok(await win.webContents.executeJavaScript(`(()=>{const tray=document.querySelector('#bowl-area').getBoundingClientRect();return Array.from(document.querySelector('#workspace-objects').children).every(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return x>tray.left&&x<tray.right&&y>tray.top&&y<tray.bottom})})()`));
    await delay(200);
    await fs.writeFile(path.join(root,'artifacts',`auto-bowl-${runtime.noodle.template().workflow}.png`),(await win.webContents.capturePage()).toPNG());
    results.push({name,workflow:runtime.noodle.template().workflow,rapidClicks:4,bowls:runtime.noodle.objects.length,fullTrayPreserved:true,holeRefilled:true,keyboardPlacement:true,layoutFollowed:true,coordinates:runtime.noodle.objects.map(({x,y})=>({x,y}))});
    win.destroy();win=null;
  }
  await fs.writeFile(output,JSON.stringify({version:require(path.join(packageRoot,'package.json')).version,results},null,2));
}).catch(async error=>{process.exitCode=1;let events;try{events=await win?.webContents.executeJavaScript('window.bowlEvents');}catch{}await fs.writeFile(output,JSON.stringify({error:error.stack,currentTemplate,objects:runtime?.noodle.objects,events},null,2));}).finally(async()=>{
  if(win&&!win.isDestroyed())win.destroy();await runtime?.close();
  if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(root,'work')+path.sep+'auto-bowl-desktop-'));await fs.rm(dir,{recursive:true,force:true});}
  app.exit(process.exitCode||0);
});
