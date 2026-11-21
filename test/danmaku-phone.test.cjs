const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { settingsOf } = require('../lib/danmaku.cjs');
const { decodeFrame, field, varint } = require('../lib/douyin.cjs');
const { startServer } = require('../server.cjs');

test('弹幕姬手机样式设置：默认 iPhone、群名空着、身份标签全显示；非法值退回默认', () => {
  const d = settingsOf({});
  assert.equal(d.device, 'iphone'); assert.equal(d.group, ''); assert.equal(d.badges, true);
  assert.equal(settingsOf({ device: 'android' }).device, 'android');
  assert.equal(settingsOf({ device: 'none' }).device, 'none');
  assert.equal(settingsOf({ device: 'nokia' }).device, 'iphone');
  assert.equal(settingsOf({ group: '  萝卜家族群  ' }).group, '萝卜家族群');
  assert.equal(settingsOf({ group: '群'.repeat(40) }).group.length, 30);
  assert.equal(settingsOf({ badges: false }).badges, false);
  assert.equal(settingsOf({ badges: 'no' }).badges, true);
});

test('B站弹幕带上荣耀等级（消费等级）和会员；礼物带上粉丝牌和消费等级；画面拿到直播间标题', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-phone-'));
  const runtime = await startServer({ featuresOn: true, dataDir: dir, seedDir: dir });
  t.after(async () => { await runtime.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const got = []; runtime.services.on('event', event => got.push(event));
  const info = [[], '舰长打卡', [7, '萝卜', 0, 1, 1], [21, '小萝卜', '主播', 6, 0, 0, 0, 0, 0, 0, 3, 1, 99], [], 0, 0, 3, null, null, null, null, null, null, null, null, [36]];
  runtime.services.liveMessage({ cmd: 'DANMU_MSG', info });
  runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[], '普通人', [8, '路人'], [], [], 0, 0, 0] });
  runtime.services.liveMessage({ cmd: 'SEND_GIFT', data: { uname: '送礼的', uid: 9, giftId: 31036, giftName: '小花花', num: 1, price: 100, coin_type: 'gold', guard_level: 0, medal_info: { medal_level: 15, medal_name: '小萝卜' }, wealth_level: 12, tid: 'x1' } });
  assert.equal(got[0].wealthLevel, 36); assert.equal(got[0].vip, 2, '年费会员优先'); assert.equal(got[0].guard, 3); assert.equal(got[0].medalLevel, 21);
  assert.equal(got[1].wealthLevel, undefined); assert.equal(got[1].vip, undefined);
  const gift = got.find(e => e.type === 'gift');
  assert.equal(gift.medalLevel, 15); assert.equal(gift.medalName, '小萝卜'); assert.equal(gift.wealthLevel, 12);
  runtime.services.state.live.title = '小萝卜的直播间'; runtime.services.publish();
  const state = await (await fetch(runtime.url + '/api/danmaku/state')).json();
  assert.equal(state.liveTitle, '小萝卜的直播间');
  assert.equal(state.settings.device, 'iphone');
});

test('抖音观众带上消费等级（pay_grade.level）', () => {
  const numeric = (key, value) => Buffer.concat([varint(key * 8), varint(value)]);
  const person = Buffer.concat([numeric(1, 1001), field(3, '抖音大哥'), field(21, Buffer.concat([field(3, '等级'), numeric(6, 27)])), field(22, field(1, Buffer.concat([field(1, '萝卜团'), numeric(2, 9)])))]);
  const envelope = Buffer.concat([field(1, 'WebcastChatMessage'), field(2, Buffer.concat([field(2, person), field(3, '来了')])), numeric(3, 7)]);
  const frame = Buffer.concat([numeric(2, 1), field(7, 'msg'), field(8, gzipSync(field(1, envelope)))]);
  const [chat] = decodeFrame(frame).messages;
  assert.equal(chat.wealthLevel, 27); assert.equal(chat.fansLevel, 9); assert.equal(chat.fansClub, '萝卜团');
  const plain = Buffer.concat([numeric(1, 1002), field(3, '路人')]);
  const [other] = decodeFrame(Buffer.concat([numeric(2, 1), field(7, 'msg'), field(8, gzipSync(field(1, Buffer.concat([field(1, 'WebcastChatMessage'), field(2, Buffer.concat([field(2, plain), field(3, '嗨')])), numeric(3, 8)]))))])).messages;
  assert.equal(other.wealthLevel, undefined);
});
