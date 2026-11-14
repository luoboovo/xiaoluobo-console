const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { danmuReply, mentionOf } = require('../lib/protocol.cjs');
const { ConsoleServices } = require('../lib/services.cjs');
const { decodeFrame, field, varint } = require('../lib/douyin.cjs');
const { LiveRobot, splitText, cleanReply, normalizeConfig, DEFAULTS } = require('../lib/robot.cjs');

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
  assert.equal(cleanReply('好呀，今天一起吃萝卜吧', 8), '好呀，今天一起吃', '前一半没有标点就硬切');
  assert.equal(cleanReply('今天天气真好，一起出去玩吧！', 10), '今天天气真好', '在标点处截断，去掉句末逗号');
  assert.equal(cleanReply('太好听了！再来一首好不好呀', 9), '太好听了！', '保留感叹号');
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

test('机器人：@机器人走 DeepSeek，人设进 system，回复不超过一条弹幕的字数（在标点处截断），失败写入记录', async t => {
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
    assert.match(requests[0].body.messages[0].content, /不超过20个字/, 'AI 最多字数 40 比单条弹幕字数 20 大时按 20');
    assert.match(requests[0].body.messages.at(-1).content, /观众「甲」说：主播吃什么$/);
    for (let i = 0; i < 4; i++) { t.mock.timers.tick(1000); await flush(); }
    assert.deepEqual(services.sent.map(s => [s.text, s.replyMid]), [['今天吃萝卜炖排骨，香喷喷的', 2]], '一条发完，不拆');
    await robot.action({ action: 'configure', config: { max_length: 40 } });
    const test = await robot.action({ action: 'test', text: '你好' });
    assert.equal(test.reply, '今天吃萝卜炖排骨，香喷喷的，要不要一起来呀？', '账号能发更长时整句保留');
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


test('直播场景 AI 现编：模型现写应援并按语气挑场景表情，出错回落到写好的话术，停掉后不再发；AI 写几句', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-12T12:00:00').getTime() });
  const dir = await tempDir('luobo-scene-ai-');
  const services = fakeServices();
  const bodies = [], replies = [];
  let key = '';
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    const next = replies.shift();
    if (next instanceof Promise) return next;
    if (next === 'fail') return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: next } }] }) };
  };
  const robot = await new LiveRobot(dir, { services, fetchImpl, random: () => 0, keyStore: { get: () => key, set: async () => {} } }).init();
  const call = { unique: 'room_1_call', name: '[打call]', url: 'https://i0.hdslb.com/bfs/live/call.png' };
  const clap = { unique: 'room_1_clap', name: '[鼓掌]', url: 'https://i0.hdslb.com/bfs/live/clap.png' };
  const flush3 = async () => { for (let i = 0; i < 3; i++) { t.mock.timers.tick(1000); await flush(); } };
  try {
    assert.equal(robot.snapshot().config.live_scenes[0].use_ai, false, '默认不开 AI 现编');
    await robot.action({ action: 'configure', config: { max_length: 100, interval_seconds: 1 } });
    await robot.action({ action: 'save_scenes', scenes: [{ id: 'sing', name: '唱歌', lines: '好听！', use_ai: true, interval_seconds: 30 }] });
    await robot.action({ action: 'toggle_emoticon', slot: 'live:sing', emoticon: call });
    await robot.action({ action: 'toggle_emoticon', slot: 'live:sing', emoticon: clap });
    await assert.rejects(robot.action({ action: 'scene_start', id: 'sing' }), /AI 现编/, '没填 Key 不能开');
    key = 'sk-test';
    replies.push('主播唱得太好听啦！【表情:鼓掌】');
    await robot.action({ action: 'scene_start', id: 'sing' });
    await flush3();
    assert.deepEqual(services.sent.map(s => s.text), ['主播唱得太好听啦！', 'room_1_clap'], 'AI 写的话术 + 它挑的场景表情');
    const prompt = bodies[0].messages.at(-1).content, system = bodies[0].messages[0].content;
    assert.match(prompt, /唱歌/); assert.match(prompt, /好听！/, '写好的话术当风格参考');
    assert.match(system, /打call、鼓掌/, '只让它从场景表情里挑'); assert.match(system, /不超过30个字/);
    replies.push('fail');
    t.mock.timers.tick(30000); await flush3();
    assert.deepEqual(services.sent.slice(2).map(s => s.text), ['好听！', 'room_1_call'], 'AI 出错用写好的话术');
    replies.push('打call打call~【表情:不存在】');
    t.mock.timers.tick(30000); await flush3();
    assert.equal(services.sent[4].text, '打call打call');
    assert.ok(['room_1_call', 'room_1_clap'].includes(services.sent[5].text), '模型挑了不存在的表情时从场景表情里随机');
    assert.match(bodies[2].messages.at(-1).content, /不要和这些刚发过的重复：主播唱得太好听啦！/);
    assert.equal(robot.snapshot().active_scene.sent, 3);
    // 等 AI 时场景被停掉：回来的话术不发，也不再排下一轮。
    let resolve; replies.push(new Promise(r => { resolve = r; }));
    t.mock.timers.tick(30000); await flush();
    await robot.action({ action: 'scene_stop' });
    resolve({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '晚到的应援' } }] }) });
    await flush3(); t.mock.timers.tick(60000); await flush3();
    assert.equal(services.sent.length, 6, '停掉后不发');
    assert.equal(bodies.length, 4);
    replies.push('1. 好听！\n2. “太强了”\n- 打call打call\n好听！\n\n');
    const { lines } = await robot.action({ action: 'scene_lines', name: '唱歌' });
    assert.deepEqual(lines, ['好听！', '太强了', '打call打call'], '去掉编号、引号和重复');
    assert.match(bodies[4].messages.at(-1).content, /唱歌/);
    await assert.rejects(robot.action({ action: 'scene_lines', name: '' }), /场景名字/);
  } finally { await robot.close(); await remove(dir); }
});

