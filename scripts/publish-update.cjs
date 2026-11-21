// 推送更新：生成签过名的 latest.json，整理出「腾讯云上传-vX.Y.Z」文件夹，再（可选）直接传到腾讯云 COS。
// 用法：先 npm run package、npm run package:update、编译完整安装包，然后
//   npm run update:publish              —— 整理上传文件夹并直接发布
//   npm run update:publish -- --dry-run —— 只整理上传文件夹（release/installer/腾讯云上传-vX.Y.Z），不上传；
//                                         可以拿到别的电脑上用「小萝卜发版助手」一键发布
// 需要（都放在本机 %USERPROFILE%\.xiaoluobo-release\，不进代码库）：
//   update-signing-key.pem  签名私钥（npm run update:keygen 生成）
//   cos.json                {"SecretId":"...","SecretKey":"..."}，只开这个存储桶上传权限的子账号密钥（只有直接发布时要）
// 更新说明默认取 README「版本更新」里这个版本那一段，也可以 --notes-file 说明.txt 指定。
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { version } = require('../package.json');
const { signManifest, verifyManifest, MANIFEST_KEY, APP_ID } = require('../lib/updater.cjs');
const { UPDATE_PUBLIC_KEY } = require('../lib/update-key.cjs');
const { cosAuthorization, cosHttpString, hashFile, publishFolder } = require('../lib/cos.cjs');

const root = path.join(__dirname, '..');
const appName = '小萝卜游戏控制台';
const secretDir = process.env.XIAOLUOBO_RELEASE_DIR || path.join(os.homedir(), '.xiaoluobo-release');
const argValue = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; };

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
const UPLOAD_NOTE = v => `小萝卜控制台 v${v} —— 腾讯云上传说明

最省事：用「小萝卜发版助手」选这个文件夹，点「一键发布」。

手动上传的话：存储桶 xiaoluobo-update-1300851355（上海）的根目录，顺序很重要：
1. 先传 releases 文件夹（整个拖进去，里面是 releases/${v}/setup.exe 和 update.exe）
2. 等两个文件都传完，再传 latest.json（放在存储桶最外层，覆盖旧的）
文件名、文件夹名都不要改，改了控制台就找不到。
`;

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
  const describe = async (file, kind) => { const { sha256, size } = await hashFile(file); return { key: `releases/${version}/${kind}.exe`, sha256, size }; };
  const manifest = {
    app: APP_ID, version, date: new Date().toISOString(), notes,
    setup: await describe(setupFile, 'setup'),
    update: hasUpdate ? { ...await describe(updateFile, 'update'), from: fromVersions(version) } : null
  };
  const document = signManifest(manifest, privateKey);
  verifyManifest(document, UPDATE_PUBLIC_KEY); // 私钥和程序里的公钥对不上就在这里停下
  const work = path.join(root, 'release', `update-v${version}`);
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'latest.json'), JSON.stringify(document, null, 2));
  // 上传文件夹：目录结构和存储桶里一模一样，发版助手或手动拖进去都行。
  const upload = path.join(installer, `腾讯云上传-v${version}`);
  fs.rmSync(upload, { recursive: true, force: true });
  fs.mkdirSync(path.join(upload, 'releases', version), { recursive: true });
  fs.copyFileSync(setupFile, path.join(upload, 'releases', version, 'setup.exe'));
  if (hasUpdate) fs.copyFileSync(updateFile, path.join(upload, 'releases', version, 'update.exe'));
  fs.writeFileSync(path.join(upload, MANIFEST_KEY), JSON.stringify(document, null, 2));
  fs.writeFileSync(path.join(upload, '上传说明.txt'), UPLOAD_NOTE(version).replace(/\n/g, '\r\n'));
  console.log(`v${version} 上传文件夹已整理好：${path.relative(root, upload)}`);
  console.log(`  完整安装包 ${(manifest.setup.size / 1048576).toFixed(1)} MB${hasUpdate ? `，更新包 ${(manifest.update.size / 1048576).toFixed(1)} MB（可从 ${manifest.update.from.length} 个旧版本直接升级）` : '，没有更新包（所有人都下完整安装包）'}`);
  if (dryRun) return console.log('--dry-run：没有上传');

  const credentialFile = path.join(secretDir, 'cos.json');
  const saved = fs.existsSync(credentialFile) ? JSON.parse(fs.readFileSync(credentialFile, 'utf8')) : {};
  const credentials = { secretId: process.env.COS_SECRET_ID || saved.SecretId, secretKey: process.env.COS_SECRET_KEY || saved.SecretKey };
  if (!credentials.secretId || !credentials.secretKey) throw new Error(`没找到上传密钥，请在 ${credentialFile} 写上 {"SecretId":"...","SecretKey":"..."}`);
  const names = { setup: '完整安装包', update: '更新包', manifest: '更新清单', verify: '回读核对' };
  let last = 0;
  await publishFolder({ dir: upload, credentials, publicKey: UPDATE_PUBLIC_KEY, onStep: ({ kind, status, sent, size, attempt, error }) => {
    if (status === 'uploading' && (Date.now() - last > 1000 || sent === size)) { last = Date.now(); process.stdout.write(`\r  上传${names[kind]}：${Math.floor(sent / size * 100)}%   `); }
    else if (status === 'skipped') console.log(`  ${names[kind]}云上已有，跳过`);
    else if (status === 'done') console.log(`\n  ${names[kind]}完成`);
    else if (status === 'retry') console.log(`\n  ${names[kind]}出错（${error}），第 ${attempt} 次重试…`);
  } });
  console.log(`已发布 v${version}：已安装的控制台会在启动 20 秒后、或点「检查更新」时提示更新。`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
module.exports = { cosAuthorization, cosHttpString, notesFromReadme };
