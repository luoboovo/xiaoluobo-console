const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { deflateSync, brotliCompressSync } = require('node:zlib');
const { roomId, packet, unpack, giftV2, mergeGifts, paidGifts, signWbi } = require('../lib/protocol.cjs');
const { ConsoleServices, atomicJson } = require('../lib/services.cjs');
const { startServer } = require('../server.cjs');

test('房间号和链接：支持短号，拒绝其他站点和无效值', () => {
  assert.equal(roomId(' 6 '), 6);
  assert.equal(roomId('https://live.bilibili.com/6?broadcast_type=0'), 6);
  assert.equal(roomId('live.bilibili.com/h5/7734200'), 7734200);
  for (const input of ['', '0', '-1', '9007199254740992', 'https://evil.com/live.bilibili.com/6', 'https://live.bilibili.com.evil.com/6']) assert.throws(() => roomId(input));
});

test('直播协议：混合消息、zlib、brotli 与恶意长度', () => {
  const first = packet({ cmd: 'DANMU_MSG', info: [[], '你好', [1, '小萝卜']] }, 5, 0);
  const second = packet({ cmd: 'SEND_GIFT', data: { giftId: 1, num: 2 } }, 5, 0);
  for (const compressed of [Buffer.concat([first, second]), packet(deflateSync(Buffer.concat([first, second])), 5, 2), packet(brotliCompressSync(Buffer.concat([first, second])), 5, 3)]) {
    const messages = unpack(compressed); assert.equal(messages.length, 2); assert.equal(JSON.parse(messages[0].body).cmd, 'DANMU_MSG');
  }
  assert.throws(() => unpack(first.subarray(0, 20)));
  const invalid = Buffer.from(first); invalid.writeUInt16BE(0, 4); assert.throws(() => unpack(invalid));
});

test('礼物库：保留历史礼物，更新图片，拒绝不可信 URL', () => {
  const old = [{ id: 1, name: '旧礼物', price: 1, coinType: 'gold', icon: 'https://i0.hdslb.com/old.png' }, { id: 2, name: '保留礼物', price: 2, icon: '' }];
  const merged = mergeGifts(old, [{ id: 1, name: '新礼物', price: 100, img_basic: 'https://i0.hdslb.com/new.png' }, { id: 3, name: '测试', price: 0, img_basic: 'http://127.0.0.1/secret' }, { id: -1, name: '无效', price: 0 }]);
  assert.equal(merged.length, 3); assert.equal(merged.find(g => g.id === 1).icon, 'https://i0.hdslb.com/new.png'); assert.equal(merged.find(g => g.id === 3).icon, ''); assert.ok(merged.find(g => g.id === 2));
});

test('付费礼物筛选：零价与银瓜子移除，同名同价合并，不同价格保留',()=>{
  const base={name:'花',price:100,coinType:'gold',icon:''};
  const list=paidGifts([{...base,id:2},{...base,id:1},{...base,id:3,price:200},{...base,id:4,price:0},{...base,id:5,coinType:'silver'},{...base,id:6,price:NaN}]);
  assert.equal(list.length,2);assert.equal(list[0].id,1);assert.deepEqual(list[0].alias_ids,[2]);assert.equal(list[1].price,200);
  const synced=paidGifts(mergeGifts(list,[{id:2,name:'花',price:300,coin_type:'gold'},{id:4,name:'免费',price:0,coin_type:'gold'}]));
  assert.equal(synced.length,3);assert.equal(synced.find(g=>g.id===1).alias_ids,undefined);assert.equal(synced.find(g=>g.id===2).price,300);assert.equal(synced.some(g=>g.id===4),false);
});