test('@机器人 切换场景：主播、房管和名单里的人能开关，其他人被婉拒；不是指令的照常交给 AI', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-12T12:00:00').getTime() });
  const dir = await tempDir('luobo-scene-cmd-');
  const services = fakeServices();
  const robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
  const flush3 = async () => { for (let i = 0; i < 3; i++) { t.mock.timers.tick(1000); await flush(); } };
  const say = (user, uid, text, extra = {}) => robot.receive({ type: 'chat', user, uid, text, ...extra });
  try {
    await assert.rejects(robot.action({ action: 'configure', config: { scene_command: { who: 'boss' } } }), /谁能开启场景/);
    await robot.action({ action: 'configure', config: { enabled: true, max_length: 100, interval_seconds: 1 } });
    await robot.action({ action: 'save_scenes', scenes: [{ id: 'sing', name: '唱歌', lines: '打call！', interval_seconds: 30 }, { id: 'dance', name: '跳舞', lines: '好看！', interval_seconds: 30 }] });
    say('路人', 5, '@萝卜机器人 开启唱歌模式'); await flush3();
    assert.equal(robot.snapshot().active_scene, null, '普通观众不能开');
    assert.deepEqual(services.sent.map(s => [s.text, s.replyMid]), [['只有主播和房管可以切换场景哦~', 5]]);
    t.mock.timers.tick(6000);
    say('路人', 5, '@萝卜机器人 开启唱歌模式'); await flush3();
    assert.equal(services.sent.length, 1, '婉拒一分钟只说一次');
    say('房管', 6, '@萝卜机器人 唱歌打call', { admin: true }); await flush3();
    assert.equal(robot.snapshot().active_scene.id, 'sing');
    assert.deepEqual(services.sent.slice(1).map(s => s.text), ['收到！唱歌模式开启，一起打call~', '打call！'], '先回话再开始应援');
    t.mock.timers.tick(6000);
    say('房管', 6, '@萝卜机器人 开启唱歌模式', { admin: true }); await flush3();
    assert.equal(services.sent.at(-1).text, '已经在唱歌模式啦，一起打call~');
    services.state.live.anchorUid = 7;
    say('主播', 7, '@萝卜机器人 关闭打call'); await flush3();
    assert.equal(robot.snapshot().active_scene, null, '主播能关');
    assert.equal(services.sent.at(-1).text, '好的，唱歌模式结束啦~');
    await robot.action({ action: 'configure', config: { scene_command: { users: '小明，123' } } });
    say('小明', 8, '@萝卜机器人 开始跳舞'); await flush3();
    assert.equal(robot.snapshot().active_scene.id, 'dance', '名单里的昵称能开');
    say('别人', 123, '@萝卜机器人 停止应援'); await flush3();
    assert.equal(robot.snapshot().active_scene, null, '名单里的 UID 能关');
    const before = services.sent.length;
    say('房管', 6, '@萝卜机器人 你唱歌好听吗', { admin: true }); await flush3();
    assert.equal(robot.snapshot().active_scene, null, '没有开关的意思就不是指令');
    assert.equal(services.sent.length, before);
    await robot.action({ action: 'configure', config: { scene_command: { who: 'all' } } });
    say('路人', 5, '@萝卜机器人 跳舞模式'); await flush3();
    assert.equal(robot.snapshot().active_scene.id, 'dance', '设成所有观众后谁都能开');
    say('路人2', 9, '跳舞模式'); await flush3();
    await robot.action({ action: 'configure', config: { scene_command: { enabled: false } } });
    t.mock.timers.tick(6000);
    say('路人', 5, '@萝卜机器人 关闭跳舞模式'); await flush3();
    assert.equal(robot.snapshot().active_scene.id, 'dance', '关掉后不认指令，没 @ 的也不认');
  } finally { await robot.close(); await remove(dir); }
});


