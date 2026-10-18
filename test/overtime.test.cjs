const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OvertimeMachine, normalizeConfig } = require('../lib/overtime.cjs');
const { parseMinutes, formatDuration, ruleKey, panelRules, panelEntries, normalizePanelStyle } = require('../public/overtime/shared.js');
const { atomicJson } = require('../lib/services.cjs');
const { startServer } = require('../server.cjs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const config = { initial_text:'60', time_unit:'分钟', clear_lock_default_unlocked:true, gift_rules:[
  { gift_name:'加班花', gift_id:1, operation:'add', value:30 },
  { gift_name:'翻倍', gift_id:2, operation:'multiply', value:2 },
  { gift_name:'减半', gift_id:3, operation:'divide', value:2 },
  { gift_name:'下班', gift_id:4, operation:'clear', value:1 },
  { gift_name:'锁', gift_id:5, operation:'lock_toggle', value:1 },
  { gift_name:'减班花', gift_id:6, operation:'subtract', value:30 }
] };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'luobo-overtime-'));
  t.after(async () => { assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'luobo-overtime-')); await fs.rm(dir,{ recursive:true, force:true }); });
  await atomicJson(path.join(dir,'seed','overtime.json'), config);
  let now = 0;
  const machine = await new OvertimeMachine(dir,{ seedDir:path.join(dir,'seed'), clock:() => now }).init();
  const gift = (giftId, uid = 1, count = 1, extra = {}) => machine.receive({ type:'gift', giftId, uid, user:`观众${uid}`, count, ...extra });
  return { dir, machine, gift, advance:milliseconds => now += milliseconds };
}

test('时间解析与完整显示：科学计数、中文单位、大数秒级精度及输入边界', () => {
  assert.equal(parseMinutes('1.5小时'),90n); assert.equal(parseMinutes('2','小时'),120n);
  assert.equal(parseMinutes('1.5京'),15000000000000000n); assert.equal(parseMinutes('1e100'),10n ** 100n);
  assert.equal(parseMinutes('1古戈尔'),10n ** 100n); assert.equal(parseMinutes('1万天'),14400000n);
  assert.equal(parseMinutes('0.5'),1n); assert.equal(parseMinutes('1e-1小时'),6n);
  assert.equal(formatDuration(3661n),'1小时  1分  1秒');
  const giant = 10n ** 100n * 60n;
  assert.notEqual(formatDuration(giant),formatDuration(giant-1n)); assert.match(formatDuration(giant-1n),/59秒$/);
  assert.equal(formatDuration(0n),'0秒');
  for (const invalid of ['0','-1','Infinity','1abc','1e99999999','2古戈尔','1e-99999','1.2.3']) assert.throws(() => parseMinutes(invalid));
  assert.throws(() => normalizeConfig({ ...config,gift_rules:[config.gift_rules[0],config.gift_rules[0]] }),/同一个礼物/);
  assert.throws(() => normalizeConfig({ ...config,gift_rules:[{...config.gift_rules[0],operation:'__proto__'}] }));
});

test('UID识别、连送和实际加减差额；自然倒计时与手动操作不污染观众统计', async t => {
  const { machine,gift,advance } = await fixture(t);
  await gift(1); assert.equal(machine.state.people.length,0);
  await machine.action({ action:'start' }); advance(2000);
  await gift(1,1,2,{ user:'同名', face:'http://i0.hdslb.com/avatar.png' }); assert.equal(machine.remaining(),7198n);
  assert.equal(machine.state.people[0].face,'https://i0.hdslb.com/avatar.png'); assert.equal(machine.state.history[0].face,machine.state.people[0].face);
  await gift(2,2,3,{ user:'同名' }); assert.equal(machine.remaining(),57584n);
  assert.equal(machine.state.people[1].added,'50386');
  await gift(3,1,1,{ user:'改名' }); assert.equal(machine.remaining(),28792n);
  assert.equal(machine.state.people[0].face,'https://i0.hdslb.com/avatar.png');
  assert.equal(machine.state.people.length,2); assert.equal(machine.state.people[0].user,'改名'); assert.equal(machine.state.people[0].reduced,'28792');
  assert.equal(machine.state.history[0].user,'改名'); assert.equal(machine.state.history[0].operation,'divide');
  const people = structuredClone(machine.state.people);
  advance(5000); await machine.action({ action:'manual', operation:'subtract', minutes:'1' });
  assert.equal(machine.remaining(),28727n); assert.deepEqual(machine.state.people,people);
  await machine.action({ action:'pause' }); advance(10000); assert.equal(machine.remaining(),28727n);
  await gift(1,3,1); assert.equal(machine.remaining(),30527n);
  await gift(1,4,1,{face:'http://127.0.0.1/secret'}); assert.equal(machine.state.people[3].face,'');
});

