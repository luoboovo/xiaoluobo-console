const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { danmuReply, mentionOf } = require('../lib/protocol.cjs');
const { ConsoleServices } = require('../lib/services.cjs');
const { decodeFrame, field, varint } = require('../lib/douyin.cjs');
const { LiveRobot, splitText, cleanReply, normalizeConfig } = require('../lib/robot.cjs');

const tempDir = prefix => fs.mkdtemp(path.join(os.tmpdir(), prefix));
const remove = dir => fs.rm(dir, { recursive: true, force: true });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('B站回复弹幕：从 extra 里取出 @ 的人，正文不变', async () => {
  assert.deepEqual(danmuReply('{"reply_uname":"小萝卜","reply_mid":42,"content":"你好"}'), { name: '小萝卜', uid: 42 });
  assert.equal(danmuReply('{"reply_uname":""}'), null);
  assert.equal(danmuReply('not json'), null);
  assert.deepEqual(mentionOf('@主播 晚上好'), { mention: { name: '主播', uid: 0 } });
  assert.deepEqual(mentionOf('晚上好'), {});
  const dir = await tempDir('luobo-mention-');
  const services = await new ConsoleServices({ dataDir: dir, seedDir: dir }).init();
  try {
    services.liveMessage({ cmd: 'DANMU_MSG', info: [[0, 1, 25, 16777215, 0, 0, 0, '', 0, 0, 0, '', 0, '{}', '{}', { extra: JSON.stringify({ reply_uname: '萝卜机器人', reply_mid: 7, content: '查询盲盒记录' }) }], '查询盲盒记录', [99, '观众甲']] });
    const event = services.events[0];
    assert.equal(event.text, '查询盲盒记录'); assert.deepEqual(event.mention, { name: '萝卜机器人', uid: 7 }); assert.equal(event.uid, 99);
    services.liveMessage({ cmd: 'INTERACT_WORD', data: { uname: '观众乙', uid: 5, msg_type: 1 } });
    assert.equal(services.events[0].type, 'member'); assert.equal(services.events[0].user, '观众乙');
    services.liveMessage({ cmd: 'INTERACT_WORD', data: { uname: '观众丙', uid: 6, msg_type: 2 } });
    assert.equal(services.events[0].type, 'social'); assert.equal(services.events[0].follow, true);
    const pb = Buffer.concat([Buffer.from([8]), varint(8), field(2, '观众丁'), Buffer.from([40, 1])]).toString('base64');
    services.liveMessage({ cmd: 'INTERACT_WORD_V2', data: { pb } });
    assert.equal(services.events[0].type, 'member'); assert.equal(services.events[0].user, '观众丁'); assert.equal(services.events[0].uid, 8);
    services.liveMessage({ cmd: 'SEND_GIFT', data: { uname: '观众甲', uid: 99, giftId: 1, giftName: '小花花', num: 1, price: 100, blind_gift: { original_gift_name: '心动盲盒', original_gift_price: 15000 } } });
    assert.equal(services.events[0].blindGiftPrice, 15000); assert.equal(services.events[0].giftPrice, 100);
  } finally { services.close(); await remove(dir); }
});

test('抖音评论：rtf_content 里的 @ 用户会带到事件上', () => {
  const userMsg = (uid, name) => Buffer.concat([Buffer.from([8]), varint(uid), field(3, name)]);
  const piece = (body) => field(4, body);
  const rtf = Buffer.concat([piece(field(21, field(1, userMsg(2, '主播小萝卜')))), piece(field(11, ' 你好'))]);
  const chat = Buffer.concat([field(2, userMsg(1, '观众甲')), field(3, '你好'), field(22, rtf)]);
  const envelope = Buffer.concat([field(1, 'WebcastChatMessage'), field(2, chat)]);
  const frame = Buffer.concat([field(8, field(1, envelope))]);
  const { messages } = decodeFrame(frame);
  assert.equal(messages[0].text, '你好'); assert.equal(messages[0].user, '观众甲'); assert.deepEqual(messages[0].mention, { name: '主播小萝卜', uid: '2' });
  const plain = decodeFrame(field(8, field(1, Buffer.concat([field(1, 'WebcastChatMessage'), field(2, Buffer.concat([field(2, userMsg(1, '观众甲')), field(3, '@主播 在吗')]))]))));
  assert.deepEqual(plain.messages[0].mention, { name: '主播', uid: 0 });
});

test('B站发弹幕：带上 csrf、房间号和回复对象，屏蔽和失败会报错', async () => {
  const dir = await tempDir('luobo-send-');
  const posts = []; let reply = { code: 0, msg: '' };
  const services = await new ConsoleServices({ dataDir: dir, seedDir: dir, postImpl: async (url, body, cookie) => { posts.push({ url, body: new URLSearchParams(body), cookie }); return { body: Buffer.from(JSON.stringify(reply)), headers: {} }; } }).init();
  try {
    await assert.rejects(services.sendChat('你好'), /未连接/);
    services.state.live = { status: 'connected', roomId: 123 };
    await assert.rejects(services.sendChat('你好'), /登录/);
    services.secretData.cookie = 'SESSDATA=a; bili_jct=token; DedeUserID=9';
    assert.equal(services.selfUid, 9);
    await services.sendChat('谢谢观众', { replyMid: 42 });
    assert.equal(posts[0].url, 'https://api.live.bilibili.com/msg/send');
    assert.equal(posts[0].body.get('msg'), '谢谢观众'); assert.equal(posts[0].body.get('roomid'), '123'); assert.equal(posts[0].body.get('csrf'), 'token'); assert.equal(posts[0].body.get('reply_mid'), '42');
    reply = { code: 0, msg: 'f' }; await assert.rejects(services.sendChat('x'), /屏蔽/);
    reply = { code: 10030, message: '您发送弹幕的频率过快' }; await assert.rejects(services.sendChat('x'), error => error.code === 10030);
    await services.selectPlatform('douyin');
    await assert.rejects(services.sendChat('x'), error => error.code === 'UNSUPPORTED');
  } finally { services.close(); await remove(dir); }
});

