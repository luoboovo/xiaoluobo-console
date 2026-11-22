const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {MowerGame,normalizeConfig,defaultRules}=require('../lib/mower.cjs');
const {panelFor}=require('../lib/game-panels.cjs');
const {startServer}=require('../server.cjs');
const {WebSocket}=require('ws');

async function removeDir(dir){assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()),'luobo-mower-')));await fs.rm(dir,{recursive:true,force:true});}
async function fixture(t,catalog=[]){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-mower-'));t.after(()=>removeDir(dir));
  let now=100000;
  return {dir,game:await new MowerGame(dir,{catalog,now:()=>now}).init(),advance:ms=>now+=ms};
}
const BOSS={gift_id:31036,gift_name:'小花花',effect:'boss',value:3000};

test('设置校验：默认值、范围、口令冲突和礼物规则',()=>{
  const c=normalizeConfig();
  assert.equal(c.hero_name,'小萝卜');assert.equal(c.blade_count,1,'默认只有一把镰刀');assert.equal(c.pickups,true);assert.deepEqual(c.gift_rules,[]);
  for(const input of [{hero_name:''},{hero_hp:50},{blade_count:13},{blade_count:2.5},{blade_speed:0},{auto_spawn:'yes'},{pickups:1},{pickup_interval_seconds:1},{chat_spawn_count:0},{chat_spawn_count:51},{chat_match_mode:'regex'},{user_cooldown_seconds:61},
    {chat_spawn_keyword:'冲',chat_heal_keyword:'冲'},{gift_rules:[{...BOSS,effect:'explode'}]},{gift_rules:[{...BOSS,value:0}]},{gift_rules:[{...BOSS,effect:'blade',value:13}]},{gift_rules:[{...BOSS,gift_name:''}]},{gift_rules:Array(51).fill(BOSS)},null,[]])
    assert.throws(()=>normalizeConfig(input),JSON.stringify(input));
  assert.equal(normalizeConfig({gift_rules:[{...BOSS,effect:'nuke',value:999}]}).gift_rules[0].value,1,'清屏不需要数值');
  assert.equal(normalizeConfig({gift_rules:[{...BOSS,effect:'weapon',value:0}]}).gift_rules[0].value,1,'空投武器不需要数值');
  assert.equal(normalizeConfig({chat_spawn_keyword:'',chat_heal_keyword:''}).chat_spawn_keyword,'','口令可以留空');
});

test('新存档按礼物库挑默认礼物，缺的礼物直接跳过',()=>{
  const rules=defaultRules('bilibili',[{id:1,name:'小花花',price:100},{id:2,name:'干杯',price:100}]);
  assert.deepEqual(rules.map(r=>[r.gift_id,r.effect]),[[1,'boss'],[2,'monster']]);
  assert.deepEqual(defaultRules('douyin',[]),[]);
});

test('只在游戏中接礼物和弹幕；礼物按数量换算，弹幕有冷却',async t=>{
  const {game,advance}=await fixture(t);
  await game.action({action:'configure',config:{gift_rules:[BOSS,{gift_id:0,gift_name:'干杯',effect:'swarm',value:10},{gift_id:31036,gift_name:'小花花',effect:'heal',value:5}]}});
  await game.receiveBatch([{giftId:31036,giftName:'小花花',count:2,user:'甲',uid:1}]);
  await game.receiveChat({uid:1,user:'甲',text:'冲'});
  assert.equal(game.cues.length,0,'没开始不接');
  await game.action({action:'start'});
  await game.receiveBatch([{giftId:31036,giftName:'小花花',count:2,user:'甲',uid:1,face:'https://i0.hdslb.com/a.png'},{giftId:9,giftName:'干杯',count:3,user:'乙',uid:2},{giftId:7,giftName:'别的礼物',count:1,uid:3}]);
  assert.deepEqual(game.cues.map(c=>[c.kind,c.value,c.user]),[['boss',6000,'甲'],['heal',10,'甲'],['swarm',30,'乙']],'一个礼物绑两个作用都触发，按名称匹配也行');
  assert.equal(game.cues[0].face,'https://i0.hdslb.com/a.png');
  await game.receiveChat({uid:5,user:'丙',text:'冲'});
  await game.receiveChat({uid:5,user:'丙',text:'加油'});
  advance(3000);await game.receiveChat({uid:5,user:'丙',text:'加油'});
  await game.receiveChat({uid:6,user:'丁',text:'冲冲冲'});
  assert.deepEqual(game.cues.slice(3).map(c=>[c.kind,c.user,c.value]),[['minion','丙',3],['heal','丙',20]],'冷却内忽略，完全匹配；默认一次派3只');
  await game.action({action:'configure',config:{chat_spawn_count:7}});advance(3000);await game.receiveChat({uid:5,user:'丙',text:'冲'});assert.equal(game.cues.at(-1).value,7,'派出数量可设置');game.cues.pop();
  const seqs=game.cues.map(c=>c.seq);assert.deepEqual(seqs,[...seqs].sort((a,b)=>a-b));
  await game.action({action:'pause'});
  await game.receiveBatch([{giftId:31036,count:1,uid:1}]);assert.equal(game.cues.length,5,'暂停不接');
});