test('减半保底不反向加班，锁按数量切换，锁住清空不计减班，下班后可再次加时间', async t => {
  const { machine,gift,advance } = await fixture(t);
  await machine.action({ action:'start' });
  await gift(3,1,10000); assert.equal(machine.remaining(),60n); assert.equal(machine.state.people[0].reduced,'3540');
  advance(30000); await gift(3,2); assert.equal(machine.remaining(),30n); assert.equal(machine.state.people.length,1);
  await gift(5,2,2); assert.equal(machine.state.clear_locked,false);
  await gift(5,2,3); assert.equal(machine.state.clear_locked,true);
  await gift(4,2); assert.equal(machine.remaining(),30n); assert.equal(machine.state.history[0].blocked,true); assert.equal(machine.state.history[0].reduced,'0');
  await gift(5,2); await gift(4,2); assert.equal(machine.remaining(),0n); assert.equal(machine.state.people[1].reduced,'30');
  await gift(2,3); assert.equal(machine.remaining(),0n); assert.equal(machine.state.history[0].added,'0');
  await gift(1,3); assert.equal(machine.remaining(),1800n);
  await gift(6,3,10); assert.equal(machine.remaining(),0n); assert.equal(machine.state.people[2].reduced,'1800');
});

test('交易去重、兼容ID、测试观众隔离、重启保存及失败不提交', async t => {
  const { machine,gift,dir } = await fixture(t); await machine.action({ action:'start' });
  await gift(99,1,1,{ transactionId:'first', giftAliases:[1,99] });
  const remaining = machine.remaining(); await gift(99,1,1,{ transactionId:'first',giftAliases:[1,99] }); assert.equal(machine.remaining(),remaining);
  await machine.action({ action:'simulate', rule:0,user:'观众1',count:1 });
  assert.equal(machine.state.people.length,2); assert.equal(machine.state.people[1].simulated,true);
  await machine.checkpoint(); const reload = await new OvertimeMachine(dir).init();
  assert.equal(reload.state.mode,'paused'); assert.equal(reload.remaining(),7200n); assert.deepEqual(reload.state.people,machine.state.people);
  await assert.rejects(machine.action({ action:'simulate', rule:0,user:'观众',count:1.5 }));
  await assert.rejects(gift(2,1,10000),/1000位/); assert.equal(machine.remaining(),7200n);
  const state = structuredClone(machine.state), anchor = machine.anchor, file = machine.file;
  const blocked = path.join(dir,'blocked'); await fs.mkdir(blocked); machine.file = blocked;
  await assert.rejects(gift(1)); assert.deepEqual(machine.state,state); assert.equal(machine.anchor,anchor); machine.file = file;
  await machine.action({ action:'reset' }); assert.equal(machine.remaining(),3600n); assert.equal(machine.state.people.length,0); assert.equal(machine.state.history.length,0);
  await machine.action({ action:'clear_stats' }); assert.equal(machine.state.people.length,0); assert.equal(machine.state.history.length,0);
});

test('旧版配置迁移只带时间与规则，不覆盖已有统计、不带SESSDATA', async t => {
  const { machine,dir,gift } = await fixture(t);
  const legacy = path.join(dir,'legacy.json'); await atomicJson(legacy,{ ...config,sessdata:'never-export',room_id:'6' });
  const other = path.join(dir,'other'); const fresh = await new OvertimeMachine(other,{legacyFiles:[legacy]}).init();
  assert.equal(fresh.state.config.initial_minutes,'60'); assert.equal(JSON.stringify(fresh.snapshot()).includes('never-export'),false);
  await machine.action({ action:'start' }); await gift(1);
  const reloaded = await new OvertimeMachine(dir,{legacyFiles:[legacy]}).init(); assert.equal(reloaded.state.people.length,1);
  await machine.action({ action:'import',config:{...config,initial_text:'1古戈尔'} });
  assert.equal(machine.state.people.length,1); assert.equal(machine.remaining(),5400n);
  await machine.action({ action:'reset' }); assert.equal(machine.remaining(),10n ** 100n * 60n);
  await machine.action({ action:'start' }); await gift(2); assert.equal(machine.remaining(),2n * 10n ** 100n * 60n);
});

