const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {NumberBomb,normalizeConfig,MAX_PLAYERS}=require('../lib/number-bomb.cjs');
const {startServer}=require('../server.cjs');
const {WebSocket}=require('ws');

async function fixture(t,random=()=>41){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-bomb-'));
  t.after(()=>removeDir(dir));
  let now=100000;
  return {dir,game:await new NumberBomb(dir,{random,now:()=>now}).init(),advance:ms=>now+=ms};
}
async function removeDir(dir){assert.ok(path.resolve(dir).startsWith(path.join(path.resolve(os.tmpdir()),'luobo-bomb-')));await fs.rm(dir,{recursive:true,force:true});}
const chat=(game,uid,text,user='观众',face='')=>game.receiveChat({uid,text,user,face});
test('范围、口令和操作验证，空名单不能开始',async t=>{
  assert.deepEqual(normalizeConfig(),{keyword:'参与数字炸弹',min:1,max:100,user_cooldown_seconds:3,guess_mode:'free'});
  for(const input of [{keyword:''},{keyword:'x'.repeat(41)},{min:-1},{min:100},{max:1},{max:1000000},{max:1.5},{min:'1'},{user_cooldown_seconds:-1},{user_cooldown_seconds:61},{user_cooldown_seconds:'3'},{guess_mode:'unknown'},{guess_mode:true},null])assert.throws(()=>normalizeConfig(input));
  const {game}=await fixture(t);
  await assert.rejects(game.action({action:'start'}),/至少需要/);
  await assert.rejects(game.action({action:'resume'}),/没有暂停/);
  await assert.rejects(game.action({action:'unknown'}));
  await game.action({action:'configure',config:{keyword:' 炸弹 ',min:0,max:999999}});
  assert.equal(game.snapshot().config.keyword,'炸弹');
});
test('自动报名、准确匹配、长账号去重、同名不合并与头像过滤',async t=>{
  const {game}=await fixture(t);
  await chat(game,'1','我要参与数字炸弹');assert.equal(game.state.players.length,0);
  await Promise.all([chat(game,'1234567890123456788','参与数字炸弹'),chat(game,'1234567890123456789','参与数字炸弹'),chat(game,'1234567890123456789','参与数字炸弹')]);
  assert.equal(game.state.players.length,2);
  await chat(game,0,'参与数字炸弹','无ID');await chat(game,0,'参与数字炸弹','无ID');
  assert.equal(game.state.players.length,3);
  await chat(game,'evil','参与数字炸弹','<img onerror=alert(1)>','http://127.0.0.1/secret');
  assert.equal(game.state.players.at(-1).face,'');
  await chat(game,'evil','你好','观众','http://i0.hdslb.com/face.png');
  assert.equal(game.state.players.at(-1).face,'https://i0.hdslb.com/face.png');
  await game.rememberFace({uid:'evil',face:'https://i0.hdslb.com/late.png'});assert.equal(game.state.players.at(-1).face,'https://i0.hdslb.com/late.png');
  await game.rememberFace({uid:'evil',face:'https://evil.com/a.png'});assert.equal(game.state.players.at(-1).face,'https://i0.hdslb.com/late.png');
  await Promise.all(Array.from({length:MAX_PLAYERS+1},(_,i)=>chat(game,'more'+i,'参与数字炸弹')));
  assert.equal(game.state.players.length,MAX_PLAYERS);
});
test('名单锁定、纯数字解析、范围收紧、并发按到达顺序、只爆炸一次',async t=>{
  const {game}=await fixture(t);await game.action({action:'configure',config:{user_cooldown_seconds:0}});await chat(game,'a','参与数字炸弹','甲');await chat(game,'b','参与数字炸弹','乙');
  await game.action({action:'start'});assert.equal(game.state.round.secret,42);assert.equal('secret' in game.snapshot().round,false);
  await chat(game,'c','参与数字炸弹');await chat(game,'c','42');assert.equal(game.state.players.length,2);assert.equal(game.state.round.count,0);
  for(const text of ['42abc','4.2','1e2','-1','1000000','猜42','４２'])await chat(game,'a',text);
  assert.equal(game.state.round.count,0);
  await chat(game,'a','30');assert.equal(game.state.round.min,31);
  await Promise.all([chat(game,'a','60'),chat(game,'b','70'),chat(game,'b','41')]);
  assert.equal(game.state.round.max,59);assert.equal(game.state.round.min,42);assert.equal(game.state.round.count,3);
  await chat(game,'a','30');assert.equal(game.state.players[0].message.kind,'outside');assert.equal(game.state.round.count,3);
  await assert.rejects(game.action({action:'configure',config:{max:500}}));await assert.rejects(game.action({action:'start'}));
  await Promise.all([chat(game,'b',' 42 '),chat(game,'a','42')]);
  const s=game.snapshot();assert.equal(s.phase,'exploded');assert.equal(s.round.secret,42);assert.equal(s.round.loser_id,'uid:b');assert.equal(s.round.count,4);
  assert.equal(s.players[1].message.kind,'hit');
  await chat(game,'a','88');assert.equal(game.state.round.count,4);
  await game.action({action:'reset'});assert.equal(game.state.phase,'enrolling');assert.equal(game.state.round,null);assert.equal(game.state.players.length,0);
});
test('范围包含两端且均可成为炸弹，最窄范围仍能结算',async t=>{
  for(const offset of [0,1]){
    const {game}=await fixture(t,()=>offset);await game.action({action:'configure',config:{min:0,max:1,user_cooldown_seconds:0}});
    await chat(game,'a','参与数字炸弹');await game.action({action:'start'});
    await chat(game,'a',String(1-offset));assert.equal(game.state.round.min,offset);assert.equal(game.state.round.max,offset);
    await chat(game,'a',String(offset));assert.equal(game.snapshot().phase,'exploded');
  }
});
test('暂停、重启恢复、平台停用与写入失败回滚',async t=>{
  const {game,dir}=await fixture(t);await game.action({action:'configure',config:{user_cooldown_seconds:0}});await chat(game,'a','参与数字炸弹');await game.action({action:'start'});await chat(game,'a','20');
  const restored=await new NumberBomb(dir).init();assert.equal(restored.state.phase,'paused');assert.equal(restored.state.round.secret,42);assert.equal(restored.state.round.min,21);
  await chat(restored,'a','42');assert.equal(restored.state.round.count,1);
  await restored.action({action:'resume'});await restored.deactivate();assert.equal(restored.state.phase,'paused');
  const original=restored.file;restored.file=dir;await assert.rejects(restored.action({action:'reset'}));assert.equal(restored.state.phase,'paused');assert.equal(restored.state.players.length,1);
  restored.file=original;await restored.action({action:'resume'});await chat(restored,'a','42');assert.equal(restored.state.phase,'exploded');
});
test('本地API、真实消息入口、独立网页事件与平台隔离',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-bomb-http-'));
  const runtime=await startServer({dataDir:dir,seedDir:path.join(__dirname,'../data')});
  t.after(async()=>{await runtime.close();await removeDir(dir);});
  const get=route=>fetch(runtime.url+route),post=(route,body,platform)=>fetch(runtime.url+route,{method:'POST',headers:{'Content-Type':'application/json',...(platform?{'X-Luobo-Platform':platform}:{})},body:JSON.stringify(body)});
  for(const route of ['/number-bomb/','/number-bomb/game.js','/number-bomb/game.css','/number-bomb-console.js','/number-bomb-console.css'])assert.equal((await get(route)).status,200,route);
  const socket=new WebSocket(runtime.url.replace('http:','ws:')+'/api/events/socket?bomb=1',{origin:runtime.url}),frames=[];
  socket.on('message',message=>frames.push(String(message)));t.after(()=>socket.terminate());
  await new Promise((resolve,reject)=>{socket.once('message',resolve);socket.once('error',reject);});
  runtime.services.emit('event',{type:'chat',uid:'a',user:'甲',text:'参与数字炸弹',face:'https://i0.hdslb.com/a.png'});
  await post('/api/number-bomb/action',{action:'start'});
  const snapshot=await (await get('/api/number-bomb/state')).json();assert.equal(snapshot.players.length,1);assert.equal(snapshot.phase,'running');assert.equal('secret' in snapshot.round,false);
  assert.equal((await post('/api/number-bomb/action',{action:'pause'},'douyin')).status,409);
  await post('/api/platform',{platform:'douyin'});
  assert.equal((await (await get('/api/number-bomb/state')).json()).players.length,0);
  await post('/api/platform',{platform:'bilibili'});
  assert.equal((await (await get('/api/number-bomb/state')).json()).phase,'paused');
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.ok(frames.every(frame=>!/^event: (state|noodle|lottery|feeding|message)$/m.test(frame)));
  assert.equal(frames.some(frame=>frame.includes('"secret"')),false);
  socket.terminate();
});
test('桌面独立窗口仅允许本地数字炸弹画面',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../desktop.cjs'),'utf8');
  const body=source.split('window.webContents.setWindowOpenHandler(({ url }) => {')[1].split('\n    });')[0];
  const runtime={url:'http://127.0.0.1:3181',overtime:{state:{config:{gift_panels:[]}}}},policy=vm.runInNewContext('({url})=>{'+body+'}',{runtime});
  const accepted=policy({url:runtime.url+'/number-bomb/'});assert.equal(accepted.action,'allow');assert.equal(accepted.overrideBrowserWindowOptions.webPreferences.sandbox,true);
  for(const url of ['https://evil.com/number-bomb/',runtime.url+'.evil/number-bomb/',runtime.url+'/number-bomb/evil'])assert.equal(policy({url}).action,'deny');
});
test('每个账号可多次猜数，默认CD三秒、各自计时、聊天和越界不消耗或延长CD',async t=>{
  const {game,advance,dir}=await fixture(t);
  await chat(game,'a','参与数字炸弹');await chat(game,'b','参与数字炸弹');await game.action({action:'start'});
  await chat(game,'a','10');assert.equal(game.state.round.count,1);
  await chat(game,'a','20');assert.equal(game.state.players[0].message.kind,'cooldown');assert.equal(game.state.round.count,1);
  await chat(game,'b','90');assert.equal(game.state.round.count,2);
  advance(2999);await chat(game,'a','20');assert.equal(game.state.round.count,2);
  await chat(game,'a','你好');await chat(game,'a','100');assert.equal(game.state.players[0].message.kind,'outside');
  advance(1);await chat(game,'a','20');assert.equal(game.state.round.count,3);assert.equal(game.state.round.min,21);
  const restored=await new NumberBomb(dir,{now:()=>103000}).init();await restored.action({action:'resume'});
  await chat(restored,'a','30');assert.equal(restored.state.round.count,3);assert.equal(restored.state.players[0].message.kind,'cooldown');
  advance(3000);await chat(game,'a','30');assert.equal(game.state.round.count,4);
  await game.action({action:'reset'});await game.action({action:'configure',config:{user_cooldown_seconds:0.5}});
  await chat(game,'a','参与数字炸弹');await game.action({action:'start'});await chat(game,'a','10');
  advance(499);await chat(game,'a','20');assert.equal(game.state.round.count,1);advance(1);await chat(game,'a','20');assert.equal(game.state.round.count,2);
});
test('数字格保留每次猜数对应的头像，超过最近20条与重启后仍保留，兼容旧存档',async t=>{
  const {game,dir}=await fixture(t,()=>98);await game.action({action:'configure',config:{user_cooldown_seconds:0}});
  await chat(game,'a','参与数字炸弹');await game.action({action:'start'});
  for(let value=1;value<=25;value++)await chat(game,'a',String(value));
  assert.equal(game.state.round.guesses.length,20);assert.equal(Object.keys(game.state.round.guessed_by).length,25);
  assert.equal(game.state.round.guessed_by[1],'uid:a');assert.equal(game.state.round.guessed_by[25],'uid:a');
  const restored=await new NumberBomb(dir).init();assert.equal(restored.state.round.guessed_by[1],'uid:a');
  const legacy=structuredClone(game.state);delete legacy.round.guessed_by;await fs.writeFile(game.file,JSON.stringify(legacy));
  const migrated=await new NumberBomb(dir).init();assert.equal(migrated.state.round.guessed_by[25],'uid:a');
  await migrated.action({action:'reset'});assert.equal(migrated.snapshot().round,null);
});
test('排队按排序后的名单开始，只有当前玩家能猜数，依次轮转且不能抢猜炸弹',async t=>{
  const {game}=await fixture(t);await game.action({action:'configure',config:{guess_mode:'queue',user_cooldown_seconds:0}});
  for(const uid of ['a','b','c'])await chat(game,uid,'参与数字炸弹');
  await game.action({action:'reorder',ids:['uid:c','uid:a','uid:b']});await game.action({action:'start'});
  assert.equal(game.snapshot().round.turn_id,'uid:c');
  await chat(game,'a','42');assert.equal(game.state.phase,'running');assert.equal(game.state.round.count,0);assert.equal(game.state.players.find(p=>p.id==='uid:a').message.kind,'turn');
  await Promise.all([chat(game,'c','10'),chat(game,'c','20')]);assert.equal(game.state.round.count,1);assert.equal(game.state.round.turn_id,'uid:a');
  await chat(game,'a','90');assert.equal(game.state.round.turn_id,'uid:b');
  await chat(game,'b','20');assert.equal(game.state.round.turn_id,'uid:c');
  await chat(game,'c','42');assert.equal(game.state.phase,'exploded');assert.equal(game.state.round.loser_id,'uid:c');
  await assert.rejects(game.action({action:'reorder',ids:['uid:a','uid:b','uid:c']}),/已结束/);
});
test('排队时越界、非数字、CD和未轮到均不换人，只有有效数字推进',async t=>{
  const {game,advance}=await fixture(t);await game.action({action:'configure',config:{guess_mode:'queue'}});
  await chat(game,'a','参与数字炸弹');await chat(game,'b','参与数字炸弹');await game.action({action:'start'});
  await chat(game,'a','10');await chat(game,'b','90');assert.equal(game.state.round.turn_id,'uid:a');
  await chat(game,'a','20');assert.equal(game.state.players[0].message.kind,'cooldown');assert.equal(game.state.round.count,2);
  await chat(game,'a','你好');await chat(game,'a','100');await chat(game,'b','42');assert.equal(game.state.round.turn_id,'uid:a');assert.equal(game.state.phase,'running');
  advance(2999);await chat(game,'a','20');assert.equal(game.state.round.count,2);
  advance(1);await chat(game,'a','20');assert.equal(game.state.round.turn_id,'uid:b');
  await chat(game,'b','42');assert.equal(game.state.phase,'exploded');assert.equal(game.state.round.count,4);
});
test('拖动排序验证完整名单，保留当前玩家，暂停重启和保存失败均不丢顺序',async t=>{
  const {game,dir}=await fixture(t);await assert.rejects(game.action({action:'reorder',ids:[]}),/排队模式/);
  await game.action({action:'configure',config:{guess_mode:'queue',user_cooldown_seconds:0}});
  for(const uid of ['a','b','c'])await chat(game,uid,'参与数字炸弹');
  for(const ids of [null,['uid:a','uid:a','uid:c'],['uid:a','uid:b'],['uid:a','uid:b','uid:unknown']])await assert.rejects(game.action({action:'reorder',ids}),/完整名单/);
  assert.deepEqual(game.state.players.map(p=>p.id),['uid:a','uid:b','uid:c']);
  await game.action({action:'start'});await game.action({action:'reorder',ids:['uid:c','uid:a','uid:b']});assert.equal(game.state.round.turn_id,'uid:a');
  await chat(game,'a','10');assert.equal(game.state.round.turn_id,'uid:b');
  await game.action({action:'pause'});await game.action({action:'reorder',ids:['uid:b','uid:c','uid:a']});
  const restored=await new NumberBomb(dir).init();assert.equal(restored.state.config.guess_mode,'queue');assert.equal(restored.state.round.turn_id,'uid:b');assert.deepEqual(restored.state.players.map(p=>p.id),['uid:b','uid:c','uid:a']);
  restored.file=dir;await assert.rejects(restored.action({action:'reorder',ids:['uid:a','uid:b','uid:c']}));assert.deepEqual(restored.state.players.map(p=>p.id),['uid:b','uid:c','uid:a']);assert.equal(restored.state.round.turn_id,'uid:b');
  restored.file=game.file;await restored.action({action:'resume'});await chat(restored,'b','20');assert.equal(restored.state.round.turn_id,'uid:c');
  const legacy=structuredClone(restored.state);delete legacy.config.guess_mode;delete legacy.round.turn_id;await fs.writeFile(game.file,JSON.stringify(legacy));
  const migrated=await new NumberBomb(dir).init();assert.equal(migrated.state.config.guess_mode,'free');assert.equal(migrated.state.round.turn_id,'uid:b');
});
test('排队单人仍可循环猜数，遵守CD',async t=>{
  const {game,advance}=await fixture(t);await game.action({action:'configure',config:{guess_mode:'queue'}});
  await chat(game,'a','参与数字炸弹');await game.action({action:'start'});await chat(game,'a','10');
  assert.equal(game.state.round.turn_id,'uid:a');await chat(game,'a','20');assert.equal(game.state.round.count,1);
  advance(3000);await chat(game,'a','20');assert.equal(game.state.round.count,2);assert.equal(game.state.round.turn_id,'uid:a');
});
