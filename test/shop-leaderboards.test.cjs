const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { NoodleShop } = require('../lib/noodle.cjs');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-leaderboards-'));
  t.after(() => fs.rm(dir, {recursive:true, force:true}));
  const shop = await new NoodleShop(dir).init(); shop.mode='running';
  return { dir, shop };
}
async function serve(shop, uid, name, correct=true, order='noodles') {
  shop.enqueue(name, 1, uid, '', false, order);
  const customer = shop.queue.at(-1), bowl = {id:++shop.serial,kind:order==='water'?'water':'bowl',x:500,y:550,noodles:1,sauce:correct?1:0};
  shop.objects.push(bowl);
  await shop.action({action:'feed',revision:shop.revision,object_id:bowl.id,customer_id:customer.id});
}

test('评价按好评加差评总数降序，同账号合并、更新昵称，重启保留旧偷钱榜和新榜', async t => {
  const {dir, shop}=await fixture(t);
  await shop.saveWallet(500);
  await shop.shopAction('thief',1,{uid:9,user:'原小偷'});
  await shop.shopAction('praise',6,{uid:1,user:'旧昵称',face:'https://i0.hdslb.com/a.png'});
  await shop.shopAction('review',3,{uid:'1',user:'新昵称'});
  await shop.shopAction('review',10,{uid:2,user:'差评观众'});
  const board=shop.snapshot().review_board;
  assert.deepEqual(board.map(p=>[p.uid,p.name,p.praise,p.review]),[['2','差评观众',0,10],['1','新昵称',6,3]]);
  assert.equal(board[1].face,'https://i0.hdslb.com/a.png');
  const reload=await new NoodleShop(dir).init();
  assert.deepEqual(reload.snapshot().review_board,board);
  assert.deepEqual(reload.snapshot().thief_board,shop.snapshot().thief_board);
  assert.equal(reload.balance,shop.balance);
});

test('大胃袋只累计正确主餐，帮做饭也计入，错餐和普通饮水不增加', async t => {
  const {dir,shop}=await fixture(t);
  await serve(shop,1,'第一位'); await serve(shop,'1','第一位新昵称');
  await serve(shop,2,'第二位'); await serve(shop,2,'第二位',false); await serve(shop,3,'喝水的',true,'water');
  shop.enqueue('第一位新昵称',1,1); await shop.action({action:'demo_help'});
  assert.deepEqual(shop.snapshot().eater_board.map(p=>[p.uid,p.name,p.eaten]),[['1','第一位新昵称',3],['2','第二位',1]]);
  assert.equal(shop.served,5);
  assert.deepEqual((await new NoodleShop(dir).init()).snapshot().eater_board,shop.snapshot().eater_board);
});

test('评价按礼物数量累计，重复交易不重复上榜，头像迟到后补齐', async t => {
  const {shop}=await fixture(t), rule=shop.config.praise_gift;
  const gift={type:'gift',uid:'12345678901234567890',user:'好评观众',giftId:rule.gift_id,giftName:rule.gift_name,count:7,transactionId:'one'};
  await shop.receive(gift); await shop.receive(gift);
  assert.equal(shop.snapshot().review_board[0].praise,7);
  let publishes=0; shop.on('state',()=>publishes++);
  shop.rememberFace({uid:gift.uid,face:'https://p3.douyinpic.com/avatar.jpg'});
  assert.equal(publishes,1); assert.equal(shop.snapshot().review_board[0].face,'https://p3.douyinpic.com/avatar.jpg');
  shop.rememberFace({uid:gift.uid,face:'https://p3.douyinpic.com/avatar.jpg'}); assert.equal(publishes,1);
  shop.rememberFace({uid:gift.uid,face:'http://127.0.0.1/private'}); assert.equal(publishes,1);
});

test('写盘失败不吞餐、不记榜，损坏榜单不覆盖，恢复游戏清空三个榜', async t => {
  const {dir,shop}=await fixture(t), original=shop.walletFile;
  shop.enqueue('观众',1,1); const revision=shop.revision;
  shop.walletFile=path.join(dir,'blocked'); await fs.mkdir(shop.walletFile);
  await assert.rejects(shop.help());
  assert.equal(shop.queue.length,1); assert.equal(shop.served,0); assert.equal(shop.revision,revision); assert.deepEqual(shop.audience,[]);
  await assert.rejects(shop.shopAction('review',1,{uid:1})); assert.equal(shop.status.points,500);
  shop.walletFile=original;
  await shop.help(); await shop.shopAction('review',1,{uid:1}); await shop.saveWallet(100); await shop.steal({uid:1});
  await shop.action({action:'restore'});
  const reload=await new NoodleShop(dir).init();
  for(const key of ['thief_board','review_board','eater_board']) assert.deepEqual(reload.snapshot()[key],[]);
  const bad={balance:0,unit_version:2,audience:[{uid:'1',name:'坏记录',face:'',praise:-1,review:0,eaten:0}]};
  const content=JSON.stringify(bad); await fs.writeFile(original,content);
  await assert.rejects(new NoodleShop(dir).init(),/观众榜单记录/); assert.equal(await fs.readFile(original,'utf8'),content);
});

test('三个榜各取前十，空账号按昵称区分，累计溢出不会更改记录', async t => {
  const {shop}=await fixture(t);
  for(let i=1;i<=12;i++) await shop.shopAction('praise',i,{uid:i,user:'观众'+i});
  assert.deepEqual(shop.snapshot().review_board.map(p=>p.praise),[12,11,10,9,8,7,6,5,4,3]);
  await shop.shopAction('praise',1,{user:'匿名甲'}); await shop.shopAction('review',2,{user:'匿名乙'});
  assert.equal(shop.audience.filter(p=>p.uid==='0').length,2);
  shop.audience[0].praise=Number.MAX_SAFE_INTEGER;
  await assert.rejects(shop.shopAction('review',1,{uid:1}),/超出范围/); assert.equal(shop.audience[0].review,0);
});

test('手动翻页按当前自动页前进后退，重置8秒计时且不改变游戏版本', async t => {
  const {shop}=await fixture(t), now=Date.now(), revision=shop.revision;
  t.mock.method(Date,'now',()=>now);
  shop.leaderboard={page:0,at:now-8000,interval:8000};
  await shop.action({action:'leaderboard_page',direction:1});
  assert.deepEqual(shop.snapshot().leaderboard,{page:2,at:now,interval:8000});
  await shop.action({action:'leaderboard_page',direction:1}); assert.equal(shop.leaderboard.page,0);
  await shop.action({action:'leaderboard_page',direction:-1}); assert.equal(shop.leaderboard.page,2);
  assert.equal(shop.revision,revision);
  for(const direction of [0,2,'1',null]) await assert.rejects(shop.action({action:'leaderboard_page',direction}),/翻页方向/);
});
