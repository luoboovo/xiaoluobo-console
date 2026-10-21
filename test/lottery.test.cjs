const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {LotteryGame,normalizeConfig,MAX_PLAYERS,MODES}=require('../lib/lottery.cjs');
const {startServer}=require('../server.cjs');
const {WebSocket}=require('ws');
const vm=require('node:vm');

async function fixture(t,{mode='wheel'}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-lottery-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let now=100000;
  const game=await new LotteryGame(dir,{mode,random:()=>0,now:()=>now}).init();
  return {dir,game,advance:ms=>now+=ms};
}
test('报名口令匹配、账号去重、超长抖音ID、暂停报名和同名观众',async t=>{
  const {game}=await fixture(t);
  const chat=(uid,text='参加',user='小萝卜')=>game.receiveChat({uid,text,user});
  await chat('1');assert.equal(game.state.players.length,0);
  await game.action({action:'enroll',open:true});
  await chat('1','我来参加');assert.equal(game.state.players.length,0);
  await Promise.all([chat('1234567890123456789'),chat('1234567890123456789')]);
  await chat('1234567890123456788');assert.equal(game.state.players.length,2);
  await game.action({action:'configure',config:{keyword:'决斗',match:'includes'}});
  await chat('2','我要决斗！','锦鲤');assert.equal(game.state.players.length,3);
  await chat(0,'决斗','无ID观众');await chat(0,'决斗','无ID观众');assert.equal(game.state.players.length,4);
  await game.action({action:'enroll',open:false});await chat('3','决斗');assert.equal(game.state.players.length,4);
});
test('手动名单去重、人数限制、非法输入以及失败不改动名单',async t=>{
  const {game}=await fixture(t);
  await game.action({action:'add',names:'A\r\nB\nA\nb\n<script>参与者</script>'});assert.equal(game.state.players.length,3);
  await assert.rejects(game.action({action:'add',names:'x'.repeat(41)}),/1～40/);
  await assert.rejects(game.action({action:'configure',config:{duration:NaN}}),/5～60/);
  await assert.rejects(game.action({action:'configure',config:{keyword:' '}}),/口令/);
  await game.action({action:'clear'});
  await game.action({action:'add',names:Array.from({length:MAX_PLAYERS},(_,i)=>'观众'+i).join('\n')});
  await assert.rejects(game.action({action:'add',names:'额外观众'}),/最多200/);assert.equal(game.state.players.length,MAX_PLAYERS);
  await game.action({action:'enroll',open:true});await game.receiveChat({uid:'new',text:'参加',user:'名额已满'});assert.equal(game.state.players.length,MAX_PLAYERS);
});
test('报名头像按账号保存，晚到头像同步本轮小人，拒绝外部地址并且不改变结果',async t=>{
  const {game,dir}=await fixture(t),uid='9999999999999999999';
  await game.action({action:'enroll',open:true});
  await game.receiveChat({uid,user:'头像观众',text:'参加',face:'http://i0.hdslb.com/first.png'});
  assert.equal(game.state.players[0].face,'https://i0.hdslb.com/first.png');
  await game.action({action:'start'});const round=game.state.round.id,winner=game.state.round.winner_id;
  await game.rememberFace({uid,face:'https://p3.douyinpic.com/new.png'});
  assert.equal(game.state.players[0].face,'https://p3.douyinpic.com/new.png');
  assert.equal(game.state.round.players[0].face,game.state.players[0].face);
  assert.equal(game.state.round.id,round);assert.equal(game.state.round.winner_id,winner);
  await game.rememberFace({uid,face:'http://127.0.0.1/private'});
  await game.rememberFace({uid:'另一个账号',face:'https://i0.hdslb.com/other.png'});
  assert.equal(game.state.round.players[0].face,'https://p3.douyinpic.com/new.png');
  const restored=await new LotteryGame(dir,{now:()=>100001}).init();
  assert.equal(restored.state.round.players[0].face,'https://p3.douyinpic.com/new.png');
  await game.deactivate();await game.action({action:'clear'});await game.action({action:'enroll',open:true});
  await game.receiveChat({uid,user:'默认脸',text:'参加',face:'https://evil.com/face.png'});
  assert.equal(game.state.players[0].face,'');
  await game.rememberFace({uid,face:'https://i0.hdslb.com/later.png'});assert.equal(game.state.players[0].face,'https://i0.hdslb.com/later.png');
});
test('转盘结果由服务端确定，开始后锁名单、只结算一次并移出中奖者',async t=>{
  const {game,advance}=await fixture(t);
  await assert.rejects(game.action({action:'start'}),/至少需要1/);
  await game.action({action:'add',names:'甲\n乙\n丙'});await game.action({action:'enroll',open:true});
  await game.action({action:'start'});const round=structuredClone(game.state.round);
  assert.equal(game.state.enrolling,false);assert.equal(new Set(round.order).size,3);
  await assert.rejects(game.action({action:'start'}),/正在进行/);
  await assert.rejects(game.action({action:'clear'}),/正在进行/);
  await assert.rejects(game.action({action:'configure',config:{mode:'duel'}}),/正在进行/);
  await game.receiveChat({uid:'4',user:'丁',text:'参加'});assert.equal(game.state.players.length,3);
  await game.tick();assert.equal(game.state.history.length,0);
  advance(12000);await game.tick();await game.tick();
  assert.equal(game.state.history.length,1);assert.equal(game.state.history[0].winner.id,round.winner_id);
  assert.equal(game.state.players.length,2);assert.ok(!game.state.players.some(p=>p.id===round.winner_id));
  assert.equal(game.state.round.players.length,3);
});
test('决斗至少两人、淘汰顺序公平覆盖、保留冠军以及重启恢复同一结果',async t=>{
  const {game,dir,advance}=await fixture(t,{mode:'duel'});
  await game.action({action:'configure',config:{mode:'duel',remove_winner:false,duration:5}});
  await game.action({action:'add',names:'甲'});await assert.rejects(game.action({action:'start'}),/至少需要2/);
  await game.action({action:'add',names:'乙\n丙\n丁'});await game.action({action:'start'});
  const round=structuredClone(game.state.round);
  const restarted=await new LotteryGame(dir,{mode:'duel',now:()=>200000}).init();
  assert.equal(restarted.state.round.id,round.id);assert.equal(restarted.state.history[0].winner.id,round.order.at(-1));
  assert.equal(restarted.state.players.length,4);assert.equal(restarted.state.enrolling,false);
  advance(5000);await game.tick();await game.action({action:'reset'});assert.equal(game.state.round,null);assert.equal(game.state.history.length,1);
  // Across all six three-person Fisher–Yates paths, each entrant wins twice.
  const wins={甲:0,乙:0,丙:0};
  for(let j=0;j<3;j++)for(let k=0;k<2;k++){
    let call=0;game.random=()=>call++===0?j:k;
    await game.action({action:'clear'});await game.action({action:'add',names:'甲\n乙\n丙'});await game.action({action:'start'});
    wins[game.state.round.players.find(p=>p.id===game.state.round.winner_id).name]++;
    advance(5000);await game.tick();
  }
  assert.deepEqual(wins,{甲:2,乙:2,丙:2});
});
test('切换平台中止未完成局、停止报名，历史和名单保留',async t=>{
  const {game,advance}=await fixture(t);await game.action({action:'add',names:'甲\n乙'});await game.action({action:'start'});
  await game.deactivate();advance(30000);await game.tick();assert.equal(game.state.round,null);assert.equal(game.state.players.length,2);assert.equal(game.state.history.length,0);assert.equal(game.state.enrolling,false);
});
test('桌面版允许独立抽奖窗口并继续拒绝外部和相似地址',async()=>{
  const desktop=await fs.readFile(path.join(__dirname,'../desktop.cjs'),'utf8');
  const body=desktop.split('window.webContents.setWindowOpenHandler(({ url }) => {')[1].split('\n    });')[0];
  const runtime={url:'http://127.0.0.1:3181',overtime:{state:{config:{gift_panels:[]}}}};
  const policy=vm.runInNewContext('({url})=>{'+body+'}',{runtime});
  const result=policy({url:runtime.url+'/lottery/?game=scratch'});
  assert.equal(result.action,'allow');assert.equal(result.overrideBrowserWindowOptions.width,1280);
  assert.equal(result.overrideBrowserWindowOptions.webPreferences.sandbox,true);
  assert.equal(result.overrideBrowserWindowOptions.webPreferences.nodeIntegration,false);
  for(const url of ['https://example.com/lottery/',runtime.url+'/lottery/evil',runtime.url+'.evil/lottery/'])assert.equal(policy({url}).action,'deny');
});
test('保存失败回滚且后续操作可以继续',async t=>{
  const {game,dir}=await fixture(t);await game.action({action:'add',names:'甲'});
  const original=game.file;game.file=dir;
  await assert.rejects(game.action({action:'clear'}));assert.equal(game.state.players.length,1);
  game.file=original;await game.action({action:'add',names:'乙'});assert.equal(game.state.players.length,2);
});
test('三个数据源分别保存名单、设置、报名与结果，重启后仍不混用',async t=>{
  const {dir}=await fixture(t),games=Object.fromEntries(await Promise.all(MODES.map(async mode=>[mode,await new LotteryGame(dir,{mode}).init()])));
  for(const [mode,game] of Object.entries(games)){
    await game.action({action:'add',names:mode+'甲\n'+mode+'乙'});
    await game.action({action:'enroll',open:true});
  }
  assert.deepEqual(MODES.map(mode=>games[mode].state.config.keyword),['参加','决斗','刮刮乐']);
  await games.wheel.action({action:'configure',config:{keyword:'转盘报名'}});
  await games.wheel.action({action:'clear'});
  assert.equal(games.duel.state.players.length,2);assert.equal(games.scratch.state.players.length,2);
  assert.equal(games.duel.state.enrolling,true);assert.equal(games.scratch.state.enrolling,true);
  await assert.rejects(games.wheel.action({action:'configure',config:{mode:'duel'}}),/数据源独立/);
  for(const mode of MODES){
    const reloaded=await new LotteryGame(dir,{mode}).init();
    assert.deepEqual(reloaded.state.players,games[mode].state.players);
    assert.equal(reloaded.state.config.keyword,games[mode].state.config.keyword);assert.equal(reloaded.state.enrolling,false);
    const saved=JSON.parse(await fs.readFile(path.join(dir,'lottery-'+mode+'.json'),'utf8'));
    assert.equal(saved.config.mode,mode);assert.ok(saved.players.every(p=>p.name.startsWith(mode)));
  }
});
test('迁移旧共享存档：名单只归原玩法，历史分流，原文件保留且清空后不回流',async t=>{
  const {dir}=await fixture(t),legacy={config:normalizeConfig({mode:'duel',keyword:'旧口令'}),players:[{id:'uid:1',name:'旧决斗观众'}],round:null,enrolling:true,history:[{id:'w',mode:'wheel',winner:{id:'a',name:'转盘结果'},time:1,count:2},{id:'d',mode:'duel',winner:{id:'b',name:'决斗结果'},time:2,count:3}]};
  const file=path.join(dir,'lottery.json'),content=JSON.stringify(legacy);await fs.writeFile(file,content);
  const wheel=await new LotteryGame(dir).init(),duel=await new LotteryGame(dir,{mode:'duel'}).init(),scratch=await new LotteryGame(dir,{mode:'scratch'}).init();
  assert.equal(wheel.state.players.length,0);assert.equal(duel.state.players[0].name,'旧决斗观众');assert.equal(scratch.state.players.length,0);
  assert.equal(duel.state.config.keyword,'旧口令');assert.equal(wheel.state.history[0].id,'w');assert.equal(duel.state.history[0].id,'d');
  assert.equal(await fs.readFile(file,'utf8'),content);
  await duel.action({action:'clear'});const reloaded=await new LotteryGame(dir,{mode:'duel'}).init();assert.equal(reloaded.state.players.length,0);assert.equal(reloaded.state.history.length,1);
});
test('签卡数量、独立奖级和替换失败回滚，不去重实体奖券',async t=>{
  const {game}=await fixture(t,{mode:'scratch'});
  await game.action({action:'add',names:'#S 惊喜大奖 * 1\n奶茶 × 5\n贴纸 * 20'});
  assert.equal(game.state.players.length,26);assert.equal(new Set(game.state.players.map(p=>p.id)).size,26);
  assert.equal(game.state.players[0].level,'S');assert.equal(game.state.players[1].level,'A');
  assert.equal(game.state.players.filter(p=>p.name==='奶茶').length,5);
  for(const names of ['奖项 * 201','奖项 * 0','奖项 * -1','x'.repeat(41)])await assert.rejects(game.action({action:'replace',names}));
  assert.equal(game.state.players.length,26);
  await game.action({action:'start'});await game.action({action:'replace',names:'新奖 * 2',remove_winner:false});
  assert.equal(game.state.round,null);assert.equal(game.state.players.length,2);assert.equal(game.state.config.remove_winner,false);
});

