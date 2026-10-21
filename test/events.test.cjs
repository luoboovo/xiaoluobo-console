const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {WebSocket}=require('ws');
const {startServer}=require('../server.cjs');

function browserEvents(){
  const context=vm.createContext({EventTarget,Event,MessageEvent,URL,location:{href:'http://127.0.0.1/'},WebSocket:class{},setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(require.resolve('../public/events.js'),'utf8')+'\nglobalThis.source=new LuoboEvents("/api/events?console=1");',context);
  const source=context.source,received=[],errors=[];
  for(const type of ['message','state'])source.addEventListener(type,event=>{try{received.push({type,data:JSON.parse(event.data)});}catch(error){errors.push(error.message);}});
  return {received,errors,receive:data=>source.socket.onmessage({data})};
}

test('昵称、弹幕和状态中的Unicode分隔符不截断推送，合并消息与心跳正常解析',()=>{
  const browser=browserEvents();
  const messages=[
    {type:'state',data:{live:{title:'直播\u2028标题\u2029后半段'}}},
    {type:'message',data:{user:'观众\u2028昵称',text:'弹幕\u2029内容\r\n下一行'}},
    {type:'message',data:{user:'正常观众',text:'后续消息继续接收'}}
  ];
  browser.receive(': heartbeat\n\n'+messages.map(({type,data})=>`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join(''));
  assert.deepEqual(browser.errors,[]);
  assert.deepEqual(browser.received,messages);
});

test('抖音弹幕经过服务端WebSocket后仍完整到达控制台，后续消息和接口不受影响',async t=>{
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'luobo-events-'));
  let runtime,socket;
  t.after(async()=>{socket?.terminate();await runtime?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-events-'));await fs.promises.rm(dir,{recursive:true,force:true});});
  runtime=await startServer({dataDir:dir});
  assert.equal((await fetch(runtime.url+'/api/platform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({platform:'douyin'})})).status,200);
  const browser=browserEvents();
  await new Promise((resolve,reject)=>{
    socket=new WebSocket(runtime.url.replace('http:','ws:')+'/api/events/socket?console=1',{origin:runtime.url});
    socket.on('message',body=>browser.receive(String(body)));
    socket.once('message',resolve);socket.once('error',reject);
  });
  for(const text of ['弹幕\u2028后半段\u2029保留','后续正常弹幕'])runtime.services.douyinMessage({type:'chat',user:'观众\u2028昵称',text,uid:'123'});
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.deepEqual(browser.errors,[]);
  assert.deepEqual(browser.received.filter(event=>event.type==='message').map(event=>event.data.text),['弹幕\u2028后半段\u2029保留','后续正常弹幕']);
  assert.equal((await fetch(runtime.url+'/api/state')).status,200);
});