test('感谢礼物分档：按连击合并后的总金额选档，每档话术不同，醒目留言也分档；档位校验与旧话术迁移', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-12T12:00:00').getTime() });
  const dir = await tempDir('luobo-gift-tiers-');
  const services = fakeServices();
  const robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
  const gift = (user, uid, giftId, giftName, count, tid) => robot.receive({ type: 'gift', user, uid, giftId, giftName, count, transactionId: tid });
  try {
    assert.deepEqual(robot.snapshot().config.gift.tiers.map(x => x.min), [0, 10, 100, 1000], '自带四档');
    const tiers = [{ min: 100, lines: '大礼物！谢谢{user}', use_ai: false }, { min: 0, lines: '谢谢{user}的{gift}', use_ai: false }, { min: 10, lines: '感谢{user}的{gift}×{count}，共{value}元', use_ai: false }];
    await robot.action({ action: 'configure', config: { enabled: true, max_length: 100, interval_seconds: 1, welcome: { enabled: false }, gift: { merge_seconds: 1, tiers } } });
    assert.deepEqual(robot.snapshot().config.gift.tiers.map(x => x.min), [0, 10, 100], '保存时按金额排好');
    gift('甲', 2, 10, '小花花', 1, 'a');
    gift('乙', 3, 12, '大鸡腿', 1, 'b');
    gift('丙', 4, 12, '大鸡腿', 2, 'c');
    gift('丙', 4, 12, '大鸡腿', 3, 'd');
    robot.receive({ type: 'chat', user: '丁', uid: 5, text: '加油', superChat: true, price: 30 });
    for (let i = 0; i < 8; i++) { t.mock.timers.tick(1000); await flush(); }
    assert.deepEqual(services.sent.map(s => s.text).sort(), ['大礼物！谢谢丙', '感谢丁的醒目留言×1，共30元', '感谢乙的大鸡腿×1，共20元', '谢谢甲的小花花'].sort(), '0.1元、20元、连击合并后100元、30元醒目留言各走各的档');

    const bad = list => robot.action({ action: 'configure', config: { gift: { tiers: list } } });
    await assert.rejects(bad([]), /1～8档/);
    await assert.rejects(bad(Array.from({ length: 9 }, (_, i) => ({ min: i, lines: 'x' }))), /1～8档/);
    await assert.rejects(bad([{ min: 0, lines: 'a' }, { min: 0, lines: 'b' }]), /不能重复/);
    await assert.rejects(bad([{ min: 0, lines: '谢谢{name}' }]), /\{name\} 不认识/);
    await assert.rejects(bad([{ min: 5, lines: '' }]), /还没有话术/);
    await assert.rejects(bad([{ min: -1, lines: 'a' }]), /档位金额/);
    await bad([{ min: 5, lines: '', use_ai: true }]);

    const migrated = normalizeConfig({ gift: { template: '老板{user}威武，{gift}收到' } });
    assert.equal(migrated.gift.tiers[0].lines, '老板{user}威武，{gift}收到', '旧版改过的礼物话术放进最低一档');
    assert.equal(migrated.gift.tiers.length, 4);
    assert.equal(normalizeConfig({ gift: { template: DEFAULTS.gift.template } }).gift.tiers[0].lines, DEFAULTS.gift.tiers[0].lines);
  } finally { await robot.close(); await remove(dir); }
});

test('感谢礼物 AI 现写：按档位让模型写，带上金额和档位；出错或只开 AI 的档回落到话术；试一试和 AI 写几句', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-12T12:00:00').getTime() });
  const dir = await tempDir('luobo-gift-ai-');
  const services = fakeServices();
  const bodies = [], replies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    const next = replies.shift();
    if (next === 'fail') return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: next } }] }) };
  };
  const robot = await new LiveRobot(dir, { services, fetchImpl, random: () => 0, keyStore: { get: () => 'sk-test', set: async () => {} } }).init();
  const gift = (user, uid, giftId, giftName, count, tid) => robot.receive({ type: 'gift', user, uid, giftId, giftName, count, transactionId: tid });
  const settle = async () => { for (let i = 0; i < 6; i++) { t.mock.timers.tick(1000); await flush(); } };
  try {
    const tiers = [{ min: 0, lines: '谢谢{user}', use_ai: false }, { min: 10, lines: '感谢{user}的{gift}！', use_ai: true }, { min: 100, lines: '', use_ai: true }];
    await robot.action({ action: 'configure', config: { enabled: true, max_length: 100, interval_seconds: 1, welcome: { enabled: false }, gift: { merge_seconds: 1, tiers } } });
    replies.push('哇乙老板送的大鸡腿太香啦，谢谢老板！');
    gift('乙', 3, 12, '大鸡腿', 1, 'b');
    await settle();
    assert.deepEqual(services.sent.map(s => s.text), ['哇乙老板送的大鸡腿太香啦，谢谢老板！']);
    const prompt = bodies[0].messages.at(-1).content;
    assert.match(prompt, /观众「乙」送了大鸡腿×1，价值20元（200电池）/);
    assert.match(prompt, /感谢乙的大鸡腿！/, '写好的话术填好变量当风格参考');
    assert.match(bodies[0].messages[0].content, /不超过40个字/);
    replies.push('fail');
    gift('丙', 4, 12, '大鸡腿', 1, 'c');
    await settle();
    assert.equal(services.sent.at(-1).text, '感谢丙的大鸡腿！', 'AI 出错用这一档的话术');
    replies.push('fail');
    gift('丁', 5, 12, '大鸡腿', 5, 'd');
    await settle();
    assert.equal(services.sent.at(-1).text, '感谢丁的大鸡腿！', '只开 AI 的档出错时往下找有话术的档');
    gift('戊', 6, 10, '小花花', 1, 'e');
    await settle();
    assert.equal(services.sent.at(-1).text, '谢谢戊', '没开 AI 的档不调用模型');
    assert.equal(bodies.length, 3);

    replies.push('戊老板太大气了！');
    assert.equal((await robot.action({ action: 'test_gift', user: '戊', value: 52 })).reply, '[10～100元这一档 · AI] 戊老板太大气了！');
    assert.equal((await robot.action({ action: 'test_gift', user: '戊', value: 1 })).reply, '[0～10元这一档] 谢谢戊');
    assert.equal(services.sent.length, 4, '试一试不发到直播间');

    replies.push('1. 谢谢{user}的{gift}×{count}！\n2. 感谢老板！\n- {user}老板大气，{name}收到\n“{user}送的{gift}太棒了”');
    const { lines } = await robot.action({ action: 'gift_lines', min: 100 });
    assert.deepEqual(lines, ['谢谢{user}的{gift}×{count}！', '{user}送的{gift}太棒了'], '只留带 {user} 且变量都认识的');
    assert.match(bodies.at(-1).messages.at(-1).content, /100元以上/);
    replies.push('谢谢老板！');
    await assert.rejects(robot.action({ action: 'gift_lines', min: 0 }), /没带 \{user\}/);
  } finally { await robot.close(); await remove(dir); }
});