test('文本切分与 AI 回复清理', () => {
  assert.deepEqual(splitText('一二三四五', 20), ['一二三四五']);
  const parts = splitText('谢谢大家的支持，今天我们一起玩游戏吧，晚点还有抽奖哦', 12);
  assert.ok(parts.every(part => Array.from(part).length <= 12)); assert.equal(parts.join(''), '谢谢大家的支持，今天我们一起玩游戏吧，晚点还有抽奖哦');
  assert.equal(cleanReply('<think>想想</think>**你好**\n呀', 40), '你好 呀');
  assert.equal(cleanReply('一二三四五六', 3), '一二三');
  assert.throws(() => normalizeConfig({ max_length: 5 }), /单条弹幕字数/);
  assert.throws(() => normalizeConfig({ ai: { model: 'x y' } }), /模型名称/);
});

function fakeServices(overrides = {}) {
  const services = new EventEmitter();
  Object.assign(services, { platform: 'bilibili', selfUid: 1, state: { account: { loggedIn: true, name: '萝卜机器人' }, live: { status: 'connected' } }, gifts: [{ id: 10, name: '小花花', price: 100 }, { id: 11, name: '心动盲盒', price: 15000 }, { id: 12, name: '大鸡腿', price: 20000 }], sent: [], sendChat: async (text, options) => { services.sent.push({ text, ...options }); } }, overrides);
  return services;
}

test('机器人：欢迎合并、礼物连击合并、自己的弹幕不触发', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-10T12:00:00').getTime() });
  const dir = await tempDir('luobo-robot-');
  const services = fakeServices();
  const robot = await new LiveRobot(dir, { services }).init();
  try {
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, welcome: { merge_seconds: 2 }, gift: { merge_seconds: 2 } } });
    robot.receive({ type: 'member', user: '甲', uid: 2 });
    robot.receive({ type: 'member', user: '乙', uid: 3 });
    robot.receive({ type: 'member', user: '甲', uid: 2 });
    robot.receive({ type: 'gift', user: '丙', uid: 4, giftId: 10, giftName: '小花花', count: 1, transactionId: 'a' });
    robot.receive({ type: 'gift', user: '丙', uid: 4, giftId: 10, giftName: '小花花', count: 2, transactionId: 'b' });
    robot.receive({ type: 'gift', user: '丙', uid: 4, giftId: 10, giftName: '小花花', count: 2, transactionId: 'b' });
    robot.receive({ type: 'chat', user: '机器人自己', uid: 1, text: '@萝卜机器人 查询盲盒记录' });
    t.mock.timers.tick(2000); await flush();
    t.mock.timers.tick(1000); await flush();
    assert.deepEqual(services.sent.map(s => s.text), ['谢谢丙送的小花花×3', '欢迎甲、乙来到直播间~']);
    robot.receive({ type: 'member', user: '甲', uid: 2 });
    t.mock.timers.tick(5000); await flush();
    assert.equal(services.sent.length, 2, '同一观众 30 分钟内只欢迎一次');
    await robot.action({ action: 'toggle', enabled: false });
    robot.receive({ type: 'member', user: '丁', uid: 9 });
    t.mock.timers.tick(5000); await flush();
    assert.equal(services.sent.length, 2);
  } finally { await robot.close(); await remove(dir); }
});

test('机器人：盲盒记账，@机器人查询自己的记录并回复对方', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-10T12:00:00').getTime() });
  const dir = await tempDir('luobo-blind-');
  const services = fakeServices();
  const robot = await new LiveRobot(dir, { services }).init();
  try {
    robot.receive({ type: 'gift', user: '甲', uid: 2, giftId: 12, giftName: '大鸡腿', count: 1, blindGiftName: '心动盲盒', transactionId: 'x1' });
    robot.receive({ type: 'gift', user: '甲', uid: 2, giftId: 10, giftName: '小花花', count: 1, blindGiftName: '心动盲盒', blindGiftPrice: 15000, giftPrice: 100, transactionId: 'x2' });
    assert.equal(robot.snapshot().blindbox[0].count, 2, '机器人关闭时也记账');
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 100 } });
    robot.receive({ type: 'chat', user: '甲', uid: 2, text: '查询盲盒记录' });
    t.mock.timers.tick(2000); await flush();
    assert.equal(services.sent.length, 0, '默认需要 @ 机器人');
    robot.receive({ type: 'chat', user: '甲', uid: 2, text: '查询盲盒记录', mention: { name: '萝卜机器人', uid: 1 } });
    t.mock.timers.tick(2000); await flush();
    assert.equal(services.sent[0].replyMid, 2);
    assert.equal(services.sent[0].text, '甲今天开了2个盲盒，亏了9.9元；累计2个，投入30元，开出20.1元，亏了9.9元');
    robot.receive({ type: 'chat', user: '乙', uid: 3, text: '@萝卜机器人 查询盲盒记录' });
    t.mock.timers.tick(2000); await flush();
    assert.equal(services.sent[1].text, '乙还没有盲盒记录哦');
    await robot.close();
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'robot-blindbox.json'), 'utf8'));
    assert.equal(saved.platforms.bilibili['uid:2'].count, 2);
    const reloaded = await new LiveRobot(dir, { services }).init();
    assert.equal(reloaded.snapshot().blindbox[0].cost, 30000);
  } finally { await robot.close(); await remove(dir); }
});

