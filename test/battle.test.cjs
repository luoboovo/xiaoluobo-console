const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {BattleGame,normalizeConfig,defaultRules}=require('../lib/battle.cjs');
const {panelFor}=require('../lib/game-panels.cjs');
const {startServer}=require('../server.cjs');
const {WebSocket}=require('ws');

async function removeDir(dir){assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()),'luobo-battle-')));await fs.rm(dir,{recursive:true,force:true});}
async function fixture(t,catalog=[]){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-battle-'));t.after(()=>removeDir(dir));
  let now=100000;
  return {dir,game:await new BattleGame(dir,{catalog,now:()=>now}).init(),advance:ms=>now+=ms};
}
const WEB={gift_id:31036,gift_name:'小花花',effect:'web',value:2};

test('设置校验：默认口令、范围和礼物规则',()=>{
  const c=normalizeConfig();
  assert.equal(c.chat_left_keyword,'1');assert.equal(c.chat_right_keyword,'2');assert.deepEqual(c.gift_rules,[]);
  for(const input of [{chat_left_keyword:''},{chat_left_keyword:'1',chat_right_keyword:'1'},{chat_match_mode:'regex'},{user_cooldown_seconds:61},
    {gift_rules:[{...WEB,effect:'explode'}]},{gift_rules:[{...WEB,value:0}]},{gift_rules:[{...WEB,value:11}]},{gift_rules:[{...WEB,gift_name:''}]},{gift_rules:Array(51).fill(WEB)},null,[]])
    assert.throws(()=>normalizeConfig(input),JSON.stringify(input));
  assert.equal(normalizeConfig({gift_rules:[{...WEB,effect:'spray',value:9}]}).gift_rules[0].value,1,'技能不需要数量');
});

test('兵种名字可以改：没填用默认，最多8个字，礼物作用和面板跟着换',async t=>{
  assert.equal(normalizeConfig().names.web,'蛛网侠');
  const c=normalizeConfig({names:{web:'小飞侠',spray:''}});
  assert.equal(c.names.web,'小飞侠');assert.equal(c.names.spray,'辣椒水','留空恢复默认');
  for(const names of [{web:'一二三四五六七八九'},{web:3},[],'x'])assert.throws(()=>normalizeConfig({names}),JSON.stringify(names));
  const {game}=await fixture(t);
  await game.action({action:'configure',config:{names:{web:'小飞侠',whip:'甩面条'},gift_rules:[WEB,{gift_id:0,gift_name:'冲浪',effect:'whip',value:1}]}});
  const s=game.snapshot();
  assert.equal(s.effects.web,'召唤小飞侠');assert.equal(s.effects.whip,'鱼僵军：甩面条');
  assert.deepEqual(panelFor('battle',{battle:game}).entries.map(e=>e.text),['帮泽小酱 · 召唤小飞侠 ×2','帮鱼僵军 · 甩面条']);
});

test('新存档按礼物库挑默认礼物，缺的直接跳过',()=>{
  const rules=defaultRules('bilibili',[{id:1,name:'小花花',price:100},{id:2,name:'冲浪',price:100}]);
  assert.deepEqual(rules.map(r=>[r.gift_id,r.effect]),[[1,'web'],[2,'spray']]);
  assert.deepEqual(defaultRules('douyin',[]),[]);
});

test('只在游戏中接弹幕和礼物；弹幕分两边加入，有冷却；礼物按数量换算并限量',async t=>{
  const {game,advance}=await fixture(t);
  await game.action({action:'configure',config:{gift_rules:[WEB,{gift_id:0,gift_name:'冲浪',effect:'spray',value:1},{gift_id:31036,gift_name:'小花花',effect:'guard',value:1}]}});
  await game.receiveChat({uid:1,user:'甲',text:'1'});
  await game.receiveBatch([{giftId:31036,giftName:'小花花',count:1,uid:1}]);
  assert.equal(game.cues.length,0,'没开始不接');
  await game.action({action:'start'});
  await game.receiveChat({uid:1,user:'甲',text:'1'});
  await game.receiveChat({uid:1,user:'甲',text:'2'});
  await game.receiveChat({uid:2,user:'乙',text:'2'});
  await game.receiveChat({uid:3,user:'丙',text:'12'});
  advance(3000);await game.receiveChat({uid:1,user:'甲',text:'2'});
  assert.deepEqual(game.cues.map(c=>[c.kind,c.side,c.user]),[['join','L','甲'],['join','R','乙'],['join','R','甲']],'冷却内忽略，完全匹配');
  await game.receiveBatch([{giftId:31036,giftName:'小花花',count:30,user:'丁',uid:4},{giftId:9,giftName:'冲浪',count:10,user:'戊',uid:5},{giftId:7,giftName:'别的',count:1,uid:6}]);
  assert.deepEqual(game.cues.slice(3).map(c=>[c.kind,c.side,c.value]),[['web','L',20],['guard','R',20],['spray','R',3]],'同一礼物绑两个作用都触发；兵最多20个，技能最多3次');
  await game.action({action:'pause'});
  await game.receiveChat({uid:9,user:'己',text:'1'});assert.equal(game.cues.length,6,'暂停不接');
});

