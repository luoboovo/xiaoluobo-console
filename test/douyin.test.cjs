const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {EventEmitter}=require('node:events');
const {gzipSync}=require('node:zlib');
const {startServer}=require('../server.cjs');
const {ConsoleServices}=require('../lib/services.cjs');
const {protobufFields}=require('../lib/protocol.cjs');
const {parseRoomHtml,douyinRoom,douyinImage,normalizeGifts,decodeFrame,GiftCounter,field,varint}=require('../lib/douyin.cjs');
const {bindings}=require('../lib/platform-games.cjs');
const {SHOP_GIFTS}=require('../lib/noodle/config.cjs');
const numeric=(key,value)=>Buffer.concat([varint(key*8),varint(value)]);
const fixtureMessage=(method,body,id)=>Buffer.concat([field(1,method),field(2,body),numeric(3,id)]);
function giftFrame(count=1,messageId=1,end=0){
  const person=Buffer.concat([numeric(1,'9007199254740993'),field(3,'抖音观众'),field(9,field(1,'https://p3.douyinpic.com/face.png'))]);
  const gift=Buffer.concat([numeric(5,463),numeric(10,1),numeric(12,1),field(16,'小心心')]);
  const body=Buffer.concat([numeric(2,463),numeric(5,count),field(7,person),numeric(9,end),numeric(11,999),field(15,gift)]);
  const response=Buffer.concat([field(1,fixtureMessage('WebcastGiftMessage',body,messageId)),field(5,'ack-context'),numeric(9,1)]);
  return Buffer.concat([numeric(2,'9007199254740995'),field(7,'msg'),field(8,gzipSync(response))]);
}
async function temporary(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-douyin-'));
  t.after(async()=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-douyin-'))throw new Error('清理路径无效');await fs.rm(dir,{recursive:true,force:true});});
  return dir;
}
test('抖音房间、图片与礼物库严格校验，不接受任意主机或失真数值',()=>{
  assert.equal(douyinRoom('https://live.douyin.com/123456?from=test'),'123456');
  assert.equal(douyinRoom('live.douyin.com/123456'),'123456');
  for(const url of ['https://evil.com/123','https://live.douyin.com.evil.com/123','https://user@live.douyin.com/123','0','https://v.douyin.com/xxx'])assert.throws(()=>douyinRoom(url));
  for(const url of ['http://127.0.0.1/a','https://p3.douyinpic.com.evil.com/a','https://x@p3.douyinpic.com/a','https://p3.douyinpic.com:444/a'])assert.equal(douyinImage(url),'');
  assert.equal(normalizeGifts([{id:1,name:'花',diamond_count:1,image:{url_list:['https://p3.douyinpic.com/a.png']}},{id:2,name:'免费',diamond_count:0}]).length,1);
});
test('直播网页解析跳过空状态，正确识别下播和带引号的标题，不执行网页脚本',()=>{
  const flight=object=>'<script>self.__pace_f.push('+JSON.stringify([1,JSON.stringify(object)])+')</script>';
  const html=flight({state:{roomStore:{roomInfo:{}}}})+flight({state:{roomStore:{roomInfo:{roomId:'123',room:{status:4,title:'店铺"休息"'}}}}});
  assert.deepEqual(parseRoomHtml(html),{roomId:'123',status:4,title:'店铺"休息"'});
  assert.equal(parseRoomHtml('<script>throw new Error("不应执行")</script>'),null);
});
test('桌面连接参数获取：离线房间被拒绝，取消关闭隐藏网页并清理请求监听',async()=>{
  const {createDouyinDesktop}=require('../lib/douyin-desktop.cjs');
  const hooks={};let window;
  const browserSession={cookies:{get:async()=>[]},setPermissionRequestHandler(){},setUserAgent(){},webRequest:{onBeforeSendHeaders(filter,listener){hooks.headers=listener;},onBeforeRequest(filter,listener){hooks.request=listener;}}};
  const html='<script>self.__pace_f.push('+JSON.stringify([1,JSON.stringify({state:{roomStore:{roomInfo:{roomId:'123',room:{status:4,title:'休息'}}}}})])+')</script>';
  class FakeWindow extends EventEmitter{
    constructor(){super();window=this;this.webContents=new EventEmitter();Object.assign(this.webContents,{id:1,getUserAgent:()=>'',setUserAgent(){},setWindowOpenHandler(){},executeJavaScript:async()=>html});}
    loadURL(){queueMicrotask(()=>this.webContents.emit('dom-ready'));return Promise.resolve();}
    isDestroyed(){return !!this.destroyed;}
    destroy(){this.destroyed=true;this.emit('closed');}
  }
  const desktop=createDouyinDesktop({BrowserWindow:FakeWindow,session:{fromPartition:()=>browserSession},requestImpl:async()=>({body:Buffer.from('')})});
  await assert.rejects(desktop.bootstrap('123'),/未开播/);assert.equal(window.destroyed,true);assert.equal(hooks.headers,undefined);assert.equal(hooks.request,undefined);
  desktop.close();
});

test('中文产品名不进入抖音登录浏览器标识，页面与会话保持一致',async()=>{
  const {createDouyinDesktop}=require('../lib/douyin-desktop.cjs');
  const chrome='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
  for(const product of ['小萝卜游戏控制台/2.4.0','xiaoluobo-console/2.4.0','Electron/40.10.6']){
    let window,pageAgent,sessionAgent;
    const browserSession={cookies:{get:async()=>[]},setPermissionRequestHandler(){},setUserAgent(value){sessionAgent=value;}};
    class FakeWindow extends EventEmitter{
      constructor(){super();window=this;this.webContents=new EventEmitter();Object.assign(this.webContents,{getUserAgent:()=>chrome.replace(' Chrome/',` ${product} Chrome/`).replace(' Safari/',' Electron/40.10.6 Safari/'),setUserAgent(value){pageAgent=value;},setWindowOpenHandler(){}});}
      loadURL(){return Promise.resolve();}isDestroyed(){return !!this.destroyed;}destroy(){this.destroyed=true;this.emit('closed');}
    }
    const desktop=createDouyinDesktop({BrowserWindow:FakeWindow,session:{fromPartition:()=>browserSession}});
    const login=desktop.login();window.destroy();await login;
    assert.equal(pageAgent,chrome);assert.equal(sessionAgent,chrome);
  }
});
test('真实协议结构：gzip礼物帧、64位用户ID和ACK不丢精度，损坏输入被拒绝',()=>{
  const frame=giftFrame(3,100),decoded=decodeFrame(frame),gift=decoded.messages[0];
  assert.equal(gift.uid,'9007199254740993');assert.equal(gift.giftId,463);assert.equal(gift.user,'抖音观众');assert.equal(gift.count,3);assert.equal(gift.combo,true);
  const ack=protobufFields(decoded.ack);assert.equal(ack.get(2)[0],9007199254740995n);assert.equal(ack.get(7)[0].toString(),'ack');assert.equal(ack.get(8)[0].toString(),'ack-context');
  assert.throws(()=>decodeFrame(frame.subarray(0,frame.length-1)));assert.throws(()=>decodeFrame(Buffer.alloc(4*1024*1024+1)));
});
test('连送累计只结算增量，重复推送、末帧和乱序不额外触发',()=>{
  const counter=new GiftCounter(),counts=[];
  for(const [count,msg,end]of [[1,1,0],[2,2,0],[2,2,0],[2,3,1],[1,4,0],[4,5,0],[4,6,1]]){
    const event=counter.accept(decodeFrame(giftFrame(count,msg,end)).messages[0]);if(event)counts.push(event.count);
  }
  assert.deepEqual(counts,[1,1,2]);assert.equal(counts.reduce((a,b)=>a+b,0),4);
});
test('两个平台的默认玩法礼物全部存在且各自唯一，加班规则覆盖六种作用',()=>{
  for(const [platform,file]of [['bilibili','gifts.json'],['douyin','douyin-gifts.json']]){
    const catalog=require('../data/'+file).list,defaults=bindings(platform,catalog);
    const rules=[{gift_id:defaults.gift_id,gift_name:defaults.gift_name},defaults.water_gift,defaults.tip_gift,...Object.values(defaults.throw_gifts),...SHOP_GIFTS.map(kind=>defaults[kind+'_gift'])];
    assert.equal(rules.length,12);assert.equal(new Set(rules.map(r=>r.gift_id)).size,12);
    for(const rule of rules)assert.ok(catalog.some(g=>g.id===rule.gift_id&&g.name===rule.gift_name));
  }
});
test('集成：平台切换暂停旧玩法，礼物和统计隔离，旧平台页面不能写入新平台',async t=>{
  const dir=await temporary(t);let app=await startServer({dataDir:dir});t.after(()=>app.close());
  const post=(route,body,platform)=>fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(platform?{'X-Luobo-Platform':platform}:{})},body:JSON.stringify(body)});
  const biliGift=app.noodle.config.gift_id;
  assert.ok(app.noodle.config.thief_gift);assert.notEqual(app.noodle.config.gift_id,app.noodle.config.water_gift.gift_id);
  await app.noodle.action({action:'start'});await app.overtime.action({action:'start'});
  const biliMachine=app.overtime;
  assert.equal((await post('/api/platform',{platform:'douyin'})).status,200);
  assert.equal(biliMachine.state.mode,'paused');assert.equal(app.services.platform,'douyin');
  assert.equal(app.noodle.config.gift_name,'小心心');assert.notEqual(app.noodle.config.gift_id,biliGift);
  const stale=await post('/api/noodle/action',{action:'start'},'bilibili');assert.equal(stale.status,409);
  const operations=app.overtime.state.config.gift_rules.map(r=>r.operation);for(const op of ['add','subtract','multiply','divide','clear','lock_toggle'])assert.ok(operations.includes(op));
  await app.noodle.action({action:'start'});await app.overtime.action({action:'start'});
  for(const [count,msg,end]of [[1,1,0],[2,2,0],[2,3,1]])for(const event of decodeFrame(giftFrame(count,msg,end)).messages)app.services.douyinMessage(event);
  // 此操作排在礼物队列之后，确保两个玩法已完整处理。
  await post('/api/noodle/action',{action:'pause'},'douyin');
  assert.equal(app.noodle.queue.length,2);assert.equal(app.noodle.queue[0].uid,'9007199254740993');assert.equal(app.overtime.state.people.length,1);
  assert.equal(app.overtime.state.people[0].uid,'9007199254740993');assert.equal(app.overtime.state.people[0].added,'120');
  assert.equal((await post('/api/platform',{platform:'bilibili'})).status,200);assert.equal(app.noodle.config.gift_id,biliGift);assert.equal(app.noodle.queue.length,0);assert.equal(app.overtime.state.people.length,0);
  await app.noodle.save({...app.noodle.config,thief_gift:null});
  await app.close();app=await startServer({dataDir:dir});assert.equal(app.noodle.config.thief_gift,null);
  await post('/api/platform',{platform:'douyin'});assert.equal(app.overtime.state.people.length,1);
});
test('抖音传输：本机生成连接、心跳、解码、ACK和取消隔离，不导出凭证',async t=>{
  const dir=await temporary(t);let socket;
  class FakeSocket extends EventEmitter{constructor(url,options){super();this.readyState=1;this.sent=[];socket=this;queueMicrotask(()=>this.emit('open'));}send(bytes){this.sent.push(bytes);}close(){this.readyState=3;this.emit('close');}}
  const service=await new ConsoleServices({dataDir:dir,seedDir:path.join(__dirname,'..','data'),douyin:{bootstrap:async()=>({url:'wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/?room_id=123',headers:{Cookie:'not-exported'},roomId:'123',title:'测试直播'}),account:async()=>({loggedIn:true,name:'已保存登录态'}),cancel(){}},DouyinSocket:FakeSocket}).init();t.after(()=>service.close());
  await service.selectPlatform('douyin');await service.connectLive('123');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(service.state.live.status,'connecting');socket.emit('message',giftFrame());assert.equal(service.state.live.status,'connected');assert.equal(service.events[0].giftName,'小心心');assert.equal(service.events[0].count,1);assert.ok(socket.sent.length>=2);
  assert.ok(!JSON.stringify(service.state).includes('not-exported'));
  await service.selectPlatform('bilibili');socket.emit('message',giftFrame(2,2));assert.equal(service.events.length,0);assert.equal(service.state.live.status,'disconnected');
});
test('臊子面、刀削面、咖啡厅、香锅的两平台绑定均填齐，点单触发正确玩法',async t=>{
  const dir=await temporary(t),{TemplateLibrary}=require('../lib/templates.cjs'),{NoodleShop}=require('../lib/noodle.cjs');
  const templates=await new TemplateLibrary(dir).init(),source=await new NoodleShop(dir,templates).init();
  for(const name of ['刀削面馆-v1.0.1.luobo','咖啡厅模板-v1.0.2.luobo','麻辣香锅-v1.0.4.luobo'])await source.installTemplate(JSON.parse(await fs.readFile(path.join(__dirname,'..','artifacts',name))));
  const app=await startServer({dataDir:dir});t.after(()=>app.close());
  for(const platform of ['bilibili','douyin']){
    if(platform!==app.services.platform)await fetch(app.url+'/api/platform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({platform})});
    assert.equal(app.noodle.presets.length,4);
    for(const preset of app.noodle.presets){
      await app.noodle.action({action:'preset_use',id:preset.id});
      const cfg=app.noodle.config;
      for(const rule of [cfg.tip_gift,...Object.values(cfg.throw_gifts),...SHOP_GIFTS.map(kind=>cfg[kind+'_gift'])])assert.ok(rule?.gift_id,`${platform}/${preset.name}存在空绑定`);
      if(app.noodle.template().workflow!=='jasmine-latte')assert.ok(cfg.water_gift?.gift_id);
      else assert.equal(cfg.water_gift,null);
      const baseline=app.noodle.queue.length;app.noodle.mode='running';
      await app.noodle.receive({type:'gift',giftId:cfg.gift_id,giftName:cfg.gift_name,count:1,uid:'9007199254740993',user:'点单测试',transactionId:preset.id});
      assert.equal(app.noodle.queue.length,baseline+1,`${platform}/${preset.name}点单没有触发`);
    }
  }
});
test('抖音礼物图片只清理礼物库外的旧图，直播中首次出现的礼物重启后仍在',async t=>{
  const dir=await temporary(t),seed=await temporary(t),icon='https://p3.douyinpic.com/kept.png';
  const hash=require('node:crypto').createHash('sha256').update(icon).digest('hex').slice(0,16);
  await fs.mkdir(path.join(dir,'images'),{recursive:true});
  await fs.writeFile(path.join(dir,'douyin-gifts.json'),JSON.stringify({list:[{id:1,name:'保留',price:1,icon}],updatedAt:null}));
  for(const name of [`dy-1-${hash}.png`,'dy-999-0000000000000000.png'])await fs.writeFile(path.join(dir,'images',name),'x');
  const service=await new ConsoleServices({dataDir:dir,seedDir:seed}).init();
  assert.deepEqual((await fs.readdir(path.join(dir,'images'))).sort(),[`dy-1-${hash}.png`]);
  await service.selectPlatform('douyin');
  const message=decodeFrame(giftFrame()).messages[0];service.douyinMessage(message);
  const added=service.gifts.find(g=>g.id===463);assert.ok(added);assert.equal(added.platform,'douyin');
  await service.flush();service.close();
  const saved=JSON.parse(await fs.readFile(path.join(dir,'douyin-gifts.json'),'utf8'));
  assert.ok(saved.list.some(g=>g.id===463&&g.name===added.name));
  const restarted=await new ConsoleServices({dataDir:dir,seedDir:seed}).init();
  assert.ok(restarted.dyGifts.some(g=>g.id===463));restarted.close();
});
