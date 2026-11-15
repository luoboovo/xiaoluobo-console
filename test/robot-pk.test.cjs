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
    state: { account: { loggedIn: true, name: '萝卜机器人' }, live: { status, roomId: 7734200, anchorUid: 100 } },
    secretData: {}, buvid: 'test-buvid', wbi: { key: 'a'.repeat(32) }, ensureWbi: async () => {},
    request: async url => {
      assert.match(url, /battle\/getInfoById\?room_id=7734200$/);
      return { body: Buffer.from(JSON.stringify(s.battle ? { code: 0, data: s.battle } : { code: 6204, message: '无对应大乱斗信息' })) };
    },
    api: async url => {
      const u = new URL(url), endpoint = u.pathname;
      if (endpoint.endsWith('/room_init')) { s.lookups++; if (['88', '999001'].includes(u.searchParams.get('id'))) return ok({ room_id: 999001, uid: 200, short_id: 88, live_status: 1 }); throw new Error('B站：直播间不存在'); }
      if (endpoint.endsWith('/getInfoByRoom')) return ok({ room_info: { title: '对面的直播', area_name: '聊天电台', live_status: 1, live_start_time: Math.floor(Date.now() / 1000) - 3900 }, anchor_info: { base_info: { uname: '对面主播' }, relation_info: { attention: 123456 }, medal_info: { fansclub: 3210 }, live_info: { level: 27 } }, guard_info: { count: 88 }, watched_show: { switch: true, num: 45678 } });
      if (endpoint.endsWith('/getOnlineGoldRank')) return ok(u.searchParams.get('pageSize') === '50' ? { onlineNum: 1234, OnlineRankItem: u.searchParams.get('page') === '1' ? [{ uid: 301 }, { uid: 302 }] : [] } : { onlineNum: 1234 });
      if (endpoint.endsWith('/topListNew')) return ok({ info: { num: 1, page: 1 }, top3: [{ uinfo: { uid: 401 } }], list: [] });
      throw new Error('没想到的请求 ' + endpoint);
    },
    sendChat: async (text, options) => { s.sent.push({ text, ...options }); },
  });
  return s;
}
const battle = (pkId, ours, theirs) => ({ pk_id: pkId, status: 201, init_info: { room_id: 999001, uid: 200, uname: '对面主播', votes: theirs }, match_info: { room_id: 7734200, votes: ours } });
const until = async (check, ms = 4000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('等太久了'); await new Promise(r => setTimeout(r, 10)); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function makeRobot(t, options, robotOptions = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-robot-pk-'));
  const services = fakeServices(options);
  const robot = await new LiveRobot(dir, { services, random: () => 0, ...robotOptions }).init();
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
  assert.deepEqual(normalizeConfig({}).pk, { enabled: false, fields: ['guards', 'online', 'followers', 'fansClub'], template: '本场PK对手：{name}，{info}', ask: false, keyword: '查对手', idle_template: '现在没在PK哦~', visit: true, visit_template: '欢迎{rival}家的{user}来串门啦~' });
  assert.ok(robot.snapshot().pk_fields.some(f => f.id === 'watched'));
});

