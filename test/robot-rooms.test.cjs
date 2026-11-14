const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { packet, unpack } = require('../lib/protocol.cjs');
const { ConsoleServices } = require('../lib/services.cjs');
const { RoomLink } = require('../lib/room-link.cjs');
const { RobotRooms } = require('../lib/robot-rooms.cjs');
const { LiveRobot } = require('../lib/robot.cjs');
const { startServer } = require('../server.cjs');

const tempDir = prefix => fs.mkdtemp(path.join(os.tmpdir(), prefix));
const remove = dir => fs.rm(dir, { recursive: true, force: true });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('另一个直播间的连接：用控制台的账号和签名连上，消息只交给自己，不改控制台连接的直播间', async () => {
  const dir = await tempDir('luobo-link-');
  let socket;
  class FakeSocket extends EventTarget {
    constructor() { super(); this.readyState = 0; this.sent = []; socket = this; setImmediate(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  const urls = [], posts = [];
  const requestImpl = async url => {
    urls.push(url);
    const u = new URL(url), endpoint = u.pathname;
    const data = endpoint.endsWith('/room_init') ? { room_id: 80008, uid: 777, live_status: 1 } : endpoint.endsWith('/get_info') ? { title: '副直播间' } : endpoint.endsWith('/spi') ? { b_3: 'shared-buvid' } : endpoint.endsWith('/nav') ? { isLogin: false, wbi_img: { img_url: 'https://i0.hdslb.com/' + 'a'.repeat(32) + '.png', sub_url: 'https://i0.hdslb.com/' + 'b'.repeat(32) + '.png' } } : endpoint.endsWith('/getDanmuInfo') ? { token: 'room-key', host_list: [{ host: 'test.chat.bilibili.com', wss_port: 443 }] } : endpoint.endsWith('/giftConfig') ? { list: [{ id: 34999, name: '乐园星球', price: 1000, coin_type: 'gold' }] } : {};
    return { body: Buffer.from(JSON.stringify({ code: endpoint.endsWith('/nav') ? -101 : 0, data })), headers: {} };
  };
  const postImpl = async (url, body) => { posts.push({ url, form: new URLSearchParams(body) }); return { body: Buffer.from(JSON.stringify({ code: 0, msg: '', message: '0' })), headers: {} }; };
  const services = await new ConsoleServices({ dataDir: dir, seedDir: dir, requestImpl, postImpl, WebSocketImpl: FakeSocket }).init();
  services.secretData.cookie = 'SESSDATA=a; bili_jct=tok; DedeUserID=9';
  const link = new RoomLink(services, '8'), events = [];
  link.on('event', event => events.push(event));
  try {
    await link.connectLive('8');
    await flush();
    const auth = JSON.parse(unpack(socket.sent[0])[0].body);
    assert.equal(auth.roomid, 80008); assert.equal(auth.key, 'room-key'); assert.equal(auth.uid, 9, '用控制台登录的账号');
    assert.equal(services.buvid, 'shared-buvid', 'buvid 和签名存在控制台那边，大家共用');
    socket.dispatchEvent(new MessageEvent('message', { data: packet({ code: 0 }, 8) }));
    assert.equal(link.state.live.status, 'connected'); assert.equal(link.state.live.title, '副直播间');
    assert.equal(services.state.live.status, 'disconnected', '控制台的连接不受影响');
    assert.equal(services.state.config.room, '', '不改控制台记住的直播间');
    assert.equal(link.state.account.loggedIn, services.state.account.loggedIn);

    link.liveMessage({ cmd: 'DANMU_MSG', info: [[0, 1, 25, 16777215, 0, 0, 0, '', 0, 0, 0, '', 0, '{}', '{}', {}], '主播好', [5, '观众甲', 0]] });
    assert.equal(events.length, 1); assert.equal(events[0].text, '主播好'); assert.equal(events[0].platform, 'bilibili');
    assert.equal(services.events.length, 0, '消息不进控制台的消息列表');

    await link.sendChat('欢迎欢迎');
    assert.equal(posts.at(-1).form.get('roomid'), '80008', '发到这个直播间'); assert.equal(posts.at(-1).form.get('csrf'), 'tok');
    await link.likeRoom(3);
    assert.equal(posts.at(-1).form.get('room_id'), '80008'); assert.equal(posts.at(-1).form.get('anchor_id'), '777');

    assert.equal(await link.giftPriceOf(34999), 1000);
    assert.match(urls.find(u => u.includes('giftConfig')), /room_id=80008/, '按这个直播间查礼物价格');
    assert.ok(services.gifts.some(g => g.id === 34999), '查到的新礼物进共用的礼物库');

    link.close();
    assert.equal(link.state.live.status, 'disconnected');
  } finally { link.close(); services.close(); await remove(dir); }
});

// 不连真的 B站：每个直播间给一个假连接，记下连接、断开和发出去的弹幕。
function fakeLinks(log) {
  return room => {
    const link = new EventEmitter();
    Object.assign(link, {
      platform: 'bilibili', selfUid: 1, gifts: [{ id: 10, name: '小花花', price: 100 }], sent: [],
      state: { live: { status: 'disconnected', roomId: null, title: '' }, account: { loggedIn: true, name: '萝卜机器人' }, config: { room } },
      async connectLive(input) { log.push(['connect', String(input)]); this.state.live = { status: 'connected', roomId: Number(input) * 10, title: `直播间${input}`, anchorUid: 9 }; this.emit('state'); },
      disconnectLive() { log.push(['disconnect', String(room)]); this.state.live = { status: 'disconnected', roomId: null, title: '' }; this.emit('state'); },
      close() { if (this.state.live.status !== 'disconnected') this.disconnectLive(); },
      async sendChat(text) { this.sent.push(text); return { ok: true }; },
    });
    log.links ??= {}; log.links[room] = link;
    return link;
  };
}
function mainServices() {
  const services = new EventEmitter();
  Object.assign(services, { platform: 'bilibili', selfUid: 1, gifts: [{ id: 10, name: '小花花', price: 100 }], sent: [], state: { live: { status: 'connected', roomId: 7734200, title: '主直播间' }, account: { loggedIn: true, name: '萝卜机器人' }, config: { room: '6' } }, async sendChat(text) { this.sent.push(text); return { ok: true }; } });
  return services;
}

test('多直播间：加直播间照抄设置（先不启动），各自的人设和消息分开，重复、主直播间、超过 5 个都拦下；重启后按原来的连接状态恢复，删掉再加回来用原来的设置', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-14T20:00:00').getTime() });
  const dir = await tempDir('luobo-rooms-');
  const log = [], services = mainServices();
  const main = await new LiveRobot(dir, { services, random: () => 0 }).init();
  let rooms = await new RobotRooms({ services, dataDir: dir, main, robotOptions: { random: () => 0 }, createLink: fakeLinks(log) }).init();
  const run = async () => { for (let i = 0; i < 4; i++) { t.mock.timers.tick(1000); await flush(); } };
  try {
    await main.action({ action: 'configure', config: { enabled: true, ai: { persona: '主直播间的人设' }, gift: { enabled: true, merge_seconds: 0 } } });
    assert.deepEqual((await rooms.action({ action: 'list' })).rooms.map(r => [r.id, r.main, r.status]), [['main', true, 'connected']]);

    const added = await rooms.action({ action: 'add', room: '123', copy_from: 'main' });
    assert.equal(added.id, 'room-123'); assert.equal(added.restored, false);
    await flush();
    assert.deepEqual(log.slice(-1), [['connect', '123']], '加上就连接');
    const extra = rooms.robotFor('room-123');
    assert.equal(extra.config.ai.persona, '主直播间的人设', '照抄当前直播间的设置');
    assert.equal(extra.config.enabled, false, '先不启动');
    assert.equal(added.rooms.find(r => r.id === 'room-123').title, '直播间123');

    await extra.action({ action: 'configure', config: { enabled: true, interval_seconds: 1, ai: { persona: '副直播间的人设' }, gift: { template: '谢谢{user}送的{gift}×{count}', merge_seconds: 0 } } });
    assert.equal(main.config.ai.persona, '主直播间的人设', '改副直播间不影响主直播间');
    log.links['123'].emit('event', { type: 'gift', user: '甲', uid: 2, giftId: 10, giftName: '小花花', count: 1, transactionId: 'x' });
    await run();
    assert.deepEqual(log.links['123'].sent, ['谢谢甲送的小花花×1'], '副直播间的礼物由副直播间的机器人谢');
    assert.deepEqual(services.sent, [], '主直播间不会跟着发');

    await assert.rejects(rooms.action({ action: 'add', room: '123' }), /已经加过/);
    await assert.rejects(rooms.action({ action: 'add', room: '6' }), /主直播间/);
    await assert.rejects(rooms.action({ action: 'add', room: 'https://evil.com/9' }), /直播间/);
    for (const room of ['124', '125', '126', '127']) await rooms.action({ action: 'add', room });
    await assert.rejects(rooms.action({ action: 'add', room: '128' }), /最多再加 5 个/);

    await rooms.action({ action: 'disconnect', id: 'room-124' });
    assert.equal(rooms.list().find(r => r.id === 'room-124').status, 'disconnected');
    await rooms.close();

    log.length = 0;
    rooms = await new RobotRooms({ services, dataDir: dir, main, robotOptions: { random: () => 0 }, createLink: fakeLinks(log) }).init();
    await flush();
    assert.deepEqual(rooms.list().map(r => r.id), ['main', 'room-123', 'room-124', 'room-125', 'room-126', 'room-127'], '重启后直播间都在');
    assert.deepEqual(log.map(x => x[1]).sort(), ['123', '125', '126', '127'], '断开的那个重启后也不连');
    assert.equal(rooms.robotFor('room-123').config.ai.persona, '副直播间的人设', '各自的设置存在各自的文件夹');

    await rooms.action({ action: 'remove', id: 'room-123' });
    assert.ok(!rooms.list().some(r => r.id === 'room-123'));
    await assert.rejects(Promise.resolve().then(() => rooms.robotFor('room-123')), /没有这个直播间/);
    const back = await rooms.action({ action: 'add', room: '123', copy_from: 'main' });
    assert.equal(back.restored, true, '删掉再加回来用原来的设置');
    assert.equal(rooms.robotFor('room-123').config.ai.persona, '副直播间的人设');
  } finally { await rooms.close(); await main.close(); await remove(dir); }
});

test('多直播间接口：加直播间、按直播间读写机器人设置、推送状态带直播间编号', async () => {
  const dir = await tempDir('luobo-rooms-server-');
  const log = [];
  const runtime = await startServer({featuresOn:true, dataDir: dir, seedDir: dir, robotLink: fakeLinks(log) });
  const post = async (url, body) => { const response = await fetch(runtime.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const json = await response.json(); if (!response.ok) throw new Error(json.error || response.status); return json; };
  try {
    const added = await post('/api/robot/rooms', { action: 'add', room: '321', copy_from: 'main' });
    assert.equal(added.id, 'room-321'); assert.deepEqual(added.rooms.map(r => r.id), ['main', 'room-321']);
    const saved = await post('/api/robot/action', { room: 'room-321', action: 'configure', config: { ai: { persona: '副直播间人设' } } });
    assert.equal(saved.state.room, 'room-321'); assert.equal(saved.state.config.ai.persona, '副直播间人设');
    const mainState = await (await fetch(runtime.url + '/api/robot/state')).json();
    assert.equal(mainState.room, 'main'); assert.notEqual(mainState.config.ai.persona, '副直播间人设', '主直播间没变');
    const extraState = await (await fetch(runtime.url + '/api/robot/state?room=room-321')).json();
    assert.equal(extraState.config.ai.persona, '副直播间人设'); assert.equal(extraState.live.status, 'connected');
    await assert.rejects(post('/api/robot/action', { room: 'room-999', action: 'clear_log' }), /没有这个直播间/);
  } finally { await runtime.close(); await remove(dir); }
});