test('发言队列：正在分段发的消息不会被后来的高优先级消息插队打断', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-12T12:00:00').getTime() });
  const dir = await tempDir('luobo-queue-');
  const services = fakeServices();
  const robot = await new LiveRobot(dir, { services }).init();
  try {
    await robot.action({ action: 'configure', config: { enabled: true, max_length: 10, interval_seconds: 1, welcome: { merge_seconds: 1, template: '欢迎{user}来到直播间，今天也要开开心心哦，记得点个关注' } } });
    robot.receive({ type: 'member', user: '甲', uid: 2 });
    t.mock.timers.tick(1000); await flush();
    t.mock.timers.tick(1000); await flush();
    assert.equal(robot.snapshot().log.find(e => e.kind === 'welcome').status, 'sending', '欢迎发了一部分，还没发完');
    await robot.action({ action: 'say', text: '插队消息' });
    for (let i = 0; i < 8; i++) { t.mock.timers.tick(1000); await flush(); }
    const texts = services.sent.map(s => s.text);
    assert.equal(texts.at(-1), '插队消息', '等欢迎分段发完再发');
    assert.equal(texts.slice(0, -1).join(''), '欢迎甲来到直播间，今天也要开开心心哦，记得点个关注');
    assert.equal(robot.snapshot().log.find(e => e.kind === 'welcome').status, 'sent');
    assert.equal(robot.snapshot().log.find(e => e.kind === 'manual').status, 'sent');
  } finally { await robot.close(); await remove(dir); }
});


test('给直播间点赞：B站点赞请求带房间、自己和主播的 uid、csrf；没登录、没连接、次数不对都拦下', async () => {
  const dir = await tempDir('luobo-like-');
  const posts = [];
  let reply = { code: 0, message: '0' };
  const services = await new ConsoleServices({ dataDir: dir, seedDir: dir, postImpl: async (url, body, cookie) => { posts.push({ url, body: new URLSearchParams(body), cookie }); return { body: Buffer.from(JSON.stringify(reply)), headers: {} }; } }).init();
  try {
    await assert.rejects(services.likeRoom(10), /未连接/);
    services.state.live = { status: 'connected', roomId: 1889484822 };
    await assert.rejects(services.likeRoom(10), /主播信息/);
    services.state.live.anchorUid = 777;
    await assert.rejects(services.likeRoom(10), /登录/);
    services.secretData.cookie = 'SESSDATA=a; bili_jct=tok; DedeUserID=9';
    await assert.rejects(services.likeRoom(0), /1～1000/);
    await assert.rejects(services.likeRoom(1001), /1～1000/);
    assert.equal(posts.length, 0);
    assert.deepEqual(await services.likeRoom(25), { ok: true, count: 25 });
    const [post] = posts;
    assert.equal(post.url, 'https://api.live.bilibili.com/xlive/app-ucenter/v1/like_info_v3/like/likeReportV3');
    assert.deepEqual(Object.fromEntries(post.body), { click_time: '25', room_id: '1889484822', uid: '9', anchor_id: '777', csrf: 'tok', csrf_token: 'tok', visit_id: '' });
    assert.match(post.cookie, /bili_jct=tok/);
    reply = { code: 1200000, message: '点赞太频繁' };
    await assert.rejects(services.likeRoom(5), /B站：点赞太频繁/);
  } finally { await remove(dir); }
});

test('机器人点赞：记进发言记录，按天累计；失败也记下原因；抖音不支持', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-12T23:59:00').getTime() });
  const dir = await tempDir('luobo-robot-like-');
  const likes = [];
  let fail = null;
  const services = fakeServices({ likeRoom: async count => { if (fail) throw fail; likes.push(count); return { ok: true, count }; } });
  const robot = await new LiveRobot(dir, { services }).init();
  try {
    assert.equal(robot.snapshot().likes_today, 0);
    assert.deepEqual(await robot.action({ action: 'like', count: 10 }), { liked: 10, likes_today: 10 });
    await robot.action({ action: 'like', count: 5 });
    assert.equal(robot.snapshot().likes_today, 15);
    assert.deepEqual(robot.snapshot().log.slice(0, 2).map(e => [e.kind, e.text, e.status]), [['like', '给直播间点赞 ×5', 'sent'], ['like', '给直播间点赞 ×10', 'sent']]);
    await assert.rejects(robot.action({ action: 'like', count: 0 }), /点赞次数/);
    await assert.rejects(robot.action({ action: 'like', count: 2.5 }), /整数/);
    fail = new Error('B站：点赞太频繁');
    await assert.rejects(robot.action({ action: 'like', count: 3 }), /太频繁/);
    assert.deepEqual([robot.snapshot().log[0].status, robot.snapshot().log[0].error], ['failed', 'B站：点赞太频繁']);
    assert.equal(robot.snapshot().likes_today, 15, '失败的不算');
    fail = null;
    t.mock.timers.tick(2 * 60000);
    assert.equal(robot.snapshot().likes_today, 0, '过了零点重新算');
    await robot.action({ action: 'like', count: 1 });
    assert.equal(robot.snapshot().likes_today, 1);
    assert.deepEqual(likes, [10, 5, 1]);
  } finally { await robot.close(); await remove(dir); }
});


