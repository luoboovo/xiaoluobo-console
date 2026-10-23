const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {FeedingGame,normalizeConfig}=require('../lib/feeding.cjs');
const {panelFor,generatePanel}=require('../lib/game-panels.cjs');
const {startServer}=require('../server.cjs');
const F=require('../public/feeding/shared.js');
const Physics=require('../lib/feeding-physics.cjs');
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-feeding-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return {dir,game:await new FeedingGame(dir,{random:()=>0}).init()};}
const rule=(operation,value=1,id=1)=>({gift_id:id,gift_name:'礼物'+id,operation,value});
test('投喂、加减乘除、连送、去重、清空及暂停',async t=>{
  const {game}=await fixture(t);await game.action({action:'configure',config:normalizeConfig({gift_food_rules:[rule('add',3),rule('subtract',2,2),rule('multiply',2,3),rule('divide',2,4),rule('clear',1,5)]})});
  await game.action({action:'start'});const gift=(giftId,count=1,transactionId='')=>({type:'gift',giftId,giftName:'礼物'+giftId,count,uid:'12',transactionId});
  await game.receiveBatch([gift(1,2,'t1'),gift(1,2,'t1'),gift(2,2),gift(3,2),gift(4,2)]);assert.equal(game.state.count,12);assert.equal(game.state.eaten,40);
  await game.action({action:'pause'});await game.receiveBatch([gift(1)]);assert.equal(game.state.count,12);await game.action({action:'start'});await game.receiveBatch([gift(5)]);assert.equal(game.state.count,0);
});
test('盲盒奖品优先、别名ID、同一礼物多种效果和范围时长',async t=>{
  const {game}=await fixture(t);await game.action({action:'configure',config:normalizeConfig({gift_food_rules:[rule('add',2),{gift_id:0,gift_name:'盲盒',operation:'subtract',value:5}],gift_range_rules:[{gift_id:1,gift_name:'礼物1',seconds:10}]})});await game.action({action:'start'});
  await game.receiveBatch([{giftId:9,giftAliases:[1],giftName:'奖品',blindGiftName:'盲盒',count:3}]);assert.equal(game.state.count,16);assert.ok(game.state.range_until>=Date.now()+29000);
  await game.receiveBatch([{giftId:99,giftName:'未知奖品',blindGiftName:'盲盒',count:1}]);assert.equal(game.state.count,11);
});
test('食物拖拽结算、余量补位、过期画面保护、重新打开保存位置及数量',async t=>{
  const {game,dir}=await fixture(t);await game.action({action:'delta',delta:5000});assert.equal(game.objects.length,F.MAX_SPRITES);
  const ids=game.objects.slice(0,3).map(o=>o.id),old=game.state.revision;await game.action({action:'drop',ids,x:game.state.consumer.x,y:game.state.consumer.y,revision:old});assert.equal(game.state.count,5007);assert.equal(game.state.eaten,3);assert.equal(game.objects.length,F.MAX_SPRITES);assert.ok(ids.every(id=>!game.objects.some(o=>o.id===id)));
  await game.action({action:'drop',ids,x:game.state.consumer.x,y:game.state.consumer.y,revision:old,automatic:true});assert.equal(game.state.eaten,3);
  await assert.rejects(game.action({action:'drop',ids:[game.objects[0].id],x:10,y:10,revision:old}),/画面已更新/);
  await game.action({action:'consumer',x:600,y:500});const next=await new FeedingGame(dir).init();assert.equal(next.state.count,5007);assert.deepEqual(next.state.consumer,{x:600,y:500});assert.deepEqual(next.objects,game.objects);
});
test('移走中间食物后其他食物不向左补位，拖放位置和顺序贴图在重启后保留',async t=>{
  const {game,dir}=await fixture(t);
  const food=game.objects[4],other=game.objects[8];
  await game.action({action:'configure',config:{...game.state.config,food_image_order:'sequence',food_images:['/feeding/assets/radish.svg','/feeding/assets/stars_jar/star.png']}});
  await game.action({action:'drop',ids:[other.id],x:800,y:600,revision:game.state.revision});
  const objects=structuredClone(game.objects),placement=structuredClone(game.state.placements);
  await game.action({action:'drop',ids:[food.id],x:game.state.consumer.x,y:game.state.consumer.y,revision:game.state.revision});
  assert.deepEqual(game.objects,objects.filter(o=>o.id!==food.id));assert.deepEqual(game.state.placements,placement);
  const next=await new FeedingGame(dir).init();assert.deepEqual(next.objects,game.objects);assert.deepEqual(next.state.placements,placement);
  await next.action({action:'delta',delta:1});assert.deepEqual(next.objects.slice(0,-1),game.objects);assert.equal(next.objects.at(-1).slot,food.slot);
  const file=await fs.readFile(next.file,'utf8'),old=JSON.parse(file);old.objects=old.objects.map(({id})=>({id}));await fs.writeFile(next.file,JSON.stringify(old));
  const migrated=await new FeedingGame(dir).init();assert.deepEqual(migrated.objects.map(o=>o.slot),migrated.objects.map((_,i)=>i));assert.equal(migrated.state.count,next.state.count);
});
test('食物随机散落、互相碰撞并落地，不形成固定格子',()=>{
  const foods=Array.from({length:80},(_,i)=>Physics.spawn({id:i+1,slot:i},56));
  const initial=foods.map(({x,y})=>({x,y}));assert.equal(new Set(initial.map(p=>Math.round(p.x))).size>65,true);
  for(let i=0;i<240;i++)Physics.step(foods,56);
  assert.ok(foods.every(o=>Number.isFinite(o.x)&&Number.isFinite(o.y)&&o.y<=720-Physics.radius(o,56)+.01));
  assert.ok(foods.some(o=>o.y>650));assert.ok(foods.some((o,i)=>Math.abs(o.x-initial[i].x)>5));
  const a=Physics.spawn({id:100,slot:0},56,{x:600,y:200}),b=Physics.spawn({id:101,slot:1},56,{x:600,y:200});for(let i=0;i<10;i++)Physics.step([a,b],56);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>40);
});
test('拖动食用者沿路吃掉碰到的食物，快速扫过和重复位置不会漏算或重复计数',async t=>{
  const {game}=await fixture(t);await game.action({action:'configure',config:{...game.state.config,initial_food_count:3}});await game.action({action:'reset'});
  game.state.consumer={x:80,y:600};game.objects.forEach((o,i)=>Object.assign(o,{x:220+i*260,y:600,vx:0,vy:0}));
  assert.equal(game.motion({client:'consumer-test',kind:'consumer',x:1100,y:600,ids:[],revision:game.state.revision}),true);
  await game.tick();assert.equal(game.state.count,0);assert.equal(game.state.eaten,3);assert.deepEqual(game.state.consumer,{x:1100,y:600});
  await game.action({action:'consumer',x:1100,y:600});assert.equal(game.state.eaten,3);
});
test('拖食用者盖住已落地静止的食物也会吃掉',async t=>{
  const {game}=await fixture(t);await game.action({action:'configure',config:{...game.state.config,initial_food_count:1}});await game.action({action:'reset'});
  const c=game.state.config,food=game.objects[0],r=Physics.radius(food,c.food_size);
  // 食物在食用者图片边缘以内、但在下落判定圈之外：以前拖过去吃不到。
  Object.assign(food,{x:600+c.consumer_size*.42+r,y:720-r,vx:0,vy:0,spin:0,rest:10});game.state.consumer={x:300,y:700};
  assert.equal(Physics.touches(food,{x:600,y:700},{x:600,y:700},c.consumer_size,c.food_size),false);
  game.motion({client:'floor-test',kind:'consumer',x:600,y:700,ids:[]});await game.tick();
  assert.equal(game.state.count,0);assert.equal(game.state.eaten,1);
});
test('抓在手里的食物暂停下落，松手后继续自然下落',async t=>{
  const {game}=await fixture(t),id=game.objects[0].id;
  game.motion({client:'hold-test',kind:'food',ids:[id],x:300,y:150,offsets:[{x:0,y:0}],revision:game.state.revision});await game.tick();
  const food=game.objects.find(o=>o.id===id);assert.equal(food.x,300);assert.equal(food.y,150);
  await game.action({action:'drop',ids:[id],x:300,y:150,revision:game.state.revision});const y=food.y;await game.tick();assert.ok(food.y>y);
});

