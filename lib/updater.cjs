// 推送更新：读腾讯云 COS 上的 latest.json → 验签 → 下载更新包（校验 sha256）→ 交给桌面端去静默安装并重启。
// latest.json = { payload: "<清单 JSON 字符串>", signature: "<Ed25519 签名 base64>" }，签名对 payload 原文。
// 下载地址只认固定的存储桶 + 清单里的相对路径，清单被人换掉也指不到别的网站。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const UPDATE_BASE_URL = 'https://xiaoluobo-update-1300851355.cos.ap-shanghai.myqcloud.com';
const MANIFEST_KEY = 'latest.json';
const APP_ID = 'xiaoluobo-console';
const MAX_DOWNLOAD = 400 * 1024 * 1024;
const VERSION = /^\d+\.\d+\.\d+$/;
const OBJECT_KEY = /^releases\/\d+\.\d+\.\d+\/(update|setup)\.exe$/;

function compareVersions(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
const publicKeyOf = base64 => crypto.createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });

function signManifest(manifest, privateKey) {
  const payload = JSON.stringify(manifest);
  return { payload, signature: crypto.sign(null, Buffer.from(payload), privateKey).toString('base64') };
}

function checkFile(file, kind, version) {
  if (!file || typeof file !== 'object') throw new Error(`更新清单缺少${kind === 'setup' ? '完整安装包' : '更新包'}`);
  const match = OBJECT_KEY.exec(file.key);
  if (!match || match[1] !== kind || !file.key.startsWith(`releases/${version}/`)) throw new Error('更新清单的下载地址无效');
  if (!/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error('更新清单的校验码无效');
  if (!Number.isInteger(file.size) || file.size <= 0 || file.size > MAX_DOWNLOAD) throw new Error('更新清单的文件大小无效');
}
// 验签并检查清单格式，返回清单对象。
function verifyManifest(document, publicKey) {
  if (!document || typeof document.payload !== 'string' || typeof document.signature !== 'string') throw new Error('更新清单格式无效');
  const key = typeof publicKey === 'string' ? publicKeyOf(publicKey) : publicKey;
  let valid = false;
  try { valid = crypto.verify(null, Buffer.from(document.payload), key, Buffer.from(document.signature, 'base64')); } catch {}
  if (!valid) throw new Error('更新清单签名不对，已忽略（可能被篡改）');
  const manifest = JSON.parse(document.payload);
  if (manifest.app !== APP_ID || !VERSION.test(manifest.version)) throw new Error('更新清单内容无效');
  if (typeof manifest.notes !== 'string' || manifest.notes.length > 5000) throw new Error('更新说明无效');
  checkFile(manifest.setup, 'setup', manifest.version);
  if (manifest.update != null) {
    checkFile(manifest.update, 'update', manifest.version);
    if (!Array.isArray(manifest.update.from) || manifest.update.from.some(v => typeof v !== 'string' || !VERSION.test(v))) throw new Error('更新清单的可升级版本无效');
  }
  return manifest;
}

class Updater extends EventEmitter {
  constructor({ currentVersion, publicKey, downloadDir, launch, baseUrl = UPDATE_BASE_URL, fetchImpl = globalThis.fetch, now = Date.now, log = () => {} }) {
    super();
    if (!VERSION.test(currentVersion)) throw new Error('当前版本号无效');
    Object.assign(this, { currentVersion, publicKey: publicKeyOf(publicKey), downloadDir, launch, baseUrl, fetch: fetchImpl, now, log });
    this.state = { supported: true, current: currentVersion, status: 'idle', latest: null, progress: 0, error: '', checked_at: null };
    this.manifest = null; this.busy = null;
  }
  snapshot() { return structuredClone(this.state); }
  set(patch) { Object.assign(this.state, patch); this.emit('state', this.snapshot()); }
  // 有新版本就选包：装的版本在更新包的「可升级版本」里就用 3MB 的更新包，否则用完整安装包。
  pick(manifest) {
    const update = manifest.update?.from.includes(this.currentVersion) ? manifest.update : null;
    return update ? { kind: 'update', file: update } : { kind: 'setup', file: manifest.setup };
  }
  check() {
    if (this.busy) return this.busy;
    if (['downloading', 'installing'].includes(this.state.status)) return Promise.resolve(this.snapshot());
    this.set({ status: 'checking', error: '' });
    this.busy = (async () => {
      try {
        const response = await this.fetch(`${this.baseUrl}/${MANIFEST_KEY}?t=${this.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (response.status === 404) { this.manifest = null; this.set({ status: 'latest', latest: null, checked_at: this.now() }); return this.snapshot(); }
        if (!response.ok) throw new Error(`更新服务器返回 ${response.status}`);
        const text = await response.text();
        if (text.length > 64 * 1024) throw new Error('更新清单过大');
        const manifest = verifyManifest(JSON.parse(text), this.publicKey);
        if (compareVersions(manifest.version, this.currentVersion) <= 0) { this.manifest = null; this.set({ status: 'latest', latest: null, checked_at: this.now() }); return this.snapshot(); }
        this.manifest = manifest;
        const { kind, file } = this.pick(manifest);
        this.set({ status: 'available', latest: { version: manifest.version, notes: manifest.notes, date: manifest.date || '', kind, size: file.size }, progress: 0, checked_at: this.now() });
      } catch (error) {
        this.log('warn', 'update.check_failed', { error });
        this.set({ status: 'error', error: error.name === 'TimeoutError' ? '连接更新服务器超时' : error.message, checked_at: this.now() });
      } finally { this.busy = null; }
      return this.snapshot();
    })();
    return this.busy;
  }
  async download({ kind, file }) {
    await fs.promises.mkdir(this.downloadDir, { recursive: true });
    const target = path.join(this.downloadDir, `小萝卜游戏控制台-v${this.manifest.version}-${kind === 'update' ? '更新包' : 'Setup'}.exe`);
    const hashOf = async name => { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(name)) hash.update(chunk); return hash.digest('hex'); };
    if (await fs.promises.stat(target).then(s => s.size === file.size).catch(() => false) && await hashOf(target) === file.sha256) return target;
    const response = await this.fetch(`${this.baseUrl}/${file.key}`, { cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}）`);
    const part = target + '.part', out = fs.createWriteStream(part), hash = crypto.createHash('sha256');
    let received = 0, lastEmit = 0;
    try {
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > file.size) throw new Error('下载的文件比清单里写的大，已停止');
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
        if (this.now() - lastEmit > 250) { lastEmit = this.now(); this.set({ progress: received / file.size }); }
      }
      await new Promise((resolve, reject) => out.end(error => error ? reject(error) : resolve()));
    } catch (error) { out.destroy(); await fs.promises.rm(part, { force: true }); throw error; }
    if (received !== file.size || hash.digest('hex') !== file.sha256) { await fs.promises.rm(part, { force: true }); throw new Error('下载的文件校验不通过，请重试'); }
    await fs.promises.rename(part, target);
    return target;
  }
  // 下载、校验，然后交给桌面端：关掉控制台、静默安装、装完自动重新打开。
  async install() {
    if (this.state.status !== 'available' && this.state.status !== 'error') throw new Error('现在没有可以安装的新版本');
    if (!this.manifest) throw new Error('请先检查更新');
    const choice = this.pick(this.manifest);
    this.set({ status: 'downloading', progress: 0, error: '' });
    try {
      const file = await this.download(choice);
      this.set({ status: 'installing', progress: 1 });
      await this.launch(file, choice.kind);
    } catch (error) {
      this.log('warn', 'update.install_failed', { error });
      this.set({ status: 'error', error: error.message });
      throw error;
    }
    return this.snapshot();
  }
}

module.exports = { Updater, verifyManifest, signManifest, compareVersions, UPDATE_BASE_URL, MANIFEST_KEY, APP_ID };