test('礼物档位可以设上限：含起点不含上限，档位之间空出来的金额用默认一句；重叠、上限不大于起点、不封顶后面还有档都拦下；旧格式自动补上限', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-12T12:00:00').getTime() });
  const dir = await tempDir('luobo-tier-max-');
  const services = fakeServices();
  const robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
  const thank = async value => (await robot.action({ action: 'test_gift', user: '甲', value })).reply;
  try {
    assert.deepEqual(robot.snapshot().config.gift.tiers.map(x => [x.min, x.max]), [[0, 10], [10, 100], [100, 1000], [1000, null]], '默认四档带上限');
    await robot.action({ action: 'configure', config: { gift: { tiers: [{ min: 50, max: null, lines: '大哥{user}' }, { min: 1, max: 10, lines: '谢谢{user}' }] } } });
    assert.equal(await thank(0.5), '[不在任何档位，用默认一句] 谢谢甲送的小花花×1', '比最低档还少');
    assert.equal(await thank(1), '[1～10元这一档] 谢谢甲', '含起点');
    assert.equal(await thank(9.9), '[1～10元这一档] 谢谢甲');
    assert.equal(await thank(10), '[不在任何档位，用默认一句] 谢谢甲送的小花花×1', '不含上限，10～50 元没设档');
    assert.equal(await thank(50), '[50元以上这一档] 大哥甲');
    assert.equal(await thank(99999), '[50元以上这一档] 大哥甲', '最高档不封顶');

    const bad = list => robot.action({ action: 'configure', config: { gift: { tiers: list } } });
    await assert.rejects(bad([{ min: 0, max: null, lines: 'a' }, { min: 10, max: 20, lines: 'b' }]), /不封顶，会和「10元起」那一档重叠/);
    await assert.rejects(bad([{ min: 0, max: 30, lines: 'a' }, { min: 10, max: 50, lines: 'b' }]), /「0～30元」和「10～50元」重叠了/);
    await assert.rejects(bad([{ min: 5, max: 5, lines: 'a' }]), /上限要比起点大/);
    await assert.rejects(bad([{ min: 5, max: -1, lines: 'a' }]), /上限/);
    await bad([{ min: 0, max: 10, lines: 'a' }, { min: 10, max: '', lines: 'b' }]);
    assert.deepEqual(robot.snapshot().config.gift.tiers.map(x => [x.min, x.max]), [[0, 10], [10, null]], '上限填空就是不封顶');

    assert.deepEqual(normalizeConfig({ gift: { tiers: [{ min: 100, lines: 'c' }, { min: 0, lines: 'a' }, { min: 10, lines: 'b' }] } }).gift.tiers.map(x => [x.min, x.max]), [[0, 10], [10, 100], [100, null]], '旧版只有起点：到下一档为止');
    assert.throws(() => normalizeConfig({ gift: { tiers: [{ min: 0, lines: 'a' }, { min: 0, lines: 'b' }] } }), /起点不能重复/);
  } finally { await robot.close(); await remove(dir); }
});

test('AI 写的话跟着「一条弹幕最多几个字」：礼物感谢、打call 现编、AI 写几句都不超过它', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-12T12:00:00').getTime() });
  const dir = await tempDir('luobo-ai-limit-');
  const services = fakeServices();
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '谢谢{user}老板送的{gift}，老板大气，爱你哟，比心比心比心！' } }] }) }; };
  const robot = await new LiveRobot(dir, { services, fetchImpl, random: () => 0, keyStore: { get: () => 'sk-test', set: async () => {} } }).init();
  try {
    await robot.action({ action: 'configure', config: { max_length: 15, gift: { tiers: [{ min: 0, max: null, lines: '', use_ai: true }] } } });
    const { reply } = await robot.action({ action: 'test_gift', user: '甲', value: 20 });
    assert.match(bodies[0].messages.at(-1).content, /不超过15个字/);
    assert.match(bodies[0].messages[0].content, /不超过15个字/);
    assert.ok(Array.from(reply.replace(/^\[[^\]]*\] /, '')).length <= 15, '截到 15 个字以内');
    await robot.action({ action: 'gift_lines', min: 0, max: null }).catch(() => {});
    assert.match(bodies[1].messages.at(-1).content, /每句不超过15个字/);
    await robot.action({ action: 'scene_lines', name: '唱歌' });
    assert.match(bodies[2].messages.at(-1).content, /每句不超过15个字/, '打call 默认 30 字，也被压到 15');
    await robot.action({ action: 'configure', config: { max_length: 100, ai: { max_chars: 25 } } });
    await robot.action({ action: 'test_gift', user: '甲', value: 20 });
    assert.match(bodies[3].messages.at(-1).content, /不超过25个字/, '账号能发更长时按「AI 回复最多几个字」');
  } finally { await robot.close(); await remove(dir); }
});

