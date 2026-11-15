const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LiveRobot, normalizeConfig, FEATURES } = require('../lib/robot.cjs');

// 假的 B站：机器人在 7734200（主播 UID 100）。连麦对象 999001「对面主播」（UID 200，短号 88）、999002「第二家」（UID 300）。
// link 是普通连麦（直播间信息里的连线成员），battle 是 PK；都为 null 就是没在连麦。
const ROOMS = {
  999001: { uid: 200, short: 88, name: '对面主播', guards: 88, online: [301, 302], guardList: [401] },
  999002: { uid: 300, short: 0, name: '第二家', guards: 5, online: [501], guardList: [] },
};
function fakeServices({ status = 'connected' } = {}) {
  const s = new EventEmitter();
  const ok = data => ({ data });
  Object.assign(s, {
    platform: 'bilibili', selfUid: 1, battle: null, link: null, lookups: 0, lookupAt: {}, sent: [], sentAt: [],
    state: { account: { loggedIn: true, name: '萝卜机器人' }, live: { status, roomId: 7734200, anchorUid: 100 } },
    secretData: {}, buvid: 'test-buvid', wbi: { key: 'a'.repeat(32) }, ensureWbi: async () => {},
    request: async url => {
      assert.match(url, /battle\/getInfoById\?room_id=7734200$/);
      return { body: Buffer.from(JSON.stringify(s.battle ? { code: 0, data: s.battle } : { code: 6204, message: '无对应大乱斗信息' })) };
    },
    api: async url => {
      const u = new URL(url), endpoint = u.pathname, q = u.searchParams;
      if (endpoint.endsWith('/room_init')) {
        s.lookups++; s.lookupAt[q.get('id')] = Date.now();
        const id = Number(q.get('id')), room = id === 88 ? 999001 : id;
        if (!ROOMS[room]) throw new Error('B站：直播间不存在');
        return ok({ room_id: room, uid: ROOMS[room].uid, short_id: ROOMS[room].short, live_status: 1 });
      }
      if (endpoint.endsWith('/getInfoByRoom')) {
        const room = Number(q.get('room_id'));
        if (room === 7734200 && s.infoFails > 0) { s.infoFails--; throw new Error('B站：-352'); }
        if (room === 7734200) return ok({ universal_interact_info_v2: s.link ? { members: [{ uid: 100, uname: '我', room_id: 7734200, ...(s.scores ? { biz_extra_data: { multi_conn: { price: s.scores[7734200] * 100, price_text: String(s.scores[7734200]) } } } : {}) }, ...s.link.map(r => ({ uid: ROOMS[r].uid, uname: ROOMS[r].name, room_id: r, ...(s.scores ? { biz_extra_data: { multi_conn: { price: s.scores[r] * 100, price_text: String(s.scores[r]) } } } : {}) }))] } : null, pk_info_v2: null, battle_info: s.fight || null });
        const r = ROOMS[room];
        return ok({ room_info: { title: '对面的直播', area_name: '聊天电台', live_status: 1, live_start_time: Math.floor(Date.now() / 1000) - 3900 }, anchor_info: { base_info: { uname: r.name }, relation_info: { attention: 123456 }, medal_info: { fansclub: 3210 }, live_info: { level: 27 } }, guard_info: { count: r.guards }, watched_show: { switch: true, num: 45678 } });
      }
      if (endpoint.endsWith('/getOnlineGoldRank')) {
        const r = ROOMS[Number(q.get('roomId'))];
        return ok(q.get('pageSize') === '50' ? { onlineNum: 1234, OnlineRankItem: q.get('page') === '1' ? r.online.map((uid, i) => ({ uid, score: 10 * (i + 1) })) : [] } : { onlineNum: 1234 });
      }
      if (endpoint.endsWith('/topListNew')) { const r = ROOMS[Number(q.get('roomid'))]; return ok({ info: { num: r.guardList.length, page: 1 }, top3: r.guardList.map(uid => ({ uinfo: { uid } })), list: [] }); }
      throw new Error('没想到的请求 ' + endpoint);
    },
    sendChat: async (text, options) => { if (s.sendDelay) await new Promise(r => setTimeout(r, s.sendDelay)); s.sent.push({ text, ...options }); s.sentAt.push(Date.now()); },
  });
  return s;
}
const battle = (pkId, ours, theirs) => ({ pk_id: pkId, status: 201, init_info: { room_id: 999001, uid: 200, uname: '对面主播', votes: theirs }, match_info: { room_id: 7734200, votes: ours } });
const until = async (check, ms = 8000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('等太久了'); await new Promise(r => setTimeout(r, 10)); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const INFO = '舰长88，在线1234，粉丝12.3万，粉丝团3210';
async function makeRobot(t, options, robotOptions = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-robot-pk-'));
  const services = fakeServices(options);
  const robot = await new LiveRobot(dir, { services, random: () => 0, ...robotOptions }).init();
  t.after(async () => { await robot.close(); await fs.rm(dir, { recursive: true, force: true }); });
  await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 60, pk: { enabled: true } } });
  return { robot, services };
}

