const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startServer } = require('../server.cjs');

const post = async (app, url, body) => {
  const response = await fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || response.status);
  return json;
};
// 记下每个玩法收到了几次直播间消息（不真的执行，只看有没有送到）。
function spy(app) {
  const got = { noodle: 0, feeding: 0, overtime: 0, number_bomb: 0, lottery: 0 };
  app.noodle.receive = async () => { got.noodle++; };
  app.feeding.receiveBatch = async events => { got.feeding += events.length; };
  app.feeding.receiveChat = async () => { got.feeding++; };
  app.feeding.chatRules = () => [{}];
  app.overtime.receiveBatch = async events => { got.overtime += events.length; };
  app.numberBomb.receiveChat = async () => { got.number_bomb++; };
  for (const target of Object.values(app.lottery)) target.receiveChat = async () => { got.lottery++; };
  return got;
}
// 等前面排队的礼物和弹幕处理完：手动操作和直播消息走同一条队列。
const settle = app => post(app, '/api/overtime/action', { action: 'pause' }).catch(() => {});

test('玩法总开关：默认全关，关着的玩法收不到直播间的礼物和弹幕；打开哪个只送哪个，重启后记得', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-features-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let app = await startServer({ dataDir: dir, seedDir: dir });
  try {
    const list = await (await fetch(app.url + '/api/features')).json();
    assert.deepEqual(list.map(f => [f.id, f.name, f.enabled]), [['noodle', '弹幕面馆', false], ['feeding', '小萝卜吃吃吃', false], ['lottery', '抽奖工具', false], ['number_bomb', '数字炸弹', false], ['overtime', '加班机', false]]);
    let got = spy(app);
    app.services.addGift({ type: 'gift', giftId: 1, transactionId: 'a', count: 1, uid: 1, user: '观众' });
    app.services.addEvent('chat', '观众', '参加', { uid: 1 });
    await settle(app);
    assert.deepEqual(got, { noodle: 0, feeding: 0, overtime: 0, number_bomb: 0, lottery: 0 }, '全关时谁都收不到');

    await assert.rejects(post(app, '/api/features', { id: 'nope', enabled: true }), /没有这个功能/);
    await assert.rejects(post(app, '/api/features', { id: 'noodle', enabled: 'yes' }), /开或关/);
    const saved = await post(app, '/api/features', { id: 'noodle', enabled: true });
    assert.equal(saved.features.find(f => f.id === 'noodle').enabled, true);
    await post(app, '/api/features', { id: 'lottery', enabled: true });
    app.services.addGift({ type: 'gift', giftId: 1, transactionId: 'b', count: 1, uid: 1, user: '观众' });
    app.services.addEvent('chat', '观众', '参加', { uid: 1 });
    await settle(app);
    assert.deepEqual(got, { noodle: 1, feeding: 0, overtime: 0, number_bomb: 0, lottery: 3 }, '只送给打开的面馆和抽奖（抽奖三个玩法各一次）');
    await app.close();

    app = await startServer({ dataDir: dir, seedDir: dir });
    const again = await (await fetch(app.url + '/api/features')).json();
    assert.deepEqual(again.filter(f => f.enabled).map(f => f.id), ['noodle', 'lottery'], '重启后记得');
    await post(app, '/api/features', { id: 'noodle', enabled: false });
    got = spy(app);
    app.services.addGift({ type: 'gift', giftId: 1, transactionId: 'c', count: 1, uid: 1, user: '观众' });
    await settle(app);
    assert.equal(got.noodle, 0, '关掉就不再接');
  } finally { await app.close(); }
});