test('主角图片、操作方式与新设置的校验',()=>{
  const c=normalizeConfig();
  assert.equal(c.control_mode,'keyboard','默认主播用键盘操作');assert.equal(c.hero_image,'');assert.equal(c.like_spawn,true);
  const image='/api/feeding/assets/'+'a'.repeat(64)+'.gif';
  assert.equal(normalizeConfig({hero_image:image}).hero_image,image);
  for(const input of [{hero_image:'https://evil.com/a.png'},{hero_image:'/api/feeding/assets/../x.png'},{hero_image:'/api/feeding/assets/'+'a'.repeat(64)+'.mp3'},{control_mode:'mouse'},{hero_size:30},{hero_speed:1000},{monster_growth_percent:-1},{likes_per_monster:0},{like_spawn:'on'},
    {gift_rules:[{...BOSS,effect:'monster',value:9}]},{gift_rules:[{...BOSS,effect:'disarm',value:61}]}])
    assert.throws(()=>normalizeConfig(input),JSON.stringify(input));
});

test('点赞攒够数量召唤小草；高级怪、扣血、缴械按礼物数量换算',async t=>{
  const {game}=await fixture(t);
  await game.action({action:'configure',config:{likes_per_monster:3,gift_rules:[{gift_id:1,gift_name:'甲',effect:'monster',value:4},{gift_id:2,gift_name:'乙',effect:'hurt',value:50},{gift_id:3,gift_name:'丙',effect:'disarm',value:50}]}});
  await game.receiveLike({uid:1,user:'点赞的人',count:2});
  assert.equal(game.cues.length,0,'没开始不接');
  await game.action({action:'start'});
  await game.receiveLike({uid:1,user:'点赞的人',count:2});
  assert.equal(game.cues.length,0,'不够3个赞');
  await game.receiveLike({uid:2,user:'又一个',count:8});
  assert.deepEqual(game.cues.map(c=>[c.kind,c.value,c.user]),[['like',3,'又一个']],'10个赞召唤3只，余1个留着');
  await game.receiveLike({uid:3,user:'狂点',count:100000});
  assert.equal(game.cues.at(-1).value,20,'一次最多20只');
  await game.receiveBatch([{giftId:1,count:5,user:'A'},{giftId:2,count:3,user:'B'},{giftId:3,count:4,user:'C'}]);
  assert.deepEqual(game.cues.slice(-3).map(c=>[c.kind,c.value,c.count]),[['monster',4,5],['hurt',150,3],['disarm',120,4]],'怪物数值是等级，缴械最多120秒');
  await game.action({action:'configure',config:{like_spawn:false}});
  const before=game.cues.length;await game.receiveLike({uid:1,count:50});assert.equal(game.cues.length,before,'关掉点赞召唤');
});