test('机器人连麦查对手：普通连麦（不用 PK）也查；每个连麦对象报一次，断开再连再报；多人连线每家一条', async t => {
  const { robot, services } = await makeRobot(t, {}, { pkPollMs: 100 });
  await wait(1700);
  assert.equal(services.sent.length, 0, '没在连麦，不发');

  services.link = [999001];
  await until(() => services.sent.length === 1);
  assert.equal(services.sent[0].text, `连麦的是对面主播，${INFO}`);
  assert.equal(robot.log[0].kind, 'pk');
  await wait(2000);
  assert.equal(services.sent.length, 1, '同一次连麦只报一次');

  services.link = [999001, 999002];
  await until(() => services.sent.length === 2);
  assert.equal(services.sent[1].text, '连麦的是第二家，舰长5，在线1234，粉丝12.3万，粉丝团3210', '多人连线：新来的那家单独报');

  services.link = null;
  await wait(4000); // 连续两次确认不在了才算断开
  services.link = [999001];
  await until(() => services.sent.length === 3);
  assert.equal(services.sent[2].text, `连麦的是对面主播，${INFO}`, '断开后再连上会再报');
});

test('机器人连麦查对手：PK 也算连麦，带比分；观众口令默认关着，打开后回复全部连麦对象', async t => {
  const { robot, services } = await makeRobot(t);
  services.battle = battle('pk-1', 520, 1314);
  services.emit('pk', 'PK_BATTLE_START_NEW');
  await until(() => services.sent.length === 1);
  assert.equal(services.sent[0].text, `连麦的是对面主播，${INFO}`);

  robot.receive({ type: 'chat', user: '观众甲', uid: 5, text: '查对手' });
  await wait(300);
  assert.equal(services.sent.length, 1, '口令查询默认关着');

  await robot.action({ action: 'configure', config: { pk: { ask: true, fields: ['votes', 'level', 'bogus', 'guards'] } } });
  assert.deepEqual(robot.config.pk.fields, ['guards', 'votes', 'level'], '按固定顺序存，不认识的丢掉');
  services.battle = battle('pk-1', 600, 1400);
  robot.receive({ type: 'chat', user: '观众甲', uid: 5, text: '查对手' });
  await until(() => services.sent.length === 2);
  assert.deepEqual(services.sent[1], { text: '连麦的是对面主播，舰长88，比分600:1400，主播27级', replyMid: 5 });
  assert.equal(services.lookups, 1, '同一个直播间 1 分钟内不重复查');

  services.battle = null; services.link = [999001, 999002];
  robot.receive({ type: 'chat', user: '观众乙', uid: 6, text: '帮我查对手' });
  await until(() => services.sent.length === 4);
  assert.deepEqual(services.sent.slice(2), [{ text: '连麦的是对面主播，舰长88，主播27级', replyMid: 6 }, { text: '连麦的是第二家，舰长5，主播27级', replyMid: 0 }], '没在 PK 就没有比分');

  services.link = null;
  robot.receive({ type: 'chat', user: '观众丙', uid: 7, text: '查对手' });
  await until(() => services.sent.length === 5);
  assert.deepEqual(services.sent[4], { text: '现在没在连麦哦~', replyMid: 7 });

  robot.receive({ type: 'chat', user: '观众丙', uid: 7, text: '查对手' });
  await wait(1300);
  assert.equal(services.sent.length, 5, '同一个人 10 秒内只回一次');

  await robot.action({ action: 'configure', config: { pk: { enabled: false } } });
  services.link = [999002];
  services.emit('pk', 'PK_BATTLE_START_NEW');
  robot.receive({ type: 'chat', user: '观众丁', uid: 8, text: '查对手' });
  await wait(1800);
  assert.equal(services.sent.length, 5, '功能关着什么都不做');
});

test('机器人连麦查对手：已经在连麦时连上直播间或打开功能，马上补报', async t => {
  const { robot, services } = await makeRobot(t, { status: 'connecting' });
  services.link = [999001];
  await wait(1700);
  assert.equal(services.sent.length, 0, '还没连上');
  services.state.live.status = 'connected';
  services.emit('state', services.state);
  await until(() => services.sent.length === 1);

  await robot.action({ action: 'configure', config: { pk: { enabled: false } } });
  await robot.action({ action: 'configure', config: { pk: { enabled: true } } });
  await until(() => services.sent.length === 2);
});

