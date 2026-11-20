const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { startServer } = require('../server.cjs');
const { publicFile } = require('../lib/static-files.cjs');

test('弹幕姬：画面页面可访问，只收弹幕消息，带上舰长、粉丝牌和礼物单价', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-danmaku-'));
  const runtime = await startServer({ featuresOn: true, dataDir: dir, seedDir: dir });
  try {
    assert.equal(publicFile('/danmaku/'), 'danmaku/overlay.html');
    assert.equal(publicFile('/danmaku/overlay.js'), 'danmaku/overlay.js');
    assert.equal(publicFile('/danmaku/../server.cjs'), null);
    const page = await fetch(runtime.url + '/danmaku/');
    assert.equal(page.status, 200);
    runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[], '早', [7, '旧消息']] });

    const ws = new WebSocket(runtime.url.replace('http', 'ws') + '/api/events/socket?danmaku=1', { origin: runtime.url });
    const frames = [];
    ws.on('message', data => frames.push(String(data)));
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[], '舰长来了', [1, '萝卜'], [21, '小萝卜', '主播', 6, 0, 0, 0, 0, 0, 0, 3, 1, 99], 0, 0, 0, 3] });
    runtime.services.liveMessage({ cmd: 'SEND_GIFT', data: { uname: '观众', uid: 2, giftId: 1, giftName: '小花花', num: 3, price: 100, guard_level: 2 } });
    await new Promise(resolve => setTimeout(resolve, 400));
    ws.close();

    const events = frames.join('').split('\n\n').map(frame => ({ type: frame.match(/^event: (.+)$/m)?.[1], data: frame.match(/^data: ([^\n]+)$/m)?.[1] })).filter(f => f.type);
    assert.deepEqual([...new Set(events.map(e => e.type))].sort(), ['danmaku-history', 'message']);
    assert.equal(JSON.parse(events.find(e => e.type === 'danmaku-history').data)[0].text, '早');
    const messages = events.filter(e => e.type === 'message').map(e => JSON.parse(e.data));
    const chat = messages.find(m => m.type === 'chat');
    assert.equal(chat.guard, 3); assert.equal(chat.medalLevel, 21); assert.equal(chat.medalName, '小萝卜');
    const gift = messages.find(m => m.type === 'gift');
    assert.equal(gift.guard, 2); assert.equal(gift.giftUnit, 100); assert.equal(gift.giftCoin, 'gold');
  } finally { await runtime.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