test('已经静止的食物重新拖放或调大尺寸后会重新下落',async t=>{
  const {game}=await fixture(t),food=game.objects[0];
  Object.assign(food,{x:300,y:720-Physics.radius(food,56),vx:0,vy:0,spin:0,rest:10});
  await game.action({action:'drop',ids:[food.id],x:300,y:150,revision:game.state.revision});
  const y=food.y;await game.tick();assert.ok(food.y>y);
  Object.assign(food,{x:300,y:720-Physics.radius(food,56),vx:0,vy:0,spin:0,rest:10});
  await game.action({action:'configure',config:{...game.state.config,food_size:100}});
  await game.tick();assert.ok(food.y<=720-Physics.radius(food,100));
});

test('松手后下落经过食用者会被吃掉，未开局和暂停也能手动投喂，握着时不自动吃',async t=>{
  for(const mode of ['idle','running','paused']){
    const {game}=await fixture(t);await game.action({action:'configure',config:{...game.state.config,initial_food_count:1}});await game.action({action:'reset'});
    game.state.mode=mode;const food=game.objects[0];
    game.motion({client:'held-food',kind:'food',ids:[food.id],x:game.state.consumer.x,y:game.state.consumer.y,offsets:[{x:0,y:0}]});await game.tick();
    assert.equal(game.state.count,1,'握在手里时不自动吃掉');
    await game.action({action:'drop',ids:[food.id],x:game.state.consumer.x,y:100,revision:game.state.revision});
    for(let i=0;i<90;i++)await game.tick();
    assert.equal(game.state.count,0,`${mode}：松手后经过食用者没有吃掉`);assert.equal(game.state.eaten,1);
    await game.tick();assert.equal(game.state.eaten,1);
  }
});