test('机器人串门：连麦对象家名单里的人、戴那边粉丝牌的人进来说来串门，自己家粉丝不算；断开就停', async t => {
  const { robot, services } = await makeRobot(t, {}, { pkGuestMs: 50, pkPollMs: 100 });
  services.link = [999001, 999002];
  await until(() => services.sent.length === 2 && robot.snapshot().pk_guests?.count === 4);
  assert.deepEqual(robot.snapshot().pk_guests, { rivals: ['对面主播', '第二家'], count: 4, greeted: 0 }, '两家的在线榜 + 大航海');

  robot.receive({ type: 'member', user: '在线榜观众', uid: 301 });
  robot.receive({ type: 'member', user: '藏牌子的舰长', uid: 401 });
  robot.receive({ type: 'member', user: '戴对面牌子', uid: 888, medal: { targetId: 200, roomId: 999001, name: '对面牌' } });
  robot.receive({ type: 'member', user: '第二家观众', uid: 501 });
  robot.receive({ type: 'member', user: '自家粉丝', uid: 302, medal: { targetId: 100, roomId: 7734200, name: '自家牌' } });
  robot.receive({ type: 'member', user: '路人', uid: 777 });
  robot.receive({ type: 'member', user: '在线榜观众', uid: 301 });
  await until(() => services.sent.length === 4);
  assert.deepEqual(services.sent.slice(2).map(s => s.text), ['欢迎对面主播家的在线榜观众、藏牌子的舰长、戴对面牌子来串门啦~', '欢迎第二家家的第二家观众来串门啦~']);
  assert.equal(robot.log[0].kind, 'visit');

  // 同一个人这次连麦不再说；先发弹幕的也能认出来。
  robot.receive({ type: 'chat', user: '在线榜观众', uid: 301, text: '哈哈' });
  robot.receive({ type: 'chat', user: '对面粉丝说话', uid: 999, text: '来了', medal: { targetId: 200, roomId: 999001, name: '对面牌' } });
  await until(() => services.sent.length === 5);
  assert.equal(services.sent[4].text, '欢迎对面主播家的对面粉丝说话来串门啦~');

  services.link = null;
  await until(() => !robot.snapshot().pk_guests);
  robot.receive({ type: 'member', user: '戴对面牌子2', uid: 889, medal: { targetId: 200, roomId: 999001, name: '对面牌' } });
  await wait(3300);
  assert.equal(services.sent.length, 5, '断开连麦就不再说');

  await robot.action({ action: 'configure', config: { pk: { visit: false } } });
  services.link = [999001];
  await until(() => services.sent.length === 6);
  robot.receive({ type: 'member', user: '戴对面牌子3', uid: 890, medal: { targetId: 200, roomId: 999001, name: '对面牌' } });
  await wait(3300);
  assert.equal(services.sent.length, 6, '关了串门欢迎就不说');
  assert.equal(robot.snapshot().pk_guests, null, '关着就不拉名单');
});