test('试送、决斗回报去重、重新开局与存档恢复',async t=>{
  const {dir,game}=await fixture(t);
  await assert.rejects(game.action({action:'simulate',rule:BOSS}),/先开始/);
  await game.action({action:'start'});
  const state=await game.action({action:'simulate',rule:BOSS,user:'测试A',count:3});
  const boss=state.cues.at(-1);assert.equal(boss.kind,'boss');assert.equal(boss.value,9000);assert.equal(boss.user,'测试A');
  await game.action({action:'report',cue_id:boss.id,result:'win',hp:9000});
  await game.action({action:'report',cue_id:boss.id,result:'lose'});
  await game.action({action:'report',cue_id:'nope',result:'win'});
  assert.deepEqual(game.state.stats,{bosses_defeated:1,hero_downs:0},'同一只BOSS只记一次');
  assert.equal(game.state.duels[0].user,'测试A');
  const roundBefore=game.state.round;
  await game.action({action:'reset'});
  assert.equal(game.state.mode,'idle');assert.equal(game.state.round,roundBefore+1);assert.equal(game.cues.length,0);
  await game.action({action:'start'});
  const restored=await new MowerGame(dir).init();
  assert.equal(restored.state.mode,'paused','重启后不自动继续');assert.equal(restored.state.duels.length,1);
  await game.action({action:'clear_history'});assert.deepEqual(game.state.duels,[]);
  await assert.rejects(game.action({action:'boom'}),/未知/);
});

test('礼物面板按割草规则生成',async t=>{
  const {game}=await fixture(t);
  await game.action({action:'configure',config:{gift_rules:[BOSS,{gift_id:2,gift_name:'干杯',effect:'blade',value:2}]}});
  const panel=panelFor('mower',{mower:game});
  assert.deepEqual(panel.entries.map(e=>e.text),['召唤你的头像BOSS来决斗','小萝卜加2把刀']);
  await game.action({action:'configure',config:{gift_rules:[{gift_id:3,gift_name:'牛哇牛哇',effect:'weapon',value:1}]}});
  assert.equal(panelFor('mower',{mower:game}).entries[0].text,'空投一把好武器');
});

test('本地API、直播消息入口、独立画面频道与平台隔离',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-mower-http-'));
  const runtime=await startServer({featuresOn:true,dataDir:dir,seedDir:path.join(__dirname,'../data')});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  const get=route=>fetch(runtime.url+route),post=(route,body,platform)=>fetch(runtime.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(platform?{'X-Luobo-Platform':platform}:{})},body:JSON.stringify(body)});
  for(const route of ['/mower/','/mower/game.js','/mower/game.css','/mower-console.js','/mower-console.css'])assert.equal((await get(route)).status,200,route);
  const socket=new WebSocket(runtime.url.replace('http:','ws:')+'/api/events/socket?mower=1',{origin:runtime.url}),frames=[];
  socket.on('message',message=>frames.push(String(message)));t.after(()=>socket.terminate());
  await new Promise((resolve,reject)=>{socket.once('message',resolve);socket.once('error',reject);});
  const initial=await (await get('/api/mower/state')).json();
  assert.ok(initial.config.gift_rules.some(r=>r.effect==='boss'),'B站默认礼物里有召唤BOSS');
  const bossGift=initial.config.gift_rules.find(r=>r.effect==='boss');
  assert.equal((await post('/api/mower/action',{action:'start'})).status,200);
  runtime.services.emit('event',{type:'chat',uid:'a',user:'甲',text:'冲',face:'https://i0.hdslb.com/a.png'});
  runtime.services.addGift({type:'gift',giftId:bossGift.gift_id,giftName:bossGift.gift_name,transactionId:'t1',count:2,uid:7,user:'乙'});
  await post('/api/mower/action',{action:'pause'});
  const snapshot=await (await get('/api/mower/state')).json();
  assert.deepEqual(snapshot.cues.map(c=>[c.kind,c.user]),[['minion','甲'],['boss','乙']]);
  assert.equal(snapshot.cues[1].value,bossGift.value*2);
  assert.equal((await post('/api/mower/action',{action:'start'},'douyin')).status,409);
  await post('/api/platform',{platform:'douyin'});
  assert.equal((await (await get('/api/mower/state')).json()).cues.length,0,'抖音一套独立数据');
  await post('/api/platform',{platform:'bilibili'});
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.ok(frames.some(frame=>/^event: mower$/m.test(frame)));
  assert.ok(frames.every(frame=>!/^event: (state|noodle|lottery|feeding|message|number-bomb)$/m.test(frame)),'画面频道只收割草');
});

