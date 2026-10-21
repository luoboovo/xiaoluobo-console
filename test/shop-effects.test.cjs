const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {NoodleShop,config,DEFAULTS}=require('../lib/noodle.cjs');
const {startServer}=require('../server.cjs');
const Layout=require('../public/noodle/layout.js');
const {ConsoleServices}=require('../lib/services.cjs');

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-effects-'));
  t.after(()=>{if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-effects-'))throw new Error('清理路径无效');return fs.rm(dir,{recursive:true,force:true});});
  const shop=await new NoodleShop(dir).init();shop.mode='running';return {dir,shop};
}

test('满500为五星，400多为四星，整百分与相邻分数边界',()=>{
  const shop=new NoodleShop('.');
  for(const [points,stars] of [[500,5],[499,4],[488,4],[400,4],[399,3],[300,3],[299,2],[200,2],[199,1],[100,1],[99,1],[1,1],[0,0]]) {
    shop.shopStatuses.saozi={points,sealed:points===0,raid_at:0};assert.equal(shop.snapshot().stars,stars,`评分 ${points}`);
  }
});
test('评分阈值、归零自动查封、重启保留、补货重开且保留余额',async t=>{
  const {dir,shop}=await fixture(t);
  shop.balance=7;await fs.writeFile(shop.walletFile,JSON.stringify({balance:7,unit_version:2}));
  shop.objects=[{id:1,kind:'water',x:400,y:480,noodles:0,sauce:0},{id:2,kind:'coin',x:500,y:480,noodles:0,sauce:0}];
  for(const expected of [4,3,2,1]){await shop.shopAction('review',100);assert.equal(shop.snapshot().stars,expected);assert.equal(shop.status.sealed,false);}
  await shop.shopAction('review',200);assert.equal(shop.status.points,0);assert.equal(shop.status.sealed,true);assert.ok(shop.status.raid_at);assert.deepEqual(shop.objects.map(o=>o.kind),['coin']);
  assert.throws(()=>shop.workspace({revision:shop.revision,selected:null,objects:[{id:3,kind:'water',x:500,y:480,noodles:0,sauce:0}]}),/查封/);
  const reload=await new NoodleShop(dir).init();assert.equal(reload.status.sealed,true);assert.equal(reload.balance,7);
  await reload.shopAction('restock');assert.equal(reload.snapshot().stars,5);assert.equal(reload.status.points,500);assert.equal(reload.status.sealed,false);assert.equal(reload.mode,'running');assert.equal(reload.balance,7);
});
test('店铺礼物保存、交易去重、差评按礼物个数扣分',async t=>{
  const {shop}=await fixture(t);
  shop.config=config({...DEFAULTS,review_gift:{gift_id:90001,gift_name:'差评'}});
  const event={type:'gift',giftId:90001,giftName:'差评',uid:1,count:100,transactionId:'review-one'};
  await shop.receive(event);await shop.receive(event);assert.equal(shop.status.points,400);assert.equal(shop.queue.length,0);
  await shop.save({...shop.config,raid_gift:{gift_id:90002,gift_name:'查封'}});
  assert.equal(shop.config.raid_gift.gift_id,90002);
  await shop.receive({...event,giftId:90002,transactionId:'raid-one'});assert.equal(shop.status.sealed,true);
});

test('小偷从钱匣扣款、保留台面金币，余额不足时只拿现有金额',async t=>{
  const {dir,shop}=await fixture(t);
  await shop.saveWallet(7);shop.tip(2);shop.selected=shop.objects[0].id;
  const objects=structuredClone(shop.objects), revision=shop.revision;
  const state=await shop.action({action:'demo_thief'});
  assert.deepEqual(state.objects,objects);assert.equal(state.selected,objects[0].id);
  assert.equal(state.theft.amount,7);assert.equal(state.balance,0);assert.equal(state.workspace_revision,revision);
  assert.equal(state.thief_board[0].amount,7);
  const reload=await new NoodleShop(dir).init();assert.equal(reload.balance,0);assert.equal(reload.thieves[0].amount,7);assert.equal(reload.snapshot().theft,null);
  await shop.deposit({revision:shop.revision,object_id:objects[0].id});assert.equal(shop.balance,100);
});

test('帮忙礼物一次做一碗面，跳过圣水顾客，正常出餐付款，重复交易去重',async t=>{
  const {shop}=await fixture(t);shop.balance=8;
  shop.enqueue('圣水顾客',1,1,'',true,'water');shop.enqueue('点面顾客',3,2);
  shop.objects=[{id:1,kind:'bowl',x:550,y:480,noodles:1,sauce:1},{id:2,kind:'coin',x:650,y:450,noodles:0,sauce:0}];shop.serial=2;shop.selected=1;
  const objects=structuredClone(shop.objects),revision=shop.revision,customer=shop.queue[1];
  const event={type:'gift',giftId:30758,giftName:'这个好诶',count:10,uid:3,transactionId:'help-one'};
  await shop.receive(event);await shop.receive(event);
  assert.equal(shop.queue.length,3);assert.equal(shop.queue[0].order,'water');assert.equal(shop.served,1);assert.equal(shop.balance,8);assert.equal(shop.selected,1);
  assert.deepEqual(shop.objects.slice(0,2),objects);assert.equal(shop.objects.at(-1).kind,'coin');assert.equal(shop.departures.length,1);assert.equal(shop.departures[0].id,customer.id);assert.equal(shop.departures[0].helped,true);assert.equal(shop.departures[0].correct,true);
  assert.equal(shop.revision,revision+1);await assert.rejects(shop.feed({revision,object_id:1,customer_id:customer.id}),/已更新/);
  shop.queue[1].recipe='knife-noodles';await shop.action({action:'demo_help'});assert.equal(shop.served,2);assert.equal(shop.objects.length,4);
});

test('帮忙在空队列、只有圣水顾客、暂停、查封和满台面时不生成付款',async t=>{
  const {shop}=await fixture(t);
  assert.equal(await shop.help(),false);shop.enqueue('圣水',1,1,'',true,'water');assert.equal(await shop.help(),false);
  shop.enqueue('点面',1);shop.mode='paused';assert.equal(await shop.help(),false);await assert.rejects(shop.action({action:'demo_help'}),/继续游戏/);
  shop.mode='running';await shop.shopAction('raid');assert.equal(await shop.help(),false);await assert.rejects(shop.action({action:'demo_help'}),/查封/);
  await shop.shopAction('restock');shop.tip(500);const revision=shop.revision;assert.equal(await shop.help(),false);assert.equal(shop.objects.length,500);assert.equal(shop.revision,revision);assert.equal(shop.queue.length,2);assert.equal(shop.served,0);
});

test('多人送排队和帮忙礼物时，离场动画有界，出餐、金币和统计完整保留',async t=>{
  const {shop}=await fixture(t),now=Date.now();t.mock.method(Date,'now',()=>now);
  shop.enqueue('排队观众',200,1);
  for(let i=0;i<150;i++)await shop.receive({type:'gift',giftId:30758,giftName:'这个好诶',count:1,uid:i+2,transactionId:'concurrent-help-'+i});
  const state=shop.snapshot(),capacity=shop.config.layout.queue.rows*shop.config.layout.queue.columns;
  assert.ok(state.departures.length<=capacity,`离场动画堆积了 ${state.departures.length} 位顾客`);
  assert.equal(state.queue_count,50);assert.equal(state.served,150);
  assert.equal(state.objects.filter(item=>item.kind==='coin').length,150);
  assert.equal(shop.audience.reduce((sum,person)=>sum+person.eaten,0),150);
});

test('清空排队礼物只移除等待顾客，余额、桌面、评分和出餐统计保留',async t=>{
  const {shop}=await fixture(t);shop.enqueue('顾客',5);shop.tip(2);shop.balance=9;shop.served=3;
  const objects=structuredClone(shop.objects),status=structuredClone(shop.status);
  const event={type:'gift',giftId:34685,giftName:'冲鸭',uid:3,count:10,transactionId:'clear-one'};
  await shop.receive(event);assert.equal(shop.queue.length,0);assert.equal(shop.served,3);assert.equal(shop.balance,9);assert.deepEqual(shop.objects,objects);assert.deepEqual(shop.status,status);
  shop.enqueue('新的顾客',1);await shop.receive(event);assert.equal(shop.queue.length,1);
  await shop.action({action:'demo_clearqueue'});assert.equal(shop.queue.length,0);
});

test('帮忙与清空排队补齐默认礼物，支持独立改绑、取消和重启保留',async t=>{
  const {dir,shop}=await fixture(t);const legacy={...shop.config};delete legacy.help_gift;delete legacy.clearqueue_gift;
  assert.deepEqual(config(legacy).help_gift,{gift_id:30758,gift_name:'这个好诶',match_name:true});assert.deepEqual(config(legacy).clearqueue_gift,{gift_id:34685,gift_name:'冲鸭',match_name:true});
  await shop.save({...shop.config,help_gift:{gift_id:90011,gift_name:'自选帮忙'},clearqueue_gift:null});
  const reload=await new NoodleShop(dir).init();assert.equal(reload.config.help_gift.gift_id,90011);assert.equal(reload.config.clearqueue_gift,null);
  reload.mode='running';reload.enqueue('点面',2);await reload.receive({type:'gift',uid:3,count:1,giftId:30758,giftName:'这个好诶',transactionId:'old-help'});assert.equal(reload.queue.length,2);
  await reload.receive({type:'gift',uid:3,count:1,giftId:90011,giftName:'自选帮忙',transactionId:'new-help'});assert.equal(reload.queue.length,1);
  for(const kind of ['help','clearqueue'])assert.throws(()=>config({...shop.config,[kind+'_gift']:{gift_id:0,gift_name:'坏绑定'}}),/店铺礼物/);
});

test('小偷礼物绑定持久保存、重复交易不再扣钱、空钱匣仍显示角色、复原清榜',async t=>{
  const {dir,shop}=await fixture(t);assert.equal(shop.config.thief_gift,null);
  await shop.save({...shop.config,thief_gift:{gift_id:90009,gift_name:'小偷礼物'},thief_min:20,thief_max:20});
  assert.equal((await new NoodleShop(dir).init()).config.thief_gift.gift_id,90009);
  await shop.saveWallet(100);shop.tip(3);
  const event={type:'gift',giftId:90009,giftName:'小偷礼物',user:'小偷',uid:1,count:10,transactionId:'thief-one'};
  await shop.receive(event);const first=shop.theft.id;assert.equal(shop.objects.length,3);assert.equal(shop.theft.amount,20);assert.equal(shop.balance,80);
  await shop.receive(event);assert.equal(shop.balance,80);assert.equal(shop.theft.id,first);
  await shop.receive({...event,transactionId:'thief-two'});assert.equal(shop.balance,60);assert.equal(shop.thieves[0].amount,40);
  await shop.saveWallet(-10);await shop.action({action:'demo_thief'});assert.equal(shop.theft.amount,0);assert.equal(shop.balance,-10);assert.ok(shop.snapshot().theft);
  shop.theft.at=Date.now()-12001;assert.equal(shop.snapshot().theft,null);
  await shop.action({action:'restore'});assert.equal(shop.snapshot().theft,null);assert.deepEqual(shop.thieves,[]);assert.equal((await new NoodleShop(dir).init()).thieves.length,0);
  assert.throws(()=>config({...shop.config,thief_gift:{gift_id:0,gift_name:'坏绑定'}}),/店铺礼物/);
});

test('送礼人头像按UID复用，同名用户不串头像，新地址更新，重复头像不刷新',async t=>{
  const {shop}=await fixture(t);shop.config.thief_gift={gift_id:90009,gift_name:'小偷礼物'};
  const event={type:'gift',giftId:90009,user:'同名观众',uid:11,count:10,transactionId:'a',face:'http://i0.hdslb.com/a.png'};
  await shop.receive(event);assert.equal(shop.theft.sender.uid,11);assert.equal(shop.theft.sender.face,'https://i0.hdslb.com/a.png');
  await shop.receive({...event,uid:12,transactionId:'b',face:'https://i0.hdslb.com/b.png'});assert.equal(shop.theft.sender.uid,12);assert.equal(shop.theft.sender.face,'https://i0.hdslb.com/b.png');
  await shop.receive({...event,transactionId:'c',face:''});assert.equal(shop.theft.sender.face,'https://i0.hdslb.com/a.png');
  await shop.receive({...event,transactionId:'d',face:'https://i0.hdslb.com/a-new.png'});assert.equal(shop.theft.sender.face,'https://i0.hdslb.com/a-new.png');
  await shop.receive({type:'chat',uid:12,face:'https://i0.hdslb.com/b-new.png'});assert.equal(shop.theft.sender.face,'https://i0.hdslb.com/a-new.png');
  let published=0;shop.on('state',()=>published++);
  await shop.receive({type:'chat',uid:11,face:'https://i0.hdslb.com/a-new.png'});assert.equal(published,0);
  await shop.receive({type:'chat',uid:11,face:'https://i0.hdslb.com/a-newer.png'});assert.equal(published,1);assert.equal(shop.theft.sender.face,'https://i0.hdslb.com/a-newer.png');
  await shop.receive({...event,uid:0,face:'',transactionId:'unknown'});assert.equal(shop.theft.sender.face,'');
});

test('头像图片并发请求共用下载，新地址独立缓存，拒绝不可信地址',async t=>{
  const {dir}=await fixture(t),requests=[];
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW2QAAAAASUVORK5CYII=','base64');
  const app=await startServer({dataDir:dir,seedDir:dir,requestImpl:async url=>{requests.push(url);return {body:url.endsWith('/broken.png')?Buffer.from('invalid'):png,headers:{}};}});t.after(()=>app.close());
  const url=face=>app.url+'/api/avatar?url='+encodeURIComponent(face);
  const faces=await Promise.all(Array.from({length:3},()=>fetch(url('http://i0.hdslb.com/a.png'))));
  for(const r of faces){assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');assert.equal(r.headers.get('cache-control'),'public, max-age=600');await r.arrayBuffer();}
  assert.deepEqual(requests,['https://i0.hdslb.com/a.png']);
  await fetch(url('https://i0.hdslb.com/a-new.png'));await fetch(url('https://i0.hdslb.com/a.png'));assert.equal(requests.length,2);
  assert.equal((await fetch(url('http://127.0.0.1/private'))).status,400);assert.equal(requests.length,2);
  for(let i=0;i<2;i++)assert.equal((await fetch(url('https://i0.hdslb.com/broken.png'))).status,400);
  assert.equal(requests.filter(face=>face.endsWith('/broken.png')).length,1);
});

test('好评按个数加分、满500才恢复五星、重复交易去重、查封中好评不能解封',async t=>{
  const {dir,shop}=await fixture(t);
  await shop.shopAction('review',105);
  const event={type:'gift',giftId:31225,giftName:'牛哇牛哇',uid:1,count:10,transactionId:'praise-one'};
  await shop.receive(event);await shop.receive(event);
  assert.equal(shop.status.points,405);assert.equal(shop.snapshot().stars,4);
  assert.equal(shop.throws.length,0);assert.equal(shop.queue.length,0);
  assert.equal((await new NoodleShop(dir).init()).status.points,405);
  await shop.shopAction('praise',94);assert.equal(shop.status.points,499);assert.equal(shop.snapshot().stars,4);
  await shop.shopAction('praise',1000);assert.equal(shop.status.points,500);assert.equal(shop.snapshot().stars,5);
  await shop.shopAction('review',500);const sealed=structuredClone(shop.status);
  await shop.shopAction('praise',1000);assert.deepEqual(shop.status,sealed);
  await shop.action({action:'demo_restock'});await shop.action({action:'demo_review'});
  const state=await shop.action({action:'demo_praise'});assert.equal(state.points,500);assert.equal(state.sealed,false);
  for(const count of [0,-1,1.5,NaN])await assert.rejects(shop.shopAction('praise',count),/操作无效/);
  assert.throws(()=>config({...shop.config,praise_gift:{gift_id:0,gift_name:'牛哇牛哇'}}),/店铺礼物/);
});

test('查封默认30秒，自定义时长持久保存，当前倒计时不被改配置或重复查封重置',async t=>{
  const {dir,shop}=await fixture(t);
  const legacy={...shop.config};delete legacy.raid_seconds;
  assert.equal(config(legacy).raid_seconds,30);
  for(const value of [null,0,-1,1.5,3601,'30'])assert.throws(()=>config({...shop.config,raid_seconds:value}),/查封时长/);
  await shop.save({...shop.config,raid_seconds:45});await shop.shopAction('raid');
  const deadline=shop.status.sealed_until;
  assert.equal(deadline-shop.status.raid_at,45000);
  await shop.save({...shop.config,raid_seconds:10});await shop.shopAction('raid');
  assert.equal(shop.status.sealed_until,deadline);
  const reload=await new NoodleShop(dir).init();assert.equal(reload.config.raid_seconds,10);assert.equal(reload.status.sealed_until,deadline);
  await reload.releaseExpired(deadline-1);assert.equal(reload.status.sealed,true);
  reload.balance=7;const revision=reload.revision;
  await reload.releaseExpired(deadline);assert.equal(reload.status.sealed,false);assert.equal(reload.status.points,500);assert.equal(reload.status.sealed_until,0);assert.equal(reload.mode,'running');assert.equal(reload.balance,7);assert.equal(reload.revision,revision+1);
  await reload.shopAction('review',500);assert.equal(reload.status.sealed_until-reload.status.raid_at,10000);
  await reload.shopAction('restock');assert.equal(reload.status.sealed_until,0);
  await reload.releaseExpired(deadline+1);assert.equal(reload.status.sealed,false);
});

test('未使用的面馆到期独立解封，不改变当前顾客、营业状态与操作版本',async t=>{
  const {shop}=await fixture(t);const original=shop.activePreset;
  await shop.presetAction({action:'preset_create',name:'第二家'});const other=shop.activePreset;
  await shop.save({...shop.config,raid_seconds:60});await shop.shopAction('raid');const deadline=shop.status.sealed_until;
  await shop.presetAction({action:'preset_use',id:original});shop.mode='paused';shop.queue=[{id:1,user:'当前顾客'}];
  const revision=shop.revision;await shop.releaseExpired(deadline);
  assert.equal(shop.shopStatuses[other].sealed,false);assert.equal(shop.shopStatuses[other].points,500);
  assert.equal(shop.activePreset,original);assert.equal(shop.mode,'paused');assert.equal(shop.revision,revision);assert.equal(shop.queue.length,1);
});

test('旧查封记录按原查封时间补倒计时，重启时已过期则恢复营业',async t=>{
  const {dir,shop}=await fixture(t);const at=Date.now()-10000;
  await fs.writeFile(shop.statusFile,JSON.stringify({saozi:{points:0,sealed:true,raid_at:at}}));
  const reload=await new NoodleShop(dir).init();assert.equal(reload.status.sealed,true);assert.equal(reload.status.sealed_until,at+30000);
  assert.equal(JSON.parse(await fs.readFile(shop.statusFile,'utf8')).saozi.sealed_until,at+30000);
  await fs.writeFile(shop.statusFile,JSON.stringify({saozi:{points:0,sealed:true,raid_at:Date.now()-31000}}));
  const expired=await new NoodleShop(dir).init();assert.equal(expired.status.sealed,false);assert.equal(expired.mode,'running');assert.equal(expired.status.points,500);
});

test('默认四种店铺礼物和盲盒原名匹配，手动绑定仍按所选ID',async t=>{
  const {shop}=await fixture(t);
  for(const [kind,id,name] of [['raid',32251,'心动盲盒'],['restock',36062,'波仔盲盒'],['review',33987,'人气票'],['praise',31039,'牛哇牛哇']]) {
    assert.deepEqual(shop.config[kind+'_gift'],{gift_id:id,gift_name:name,match_name:true});
  }
  const event={type:'gift',giftId:99999,giftName:'开出的礼物',uid:1,count:1,transactionId:'blind-raid',blindGiftName:'心动盲盒'};
  await shop.receive(event);assert.equal(shop.status.sealed,true);
  await shop.receive({...event,transactionId:'blind-restock',blindGiftName:'波仔盲盒'});assert.equal(shop.status.sealed,false);assert.equal(shop.status.points,500);
  await shop.receive({...event,giftId:34391,giftName:'人气票',blindGiftName:'',count:100,transactionId:'review-name'});assert.equal(shop.status.points,400);
  await shop.save({...shop.config,praise_gift:{gift_id:90003,gift_name:'牛哇牛哇'}});
  await shop.receive({...event,giftId:31225,giftName:'牛哇牛哇',blindGiftName:'',transactionId:'strict-id'});assert.equal(shop.status.points,400);
  await shop.receive({...event,giftId:90003,blindGiftName:'',transactionId:'selected-id'});assert.equal(shop.status.points,401);
});

test('旧预设补齐默认礼物并备份，已有绑定保留，之后取消和改绑不被重启覆盖',async t=>{
  const {dir}=await fixture(t);
  const legacy=config({...DEFAULTS,shop_gift_defaults_version:0,raid_gift:{gift_id:90002,gift_name:'自选查封'},restock_gift:null,review_gift:null,praise_gift:null});
  delete legacy.layout.props.rating;
  const other={...legacy,raid_gift:null};
  const saved={...legacy,active_preset:'saozi',presets:[{id:'saozi',name:'臊子面馆',config:legacy},{id:'other',name:'第二家',config:other}]};
  await fs.writeFile(path.join(dir,'noodle.json'),JSON.stringify(saved));
  const shop=await new NoodleShop(dir).init();
  assert.deepEqual(JSON.parse(await fs.readFile(shop.file+'.before-shop-gifts-v1.json','utf8')),saved);
  assert.equal(shop.config.raid_gift.gift_id,90002);
  assert.deepEqual(shop.config.layout.props.rating,Layout.defaults.props.rating);
  assert.equal(shop.presets[1].config.raid_gift.gift_id,32251);
  assert.equal(shop.presets[1].config.praise_gift.gift_id,31039);
  await shop.save({...shop.config,praise_gift:null,review_gift:{gift_id:90004,gift_name:'我的差评'}});
  const reloaded=await new NoodleShop(dir).init();
  assert.equal(reloaded.config.praise_gift,null);assert.equal(reloaded.config.review_gift.gift_id,90004);
  assert.equal(reloaded.config.shop_gift_defaults_version,1);
});

test('评分牌布局兼容旧存档、属于顾客层，API保存缩放并支持好评试玩',async t=>{
  const {dir}=await fixture(t),app=await startServer({dataDir:dir,seedDir:dir});t.after(()=>app.close());
  assert.equal(Layout.itemModule('rating'),'customers');
  const layout=structuredClone(Layout.defaults);layout.props.rating={x:250,y:80,scale:1.8};
  const post=async input=>{const r=await fetch(app.url+'/api/noodle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(r.status,200);return (await r.json()).state;};
  await post({action:'save',config:{...app.noodle.config,layout}});
  assert.deepEqual((await new NoodleShop(dir,app.noodle.templates).init()).config.layout.props.rating,layout.props.rating);
  await post({action:'demo_review'});assert.equal((await post({action:'demo_praise'})).points,500);
  for(const scale of [0,2.01,NaN])assert.throws(()=>Layout.validate({...layout,props:{...layout.props,rating:{x:0,y:0,scale}}}),/物品/);
});

test('新版内置礼物并入旧礼物库，已保存的同ID礼物保留',async t=>{
  const {dir}=await fixture(t),seedDir=path.join(dir,'seed');await fs.mkdir(seedDir);
  const old={id:1,name:'我的礼物',price:1,coinType:'gold',icon:''};
  await fs.writeFile(path.join(dir,'gifts.json'),JSON.stringify({list:[old]}));
  await fs.writeFile(path.join(seedDir,'gifts.json'),JSON.stringify({list:[{...old,name:'旧名称'},{id:36062,name:'波仔盲盒',price:9000,coinType:'gold',icon:''}]}));
  const services=await new ConsoleServices({dataDir:dir,seedDir}).init();
  assert.deepEqual(services.gifts[0],old);assert.equal(services.gifts[1].name,'波仔盲盒');assert.equal(services.state.gifts.count,2);
});
test('鸡蛋菜叶入面消耗垃圾，污染不能伪造或洗掉，递餐扣钱且顾客生气',async t=>{
  const {shop}=await fixture(t);
  shop.objects=[{id:1,kind:'bowl',x:500,y:480,noodles:1,sauce:1}];shop.serial=1;
  for(const kind of ['egg','leaf']) {
    await shop.throwFood(kind);const litter=shop.throws.at(-1);
    await shop.action({action:'spoil',revision:shop.revision,bowl_id:1,throw_id:litter.id,throw_revision:litter.revision});
    assert.equal(shop.objects[0].spoiled,true);assert.equal(shop.throws.length,0);
  }
  shop.workspace({revision:shop.revision,objects:shop.objects.map(o=>({...o,spoiled:false})),selected:1});assert.equal(shop.objects[0].spoiled,true);
  shop.enqueue('顾客',1);await shop.action({action:'feed',revision:shop.revision,bowl_id:1,customer_id:shop.queue[0].id});
  assert.equal(shop.balance,-100);assert.equal(shop.served,0);assert.equal(shop.departures[0].spoiled,true);
});
test('重复满屏投掷不重写存档，重复头像消息不刷新，过期交易及时释放',async t=>{
  const {shop}=await fixture(t);
  await shop.throwFood('egg',36);let published=0;shop.on('state',()=>published++);
  const original=await fs.readFile(shop.throwsFile,'utf8');await shop.throwFood('egg',10000);
  assert.equal(published,0);assert.equal(await fs.readFile(shop.throwsFile,'utf8'),original);assert.equal(shop.throws.length,36);
  shop.enqueue('顾客',2,8,'http://i0.hdslb.com/a.png');published=0;
  await shop.receive({type:'chat',uid:8,face:'http://i0.hdslb.com/a.png'});assert.equal(published,0);
  shop.config.gift_id=1;shop.seen.set('old',Date.now()-300001);
  await shop.receive({type:'gift',giftId:1,count:1,transactionId:'new'});assert.equal(shop.seen.has('old'),false);
  shop.enqueue('排队',2000);shop.config.tip_gift={gift_id:1,gift_name:'打赏'};published=0;
  await shop.receive({type:'gift',giftId:1,count:1,transactionId:'full-queue-tip'});
  assert.equal(shop.queue.length,2000);assert.equal(shop.objects.at(-1).kind,'coin');assert.equal(published,1);
});
test('场景只收游戏推送，控制台不收运动，原订阅保留兼容',async t=>{
  const {dir}=await fixture(t),app=await startServer({dataDir:dir,seedDir:dir});
  t.after(()=>app.close());
  for(const [query,expected] of [['?scene=1',['noodle','noodle-motion']],['?console=1',['state','noodle','overtime','feeding','number-bomb','lottery','lottery','lottery']],['?overtime=1',['overtime']],['?feeding=1',['feeding']],['?bomb=1',['number-bomb']],['?lottery=1',['lottery']],['?lottery=1&game=duel',['lottery']],['?lottery=1&game=scratch',['lottery']],['',['state','noodle','overtime','feeding','number-bomb','lottery','lottery','lottery','noodle-motion']]]) {
    const stop=new AbortController(),timer=setTimeout(()=>stop.abort(),3000);
    const response=await fetch(app.url+'/api/events'+query,{signal:stop.signal}),reader=response.body.getReader();
    try {
      let text='',types=[];
      while(types.length<expected.length) {
        const chunk=await reader.read();assert.equal(chunk.done,false);
        text+=new TextDecoder().decode(chunk.value);types=Array.from(text.matchAll(/^event: ([a-z-]+)$/gm),m=>m[1]);
      }
      assert.deepEqual(types.slice(0,expected.length),expected);
    } finally {clearTimeout(timer);await reader.cancel();stop.abort();}
  }
});

test('定期清理过期交易、头像和动画记录，正在排队与正在偷钱的头像保留',async t=>{
  const {shop}=await fixture(t),now=Date.now();
  for(let uid=1;uid<=4;uid++)shop.rememberFace({uid,face:`https://i0.hdslb.com/${uid}.png`});
  for(let uid=1;uid<=3;uid++)shop.faceTimes.set(uid,now-1800001);
  shop.enqueue('保留顾客',1,2,'https://i0.hdslb.com/2.png');shop.tip();shop.balance=7;
  shop.theft={id:'active',preset:shop.activePreset,at:now,sender:{uid:3},coins:[]};
  shop.seen.set('expired',now-300001);shop.seen.set('active',now-1000);
  shop.departures=[{id:9,at:now-4201},{id:10,at:now-1000}];shop.lastServed={id:9};shop.lastServedAt=now-3001;
  shop.cleanup(now);
  assert.equal(shop.seen.has('expired'),false);assert.equal(shop.seen.has('active'),true);assert.equal(shop.faces.has(1),false);
  for(const uid of [2,3,4])assert.equal(shop.faces.has(uid),true);
  assert.equal(shop.departures.length,1);assert.equal(shop.lastServed,null);assert.ok(shop.theft);assert.equal(shop.queue.length,1);assert.equal(shop.balance,7);assert.equal(shop.objects.length,1);
  shop.cleanup(now+12001);assert.equal(shop.theft,null);assert.equal(shop.faces.has(3),false);assert.equal(shop.faces.has(2),true);assert.equal(shop.departures.length,0);
});

test('普通弹幕不进入礼物队列，礼物仍执行且不会覆盖较新的送礼人头像',async t=>{
  const {dir}=await fixture(t),app=await startServer({dataDir:dir,seedDir:dir});t.after(()=>app.close());
  app.noodle.mode='running';app.noodle.config.thief_gift={gift_id:90009,gift_name:'小偷礼物'};
  let received=0;const receive=app.noodle.receive.bind(app.noodle);app.noodle.receive=(...args)=>{received++;return receive(...args);};
  app.services.addEvent('gift','用户','小偷礼物',{uid:1,face:'https://i0.hdslb.com/old.png',giftId:90009,count:1,transactionId:'cached-avatar'});
  for(let i=0;i<5000;i++)app.services.addEvent('chat','用户','弹幕',{uid:1,face:'https://i0.hdslb.com/new.png'});
  const response=await fetch(app.url+'/api/noodle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start'})});assert.equal(response.status,200);
  assert.equal(received,1);assert.equal(app.services.events.length,200);assert.equal(app.noodle.theft.sender.face,'https://i0.hdslb.com/new.png');assert.equal(app.services.state.stats.chat,5000);
});

test('共享头像缓存限制图片总字节，淘汰后重新请求，已缓存图片仍复用',async t=>{
  const {dir}=await fixture(t),requests=[];
  const png=Buffer.alloc(1024*1024);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  const app=await startServer({dataDir:dir,seedDir:dir,requestImpl:async url=>{requests.push(url);return {body:png,headers:{}};}});t.after(()=>app.close());
  const url=i=>app.url+'/api/avatar?url='+encodeURIComponent(`https://i0.hdslb.com/${i}.png`);
  for(let i=0;i<17;i++){const r=await fetch(url(i));assert.equal(r.status,200);await r.arrayBuffer();}
  const cached=await fetch(url(16));await cached.arrayBuffer();assert.equal(requests.length,17);
  const evicted=await fetch(url(0));await evicted.arrayBuffer();assert.equal(requests.length,18);
});
