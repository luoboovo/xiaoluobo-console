const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { version } = require('../package.json');
const { optimizePng, resizePng } = require('./optimize-png.cjs');
// Longest edge for shipped art: 1080p output at the largest layout scale, with headroom.
// Wide scene art keeps its size; originals with their C2PA signatures stay in the project.
const PNG_LIMITS = [
  [/^feeding\/assets\/(?:mouse_rice\/rice|cat_fish\/fish|leaves_bin\/leaf_[a-z]+|stars_jar\/star)\.png$/, 384],
  [/^feeding\/assets\//, 768],
  [/^noodle\/assets\/(?:bowl-area|shop-seal|counter)\.png$/, Infinity],
  [/^noodle\/assets\/payment-coin\.png$/, 512],
  [/^noodle\/assets\//, 1024],
  [/^app-icon\.png$/, 128]
];
const pngLimit = name => PNG_LIMITS.find(([pattern]) => pattern.test(name.replaceAll(path.sep, '/')))?.[1] ?? Infinity;
const root = path.join(__dirname, '..');
const output = path.join(root, 'release', `小萝卜游戏控制台-v${version}`);
const locales = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak']);

async function removeBuildPath(name, recursive = false) {
  const target = path.resolve(output, name);
  if (!target.startsWith(path.resolve(root, 'release') + path.sep)) throw new Error('打包清理路径无效');
  await fs.rm(target, { recursive, force: true });
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(root, 'release', 'app-version.iss'), `#define AppVersion "${version}"\n`);
  const runtime = path.join(root, 'node_modules', 'electron', 'dist');
  const executable = path.join(output, '小萝卜游戏控制台.exe');
  const installed = await fs.readFile(path.join(output, 'version'), 'utf8').catch(() => '');
  const current = await fs.readFile(path.join(runtime, 'version'), 'utf8');
  const reuse = installed === current && await fs.access(executable).then(() => true, () => false);
  if (!reuse) {
    await fs.cp(runtime, output, { recursive: true, filter: source => path.dirname(source) !== path.join(runtime, 'locales') || locales.has(path.basename(source)) });
    await fs.rename(path.join(output, 'electron.exe'), executable);
  }
  for (const name of await fs.readdir(path.join(output, 'locales'))) if (!locales.has(name)) await removeBuildPath(path.join('locales', name));
  await removeBuildPath(path.join('resources', 'default_app.asar'));
  execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'set-app-icon.ps1'),'-Executable',executable,'-Icon',path.join(root,'public','app-icon.ico')], { windowsHide:true, stdio:'inherit' });
  const app = path.join(output, 'resources', 'app');
  await removeBuildPath(path.join('resources', 'app'), true);
  await fs.mkdir(app, { recursive: true });
  for (const name of ['package.json', 'desktop.cjs', 'overtime-preload.cjs', 'server.cjs', 'lib', 'public', 'data']) await fs.cp(path.join(root, name), path.join(app, name), { recursive: true, filter: source => !path.basename(source).includes('.before-paid-') && !source.endsWith('.luobo') && !['chef-body.png', 'chef-hand.png'].includes(path.basename(source)) });
  await removeBuildPath(path.join('模板', '刀削面馆-v1.0.1.luobo'));
  let saved = 0, checked = 0;
  for (const dir of ['public', path.join('data', 'images')]) {
    let groupSaved = 0;
    for (const name of await fs.readdir(path.join(app, dir), { recursive: true })) {
      if (!name.endsWith('.png')) continue;
      const file = path.join(app, dir, name), original = await fs.readFile(file);
      if(!original.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))continue;
      const limit = dir === 'public' ? pngLimit(name) : Infinity;
      const optimized = optimizePng(limit < Infinity ? resizePng(original, limit) : original);
      if (optimized.length < original.length) { await fs.writeFile(file, optimized); groupSaved += original.length - optimized.length; }
      checked++;
    }
    saved += groupSaved;
    console.log(`${dir}: PNG 缩放与压缩节省 ${(groupSaved / 1024 / 1024).toFixed(2)} MiB`);
  }
  const copied = new Set();
  async function copyDependency(name) {
    if (copied.has(name)) return; copied.add(name);
    const source = path.join(root, 'node_modules', name);
    const pkg = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    await fs.cp(source, path.join(app, 'node_modules', name), { recursive: true });
    for (const dependency of Object.keys(pkg.dependencies || {})) await copyDependency(dependency);
  }
  await copyDependency('qrcode');
  await copyDependency('ws');
  await fs.copyFile(path.join(root, 'README.md'), path.join(output, '使用说明.md'));
  console.log(`PNG 共节省 ${(saved / 1024 / 1024).toFixed(2)} MiB，${checked} 张图片已检查`);
  console.log(path.join(output, '小萝卜游戏控制台.exe'));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