test('每个礼物都用 AI 谢：不在档位里的、大航海、盲盒都交给 AI，严格按人设；忙时排队不换话术；AI 出错才用话术并记日志', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-12T12:00:00').getTime() });
  const dir = await tempDir('luobo-gift-ai-all-');
  const services = fakeServices();
  const bodies = [], waiting = [];
  let fail = false;
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    if (fail) return { ok: false, status: 500, json: async () => ({ error: { message: '服务器开小差' } }) };
    await new Promise(resolve => waiting.push(resolve));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '本喵收到啦谢谢老板喵' } }] }) };
  };
  const robot = await new LiveRobot(dir, { services, fetchImpl, random: () => 0, keyStore: { get: () => 'sk-test', set: async () => {} } }).init();
  const run = async n => { for (let i = 0; i < n; i++) { t.mock.timers.tick(1000); await flush(); } };
  try {
    assert.equal(normalizeConfig({}).gift.ai_all, false, '默认不打开');
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 100, ai: { persona: '你是猫娘小萝卜，自称本喵，句尾带喵' }, gift: { ai_all: true, merge_seconds: 0, tiers: [{ min: 10000, max: null, lines: '大哥{user}' }] } } });
    for (const user of ['甲', '乙', '丙', '丁', '戊']) robot.receive({ type: 'gift', user, uid: user.charCodeAt(0), giftId: 10, giftName: '小花花', count: 1, transactionId: user });
    robot.receive({ type: 'gift', user: '己', uid: 7, count: 1, guardName: '舰长', transactionId: 'g' });
    robot.receive({ type: 'gift', user: '庚', uid: 8, giftId: 10, giftName: '小花花', count: 1, blindGiftName: '心动盲盒', transactionId: 'b' });
    await run(1);
    assert.equal(bodies.length, 3, '同时最多 3 个在等 AI，其余排队');
    while (waiting.length) { waiting.splice(0).forEach(resolve => resolve()); await run(1); }
    await run(10);
    assert.equal(bodies.length, 7, '7 份礼物全都问了 AI');
    const texts = services.sent.filter(s => !s.emoticon).map(s => s.text);
    assert.deepEqual(texts, Array(7).fill('本喵收到啦谢谢老板喵'), '没有一条用写好的话术');
    const system = bodies[0].messages[0].content;
    assert.ok(system.startsWith('【你的人设，必须严格遵守】\n你是猫娘小萝卜，自称本喵，句尾带喵'), '人设放在最前面');
    assert.match(system, /感谢送礼物的观众/); assert.match(system, /不能跳出人设/);
    const asks = bodies.map(b => b.messages.at(-1).content);
    assert.ok(asks.some(x => /观众「己」开通了舰长/.test(x)), '大航海');
    assert.ok(asks.some(x => /观众「庚」开了心动盲盒×1，开出了小花花×1/.test(x)), '盲盒');
    assert.ok(asks.every(x => !x.includes('大哥')), '没勾「AI 现写」的档，话术不给 AI 当参考');

    fail = true;
    robot.receive({ type: 'gift', user: '辛', uid: 9, giftId: 10, giftName: '小花花', count: 1, transactionId: 'f' });
    await run(4);
    assert.equal(services.sent.filter(s => !s.emoticon).at(-1).text, '谢谢辛送的小花花×1', 'AI 出错时用默认一句');
    const failed = robot.snapshot().log.find(e => e.status === 'failed');
    assert.match(failed.error, /AI 没写出来（.*服务器开小差），改用写好的话术/);
  } catch (error) { waiting.splice(0).forEach(resolve => resolve()); throw error; }
  finally { await robot.close(); await remove(dir); }
});

test('盲盒感谢带上盈亏：这次赚了/亏了多少、今天累计、一直累计；旧默认话术自动换成带盈亏的', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-13T12:00:00').getTime() });
  const dir = await tempDir('luobo-box-profit-');
  const services = fakeServices();
  const robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
  const run = async () => { for (let i = 0; i < 4; i++) { t.mock.timers.tick(1000); await flush(); } };
  const words = () => services.sent.filter(s => !s.emoticon).map(s => s.text);
  try {
    assert.equal(normalizeConfig({ gift: { blind_template: '谢谢{user}的{box}×{count}，开出了{gift}' } }).gift.blind_template, '谢谢{user}的{box}×{count}，开出了{gift}，{profit}', '没改过的旧默认换成新的');
    assert.equal(normalizeConfig({ gift: { blind_template: '谢{user}' } }).gift.blind_template, '谢{user}', '自己改过的不动');
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 100, gift: { merge_seconds: 0 } } });
    robot.receive({ type: 'gift', user: '甲', uid: 2, giftId: 12, giftName: '大鸡腿', count: 1, blindGiftName: '心动盲盒', blindGiftPrice: 15000, giftPrice: 20000, transactionId: 'a' }); await run();
    assert.equal(words().at(-1), '谢谢甲的心动盲盒×1，开出了大鸡腿×1，赚了5元');
    await robot.action({ action: 'configure', config: { gift: { blind_template: '{user}花{cost}开出{value}，{profit}，今天{today_profit}，累计{total_profit}' } } });
    robot.receive({ type: 'gift', user: '甲', uid: 2, giftId: 10, giftName: '小花花', count: 1, blindGiftName: '心动盲盒', blindGiftPrice: 15000, giftPrice: 100, transactionId: 'b' }); await run();
    assert.equal(words().at(-1), '甲花15开出0.1，亏了14.9元，今天亏了9.9元，累计亏了9.9元');
  } finally { await robot.close(); await remove(dir); }
});

