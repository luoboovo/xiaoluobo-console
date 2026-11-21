const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { biliEmotes, chatImage, richOf } = require('../lib/protocol.cjs');
const { decodeFrame, field, varint } = require('../lib/douyin.cjs');
const { startServer } = require('../server.cjs');

test('表情图地址只认 B站 / 抖音图床，http 改成 https', () => {
  assert.equal(chatImage('http://i0.hdslb.com/bfs/live/a.png'), 'https://i0.hdslb.com/bfs/live/a.png');
  assert.equal(chatImage('https://p3-webcast.douyinpic.com/img/e.png~tplv.image'), 'https://p3-webcast.douyinpic.com/img/e.png~tplv.image');
  for (const bad of ['https://evil.com/a.png', 'https://hdslb.com.evil.com/a.png', 'javascript:alert(1)', 'https://i0.hdslb.com:8443/a.png', 'data:image/png;base64,AA', '', null]) assert.equal(chatImage(bad), '', String(bad));
  assert.deepEqual(richOf([{ text: '只有字' }]), {});
  assert.deepEqual(richOf([{ text: 'a' }, { img: 'https://evil.com/x.png', alt: '[x]' }, { text: 'b' }]), {}, '图片地址不合格就当文字');
});

test('B站表情包弹幕：dm_type=1 的整条弹幕是一张图', () => {
  const info = [[0, 1, 25, 16777215, 0, 0, 0, '', 0, 0, 0, '', 1, { emoticon_unique: 'room_1_2', url: 'http://i0.hdslb.com/bfs/live/zan.png', width: 162, height: 162 }, '{}', {}], '赞', [1, '萝卜']];
  assert.deepEqual(biliEmotes(info, '赞'), { sticker: { url: 'https://i0.hdslb.com/bfs/live/zan.png', alt: '赞', width: 162, height: 162 } });
  info[0][13].url = 'https://evil.com/zan.png';
  assert.deepEqual(biliEmotes(info, '赞'), {}, '不合格的图不显示成表情包');
});

test('B站文字里的小表情：按 emots 换成图片，其他文字保留', () => {
  const extra = JSON.stringify({ emots: {
    '[dog]': { url: 'http://i0.hdslb.com/bfs/live/dog.png', width: 20, height: 20 },
    '[dog][妙]': { url: 'http://i0.hdslb.com/bfs/live/combo.png' },
    '[妙]': { url: 'http://i0.hdslb.com/bfs/live/miao.png' },
    '[坏]': { url: 'https://evil.com/bad.png' }
  } });
  const info = [[0, 1, 25, 0, 0, 0, 0, '', 0, 0, 0, '', 0, '{}', '{}', { extra }], '', [1, '萝卜']];
  assert.deepEqual(biliEmotes(info, '主播[dog]好[妙]啊[妙]'), { rich: [
    { text: '主播' }, { img: 'https://i0.hdslb.com/bfs/live/dog.png', alt: '[dog]' }, { text: '好' },
    { img: 'https://i0.hdslb.com/bfs/live/miao.png', alt: '[妙]' }, { text: '啊' }, { img: 'https://i0.hdslb.com/bfs/live/miao.png', alt: '[妙]' }
  ] });
  assert.deepEqual(biliEmotes(info, '[dog][妙]'), { rich: [{ img: 'https://i0.hdslb.com/bfs/live/combo.png', alt: '[dog][妙]' }] }, '长的名字优先');
  assert.deepEqual(biliEmotes(info, '坏[坏]'), {}, '图不合格就照常显示文字');
  assert.deepEqual(biliEmotes(info, '没有表情'), {});
  assert.deepEqual(biliEmotes([[0, 1, 25, 0, 0, 0, 0, '', 0, 0, 0, '', 0, '{}', '{}', { extra: '坏的 json' }]], '[dog]'), {});
  assert.deepEqual(biliEmotes([], '[dog]'), {});
});