test('机器人：@机器人走 DeepSeek，人设进 system，长回复分条，失败写入记录', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-10T12:00:00').getTime() });
  const dir = await tempDir('luobo-ai-');
  const services = fakeServices();
  let key = '', requests = [], status = 200;
  const fetchImpl = async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return { ok: status === 200, status, json: async () => status === 200 ? { choices: [{ message: { content: '今天吃萝卜炖排骨，香喷喷的，要不要一起来呀？' } }] } : { error: { message: 'bad' } } }; };
  const robot = await new LiveRobot(dir, { services, fetchImpl, keyStore: { get: () => key, set: async (provider, value) => { key = value; } } }).init();
  try {
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 20, ai: { enabled: true, persona: '你是一只猫娘', max_chars: 40 } } });
    robot.receive({ type: 'chat', user: '甲', uid: 2, text: '主播吃什么', mention: { name: '萝卜机器人', uid: 1 } });
    await flush(); await flush();
    assert.match(robot.snapshot().log[0].error, /API Key/);
    await robot.action({ action: 'set_key', key: 'sk-test1234' });
    assert.equal(robot.snapshot().keyHint, '••••1234'); assert.equal(JSON.stringify(robot.snapshot()).includes('sk-test1234'), false);
    t.mock.timers.tick(10000);
    robot.receive({ type: 'chat', user: '甲', uid: 2, text: '@萝卜机器人 主播吃什么' });
    await flush(); await flush(); await flush();
    assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer sk-test1234');
    assert.match(requests[0].body.messages[0].content, /你是一只猫娘/);
    assert.match(requests[0].body.messages.at(-1).content, /观众「甲」说：主播吃什么$/);
    for (let i = 0; i < 4; i++) { t.mock.timers.tick(1000); await flush(); }
    assert.equal(services.sent[0].replyMid, 2); assert.equal(services.sent[1].replyMid, 0);
    assert.equal(services.sent.map(s => s.text).join(''), '今天吃萝卜炖排骨，香喷喷的，要不要一起来呀？');
    const test = await robot.action({ action: 'test', text: '你好' });
    assert.equal(test.reply, '今天吃萝卜炖排骨，香喷喷的，要不要一起来呀？');
    status = 402;
    await assert.rejects(robot.action({ action: 'test', text: '你好' }), /余额不足/);
  } finally { await robot.close(); await remove(dir); }
});

test('机器人：抖音不发言只显示，拿不到 uid 时用文字 @', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-10T12:00:00').getTime() });
  const dir = await tempDir('luobo-dy-robot-');
  const services = fakeServices({ platform: 'douyin', selfUid: 0, sendChat: async () => { const error = new Error('抖音暂不支持机器人发言'); error.code = 'UNSUPPORTED'; throw error; } });
  const robot = await new LiveRobot(dir, { services }).init();
  try {
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, blindbox: { require_mention: false } } });
    robot.receive({ type: 'chat', user: '甲', uid: '', text: '查询盲盒记录' });
    t.mock.timers.tick(2000); await flush();
    const entry = robot.snapshot().log[0];
    assert.equal(entry.status, 'preview'); assert.equal(entry.text, '@甲 甲还没有盲盒记录哦');
  } finally { await robot.close(); await remove(dir); }
});

const { parseStreamItem, streamTime } = require('../lib/robot.cjs');

test('礼物流水：识别盲盒开出的礼物、只有盲盒本身、普通礼物', () => {
  const catalog = { boxNames: new Set(['心动盲盒']), boxIds: new Map([[11, '心动盲盒']]), priceByName: new Map([['心动盲盒', 15000], ['大鸡腿', 20000], ['小花花', 100]]) };
  assert.deepEqual(parseStreamItem({ gift_name: '大鸡腿', gift_num: 2, blind_gift: { original_gift_name: '心动盲盒' } }, catalog), { box: '心动盲盒', gift: '大鸡腿', count: 2 });
  assert.deepEqual(parseStreamItem({ gift_name: '大鸡腿', gift_num: 1, extra: '{"original_gift_id":11}' }, catalog), { box: '心动盲盒', gift: '大鸡腿', count: 1 });
  assert.deepEqual(parseStreamItem({ gift_name: '心动盲盒', gift_num: 1, result_gift_name: '小花花' }, catalog), { box: '心动盲盒', gift: '小花花', count: 1 });
  assert.deepEqual(parseStreamItem({ gift_name: '心动盲盒', gift_num: 1 }, catalog), { boxOnly: true });
  assert.equal(parseStreamItem({ gift_name: '小花花', gift_num: 1, uname: '心动盲盒' }, catalog), null);
  assert.equal(streamTime('2026-11-10 20:00:00'), Date.UTC(2026, 10, 10, 12));
  assert.equal(streamTime(1762776000), 1762776000000);
  assert.ok(Number.isNaN(streamTime('')));
});

test('B站礼物流水请求：按天和 last_id 翻页，需要登录', async () => {
  const dir = await tempDir('luobo-stream-');
  const urls = [];
  const services = await new ConsoleServices({ dataDir: dir, seedDir: dir, requestImpl: async url => { urls.push(new URL(url)); return { body: Buffer.from(JSON.stringify({ code: 0, data: { list: [{ id: 5 }], has_more: true } })), headers: {} }; } }).init();
  try {
    await assert.rejects(services.giftStream('2026-11-10'), /登录/);
    services.secretData.cookie = 'SESSDATA=a; bili_jct=b';
    assert.deepEqual(await services.giftStream('2026-11-10', 9), { list: [{ id: 5 }], hasMore: true });
    const url = urls.at(-1);
    assert.equal(url.pathname, '/xlive/revenue/v1/giftStream/getReceivedGiftStreamNextList');
    assert.equal(url.searchParams.get('begin_time'), '2026-11-10'); assert.equal(url.searchParams.get('last_id'), '9');
    await assert.rejects(services.giftStream('11/10'), /日期/);
  } finally { services.close(); await remove(dir); }
});