test('只有一个主画面算战斗：操作窗口优先，关掉或卡住时其他画面立刻接手',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-mower-relay-'));
  const runtime=await startServer({dataDir:dir,seedDir:path.join(__dirname,'../data')});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  const open=async query=>{
    const socket=new WebSocket(runtime.url.replace('http:','ws:')+'/api/events/socket?'+query,{origin:runtime.url}),frames=[];
    socket.on('message',m=>frames.push(String(m)));t.after(()=>socket.terminate());
    await new Promise((resolve,reject)=>{socket.once('message',resolve);socket.once('error',reject);});
    await wait();
    const c={socket,frames,got:tag=>frames.filter(f=>f.startsWith('event: mower-frame')&&f.includes(tag)).length,
      leader:()=>{const roles=frames.filter(f=>f.startsWith('event: mower-role'));return roles.at(-1)?.includes('"leader":true')??false;}};
    return c;
  };
  const wait=(ms=120)=>new Promise(resolve=>setTimeout(resolve,ms));
  const send=(c,tag,platform='bilibili')=>c.socket.send(JSON.stringify({type:'mower-frame',platform,frame:{tag}}));
  const preview=await open('mower=1&preview=1');
  assert.equal(preview.leader(),true,'只有预览时，预览自己算');
  const obs=await open('mower=1');
  assert.equal(obs.leader(),false,'已有主画面时，新画面只跟着显示');
  const play=await open('mower=1&play=1');await wait();
  assert.equal(play.leader(),true,'操作窗口一打开就当主画面');assert.equal(preview.leader(),false);
  const bomb=await open('bomb=1');
  send(play,'A');send(obs,'X');await wait();
  assert.equal(obs.got('"A"'),1,'其他画面收到主画面的帧');assert.equal(preview.got('"A"'),1);assert.equal(play.got('"A"'),0,'不回发给自己');
  assert.equal(preview.got('"X"'),0,'不是主画面发的帧不转发');
  assert.equal(bomb.frames.some(f=>f.includes('mower-')),false,'别的玩法收不到');
  send(play,'C','douyin');await wait();
  assert.equal(obs.got('"C"'),0,'平台不对不转发');
  play.socket.terminate();await wait();
  assert.equal(obs.leader(),true,'操作窗口关掉，OBS 里的画面马上接手（优先于预览）');
  send(obs,'D');await wait();
  assert.equal(preview.got('"D"'),1,'接手后继续转发');
  await wait(2200);
  assert.equal(obs.leader(),false,'主画面 1.5 秒没发帧（卡住了）就换人');assert.equal(preview.leader(),true);
  send(preview,'E');await wait();
  const again=await open('mower=1&play=1');
  const firstFrame=again.frames.findIndex(f=>f.startsWith('event: mower-frame')),firstLeader=again.frames.findIndex(f=>f.startsWith('event: mower-role')&&f.includes('"leader":true'));
  assert.equal(again.got('"E"'),1,'重新打开的操作窗口先拿到最新一帧，才能接着这一局算');
  assert.ok(firstFrame>=0&&firstFrame<firstLeader,'先收到帧，再被指定为主画面');
});

test('桌面独立窗口放行本地割草画面',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../desktop.cjs'),'utf8');
  const body=source.split('window.webContents.setWindowOpenHandler(({ url }) => {')[1].split('\n    });')[0];
  const runtime={url:'http://127.0.0.1:3181',overtime:{state:{config:{gift_panels:[]}}}},policy=vm.runInNewContext('({url})=>{'+body+'}',{runtime});
  assert.equal(policy({url:runtime.url+'/mower/'}).action,'allow');
  assert.equal(policy({url:runtime.url+'/mower/?play=1'}).action,'allow','操作窗口');
  assert.equal(policy({url:runtime.url+'/mower/?play=1&x=1'}).action,'deny');
  assert.equal(policy({url:'https://evil.com/mower/'}).action,'deny');
});