test('欢迎时记得观众多久没来：超过设定天数说好久不见，重启后也记得；没到天数或第一次来用普通欢迎', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-13T20:00:00').getTime() });
  const dir = await tempDir('luobo-welcome-back-');
  const services = fakeServices();
  const run = async () => { for (let i = 0; i < 4; i++) { t.mock.timers.tick(1000); await flush(); } };
  const words = () => services.sent.filter(s => !s.emoticon).map(s => s.text);
  let robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
  try {
    assert.deepEqual([robot.snapshot().config.welcome.back_days, robot.snapshot().config.welcome.back_template], [1, '好久不见呀{user}，都{ago}没来啦，想你了~']);
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 100, welcome: { merge_seconds: 0, user_cooldown_minutes: 30 } } });
    robot.receive({ type: 'member', user: '甲', uid: 2 }); await run();
    robot.receive({ type: 'chat', user: '丙', uid: 4, text: '主播好' }); await run();
    assert.deepEqual(words(), ['欢迎甲来到直播间~'], '第一次来用普通欢迎');
    await robot.close();

    t.mock.timers.tick(12 * 3600000);
    robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
    robot.receive({ type: 'member', user: '甲', uid: 2 }); await run();
    assert.equal(words().at(-1), '欢迎甲来到直播间~', '隔了半天，不到 1 天');
    await robot.close();

    t.mock.timers.tick(3 * 86400000);
    robot = await new LiveRobot(dir, { services, random: () => 0 }).init();
    robot.receive({ type: 'member', user: '甲', uid: 2 });
    robot.receive({ type: 'member', user: '乙', uid: 3 });
    robot.receive({ type: 'member', user: '丙', uid: 4 });
    await run(); await run();
    assert.deepEqual(words().slice(-3), ['好久不见呀甲，都3天没来啦，想你了~', '好久不见呀丙，都3天没来啦，想你了~', '欢迎乙来到直播间~'], '重启后也记得；说过话的也算来过；新观众普通欢迎');

    await robot.action({ action: 'configure', config: { welcome: { back_days: 0, user_cooldown_minutes: 0 } } });
    t.mock.timers.tick(5 * 86400000);
    robot.receive({ type: 'member', user: '甲', uid: 2 }); await run();
    assert.equal(words().at(-1), '欢迎甲来到直播间~', '设成 0 就不区分');
  } finally { await robot.close(); await remove(dir); }
});

test('每档可以写「AI 要求」：金额落在哪一档由程序判断，AI 照这一档的要求写；价值带上电池；AI 写几句也用它', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-13T12:00:00').getTime() });
  const dir = await tempDir('luobo-tier-style-');
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '哟{user}，{gift}好大方哦' } }] }) }; };
  const robot = await new LiveRobot(dir, { services: fakeServices(), fetchImpl, random: () => 0, keyStore: { get: () => 'sk-test', set: async () => {} } }).init();
  const ask = () => bodies.at(-1).messages.at(-1).content;
  try {
    await robot.action({ action: 'configure', config: { max_length: 100, ai: { persona: '你是小萝卜，礼物小于1元要阴阳怪气' }, gift: { ai_all: true, tiers: [{ min: 0, max: 1, lines: '', use_ai: true, ai_style: '阴阳怪气地谢，嫌礼物小' }, { min: 1, max: null, lines: '谢谢{user}' }] } } });
    assert.equal(robot.snapshot().config.gift.tiers[0].ai_style, '阴阳怪气地谢，嫌礼物小', '保存下来');
    assert.equal(robot.snapshot().config.gift.tiers[1].ai_style, '');

    await robot.action({ action: 'test_gift', user: '甲', gift: '小花花', value: 0.5 });
    assert.match(ask(), /观众「甲」送了小花花×1，价值0\.5元（5电池）/);
    assert.match(ask(), /这份礼物在「0～1元」这一档，这一档的要求必须照做：阴阳怪气地谢，嫌礼物小。语气以这条要求为准/);
    assert.doesNotMatch(ask(), /隆重热情/, '不再叫 AI 越贵越热情，免得和这一档的要求打架');

    await robot.action({ action: 'test_gift', user: '乙', gift: '大鸡腿', value: 20 });
    assert.match(ask(), /价值20元（200电池）/);
    assert.match(ask(), /按这次的20元来判断/, '没写要求的档：让 AI 按真实金额对照人设');
    assert.doesNotMatch(ask(), /阴阳怪气/);

    await robot.action({ action: 'gift_lines', min: 0, max: 1, style: '阴阳怪气地谢，嫌礼物小' });
    assert.match(ask(), /语气要求（必须照做）：阴阳怪气地谢，嫌礼物小/);
    assert.doesNotMatch(ask(), /隆重热情/);

    await assert.rejects(robot.action({ action: 'configure', config: { gift: { tiers: [{ min: 0, max: null, lines: 'a', ai_style: '长'.repeat(101) }] } } }), /AI 要求/);
  } finally { await robot.close(); await remove(dir); }
});

