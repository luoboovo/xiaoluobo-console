const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { roomId } = require('./protocol.cjs');
const { atomicJson, readJson } = require('./services.cjs');
const { LiveRobot } = require('./robot.cjs');
const { RoomLink } = require('./room-link.cjs');

const MAX_ROOMS = 5;
const shortId = room => { try { return Number(roomId(room)) || 0; } catch { return 0; } };

// 多直播间机器人：主直播间就是控制台连接的那个（原来的机器人）；
// 另外最多加 5 个 B站直播间，每个有自己的连接和自己的一套机器人设置（人设、表情、礼物档位、欢迎语、盲盒记录……），
// 都用控制台登录的同一个 B站账号发言，AI 的 Key 大家共用。
class RobotRooms extends EventEmitter {
  constructor({ services, dataDir, main, robotOptions = {}, createLink = room => new RoomLink(services, room) }) {
    super();
    this.services = services; this.dataDir = dataDir; this.main = main; this.robotOptions = robotOptions; this.createLink = createLink;
    this.file = path.join(dataDir, 'robot-rooms.json'); this.extra = new Map(); this.stamp = '';
  }
  async init() {
    const saved = await readJson(this.file, null);
    for (const item of Array.isArray(saved?.rooms) ? saved.rooms.slice(0, MAX_ROOMS) : []) {
      if (!/^room-\d+$/.test(item?.id) || !shortId(item.room) || this.extra.has(item.id)) continue;
      try { await this.open(item); } catch (error) { this.services.diagnostics?.log('warn', 'robot_rooms.open_failed', { error }); }
    }
    return this;
  }
  dirOf(id) { return path.join(this.dataDir, 'robot-rooms', id); }
  async open({ id, room, connect }) {
    const dir = this.dirOf(id);
    await fs.mkdir(dir, { recursive: true });
    const link = this.createLink(String(room));
    const robot = await new LiveRobot(dir, { ...this.robotOptions, services: link }).init();
    const entry = { id, room: String(room), connect: !!connect, link, robot };
    link.on('event', event => robot.receive(event));
    link.on('state', () => this.changed());
    robot.on('state', state => { this.emit('robot', id, state); this.changed(); });
    this.extra.set(id, entry);
    if (entry.connect) this.connect(entry).catch(() => {});
    return entry;
  }
  // 连接失败时错误留在这个直播间的状态里，页面上能看到。
  async connect(entry) {
    try { await entry.link.connectLive(entry.room); }
    finally { this.changed(); }
  }
  entry(id) {
    const entry = this.extra.get(id);
    if (!entry) throw new Error('没有这个直播间，可能已经删掉了');
    return entry;
  }
  robotFor(id) { return !id || id === 'main' ? this.main : this.entry(id).robot; }
  list() {
    const live = this.services.state.live;
    return [
      { id: 'main', main: true, room: this.services.state.config.room || '', platform: this.services.platform, status: live.status, title: live.title || '', error: live.error || '', enabled: !!this.main.config.enabled },
      ...[...this.extra.values()].map(({ id, room, link, robot }) => ({ id, main: false, room, platform: 'bilibili', status: link.state.live.status, title: link.state.live.title || '', error: link.state.live.error || '', enabled: !!robot.config.enabled })),
    ];
  }
  // 列表有变化（连上、断开、改名、启停机器人）才通知页面。
  changed() {
    const list = this.list(), stamp = JSON.stringify(list);
    if (stamp === this.stamp) return;
    this.stamp = stamp; this.emit('rooms', list);
  }
  save() {
    this.saving = Promise.resolve(this.saving).then(() => atomicJson(this.file, { version: 1, rooms: [...this.extra.values()].map(({ id, room, connect }) => ({ id, room, connect })) }));
    return this.saving;
  }
  async action(input = {}) {
    let result = {};
    switch (input.action) {
      case 'list': break;
      case 'add': {
        if (this.extra.size >= MAX_ROOMS) throw new Error(`最多再加 ${MAX_ROOMS} 个直播间`);
        const room = String(input.room || '').trim(), short = Number(roomId(room));
        const id = `room-${short}`;
        if (this.extra.has(id)) throw new Error('这个直播间已经加过了');
        const live = this.services.state.live;
        if (this.services.platform === 'bilibili' && (shortId(this.services.state.config.room) === short || Number(live.roomId) === short)) throw new Error('这是控制台正在连接的主直播间，不用再加');
        const file = path.join(this.dirOf(id), 'robot.json');
        const restored = await fs.access(file).then(() => true, () => false);
        // 第一次加这个直播间：照抄当前选中直播间的机器人设置，先不启动，改好人设、表情再开。
        // 以前加过又删掉的：用它原来的设置和记录。
        if (!restored) {
          const source = this.robotFor(input.copy_from || 'main');
          await fs.mkdir(this.dirOf(id), { recursive: true });
          await atomicJson(file, { ...structuredClone(source.config), enabled: false });
        }
        await this.open({ id, room, connect: true });
        await this.save();
        result = { id, restored };
        break;
      }
      case 'connect': {
        const entry = this.entry(input.id);
        entry.connect = true; await this.save();
        await this.connect(entry);
        break;
      }
      case 'disconnect': {
        const entry = this.entry(input.id);
        entry.connect = false; entry.link.disconnectLive(); await this.save();
        break;
      }
      // 删掉只是不再连接；这个直播间的设置和盲盒记录留在磁盘上，下次加回来还在。
      case 'remove': {
        const entry = this.entry(input.id);
        this.extra.delete(entry.id);
        entry.link.close(); await entry.robot.close(); await this.save();
        break;
      }
      default: throw new Error('未知的直播间操作');
    }
    this.changed();
    return { rooms: this.list(), ...result };
  }
  async close() {
    for (const entry of this.extra.values()) { entry.link.close(); await entry.robot.close(); }
    await this.saving;
  }
}

module.exports = { RobotRooms, MAX_ROOMS };
