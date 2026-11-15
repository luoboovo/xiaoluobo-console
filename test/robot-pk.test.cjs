const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LiveRobot, normalizeConfig, FEATURES } = require('../lib/robot.cjs');

// 假的 B站：机器人在 7734200，对面是 999001（短号 88）。battle 为 null 就是没在 PK。
function fakeServices({ status = 'connected' } = {}) {
  const s = new EventEmitter();
  const ok = data => ({ data });
  Object.assign(s, {
    platform: 'bilibili', selfUid: 1, battle: null, lookups: 0, sent: [],
    state: { account: { loggedIn: true, name: '萝卜机器人' }, live: { status, roomId: 7734200 } },
    secretData: {}, buvid: 'test-buvid', wbi: { key: 'a'.repeat(32) }, ensureWbi: async () => {},
    request: async url => {
      assert.match(url, /battle\/getInfoById\?room_id=7734200$/);
      return { body: Buffer.from(JSON.stringify(s.battle ? { code: 0, data: s.battle } : { code: 6204, message: '无对应大乱斗信息' })) };
    },
    api: async url => {
      const u = new URL(url), endpoint = u.pathname;
      if (endpoint.endsWith('/room_init')) { s.lookups++; if (['88', '999001'].includes(u.searchParams.get('id'))) return ok({ room_id: 999001, uid: 200, short_id: 88, live_status: 1 }); throw new Error('B站：直播间不存在'); }
      if (endpoint.endsWith('/getInfoByRoom')) return ok({ room_info: { title: '对面的直播', area_name: '聊天电台', live_status: 1, live_start_time: Math.floor(Date.now() / 1000) - 3900 }, anchor_info: { base_info: { uname: '对面主播' }, relation_info: { attention: 123456 }, medal_info: { fansclub: 3210 }, live_info: { level: 27 } }, guard_info: { count: 88 }, watched_show: { switch: true, num: 45678 } });
      if (endpoint.endsWith('/getOnlineGoldRank')) return ok({ onlineNum: 1234 });
      throw new Error('没想到的请求 ' + endpoint);
    },
    sendChat: async (text, options) => { s.sent.push({ text, ...options }); },
  });
  return s;
}
const battle = (pkId, ours, theirs) => ({ pk_id: pkId, status: 201, init_info: { room_id: 999001, votes: theirs }, match_info: { room_id: 7734200, votes: ours } });
const until = async (check, ms = 4000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('等太久了'); await new Promise(r => setTimeout(r, 10)); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function makeRobot(t, options) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-robot-pk-'));
  const services = fakeServices(options);
  const robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
  t.after(async () => { await robot.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 60, pk: { enabled: true } } });
  return { robot, services };
}