test('补录历史盲盒：翻页去重、只补实时记账之前的、与实时记录合并、重复补录不重复计数', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T12:00:00+08:00').getTime() });
  const dir = await tempDir('luobo-import-');
  const calls = [];
  const pages = {
    '2026-11-10': [[{ id: 3, uid: 2, uname: '甲', gift_name: '大鸡腿', gift_num: 1, time: '2026-11-10 11:59:00', blind_gift: { original_gift_name: '心动盲盒' } }, { id: 4, uid: 2, uname: '甲', gift_name: '小花花', gift_num: 1, time: '2026-11-10 13:00:00', blind_gift: { original_gift_name: '心动盲盒' } }]],
    '2026-11-09': [[{ id: 1, uid: 2, uname: '甲', gift_name: '小花花', gift_num: 2, time: '2026-11-09 20:00:00', blind_gift: { original_gift_name: '心动盲盒' } }, { id: 2, uid: 3, uname: '乙', gift_name: '小花花', gift_num: 1, time: '2026-11-09 20:01:00' }], [{ id: 1, uid: 2, uname: '甲', gift_name: '小花花', gift_num: 2, time: '2026-11-09 20:00:00', blind_gift: { original_gift_name: '心动盲盒' } }, { id: 6, uid: 4, uname: '丙', gift_name: '心动盲盒', gift_num: 1, time: '2026-11-09 21:00:00' }]]
  };
  const services = fakeServices({ giftStream: async (date, lastId) => { calls.push([date, lastId]); const list = pages[date] || [[]]; const index = lastId ? 1 : 0; return { list: list[index] || [], hasMore: index < list.length - 1 }; } });
  services.gifts = [...services.gifts, { id: 13, name: '幸运盲盒', price: 5000 }];
  const robot = await new LiveRobot(dir, { services, sleep: async () => {} }).init();
  try {
    // 实时记账从 12:00 开始：已经记了一个盲盒。
    robot.receive({ type: 'gift', user: '甲', uid: 2, giftId: 12, giftName: '大鸡腿', count: 1, blindGiftName: '心动盲盒', transactionId: 'live' });
    await robot.action({ action: 'import_history', days: 3 });
    await assert.rejects(robot.action({ action: 'import_history', days: 3 }), /正在补录/);
    await robot.importJob;
    const snapshot = robot.snapshot();
    assert.equal(snapshot.import.status, 'done'); assert.equal(snapshot.import.found, 3); assert.equal(snapshot.import.box_only, 1);
    assert.deepEqual(calls.slice(0, 3), [['2026-11-10', ''], ['2026-11-09', ''], ['2026-11-09', 2]]);
    const jia = snapshot.blindbox.find(r => r.id === 'uid:2');
    assert.equal(jia.count, 4, '实时 1 个 + 补录 3 个（13:00 那条在实时记账之后，不补）');
    assert.equal(jia.cost, 60000); assert.equal(jia.value, 20000 + 20000 + 200);
    assert.equal(jia.today.count, 2);
    assert.equal(snapshot.imported.users, 1);
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 100, blindbox: { require_mention: false } } });
    assert.match((await robot.action({ action: 'test_blindbox', user: '甲' })).reply, /累计4个，投入60元，开出40\.2元，亏了19\.8元/);
    await robot.action({ action: 'import_history', days: 3 }); await robot.importJob;
    assert.equal(robot.snapshot().blindbox.find(r => r.id === 'uid:2').count, 4, '重复补录替换上一次结果');
    await robot.close();
    const reloaded = await new LiveRobot(dir, { services }).init();
    assert.equal(reloaded.snapshot().blindbox.find(r => r.id === 'uid:2').count, 4);
    await robot.action({ action: 'clear_blindbox' });
    assert.equal(robot.snapshot().blindbox.length, 0); assert.equal(robot.snapshot().imported, null);
  } finally { await robot.close(); await remove(dir); }
});

test('补录失败或停止时保留原有记录', async () => {
  const dir = await tempDir('luobo-import-fail-');
  let fail = true;
  const services = fakeServices({ giftStream: async () => { if (fail) throw new Error('B站：请先登录'); return { list: [], hasMore: false }; } });
  const robot = await new LiveRobot(dir, { services, sleep: async () => {} }).init();
  try {
    await robot.action({ action: 'import_history', days: 2 }); await robot.importJob;
    assert.equal(robot.snapshot().import.status, 'failed'); assert.match(robot.snapshot().import.error, /登录/); assert.equal(robot.snapshot().imported, null);
    fail = false;
    let release;
    services.giftStream = () => new Promise(resolve => { release = () => resolve({ list: [], hasMore: false }); });
    await robot.action({ action: 'import_history', days: 5 });
    await robot.action({ action: 'cancel_import' }); release(); await robot.importJob;
    assert.equal(robot.snapshot().import.status, 'cancelled'); assert.equal(robot.snapshot().imported, null);
    await assert.rejects(robot.action({ action: 'import_history', days: 181 }), /1～180/);
    services.platform = 'douyin';
    await assert.rejects(robot.action({ action: 'import_history', days: 1 }), /只支持B站/);
  } finally { await robot.close(); await remove(dir); }
});

test('B站表情：读取直播间表情，表情弹幕用 dm_type=1，带 WBI 签名', async () => {
  const dir = await tempDir('luobo-emo-');
  const posts = [];
  const emoticonData = { code: 0, data: { data: [{ pkg_name: '房间专属表情', emoticons: [{ emoticon_unique: 'room_1889484822_125522', emoji: '打call', url: 'http://i0.hdslb.com/bfs/live/a.png', perm: 1 }, { emoticon_unique: 'room_1889484822_9', emoji: '锁住', url: 'https://i0.hdslb.com/bfs/live/b.png', perm: 0, unlock_show_text: '粉丝团' }, { emoticon_unique: 'bad id!', emoji: 'x', url: 'https://i0.hdslb.com/c.png' }, { emoticon_unique: 'official_1', emoji: 'evil', url: 'https://evil.example/a.png' }] }] } };
  const services = await new ConsoleServices({ dataDir: dir, seedDir: dir, requestImpl: async () => ({ body: Buffer.from(JSON.stringify(emoticonData)), headers: {} }), postImpl: async (url, body) => { posts.push({ url: new URL(url), body: new URLSearchParams(body) }); return { body: Buffer.from('{"code":0,"msg":""}'), headers: {} }; } }).init();
  try {
    await assert.rejects(services.emoticons(), /连接直播间/);
    services.state.live = { status: 'connected', roomId: 1889484822 };
    services.secretData.cookie = 'SESSDATA=a; bili_jct=t; DedeUserID=9';
    const [pkg] = await services.emoticons();
    assert.equal(pkg.name, '房间专属表情');
    assert.deepEqual(pkg.items.map(e => [e.unique, e.usable]), [['room_1889484822_125522', true], ['room_1889484822_9', false]]);
    assert.equal(pkg.items[0].url, 'https://i0.hdslb.com/bfs/live/a.png');
    services.wbi = { key: '0'.repeat(32), time: Date.now() };
    await services.sendChat('room_1889484822_125522', { emoticon: true });
    assert.equal(posts[0].body.get('msg'), 'room_1889484822_125522'); assert.equal(posts[0].body.get('dm_type'), '1');
    assert.equal(posts[0].url.searchParams.get('web_location'), '444.8'); assert.match(posts[0].url.searchParams.get('w_rid'), /^[a-f0-9]{32}$/);
    await services.sendChat('普通弹幕');
    assert.equal(posts[1].body.get('dm_type'), null);
    await assert.rejects(services.sendChat('不是编号', { emoticon: true }), /表情编号/);
  } finally { services.close(); await remove(dir); }
});

