const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { HimeIntegration, prepare } = require('../lib/hime.cjs');
const { startServer } = require('../server.cjs');
const fixture = require('./fixtures/hime-v8.json');

test('直播姬原生场景：高清三层、保留原场景音频、不依赖 OBS、重复导入不重建', () => {
  const original = structuredClone(fixture), result = prepare(original, 'http://127.0.0.1:3181');
  assert.deepEqual(original, fixture); assert.equal(result.sceneName, 'Scene 1');
  assert.equal(result.data.current_scene, 'Scene 2');
  assert.deepEqual(result.data['Mic/Aux'], fixture['Mic/Aux']); assert.deepEqual(result.data['Desktop Audio'], fixture['Desktop Audio']);
  assert.deepEqual(result.data.sources.slice(1, 4), fixture.sources.slice(1));
  const scene = result.data.sources[0]; assert.equal(scene.settings.items.length, 3);
  const sources = result.data.sources.slice(-3);
  assert.deepEqual(sources.map(s => s.settings.url), ['background', 'counter', 'customers'].map(layer => 'http://127.0.0.1:3181/noodle/?layer=' + layer));
  for (const source of sources) { assert.equal(source.id, 'browser_source'); assert.equal(source.settings.width, 1920); assert.equal(source.settings.height, 1080); assert.equal(source.canvas_uuid, 'main-canvas'); }
  assert.equal(prepare(result.data, 'http://127.0.0.1:3181').reused, true);
  const changed = structuredClone(result.data); changed.sources.at(-1).settings.url = 'http://127.0.0.1:3181/';
  assert.throws(() => prepare(changed, 'http://127.0.0.1:3181'), /被修改/);
  for (const origin of ['https://evil.com', 'http://127.0.0.1:3181/?x=1', 'http://user:pass@127.0.0.1:3181']) assert.throws(() => prepare(fixture, origin), /地址无效/);
});

test('直播姬：复用 VTS 人物及其位置，来源冲突和无空白场景不覆盖', () => {
  const data = structuredClone(fixture), person = { name: '人物', uuid: 'vts', id: 'game_capture', settings: { window: 'VTube Studio:UnityWndClass:VTube Studio.exe' } };
  const item = { ...data.sources[1].settings.items[0], name: person.name, source_uuid: person.uuid };
  data.sources.push(person); data.sources[1].settings.items.push(item);
  const result = prepare(data, 'http://127.0.0.1:3181');
  assert.equal(result.performer, true); assert.deepEqual(result.data.sources[0].settings.items.map(i => i.name), ['小萝卜 · 3181 · 背景', '人物', '小萝卜 · 3181 · 桌台', '小萝卜 · 3181 · 顾客与投掷']);
  assert.deepEqual(result.data.sources[0].settings.items[1].pos, item.pos);
  const full = structuredClone(data); full.sources[0].settings.items.push(item);
  assert.throws(() => prepare(full, 'http://127.0.0.1:3181'), /没有空白/);
  data.sources.push({ name: '小萝卜 · 3181 · 背景', id: 'image_source' });
  assert.throws(() => prepare(data, 'http://127.0.0.1:3181'), /同名/);
});

test('直播姬本机导入：运行中拒绝、备份原文、账号验证、变化保护和 HTTP 来源校验', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoluobo-hime-')), profile = '12345', account = path.join(dir, profile), file = path.join(account, 'untitledv2.json');
  await fs.mkdir(account); const before = JSON.stringify(fixture, null, 2) + '\n'; await fs.writeFile(file, before);
  let running = true;
  const hime = new HimeIntegration('http://127.0.0.1:3181', { root: dir, running: async () => running });
  let runtime;
  try {
    assert.equal((await hime.status()).running, true);
    await assert.rejects(hime.run({ profile }), /退出直播姬/); assert.equal(await fs.readFile(file, 'utf8'), before);
    running = false;
    await assert.rejects(hime.run({ profile: '../12345' }), /账号不存在/);
    const result = await hime.run({ profile }); assert.equal(await fs.readFile(result.backup, 'utf8'), before);
    assert.equal((await hime.run({ profile })).reused, true);
    await fs.writeFile(file, before); let checks = 0;
    const changed = new HimeIntegration('http://127.0.0.1:3181', { root: dir, running: async () => ++checks > 1 });
    await assert.rejects(changed.run({ profile }), /已更新/); assert.equal(await fs.readFile(file, 'utf8'), before);
    runtime = await startServer({ dataDir: path.join(dir, 'app'), seedDir: path.join(dir, 'app'), himeOptions: { root: dir, running: async () => false } });
    const status = await (await fetch(runtime.url + '/api/hime/status')).json(); assert.deepEqual(status.profiles, [{ id: profile }]);
    const post = (body, origin) => fetch(runtime.url + '/api/hime/import', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
    assert.equal((await post({ profile }, 'https://evil.com')).status, 403); assert.equal(await fs.readFile(file, 'utf8'), before);
    const imported = await (await post({ profile })).json(); assert.equal(imported.ok, true);
    const native = JSON.parse(await fs.readFile(file, 'utf8')); assert.ok(native.sources.some(s => s.settings?.url === runtime.url + '/noodle/?layer=counter'));
  } finally { await runtime?.close(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); assert.match(path.basename(dir), /^xiaoluobo-hime-/); await fs.rm(dir, { recursive: true, force: true }); }
});
