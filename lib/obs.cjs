const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

class ObsConnection {
  constructor(port, password, WebSocketImpl = WebSocket) {
    this.pending = new Map();
    this.sequence = 0;
    this.socket = new WebSocketImpl(`ws://127.0.0.1:${port}`);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('OBS 连接超时，请确认已启动并开启 WebSocket 服务')), 5000);
      this.identify = { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } };
    });
    this.socket.addEventListener('message', event => {
      try {
        const { op, d } = JSON.parse(event.data);
        if (op === 0) {
          const identify = { rpcVersion: 1, eventSubscriptions: 0 };
          if (d.authentication) {
            const hash = value => createHash('sha256').update(value).digest('base64');
            identify.authentication = hash(hash(password + d.authentication.salt) + d.authentication.challenge);
          }
          this.socket.send(JSON.stringify({ op: 1, d: identify }));
        } else if (op === 2) { this.identify?.resolve(); this.identify = null; }
        else if (op === 7) {
          const request = this.pending.get(d.requestId);
          if (!request) return;
          this.pending.delete(d.requestId); clearTimeout(request.timer);
          if (d.requestStatus.result) request.resolve(d.responseData || {});
          else request.reject(new Error(`OBS 操作失败：${d.requestType}（${d.requestStatus.code}）`));
        }
      } catch { this.fail(new Error('OBS 返回了无效的数据')); }
    });
    this.socket.addEventListener('error', () => this.fail(new Error('无法连接 OBS，请确认已启动并开启 WebSocket 服务')));
    this.socket.addEventListener('close', event => this.fail(new Error(event.code === 4009 ? 'OBS 密码不正确，请检查手动连接设置' : 'OBS 连接已断开')));
  }
  fail(error) {
    this.identify?.reject(error); this.identify = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
  request(requestType, requestData = {}) {
    if (this.socket.readyState !== 1) return Promise.reject(new Error('OBS 连接已断开'));
    const requestId = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`OBS 操作超时：${requestType}`)); }, 5000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } })); }
      catch { clearTimeout(timer); this.pending.delete(requestId); reject(new Error('OBS 连接已断开')); }
    });
  }
  close() { this.fail(new Error('OBS 连接已结束')); this.socket.close(); }
}