test('高速下落用整段路径判断碰撞，经过食用者后不会漏吃',async t=>{
  const {game}=await fixture(t);await game.action({action:'configure',config:{...game.state.config,initial_food_count:1,food_size:16,consumer_size:40}});await game.action({action:'reset'});await game.action({action:'start'});
  game.state.consumer={x:600,y:500};const food=game.objects[0];Object.assign(food,{x:587,y:482,vx:800,vy:1100,spin:0});
  assert.equal(Physics.touches(food,game.state.consumer,game.state.consumer,40,16),false);
  const after=structuredClone(food);Physics.step([after],16);assert.equal(Physics.touches(after,game.state.consumer,game.state.consumer,40,16),false);
  await game.tick();assert.equal(game.state.count,0);assert.equal(game.state.eaten,1);
});
test('拖食用者吃食物时保存失败，数量和已吃统计保持原值',async t=>{
  const {game}=await fixture(t);const food=game.objects[0];Object.assign(food,{x:600,y:600,vx:0,vy:0});game.state.consumer={x:500,y:600};
  game.motion({client:'save-failure',kind:'consumer',x:700,y:600,ids:[]});game.save=async()=>{throw Error('磁盘不可写');};
  await assert.rejects(game.tick(),/磁盘不可写/);assert.equal(game.state.count,10);assert.equal(game.state.eaten,0);assert.ok(game.objects.some(o=>o.id===food.id));
});
test('弹幕冷却、整句/包含匹配及刮大风边界',async t=>{
  const {game}=await fixture(t);await game.action({action:'start'});const chat={user:'观众',uid:'1',text:'投喂'};await game.receiveChat(chat);await game.receiveChat(chat);assert.equal(game.state.count,11);await game.receiveChat({...chat,uid:'2',text:'再投喂'});assert.equal(game.state.count,11);
  await game.action({action:'configure',config:{...game.state.config,danmaku_match_mode:'contains',user_cooldown_seconds:0}});await game.receiveChat({...chat,text:'再投喂'});assert.equal(game.state.count,12);
  await game.action({action:'wind'});assert.equal(game.state.count,13);assert.ok(game.state.wind_until>Date.now());game.operate(rule('multiply',100000),1000000);assert.equal(game.state.count,F.MAX_COUNT);game.operate(rule('divide',100000),1000000);assert.equal(game.state.count,0);
});
test('配置边界及未授权路径拒绝，凭证不进入存档',async()=>{
  for(const input of [{range_pickup_limit:0},{food_images:['C:/private.png']},{consumer_image:'https://bad.test/image'},{gift_food_rules:[rule('divide',0)]},{initial_food_count:Infinity}])assert.throws(()=>normalizeConfig(input));
  const config=normalizeConfig({sessdata:'secret',license:'private',room_id:'123'});assert.equal(config.sessdata,undefined);assert.equal(config.license,undefined);assert.equal(config.room_id,undefined);
});
test('旧版配置迁移复制素材，保留主题和规则，跳过凭证',async t=>{
  const {dir}=await fixture(t),legacy=path.join(dir,'legacy');await fs.mkdir(legacy);const picture=path.join(__dirname,'../public/feeding/assets/stars_jar/star.png');await fs.copyFile(picture,path.join(legacy,'food.png'));await fs.writeFile(path.join(legacy,'config.json'),JSON.stringify({sessdata:'do-not-copy',active_theme_id:'stars_jar',food_images:['food.png'],initial_food_count:3,gift_food_rules:[rule('multiply',2)]}));const target=path.join(dir,'migrated'),game=await new FeedingGame(target,{legacyFiles:[path.join(legacy,'config.json')]}).init();assert.equal(game.state.count,3);assert.equal(game.state.config.active_theme_id,'stars_jar');assert.match(game.state.config.food_images[0],/^\/api\/feeding\/assets\//);assert.ok(!(await fs.readFile(game.file,'utf8')).includes('do-not-copy'));
});
test('每种游戏的生成面板使用已保存规则，同礼物作用合并，满面板时保持原数据',async t=>{
  const {game}=await fixture(t),saved=[];const games={feeding:game,overtime:{state:{config:{gift_rules:[rule('add',5)],gift_panels:saved}},async action(input){if(input.panels.length>20)throw Error('最多20个');saved.splice(0,saved.length,...input.panels);}}};
  game.state.config.gift_food_rules=[rule('add',3),rule('wind')];game.state.config.gift_range_rules=[{gift_id:1,gift_name:'礼物1',seconds:10}];const panel=await generatePanel('feeding',games);assert.equal(panel.template,'custom');assert.equal(panel.entries.length,1);assert.match(panel.entries[0].text,/投喂 3 个；刮大风.*；范围拾取 10 秒/);assert.equal(saved.length,1);assert.match(panelFor('overtime',games).entries[0].text,/5 分钟/);
  while(saved.length<20)saved.push({...panel,id:String(saved.length)});await assert.rejects(generatePanel('feeding',games),/最多20个/);assert.equal(saved.length,20);
});
test('网页API、游戏面板、SSE同步及两平台隔离',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-feeding-api-'));let runtime; t.after(async()=>{await runtime?.close();await fs.rm(dir,{recursive:true,force:true});});runtime=await startServer({dataDir:dir});
  const post=async(url,body,platform='bilibili')=>{const res=await fetch(runtime.url+url,{method:'POST',headers:{'Content-Type':'application/json','X-Luobo-Platform':platform},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
  for(const url of ['/feeding/','/feeding/game.js','/feeding/shared.js','/feeding-console.js','/game-panels.js','/feeding/assets/stars_jar/star.png'])assert.equal((await fetch(runtime.url+url)).status,200);
  const {data}=await post('/api/panels/generate',{game:'feeding'});assert.ok(runtime.overtime.state.config.gift_panels.some(p=>p.id===data.panel.id));assert.equal((await post('/api/panels/generate',{game:'noodle'})).status,200);
  const abort=new AbortController(),response=await fetch(runtime.url+'/api/events?feeding=1',{signal:abort.signal}),reader=response.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/event: feeding/);assert.ok(!first.includes('event: noodle'));abort.abort();
  await post('/api/feeding/action',{action:'delta',delta:5});assert.equal(runtime.feeding.state.count,15);await post('/api/platform',{platform:'douyin'});assert.equal(runtime.feeding.platform,'douyin');assert.equal(runtime.feeding.state.count,10);assert.equal((await post('/api/feeding/action',{action:'delta',delta:99})).status,409);await post('/api/platform',{platform:'bilibili'},'douyin');assert.equal(runtime.feeding.state.count,15);
  const invalid=await fetch(runtime.url+'/api/feeding/assets',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:'not an image'});assert.equal(invalid.status,400);
});
test('多个网页面板通过WebSocket推送且不阻塞控制操作，拒绝跨站订阅',async t=>{
  const {WebSocket}=require('ws'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-events-')),runtime=await startServer({dataDir:dir}),sockets=[];t.after(async()=>{for(const ws of sockets)ws.terminate();await runtime.close();await fs.rm(dir,{recursive:true,force:true});});
  for(let i=0;i<10;i++)await new Promise((resolve,reject)=>{const ws=new WebSocket(runtime.url.replace('http:','ws:')+'/api/events/socket?feeding=1',{origin:runtime.url});sockets.push(ws);ws.once('message',body=>{assert.match(String(body),/^event: feeding/);resolve();});ws.once('error',reject);});
  const response=await fetch(runtime.url+'/api/feeding/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delta',delta:1})});assert.equal(response.status,200);assert.equal(runtime.feeding.state.count,11);
  await new Promise((resolve,reject)=>{const ws=new WebSocket(runtime.url.replace('http:','ws:')+'/api/events/socket?feeding=1',{origin:'http://untrusted.test'});ws.once('open',()=>reject(Error('不应允许跨站订阅')));ws.once('error',resolve);});
});
test('物理帧坐标精简到0.1像素，物理计算不等待其他玩法的任务',async t=>{
  const {game}=await fixture(t);Object.assign(game.objects[0],{x:123.456789,y:654.321987,angle:1.23456});
  const frame=game.physicsSnapshot().objects[0];assert.equal(frame.x,123.5);assert.equal(frame.y,654.3);assert.equal(frame.angle,1.23);
  assert.equal(game.objects[0].x,123.456789);
  const order=[];const action=game.action({action:'delta',delta:1}).then(()=>order.push('action'));const tick=game.tick().then(()=>order.push('tick'));
  await Promise.all([action,tick]);assert.deepEqual(order,['action','tick']);assert.equal(game.state.count,11);
});
