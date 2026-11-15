const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startServer } = require('../server.cjs');

// 假的 B站：房间接口和弹幕连接都在本地应答；roomFails 次 room_init 先失败（模拟刚开机没网）。
function fakeBili({ roomFails = 0 } = {}) {
  const sockets = [];
  let fails = roomFails;
  class FakeSocket extends EventTarget {
    constructor() { super(); this.readyState = 0; sockets.push(this); setImmediate(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
    send() {}
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  const requestImpl = async url => {
    const endpoint = new URL(url).pathname;
    if (endpoint.endsWith('/room_init') && fails > 0) { fails--; throw new Error('网络还没好'); }
    const data = endpoint.endsWith('/room_init') ? { room_id: 7734200, live_status: 1 } : endpoint.endsWith('/get_info') ? { title: '测试直播间' } : endpoint.endsWith('/spi') ? { b_3: 'test-buvid' } : endpoint.endsWith('/nav') ? { isLogin: false, wbi_img: { img_url: 'https://i0.hdslb.com/' + 'a'.repeat(32) + '.png', sub_url: 'https://i0.hdslb.com/' + 'b'.repeat(32) + '.png' } } : { token: 'test-key', host_list: [{ host: 'test.chat.bilibili.com', wss_port: 2245 }] };
    return { body: Buffer.from(JSON.stringify({ code: endpoint.endsWith('/nav') ? -101 : 0, data })), headers: {} };
  };
  return { sockets, options: { requestImpl, WebSocketImpl: FakeSocket } };
}
const post = async (app, url, body = {}) => {
  const response = await fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || response.status);
  return json;
};
const until = async (check, ms = 2000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('等太久了'); await new Promise(r => setTimeout(r, 5)); } };
const saved = async dir => JSON.parse(await fs.readFile(path.join(dir, 'live-connect.json'), 'utf8'));

test('直播间：连上后记住，重新打开控制台自动连回去；手动断开后下次不再自动连', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-live-memory-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const start = bili => startServer({ dataDir: dir, seedDir: dir, ...bili.options });

  let bili = fakeBili(), app = await start(bili);
  try {
    await new Promise(r => setTimeout(r, 30));
    assert.equal(bili.sockets.length, 0, '第一次打开、没连过：不自动连');
    await post(app, '/api/live/connect', { room: '6' });
    assert.equal(bili.sockets.length, 1);
    assert.equal((await saved(dir)).bilibili, true, '连上就记下');
  } finally { await app.close(); }

  bili = fakeBili(); app = await start(bili);
  try {
    await until(() => bili.sockets.length === 1);
    assert.equal(app.services.state.config.room, '6');
    assert.equal(app.services.state.live.roomId, 7734200, '重新打开自动连回上次的直播间');
    await post(app, '/api/live/disconnect');
    assert.equal(app.services.state.live.status, 'disconnected');
    assert.equal((await saved(dir)).bilibili, false, '手动断开就忘掉');
  } finally { await app.close(); }

  bili = fakeBili(); app = await start(bili);
  try {
    await new Promise(r => setTimeout(r, 30));
    assert.equal(bili.sockets.length, 0, '断开过的，下次打开不自动连');
    assert.equal(app.services.state.live.status, 'disconnected');
  } finally { await app.close(); }
});

test('直播间：自动连接失败（比如刚开机没网）会隔一会儿再试', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-live-retry-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({ platform: 'bilibili', room: '6', rooms: { bilibili: '6', douyin: '' } }));
  await fs.writeFile(path.join(dir, 'live-connect.json'), JSON.stringify({ version: 1, bilibili: true }));
  const bili = fakeBili({ roomFails: 2 });
  const app = await startServer({ dataDir: dir, seedDir: dir, ...bili.options, liveMemory: { retryDelay: 10 } });
  try {
    await until(() => bili.sockets.length === 1);
    assert.equal(app.services.state.live.roomId, 7734200, '前两次失败，第三次连上');
    assert.equal((await saved(dir)).bilibili, true, '自动连失败不会忘掉');
  } finally { await app.close(); }
});
