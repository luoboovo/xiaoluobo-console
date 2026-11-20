// 推送更新：把打好的安装包、更新包传到腾讯云 COS，再发布签过名的 latest.json，已安装的控制台就会提示更新。
// 用法：先 npm run package、npm run package:update、编译完整安装包，然后
//   npm run update:publish              —— 上传并发布
//   npm run update:publish -- --dry-run —— 只生成 release/update-vX/latest.json 看看，不上传
// 需要（都放在本机 %USERPROFILE%\.xiaoluobo-release\，不进代码库）：
//   update-signing-key.pem  签名私钥（npm run update:keygen 生成）
//   cos.json                {"SecretId":"...","SecretKey":"..."}，只开这个存储桶上传权限的子账号密钥
// 更新说明默认取 README「版本更新」里这个版本那一段，也可以 --notes-file 说明.txt 指定。
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { version } = require('../package.json');
const { signManifest, verifyManifest, UPDATE_BASE_URL, MANIFEST_KEY, APP_ID } = require('../lib/updater.cjs');
const { UPDATE_PUBLIC_KEY } = require('../lib/update-key.cjs');

const root = path.join(__dirname, '..');
const appName = '小萝卜游戏控制台';
const secretDir = process.env.XIAOLUOBO_RELEASE_DIR || path.join(os.homedir(), '.xiaoluobo-release');
const argValue = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; };
const host = new URL(UPDATE_BASE_URL).host;

const sha256 = file => new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject); });

