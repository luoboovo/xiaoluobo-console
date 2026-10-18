const { imageType } = require('./image-type.cjs');

function safeFace(input) {
  if (typeof input !== 'string' || !input || input.length > 2048) return '';
  try {
    const url = new URL(String(input).replace(/^http:/, 'https:'));
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && ['hdslb.com', 'biliimg.com', 'douyinpic.com', 'byteimg.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return url.href;
  } catch {}
  return '';
}

// shortcut: 共享头像缓存上限128张/16MB，超大直播间再改磁盘缓存。
function createAvatarCache(services, { maxItems = 128, maxBytes = 16 * 1024 * 1024 } = {}) {
  const avatars = new Map();
  const prune = () => {
    const now = Date.now(); let bytes = 0;
    for (const [face, cached] of avatars) {
      if (cached.expires <= now) avatars.delete(face);
      else bytes += cached.bytes || 0;
    }
    for (const [face, cached] of avatars) {
      if (avatars.size <= maxItems && bytes <= maxBytes) break;
      avatars.delete(face); bytes -= cached.bytes || 0;
    }
  };
  const get = face => {
    let cached = avatars.get(face);
    if (cached && Date.now() >= cached.expires) { avatars.delete(face); cached = null; }
    if (!cached) {
      const fetch = /\.(douyinpic|byteimg)\.com\//.test(face) ? services.douyinRequest(face) : services.request(face);
      cached = { expires: Date.now() + 600000, image: fetch.then(({ body }) => {
        const type = imageType(body);
        if (!type || body.length > 1024 * 1024) throw new Error('头像图片无效或过大');
        cached.bytes = body.length; prune();
        return { body, type };
      }) };
      avatars.set(face, cached);
      cached.image.catch(() => { cached.expires = Date.now() + 30000; });
    } else { avatars.delete(face); avatars.set(face, cached); }
    prune();
    return cached.image;
  };
  return { get, prune, clear: () => avatars.clear() };
}

module.exports = { safeFace, createAvatarCache };