test('机器人 PK 串门：对面名单里的人、戴对面粉丝牌的人进来说来串门，自己家粉丝不算；PK 结束就停', async t => {
  const { robot, services } = await makeRobot(t, {}, { pkGuestMs: 50 });
  services.battle = battle('pk-5', 1, 2);
  services.emit('pk', 'PK_BATTLE_START_NEW');
  await until(() => services.sent.length === 1 && robot.pkGuests.size === 3);
  assert.deepEqual([...robot.pkGuests].sort(), [301, 302, 401], '在线榜 + 大航海');

  robot.receive({ type: 'member', user: '在线榜观众', uid: 301 });
  robot.receive({ type: 'member', user: '藏牌子的舰长', uid: 401 });
  robot.receive({ type: 'member', user: '戴对面牌子', uid: 888, medal: { targetId: 200, roomId: 999001, name: '对面牌' } });
  robot.receive({ type: 'member', user: '自家粉丝', uid: 302, medal: { targetId: 100, roomId: 7734200, name: '自家牌' } });
  robot.receive({ type: 'member', user: '路人', uid: 777 });
  robot.receive({ type: 'member', user: '在线榜观众', uid: 301 });
  await until(() => services.sent.length === 2);
  assert.equal(services.sent[1].text, '欢迎对面主播家的在线榜观众、藏牌子的舰长、戴对面牌子来串门啦~');
  assert.equal(robot.log[0].kind, 'visit');
  assert.deepEqual(robot.snapshot().pk_guests, { rival: '对面主播', count: 3, greeted: 3 });

  // 同一个人这场 PK 不再说；先发弹幕的也能认出来。
  robot.receive({ type: 'chat', user: '在线榜观众', uid: 301, text: '哈哈' });
  robot.receive({ type: 'chat', user: '对面粉丝说话', uid: 999, text: '来了', medal: { targetId: 200, roomId: 999001, name: '对面牌' } });
  await until(() => services.sent.length === 3);
  assert.equal(services.sent[2].text, '欢迎对面主播家的对面粉丝说话来串门啦~');

  await robot.action({ action: 'configure', config: { pk: { visit_template: '{rival}家的{user}来玩啦' } } });
  services.battle = null;
  await until(() => robot.pkGuests.size === 0 && !robot.snapshot().pk_guests);
  robot.receive({ type: 'member', user: '戴对面牌子2', uid: 889, medal: { targetId: 200, roomId: 999001, name: '对面牌' } });
  await wait(3300);
  assert.equal(services.sent.length, 3, 'PK 结束就不再说');

  await robot.action({ action: 'configure', config: { pk: { visit: false } } });
  services.battle = battle('pk-6', 0, 0);
  services.emit('pk', 'PK_BATTLE_START_NEW');
  await until(() => services.sent.length === 4);
  robot.receive({ type: 'member', user: '戴对面牌子3', uid: 890, medal: { targetId: 200, roomId: 999001, name: '对面牌' } });
  await wait(3300);
  assert.equal(services.sent.length, 4, '关了串门欢迎就不说');
  assert.equal(robot.pkGuests.size, 0, '关着就不拉名单');
});

test('进场和弹幕消息带上粉丝牌（属于哪个主播、哪个直播间）', async t => {
  const { ConsoleServices } = require('../lib/services.cjs');
  const { field, varint } = require('../lib/douyin.cjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-medal-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const s = await new ConsoleServices({ dataDir: dir, seedDir: dir }).init();
  const events = []; s.on('event', e => events.push(e));
  const num = (key, n) => Buffer.concat([varint(key * 8), varint(n)]);
  const medal = Buffer.concat([num(1, 3747582713006124), num(2, 21), field(3, '羊宠'), num(12, 1987279179)]);
  s.liveMessage({ cmd: 'INTERACT_WORD_V2', data: { pb: Buffer.concat([num(1, 42), field(2, '观众甲'), num(5, 1), field(9, medal)]).toString('base64') } });
  s.liveMessage({ cmd: 'INTERACT_WORD_V2', data: { pb: Buffer.concat([num(1, 43), field(2, '没牌子'), num(5, 1)]).toString('base64') } });
  s.liveMessage({ cmd: 'INTERACT_WORD', data: { uname: '老格式', uid: 44, msg_type: 1, fans_medal: { target_id: 200, anchor_roomid: 999001, medal_name: '对面牌' } } });
  s.liveMessage({ cmd: 'DANMU_MSG', info: [[], '你好', [45, '说话的人', 0], [12, '对面牌', '对面主播', 999001, 0, '', 0, 0, 0, 0, 0, 0, 200]] });
  assert.deepEqual(events.map(e => [e.user, e.uid, e.medal]), [
    ['观众甲', 42, { targetId: 3747582713006124, roomId: 1987279179, name: '羊宠' }],
    ['没牌子', 43, undefined],
    ['老格式', 44, { targetId: 200, roomId: 999001, name: '对面牌' }],
    ['说话的人', 45, { targetId: 200, roomId: 999001, name: '对面牌' }],
  ]);
  s.close();
});
