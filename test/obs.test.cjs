const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ObsIntegration } = require('../lib/obs.cjs');
const { startServer } = require('../server.cjs');

async function fixture(t, { failure, authFailure = false, cameraFailure = false, width = 1920, height = 1080 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-obs-'));
  const configPath = path.join(dir, 'obs.json');
  await fs.writeFile(configPath, JSON.stringify({ server_enabled: true, server_port: 4455, server_password: 'supersecretpassword' }));
  const calls = [], sockets = [], scenes = new Map([['直播原场景', [{ sceneItemId: 1, sourceName: '我的猫', sceneItemTransform: { positionX: 372, positionY: 136 } }]]]);
  const inputs = new Map([['我的猫', { inputKind: 'game_capture', inputSettings: { window: 'VTube Studio:UnityWndClass:VTube Studio.exe' } }]]);
  let camera = false, nextItem = 2;
  class FakeSocket extends EventTarget {
    constructor(url) {
      super(); assert.equal(url, 'ws://127.0.0.1:4455'); this.readyState = 0; sockets.push(this);
      setImmediate(() => { this.readyState = 1; this.reply(0, { rpcVersion: 1, authentication: { salt: 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=', challenge: '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=' } }); });
    }
    reply(op, d) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ op, d }) })); }
    send(text) {
      const { op, d } = JSON.parse(text);
      if (op === 1) {
        assert.equal(d.authentication, '1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=');
        assert.equal(d.eventSubscriptions, 0);
        setImmediate(() => authFailure ? this.close(4009) : this.reply(2, { negotiatedRpcVersion: 1 })); return;
      }
      assert.equal(op, 6); calls.push(d);
      const p = d.requestData;
      let responseData = {}, failed = d.requestType === failure;
      if (!failed) switch (d.requestType) {
        case 'GetVersion': responseData = { obsVersion: '32.0.0' }; break;
        case 'GetSceneList': responseData = { scenes: [...scenes.keys()].map(sceneName => ({ sceneName })), currentProgramSceneName: '直播原场景' }; break;
        case 'GetInputList': responseData = { inputs: [...inputs].map(([inputName, input]) => ({ inputName, inputKind: input.inputKind })) }; break;
        case 'GetVideoSettings': responseData = { baseWidth: width, baseHeight: height }; break;
        case 'GetSceneItemList': responseData = { sceneItems: scenes.get(p.sceneName) }; break;
        case 'GetInputSettings': responseData = inputs.get(p.inputName); break;
        case 'CreateScene': assert.ok(!scenes.has(p.sceneName)); scenes.set(p.sceneName, []); break;
        case 'DuplicateSceneItem': {
          const copy = structuredClone(scenes.get(p.sceneName).find(item => item.sceneItemId === p.sceneItemId)); copy.sceneItemId = nextItem++;
          scenes.get(p.destinationSceneName).push(copy); responseData = { sceneItemId: copy.sceneItemId }; break;
        }
        case 'CreateInput': {
          assert.ok(!inputs.has(p.inputName)); inputs.set(p.inputName, { inputKind: p.inputKind, inputSettings: p.inputSettings });
          const sceneItemId = nextItem++; scenes.get(p.sceneName).push({ sourceName: p.inputName, sceneItemId }); responseData = { sceneItemId }; break;
        }
        case 'SetSceneItemTransform': scenes.get(p.sceneName).find(item => item.sceneItemId === p.sceneItemId).sceneItemTransform = p.sceneItemTransform; break;
        case 'SetSceneItemIndex': { const items = scenes.get(p.sceneName); const [item] = items.splice(items.findIndex(item => item.sceneItemId === p.sceneItemId), 1); items.splice(p.sceneItemIndex, 0, item); break; }
        case 'RemoveInput': inputs.delete(p.inputName); break;
        case 'RemoveScene': scenes.delete(p.sceneName); break;
        case 'GetVirtualCamStatus': responseData = { outputActive: camera }; break;
        case 'StartVirtualCam': if (!cameraFailure) camera = true; break;
        default: throw new Error(`测试未处理请求 ${d.requestType}`);
      }
      setImmediate(() => this.reply(7, { requestType: d.requestType, requestId: d.requestId, requestStatus: { result: !failed, code: failed ? 500 : 100 }, responseData }));
    }
    close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; const event = new Event('close'); event.code = code; this.dispatchEvent(event); }
  }
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, configPath, calls, scenes, inputs, sockets, FakeSocket, integration: new ObsIntegration('http://127.0.0.1:3181', { configPath, WebSocketImpl: FakeSocket }) };
}