test('礼物价格：银瓜子礼物算免费、单价缺失用总价；礼物库没有的去直播间礼物面板查，10 分钟内不重复查', async () => {
  const dir = await tempDir('luobo-gift-price-');
  const services = await new ConsoleServices({ dataDir: dir, seedDir: dir }).init();
  const urls = [];
  services.request = async url => { urls.push(url); return { body: Buffer.from(JSON.stringify({ code: 0, data: { list: [{ id: 34999, name: '乐园星球', price: 1000, coin_type: 'gold' }, { id: 1, name: '辣条', price: 100, coin_type: 'silver' }] } })), headers: {} }; };
  try {
    services.liveMessage({ cmd: 'SEND_GIFT', data: { uname: '甲', uid: 2, giftId: 1, giftName: '辣条', num: 5, price: 100, coin_type: 'silver' } });
    assert.equal(services.events[0].giftFree, true); assert.equal(services.events[0].giftPrice, undefined, '银瓜子不是钱');
    services.liveMessage({ cmd: 'SEND_GIFT', data: { uname: '乙', uid: 3, giftId: 34999, giftName: '乐园星球', num: 2, price: 0, total_coin: 2000, coin_type: 'gold' } });
    assert.equal(services.events[0].giftPrice, 1000, '单价缺失时用总价 / 数量');
    services.state.live = { status: 'connected', roomId: 5050 };
    assert.equal(await services.giftPriceOf(34999), 1000);
    assert.equal(await services.giftPriceOf(1), 0, '面板里的银瓜子礼物算 0');
    assert.equal(await services.giftPriceOf(424242), null, '面板里也没有');
    assert.equal(urls.length, 1, '10 分钟内只读一次');
    assert.match(urls[0], /giftPanel\/giftConfig\?platform=pc&room_id=5050/);
    assert.ok(services.gifts.some(g => g.id === 34999 && g.name === '乐园星球' && g.price === 1000), '查到的新礼物合并进礼物库');
    assert.ok(!services.gifts.some(g => g.name === '辣条'), '免费礼物不进礼物库');
    assert.equal(services.state.gifts.count, services.gifts.length, '礼物库页面的数量跟着更新');
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'gifts.json'), 'utf8'));
    assert.ok(saved.list.some(g => g.id === 34999), '存进 gifts.json，重启后也有');

    services.roomGiftPrices = null;
    await fs.mkdir(path.join(dir, 'images'), { recursive: true });
    await services.syncGifts('5050');
    assert.equal(urls.length, 2, '手动「刷新礼物库」');
    assert.equal(await services.giftPriceOf(34999), 1000);
    assert.equal(urls.length, 2, '手动刷新过，机器人查价直接用，不再读');
  } finally { services.close(); await remove(dir); }
});

test('礼物库里没有的礼物：发感谢前去查价格，查到按真实金额分档；查不到算「价值不清楚」，不进任何档、不让 AI 猜金额', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-14T12:00:00').getTime() });
  const dir = await tempDir('luobo-unknown-price-');
  let price = 1000;
  const asked = [];
  const services = fakeServices({ giftPriceOf: async id => { asked.push(id); return price; } });
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '谢谢老板的乐园星球' } }] }) }; };
  const robot = await new LiveRobot(dir, { services, fetchImpl, random: () => 0, keyStore: { get: () => 'sk-test', set: async () => {} } }).init();
  const run = async () => { for (let i = 0; i < 4; i++) { t.mock.timers.tick(1000); await flush(); } };
  const ask = () => bodies.at(-1).messages.at(-1).content;
  try {
    await robot.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, max_length: 100, gift: { ai_all: true, merge_seconds: 0, min_value: 0.05, tiers: [{ min: 0, max: 1, lines: '', use_ai: true, ai_style: '阴阳怪气地谢，嫌礼物小' }, { min: 1, max: null, lines: '谢谢{user}' }] } } });
    robot.receive({ type: 'gift', user: '甲', uid: 2, giftId: 34999, giftName: '乐园星球', count: 1, transactionId: 'a' }); await run();
    assert.deepEqual(asked, [34999], '礼物库没有，去查价格');
    assert.match(ask(), /价值1元（10电池）/, '查到 1 元');
    assert.doesNotMatch(ask(), /阴阳怪气/, '1 元不在「0～1元」这一档');

    price = null;
    robot.receive({ type: 'gift', user: '乙', uid: 3, giftId: 34999, giftName: '乐园星球', count: 1, transactionId: 'b' }); await run();
    assert.equal(bodies.length, 2, '价值不清楚也照样感谢（不被最低价值拦下）');
    assert.match(ask(), /这份礼物的价值查不到，不要猜它值多少钱/);
    assert.doesNotMatch(ask(), /阴阳怪气|价值0元/);

    robot.receive({ type: 'gift', user: '丙', uid: 4, giftId: 10, giftName: '小花花', count: 1, transactionId: 'c' }); await run();
    assert.deepEqual(asked, [34999, 34999], '礼物库里有的不用查');
    assert.match(ask(), /价值0\.1元（1电池）/);

    robot.receive({ type: 'gift', user: '丁', uid: 5, giftId: 1, giftName: '辣条', count: 3, giftFree: true, transactionId: 'd' }); await run();
    assert.equal(bodies.length, 3, '免费的银瓜子礼物不到最低价值，不谢');
    assert.deepEqual(asked, [34999, 34999], '免费礼物不用查');
  } finally { await robot.close(); await remove(dir); }
});
