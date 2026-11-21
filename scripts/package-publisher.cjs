// 打包「小萝卜发版助手」：npm run package:publisher
// 输出 release/小萝卜发版助手/（免安装，可以整个文件夹拷走）和 release/installer/小萝卜发版助手-Setup.exe。
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const name = '小萝卜发版助手';
const output = path.join(root, 'release', name);
const locales = new Set(['zh-CN.pak', 'en-US.pak']);
const { version } = JSON.parse(fsSync.readFileSync(path.join(root, 'tools', 'publisher', 'package.json'), 'utf8'));

(async () => {
  if (!path.resolve(output).startsWith(path.resolve(root, 'release') + path.sep)) throw new Error('打包路径无效');
  await fs.rm(output, { recursive: true, force: true });
  const runtime = path.join(root, 'node_modules', 'electron', 'dist');
  await fs.cp(runtime, output, { recursive: true, filter: source => path.dirname(source) !== path.join(runtime, 'locales') || locales.has(path.basename(source)) });
  const executable = path.join(output, `${name}.exe`);
  await fs.rename(path.join(output, 'electron.exe'), executable);
  await fs.rm(path.join(output, 'resources', 'default_app.asar'), { force: true });
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'set-app-icon.ps1'), '-Executable', executable, '-Icon', path.join(root, 'public', 'app-icon.ico')], { windowsHide: true, stdio: 'inherit' });
  const app = path.join(output, 'resources', 'app');
  await fs.mkdir(path.join(app, 'lib'), { recursive: true });
  for (const file of ['package.json', 'main.cjs', 'preload.cjs', 'index.html', 'app.js', 'app.css', 'icon.ico']) await fs.copyFile(path.join(root, 'tools', 'publisher', file), path.join(app, file));
  // 只带上传和验签要用的三个文件；签名私钥不进安装包（发版助手只上传已经签好名的文件夹）。
  for (const file of ['cos.cjs', 'updater.cjs', 'update-key.cjs']) await fs.copyFile(path.join(root, 'lib', file), path.join(app, 'lib', file));
  await fs.writeFile(path.join(root, 'release', 'publisher-version.iss'), `#define PublisherVersion "${version}"\n`);
  console.log(executable);
  const iscc = [process.env.ISCC, path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'), path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe')].find(file => file && fsSync.existsSync(file));
  if (!iscc) return console.log('没找到 Inno Setup，只生成了免安装文件夹');
  execFileSync(iscc, ['/Q', path.join(__dirname, 'publisher.iss')], { stdio: 'inherit' });
  console.log(path.join(root, 'release', 'installer', `${name}-Setup.exe`));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
