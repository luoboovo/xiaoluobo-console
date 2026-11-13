// 增量更新包：只装上次正式版以来改过的文件。
// 用法：先 npm run package，再 npm run package:update [-- --from v3.0.0]
// 默认从「和现在用同一个 Electron 的最早正式版」算起，所以装了其中任何一个版本都能直接打这个更新包。
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { version } = require('../package.json');

const root = path.join(__dirname, '..');
const appName = '小萝卜游戏控制台';
const output = path.join(root, 'release', `${appName}-v${version}`);
const appDir = path.join(output, 'resources', 'app');
const work = path.join(root, 'release', `update-v${version}`);
const payload = path.join(work, 'payload');
// 和 package.cjs 一致：这些会被打进 resources/app。
const APP_PATHS = ['package.json', 'desktop.cjs', 'overtime-preload.cjs', 'server.cjs', 'lib', 'public', 'data'];
const skipped = file => path.basename(file).includes('.before-paid-') || file.endsWith('.luobo') || ['chef-body.png', 'chef-hand.png'].includes(path.basename(file));

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const semver = tag => tag.replace(/^v/, '').split('.').map(Number);
const compare = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const lockAt = ref => { try { return JSON.parse(git('show', `${ref}:package-lock.json`)); } catch { return null; } };
const electronOf = lock => lock?.packages?.['node_modules/electron']?.version || '';
// 打进安装包的依赖（qrcode、ws 及它们的依赖）在两个版本间有没有变。
function bundledDeps(lock, names) {
  const seen = new Map(), visit = name => {
    if (seen.has(name)) return;
    const entry = lock?.packages?.[`node_modules/${name}`];
    seen.set(name, entry?.version || '');
    for (const dep of Object.keys(entry?.dependencies || {})) visit(dep);
  };
  for (const name of names) visit(name);
  return JSON.stringify([...seen].sort());
}

function argValue(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : ''; }
function findIscc() {
  const candidates = [process.env.ISCC, path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'), path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe'), path.join(process.env.ProgramFiles || '', 'Inno Setup 6', 'ISCC.exe')];
  return candidates.find(file => file && fsSync.existsSync(file));
}
const issString = value => value.replaceAll('"', '""');