test('机器人表情：情景表情组跟在文字后面单独发，手动发表情，表情失败不影响文字', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-10T12:00:00').getTime() });
  const dir = await tempDir('luobo-robot-emo-');
  const services = fakeServices();
  const robot = await new LiveRobot(dir, { services }).init();
  const call = { unique: 'room_1_2', name: '打call', url: 'https://i0.hdslb.com/bfs/live/a.png' };
  try {
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, welcome: { merge_seconds: 0 } } });
    await assert.rejects(robot.action({ action: 'toggle_emoticon', slot: 'nope', emoticon: call }), /场景/);
    await assert.rejects(robot.action({ action: 'toggle_emoticon', slot: 'welcome', emoticon: { unique: 'a b' } }), /表情无效/);
    await robot.action({ action: 'toggle_emoticon', slot: 'welcome', emoticon: { ...call, url: 'https://evil.example/x.png' } });
    assert.equal(robot.snapshot().config.emoticons.welcome[0].url, '', '非B站图片地址不保存');
    await robot.action({ action: 'toggle_emoticon', slot: 'welcome', emoticon: call });
    assert.equal(robot.snapshot().config.emoticons.welcome.length, 0, '再点一次移出');
    await robot.action({ action: 'toggle_emoticon', slot: 'welcome', emoticon: call });
    await robot.action({ action: 'configure', config: { names: '小助手' } });
    assert.equal(robot.snapshot().config.emoticons.welcome[0].unique, 'room_1_2', '保存其他设置不会清掉表情');
    robot.receive({ type: 'member', user: '甲', uid: 2 });
    for (let i = 0; i < 3; i++) { t.mock.timers.tick(1000); await flush(); }
    assert.deepEqual(services.sent.map(s => [s.text, !!s.emoticon]), [['欢迎甲来到直播间~', false], ['room_1_2', true]]);
    assert.equal(robot.snapshot().log[0].status, 'sent'); assert.equal(robot.snapshot().log[0].emoticon.name, '打call');
    await robot.action({ action: 'say', emoticon: call });
    for (let i = 0; i < 2; i++) { t.mock.timers.tick(1000); await flush(); }
    assert.deepEqual(services.sent.at(-1), { text: 'room_1_2', emoticon: true });
    services.sendChat = async (text, options) => { if (options.emoticon) throw new Error('B站：表情不可用'); services.sent.push({ text }); };
    robot.receive({ type: 'member', user: '乙', uid: 3 });
    for (let i = 0; i < 3; i++) { t.mock.timers.tick(1000); await flush(); }
    const entry = robot.snapshot().log[0];
    assert.equal(entry.status, 'sent'); assert.match(entry.error, /表情没发出去/);
    await robot.action({ action: 'clear_emoticons', slot: 'welcome' });
    assert.deepEqual(robot.snapshot().config.emoticons.welcome, []);
    services.platform = 'douyin';
    await assert.rejects(robot.action({ action: 'say', emoticon: call }), /抖音/);
  } finally { await robot.close(); await remove(dir); }
});

test('按情景挑表情：大礼物、大航海后备、盲盒赚亏、通用兜底、旧配置迁移、不连着重复', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-10T12:00:00').getTime() });
  const dir = await tempDir('luobo-scene-');
  const services = fakeServices();
  const emo = (unique, name) => ({ unique, name, url: 'https://i0.hdslb.com/bfs/live/' + unique + '.png' });
  const robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
  try {
    const legacy = normalizeConfig({ emoticons: { query: emo('old', '旧') } });
    assert.deepEqual([legacy.emoticons.query_profit[0].unique, legacy.emoticons.query_loss[0].unique, legacy.emoticons.query_empty[0].unique], ['old', 'old', 'old']);
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 100, gift: { merge_seconds: 0, big_value: 100 }, blindbox: { require_mention: false }, emoticons: { default: [emo('d', '通用')], gift: [emo('g1', '谢谢'), emo('g2', '比心')], gift_big: [emo('big', '大佬')], query_loss: [emo('cry', '哭哭')] } } });
    const run = async () => { for (let i = 0; i < 4; i++) { t.mock.timers.tick(1000); await flush(); } };
    robot.receive({ type: 'gift', user: '甲', uid: 2, giftId: 10, giftName: '小花花', count: 1, transactionId: 'a' }); await run();
    robot.receive({ type: 'gift', user: '甲', uid: 2, giftId: 10, giftName: '小花花', count: 1, transactionId: 'b' }); await run();
    robot.receive({ type: 'gift', user: '乙', uid: 3, giftId: 12, giftName: '大鸡腿', count: 5, transactionId: 'c' }); await run();
    robot.receive({ type: 'gift', user: '丙', uid: 4, count: 1, guardName: '舰长', transactionId: 'd' }); await run();
    robot.receive({ type: 'social', user: '丁', uid: 5, follow: true }); await run();
    robot.receive({ type: 'gift', user: '戊', uid: 6, giftId: 10, giftName: '小花花', count: 1, blindGiftName: '心动盲盒', transactionId: 'e' }); await run();
    robot.receive({ type: 'chat', user: '戊', uid: 6, text: '查询盲盒记录' }); await run();
    robot.receive({ type: 'chat', user: '己', uid: 7, text: '查询盲盒记录' }); await run();
    const scenes = services.sent.filter(s => s.emoticon).map(s => s.text);
    assert.deepEqual(scenes, ['g1', 'g2', 'big', 'big', 'd', 'g1', 'cry', 'd'], '小礼物轮换不重复、大礼物、大航海用大礼物、关注用通用、盲盒感谢、亏了、无记录用通用');
  } finally { await robot.close(); await remove(dir); }
});

