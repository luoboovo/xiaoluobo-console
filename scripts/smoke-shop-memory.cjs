const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),packageRoot=process.env.LUOBO_SMOKE_PACKAGE||root;
const {startServer}=require(path.join(packageRoot,'server.cjs'));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.setPath('userData',path.join(root,'work','shop-memory-profile-'+process.pid));app.on('window-all-closed',()=>{});
let runtime,win,dir;const report=[],errors=[];
const timeout=setTimeout(()=>{console.error('持续制作测试超时');app.exit(1);},300000);timeout.unref();
app.whenReady().then(async()=>{
  dir=await fs.mkdtemp(path.join(root,'work','shop-memory-'));runtime=await startServer({dataDir:dir});
  for(const [name,file]of [['面馆',null],['汉堡','美式汉堡店-v1.0.3.luobo'],['香锅','麻辣香锅-v1.0.4.luobo'],['刀削面','刀削面馆-v1.0.1.luobo'],['咖啡','茉莉咖啡厅-v1.0.1.luobo']]){
    const template=file?await runtime.noodle.templates.install(JSON.parse(await fs.readFile(path.join(root,'artifacts',file),'utf8'))):{id:'saozi'};
    await runtime.noodle.action({action:'preset_create',name,template_id:template.id});await runtime.noodle.action({action:'start'});
    win=new BrowserWindow({show:false,width:1280,height:720,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
    win.webContents.on('render-process-gone',(_event,detail)=>errors.push({name,...detail}));
    win.webContents.on('console-message',event=>{if(event.level==='error')errors.push({name,message:event.message});});
    await win.loadURL('about:blank');win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:`const NativeSocket=WebSocket;globalThis.WebSocket=class extends NativeSocket{constructor(...args){super(...args);globalThis.replaySocket=this;}};`});
    await win.loadURL(runtime.url+'/noodle/');await delay(500);
    for(let i=0;i<100&&!await win.webContents.executeJavaScript('!!globalThis.replaySocket');i++)await delay(50);
    assert.ok(await win.webContents.executeJavaScript('!!globalThis.replaySocket'),JSON.stringify(errors));
    const initial=runtime.noodle.snapshot();
    await win.webContents.executeJavaScript(`globalThis.replayState=${JSON.stringify(initial)};globalThis.replaySerial=replayState.workspace_revision;globalThis.replayDish=0;globalThis.replay=async(count)=>{
      const state=replayState,workflow=state.template.workflow;
      const paint=async()=>{state.workspace_revision=++replaySerial;replaySocket.dispatchEvent(new MessageEvent('message',{data:'event: noodle\\ndata: '+JSON.stringify(state)+'\\n\\n'}));await new Promise(resolve=>setTimeout(resolve,16));};
      for(let i=0;i<count;i++){
        const id=++replayDish,person={id,uid:id,name:'观众'+id,face:'',order:id%2?'noodles':'water',recipe:workflow};
        state.queue=[person];state.queue_count=1;state.departures=[];state.objects=[{id:id*2,kind:'bowl',x:500,y:500,noodles:0,sauce:0,...(workflow==='burger'?{bun:true,toppings:[]}:workflow==='stir-fry'?{ingredients:[],garnishes:[]}:workflow==='jasmine-latte'?{coffee:false,jasmine:false,milk:false}: {})}];
        state.cooking=workflow==='burger'?['bun','patty'].map((food,index)=>({id:id*2+index,food,ready_at:Date.now()+5000})):workflow==='jasmine-latte'?[{id,ready_at:Date.now()+5000,cup:{coffee:false,jasmine:false,milk:false}}]:[];
        if(workflow==='stir-fry'){state.stirfry.basket=['bokchoy','beef'];state.stirfry.wok={ingredients:[],started_at:0,ready_at:0};}
        state.selected=id*2;await paint();
        const bowl=document.querySelector('[data-object-id="'+id*2+'"]'),actor=document.querySelector('[data-customer-id="'+id+'"]');
        if(!bowl?.classList.contains('selected')||!bowl.getAttribute('aria-label').includes(id*2))throw Error('复用餐品的编号、选中态或无障碍名称错误');
        if(!actor||actor.dataset.name!==person.name||actor.tabIndex!==0||actor.getAttribute('role')!=='button'||actor.classList.contains('departing')||actor.querySelector('.customer-reaction')||actor.querySelector('.customer-name').textContent!==person.name||actor.querySelector('.customer-order').classList.contains('water-order')!==(person.order==='water'))throw Error('复用顾客后姓名、点单或离场状态错误');
        if(replayDish>1&&(globalThis.lastBowl!==bowl||globalThis.lastActors?.[person.order]&&globalThis.lastActors[person.order]!==actor))throw Error('连续制作没有复用餐品和顾客');
        globalThis.lastBowl=bowl;globalThis.lastActors??={};globalThis.lastActors[person.order]=actor;
        if(workflow==='burger'){
          const batch=document.querySelector('#burger-oven-batches .burger-batch');
          if(!batch||batch.hidden||batch.children[0].hidden||!batch.children[1].hidden||batch.querySelector('small').textContent==='可取出')throw Error('烤箱制作中贴图或倒计时错误');
          if(globalThis.lastBatch&&globalThis.lastBatch!==batch)throw Error('烤箱没有复用制作图层');globalThis.lastBatch=batch;
        }
        if(workflow==='jasmine-latte'&&document.querySelectorAll('.machine-cup:not([hidden])').length!==1)throw Error('咖啡机制作中没有显示杯子');
        if(workflow==='stir-fry'&&id===1){const ingredient=document.querySelector('#stir-basket-food').firstElementChild;await paint();if(document.querySelector('#stir-basket-food').firstElementChild!==ingredient)throw Error('食材篮未变化时仍然重建图层');}
        if(workflow==='burger'&&(bowl.querySelector('.bowl-art').hasAttribute('src')||bowl.querySelectorAll('.burger-stack img:not([hidden])').length!==1||[...bowl.querySelectorAll('.burger-stack img[hidden]')].some(img=>getComputedStyle(img).display!=='none')))throw Error('复用汉堡后旧图层没有隐藏');
        Object.assign(state.objects[0],workflow==='burger'?{patty:true,toppings:['tomato','lettuce','cheese','mustard'],closed:true}:workflow==='stir-fry'?{ingredients:['bokchoy','beef'],garnishes:['sesame','scallions']}:workflow==='jasmine-latte'?{coffee:true,jasmine:true,milk:true}:{noodles:1,sauce:workflow==='knife-noodles'?0:1});
        for(const batch of state.cooking)batch.ready_at=Date.now()-1;
        if(workflow==='stir-fry'){state.stirfry.basket=[];state.stirfry.wok={ingredients:['bokchoy','beef'],started_at:Date.now()-10000,ready_at:Date.now()-1};}await paint();
        if(workflow==='burger'&&(lastBatch.children[1].hidden||!lastBatch.children[0].hidden||lastBatch.querySelector('small').textContent!=='可取出'))throw Error('烤箱完成后贴图或状态错误');
        if(workflow==='burger'&&bowl.querySelectorAll('.burger-stack img:not([hidden])').length!==7)throw Error('汉堡完成后缺少食材图层');
        if(workflow!=='burger'&&!bowl.querySelector('.bowl-art:not([hidden])')?.getAttribute('src'))throw Error('完成的餐品没有贴图');
        state.cooking=[];if(workflow==='stir-fry')state.stirfry.wok={ingredients:[],started_at:0,ready_at:0};
        state.objects=[{id:id*2+1,kind:'coin',x:500,y:500,noodles:0,sauce:0}];state.selected=null;state.queue=[];state.queue_count=0;state.departures=[{...person,index:0,at:Date.now(),correct:true}];state.served=id;await paint();
        if(document.querySelector('.burger-batch:not([hidden]),.machine-cup:not([hidden])'))throw Error('已取出的制作批次没有隐藏');
        if(actor.getAttribute('role')!=='img'||actor.tabIndex!==-1||!actor.classList.contains('departing'))throw Error('出餐后顾客未离场');
        state.objects=[];state.departures=[];state.balance=id*100;await paint();
        if(document.querySelectorAll('#workspace-objects>[data-object-id]').length||document.querySelectorAll('#game-customers>[data-customer-id]').length)throw Error('已完成餐品或顾客没有移除');
      }
      return replayDish;
    };true`);
    const samples=[];
    for(let batch=1;batch<=5;batch++){
      const dishes=await win.webContents.executeJavaScript('replay(100)');
      await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');await delay(100);
      const dom=await win.webContents.debugger.sendCommand('Memory.getDOMCounters');
      const heap=await win.webContents.debugger.sendCommand('Runtime.getHeapUsage');
      const memory=app.getAppMetrics().find(item=>item.pid===win.webContents.getOSProcessId()).memory;
      const row={name,dishes,heapMiB:+(heap.usedSize/1048576).toFixed(2),privateMiB:+(memory.privateBytes/1024).toFixed(2),workingMiB:+(memory.workingSetSize/1024).toFixed(2),dom};samples.push(row);console.log(JSON.stringify(row));
    }
    report.push({name,samples});win.destroy();win=null;
  }
  await fs.writeFile(path.join(root,'artifacts/shop-memory-soak.json'),JSON.stringify({report,errors},null,2));
  assert.deepEqual(errors,[]);
  for(const {name,samples}of report){const first=samples[0],last=samples.at(-1);assert.ok(last.dom.nodes-first.dom.nodes<100,`${name}持续制作后有DOM节点未释放：${first.dom.nodes} -> ${last.dom.nodes}`);assert.ok(last.privateMiB-first.privateMiB<32,`${name}预热后私有内存持续增长：${first.privateMiB} -> ${last.privateMiB} MiB`);assert.ok(last.workingMiB-first.workingMiB<64,`${name}预热后工作集持续增长：${first.workingMiB} -> ${last.workingMiB} MiB`);}
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  win?.destroy();await runtime?.close();
  if(dir){assert.ok(path.resolve(dir).startsWith(path.resolve(root,'work')+path.sep+'shop-memory-'));await fs.rm(dir,{recursive:true,force:true});}
  app.exit(process.exitCode||0);
});
