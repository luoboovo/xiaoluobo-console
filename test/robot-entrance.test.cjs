const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LiveRobot: BaseRobot, normalizeConfig } = require('../lib/robot.cjs');
// 下面的用例是按旧默认（欢迎、谢礼物、谢关注、盲盒查询、@切场景、进场视频都开着）写的。
// 功能开关改成默认全关后，第一次建机器人时在这里把这几个打开；重启读回来的照存下的来。
const OLD_DEFAULT_ON = ['welcome', 'gift', 'follow', 'blindbox', 'scene_command', 'entrance'];
class LiveRobot extends BaseRobot {
  async init() {
    const fresh = await fs.access(this.file).then(() => false, () => true);
    await super.init();
    if (fresh) this.config = normalizeConfig(Object.fromEntries(OLD_DEFAULT_ON.map(key => [key, { enabled: true }])), this.config);
    return this;
  }
}
const { startServer } = require('../server.cjs');

const tempDir = prefix => fs.mkdtemp(path.join(os.tmpdir(), prefix));
const remove = dir => fs.rm(dir, { recursive: true, force: true });
const video = { asset: 'a'.repeat(64) + '.mp4', name: '大哥进场.mp4', duration: 8, green_screen: true };

function services() {
  const s = new EventEmitter();
  Object.assign(s, { platform: 'bilibili', selfUid: 1, gifts: [], sent: [], state: { live: { status: 'connected', roomId: 100 }, account: { loggedIn: true, name: '萝卜机器人' }, config: { room: '6' } }, async sendChat(text) { this.sent.push(text); return { ok: true }; } });
  return s;
}

test('专属进场视频：按 UID 认人（改了昵称也认得），机器人关着也播，冷却内不重复，神秘人和名单外不播；没人接收的直播间不播', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-14T20:00:00').getTime() });
  const dir = await tempDir('luobo-entrance-');
  const robot = await new LiveRobot(dir, { services: services(), random: () => 0 }).init();
  const cues = [];
  try {
    assert.equal(robot.snapshot().can_entrance, false, '没人接收时页面上不让设');
    robot.receive({ type: 'member', user: '大哥', uid: 42 });
    await assert.rejects(robot.action({ action: 'entrance_test', uid: 42 }), /只在主直播间/);

    robot.on('entrance', cue => cues.push(cue));
    const bad = list => robot.action({ action: 'configure', config: { entrance: { list } } });
    await assert.rejects(bad([{ uid: 'abc', media: video }]), /UID 要填数字/);
    await assert.rejects(bad([{ uid: '42', media: video }, { uid: 42, media: video }]), /UID 42 重复了/);
    await assert.rejects(bad([{ uid: '42' }]), /UID 42 还没选视频/);
    await assert.rejects(bad(Array.from({ length: 51 }, (_, i) => ({ uid: i + 1, media: video }))), /最多设 50 个人/);
    await robot.action({ action: 'configure', config: { enabled: false, entrance: { cooldown_minutes: 60, list: [{ uid: ' 42 ', note: '大哥', media: video }] } } });
    assert.deepEqual(robot.snapshot().config.entrance.list, [{ uid: 42, note: '大哥', media: { ...video, kind: 'video' } }]);
    assert.equal(normalizeConfig({}).entrance.enabled, false, '默认关着，在最上面的功能开关里打开');

    robot.receive({ type: 'member', user: '改了名的大哥', uid: 42 });
    assert.equal(cues.length, 1, '机器人关着也播');
    assert.equal(cues[0].uid, 42); assert.equal(cues[0].media.asset, video.asset);
    assert.equal(robot.snapshot().log[0].text, '大哥 进场，播放「大哥进场.mp4」');

    robot.receive({ type: 'member', user: '大哥', uid: 42 });
    t.mock.timers.tick(59 * 60000);
    robot.receive({ type: 'member', user: '大哥', uid: 42 });
    assert.equal(cues.length, 1, '60 分钟内不重复');
    t.mock.timers.tick(2 * 60000);
    robot.receive({ type: 'member', user: '大哥', uid: 42 });
    assert.equal(cues.length, 2, '过了冷却再播');

    robot.receive({ type: 'member', user: '神秘人', uid: 0 });
    robot.receive({ type: 'member', user: '路人', uid: 7 });
    robot.receive({ type: 'chat', user: '大哥', uid: 42, text: '我来了' });
    assert.equal(cues.length, 2, '神秘人、名单外、说话都不播');
    assert.deepEqual(robot.snapshot().recent_members.map(m => [m.uid, m.name]), [[7, '路人'], [42, '大哥']], '最近进场的观众（带 UID）');

    await robot.action({ action: 'entrance_test', uid: 42 });
    assert.equal(cues.length, 3, '试播不管冷却');
    cues[2].fail(new Error('找不到素材'));
    assert.equal(robot.snapshot().log[0].status, 'failed'); assert.equal(robot.snapshot().log[0].error, '找不到素材');

    await robot.action({ action: 'configure', config: { entrance: { enabled: false } } });
    t.mock.timers.tick(120 * 60000);
    robot.receive({ type: 'member', user: '大哥', uid: 42 });
    assert.equal(cues.length, 3, '关掉就不播');
  } finally { await robot.close(); await remove(dir); }
});

