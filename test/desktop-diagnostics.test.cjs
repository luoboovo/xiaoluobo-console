const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {monitorDesktop,guardMainProcess}=require('../lib/desktop-diagnostics.cjs');
const {performance}=require('node:perf_hooks');

test('本地画面崩溃后延迟恢复，一分钟最多重载两次，登录网页及退出时不重载',t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const app=new EventEmitter(),events=[];
  app.getGPUFeatureStatus=()=>({});
  const stop=monitorDesktop(app,{log:(level,event,data)=>events.push({level,event,data})});t.after(stop);
  function contents(id,url){
    const page=new EventEmitter();
    Object.assign(page,{id,reloads:0,isDestroyed:()=>false,getURL:()=>url,executeJavaScript:()=>Promise.resolve(0),reload(){this.reloads++;}});
    app.emit('web-contents-created',{},page);return page;
  }
  const page=contents(1,'http://127.0.0.1:3181/noodle/'),login=contents(2,'https://live.douyin.com/');
  const crash=target=>target.emit('render-process-gone',{}, {reason:'oom',exitCode:-536870904});
  crash(page);assert.equal(page.reloads,0);t.mock.timers.tick(500);assert.equal(page.reloads,1);
  page.emit('did-finish-load');assert.ok(events.some(row=>row.event==='renderer.recovered'));
  crash(page);t.mock.timers.tick(500);assert.equal(page.reloads,2);
  page.emit('did-finish-load');crash(page);t.mock.timers.tick(500);assert.equal(page.reloads,2);
  assert.ok(events.some(row=>row.event==='renderer.recovery_stopped'));
  crash(login);t.mock.timers.tick(500);assert.equal(login.reloads,0);
  const closing=contents(3,'http://127.0.0.1:3181/');crash(closing);stop();t.mock.timers.tick(500);assert.equal(closing.reloads,0);
});

test('内存采样关联画面与原生进程，并记录系统剩余内存',t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  let now=0;t.mock.method(performance,'now',()=>now);
  const app=new EventEmitter(),events=[];
  app.getGPUFeatureStatus=()=>({});
  app.getAppMetrics=()=>[{pid:202,type:'Tab',memory:{privateBytes:102400}}];
  const stop=monitorDesktop(app,{log:(level,event,data)=>events.push({level,event,data})});t.after(stop);
  const page=new EventEmitter();
  Object.assign(page,{id:101,isDestroyed:()=>false,getURL:()=>'http://127.0.0.1:3181/noodle/',getOSProcessId:()=>202,executeJavaScript:()=>Promise.resolve(0)});
  app.emit('web-contents-created',{},page);now=16000;t.mock.timers.tick(2000);
  const sample=events.find(row=>row.event==='desktop.process_memory').data;
  assert.equal(sample.pages[0].pid,sample.processes[0].pid);
  assert.equal(sample.pages[0].webContentsId,101);
  assert.ok(sample.totalMiB>=sample.freeMiB&&sample.freeMiB>=0);
});

test('主进程未捕获异常和未处理拒绝只记录并提示，不弹阻塞对话框，提示限流',t=>{
  let now=0;t.mock.method(performance,'now',()=>now);
  const target=new EventEmitter(),events=[],notices=[];
  const stop=guardMainProcess(target,{log:(level,event,data)=>events.push({level,event,data})},message=>notices.push(message));t.after(stop);
  target.emit('uncaughtException',new Error('坏数据'));
  target.emit('unhandledRejection',new Error('请求失败'));
  assert.deepEqual(events.map(row=>row.event),['process.uncaught_exception','process.unhandled_rejection']);
  assert.deepEqual(notices,['坏数据']);
  now=10000;target.emit('unhandledRejection','字符串原因');assert.deepEqual(notices,['坏数据','字符串原因']);
  stop();assert.equal(target.listenerCount('uncaughtException'),0);
  const broken=new EventEmitter();t.after(guardMainProcess(broken,{log(){throw new Error('日志不可用');}},()=>{throw new Error('提示失败');}));
  assert.doesNotThrow(()=>broken.emit('uncaughtException',new Error('x')));
});
