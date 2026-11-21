const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { signManifest } = require('../lib/updater.cjs');
const { readUploadFolder, publishFolder, checkCredentials } = require('../lib/cos.cjs');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const md5 = data => crypto.createHash('md5').update(data).digest('hex');
const SETUP = Buffer.alloc(4000, 3), UPDATE = Buffer.from('update-package');

// 造一个「腾讯云上传-v3.8.0」文件夹（和打包脚本生成的一样）。
async function folder(t, { withUpdate = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-upload-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'releases', '3.8.0'), { recursive: true });
  await fs.writeFile(path.join(dir, 'releases', '3.8.0', 'setup.exe'), SETUP);
  if (withUpdate) await fs.writeFile(path.join(dir, 'releases', '3.8.0', 'update.exe'), UPDATE);
  const manifest = { app: 'xiaoluobo-console', version: '3.8.0', date: '2026-11-21', notes: '测试版本',
    setup: { key: 'releases/3.8.0/setup.exe', sha256: sha(SETUP), size: SETUP.length },
    update: withUpdate ? { key: 'releases/3.8.0/update.exe', sha256: sha(UPDATE), size: UPDATE.length, from: ['3.7.5'] } : null };
  await fs.writeFile(path.join(dir, 'latest.json'), JSON.stringify(signManifest(manifest, privateKey), null, 2));
  return dir;
}
// 假的腾讯云：PUT 存进 store，HEAD / GET 从 store 读。
function fakeCloud(store = new Map()) {
  const puts = [];
  const put = async (_credentials, key, { file, body, onProgress }) => {
    const data = file ? await fs.readFile(file) : Buffer.from(body);
    onProgress?.(data.length, data.length); puts.push(key); store.set(key, data);
  };
  const fetchImpl = async (url, options = {}) => {
    const key = new URL(url).pathname.slice(1), data = store.get(key);
    if (!data) return new Response('', { status: 404 });
    if (options.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(data.length), etag: `"${md5(data)}"` } });
    return new Response(data, { status: 200 });
  };
  return { store, puts, put, fetchImpl };
}

test('发布前核对：签名、文件大小和校验码都对才放行', async t => {
  const dir = await folder(t);
  const plan = await readUploadFolder(dir, PUBLIC);
  assert.equal(plan.manifest.version, '3.8.0');
  assert.deepEqual(plan.files.map(f => [f.kind, f.size, f.md5]), [['setup', SETUP.length, md5(SETUP)], ['update', UPDATE.length, md5(UPDATE)]]);
  await fs.writeFile(path.join(dir, 'releases', '3.8.0', 'update.exe'), Buffer.from('被人改过的更新包'));
  await assert.rejects(readUploadFolder(dir, PUBLIC), /对不上/);
  await fs.rm(path.join(dir, 'releases', '3.8.0', 'update.exe'));
  await assert.rejects(readUploadFolder(dir, PUBLIC), /缺少文件/);
  const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  await assert.rejects(readUploadFolder(await folder(t), other), /签名/);
  await assert.rejects(readUploadFolder(os.tmpdir() + path.sep + 'no-such-dir-xyz', PUBLIC), /latest\.json/);
});

test('一键发布：先传安装包，最后传清单，回读核对；再发一次云上已有的文件自动跳过', async t => {
  const dir = await folder(t), cloud = fakeCloud(), steps = [];
  const manifest = await publishFolder({ dir, credentials: {}, publicKey: PUBLIC, put: cloud.put, fetchImpl: cloud.fetchImpl, onStep: s => steps.push(`${s.kind}:${s.status}`) });
  assert.equal(manifest.version, '3.8.0');
  assert.deepEqual(cloud.puts, ['releases/3.8.0/setup.exe', 'releases/3.8.0/update.exe', 'latest.json'], '清单一定最后传');
  assert.ok(steps.includes('verify:done'));
  cloud.puts.length = 0; steps.length = 0;
  await publishFolder({ dir, credentials: {}, publicKey: PUBLIC, put: cloud.put, fetchImpl: cloud.fetchImpl, onStep: s => steps.push(`${s.kind}:${s.status}`) });
  assert.deepEqual(cloud.puts, ['latest.json'], '安装包云上已有，只重传清单');
  assert.ok(steps.includes('setup:skipped') && steps.includes('update:skipped'));
});

test('没有更新包的版本也能发布', async t => {
  const dir = await folder(t, { withUpdate: false }), cloud = fakeCloud();
  await publishFolder({ dir, credentials: {}, publicKey: PUBLIC, put: cloud.put, fetchImpl: cloud.fetchImpl });
  assert.deepEqual(cloud.puts, ['releases/3.8.0/setup.exe', 'latest.json']);
});

test('上传出错自动重试；密钥不对不重试；没传成功就不换清单', async t => {
  const dir = await folder(t), cloud = fakeCloud(), steps = [];
  let failures = 2;
  const flaky = async (...args) => { if (args[1].endsWith('setup.exe') && failures-- > 0) throw new Error('网络断了'); return cloud.put(...args); };
  await publishFolder({ dir, credentials: {}, publicKey: PUBLIC, put: flaky, fetchImpl: cloud.fetchImpl, wait: async () => {}, onStep: s => { if (s.status === 'retry') steps.push(s.attempt); } });
  assert.deepEqual(steps, [1, 2]); assert.ok(cloud.store.has('latest.json'));
  const empty = fakeCloud();
  const denied = async () => { throw new Error('上传密钥不对（SecretId 或 SecretKey 填错了）'); };
  let tries = 0;
  await assert.rejects(publishFolder({ dir, credentials: {}, publicKey: PUBLIC, put: async (...a) => { tries++; return denied(...a); }, fetchImpl: empty.fetchImpl, wait: async () => {} }), /密钥不对/);
  assert.equal(tries, 1); assert.equal(empty.store.has('latest.json'), false);
  const always = async () => { throw new Error('网络断了'); };
  await assert.rejects(publishFolder({ dir, credentials: {}, publicKey: PUBLIC, put: always, fetchImpl: empty.fetchImpl, wait: async () => {} }), /网络断了/);
  assert.equal(empty.store.has('latest.json'), false, '安装包没传上去，清单不能换');
});

test('上传密钥格式不对直接提示', async () => {
  await assert.rejects(checkCredentials({ secretId: 'abc', secretKey: 'x' }), /AKID/);
  await assert.rejects(checkCredentials({ secretId: 'AKID12345678', secretKey: '' }), /SecretKey/);
});