test('AI 回复的表情：模型按语气在表情组里挑，标记不会发出去；没挑就随机', async () => {
  const dir = await tempDir('luobo-ai-emo-');
  let content = '好开心呀今天【表情:打call】', body;
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }; };
  const emo = (unique, name) => ({ unique, name, url: 'https://i0.hdslb.com/bfs/live/' + unique + '.png' });
  const robot = await new LiveRobot(dir, { services: fakeServices(), fetchImpl, random: () => 0, keyStore: { get: () => 'sk-x', set: async () => {} } }).init();
  try {
    await robot.action({ action: 'configure', config: { emoticons: { ai: [emo('cry', '[哭哭]'), emo('call', '[打call]')] } } });
    let result = await robot.action({ action: 'test', text: '你好' });
    assert.match(body.messages[0].content, /【表情:名字】.*哭哭、打call/);
    assert.equal(result.reply, '好开心呀今天  [表情：[打call]]');
    content = '呜呜好难过'; result = await robot.action({ action: 'test', text: '你好' });
    assert.match(result.reply, /^呜呜好难过  \[表情：/);
    await robot.action({ action: 'clear_emoticons', slot: 'ai' });
    content = '没有表情'; result = await robot.action({ action: 'test', text: '你好' });
    assert.equal(result.reply, '没有表情'); assert.doesNotMatch(body.messages[0].content, /表情标记/);
  } finally { await robot.close(); await remove(dir); }
});

test('DeepSeek 模型列表：用 Key 读取 /models，去重排序，过滤异常名字', async () => {
  const dir = await tempDir('luobo-models-');
  let key = '', status = 200, request;
  const fetchImpl = async (url, init) => { request = { url, init }; return { ok: status === 200, status, json: async () => ({ object: 'list', data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }, { id: 'deepseek-chat' }, { id: 'bad id' }, {}] }) }; };
  const robot = await new LiveRobot(dir, { services: fakeServices(), fetchImpl, keyStore: { get: () => key, set: async (provider, value) => { key = value; } } }).init();
  try {
    await assert.rejects(robot.action({ action: 'models' }), /API Key/);
    key = 'sk-test';
    assert.deepEqual((await robot.action({ action: 'models' })).models, ['deepseek-chat', 'deepseek-reasoner']);
    assert.equal(request.url, 'https://api.deepseek.com/models'); assert.equal(request.init.headers.Authorization, 'Bearer sk-test');
    status = 401; await assert.rejects(robot.action({ action: 'models' }), /API Key 无效/);
  } finally { await robot.close(); await remove(dir); }
});


test('点名冒泡：找出进场后一直没说话的人，隔一段时间 @ 一位，说过话、送过礼、冷却中、太久以前进来的不点', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-10T12:00:00').getTime() });
  const dir = await tempDir('luobo-cue-');
  const services = fakeServices();
  const robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
  const minutes = n => t.mock.timers.tick(n * 60000);
  const run = async () => { for (let i = 0; i < 3; i++) { t.mock.timers.tick(1000); await flush(); } };
  try {
    assert.throws(() => normalizeConfig({ cue: { silent_minutes: 30, active_minutes: 20 } }), /进场多久内/);
    assert.throws(() => normalizeConfig({ cue: { templates: '  \n ' } }), /点名话术/);
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 100, welcome: { enabled: false }, cue: { enabled: true, interval_minutes: 3, silent_minutes: 5, active_minutes: 30, user_cooldown_minutes: 60, templates: '来聊聊天呀\n冒个泡嘛' } } });
    robot.receive({ type: 'member', user: '早来的', uid: 10 });
    minutes(40);
    robot.receive({ type: 'member', user: '甲', uid: 2 });
    robot.receive({ type: 'member', user: '乙', uid: 3 });
    robot.receive({ type: 'member', user: '丙', uid: 4 });
    robot.receive({ type: 'member', user: '丁', uid: 5 });
    robot.receive({ type: 'member', user: '机器人', uid: 1 });
    robot.receive({ type: 'chat', user: '乙', uid: 3, text: '你好' });
    robot.receive({ type: 'gift', user: '丙', uid: 4, giftId: 10, giftName: '小花花', count: 1, transactionId: 'x' });
    assert.equal(await robot.cueTick(), null, '没说话还不满 5 分钟');
    minutes(1); robot.receive({ type: 'member', user: '丁', uid: 5 });
    minutes(5);
    assert.deepEqual(robot.snapshot().cue.waiting.map(v => v.name), ['丁', '甲'], '早来的已超出 30 分钟，乙说过话，丙送过礼，机器人自己不算；最近进来的排前面');
    assert.equal(await robot.cueTick(), '丁'); await run();
    assert.deepEqual(services.sent.at(-1), { text: '来聊聊天呀', replyMid: 5 });
    assert.equal(robot.snapshot().log[0].kind, 'cue');
    minutes(1); assert.equal(await robot.cueTick(), null, '没到点名间隔');
    minutes(2); assert.equal(await robot.cueTick(), '甲', '丁在冷却中，轮到甲'); await run();
    minutes(3); assert.equal(await robot.cueTick(), null, '都点过了');
    robot.receive({ type: 'chat', user: '甲', uid: 2, text: '来啦' });
    assert.equal(robot.snapshot().cue.waiting_count, 0);
    services.state.live.status = 'disconnected';
    robot.receive({ type: 'member', user: '戊', uid: 6 }); minutes(10);
    assert.equal(await robot.cueTick(), null, '直播间没连上不点名');
    await assert.rejects(robot.action({ action: 'cue_now' }), /未连接/);
    services.state.live.status = 'connected';
    await robot.action({ action: 'cue_now' }); await run();
    assert.equal(robot.snapshot().log[0].to, '戊');
    robot.reset();
    assert.equal(robot.snapshot().cue.tracked, 0, '切换平台清空名单');
  } finally { await robot.close(); await remove(dir); }
});