test('试送、战绩回报去重、重新开局和礼物面板',async t=>{
  const {game}=await fixture(t);
  await assert.rejects(game.action({action:'simulate',join:'L'}),/请先开始/);
  await game.action({action:'start'});
  await game.action({action:'simulate',join:'R',user:'试试'});
  await game.action({action:'simulate',rule:{gift_id:0,gift_name:'测试',effect:'giant',value:1},count:2});
  assert.deepEqual(game.cues.map(c=>[c.kind,c.side,c.value]),[['join','R',1],['giant','L',2]]);
  await game.action({action:'report',match:1,result:'win',mvp:[{name:'甲',dmg:123.4},{name:'',dmg:1}]});
  await game.action({action:'report',match:1,result:'lose'});
  await game.action({action:'report',match:2,result:'lose'});
  assert.deepEqual(game.state.stats,{wins:1,losses:1},'同一局只记第一次');
  assert.deepEqual(game.state.history.at(-1).mvp,[{name:'甲',dmg:123}]);
  await game.action({action:'reset'});
  assert.equal(game.state.mode,'idle');assert.equal(game.state.round,2);assert.equal(game.cues.length,0);
  await game.action({action:'configure',config:{gift_rules:[WEB,{gift_id:0,gift_name:'冲浪',effect:'whip',value:1}]}});
  assert.deepEqual(panelFor('battle',{battle:game}).entries.map(e=>e.text),['帮泽小酱 · 召唤蛛网侠 ×2','帮鱼僵军 · 虾线攻击']);
  const reloaded=await new BattleGame(path.dirname(game.file)).init();
  assert.deepEqual(reloaded.state.stats,{wins:1,losses:1},'战绩存盘');
});

test('本地API、直播消息入口、独立画面频道与平台隔离',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-battle-http-'));
  const runtime=await startServer({featuresOn:true,dataDir:dir,seedDir:path.join(__dirname,'../data')});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  const get=route=>fetch(runtime.url+route),post=(route,body,platform)=>fetch(runtime.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(platform?{'X-Luobo-Platform':platform}:{})},body:JSON.stringify(body)});
  for(const route of ['/battle/','/battle/game.js','/battle/chars.js','/battle/assets/chars.json','/battle/assets/ze_idle.png','/battle-console.js'])assert.equal((await get(route)).status,200,route);
  const socket=new WebSocket(runtime.url.replace('http:','ws:')+'/api/events/socket?battle=1',{origin:runtime.url}),frames=[];
  socket.on('message',message=>frames.push(String(message)));t.after(()=>socket.terminate());
  await new Promise((resolve,reject)=>{socket.once('message',resolve);socket.once('error',reject);});
  const initial=await (await get('/api/battle/state')).json();
  const gift=initial.config.gift_rules.find(r=>r.effect==='web');
  assert.ok(gift,'B站默认礼物里有召唤蛛网侠');
  assert.equal((await post('/api/battle/action',{action:'start'})).status,200);
  runtime.services.emit('event',{type:'chat',uid:'a',user:'甲',text:'2'});
  runtime.services.addGift({type:'gift',giftId:gift.gift_id,giftName:gift.gift_name,transactionId:'t1',count:2,uid:7,user:'乙'});
  await post('/api/battle/action',{action:'pause'});
  const snapshot=await (await get('/api/battle/state')).json();
  assert.deepEqual(snapshot.cues.map(c=>[c.kind,c.side,c.user]),[['join','R','甲'],['web','L','乙']]);
  assert.equal((await post('/api/battle/action',{action:'start'},'douyin')).status,409);
  await post('/api/platform',{platform:'douyin'});
  assert.equal((await (await get('/api/battle/state')).json()).cues.length,0,'抖音一套独立数据');
  await post('/api/platform',{platform:'bilibili'});
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.ok(frames.some(frame=>/^event: battle$/m.test(frame)));
  assert.ok(frames.every(frame=>!/^event: (state|noodle|lottery|feeding|message|number-bomb|mower)$/m.test(frame)),'画面频道只收闯关');
});

test('只有一个主画面算战斗：非预览画面优先，帧转给其他闯关画面，主画面断开换人接手',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-battle-relay-'));
  const runtime=await startServer({dataDir:dir,seedDir:path.join(__dirname,'../data')});
  t.after(async()=>{await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  const wait=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
  const open=async query=>{
    const socket=new WebSocket(runtime.url.replace('http:','ws:')+'/api/events/socket?'+query,{origin:runtime.url}),frames=[];
    socket.on('message',m=>frames.push(String(m)));t.after(()=>socket.terminate());
    await new Promise((resolve,reject)=>{socket.once('message',resolve);socket.once('error',reject);});
    await wait();
    return {socket,frames,role:()=>frames.filter(f=>f.startsWith('event: battle-role')).map(f=>JSON.parse(f.split('data: ')[1]).leader).at(-1),got:tag=>frames.filter(f=>f.startsWith('event: battle-frame')&&f.includes(tag)).length};
  };
  const preview=await open('battle=1&preview=1');
  assert.equal(preview.role(),true,'只有预览时预览当主画面');
  const obs=await open('battle=1');await wait();
  assert.equal(obs.role(),true,'独立窗口或 OBS 来了就换它当主画面');assert.equal(preview.role(),false);
  const frame=tag=>JSON.stringify({type:'battle-frame',platform:'bilibili',frame:{tag}});
  preview.socket.send(frame('not-leader'));obs.socket.send(frame('from-leader'));await wait();
  assert.equal(preview.got('from-leader'),1,'主画面的帧转给其他画面');
  assert.equal(obs.got('not-leader'),0,'不是主画面发的帧不转');
  const late=await open('battle=1');
  assert.equal(late.got('from-leader'),1,'新打开的画面先拿到最新一帧');assert.equal(late.role(),false);
  obs.socket.terminate();await wait(150);
  assert.ok(late.role()===true||preview.role()===true,'主画面断开后换人接手');
  assert.equal(late.role(),true,'优先非预览画面');
});
