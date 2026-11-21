const { inflateSync, brotliDecompressSync } = require('node:zlib');
const { createHash } = require('node:crypto');

function roomId(input) {
  const text = String(input ?? '').trim();
  let id = text;
  if (!/^\d+$/.test(text)) {
    let url;
    try { url = new URL(text.includes('://') ? text : `https://${text}`); } catch { throw new Error('请输入 B 站直播间地址或房间号'); }
    if (url.hostname !== 'live.bilibili.com' || !['https:', 'http:'].includes(url.protocol)) throw new Error('请输入 B 站直播间地址或房间号');
    id = url.pathname.match(/^\/(?:h5\/)?(\d+)\/?$/)?.[1];
  }
  if (!id || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('房间号无效');
  return Number(id);
}

function signWbi(params, key, now = Date.now()) {
  const values = { ...params, wts: Math.floor(now / 1000) };
  const query = Object.keys(values).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(values[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${createHash('md5').update(query + key).digest('hex')}`;
}

function packet(body, operation, version = 1) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'object' ? JSON.stringify(body) : body);
  const header = Buffer.alloc(16);
  header.writeUInt32BE(payload.length + 16, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(version, 6);
  header.writeUInt32BE(operation, 8);
  header.writeUInt32BE(1, 12);
  return Buffer.concat([header, payload]);
}

function unpack(input, depth = 0) {
  if (depth > 5) throw new Error('直播数据嵌套过深');
  const data = Buffer.from(input), result = [];
  for (let offset = 0; offset < data.length;) {
    if (data.length - offset < 16) throw new Error('直播数据包不完整');
    const length = data.readUInt32BE(offset), header = data.readUInt16BE(offset + 4);
    if (header < 16 || length < header || offset + length > data.length) throw new Error('直播数据包长度无效');
    const version = data.readUInt16BE(offset + 6), operation = data.readUInt32BE(offset + 8);
    const body = data.subarray(offset + header, offset + length);
    if (operation === 5 && (version === 2 || version === 3)) {
      const decoded = (version === 2 ? inflateSync : brotliDecompressSync)(body, { maxOutputLength: 8 * 1024 * 1024 });
      result.push(...unpack(decoded, depth + 1));
    } else result.push({ operation, body });
    offset += length;
  }
  return result;
}

function protobufFields(bytes) {
  const fields = new Map();
  let offset = 0;
  function varint() {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= bytes.length) throw new Error('礼物数据不完整');
      const byte = bytes[offset++];
      result |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return result;
    }
    throw new Error('礼物数据数值无效');
  }
  while (offset < bytes.length) {
    const tag = Number(varint()), field = tag >>> 3, wire = tag & 7;
    if (!field) throw new Error('礼物数据字段无效');
    let value;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const size = Number(varint());
      if (!Number.isSafeInteger(size) || size > bytes.length - offset) throw new Error('礼物数据长度无效');
      value = bytes.subarray(offset, offset + size); offset += size;
    } else if (wire === 1 || wire === 5) { offset += wire === 1 ? 8 : 4; if (offset > bytes.length) throw new Error('礼物数据不完整'); continue; }
    else throw new Error('不支持的礼物数据字段');
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push(value);
  }
  return fields;
}

function giftV2(base64) {
  const top = protobufFields(Buffer.from(base64, 'base64'));
  const text = (fields, id) => fields.get(id)?.[0]?.toString('utf8') || '';
  const number = (fields, id, fallback = 0) => Number(fields.get(id)?.[0] ?? fallback);
  const blind = top.get(9)?.[0] ? protobufFields(top.get(9)[0]) : new Map();
  return (top.get(10) || []).map(bytes => {
    const item = protobufFields(bytes);
    return { user: text(top, 2), uid: number(top, 1), face: text(top, 3), giftId: number(item, 1), giftName: text(item, 2), count: number(item, 3, 1), transactionId: text(item, 9) || text(item, 12), blindGiftName: text(blind, 3) };
  });
}

// B站回复弹幕的“@谁”不在正文里，而在 info[0][15].extra（JSON 字符串）的 reply_uname / reply_mid。
function danmuReply(extra) {
  let data = extra;
  if (typeof extra === 'string') { try { data = JSON.parse(extra); } catch { return null; } }
  const name = typeof data?.reply_uname === 'string' ? data.reply_uname.trim().slice(0, 100) : '';
  return name ? { name, uid: Number(data.reply_mid) || 0 } : null;
}
// 统一的 @ 信息：优先用平台给出的回复对象，否则识别正文开头手打的“@昵称”。
function mentionOf(text, reply) {
  if (reply?.name) return { mention: { name: String(reply.name).slice(0, 100), uid: reply.uid || 0 } };
  const name = String(text || '').match(/^\s*[@＠]([^\s@＠]{1,40})/)?.[1];
  return name ? { mention: { name, uid: 0 } } : {};
}
// INTERACT_WORD_V2：uid=1, uname=2, msg_type=5。
// 观众戴的粉丝牌：牌子属于哪个主播（UID）、哪个直播间。没戴牌子返回 undefined。
function medalOf(targetId, roomId, name) {
  const target = Number(targetId) || 0, room = Number(roomId) || 0;
  if (!(target > 0) && !(room > 0)) return undefined;
  return { targetId: Number.isSafeInteger(target) ? target : 0, roomId: Number.isSafeInteger(room) ? room : 0, name: String(name || '').slice(0, 20) };
}
function interactV2(base64) {
  const top = protobufFields(Buffer.from(base64, 'base64'));
  // 字段 9 是粉丝牌：1 主播 UID，3 牌子名，12 主播直播间。
  let medal;
  try { const raw = top.get(9)?.[0]; if (Buffer.isBuffer(raw) && raw.length) { const m = protobufFields(raw); medal = medalOf(m.get(1)?.[0], m.get(12)?.[0], m.get(3)?.[0]?.toString('utf8')); } } catch {}
  return { uid: Number(top.get(1)?.[0] ?? 0), user: top.get(2)?.[0]?.toString('utf8') || '', type: Number(top.get(5)?.[0] ?? 0), ...(medal ? { medal } : {}) };
}

function imageUrl(input) {
  try {
    const url = new URL(input);
    if (url.protocol === 'https:' && (url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com'))) return url.href;
  } catch {}
  return '';
}

function mergeGifts(stored, incoming, now = new Date().toISOString()) {
  const gifts = new Map(stored.flatMap(g => {
    const { alias_ids = [], ...gift } = g;
    return [gift, ...(Array.isArray(alias_ids) ? alias_ids : []).map(id => ({ ...gift, id }))];
  }).map(g => [g.id, g]));
  for (const item of incoming) {
    const id = Number(item.id), price = Number(item.price);
    if (!Number.isSafeInteger(id) || id <= 0 || typeof item.name !== 'string' || !item.name.trim() || !Number.isFinite(price) || price < 0) continue;
    const old = gifts.get(id);
    gifts.set(id, { id, name: item.name.slice(0, 100), price, coinType: item.coin_type === 'silver' ? 'silver' : 'gold', icon: imageUrl(item.img_basic || item.img_dynamic || item.icon) || old?.icon || '', updatedAt: now });
  }
  return [...gifts.values()].sort((a, b) => a.price - b.price || a.id - b.id);
}

function paidGifts(list) {
  const groups = new Map();
  for (const gift of [...list].sort((a, b) => a.id - b.id)) {
    if (!Number.isSafeInteger(gift.id) || gift.id < 1 || typeof gift.name !== 'string' || !gift.name.trim() || !Number.isFinite(gift.price) || gift.price <= 0 || (gift.coinType !== undefined && gift.coinType !== 'gold')) continue;
    const name = gift.name.trim(), key = JSON.stringify([name, gift.price]);
    const ids = [gift.id, ...(Array.isArray(gift.alias_ids) ? gift.alias_ids : [])].filter(id => Number.isSafeInteger(id) && id > 0);
    const old = groups.get(key);
    if (old) old.alias_ids = [...new Set([...(old.alias_ids || []), ...ids])].filter(id => id !== old.id);
    else groups.set(key, { ...gift, name, icon: imageUrl(gift.icon), coinType: 'gold', ...(ids.length > 1 ? { alias_ids: [...new Set(ids)].filter(id => id !== gift.id) } : {}) });
  }
  return [...groups.values()].sort((a, b) => a.price - b.price || a.id - b.id);
}

// 弹幕里的表情图：只认 B站 / 抖音官方图床的 https 地址（弹幕姬画面的安全策略也只放行这几个）。
function chatImage(input) {
  try {
    const url = new URL(String(input || '').replace(/^http:/, 'https:'));
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password && ['hdslb.com', 'biliimg.com', 'douyinpic.com', 'byteimg.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return url.href;
  } catch {}
  return '';
}
const size = value => { const n = Math.round(Number(value) || 0); return n > 0 && n <= 1000 ? n : 0; };
// 表情包（整条弹幕就是一张图）：{ url, alt, width, height }。
function sticker(url, alt, width, height) {
  const src = chatImage(url);
  return src ? { sticker: { url: src, alt: String(alt || '表情').slice(0, 40), width: size(width), height: size(height) } } : {};
}
// 带小表情的文字：[{ text }, { img, alt }]，没有图片就不返回（照常显示纯文字）。
function richOf(segments) {
  const out = [];
  for (const segment of segments) {
    if (out.length >= 60) break;
    if (segment.img) { const img = chatImage(segment.img); if (img) { out.push({ img, alt: String(segment.alt || '').slice(0, 40) }); continue; } }
    const text = String(segment.text ?? segment.alt ?? '');
    if (!text) continue;
    if (out.length && out.at(-1).text !== undefined) out.at(-1).text += text; else out.push({ text });
  }
  return out.some(segment => segment.img) ? { rich: out } : {};
}
// B站弹幕：info[0][12]=1 是表情包弹幕，图在 info[0][13]；文字里的 [dog] 这类小表情在 info[0][15].extra 的 emots 里。
function biliEmotes(info, text) {
  const meta = Array.isArray(info?.[0]) ? info[0] : [];
  if (Number(meta[12]) === 1 && meta[13] && typeof meta[13] === 'object') {
    const found = sticker(meta[13].url, text, meta[13].width, meta[13].height);
    if (found.sticker) return found;
  }
  let extra = meta[15]?.extra;
  if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch { extra = null; } }
  const emots = extra?.emots && typeof extra.emots === 'object' ? extra.emots : null;
  const keys = emots ? Object.keys(emots).filter(key => key && text.includes(key) && emots[key]?.url).sort((a, b) => b.length - a.length).slice(0, 30) : [];
  if (!keys.length) return {};
  const pattern = new RegExp(keys.map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const segments = []; let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    segments.push({ img: emots[match[0]].url, alt: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return richOf(segments);
}

module.exports = { medalOf, roomId, signWbi, packet, unpack, protobufFields, giftV2, danmuReply, mentionOf, interactV2, imageUrl, mergeGifts, paidGifts, chatImage, sticker, richOf, biliEmotes };