test('机器人 PK 查对手：连上 PK 就自动查对面并发弹幕，每场只发一次；口令查询默认关着', async t => {
  const { robot, services } = await makeRobot(t);
  await wait(1700);
  assert.equal(services.sent.length, 0, '打开功能时没在 PK，不发');

  services.battle = battle('pk-1', 520, 1314);
  services.emit('pk', 'PK_BATTLE_START_NEW');
  await until(() => services.sent.length === 1);
  assert.equal(services.sent[0].text, '本场PK对手：对面主播，舰长88，在线1234，粉丝12.3万，粉丝团3210');
  assert.equal(robot.log[0].kind, 'pk');

  services.emit('pk', 'PK_BATTLE_START_NEW');
  services.emit('pk', 'PK_BATTLE_PROCESS_NEW');
  await wait(1800);
  assert.equal(services.sent.length, 1, '同一场 PK 只报一次');

  robot.receive({ type: 'chat', user: '观众甲', uid: 5, text: '查对手' });
  await wait(300);
  assert.equal(services.sent.length, 1, '口令查询默认关着');

  await robot.action({ action: 'configure', config: { pk: { ask: true, fields: ['votes', 'level', 'bogus', 'guards'] } } });
  assert.deepEqual(robot.config.pk.fields, ['guards', 'votes', 'level'], '按固定顺序存，不认识的丢掉');
  services.battle = battle('pk-1', 600, 1400);
  robot.receive({ type: 'chat', user: '观众甲', uid: 5, text: '查对手' });
  await until(() => services.sent.length === 2);
  assert.deepEqual(services.sent[1], { text: '本场PK对手：对面主播，舰长88，比分600:1400，主播27级', replyMid: 5 });
  assert.equal(services.lookups, 1, '同一个对手 1 分钟内不重复查');

  services.battle = null;
  robot.receive({ type: 'chat', user: '观众乙', uid: 6, text: '帮我查对手' });
  await until(() => services.sent.length === 3);
  assert.deepEqual(services.sent[2], { text: '现在没在PK哦~', replyMid: 6 });

  // 下一场 PK：比分消息也能触发（隔 15 秒才看一次，开始消息不受限制）。
  services.battle = battle('pk-2', 0, 0);
  services.emit('pk', 'PK_BATTLE_PRE_NEW');
  await until(() => services.sent.length === 4);
  assert.match(services.sent[3].text, /^本场PK对手：对面主播/);

  await robot.action({ action: 'configure', config: { pk: { enabled: false } } });
  services.battle = battle('pk-3', 0, 0);
  services.emit('pk', 'PK_BATTLE_START_NEW');
  robot.receive({ type: 'chat', user: '观众丙', uid: 7, text: '查对手' });
  await wait(1800);
  assert.equal(services.sent.length, 4, '功能关着什么都不做');
});

test('机器人 PK 查对手：已经在 PK 时连上直播间或打开功能，马上补报', async t => {
  const { robot, services } = await makeRobot(t, { status: 'connecting' });
  services.battle = battle('pk-9', 10, 20);
  await wait(1700);
  assert.equal(services.sent.length, 0, '还没连上');
  services.state.live.status = 'connected';
  services.emit('state', services.state);
  await until(() => services.sent.length === 1);
  assert.match(services.sent[0].text, /^本场PK对手：对面主播/);

  await robot.action({ action: 'configure', config: { pk: { enabled: false } } });
  services.battle = battle('pk-10', 0, 0);
  await robot.action({ action: 'configure', config: { pk: { enabled: true } } });
  await until(() => services.sent.length === 2);
});

test('机器人 PK 查对手：试一试不发到直播间；设置校验；默认关着', async t => {
  const { robot, services } = await makeRobot(t);
  const { reply } = await robot.action({ action: 'test_pk', text: 'https://live.bilibili.com/88' });
  assert.equal(reply, '本场PK对手：对面主播，舰长88，在线1234，粉丝12.3万，粉丝团3210');
  assert.match((await robot.action({ action: 'test_pk', text: '' })).reply, /现在没在 PK/);
  await assert.rejects(robot.action({ action: 'test_pk', text: '12345' }), /直播间不存在/);
  assert.equal(services.sent.length, 0);

  await robot.action({ action: 'configure', config: { pk: { template: '对面是{name}（{room}），看过{watched}，已播{liveTime}，{area}' } } });
  assert.equal((await robot.action({ action: 'test_pk', text: '88' })).reply, '对面是对面主播（88），看过4.6万，已播1小时5分，聊天电台');

  assert.throws(() => normalizeConfig({ pk: { fields: [] } }), /至少勾一项/);
  assert.throws(() => normalizeConfig({ pk: { fields: 'guards' } }), /数据无效/);
  assert.throws(() => normalizeConfig({ pk: { keyword: ' ' } }), /查对手口令/);
  assert.ok(FEATURES.includes('pk'));
  assert.deepEqual(normalizeConfig({}).pk, { enabled: false, fields: ['guards', 'online', 'followers', 'fansClub'], template: '本场PK对手：{name}，{info}', ask: false, keyword: '查对手', idle_template: '现在没在PK哦~' });
  assert.ok(robot.snapshot().pk_fields.some(f => f.id === 'watched'));
});