test('全部重置恢复初始时间与清空锁，并同步清空及保存全部统计和明细', async t => {
  const {machine,gift,dir}=await fixture(t);
  await machine.action({action:'configure',config:{...config,clear_lock_default_unlocked:false}});await machine.action({action:'start'});
  await gift(1,1,2,{transactionId:'before-reset'});await gift(3,2);await gift(5,3);await machine.action({action:'pause'});
  assert.equal(machine.state.people.length,2);assert.equal(machine.state.history.length,3);assert.equal(machine.state.clear_locked,false);
  const savedConfig=structuredClone(machine.state.config), oldState=structuredClone(machine.state), file=machine.file;
  const blocked=path.join(dir,'reset-blocked');await fs.mkdir(blocked);machine.file=blocked;
  await assert.rejects(machine.action({action:'reset'}));assert.deepEqual(machine.state,oldState);machine.file=file;
  let pushed;machine.once('state',state=>pushed=state);
  await machine.action({action:'reset'});
  assert.equal(machine.remaining(),3600n);assert.equal(machine.state.mode,'paused');assert.equal(machine.state.clear_locked,true);
  assert.deepEqual(machine.state.config,savedConfig);assert.deepEqual(machine.state.people,[]);assert.deepEqual(machine.state.history,[]);
  assert.deepEqual(pushed.people,[]);assert.deepEqual(pushed.history,[]);assert.equal(pushed.remaining,'3600');
  const reload=await new OvertimeMachine(dir).init();assert.deepEqual(reload.state.people,[]);assert.deepEqual(reload.state.history,[]);assert.equal(reload.remaining(),3600n);
  await gift(1,1,2,{transactionId:'before-reset'});assert.equal(machine.remaining(),3600n);assert.equal(machine.state.history.length,0);
  await gift(1,1,1,{transactionId:'after-reset'});assert.equal(machine.state.people[0].added,'1800');assert.equal(machine.state.people[0].reduced,'0');
});

test('服务整合：真实新旧礼物共用直播连接，事件同步、跨来源保护与浮窗页面', async t => {
  const {dir} = await fixture(t);
  await atomicJson(path.join(dir,'seed','gifts.json'),{list:[],updatedAt:null});
  const runtime = await startServer({dataDir:path.join(dir,'runtime'),seedDir:path.join(dir,'seed')});
  try {
    const post = async input => fetch(runtime.url+'/api/overtime/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    assert.equal((await post({action:'start'})).status,200);
    const controller = new AbortController();
    const response = await fetch(runtime.url+'/api/events?overtime=1',{signal:controller.signal});
    const reader = response.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value),/event: overtime/);
    runtime.services.liveMessage({cmd:'SEND_GIFT',data:{uname:'直播观众',uid:123,giftId:1,giftName:'加班花',num:2,tid:'live-1'}});
    const update = new TextDecoder().decode((await reader.read()).value);
    assert.match(update,/直播观众/); controller.abort();
    const state = await (await fetch(runtime.url+'/api/overtime/state')).json(); assert.equal(state.people[0].uid,123); assert.equal(state.people[0].added,'3600');
    for (const page of ['/overtime/','/overtime/shared.js','/overtime/overlay.js','/overtime/overlay.css','/overtime/radish.svg','/overtime-console.js','/overtime-console.css']) assert.equal((await fetch(runtime.url+page)).status,200,page);
    assert.equal((await fetch(runtime.url+'/api/overtime/export')).status,200);
    const denied = await fetch(runtime.url+'/api/overtime/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{"action":"clear"}'}); assert.equal(denied.status,403);
    assert.equal((await post({action:'simulate',rule:0,user:'观众',count:-1})).status,400);
    const main = await (await fetch(runtime.url)).text(); assert.match(main,/overtime-view/); assert.match(main,/overtime\/shared.js/);
  } finally { await runtime.close(); }
});

