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

module.exports = { roomId, signWbi, packet, unpack, protobufFields, giftV2, imageUrl, mergeGifts, paidGifts };