test('OBS：认证校验、高清三层、保留人物变换和当前直播，重复导入不重建', async t => {
  const f = await fixture(t), original = structuredClone(f.scenes.get('直播原场景'));
  const status = await f.integration.status(); assert.equal(status.available, true); assert.equal(status.version, '32.0.0'); assert.doesNotMatch(JSON.stringify(status), /secret/);
  const result = await f.integration.run({}); assert.equal(result.performer, '我的猫');
  const items = f.scenes.get(result.sceneName);
  assert.deepEqual(items.map(item => item.sourceName), ['小萝卜 · 3181 · 背景', '我的猫', '小萝卜 · 3181 · 桌台', '小萝卜 · 3181 · 顾客']);
  assert.deepEqual(items[1].sceneItemTransform, original[0].sceneItemTransform);
  const browser = f.inputs.get(items[2].sourceName); assert.equal(browser.inputSettings.width, 1920); assert.equal(browser.inputSettings.height, 1080); assert.equal(browser.inputSettings.url, 'http://127.0.0.1:3181/noodle/?layer=counter');
  const repeated = await f.integration.run({}); assert.equal(repeated.reused, true); assert.equal(f.calls.filter(call => call.requestType === 'CreateScene').length, 1);
  assert.deepEqual(f.scenes.get('直播原场景'), original); assert.equal(f.calls.some(call => ['SetCurrentProgramScene', 'StartStream', 'SetVideoSettings', 'SetInputSettings'].includes(call.requestType)), false);
  assert.ok(f.sockets.every(socket => socket.readyState === 3));
});

test('OBS：导入中途失败只撤回新场景和新素材，保留原来源', async t => {
  const f = await fixture(t, { failure: 'SetSceneItemTransform' });
  await assert.rejects(f.integration.run({}), /已撤回本次导入/);
  assert.deepEqual([...f.scenes.keys()], ['直播原场景']); assert.deepEqual([...f.inputs.keys()], ['我的猫']);
  assert.ok(f.sockets.every(socket => socket.readyState === 3)); assert.equal(f.integration.busy, false);
});

test('OBS：无 VTS 时导入三层，非横屏画布等比居中，不修改输出尺寸', async t => {
  const f = await fixture(t, { width: 1080, height: 1920 }); f.inputs.clear();
  const result = await f.integration.run({}); assert.equal(result.performer, '');
  const items = f.scenes.get(result.sceneName); assert.equal(items.length, 3);
  for (const item of items) assert.deepEqual(item.sceneItemTransform, { positionX: 0, positionY: 656.25, scaleX: 0.5625, scaleY: 0.5625, alignment: 5 });
});

test('OBS：同名来源冲突不覆盖；密码错误不报告连接成功', async t => {
  const f = await fixture(t); f.inputs.set('小萝卜 · 3181 · 背景', { inputKind: 'image_source', inputSettings: { file: '用户图片.png' } });
  await assert.rejects(f.integration.run({}), /同名素材/); assert.equal(f.scenes.size, 1); assert.equal(f.calls.some(call => call.requestType.startsWith('Create')), false);
  const wrong = await fixture(t, { authFailure: true }); const status = await wrong.integration.status(); assert.equal(status.available, false); assert.match(status.message, /密码/);
});

test('OBS：禁用服务提示首次设置；手动连接拒绝非法端口和密码', async t => {
  const f = await fixture(t); await fs.writeFile(f.configPath, JSON.stringify({ server_enabled: false, server_port: 4455 }));
  await assert.rejects(f.integration.run({}), /开启服务器/); assert.equal(f.sockets.length, 0);
  for (const port of [0, 80, 65536, 4455.5, '4455']) await assert.rejects(f.integration.run({ manual: true, port, password: '' }), /有效/);
  await assert.rejects(f.integration.run({ manual: true, port: 4455, password: 'a'.repeat(257) }), /有效/);
  await f.integration.run({ manual: true, port: 4455, password: 'supersecretpassword' }); assert.equal(f.scenes.size, 2);
});

test('OBS：虚拟摄像机重复启动幂等，启动失败不报告成功', async t => {
  const f = await fixture(t); assert.equal((await f.integration.run({}, true)).cameraActive, true); await f.integration.run({}, true);
  assert.equal(f.calls.filter(call => call.requestType === 'StartVirtualCam').length, 1);
  const bad = await fixture(t, { cameraFailure: true }); await assert.rejects(bad.integration.run({}, true), /虚拟摄像机未启动/);
});

test('OBS HTTP 入口：跨来源拒绝，输出不含密码，导入绑定控制台当前地址', async t => {
  const f = await fixture(t); const runtime = await startServer({ dataDir: f.dir, seedDir: f.dir, obsOptions: { configPath: f.configPath, WebSocketImpl: f.FakeSocket } });
  try {
    const denied = await fetch(runtime.url + '/api/obs/import', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.com' }, body: '{}' }); assert.equal(denied.status, 403); assert.equal(f.scenes.size, 1);
    const response = await fetch(runtime.url + '/api/obs/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.ok, true); assert.doesNotMatch(JSON.stringify(result), /secret|password/i);
    const source = [...f.inputs.values()].find(input => input.inputKind === 'browser_source'); assert.ok(source.inputSettings.url.startsWith(runtime.url + '/'));
  } finally { await runtime.close(); }
});