test('浮窗拖动：位置跟随屏幕鼠标、尺寸固定、松手停止、其他页面不能控制', async () => {
  const ipcMain = new EventEmitter(); let cursor = {x:100,y:200}; const updates=[];
  const webContents = {getURL:()=> 'http://127.0.0.1:3181/overtime/'};
  const floating = {isDestroyed:()=>false,webContents,getContentBounds:()=>({x:10,y:20,width:960,height:680}),setContentBounds:bounds=>updates.push(bounds)};
  const electron = {app:{setName(){},requestSingleInstanceLock:()=>false,quit(){}},ipcMain,screen:{getCursorScreenPoint:()=>cursor}};
  const context=vm.createContext({require:name=>name==='electron'?electron:name==='./server.cjs'?{startServer(){}}:require(name),__dirname:path.join(__dirname,'..'),floating});
  vm.runInContext(await fs.readFile(path.join(__dirname,'..','desktop.cjs'),'utf8'),context);
  vm.runInContext('runtime={url:"http://127.0.0.1:3181"};overtimeWindow=floating;overtimeSize={width:960,height:680};',context);
  ipcMain.emit('overtime-drag',{sender:{}},'start'); cursor={x:120,y:230}; ipcMain.emit('overtime-drag',{sender:webContents},'move'); assert.equal(updates.length,0);
  ipcMain.emit('overtime-drag',{sender:webContents},'start');
  for(let i=0;i<100;i++) {cursor={x:120+i,y:230+i*2};ipcMain.emit('overtime-drag',{sender:webContents},'move');}
  assert.equal(updates.length,100);
  for(const update of updates) {assert.equal(update.width,960);assert.equal(update.height,680);}
  assert.equal(updates[99].x,109);assert.equal(updates[99].y,218);
  ipcMain.emit('overtime-drag',{sender:webContents},'end');ipcMain.emit('overtime-drag',{sender:webContents},'move');assert.equal(updates.length,100);
  ipcMain.emit('overtime-drag',{sender:webContents},'resize-start');cursor={x:cursor.x+100,y:cursor.y+80};ipcMain.emit('overtime-drag',{sender:webContents},'resize-move');
  assert.equal(updates[100].width,1060);assert.equal(updates[100].height,760);assert.equal(updates[100].x,10);assert.equal(updates[100].y,20);
  cursor={x:-10000,y:-10000};ipcMain.emit('overtime-drag',{sender:webContents},'resize-move');assert.equal(updates[101].width,320);assert.equal(updates[101].height,180);
  vm.runInContext('panelWindows.set("panel-1",{window:floating,url:runtime.url+"/overtime/?panel=panel-1",size:{width:640,height:360}});overtimeWindow=null;',context);
  webContents.getURL = () => 'http://127.0.0.1:3181/overtime/?panel=panel-1';
  ipcMain.emit('overtime-drag',{sender:webContents},'resize-start');cursor={x:-20000,y:-20000};ipcMain.emit('overtime-drag',{sender:webContents},'resize-move');
  assert.equal(updates[102].width,240);assert.equal(updates[102].height,160);
  webContents.getURL = () => 'http://127.0.0.1:3181/overtime/?panel=other';
  ipcMain.emit('overtime-drag',{sender:webContents},'end');assert.equal(updates.length,103);
});

test('多个礼物面板：配置校验、选择规则、独立保存、旧配置兼容与重启恢复', async t => {
  const {machine,dir,gift,advance} = await fixture(t);
  assert.deepEqual(machine.state.config.gift_panels,[]);
  await machine.action({action:'start'}); await gift(1); await machine.action({action:'lock'});
  const panel = {id:'panel-1',name:'加班礼物',columns:2,template:'overtime',style:normalizePanelStyle(),all_rules:false,gift_keys:[ruleKey(config.gift_rules[0])]};
  const panels = [panel,{...panel,id:'panel-2',name:'全部礼物',columns:1,all_rules:true,gift_keys:[]}];
  const remaining = machine.remaining(), people = structuredClone(machine.state.people), anchor = machine.anchor;
  advance(500);
  await machine.action({action:'panels',panels});
  assert.equal(machine.remaining(),remaining);assert.equal(machine.anchor,anchor);assert.equal(machine.state.clear_locked,true);assert.deepEqual(machine.state.people,people);
  assert.deepEqual(panelRules(panel,config.gift_rules),[config.gift_rules[0]]);
  assert.deepEqual(panelRules(panels[1],config.gift_rules),config.gift_rules);
  assert.equal(panelRules(panel,[{...config.gift_rules[0],gift_name:'改名礼物'}]).length,1);
  assert.equal(panelRules(panel,[]).length,0);
  for (const bad of [[panel,panel],[{...panel,id:'../bad'}],[{...panel,columns:4}],[{...panel,name:''}],[{...panel,gift_keys:['bad']}],Array.from({length:21},(_,i)=>({...panel,id:`panel-${i}`}))]) {
    await assert.rejects(machine.action({action:'panels',panels:bad}));assert.deepEqual(machine.state.config.gift_panels,panels);
  }
  await machine.action({action:'import',config});assert.deepEqual(machine.state.config.gift_panels,panels);
  await machine.action({action:'reset'});assert.deepEqual(machine.state.config.gift_panels,panels);
  const reload = await new OvertimeMachine(dir).init();assert.deepEqual(reload.state.config.gift_panels,panels);
  await machine.action({action:'panels',panels:[panels[1]]});assert.equal(machine.state.config.gift_panels.length,1);assert.equal(machine.state.config.gift_rules.length,config.gift_rules.length);
});