test('清理礼物库持久保存并备份，同步后免费礼物不会回流，重复ID图片与消息兼容',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-paid-'));
  const original={updatedAt:'old',list:[{id:1,name:'付费花',price:100,coinType:'gold',icon:'https://i0.hdslb.com/flower.png'},{id:2,name:'付费花',price:100,coinType:'gold',icon:'https://i0.hdslb.com/another.png'},{id:3,name:'免费花',price:0,coinType:'silver',icon:''}]};
  await atomicJson(path.join(dir,'gifts.json'),original);const png=Buffer.from([137,80,78,71,13,10,26,10]);let images=0;
  const service=await new ConsoleServices({dataDir:dir,seedDir:dir,requestImpl:async url=>url.includes('giftConfig')?{body:Buffer.from(JSON.stringify({code:0,data:{list:[{id:2,name:'付费花',price:100,coin_type:'gold'},{id:3,name:'免费花',price:0,coin_type:'silver'}]}})),headers:{}}:(images++,{body:png,headers:{}})}).init();
  try {
    assert.equal(service.gifts.length,1);assert.deepEqual(service.gifts[0].alias_ids,[2]);assert.deepEqual(await fs.readFile(path.join(dir,'gifts.before-paid-v2.0.6.json'),'utf8').then(JSON.parse),original);
    await service.giftImage(1);await service.giftImage(2);assert.equal(images,1);
    service.addGift({giftId:2,count:1,uid:1});assert.equal(service.events[0].giftId,2);assert.deepEqual(service.events[0].giftAliases,[1,2]);
    const shop=new (require('../lib/noodle.cjs').NoodleShop)(dir);shop.mode='running';shop.config.gift_id=1;shop.config.water_gift=null;
    await shop.receive(service.events[0]);assert.equal(shop.queue.length,1);
    await service.syncGifts();assert.equal(service.gifts.length,1);assert.equal(service.gifts.some(g=>g.price<=0||g.coinType==='silver'),false);
    const reload=await new ConsoleServices({dataDir:dir,seedDir:dir}).init();assert.equal(reload.gifts.length,1);reload.close();
  } finally {service.close();const absolute=path.resolve(dir);if(!absolute.startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-paid-'))throw new Error('清理路径无效');await fs.rm(absolute,{recursive:true,force:true});}
});

test('新版礼物 protobuf：多个礼物与截断检查', () => {
  const str = (tag, text) => { const b = Buffer.from(text); return Buffer.concat([Buffer.from([tag * 8 + 2, b.length]), b]); };
  const item = Buffer.concat([Buffer.from([8, 1]), str(2, '小花花'), Buffer.from([24, 3])]);
  const pb = Buffer.concat([str(2, '小萝卜'), Buffer.from([82, item.length]), item, Buffer.from([82, item.length]), item]);
  assert.deepEqual(giftV2(pb.toString('base64')), Array.from({ length: 2 }, () => ({ user: '小萝卜', uid: 0, face: '', giftId: 1, giftName: '小花花', count: 3, transactionId: '', blindGiftName: '' })));
  assert.throws(() => giftV2(pb.subarray(0, -1).toString('base64')));
});

test('WBI 签名稳定且不修改输入', () => {
  const params = { foo: "a!b'c(d)*", id: 6 };
  assert.equal(signWbi(params, 'test', 100000), signWbi({ id: 6, foo: 'abcd' }, 'test', 100000));
  assert.equal(params.wts, undefined); assert.match(signWbi(params, 'test', 100000), /w_rid=[a-f0-9]{32}$/);
});

test('本机服务：数据读写、配置验证、跨来源保护与断线状态', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-test-'));
  await atomicJson(path.join(dir, 'gifts.json'), { list: [{ id: 1, name: '小花花', price: 100, coinType: 'gold', icon: '' }], updatedAt: null });
  const runtime = await startServer({ dataDir: dir, seedDir: dir });
  try {
    const response = await fetch(runtime.url); assert.equal(response.status, 200); assert.match(await response.text(), /小萝卜游戏控制台/);
    const icon = await fetch(runtime.url + '/app-icon.png'); assert.equal(icon.status, 200); assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await icon.arrayBuffer()).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const gifts = await (await fetch(runtime.url + '/api/gifts')).json(); assert.equal(gifts.length, 1);
    const wrongOrigin = await fetch(runtime.url + '/api/live/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.com' }, body: '{}' }); assert.equal(wrongOrigin.status, 403);
    for (const action of ['connect', 'disconnect']) {
      const removed = await fetch(runtime.url + '/api/vts/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(removed.status, 404);
    }
    const importResponse = await fetch(runtime.url + '/api/config/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: 'xiaoluobo-console', version: 1, room: '6', vtsPort: 8002 }) }); assert.equal(importResponse.status, 200);
    const data = await (await fetch(runtime.url + '/api/config/export')).json(); assert.equal(data.room, '6'); assert.equal(data.vtsPort, undefined); assert.equal(data.cookie, undefined);
    assert.equal(runtime.services.state.vts, undefined);
    const roomOnly = await fetch(runtime.url + '/api/config/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: 'xiaoluobo-console', version: 1, room: '7' }) }); assert.equal(roomOnly.status, 200);
    const invalid = await fetch(runtime.url + '/api/config/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: 'xiaoluobo-console', version: 1, room: 'https://evil.com/7' }) }); assert.equal(invalid.status, 400);
    runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[], '<script>', [1, '萝卜']] }); runtime.services.liveMessage({ cmd: 'SEND_GIFT', data: { uname: '观众', giftId: 1, giftName: '小花花', num: 3 } });
    assert.equal(runtime.services.state.stats.chat, 1); assert.equal(runtime.services.state.stats.gift, 3); assert.equal(runtime.services.events[0].giftId, 1);
    runtime.services.disconnectLive(); assert.equal(runtime.services.state.live.status, 'disconnected');
  } finally { await runtime.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('同步失败不会清空原礼物库；相同图片只下载一次', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-test-'));
  await atomicJson(path.join(dir, 'gifts.json'), { list: [{ id: 1, name: '花', price: 1, icon: 'https://i0.hdslb.com/test.png' }], updatedAt: null });
  let calls = 0;
  const service = await new ConsoleServices({ dataDir: dir, seedDir: dir, requestImpl: async url => { calls++; if (url.includes('giftConfig')) throw new Error('网络断开'); return { body: Buffer.from([137,80,78,71,13,10,26,10]), headers: { 'content-type': 'png' } }; } }).init();
  try {
    await assert.rejects(service.syncGifts(), /网络断开/); assert.equal(service.gifts.length, 1); assert.equal(service.state.gifts.syncing, false);
    await Promise.all([service.giftImage(1), service.giftImage(1)]); assert.equal(calls, 2);
    await service.giftImage(1); assert.equal(calls, 2);
  } finally { service.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('B站：游客 WBI 凭证、服务器认证和取消重连', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-test-'));
  let socket;
  class FakeSocket extends EventTarget {
    constructor() { super(); this.readyState = 0; this.sent = []; socket = this; setImmediate(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  }
  const requestImpl = async url => {
    const endpoint = new URL(url).pathname;
    const data = endpoint.endsWith('/room_init') ? { room_id: 7734200, live_status: 1 } : endpoint.endsWith('/get_info') ? { title: '测试直播间' } : endpoint.endsWith('/spi') ? { b_3: 'test-buvid' } : endpoint.endsWith('/nav') ? { isLogin: false, wbi_img: { img_url: 'https://i0.hdslb.com/' + 'a'.repeat(32) + '.png', sub_url: 'https://i0.hdslb.com/' + 'b'.repeat(32) + '.png' } } : { token: 'test-key', host_list: [{ host: 'test.chat.bilibili.com', wss_port: 2245 }] };
    return { body: Buffer.from(JSON.stringify({ code: endpoint.endsWith('/nav') ? -101 : 0, data })), headers: {} };
  };
  const service = await new ConsoleServices({ dataDir: dir, seedDir: dir, requestImpl, WebSocketImpl: FakeSocket }).init();
  try {
    await service.connectLive('6'); assert.equal(service.state.live.status, 'connecting');
    await new Promise(resolve => setImmediate(resolve));
    const auth = JSON.parse(unpack(socket.sent[0])[0].body); assert.equal(auth.uid, 0); assert.equal(auth.key, 'test-key'); assert.equal(auth.buvid, 'test-buvid');
    socket.dispatchEvent(new MessageEvent('message', { data: packet({ code: 0 }, 8) })); assert.equal(service.state.live.status, 'connected'); assert.equal(unpack(socket.sent[1])[0].operation, 2);
    socket.close(); assert.equal(service.state.live.status, 'reconnecting');
    service.disconnectLive(); assert.equal(service.state.live.status, 'disconnected'); assert.equal(service.liveTarget, null);
    socket.dispatchEvent(new MessageEvent('message', { data: packet({ code: 0 }, 8) })); assert.equal(service.state.live.status, 'disconnected');
  } finally { service.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
