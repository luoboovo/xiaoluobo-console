const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { OvertimeMachine } = require('../lib/overtime.cjs');
const { atomicJson } = require('../lib/storage.cjs');
const { startServer } = require('../server.cjs');

const config = {initial_text:'60',time_unit:'分钟',gift_rules:[
  {gift_id:90001,gift_name:'加班',operation:'add',value:1},
  {gift_id:90002,gift_name:'翻倍',operation:'multiply',value:2},
  {gift_id:90003,gift_name:'下班',operation:'clear',value:1},
  {gift_id:90004,gift_name:'锁',operation:'lock_toggle',value:1}
]};
const gift = (giftId, transactionId, count = 1) => ({type:'gift',giftId,transactionId,count,uid:1,user:'观众'});
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'luobo-gift-burst-'));
  t.after(async () => {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'luobo-gift-burst-'));
    await fs.rm(dir,{recursive:true,force:true});
  });
  await fs.mkdir(path.join(dir,'seed'));
  await atomicJson(path.join(dir,'seed','overtime.json'),config);
  const machine = await new OvertimeMachine(dir,{seedDir:path.join(dir,'seed'),clock:()=>0}).init();
  await machine.action({action:'start'});
  return {dir,machine};
}

test('一批礼物按原顺序结算、去重，坏礼物不阻止后续，仅保存和发布一次', async t => {
  const {dir,machine} = await fixture(t), errors = [];
  let publishes = 0;
  machine.on('state', () => publishes++);
  await machine.receiveBatch([
    gift(90001,'add'), gift(90002,'multiply'), gift(90001,'add'),
    gift(90004,'lock'), gift(90003,'blocked'), gift(90001,'invalid',-1),
    gift(90004,'unlock'), gift(90003,'clear'), gift(90001,'after-clear',3)
  ], error => errors.push(error.message));
  assert.equal(machine.remaining(),180n);
  assert.equal(machine.state.people[0].added,'3900');
  assert.equal(machine.state.people[0].reduced,'7320');
  assert.equal(machine.state.history.length,7);
  assert.equal(machine.state.seen.length,7);
  assert.equal(machine.state.history[3].blocked,true);
  assert.equal(errors.length,1);
  assert.equal(publishes,1);
  const reloaded = await new OvertimeMachine(dir).init();
  assert.equal(reloaded.remaining(),180n);
  assert.deepEqual(reloaded.state.people,machine.state.people);
  await machine.receiveBatch([gift(90001,'after-clear',3)]);
  assert.equal(machine.remaining(),180n);
  assert.equal(publishes,1);
});

test('整批保存失败保留原状态、去重和统计，重试可完整结算', async t => {
  const {dir,machine} = await fixture(t), previous = structuredClone(machine.state), anchor = machine.anchor;
  const file = machine.file;
  machine.file = path.join(dir,'blocked');
  await fs.mkdir(machine.file);
  await assert.rejects(machine.receiveBatch([gift(90001,'a'),gift(90002,'b')]));
  assert.deepEqual(machine.state,previous);
  assert.equal(machine.anchor,anchor);
  machine.file = file;
  await machine.receiveBatch([gift(90001,'a'),gift(90002,'b')]);
  assert.equal(machine.remaining(),7320n);
});