// 版本更新说明：README 里以「vX.Y.Z：」开头的那一段，到下一个版本为止。
function notesFromReadme(text, v) {
  const lines = text.replace(/\r\n/g, '\n').split('\n'), start = lines.findIndex(line => line.startsWith(`v${v}：`));
  if (start < 0) throw new Error(`README 里没找到 v${v} 的更新说明，请先写上，或者用 --notes-file 指定`);
  const out = [];
  for (const line of lines.slice(start)) { if (out.length && /^v\d+\.\d+\.\d+：/.test(line) || /^## /.test(line)) break; out.push(line); }
  return out.join('\n').trim();
}
// 更新包能直接升级的版本：package-update.cjs 写在 update-version.iss 里。
function fromVersions(v) {
  const iss = fs.readFileSync(path.join(root, 'release', `update-v${v}`, 'update-version.iss'), 'utf8');
  const match = /#define AllowedVersions "\|(.*)\|"/.exec(iss);
  if (!match) throw new Error('update-version.iss 里没有可升级版本列表');
  return match[1].split('|').filter(item => item && item !== v);
}

// 腾讯云 COS 请求签名（XML API 签名 v5，q-sign-algorithm=sha1）。
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

function putObject(credentials, key, { file, body, contentType }) {
  const size = file ? fs.statSync(file).size : Buffer.byteLength(body);
  const pathname = '/' + key;
  const headers = { host, 'content-length': String(size), 'content-type': contentType, 'cache-control': key === MANIFEST_KEY ? 'no-cache, max-age=0' : 'public, max-age=31536000, immutable' };
  headers.authorization = cosAuthorization({ ...credentials, method: 'PUT', pathname, headers: { host, 'content-length': headers['content-length'], 'content-type': contentType } });
  return new Promise((resolve, reject) => {
    const request = https.request({ host, path: pathname, method: 'PUT', headers }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => response.statusCode === 200 ? resolve() : reject(new Error(`上传 ${key} 失败（${response.statusCode}）：${(/<Message>(.*?)<\/Message>/.exec(text) || [, text.slice(0, 300)])[1]}`)));
    });
    request.on('error', reject);
    if (!file) return request.end(body);
    let sent = 0, last = 0;
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => { sent += chunk.length; if (Date.now() - last > 1000 || sent === size) { last = Date.now(); process.stdout.write(`\r  上传 ${key}：${Math.floor(sent / size * 100)}%   `); } });
    stream.on('end', () => process.stdout.write('\n'));
    stream.on('error', reject);
    stream.pipe(request);
  });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const installer = path.join(root, 'release', 'installer');
  const setupFile = path.join(installer, `${appName}-v${version}-Setup.exe`);
  const updateFile = path.join(installer, `${appName}-v${version}-更新包.exe`);
  if (!fs.existsSync(setupFile)) throw new Error(`没找到完整安装包 ${path.relative(root, setupFile)}，请先打包`);
  const hasUpdate = fs.existsSync(updateFile);
  const notesFile = argValue('--notes-file');
  const notes = notesFile ? fs.readFileSync(notesFile, 'utf8').trim() : notesFromReadme(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), version);
  const keyFile = path.join(secretDir, 'update-signing-key.pem');
  if (!fs.existsSync(keyFile)) throw new Error(`没找到签名私钥 ${keyFile}，请先运行 npm run update:keygen`);
  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile));
  const describe = async (file, kind) => ({ key: `releases/${version}/${kind}.exe`, sha256: await sha256(file), size: fs.statSync(file).size });
  const manifest = {
    app: APP_ID, version, date: new Date().toISOString(), notes,
    setup: await describe(setupFile, 'setup'),
    update: hasUpdate ? { ...await describe(updateFile, 'update'), from: fromVersions(version) } : null
  };
  const document = signManifest(manifest, privateKey);
  verifyManifest(document, UPDATE_PUBLIC_KEY); // 私钥和程序里的公钥对不上就在这里停下
  const out = path.join(root, 'release', `update-v${version}`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify(document, null, 2));
  console.log(`v${version} 更新清单已生成：${path.relative(root, path.join(out, 'latest.json'))}`);
  console.log(`  完整安装包 ${(manifest.setup.size / 1048576).toFixed(1)} MB${hasUpdate ? `，更新包 ${(manifest.update.size / 1048576).toFixed(1)} MB（可从 ${manifest.update.from.length} 个旧版本直接升级）` : '，没有更新包（所有人都下完整安装包）'}`);
  if (dryRun) return console.log('--dry-run：没有上传');

  const credentialFile = path.join(secretDir, 'cos.json');
  const saved = fs.existsSync(credentialFile) ? JSON.parse(fs.readFileSync(credentialFile, 'utf8')) : {};
  const credentials = { secretId: process.env.COS_SECRET_ID || saved.SecretId, secretKey: process.env.COS_SECRET_KEY || saved.SecretKey };
  if (!credentials.secretId || !credentials.secretKey) throw new Error(`没找到上传密钥，请在 ${credentialFile} 写上 {"SecretId":"...","SecretKey":"..."}`);
  // 先传安装包，最后才换 latest.json：大家看到新版本时文件一定已经在了。
  await putObject(credentials, manifest.setup.key, { file: setupFile, contentType: 'application/octet-stream' });
  if (hasUpdate) await putObject(credentials, manifest.update.key, { file: updateFile, contentType: 'application/octet-stream' });
  await putObject(credentials, MANIFEST_KEY, { body: JSON.stringify(document), contentType: 'application/json; charset=utf-8' });
  // 回读一遍，确认外面下载到的清单验签通过、文件大小对得上。
  const check = verifyManifest(await (await fetch(`${UPDATE_BASE_URL}/${MANIFEST_KEY}?t=${Date.now()}`, { cache: 'no-store' })).json(), UPDATE_PUBLIC_KEY);
  if (check.version !== version) throw new Error('回读的 latest.json 版本不对，请稍后再看');
  for (const file of [manifest.setup, manifest.update].filter(Boolean)) {
    const head = await fetch(`${UPDATE_BASE_URL}/${file.key}`, { method: 'HEAD' });
    if (!head.ok || Number(head.headers.get('content-length')) !== file.size) throw new Error(`回读 ${file.key} 不对（${head.status}）`);
  }
  console.log(`已发布 v${version}：已安装的控制台会在启动 20 秒后、或点「检查更新」时提示更新。`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
module.exports = { cosAuthorization, cosHttpString, notesFromReadme };