test('签卡摇动、选取、放回、隐藏结果、自动撕开只结算一次',async t=>{
  const {game,advance}=await fixture(t,{mode:'scratch'});
  await game.action({action:'add',names:'大奖 * 25'});
  const initial=await game.action({action:'start'}),id=initial.round.id,seed=initial.round.layout_seed;
  assert.equal(initial.round.status,'choosing');assert.equal(initial.round.order,undefined);assert.equal(initial.round.winner_id,null);
  await assert.rejects(game.action({action:'reveal',round_id:id}),/先选择/);
  await game.action({action:'shake',round_id:id});assert.equal(game.state.round.layout_seed,seed+1);
  await assert.rejects(game.action({action:'pick',round_id:'old',card:24}),/已更新/);
  await assert.rejects(game.action({action:'pick',round_id:id,card:25}),/有效/);
  const chosen=await game.action({action:'pick',round_id:id,card:24});const winner=game.state.round.winner_id;
  assert.equal(chosen.round.winner_id,null);
  await game.action({action:'cancel',round_id:id});assert.equal(game.state.round.status,'choosing');
  await game.action({action:'pick',round_id:id,card:24});assert.equal(game.state.round.winner_id,winner);
  await assert.rejects(game.action({action:'pick',round_id:id,card:0}),/已经选定/);
  await assert.rejects(game.action({action:'clear'}),/正在进行/);
  advance(60000);await game.tick();assert.equal(game.state.round.status,'revealing');
  await game.action({action:'reveal',round_id:id});assert.equal(game.state.round.status,'tearing');
  await game.action({action:'reveal',round_id:id});assert.equal(game.state.history.length,0);
  advance(1500);await game.tick();await game.tick();await game.action({action:'reveal',round_id:id});
  assert.equal(game.state.history.length,1);assert.equal(game.snapshot().round.winner_id,winner);assert.equal(game.state.players.length,24);
  await game.action({action:'reset'});await game.action({action:'start'});await game.action({action:'reset'});assert.equal(game.state.round,null);
});