(async () => {
  const electron = (await fs.readFile(path.join(output, 'version'), 'utf8').catch(() => '')).trim();
  if (!electron) throw new Error(`没找到打包好的 v${version}，请先运行 npm run package`);
  if ((JSON.parse(await fs.readFile(path.join(appDir, 'package.json'), 'utf8'))).version !== version) throw new Error('打包目录的版本号和 package.json 不一致，请先重新运行 npm run package');
  const currentLock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));

  // 发过的版本：package.json 里改版本号的那次提交就是这个版本（有的版本没打标签）。
  const releases = new Map();
  for (const commit of git('log', '--first-parent', '--format=%H', '-G', '"version"', '--', 'package.json').split(/\r?\n/).filter(Boolean)) {
    let v; try { v = JSON.parse(git('show', `${commit}:package.json`)).version; } catch { continue; }
    if (/^\d+\.\d+\.\d+$/.test(v) && !releases.has(v) && compare(v, version) <= 0) releases.set(v, commit);
  }
  // 能直接升级的旧版本：和现在用同一个 Electron 的。
  const from = (argValue('--from') || '').replace(/^v/, '');
  if (from && !releases.has(from)) throw new Error(`找不到发过的版本 v${from}`);
  const sameRuntime = [...releases].filter(([v, commit]) => (!from || compare(v, from) >= 0) && electronOf(lockAt(commit)) === electron).sort((a, b) => compare(a[0], b[0]));
  if (!sameRuntime.length) throw new Error(`没有和现在同一个 Electron（${electron}）的旧版本，这次只能发完整安装包`);
  const allowed = [...new Set([...sameRuntime.map(([v]) => v), version])];

  // 改过、新增、删掉的文件：分别和每个能升级的旧版本比，取并集（包含还没提交的改动和新文件），
  // 这样中间某版改过、后来又改回去的文件也会被换回来。
  const changed = new Set(), removed = new Set();
  for (const [, commit] of sameRuntime) {
    for (const line of git('diff', '--name-status', '--no-renames', commit, '--', ...APP_PATHS).split(/\r?\n/).filter(Boolean)) {
      const [status, file] = line.split('\t');
      (status === 'D' ? removed : changed).add(file);
    }
  }
  for (const file of git('ls-files', '--others', '--exclude-standard', '--', ...APP_PATHS).split(/\r?\n/).filter(Boolean)) changed.add(file);

  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(payload, { recursive: true });
  const files = [];
  for (const file of [...changed].sort()) {
    if (skipped(file)) continue;
    const built = path.join(appDir, file);
    if (!fsSync.existsSync(built)) { removed.add(file); continue; }
    // 打包目录得是最新的：文本文件要和源码一模一样（图片打包时会压缩，不比）。
    if (!/\.(png|jpe?g|webp|gif|mp3|mp4|wav|ico)$/i.test(file)) {
      const source = await fs.readFile(path.join(root, file)), packed = await fs.readFile(built);
      if (!source.equals(packed)) throw new Error(`${file} 改过但还没重新打包，请先运行 npm run package`);
    }
    await fs.mkdir(path.dirname(path.join(payload, 'resources', 'app', file)), { recursive: true });
    await fs.copyFile(built, path.join(payload, 'resources', 'app', file));
    files.push(file);
  }
  const deletes = [...removed].filter(file => !skipped(file) && !changed.has(file)).sort();
  const depNames = (await fs.readdir(path.join(appDir, 'node_modules')).catch(() => [])).filter(name => !name.startsWith('.'));
  const depsChanged = sameRuntime.some(([, commit]) => bundledDeps(lockAt(commit), depNames) !== bundledDeps(currentLock, depNames));
  if (depsChanged) await fs.cp(path.join(appDir, 'node_modules'), path.join(payload, 'resources', 'app', 'node_modules'), { recursive: true });
  const readmeChanged = sameRuntime.some(([, commit]) => git('diff', '--name-only', commit, '--', 'README.md').trim());
  if (readmeChanged) await fs.copyFile(path.join(output, '使用说明.md'), path.join(payload, '使用说明.md'));

  let bytes = 0;
  for (const name of await fs.readdir(payload, { recursive: true })) { const stat = await fs.stat(path.join(payload, name)); if (stat.isFile()) bytes += stat.size; }

  const inc = [
    `#define AppVersion "${version}"`,
    `#define AllowedVersions "|${allowed.join('|')}|"`,
    `#define ElectronVersion "${electron}"`,
    `#define FromList "${allowed.slice(0, -1).map(v => 'v' + v).join('、')}"`,
    `#define PayloadDir "${issString(payload)}"`,
    `#define ReplaceDeps ${depsChanged ? 1 : 0}`,
    ''
  ].join('\r\n');
  const deleteSection = ['[InstallDelete]', ...deletes.map(file => `Type: files; Name: "{app}\\resources\\app\\${issString(file.replaceAll('/', '\\'))}"`), ''].join('\r\n');
  await fs.writeFile(path.join(work, 'update-version.iss'), '\uFEFF' + inc);
  await fs.writeFile(path.join(work, 'update-delete.iss'), '\uFEFF' + deleteSection);
  await fs.writeFile(path.join(work, '更新内容.txt'), [`v${version} 增量更新包（可从 ${allowed.slice(0, -1).map(v => 'v' + v).join('、')} 直接升级）`, '', '更新的文件：', ...files.map(f => '  ' + f), ...(depsChanged ? ['  node_modules（依赖）'] : []), ...(readmeChanged ? ['  使用说明.md'] : []), '', '删除的文件：', ...(deletes.length ? deletes.map(f => '  ' + f) : ['  （无）']), ''].join('\r\n'));

  console.log(`对比 ${sameRuntime.length} 个旧版本：更新 ${files.length} 个文件${depsChanged ? '（含依赖）' : ''}，删除 ${deletes.length} 个，共 ${(bytes / 1024).toFixed(0)} KB`);
  console.log(`能直接升级的版本：${allowed.slice(0, -1).map(v => 'v' + v).join('、')}`);
  const iscc = findIscc();
  if (!iscc) throw new Error('没找到 Inno Setup 6（ISCC.exe），装好后重试，或设置环境变量 ISCC');
  execFileSync(iscc, [`/DUpdateDir=${work}`, path.join(__dirname, 'installer-update.iss')], { stdio: ['ignore', 'ignore', 'inherit'] });
  const exe = path.join(root, 'release', 'installer', `${appName}-v${version}-更新包.exe`);
  console.log(`${exe}（${((await fs.stat(exe)).size / 1024).toFixed(0)} KB）`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