test('专属进场视频接口：上传视频、存进名单，名单里的人进主直播间就进素材队列（加班机没开也播）', async () => {
  const dir = await tempDir('luobo-entrance-server-');
  const runtime = await startServer({featuresOn:true, dataDir: dir, seedDir: dir });
  const post = async (url, body) => { const response = await fetch(runtime.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const json = await response.json(); if (!response.ok) throw new Error(json.error || response.status); return json; };
  try {
    const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(200)]);
    const uploaded = await (await fetch(runtime.url + '/api/overtime/media?name=' + encodeURIComponent('大哥进场.mp4'), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).json();
    assert.equal(uploaded.kind, 'video');
    const saved = await post('/api/robot/action', { action: 'configure', config: { entrance: { enabled: true, list: [{ uid: '42', note: '大哥', media: { asset: uploaded.asset, name: uploaded.name, kind: 'video', duration: 6, green_screen: false } }] } } });
    assert.equal(saved.state.can_entrance, true);
    assert.equal(runtime.overtime.snapshot().mode, 'idle', '加班机没开');

    runtime.services.addEvent('member', '大哥', '进入了直播间', { uid: 42 });
    await new Promise(resolve => setTimeout(resolve, 50));
    const cue = runtime.overtime.snapshot().media_cue;
    assert.ok(cue, '进场视频进了素材队列');
    assert.equal(cue.asset, uploaded.asset); assert.equal(cue.always, true); assert.equal(cue.green_screen, false);

    await post('/api/robot/action', { action: 'configure', config: { entrance: { list: [{ uid: '43', media: { asset: 'b'.repeat(64) + '.mp4', name: '丢了.mp4', duration: 3 } }] } } });
    runtime.services.addEvent('member', '二哥', '进入了直播间', { uid: 43 });
    await new Promise(resolve => setTimeout(resolve, 50));
    const failed = (await (await fetch(runtime.url + '/api/robot/state')).json()).log.find(e => e.kind === 'entrance' && e.status === 'failed');
    assert.match(failed.error, /找不到素材/, '视频文件丢了，发言记录里标出来');
  } finally { await runtime.close(); await remove(dir); }
});