test('手动撕开进度校验、不回退、半途重启保留选签和进度',async t=>{
  const {game,dir,advance}=await fixture(t,{mode:'scratch'});await game.action({action:'add',names:'好运奖\n惊喜奖'});await game.action({action:'start'});
  const id=game.state.round.id;await game.action({action:'pick',round_id:id});
  for(const progress of [-1,NaN,1.1,'1'])await assert.rejects(game.action({action:'peel',round_id:id,progress}),/进度无效/);
  await game.action({action:'peel',round_id:id,progress:.4});await game.action({action:'peel',round_id:id,progress:.2});assert.equal(game.state.round.peel,.4);
  const peeled=game.snapshot();assert.ok(peeled.round.ticket_level);assert.equal(peeled.round.winner_id,null);
  await assert.rejects(game.action({action:'cancel',round_id:id}),/已经撕开/);
  const restored=await new LotteryGame(dir,{mode:'scratch',now:()=>100000}).init();assert.equal(restored.state.round.id,id);assert.equal(restored.state.round.peel,.4);
  await game.action({action:'peel',round_id:id,progress:1});advance(450);await game.tick();assert.equal(game.state.round.status,'done');assert.equal(game.state.history.length,1);assert.equal(game.state.players.length,1);
});

test('HTTP与WebSocket按玩法隔离，同时报名与刷新推送不会串源',async t=>{
  const {dir}=await fixture(t),runtime=await startServer({dataDir:dir});t.after(()=>runtime.close());
  const post=async input=>{const response=await fetch(runtime.url+'/api/lottery/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,data:await response.json()};};
  const sockets=[],messages={wheel:[],duel:[],scratch:[],console:[]};t.after(()=>sockets.forEach(socket=>socket.terminate()));
  for(const mode of [...MODES,'console']){
    const socket=new WebSocket(runtime.url.replace('http:','ws:')+'/api/events/socket?'+(mode==='console'?'console=1':'lottery=1&game='+mode),{origin:runtime.url});sockets.push(socket);
    socket.on('message',frame=>{for(const match of String(frame).matchAll(/event: lottery\ndata: (.+)/g))messages[mode].push(JSON.parse(match[1]));});
    await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  }
  await Promise.all(MODES.map(game=>post({game,action:'add',names:game+'内容'})));
  for(const game of MODES)await post({game,action:'enroll',open:true});
  for(const text of ['参加','决斗','刮刮乐'])runtime.services.addEvent('chat','报名观众',text,{uid:'123'});
  for(let i=0;i<100&&!MODES.every(mode=>runtime.lottery[mode].state.players.length===2);i++)await new Promise(r=>setTimeout(r,10));
  await new Promise(r=>setTimeout(r,150));
  for(const mode of MODES){
    const state=await fetch(runtime.url+'/api/lottery/state?game='+mode).then(r=>r.json());assert.equal(state.game,mode);assert.equal(state.players[0].name,mode+'内容');assert.equal(state.players.length,2);
    assert.ok(messages[mode].length>=2);assert.ok(messages[mode].every(s=>s.game===mode));assert.equal(messages[mode].at(-1).players.length,2);
    assert.ok(messages.console.some(s=>s.game===mode&&s.players.length===2));
  }
  assert.equal((await post({game:'invalid',action:'clear'})).status,400);
  await post({game:'wheel',action:'start'});await post({game:'scratch',action:'start'});await post({game:'duel',action:'clear'});
  assert.equal(runtime.lottery.wheel.state.round.status,'running');assert.equal(runtime.lottery.scratch.state.round.status,'choosing');assert.equal(runtime.lottery.duel.state.players.length,0);
});
test('服务器弹幕路由、WebSocket同步、平台隔离和独立直播页面',async t=>{
  const {dir}=await fixture(t),runtime=await startServer({dataDir:dir});t.after(()=>runtime.close());
  const post=async(body,platform='bilibili',route='/api/lottery/action')=>{
    const response=await fetch(runtime.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Luobo-Platform':platform},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  const frames=[];
  const socket=new WebSocket(runtime.url.replace('http:','ws:')+'/api/events/socket?lottery=1',{origin:runtime.url});t.after(()=>socket.terminate());
  socket.on('message',frame=>frames.push(String(frame)));
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  runtime.services.addEvent('member','真人弹幕测试','进入直播间',{uid:'9999999999999999999',face:'https://i0.hdslb.com/cached.png'});
  await post({action:'enroll',open:true});runtime.services.addEvent('chat','真人弹幕测试','参加',{uid:'9999999999999999999'});
  for(let i=0;i<50&&runtime.lottery.wheel.state.players.length!==1;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(runtime.lottery.wheel.state.players[0].id,'uid:9999999999999999999');
  assert.equal(runtime.lottery.wheel.state.players[0].face,'https://i0.hdslb.com/cached.png');
  runtime.services.addEvent('member','真人弹幕测试','进入直播间',{uid:'9999999999999999999',face:'https://i0.hdslb.com/latest.png'});
  for(let i=0;i<50&&runtime.lottery.wheel.state.players[0].face!=='https://i0.hdslb.com/latest.png';i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(runtime.lottery.wheel.state.players[0].face,'https://i0.hdslb.com/latest.png');
  runtime.services.addEvent('member','B站数字账号','进入直播间',{uid:123,face:'https://i0.hdslb.com/bili.png'});
  runtime.services.addEvent('chat','B站数字账号','参加',{uid:123});
  for(let i=0;i<50&&runtime.lottery.wheel.state.players.length<2;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(runtime.lottery.wheel.state.players[1].face,'https://i0.hdslb.com/bili.png');
  await new Promise(r=>setTimeout(r,150));assert.ok(frames.some(f=>f.includes('真人弹幕测试')));assert.ok(frames.every(f=>!f.includes('event: feeding\n')));
  for(const url of ['/lottery/','/lottery/?capture=1','/lottery/game.js','/lottery/game.css','/lottery-console.js','/lottery-console.css'])assert.equal((await fetch(runtime.url+url)).status,200,url);
  await post({platform:'douyin'},'bilibili','/api/platform');assert.equal(runtime.lottery.wheel.state.players.length,0);assert.equal(runtime.lottery.wheel.platform,'douyin');
  assert.equal((await post({action:'start'})).status,409);
  await post({action:'add',names:'抖音选手'},'douyin');
  await post({platform:'bilibili'},'douyin','/api/platform');assert.equal(runtime.lottery.wheel.state.players[0].name,'真人弹幕测试');assert.equal(runtime.lottery.wheel.state.enrolling,false);
  assert.deepEqual(normalizeConfig(),{mode:'wheel',keyword:'参加',match:'exact',duration:12,remove_winner:true});
});