test('点名冒泡：开了 AI 时由 AI 按人设搭话，AI 失败就用话术', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-10T12:00:00').getTime() });
  const dir = await tempDir('luobo-cue-ai-');
  const services = fakeServices();
  let fail = false, body;
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); if (fail) throw new Error('offline'); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '嗨，今晚想听什么歌呀？' } }] }) }; };
  const robot = await new LiveRobot(dir, { services, fetchImpl, random: () => 0, keyStore: { get: () => 'sk-x', set: async () => {} } }).init();
  try {
    await robot.action({ action: 'configure', config: { enabled: true, max_length: 100, interval_seconds: 1, welcome: { enabled: false }, ai: { enabled: true }, cue: { enabled: true, use_ai: true, interval_minutes: 1, templates: '冒个泡嘛' } } });
    robot.receive({ type: 'member', user: '甲', uid: 2 });
    t.mock.timers.tick(1000);
    robot.receive({ type: 'member', user: '乙', uid: 3 });
    t.mock.timers.tick(6 * 60000);
    assert.equal(await robot.cueTick(), '乙');
    assert.match(body.messages.at(-1).content, /观众「乙」进直播间好一会儿了/);
    assert.equal(robot.snapshot().log[0].text, '嗨，今晚想听什么歌呀？');
    fail = true; t.mock.timers.tick(60000);
    assert.equal(await robot.cueTick(), '甲');
    assert.equal(robot.snapshot().log[0].text, '冒个泡嘛');
  } finally { await robot.close(); await remove(dir); }
});


test('随机点名：房间里任意一位（说过话的也算），不连着点同一个人，太久没出现的不点，不需要开定时点名', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-10T12:00:00').getTime() });
  const dir = await tempDir('luobo-cue-random-');
  const services = fakeServices();
  let roll = 0;
  const robot = await new LiveRobot(dir, { services, random: () => roll }).init();
  const run = async () => { for (let i = 0; i < 3; i++) { t.mock.timers.tick(1000); await flush(); } };
  try {
    assert.throws(() => normalizeConfig({ cue: { random_templates: '\n' } }), /随机点名话术/);
    await robot.action({ action: 'configure', config: { max_length: 100, interval_seconds: 1, welcome: { enabled: false }, cue: { random_templates: '点到你啦' } } });
    await assert.rejects(robot.action({ action: 'cue_random' }), /还没有观众/);
    robot.receive({ type: 'member', user: '走了的', uid: 9 });
    t.mock.timers.tick(31 * 60000);
    robot.receive({ type: 'chat', user: '甲', uid: 2, text: '哈哈' });
    robot.receive({ type: 'like', user: '乙', uid: 3, count: 1 });
    robot.receive({ type: 'member', user: '机器人', uid: 1 });
    assert.equal(robot.snapshot().cue.present_count, 2, '走了的超出 30 分钟，机器人自己不算');
    assert.equal(robot.snapshot().cue.waiting_count, 0, '点赞不算进场后没说话的候选');
    services.state.live.status = 'disconnected';
    await assert.rejects(robot.action({ action: 'cue_random' }), /未连接/);
    services.state.live.status = 'connected';
    assert.equal((await robot.action({ action: 'cue_random' })).picked, '甲', '说过话的人也能被随机点到');
    await run();
    assert.deepEqual(services.sent.at(-1), { text: '点到你啦', replyMid: 2 });
    assert.equal(robot.snapshot().log[0].kind, 'cue');
    assert.equal((await robot.action({ action: 'cue_random' })).picked, '乙', '不连着点同一个人');
    roll = 0.99;
    assert.equal((await robot.action({ action: 'cue_random' })).picked, '甲');
  } finally { await robot.close(); await remove(dir); }
});


test('AI 服务商：各家地址和 Key 分开，本机 Ollama 不需要 Key，免费模型排前面，/models 不支持时用推荐', async () => {
  const dir = await tempDir('luobo-providers-');
  const keys = { zhipu: 'zk-key-1111', openrouter: 'or-key-2222' }, requests = [];
  let modelsStatus = 200, modelsData = { data: [] };
  const fetchImpl = async (url, init) => {
    requests.push({ url, auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith('/models')) return { ok: modelsStatus === 200, status: modelsStatus, json: async () => modelsData };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '你好呀' } }] }) };
  };
  const robot = await new LiveRobot(dir, { services: fakeServices(), fetchImpl, keyStore: { get: id => keys[id] || '', set: async (id, value) => { keys[id] = value; } } }).init();
  try {
    assert.equal(robot.snapshot().config.ai.provider, 'deepseek', '旧配置默认还是 DeepSeek 官方');
    await assert.rejects(robot.action({ action: 'configure', config: { ai: { provider: 'nope' } } }), /服务商无效/);
    await assert.rejects(robot.action({ action: 'configure', config: { ai: { provider: 'custom' } } }), /服务地址/);
    await assert.rejects(robot.action({ action: 'configure', config: { ai: { provider: 'custom', base_url: 'ftp://x' } } }), /服务地址无效/);

    await robot.action({ action: 'configure', config: { ai: { provider: 'zhipu', model: 'glm-4.7-flash' } } });
    assert.equal((await robot.action({ action: 'test', text: '在吗' })).reply, '你好呀');
    assert.equal(requests.at(-1).url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    assert.equal(requests.at(-1).auth, 'Bearer zk-key-1111'); assert.equal(requests.at(-1).body.model, 'glm-4.7-flash');
    modelsStatus = 404;
    assert.deepEqual(await robot.action({ action: 'models' }), { models: ['glm-4-flash-250414', 'glm-4.5-flash', 'glm-4.7-flash'], free: ['glm-4-flash-250414', 'glm-4.5-flash', 'glm-4.7-flash'] }, '/models 不支持时用推荐，Flash 标为免费');

    modelsStatus = 200;
    modelsData = { data: [{ id: 'openai/gpt-x', pricing: { prompt: '0.001', completion: '0.002' } }, { id: 'deepseek/deepseek-chat:free' }, { id: 'google/gemma:free', pricing: { prompt: '0', completion: '0' } }, { id: 'bad id' }] };
    await robot.action({ action: 'configure', config: { ai: { provider: 'openrouter', model: 'google/gemma:free' } } });
    const listed = await robot.action({ action: 'models' });
    assert.deepEqual(listed.models, ['deepseek/deepseek-chat:free', 'google/gemma:free', 'openai/gpt-x']);
    assert.deepEqual(listed.free, ['deepseek/deepseek-chat:free', 'google/gemma:free']);
    assert.equal(requests.at(-1).url, 'https://openrouter.ai/api/v1/models'); assert.equal(requests.at(-1).auth, 'Bearer or-key-2222');

    await robot.action({ action: 'configure', config: { ai: { provider: 'siliconflow', model: 'THUDM/GLM-4-9B-0414' } } });
    assert.equal(robot.snapshot().aiReady, false);
    await assert.rejects(robot.action({ action: 'test', text: '在吗' }), /硅基流动 SiliconFlow 的 API Key/);
    await robot.action({ action: 'set_key', key: 'sf-3' });
    assert.equal(keys.siliconflow, 'sf-3'); assert.equal(robot.snapshot().aiReady, true);
    assert.equal(robot.snapshot().providers.find(p => p.id === 'zhipu').keyHint, '••••1111');
    assert.equal(JSON.stringify(robot.snapshot()).includes('or-key-2222'), false, 'Key 本身不回传');

    await robot.action({ action: 'configure', config: { ai: { provider: 'ollama', model: 'qwen2.5:7b' } } });
    assert.equal(robot.snapshot().aiReady, true, 'Ollama 不需要 Key');
    await assert.rejects(robot.action({ action: 'set_key', key: 'x' }), /不需要/);
    await robot.action({ action: 'test', text: '在吗' });
    assert.equal(requests.at(-1).url, 'http://127.0.0.1:11434/v1/chat/completions'); assert.equal(requests.at(-1).auth, undefined);
    await robot.action({ action: 'configure', config: { ai: { base_url: 'http://192.168.1.5:11434/v1/' } } });
    await robot.action({ action: 'test', text: '在吗' });
    assert.equal(requests.at(-1).url, 'http://192.168.1.5:11434/v1/chat/completions', '本机 Ollama 地址可以改');

    await robot.action({ action: 'configure', config: { ai: { provider: 'custom', base_url: 'https://llm.example.com/v1', model: 'my-model' } } });
    assert.equal(robot.snapshot().aiReady, true, '自定义服务商可以不填 Key');
    await robot.action({ action: 'test', text: '在吗' });
    assert.equal(requests.at(-1).url, 'https://llm.example.com/v1/chat/completions');
  } finally { await robot.close(); await remove(dir); }
});


