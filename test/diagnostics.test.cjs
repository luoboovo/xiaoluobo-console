const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {spawnSync}=require('node:child_process');
const {createDiagnostics,redact} = require('../lib/diagnostics.cjs');
const {startServer} = require('../server.cjs');

async function fixture(t,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-diagnostics-'));
  const diagnostics=createDiagnostics(dir,{version:'test',...options});
  const cleanup=[];
  t.after(async()=>{
    for(const close of cleanup.reverse())await close();
    await diagnostics.close();
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-diagnostics-'));
    await fs.rm(dir,{recursive:true,force:true});
  });
  await diagnostics.ready;
  return {dir,diagnostics,cleanup};
}
async function records(diagnostics) {
  await diagnostics.flush();
  let text=''; for await(const chunk of diagnostics.export())text+=chunk;
  return text.trim().split('\n').map(line=>JSON.parse(line));
}

test('日志保存错误堆栈、脱敏凭证与网址参数，超量日志限流、文件轮转有界',async t=>{
  const {diagnostics}=await fixture(t,{maxBytes:1024,maxFiles:3});
  const clean=JSON.stringify(redact({cookie:'private-cookie',nested:{Authorization:'private-auth'},error:new Error('failed https://example.com/path?token=private-token#private-fragment SESSDATA=private-session')}));
  for(const value of ['private-cookie','private-auth','private-token','private-fragment','private-session'])assert.equal(clean.includes(value),false);
  for(let i=0;i<40;i++)diagnostics.log('error','test.error',{index:i,error:new Error('test failure '+i+'x'.repeat(200))});
  const rows=await records(diagnostics);
  assert.ok(rows.some(row=>row.event==='test.error'&&row.data.error.stack.includes('test failure')));
  const files=(await fs.readdir(diagnostics.logDir)).filter(file=>/^console(?:\.\d+)?\.log$/.test(file));
  assert.ok(files.length<=3);
  for(const file of files)assert.ok((await fs.stat(path.join(diagnostics.logDir,file))).size<=1024);
  for(let i=0;i<500;i++)diagnostics.log('warn','test.flood',{index:i});
  const flooded=await records(diagnostics);
  assert.ok(flooded.some(row=>row.event==='log.throttled'));
});

test('主线程阻塞时独立看门狗已写下卡顿记录，恢复后记录恢复',async t=>{
  const {diagnostics}=await fixture(t,{heartbeatMs:20,stallMs:100});
  diagnostics.context({operation:'test.block_main'});
  await diagnostics.flush();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,400);
  // Read synchronously before the main thread can send a recovery heartbeat.
  const during=require('node:fs').readFileSync(path.join(diagnostics.logDir,'console.log'),'utf8');
  assert.ok(during.includes('main.unresponsive'),during);
  assert.ok(during.includes('test.block_main'));
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.ok((await records(diagnostics)).some(row=>row.event==='main.responsive'));
});

test('未正常退出的上次运行在下次启动时可查，正常关闭不误报',async t=>{
  const {dir,diagnostics}=await fixture(t);
  await diagnostics.close();
  const stateFile=path.join(diagnostics.logDir,'run-state.json');
  const old=JSON.parse(await fs.readFile(stateFile,'utf8'));
  await fs.writeFile(stateFile,JSON.stringify({...old,clean:false,operation:'last.operation'}));
  const next=createDiagnostics(dir,{version:'test'}); t.after(()=>next.close()); await next.ready;
  assert.ok((await records(next)).some(row=>row.event==='run.previous_unclean_exit'));
  await next.close();
  const clean=createDiagnostics(dir,{version:'test'}); t.after(()=>clean.close()); await clean.ready;
  const rows=await records(clean);
  assert.equal(rows.filter(row=>row.event==='run.previous_unclean_exit'&&row.runId===clean.runId).length,0);
  await clean.close();
});

test('前端报错、接口异常、日志导出和端口占用都可诊断，导出只允许本机',async t=>{
  const {dir,diagnostics,cleanup}=await fixture(t);
  const app=await startServer({dataDir:dir,seedDir:path.join(__dirname,'..','data'),diagnostics}); cleanup.push(()=>app.close());
  const post=(url,body,extra={})=>fetch(app.url+url,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  assert.equal((await post('/api/diagnostics/client',{entries:[{event:'runtime_error',message:'test-ui-error',stack:'test-ui-stack',page:'/'}]})).status,200);
  assert.equal((await post('/api/diagnostics/client',{entries:[{event:'runtime_error',message:'bad'}]},{Origin:'https://evil.com'})).status,403);
  assert.equal((await post('/api/diagnostics/client',{entries:[{event:'arbitrary',message:'bad',page:'/'}]})).status,400);
  assert.equal((await post('/api/noodle/action',{action:'not-a-real-action'})).status,400);
  const exported=await fetch(app.url+'/api/diagnostics/export'); assert.equal(exported.status,200);
  const text=await exported.text(); assert.ok(text.includes('test-ui-error'));assert.ok(text.includes('http.error'));
  const occupied=http.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>occupied.close(resolve)));
  await assert.rejects(startServer({dataDir:dir,seedDir:path.join(__dirname,'..','data'),diagnostics,port:occupied.address().port}),error=>error.code==='EADDRINUSE'&&error.message.includes('端口'));
  assert.ok((await records(diagnostics)).some(row=>row.event==='server.bind_failed'));
});

test('未捕获异常保留同步错误堆栈，日志磁盘异常可被发现且不阻塞退出',async t=>{
  const {dir,diagnostics}=await fixture(t);
  await diagnostics.close();
  const crash=spawnSync(process.execPath,['-e',`const {createDiagnostics}=require(process.argv[1]);const log=createDiagnostics(process.argv[2]);log.ready.then(()=>{setImmediate(()=>{throw new Error('diagnostics-fatal-smoke')});});`,require.resolve('../lib/diagnostics.cjs'),dir],{encoding:'utf8',timeout:10000});
  assert.notEqual(crash.status,0);
  assert.ok((await fs.readFile(path.join(diagnostics.logDir,'fatal.log'),'utf8')).includes('diagnostics-fatal-smoke'));
  const next=createDiagnostics(dir);await next.ready;
  try{
    assert.ok((await records(next)).some(row=>row.event==='run.previous_unclean_exit'));
    const consoleFile=path.join(next.logDir,'console.log');
    await fs.unlink(consoleFile);await fs.mkdir(consoleFile);
    next.log('error','test.disk_error');await next.flush();
    assert.ok(next.info().lastError);
    await fs.rmdir(consoleFile);
    next.log('info','test.disk_recovered');await next.flush();
    assert.equal(next.info().lastError,null);
  }finally{await next.close();}
});