test('直播突发送礼分批结算并完整保存，单批数量有界，画面不逐礼物发布', async t => {
  const {dir} = await fixture(t);
  const app = await startServer({dataDir:dir,seedDir:path.join(dir,'seed')});
  t.after(() => app.close());
  app.overtime.clock = () => 0;
  await app.overtime.action({action:'start'});
  app.noodle.mode = 'running'; app.noodle.config.gift_id = 90001; app.noodle.config.water_gift = null;
  const batchSizes = [];
  const receiveBatch = app.overtime.receiveBatch.bind(app.overtime);
  app.overtime.receiveBatch = events => { batchSizes.push(events.length); return receiveBatch(events); };
  let publishes = 0;
  app.overtime.on('state', () => publishes++);
  for (let i = 0; i < 1000; i++) app.services.addGift(gift(90001,'burst-' + i));
  const response = await fetch(app.url + '/api/overtime/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});
  assert.equal(response.status,200);
  assert.equal(app.overtime.remaining(),63600n);
  assert.equal(app.noodle.queue.length,1000);
  assert.equal(app.overtime.state.seen.length,1000);
  assert.equal(batchSizes.reduce((sum,n)=>sum+n,0),1000);
  assert.ok(Math.max(...batchSizes) <= 128);
  assert.ok(publishes <= 9, `突发1000条礼物发布了${publishes}次完整状态`);
  assert.equal(JSON.parse(await fs.readFile(app.overtime.file,'utf8')).remaining,'63600');
});

test('批量素材按礼物顺序和数量排队，失败保存不提前播放', async t => {
  const {dir,machine} = await fixture(t);
  const first = {asset:'a'.repeat(64)+'.png',name:'a.png',kind:'image',duration:120};
  const second = {...first,asset:'b'.repeat(64)+'.png',name:'b.png'};
  await fs.mkdir(machine.mediaDir,{recursive:true});
  for (const media of [first,second]) await fs.writeFile(path.join(machine.mediaDir,media.asset),'fixture');
  await machine.action({action:'configure',config:{...config,gift_rules:[
    {...config.gift_rules[0],media:first}, {...config.gift_rules[1],operation:'media',media:second}
  ]}});
  t.after(() => machine.close());
  const events = [gift(90001,'a',1000),gift(90001,'a',1000),gift(90002,'b',2),gift(90001,'c',3)];
  const file = machine.file;
  machine.file = path.join(dir,'blocked'); await fs.mkdir(machine.file);
  await assert.rejects(machine.receiveBatch(events));
  assert.equal(machine.mediaCue,null); assert.equal(machine.mediaQueue.length,0);
  machine.file = file;
  await machine.receiveBatch(events);
  assert.equal(machine.mediaCue.asset,first.asset);
  assert.deepEqual(machine.mediaQueue.map(item => [item.media.asset,item.count]),[[first.asset,999n],[second.asset,2n],[first.asset,3n]]);
  assert.equal(machine.state.people[0].added,'60180');
});

test('去重保留有效交易、清除过期交易并限制记录数量，未匹配礼物不改状态', async t => {
  const {machine} = await fixture(t);
  const now = Date.now();
  machine.state.seen = Array.from({length:50000},(_,i) => ({key:'old-'+i,time:now}));
  machine.state.seen.unshift({key:'uid:1:90001:expired',time:now-300001});
  const previous = machine.state;
  await machine.receiveBatch([gift(99999,'unmatched')]); assert.equal(machine.state,previous);
  await machine.receiveBatch([gift(90001,'expired'),gift(90001,'new'),gift(90001,'new')]);
  assert.equal(machine.remaining(),3720n);
  assert.equal(machine.state.seen.length,50000);
  assert.equal(machine.state.seen[0].key,'old-2');
  assert.equal(machine.state.seen.at(-1).key,'uid:1:90001:new');
});

test('保存礼物时收到更新头像，入店仍采用最新头像，失败礼物不阻塞后续', async t => {
  const {dir} = await fixture(t);
  const app = await startServer({dataDir:dir,seedDir:path.join(dir,'seed')});
  t.after(() => app.close());
  app.noodle.mode = 'running'; app.noodle.config.gift_id = 90001; app.noodle.config.water_gift = null;
  app.noodle.config.tip_gift = {gift_id:90002,gift_name:'打赏'};
  const receiveBatch = app.overtime.receiveBatch.bind(app.overtime);
  app.overtime.receiveBatch = async (...args) => {
    app.services.addEvent('chat','观众','新头像',{uid:1,face:'https://i0.hdslb.com/new.png'});
    return receiveBatch(...args);
  };
  app.services.addGift({...gift(90002,'full',1000),face:'https://i0.hdslb.com/old.png'});
  app.services.addGift({...gift(90001,'order'),face:'https://i0.hdslb.com/old.png'});
  const response = await fetch(app.url+'/api/noodle/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start'})});
  assert.equal(response.status,200);
  assert.equal(app.noodle.queue.length,1);
  assert.equal(app.noodle.queue[0].face,'https://i0.hdslb.com/new.png');
  assert.ok(app.services.events.some(event => event.type==='system' && event.text.includes('500')));
});