test('直播场景：唱歌时按间隔发应援话术 + 场景表情，不连着重复，停止或关机器人就停', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-10T12:00:00').getTime() });
  const dir = await tempDir('luobo-scenes-');
  const services = fakeServices();
  const robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
  const call = { unique: 'room_1_call', name: '打call', url: 'https://i0.hdslb.com/bfs/live/call.png' };
  const clap = { unique: 'room_1_clap', name: '鼓掌', url: 'https://i0.hdslb.com/bfs/live/clap.png' };
  const flush3 = async () => { for (let i = 0; i < 3; i++) { t.mock.timers.tick(1000); await flush(); } };
  try {
    assert.deepEqual(robot.snapshot().config.live_scenes.map(s => s.name), ['唱歌', '跳舞', '打游戏'], '自带三个场景');
    await assert.rejects(robot.action({ action: 'save_scenes', scenes: [{ id: 'Bad Id', name: 'x' }] }), /编号无效/);
    await assert.rejects(robot.action({ action: 'save_scenes', scenes: [{ id: 'a', name: '' }] }), /名字/);
    await assert.rejects(robot.action({ action: 'save_scenes', scenes: [{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }] }), /重复/);
    await robot.action({ action: 'configure', config: { max_length: 100, interval_seconds: 1 } });
    await robot.action({ action: 'save_scenes', scenes: [{ id: 'sing', name: '唱歌', lines: '好听！\n打call！', interval_seconds: 30 }, { id: 'empty', name: '空场景', lines: '', interval_seconds: 30 }] });
    await robot.action({ action: 'toggle_emoticon', slot: 'live:sing', emoticon: call });
    await robot.action({ action: 'toggle_emoticon', slot: 'live:sing', emoticon: clap });
    await assert.rejects(robot.action({ action: 'toggle_emoticon', slot: 'live:nope', emoticon: call }), /找不到/);
    await assert.rejects(robot.action({ action: 'scene_start', id: 'empty' }), /还没有应援话术/);
    services.state.live.status = 'disconnected';
    await assert.rejects(robot.action({ action: 'scene_start', id: 'sing' }), /未连接/);
    services.state.live.status = 'connected';
    await robot.action({ action: 'scene_start', id: 'sing' });
    assert.equal(robot.snapshot().active_scene.id, 'sing');
    await flush3();
    assert.deepEqual(services.sent.map(s => s.text), ['好听！', 'room_1_call']);
    t.mock.timers.tick(30000); await flush3();
    assert.deepEqual(services.sent.slice(2).map(s => s.text), ['打call！', 'room_1_clap'], '话术和表情都不连着重复');
    assert.equal(robot.snapshot().active_scene.sent, 2);
    assert.equal(robot.snapshot().log[0].kind, 'scene');
    await robot.action({ action: 'scene_stop' });
    assert.equal(robot.snapshot().active_scene, null);
    t.mock.timers.tick(60000); await flush3();
    assert.equal(services.sent.length, 4, '停止后不再发');
    await robot.action({ action: 'scene_start', id: 'sing' }); await flush3();
    await robot.action({ action: 'toggle', enabled: false });
    assert.equal(robot.snapshot().active_scene, null, '停止机器人时场景也停');
    await robot.action({ action: 'scene_start', id: 'sing' });
    await robot.action({ action: 'save_scenes', scenes: [{ id: 'dance', name: '跳舞', lines: '好看', interval_seconds: 30 }] });
    assert.equal(robot.snapshot().active_scene, null, '删掉正在进行的场景就停');
    const reloaded = await new LiveRobot(dir, { services }).init();
    assert.deepEqual(reloaded.snapshot().config.live_scenes.map(s => s.id), ['dance']);
    await reloaded.close();
  } finally { await robot.close(); await remove(dir); }
});
