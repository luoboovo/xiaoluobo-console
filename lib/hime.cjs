const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { atomicJson } = require('./storage.cjs');

async function isRunning() {
  const { stdout } = await promisify(execFile)('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 });
  if (!/^"[^"\r\n]+","\d+"/m.test(stdout)) throw new Error('无法确认直播姬是否已退出，请重试');
  return /^"livehime\.exe"/im.test(stdout);
}

function prepare(collection, origin) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('控制台地址无效');
  const data = structuredClone(collection), prefix = `小萝卜 · ${url.port}`;
  if (!Array.isArray(data.sources) || !Array.isArray(data.scene_order)) throw new Error('直播姬场景格式不支持，原文件已保留');
  const layers = [['background', '背景'], ['counter', '桌台'], ['customers', '顾客与投掷']].map(([key, name]) => ({ name: `${prefix} · ${name}`, url: `${url.origin}/noodle/?layer=${key}` }));
  const existing = data.sources.find(s => s.id === 'scene' && s.private_settings?.xiaoluobo_origin === url.origin);
  if (existing) {
    for (const layer of layers) {
      const source = data.sources.find(s => s.name === layer.name);
      if (source?.id !== 'browser_source' || source.settings?.url !== layer.url || !existing.settings?.items?.some(item => item.source_uuid === source.uuid)) throw new Error('已导入的场景被修改，请先在直播姬中移除或改名');
    }
    return { data, sceneName: existing.name, reused: true };
  }
  if (layers.some(layer => data.sources.some(s => s.name === layer.name))) throw new Error('直播姬已有同名素材，请先改名');
  // shortcut: 8.9 的横屏场景使用固定名称，后续版本变更时重新核对原生格式。
  const scene = data.sources.find(s => /^Scene [1-9]\d*$/.test(s.name) && s.id === 'scene' && s.uuid && s.canvas_uuid && Array.isArray(s.settings?.items) && s.settings.items.length === 0 && data.scene_order.some(item => item.name === s.name));
  if (!scene) throw new Error('没有空白横屏场景，请先在直播姬中留出一个空白场景，再退出重试');
  const performer = data.sources.find(s => ['window_capture', 'game_capture'].includes(s.id) && /VTube\s*Studio/i.test(s.settings?.window || ''));
  const performerItem = performer && data.sources.filter(s => s.id === 'scene').flatMap(s => s.settings?.items || []).find(item => item.source_uuid === performer.uuid);
  const itemTemplate = data.sources.filter(s => s.id === 'scene').flatMap(s => s.settings?.items || []).find(item => item.pos && item.scale && item.bounds);
  if (!itemTemplate) throw new Error('直播姬场景格式不支持，原文件已保留');
  const sourceTemplate = { ...scene, private_settings: {} };
  scene.settings.id_counter = 0;
  scene.private_settings = { ...scene.private_settings, xiaoluobo_origin: url.origin };
  for (const [index, layer] of layers.entries()) {
    const source = { ...structuredClone(sourceTemplate), name: layer.name, uuid: randomUUID(), id: 'browser_source', versioned_id: 'browser_source', settings: { is_local_file: false, url: layer.url, width: 1920, height: 1080, fps_custom: true, fps: 30, shutdown: false, restart_when_active: false, reroute_audio: true }, mixers: 0 };
    data.sources.push(source);
    const item = { ...structuredClone(itemTemplate), name: source.name, source_uuid: source.uuid, id: ++scene.settings.id_counter, visible: true, locked: true, rot: 0, align: 5, pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, bounds_type: 2, bounds: { x: 1280, y: 720 }, crop_left: 0, crop_top: 0, crop_right: 0, crop_bottom: 0, private_settings: {} };
    scene.settings.items.push(item);
    if (index === 0 && performerItem) scene.settings.items.push({ ...structuredClone(performerItem), id: ++scene.settings.id_counter });
  }
  return { data, sceneName: scene.name, reused: false, performer: !!performerItem };
}

class HimeIntegration {
  constructor(origin, options = {}) {
    this.origin = origin;
    this.root = options.root || path.join(process.env.LOCALAPPDATA || '', 'bililive', 'User Data');
    this.running = options.running || isRunning;
    this.busy = false;
  }
  async profiles() {
    let entries;
    try { entries = await fs.readdir(this.root, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const profiles = [];
    for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink() && /^[1-9]\d{0,19}$/.test(entry.name)) {
      try { const stat = await fs.lstat(path.join(this.root, entry.name, 'untitledv2.json')); if (stat.isFile() && !stat.isSymbolicLink()) profiles.push({ id: entry.name, at: stat.mtimeMs }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return profiles.sort((a, b) => b.at - a.at).map(({ id }) => ({ id }));
  }
  async status() {
    const profiles = await this.profiles(), running = await this.running();
    return { available: !!profiles.length, running, profiles, message: !profiles.length ? '请先打开直播姬并登录一次' : running ? '请先退出直播姬，再点击原生导入' : '直播姬已退出，可以原生导入' };
  }
  async run(input = {}) {
    if (this.busy) throw new Error('正在导入直播姬，请稍候');
    this.busy = true;
    try {
      if (await this.running()) throw new Error('请先退出直播姬，避免退出保存覆盖新场景');
      const profiles = await this.profiles(), profile = input.profile || profiles[0]?.id;
      if (typeof profile !== 'string' || !profiles.some(item => item.id === profile)) throw new Error('直播姬账号不存在，请先登录一次');
      const file = path.join(this.root, profile, 'untitledv2.json'), before = await fs.readFile(file, 'utf8');
      let data;
      try { data = JSON.parse(before); } catch { throw new Error('直播姬场景文件损坏，原文件已保留'); }
      const prepared = prepare(data, this.origin);
      if (prepared.reused) return { sceneName: prepared.sceneName, reused: true };
      const backup = `${file}.xiaoluobo-${Date.now()}-${randomUUID()}.bak`;
      await fs.copyFile(file, backup, constants.COPYFILE_EXCL);
      if (await this.running() || await fs.readFile(file, 'utf8') !== before) throw new Error('直播姬或场景文件已更新，请退出后重试');
      await atomicJson(file, prepared.data);
      return { sceneName: prepared.sceneName, reused: false, performer: prepared.performer, backup };
    } finally { this.busy = false; }
  }
}
module.exports = { HimeIntegration, prepare };
