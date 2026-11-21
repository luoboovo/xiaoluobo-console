const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { atomicJson, readJson } = require('./storage.cjs');

// 公网只读访问：单独开一个端口给外面看画面和状态，只认 GET，凭访问码进入；本机控制台端口不受影响。
const COOKIE = 'luobo_view';
const DEFAULT_PORT = 3190;
// 这些接口就算只读也不给外面：导出文件、诊断日志、配置、更新、公网设置本身。
const BLOCKED = [/^\/api\/diagnostics\//, /\/export$/, /^\/api\/config\//, /^\/api\/update\//, /^\/api\/public-view$/, /^\/api\/(obs|hime)\//];

const newToken = () => crypto.randomBytes(18).toString('base64url');
const sameToken = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validPort = port => Number.isInteger(port) && port >= 1024 && port <= 65535;

function cookieToken(header) {
  for (const part of String(header || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return rest.join('=');
  }
  return '';
}

function lanAddresses() {
  const list = [];
  for (const entries of Object.values(os.networkInterfaces())) for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) list.push(entry.address);
  return list;
}

class PublicView {
  constructor(dataDir) { this.file = path.join(dataDir, 'public-view.json'); this.settings = { enabled: false, port: DEFAULT_PORT, token: '' }; }
  async init() {
    const stored = await readJson(this.file, {});
    this.settings = { enabled: stored.enabled === true, port: validPort(stored.port) ? stored.port : DEFAULT_PORT, token: typeof stored.token === 'string' && stored.token.length >= 16 ? stored.token : newToken() };
    if (stored.token !== this.settings.token) await this.save();
    return this;
  }
  save() { return atomicJson(this.file, this.settings); }
  async update(input = {}) {
    const next = { ...this.settings };
    if (input.enabled !== undefined) next.enabled = input.enabled === true;
    if (input.port !== undefined) { const port = Number(input.port); if (!validPort(port)) throw new Error('端口需在 1024～65535 之间'); next.port = port; }
    if (input.resetToken) next.token = newToken();
    const previous = this.settings; this.settings = next;
    try { await this.save(); } catch (error) { this.settings = previous; throw error; }
    return next;
  }
  // 访问码可以放在 ?key= 里（第一次打开、OBS 浏览器源），也可以来自之前存下的 Cookie。
  authorize(req, url) {
    const fromQuery = url.searchParams.get('key');
    if (sameToken(fromQuery, this.settings.token)) return 'query';
    return sameToken(cookieToken(req.headers.cookie), this.settings.token) ? 'cookie' : null;
  }
  cookie() { return `${COOKIE}=${this.settings.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`; }
  blocked(pathname) { return BLOCKED.some(pattern => pattern.test(pathname)); }
  snapshot(running, error) {
    const { enabled, port, token } = this.settings;
    return { enabled, port, running: !!running, error: error || '', links: lanAddresses().map(ip => `http://${ip}:${port}/?key=${token}`) };
  }
}

module.exports = { PublicView, cookieToken, DEFAULT_PORT };