class ObsIntegration {
  constructor(origin, options = {}) {
    this.origin = origin;
    this.prefix = `小萝卜 · ${new URL(origin).port}`;
    this.sceneName = `${this.prefix} · 弹幕面馆`;
    this.configPath = options.configPath || path.join(process.env.APPDATA || '', 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
    this.WebSocketImpl = options.WebSocketImpl;
    this.busy = false;
  }
  async settings(input = {}) {
    if (input.manual === true) {
      if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535 || typeof input.password !== 'string' || input.password.length > 256) throw new Error('请填写有效的 OBS 端口和密码');
      return { port: input.port, password: input.password };
    }
    let config;
    try { config = JSON.parse(await fs.readFile(this.configPath, 'utf8')); }
    catch { throw new Error('未找到 OBS 连接设置，可展开「手动连接」填写端口和密码'); }
    if (!config.server_enabled) throw new Error('请在 OBS「工具 → WebSocket 服务器设置」中开启服务器并点击应用');
    if (!Number.isInteger(config.server_port) || config.server_port < 1024 || config.server_port > 65535) throw new Error('OBS 端口设置无效');
    return { port: config.server_port, password: String(config.server_password || '') };
  }
  async withConnection(input, callback) {
    const { port, password } = await this.settings(input);
    const connection = new ObsConnection(port, password, this.WebSocketImpl);
    try { await connection.ready; return await callback(connection); }
    finally { connection.close(); }
  }
  async status() {
    try { return await this.withConnection({}, async connection => ({ available: true, message: 'OBS 已就绪', version: (await connection.request('GetVersion')).obsVersion })); }
    catch (error) { return { available: false, message: error.message }; }
  }
  async prepare(connection) {
    const call = (type, data) => connection.request(type, data);
    const { scenes, currentProgramSceneName } = await call('GetSceneList');
    const { inputs } = await call('GetInputList');
    const layers = [['background', '背景'], ['counter', '桌台'], ['customers', '顾客']].map(([layer, name]) => ({ name: `${this.prefix} · ${name}`, url: `${this.origin}/noodle/?layer=${layer}` }));
    if (scenes.some(scene => scene.sceneName === this.sceneName)) {
      const { sceneItems } = await call('GetSceneItemList', { sceneName: this.sceneName });
      for (const layer of layers) {
        if (!sceneItems.some(item => item.sourceName === layer.name)) throw new Error('同名面馆场景缺少图层，请在 OBS 中检查场景及同名素材后重试');
        const { inputKind, inputSettings } = await call('GetInputSettings', { inputName: layer.name });
        if (inputKind !== 'browser_source' || inputSettings.url !== layer.url) throw new Error('同名场景或素材已被修改，请在 OBS 中重命名后再导入');
      }
      return { sceneName: this.sceneName, reused: true };
    }
    if (layers.some(layer => inputs.some(input => input.inputName === layer.name))) throw new Error('OBS 中已有同名素材，请重命名后再导入');
    const video = await call('GetVideoSettings');
    if (!Number.isFinite(video.baseWidth) || video.baseWidth <= 0 || !Number.isFinite(video.baseHeight) || video.baseHeight <= 0) throw new Error('无法读取 OBS 画布尺寸');
    const scale = Math.min(video.baseWidth / 1920, video.baseHeight / 1080);
    const transform = { positionX: (video.baseWidth - 1920 * scale) / 2, positionY: (video.baseHeight - 1080 * scale) / 2, scaleX: scale, scaleY: scale, alignment: 5 };
    const { sceneItems: currentItems } = await call('GetSceneItemList', { sceneName: currentProgramSceneName });
    let performer;
    // 只复用明确捕获 VTS 的来源，避免误把主播的其他窗口带进新场景。
    const captures = inputs.filter(item => ['game_capture', 'window_capture'].includes(item.inputKind));
    captures.sort((a, b) => Number(currentItems.some(item => item.sourceName === b.inputName)) - Number(currentItems.some(item => item.sourceName === a.inputName)));
    for (const input of captures) {
      const { inputSettings } = await call('GetInputSettings', { inputName: input.inputName });
      if (/VTube Studio/i.test(inputSettings.window || inputSettings.app_name || '')) { performer = input; break; }
    }
    const createdInputs = [];
    let performerItem;
    await call('CreateScene', { sceneName: this.sceneName });
    try {
      for (const [index, layer] of layers.entries()) {
        if (index === 1 && performer) {
          const existing = currentItems.find(item => item.sourceName === performer.inputName);
          let added;
          if (existing) added = await call('DuplicateSceneItem', { sceneName: currentProgramSceneName, sceneItemId: existing.sceneItemId, destinationSceneName: this.sceneName });
          else added = await call('CreateSceneItem', { sceneName: this.sceneName, sourceName: performer.inputName });
          performerItem = added.sceneItemId;
        }
        const { sceneItemId } = await call('CreateInput', { sceneName: this.sceneName, inputName: layer.name, inputKind: 'browser_source', inputSettings: { url: layer.url, width: 1920, height: 1080, shutdown: false, restart_when_active: false, css: 'body { background-color: rgba(0, 0, 0, 0); margin: 0; overflow: hidden; }' } });
        createdInputs.push(layer.name);
        await call('SetSceneItemTransform', { sceneName: this.sceneName, sceneItemId, sceneItemTransform: transform });
      }
      if (performerItem !== undefined) await call('SetSceneItemIndex', { sceneName: this.sceneName, sceneItemId: performerItem, sceneItemIndex: 1 });
    } catch (error) {
      let clean = true;
      for (const inputName of createdInputs) await call('RemoveInput', { inputName }).catch(() => { clean = false; });
      await call('RemoveScene', { sceneName: this.sceneName }).catch(() => { clean = false; });
      throw new Error(`${error.message}${clean ? '；已撤回本次导入' : '；连接中断，OBS 可能保留了本次未完成的场景'}`);
    }
    return { sceneName: this.sceneName, reused: false, performer: performer?.inputName || '' };
  }
  async run(input, camera = false) {
    if (this.busy) throw new Error('正在处理 OBS 场景，请稍候');
    this.busy = true;
    try {
      return await this.withConnection(input, async connection => {
        const result = await this.prepare(connection);
        if (camera) {
          // shortcut: OBS 公共接口不能指定虚拟摄像机的场景；首次需在 OBS 齿轮中选面馆，接口支持后再自动设置。
          if (!(await connection.request('GetVirtualCamStatus')).outputActive) await connection.request('StartVirtualCam');
          if (!(await connection.request('GetVirtualCamStatus')).outputActive) throw new Error('OBS 虚拟摄像机未启动，请在 OBS 中检查设备');
          result.cameraActive = true;
        }
        return result;
      });
    } finally { this.busy = false; }
  }
}

module.exports = { ObsConnection, ObsIntegration };