// 抖音 protobuf：Text.pieces(4)，piece.string_value(11) / image_value(25).image(1).url_list(1)
const numeric = (key, value) => Buffer.concat([varint(key * 8), varint(value)]);
const person = Buffer.concat([numeric(1, 1001), field(3, '抖音观众'), field(9, field(1, 'https://p3.douyinpic.com/face.png'))]);
const textPiece = value => field(4, field(11, value));
const imagePiece = (url, size = 0) => field(4, field(25, field(1, Buffer.concat([field(1, url), ...(size ? [numeric(3, size), numeric(4, size)] : [])]))));
const frameOf = (method, body) => {
  const envelope = Buffer.concat([field(1, method), field(2, body), numeric(3, 7)]);
  return Buffer.concat([numeric(2, 1), field(7, 'msg'), field(8, gzipSync(Buffer.concat([field(1, envelope)])))]);
};

test('抖音评论里的小表情：富文本图片片段换成小图，替代文字用正文里的表情名', () => {
  const rtf = Buffer.concat([textPiece('好看'), imagePiece('https://p3-webcast.douyinpic.com/img/wx.png'), textPiece('！'), imagePiece('https://p3-webcast.douyinpic.com/img/bx.png')]);
  const [chat] = decodeFrame(frameOf('WebcastChatMessage', Buffer.concat([field(2, person), field(3, '好看[微笑]！[比心]'), field(22, rtf)]))).messages;
  assert.equal(chat.text, '好看[微笑]！[比心]');
  assert.deepEqual(chat.rich, [{ text: '好看' }, { img: 'https://p3-webcast.douyinpic.com/img/wx.png', alt: '[微笑]' }, { text: '！' }, { img: 'https://p3-webcast.douyinpic.com/img/bx.png', alt: '[比心]' }]);
  const [plain] = decodeFrame(frameOf('WebcastChatMessage', Buffer.concat([field(2, person), field(3, '纯文字')]))).messages;
  assert.equal(plain.rich, undefined);
});

test('抖音表情包消息：WebcastEmojiChatMessage 显示成一张图', () => {
  const body = Buffer.concat([field(2, person), numeric(3, 66), field(4, imagePiece('https://p3-webcast.douyinpic.com/img/sticker.gif', 120)), field(5, '[666]')]);
  const [chat] = decodeFrame(frameOf('WebcastEmojiChatMessage', body)).messages;
  assert.equal(chat.type, 'chat'); assert.equal(chat.user, '抖音观众'); assert.equal(chat.text, '[666]');
  assert.deepEqual(chat.sticker, { url: 'https://p3-webcast.douyinpic.com/img/sticker.gif', alt: '[666]', width: 120, height: 120 });
  const [noImage] = decodeFrame(frameOf('WebcastEmojiChatMessage', Buffer.concat([field(2, person), numeric(3, 66)]))).messages;
  assert.equal(noImage.text, '[表情]'); assert.equal(noImage.sticker, undefined);
});

test('B站带表情的弹幕进事件时带上表情，文字照旧（游戏口令不受影响）', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-emote-'));
  const runtime = await startServer({ dataDir: dir, seedDir: dir });
  t.after(async () => { await runtime.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const got = [];runtime.services.on('event', event => got.push(event));
  runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[0, 1, 25, 0, 0, 0, 0, '', 0, 0, 0, '', 1, { url: 'http://i0.hdslb.com/bfs/live/call.png', width: 100, height: 100 }], '打call', [5, '萝卜']] });
  runtime.services.liveMessage({ cmd: 'DANMU_MSG', info: [[0, 1, 25, 0, 0, 0, 0, '', 0, 0, 0, '', 0, '{}', '{}', { extra: JSON.stringify({ emots: { '[dog]': { url: 'http://i0.hdslb.com/bfs/live/dog.png' } } }) }], '冲[dog]', [6, '土豆']] });
  assert.equal(got[0].text, '打call'); assert.equal(got[0].sticker.url, 'https://i0.hdslb.com/bfs/live/call.png');
  assert.equal(got[1].text, '冲[dog]'); assert.equal(got[1].rich[1].img, 'https://i0.hdslb.com/bfs/live/dog.png');
});