test('礼物面板模板：旧面板迁为加班机模板，自定义文字独立保存与展示，不添加加班作用', async t => {
  const {machine,dir,gift} = await fixture(t);
  const legacy = {id:'old-panel',name:'旧面板',columns:1,all_rules:true,gift_keys:[]};
  await machine.action({action:'panels',panels:[legacy]});
  assert.equal(machine.state.config.gift_panels[0].template,'overtime');
  assert.equal(panelEntries(machine.state.config.gift_panels[0],config.gift_rules)[0].text,'＋30 分钟');
  const panel = {id:'custom-panel',name:'点歌规则',columns:2,template:'custom',style:normalizePanelStyle(),entries:[{gift_id:88,gift_name:'点歌礼物',text:'点一首歌\n歌曲自选 <script>alert(1)</script>'},{gift_id:89,gift_name:'运动礼物',text:'做10个深蹲'}]};
  await machine.action({action:'start'});await machine.action({action:'lock'});
  await machine.action({action:'panels',panels:[machine.state.config.gift_panels[0],panel]});
  assert.equal(machine.state.clear_locked,true);
  assert.deepEqual(panelEntries(panel,[]),panel.entries);
  const rules = structuredClone(machine.state.config.gift_rules), before = machine.remaining();
  await gift(88);assert.equal(machine.remaining(),before);assert.deepEqual(machine.state.config.gift_rules,rules);assert.equal(machine.state.people.length,0);
  for (const invalid of [{...panel,template:'unknown'},{...panel,entries:null},{...panel,entries:[{...panel.entries[0],text:''}]},{...panel,entries:[{...panel.entries[0],text:'字'.repeat(201)}]},{...panel,entries:[{...panel.entries[0],gift_id:-1}]},{...panel,entries:[{...panel.entries[0],gift_name:''}]}]) {
    await assert.rejects(machine.action({action:'panels',panels:[invalid]}));assert.deepEqual(machine.state.config.gift_panels[1],panel);
  }
  const reload = await new OvertimeMachine(dir).init();assert.deepEqual(reload.state.config.gift_panels[1],panel);
  const exported = machine.snapshot().config;
  await machine.action({action:'import',config:exported});assert.deepEqual(machine.state.config.gift_panels[1],panel);
});

test('面板样式：旧配置默认样式、独立字体颜色描边、保存恢复与输入边界', async t => {
  const {machine,dir} = await fixture(t);
  const oldPanel = {id:'old-style',name:'加班',template:'overtime',columns:1,all_rules:true,gift_keys:[]};
  await machine.action({action:'panels',panels:[oldPanel]});
  assert.deepEqual(machine.state.config.gift_panels[0].style,normalizePanelStyle());
  const style = normalizePanelStyle({transparent:true,background:'#ABCDEF',show_gift_name:true,gift_text_gap:24,title:{size:36,font:'KaiTi',color:'#000000',stroke_color:'#ffffff',stroke_width:3},gift:{size:24,font:'SimHei',color:'#112233',stroke_color:'#ffffff',stroke_width:2},effect:{size:20,font:'Arial',color:'#554433',stroke_color:'#ffffff',stroke_width:1.5}});
  assert.equal(style.background,'#abcdef');
  const panel = {...oldPanel,id:'new-style',style};
  await machine.action({action:'panels',panels:[oldPanel,panel]});
  assert.deepEqual(machine.state.config.gift_panels[1].style,style);assert.equal(machine.state.config.gift_panels[0].style.transparent,false);
  for (const bad of [null,{transparent:'yes'},{background:'url(http://bad)'},{title:{font:'Arial; color:red'}},{title:{font:''}},{gift:{size:7}},{gift:{size:121}},{effect:{stroke_width:-1}},{effect:{stroke_width:9}},{effect:{stroke_width:0.2}},{effect:{color:'#000'}}]) {
    await assert.rejects(machine.action({action:'panels',panels:[{...panel,style:bad}]}));assert.equal(machine.state.config.gift_panels.length,2);
  }
  const reload = await new OvertimeMachine(dir).init();assert.deepEqual(reload.state.config.gift_panels[1].style,style);
  await machine.action({action:'import',config:machine.snapshot().config});assert.deepEqual(machine.state.config.gift_panels[1].style,style);
});
