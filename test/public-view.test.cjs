const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const WebSocket = require('ws');
const { atomicJson } = require('../lib/services.cjs');
const { startServer } = require('../server.cjs');

const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test('公网只读访问：默认关闭，开启后凭访问码只读，写操作和导出被拒', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-public-'));
  await atomicJson(path.join(dir, 'gifts.json'), { list: [{ id: 1, name: '小花花', price: 100, coinType: 'gold', icon: '' }], updatedAt: null });
  const runtime = await startServer({ featuresOn: true, dataDir: dir, seedDir: dir });
  try {
    const port = await freePort();
    let info = await (await fetch(runtime.url + '/api/public-view')).json();
    assert.equal(info.enabled, false); assert.equal(info.running, false);
    info = await (await fetch(runtime.url + '/api/public-view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, port }) })).json();
    assert.equal(info.running, true);
    const token = JSON.parse(await fs.readFile(path.join(dir, 'public-view.json'), 'utf8')).token;
    const base = `http://127.0.0.1:${port}`;

    assert.equal((await fetch(base + '/api/state')).status, 401);
    assert.equal((await fetch(base + '/api/state?key=wrong')).status, 401);
    const first = await fetch(base + '/danmaku/?key=' + token, { redirect: 'manual' });
    assert.equal(first.status, 302); assert.equal(first.headers.get('location'), '/danmaku/');
    const cookie = first.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: cookie };
    assert.equal((await fetch(base + '/danmaku/', { headers })).status, 200);
    assert.equal((await fetch(base + '/api/gifts', { headers })).status, 200);
    for (const blocked of ['/api/config/export', '/api/diagnostics/export', '/api/gifts/export', '/api/public-view', '/api/update/state'])
      assert.equal((await fetch(base + blocked, { headers })).status, 403, blocked);
    const write = await fetch(base + '/api/live/disconnect', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(write.status, 403);

    const viewer = new WebSocket(`ws://127.0.0.1:${port}/api/events/socket?danmaku`, { headers });
    await new Promise((resolve, reject) => { viewer.once('message', resolve); viewer.once('error', reject); });
    const rejected = await new Promise(resolve => { const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events/socket?danmaku`, { headers, origin: 'https://evil.com' }); ws.once('open', () => resolve(false)); ws.once('error', () => resolve(true)); });
    assert.equal(rejected, true);

    const post = body => fetch(runtime.url + '/api/public-view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    const connect = cookieHeader => new Promise((resolve, reject) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/api/events/socket?danmaku`, { headers: cookieHeader }); ws.once('message', () => resolve(ws)); ws.once('error', reject); });
    // 更换访问码：旧 Cookie 失效，正在看的人也被断开。
    let closed = new Promise(resolve => viewer.once('close', resolve));
    await post({ resetToken: true }); await closed;
    assert.equal((await fetch(base + '/api/gifts', { headers })).status, 401);
    const fresh = JSON.parse(await fs.readFile(path.join(dir, 'public-view.json'), 'utf8')).token;
    const again = await connect({ Cookie: 'luobo_view=' + fresh });
    // 外面还连着推送时关闭，也要马上关掉并断开它。
    closed = new Promise(resolve => again.once('close', resolve));
    info = await post({ enabled: false });
    assert.equal(info.running, false); await closed;
    await assert.rejects(fetch(base + '/api/gifts'));
  } finally { await runtime.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