test('按昵称在B站搜用户：带 WBI 签名和 buvid，去掉搜索高亮，头像补成 https，最多 10 个', async () => {
  const { ConsoleServices } = require('../lib/services.cjs');
  const dir = await tempDir('luobo-search-');
  const calls = [];
  const requestImpl = async (url, cookie) => {
    calls.push({ url, cookie });
    const endpoint = new URL(url).pathname;
    const data = endpoint.endsWith('/spi') ? { b_3: 'test-buvid' } : endpoint.endsWith('/nav') ? { isLogin: false, wbi_img: { img_url: 'https://i0.hdslb.com/' + 'a'.repeat(32) + '.png', sub_url: 'https://i0.hdslb.com/' + 'b'.repeat(32) + '.png' } }
      : { result: [{ mid: 42, uname: '<em class="keyword">萝卜</em>大哥', upic: '//i1.hdslb.com/bfs/face/x.jpg', fans: 12345, level: 6, usign: '<em>签名</em>' }, { mid: 0, uname: '坏数据' }, ...Array.from({ length: 12 }, (_, i) => ({ mid: 100 + i, uname: `萝卜${i}`, upic: 'https://evil.com/x.jpg' }))] };
    return { body: Buffer.from(JSON.stringify({ code: endpoint.endsWith('/nav') ? -101 : 0, data })), headers: {} };
  };
  const services = await new ConsoleServices({ dataDir: dir, seedDir: dir, requestImpl }).init();
  try {
    await assert.rejects(services.searchUsers('  '), /请填昵称/);
    const users = await services.searchUsers('萝卜');
    assert.equal(users.length, 10, '最多 10 个，坏数据去掉');
    assert.deepEqual(users[0], { uid: 42, name: '萝卜大哥', face: 'https://i1.hdslb.com/bfs/face/x.jpg', fans: 12345, level: 6, sign: '签名' });
    assert.equal(users[1].face, '', '不是B站的头像地址不要');
    const search = calls.find(c => c.url.includes('/search/type'));
    const query = new URL(search.url).searchParams;
    assert.equal(query.get('keyword'), '萝卜'); assert.equal(query.get('search_type'), 'bili_user'); assert.match(query.get('w_rid'), /^[0-9a-f]{32}$/);
    assert.match(search.cookie, /buvid3=test-buvid/);
  } finally { services.close(); await remove(dir); }
});

test('按昵称找 UID：先列来过直播间的观众（同名排前面、最近来的在前），再列B站搜索；搜索失败也给出本地结果', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-11-14T20:00:00').getTime() });
  const dir = await tempDir('luobo-find-user-');
  const s = services();
  let fail = false;
  s.searchUsers = async keyword => { if (fail) throw new Error('B站：请求被拦截'); return [{ uid: 900, name: keyword + '本尊', face: '', fans: 1, level: 3, sign: '' }]; };
  const robot = await new LiveRobot(dir, { services: s, random: () => 0 }).init();
  try {
    robot.receive({ type: 'member', user: '萝卜大哥', uid: 42 });
    t.mock.timers.tick(60000);
    robot.receive({ type: 'chat', user: '小萝卜', uid: 43, text: '晚上好' });
    t.mock.timers.tick(60000);
    robot.receive({ type: 'member', user: '路人', uid: 44 });
    await assert.rejects(robot.action({ action: 'find_user', keyword: ' ' }), /请填要找的昵称/);
    let { users } = await robot.action({ action: 'find_user', keyword: '萝卜' });
    assert.deepEqual(users.local.map(u => u.uid), [43, 42], '最近来的在前');
    assert.deepEqual(users.online.map(u => u.uid), [900]);
    ({ users } = await robot.action({ action: 'find_user', keyword: '萝卜大哥' }));
    assert.deepEqual(users.local.map(u => [u.uid, u.name]), [[42, '萝卜大哥']]);
    robot.receive({ type: 'member', user: '萝卜大哥呀', uid: 45 });
    ({ users } = await robot.action({ action: 'find_user', keyword: '萝卜大哥' }));
    assert.deepEqual(users.local.map(u => u.uid), [42, 45], '名字完全一样的排最前');
    fail = true;
    ({ users } = await robot.action({ action: 'find_user', keyword: '路人' }));
    assert.deepEqual(users.local.map(u => u.uid), [44]); assert.equal(users.error, 'B站：请求被拦截');
  } finally { await robot.close(); await remove(dir); }
});