test('机器人连麦查对手：试一试不发到直播间；设置校验；旧默认话术换成连麦的说法', async t => {
  const { robot, services } = await makeRobot(t);
  assert.equal((await robot.action({ action: 'test_pk', text: 'https://live.bilibili.com/88' })).reply, `连麦的是对面主播，${INFO}`);
  assert.match((await robot.action({ action: 'test_pk', text: '' })).reply, /现在没在连麦/);
  services.link = [999001, 999002];
  assert.equal((await robot.action({ action: 'test_pk', text: '' })).reply.split('\n').length, 2, '多人连线每家一行');
  await assert.rejects(robot.action({ action: 'test_pk', text: '12345' }), /直播间不存在/);

  await robot.action({ action: 'configure', config: { pk: { template: '对面是{name}（{room}），看过{watched}，已播{liveTime}，{area}' } } });
  assert.equal((await robot.action({ action: 'test_pk', text: '88' })).reply, '对面是对面主播（88），看过4.6万，已播1小时5分，聊天电台');

  assert.throws(() => normalizeConfig({ pk: { fields: [] } }), /至少勾一项/);
  assert.throws(() => normalizeConfig({ pk: { fields: 'guards' } }), /数据无效/);
  assert.throws(() => normalizeConfig({ pk: { keyword: ' ' } }), /查对手口令/);
  assert.ok(FEATURES.includes('pk'));
  const defaults = { enabled: false, fields: ['guards', 'online', 'followers', 'fansClub'], template: '连麦的是{name}，{info}', ask: false, keyword: '查对手', idle_template: '现在没在连麦哦~', visit: true, visit_template: '欢迎{rival}家的{user}来串门啦~' };
  assert.deepEqual(normalizeConfig({}).pk, defaults);
  assert.deepEqual(normalizeConfig({ pk: { template: '本场PK对手：{name}，{info}', idle_template: '现在没在PK哦~' } }).pk, defaults, '3.3.5 的默认话术自动换掉');
  assert.equal(normalizeConfig({ pk: { template: '我自己写的{name}' } }).pk.template, '我自己写的{name}', '改过的不动');
  assert.ok(robot.snapshot().pk_fields.some(f => f.id === 'watched'));
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

test('机器人连麦查对手：巅峰赛这类对战（直播间信息里的对战字段）也算，带比分', async t => {
  const { robot, services } = await makeRobot(t);
  await robot.action({ action: 'configure', config: { pk: { fields: ['guards', 'votes'] } } });
  // 格式随便套几层：只要有 room_id 和 uid 的主播条目就认。
  services.fight = { season_id: 9, detail: { teams: [{ room_id: 7734200, uid: 100, uname: '我', votes: 30, assist_info: [{ uid: 5, uname: '观众' }] }, { room_id: 999002, uid: 300, uname: '第二家', votes: 70 }] } };
  services.emit('pk', 'PK_BATTLE_START_NEW');
  await until(() => services.sent.length === 1);
  assert.equal(services.sent[0].text, '连麦的是第二家，舰长5，比分30:70');
});

test('机器人连麦查对手：连线时也有比分和对方票数（每家头上的票数）；在线榜总贡献把对方榜单加起来', async t => {
  const { robot, services } = await makeRobot(t);
  await robot.action({ action: 'configure', config: { pk: { fields: ['votes', 'theirVotes', 'rankScore'] } } });
  services.scores = { 7734200: 162, 999001: 61, 999002: 12000 };
  services.link = [999001, 999002];
  services.emit('pk', 'PK_BATTLE_START_NEW');
  await until(() => services.sent.length === 2);
  assert.deepEqual(services.sent.map(s => s.text), ['连麦的是对面主播，比分162:61，票数61，在线榜贡献30', '连麦的是第二家，比分162:1.2万，票数1.2万，在线榜贡献10']);
  // 单独查一个房间号：没有比分和票数，只剩榜单贡献。
  assert.equal((await robot.action({ action: 'test_pk', text: '88' })).reply, '连麦的是对面主播，在线榜贡献30');
});

test('机器人连麦查对手：断线重连、B站偶尔没返回连线信息都不会重报；断开要连续两次确认', async t => {
  const { robot, services } = await makeRobot(t, {}, { pkPollMs: 100 });
  services.link = [999001];
  await until(() => services.sent.length === 1);

  // 断线重连：不算断开连麦。
  services.state.live.status = 'reconnecting'; services.emit('state', services.state);
  await wait(300);
  services.state.live.status = 'connected'; services.emit('state', services.state);
  await wait(2200);
  assert.equal(services.sent.length, 1, '重连后不重报');

  // B站这次没给直播间信息（风控 / 超时），只拿到「没在 PK」：不算断开。
  services.infoFails = 3;
  await until(() => services.infoFails === 0);
  await wait(2200);
  assert.equal(services.sent.length, 1, '连线信息不全时不重报');

  // 换了直播间才从头算。
  services.state.live.roomId = 7734201; services.state.live.status = 'reconnecting'; services.emit('state', services.state);
  services.state.live.status = 'connected'; services.emit('state', services.state);
  await wait(100);
  services.state.live.roomId = 7734200; services.emit('state', services.state);
  await until(() => services.sent.length === 2);
  assert.equal(robot.log.filter(e => e.kind === 'pk').length, 2);
});

test('机器人连麦查对手：多人连麦一家一家发，上一条发出去了才查、才发下一家', async t => {
  const { robot, services } = await makeRobot(t, {}, { pkPollMs: 100 });
  services.sendDelay = 400;
  services.link = [999001, 999002];
  await until(() => services.sent.length === 2);
  assert.deepEqual(services.sent.map(s => s.text.split('，')[0]), ['连麦的是对面主播', '连麦的是第二家']);
  assert.ok(services.lookupAt['999002'] >= services.sentAt[0], '第一家发出去之后才查第二家');
  await wait(1500);
  assert.equal(services.sent.length, 2, '不会重复发');
  assert.equal(robot.log.filter(e => e.kind === 'pk').length, 2);
});
