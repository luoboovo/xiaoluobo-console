const path = require('node:path');
const { readJson, atomicJson } = require('./storage.cjs');

// 记住主直播间「要不要连着」：点了连接就记下，下次打开控制台自动连回去；只有点「断开」才忘掉。
// B站和抖音分开记。连不上（比如刚开机网络还没好）会隔一会儿再试几次。
class LiveMemory {
  constructor(services, { retryDelay = 15000, retries = 3, diagnostics } = {}) {
    this.services = services; this.retryDelay = retryDelay; this.retries = retries; this.diagnostics = diagnostics;
    this.file = path.join(services.dataDir, 'live-connect.json'); this.wanted = {}; this.timer = null; this.closed = false;
  }
  async init() {
    const saved = await readJson(this.file, null);
    for (const platform of ['bilibili', 'douyin']) if (saved?.[platform] === true) this.wanted[platform] = true;
    return this;
  }
  isWanted(platform = this.services.platform) { return this.wanted[platform] === true; }
  async remember(on, platform = this.services.platform) {
    if (!on) this.stop();
    if (this.isWanted(platform) === on) return;
    this.wanted = { ...this.wanted, [platform]: on };
    await atomicJson(this.file, { version: 1, ...this.wanted }).catch(error => this.diagnostics?.log('warn', 'live.remember_failed', { error }));
  }
  stop() { clearTimeout(this.timer); this.timer = null; }
  // 打开控制台、切换平台后调用：上次连着就自动连回去。
  resume(left = this.retries) {
    this.stop();
    const { services } = this, platform = services.platform, room = services.state.config.room;
    if (this.closed || !this.isWanted(platform) || !room) return;
    if (['connected', 'connecting', 'reconnecting'].includes(services.state.live.status)) return;
    services.connectLive(room).catch(error => {
      this.diagnostics?.log('warn', 'live.auto_connect_failed', { platform, left, error });
      if (left > 0 && !this.closed && services.platform === platform && this.isWanted(platform)) {
        this.timer = setTimeout(() => this.resume(left - 1), this.retryDelay); this.timer.unref?.();
      }
    });
  }
  close() { this.closed = true; this.stop(); }
}

module.exports = { LiveMemory };
