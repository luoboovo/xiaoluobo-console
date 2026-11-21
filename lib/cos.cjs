// 腾讯云 COS 上传 + 「发布一个版本」的完整流程。npm run update:publish 和「小萝卜发版助手」共用。
// 发布顺序：完整安装包 → 更新包 → 最后才换 latest.json（大家看到新版本时文件一定已经在了）。
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { verifyManifest, UPDATE_BASE_URL, MANIFEST_KEY } = require('./updater.cjs');

const HOST = new URL(UPDATE_BASE_URL).host;

// —— 请求签名（XML API 签名 v5，q-sign-algorithm=sha1）——
const cosEncode = text => encodeURIComponent(text).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const cosList = object => Object.entries(object).map(([k, v]) => [cosEncode(k.toLowerCase()), cosEncode(String(v))]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
function cosHttpString(method, pathname, headers = {}, params = {}) {
  const h = cosList(headers), p = cosList(params);
  return { h, p, text: `${method.toLowerCase()}\n${pathname}\n${p.map(([k, v]) => `${k}=${v}`).join('&')}\n${h.map(([k, v]) => `${k}=${v}`).join('&')}\n` };
}
function cosAuthorization({ secretId, secretKey, method, pathname, headers = {}, params = {}, now = Math.floor(Date.now() / 1000), expires = 3600 }) {
  const hmac = (key, text) => crypto.createHmac('sha1', key).update(text).digest('hex');
  const keyTime = `${now - 60};${now + expires}`, { h, p, text: httpString } = cosHttpString(method, pathname, headers, params);
  const stringToSign = `sha1\n${keyTime}\n${crypto.createHash('sha1').update(httpString).digest('hex')}\n`;
  const signature = hmac(hmac(secretKey, keyTime), stringToSign);
  return `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${h.map(x => x[0]).join(';')}&q-url-param-list=${p.map(x => x[0]).join(';')}&q-signature=${signature}`;
}
const cosError = (status, text) => {
  const code = (/<Code>(.*?)<\/Code>/.exec(text) || [])[1] || '', message = (/<Message>(.*?)<\/Message>/.exec(text) || [])[1] || text.slice(0, 200);
  if (status === 403 && /SignatureDoesNotMatch|InvalidAccessKeyId/.test(code)) return new Error('上传密钥不对（SecretId 或 SecretKey 填错了）');
  if (status === 403) return new Error('上传密钥没有这个存储桶的上传权限');
  return new Error(`腾讯云返回 ${status}${code ? ` ${code}` : ''}：${message}`);
};

// 带签名的请求：PUT 上传（文件或内容）、HEAD 查看。onProgress(已传字节, 总字节)。
function cosRequest({ credentials, method, key, file, body, contentType, cacheControl, onProgress, transport = https }) {
  const pathname = '/' + key, size = file ? fs.statSync(file).size : body ? Buffer.byteLength(body) : 0;
  const headers = { host: HOST, ...(method === 'PUT' ? { 'content-length': String(size), 'content-type': contentType || 'application/octet-stream' } : {}) };
  const signed = { ...headers };
  if (cacheControl) headers['cache-control'] = cacheControl;
  headers.authorization = cosAuthorization({ ...credentials, method, pathname, headers: signed });
  return new Promise((resolve, reject) => {
    const request = transport.request({ host: HOST, path: pathname, method, headers }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    request.setTimeout(120000, () => request.destroy(new Error('连接腾讯云超时')));
    request.on('error', reject);
    if (method !== 'PUT') return request.end();
    if (!file) return request.end(body);
    let sent = 0;
    const stream = fs.createReadStream(file, { highWaterMark: 256 * 1024 });
    stream.on('data', chunk => { sent += chunk.length; onProgress?.(sent, size); });
    stream.on('error', error => request.destroy(error));
    stream.pipe(request);
  });
}
async function putObject(credentials, key, options) {
  const cacheControl = key === MANIFEST_KEY ? 'no-cache, max-age=0' : 'public, max-age=31536000, immutable';
  const result = await cosRequest({ credentials, method: 'PUT', key, cacheControl, ...options });
  if (result.status !== 200) throw cosError(result.status, result.text);
}
// 检查密钥：带签名查一个文件，403 说明密钥不对或没权限（文件不存在是 404，说明密钥没问题）。
async function checkCredentials(credentials, options = {}) {
  if (!/^AKID[\w-]{8,}$/.test(credentials?.secretId || '') || !String(credentials?.secretKey || '').trim()) throw new Error('请填写 SecretId（AKID 开头）和 SecretKey');
  const result = await cosRequest({ credentials, method: 'HEAD', key: '__key_check__', ...options });
  if (result.status === 403) throw new Error('上传密钥不对，或者没有这个存储桶的权限');
  if (![200, 404].includes(result.status)) throw new Error(`腾讯云返回 ${result.status}，请稍后再试`);
  return true;
}

// —— 上传文件夹：latest.json + releases/版本号/setup.exe、update.exe（打包时生成的「腾讯云上传-vX.Y.Z」）——
function hashFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const sha = crypto.createHash('sha256'), md5 = crypto.createHash('md5'), size = fs.statSync(file).size; let done = 0;
    fs.createReadStream(file, { highWaterMark: 1024 * 1024 }).on('data', chunk => { sha.update(chunk); md5.update(chunk); done += chunk.length; onProgress?.(done, size); })
      .on('end', () => resolve({ sha256: sha.digest('hex'), md5: md5.digest('hex'), size })).on('error', reject);
  });
}
// 读出并核对：清单签名对、两个安装包大小和校验码都和清单一致，才允许发布。
async function readUploadFolder(dir, publicKey, onProgress) {
  const manifestFile = path.join(dir, MANIFEST_KEY);
  if (!fs.existsSync(manifestFile)) throw new Error('这个文件夹里没有 latest.json，请选「腾讯云上传-vX.Y.Z」那个文件夹');
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  let document; try { document = JSON.parse(manifestText); } catch { throw new Error('latest.json 内容坏了'); }
  const manifest = verifyManifest(document, publicKey);
  const files = [];
  for (const [kind, entry] of [['setup', manifest.setup], ['update', manifest.update]]) {
    if (!entry) continue;
    const file = path.join(dir, ...entry.key.split('/'));
    if (!fs.existsSync(file)) throw new Error(`缺少文件 ${entry.key}`);
    const hash = await hashFile(file, (done, size) => onProgress?.(kind, done, size));
    if (hash.size !== entry.size || hash.sha256 !== entry.sha256) throw new Error(`${entry.key} 和清单对不上（文件被改过或者没拷完整），请重新打包`);
    files.push({ kind, key: entry.key, file, size: hash.size, md5: hash.md5 });
  }
  return { manifest, manifestText: JSON.stringify(document), files };
}
// 线上现在是哪个版本（没有清单返回 null）。
async function onlineManifest(publicKey, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${UPDATE_BASE_URL}/${MANIFEST_KEY}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`读线上版本失败（${response.status}）`);
  return verifyManifest(await response.json(), publicKey);
}
async function remoteInfo(key, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`${UPDATE_BASE_URL}/${key}`, { method: 'HEAD', cache: 'no-store' });
  return response.ok ? { size: Number(response.headers.get('content-length')), etag: String(response.headers.get('etag') || '').replace(/"/g, '').toLowerCase() } : null;
}
// 发布：云上已经有一模一样的文件就跳过（断了重来很快）；每个文件失败自动重试 3 次；最后回读核对。
// onStep({ step, kind, status:'checking'|'skipped'|'uploading'|'done'|'retry', sent, size, attempt })
async function publishFolder({ dir, credentials, publicKey, onStep = () => {}, put = putObject, fetchImpl = globalThis.fetch, wait = ms => new Promise(r => setTimeout(r, ms)) }) {
  const plan = await readUploadFolder(dir, publicKey, (kind, sent, size) => onStep({ kind, status: 'checking', sent, size }));
  const upload = async (kind, key, options, size) => {
    for (let attempt = 1; ; attempt++) {
      try { await put(credentials, key, { ...options, onProgress: (sent, total) => onStep({ kind, status: 'uploading', sent, size: total }) }); return; }
      catch (error) {
        if (attempt >= 3 || /密钥|权限/.test(error.message)) throw error;
        onStep({ kind, status: 'retry', attempt, error: error.message, sent: 0, size }); await wait(2000 * attempt);
      }
    }
  };
  for (const item of plan.files) {
    const remote = await remoteInfo(item.key, fetchImpl).catch(() => null);
    // 一次传完的文件，腾讯云的校验码就是 MD5；网页上分片传的大文件校验码是「xxx-片数」，分片上传要么全完成要么不存在，大小一样就算传过了。
    const same = remote && remote.size === item.size && (remote.etag === item.md5 || /^[0-9a-f]{32}-\d+$/.test(remote.etag));
    if (same) { onStep({ kind: item.kind, status: 'skipped', sent: item.size, size: item.size }); continue; }
    await upload(item.kind, item.key, { file: item.file, contentType: 'application/octet-stream' }, item.size);
    onStep({ kind: item.kind, status: 'done', sent: item.size, size: item.size });
  }
  await upload('manifest', MANIFEST_KEY, { body: plan.manifestText, contentType: 'application/json; charset=utf-8' }, Buffer.byteLength(plan.manifestText));
  onStep({ kind: 'manifest', status: 'done' });
  onStep({ kind: 'verify', status: 'checking' });
  const online = await onlineManifest(publicKey, fetchImpl);
  if (online?.version !== plan.manifest.version) throw new Error('上传完了，但回读到的线上版本不对，请稍后再点一次「检查线上版本」');
  for (const item of plan.files) {
    const remote = await remoteInfo(item.key, fetchImpl);
    if (!remote || remote.size !== item.size) throw new Error(`回读 ${item.key} 不对，请重新发布`);
  }
  onStep({ kind: 'verify', status: 'done' });
  return plan.manifest;
}

module.exports = { HOST, cosHttpString, cosAuthorization, cosRequest, putObject, checkCredentials, hashFile, readUploadFolder, onlineManifest, remoteInfo, publishFolder };
