const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { startServer } = require('../server.cjs');
const { publicFile } = require('../lib/static-files.cjs');
const { DanmakuBoard } = require('../lib/danmaku.cjs');

const IMAGE = '/api/feeding/assets/' + 'a'.repeat(64) + '.png';
const frames = list => list.join('').split('\n\n').map(frame => ({ type: frame.match(/^event: (.+)$/m)?.[1], data: frame.match(/^data: ([^\n]+)$/m)?.[1] })).filter(f => f.type);
async function listen(runtime) {
  const ws = new WebSocket(runtime.url.replace('http', 'ws') + '/api/events/socket?danmaku=1', { origin: runtime.url });
  const got = [];
  ws.on('message', data => got.push(String(data)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { got, close: () => ws.close() };
}

test('弹幕姬：画面页面可访问，只收弹幕消息，带上舰长、粉丝牌和礼物单价', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-danmaku-'));
  const runtime = await startServer({ featuresOn: true, dataDir: dir, seedDir: dir });
  try {
    assert.equal(publicFile('/danmaku/'), 'danmaku/overlay.html');
    assert.equal(publicFile('/danmaku/overlay.js'), 'danmaku/overlay.js');
    assert.equal(publicFile('/danmaku/../server.cjs'), null);
    assert.equal((await fetch(runtime.url + '/danmaku/')).status, 200);
    runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[], '早', [7, '旧消息']] });

    const socket = await listen(runtime);
    runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[], '舰长来了', [1, '萝卜'], [21, '小萝卜', '主播', 6, 0, 0, 0, 0, 0, 0, 3, 1, 99], 0, 0, 0, 3] });
    runtime.services.liveMessage({ cmd: 'SEND_GIFT', data: { uname: '观众', uid: 2, giftId: 1, giftName: '小花花', num: 3, price: 100, guard_level: 2 } });
    await new Promise(resolve => setTimeout(resolve, 400));
    socket.close();

    const events = frames(socket.got);
    assert.deepEqual([...new Set(events.map(e => e.type))].sort(), ['danmaku', 'danmaku-history', 'message']);
    assert.equal(JSON.parse(events.find(e => e.type === 'danmaku').data).enabled, true);
    assert.equal(JSON.parse(events.find(e => e.type === 'danmaku-history').data)[0].text, '早');
    const messages = events.filter(e => e.type === 'message').map(e => JSON.parse(e.data));
    const chat = messages.find(m => m.type === 'chat');
    assert.equal(chat.guard, 3); assert.equal(chat.medalLevel, 21); assert.equal(chat.medalName, '小萝卜');
    const gift = messages.find(m => m.type === 'gift');
    assert.equal(gift.guard, 2); assert.equal(gift.giftUnit, 100); assert.equal(gift.giftCoin, 'gold');
  } finally { await runtime.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('弹幕姬：总开关关着时画面收不到消息，口令也不生效', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-danmaku-'));
  const runtime = await startServer({ dataDir: dir, seedDir: dir });
  try {
    assert.equal((await fetch(runtime.url + '/danmaku/bubbles/luobo.png')).headers.get('content-type'), 'image/png');
    const socket = await listen(runtime);
    runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[], '切换萝卜专属气泡', [5, '萝卜']] });
    await new Promise(resolve => setTimeout(resolve, 300));
    let events = frames(socket.got);
    assert.equal(JSON.parse(events.find(e => e.type === 'danmaku').data).enabled, false);
    assert.equal(events.filter(e => e.type === 'message').length, 0);
    assert.equal(runtime.services.events[0].bubbleCommand, undefined);

    const on = await (await fetch(runtime.url + '/api/features', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'danmaku', enabled: true }) })).json();
    assert.equal(on.features.find(f => f.id === 'danmaku').enabled, true);
    runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[], '切换萝卜专属气泡', [5, '萝卜']] });
    runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[], '换好啦', [5, '萝卜']] });
    await new Promise(resolve => setTimeout(resolve, 300));
    socket.close();
    events = frames(socket.got);
    const messages = events.filter(e => e.type === 'message').map(e => JSON.parse(e.data));
    assert.match(messages[0].bubbleCommand.text, /萝卜专属气泡/);
    assert.equal(messages[1].bubble, 'luobo');
    const state = await (await fetch(runtime.url + '/api/danmaku/state')).json();
    assert.equal(state.bubbles[0].id, 'luobo'); assert.equal(state.bubbles[0].builtin, true); assert.equal(state.bubbles[0].users, 1);
    assert.equal(state.users, undefined);
  } finally { await runtime.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('定制气泡：口令切换、换回默认、权限、名字口令不能重复、存盘后还在', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-danmaku-'));
  try {
    const board = await new DanmakuBoard(dir).init();
    assert.deepEqual(board.state.bubbles.map(b => b.keyword), ['切换萝卜专属气泡', '切换诉诉专属气泡'], '内置萝卜、诉诉专属气泡');
    await board.action({ action: 'delete_bubble', id: 'luobo' });
    await board.action({ action: 'delete_bubble', id: 'susu' });
    assert.equal((await new DanmakuBoard(dir).init()).state.bubbles.length, 0, '删掉的内置气泡不会再冒出来');
    await assert.rejects(board.action({ action: 'save_bubble', bubble: { name: '没图' } }), /上传气泡图片/);
    await assert.rejects(board.action({ action: 'save_bubble', bubble: { name: '挤', image: IMAGE, box: { left: 60, right: 40 } } }), /文字区太小/);
    await board.action({ action: 'save_bubble', bubble: { name: '萝卜专属', keyword: '切换萝卜专属气泡', image: IMAGE } });
    await board.action({ action: 'save_bubble', bubble: { name: '舰长皮', image: IMAGE, who: 'guard' } });
    await assert.rejects(board.action({ action: 'save_bubble', bubble: { name: '萝卜专属', image: IMAGE } }), /已经用了/);
    const [robo, captain] = board.state.bubbles;
    assert.equal(captain.keyword, '切换舰长皮');

    const viewer = { type: 'chat', uid: 9, platform: 'bilibili', user: '萝卜' };
    assert.equal(board.command({ ...viewer, text: '随便说说' }), null);
    assert.equal(board.command({ ...viewer, text: ' 切换萝卜专属气泡 ' }).bubble, robo.id);
    assert.equal(board.bubbleFor(viewer), robo.id);
    assert.match(board.command({ ...viewer, text: '切换舰长皮' }).text, /舰长及以上/);
    assert.equal(board.bubbleFor(viewer), robo.id);
    assert.equal(board.command({ ...viewer, guard: 3, text: '切换舰长皮' }).bubble, captain.id);
    assert.equal(board.bubbleFor({ ...viewer, guard: 3 }), captain.id);
    assert.equal(board.bubbleFor(viewer), '', '舰长过期后不再显示舰长专属气泡');
    assert.match(board.command({ ...viewer, text: '切换默认气泡' }).text, /默认/);
    assert.equal(board.bubbleFor(viewer), '');
    board.command({ type: 'chat', uid: 0, user: '游客', text: '切换萝卜专属气泡' });
    assert.equal(board.bubbleFor({ uid: 0, user: '游客' }), robo.id);
    await board.saving;

    const again = await new DanmakuBoard(dir).init();
    assert.equal(again.bubbleFor({ uid: 0, user: '游客' }), robo.id);
    assert.equal(again.snapshot().bubbles[0].users, 1);
    await again.action({ action: 'delete_bubble', id: robo.id });
    assert.equal(again.bubbleFor({ uid: 0, user: '游客' }), '');
    await again.action({ action: 'background', background: { image: 'https://evil.com/x.png', fit: 'custom', scale: 999 } });
    assert.equal(again.state.background.image, ''); assert.equal(again.state.background.scale, 400);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('诉诉专属气泡：老用户升级后补上并排在最前，两端固定、中段平铺的设置能存住', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-danmaku-'));
  try {
    await fs.writeFile(path.join(dir, 'danmaku.json'), JSON.stringify({ version: 1, bubbles: [{ id: 'luobo', name: '萝卜专属气泡', keyword: '切换萝卜专属气泡', image: '/danmaku/bubbles/luobo.png' }], seeded: ['luobo'] }));
    const board = await new DanmakuBoard(dir).init();
    assert.deepEqual(board.state.bubbles.map(b => b.id), ['susu', 'luobo']);
    const susu = board.state.bubbles[0];
    assert.equal(susu.image, '/danmaku/bubbles/susu.png'); assert.equal(susu.tile, true);
    assert.ok(susu.cap.left > susu.box.left && susu.cap.right > susu.box.right, '两端（人物、小兔子）比文字区宽，文字可以伸进两端空着的气泡');
    assert.ok(susu.cap.left + susu.cap.right < 95);
    assert.equal(board.command({ type: 'chat', uid: 7, platform: 'douyin', user: '诉诉', text: '切换诉诉专属气泡' }).bubble, 'susu');
    await board.action({ action: 'save_bubble', bubble: { ...susu, font: 120 } });
    const again = await new DanmakuBoard(dir).init();
    assert.deepEqual(again.state.bubbles[0].cap, susu.cap); assert.equal(again.state.bubbles[0].tile, true); assert.equal(again.state.bubbles[0].font, 120);
    assert.equal(again.state.bubbles.length, 2, '删过或补过的内置气泡不会重复冒出来');
    await assert.rejects(board.action({ action: 'save_bubble', bubble: { name: '太宽', image: IMAGE, cap: { left: 60, right: 50 } } }), /两端太宽/);
    assert.ok(publicFile('/danmaku/bubbles/susu.png'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
