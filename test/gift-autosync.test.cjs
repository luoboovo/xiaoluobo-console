const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { startServer } = require('../server.cjs');

// 假的 B站礼物面板：原来就有「小花花」，B站上新出了「新礼物」。图片下载一律失败（不影响结果）。
function fakeBili() {
  const calls = [];
  const requestImpl = async url => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (u.pathname.endsWith('/giftConfig')) return { body: Buffer.from(JSON.stringify({ code: 0, data: { list: [
      { id: 1, name: '小花花', price: 100, coin_type: 'gold', img_basic: 'https://i0.hdslb.com/bfs/live/a.png' },
      { id: 2, name: '新礼物', price: 5200, coin_type: 'gold', img_basic: 'https://i0.hdslb.com/bfs/live/b.png' },
    ] } })), headers: {} };
    throw new Error('网络不通');
  };
  return { calls, requestImpl };
}
const until = async (check, ms = 4000) => { const end = Date.now() + ms; while (!await check()) { if (Date.now() > end) throw new Error('等太久了'); await new Promise(r => setTimeout(r, 10)); } };

test('打开控制台自动刷新礼物库：有新礼物就在实时消息里说一声，按上次连的直播间查', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-gift-auto-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'gifts.json'), JSON.stringify({ updatedAt: null, list: [{ id: 1, name: '小花花', price: 100, coinType: 'gold', icon: 'https://i0.hdslb.com/bfs/live/a.png' }] }));
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({ platform: 'bilibili', room: '6', rooms: { bilibili: '6', douyin: '' } }));
  const bili = fakeBili();
  const app = await startServer({ dataDir: dir, seedDir: dir, requestImpl: bili.requestImpl, autoSyncGifts: true });
  try {
    await until(async () => (await (await fetch(app.url + '/api/state')).json()).events.some(e => e.type === 'gift-library'));
    const { state, events } = await (await fetch(app.url + '/api/state')).json();
    assert.equal(events.find(e => e.type === 'gift-library').text, '礼物库自动更新：新增 1 种礼物（新礼物）');
    assert.equal(state.gifts.added.count, 1);
    assert.deepEqual(state.gifts.added.names, ['新礼物']);
    assert.ok(bili.calls.some(c => c.includes('/giftConfig?platform=pc&room_id=6')), '按上次连的直播间查');
    const gifts = await (await fetch(app.url + '/api/gifts')).json();
    assert.deepEqual(gifts.map(g => g.name).sort(), ['小花花', '新礼物']);
  } finally { await app.close(); }
});

test('没打开自动刷新（测试和脚本默认）就不去请求 B站礼物', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-gift-auto-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bili = fakeBili();
  const app = await startServer({ dataDir: dir, seedDir: dir, requestImpl: bili.requestImpl });
  try {
    await new Promise(r => setTimeout(r, 100));
    assert.equal(bili.calls.filter(c => c.includes('giftConfig')).length, 0);
  } finally { await app.close(); }
});

test('自动刷新礼物库失败（网慢超时）会隔一会儿再试；一直不行就提示手动刷新', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-gift-auto-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let fails = 2, configCalls = 0;
  const ok = fakeBili();
  const requestImpl = async url => { if (url.includes('/giftConfig')) { configCalls++; if (fails-- > 0) throw new Error('网络请求超时，请重试'); } return ok.requestImpl(url); };
  let app = await startServer({ dataDir: dir, seedDir: dir, requestImpl, autoSyncGifts: true, autoSyncRetryMs: 20 });
  try {
    await until(async () => (await (await fetch(app.url + '/api/state')).json()).state.gifts.count === 2);
    assert.equal(configCalls, 3, '前两次失败，第三次成功');
  } finally { await app.close(); }

  configCalls = 0;
  app = await startServer({ dataDir: dir, seedDir: dir, requestImpl: async () => { configCalls++; throw new Error('网络请求超时，请重试'); }, autoSyncGifts: true, autoSyncRetryMs: 20 });
  try {
    await until(async () => /自动刷新礼物库没成功/.test((await (await fetch(app.url + '/api/state')).json()).state.gifts.error || ''));
    assert.equal(configCalls, 3, '一共试 3 次');
  } finally { await app.close(); }
});
