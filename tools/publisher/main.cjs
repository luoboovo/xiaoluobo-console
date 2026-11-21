// 小萝卜发版助手：选「腾讯云上传-vX.Y.Z」文件夹 → 核对签名和文件 → 一键传到腾讯云，所有控制台就会弹出更新提示。
// 上传密钥（只有这个存储桶上传权限的子账号）用 Windows 系统加密存在本机，不会发到别处。
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const lib = name => { try { return require(`./lib/${name}`); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; return require(`../../lib/${name}`); } };
const { readUploadFolder, onlineManifest, publishFolder, checkCredentials } = lib('cos.cjs');
const { compareVersions } = lib('updater.cjs');
const { UPDATE_PUBLIC_KEY } = lib('update-key.cjs');

app.setName('小萝卜发版助手');
if (!app.requestSingleInstanceLock()) app.quit();
let win, busy = false;
const credentialFile = () => path.join(app.getPath('userData'), 'cos-key.bin');
function loadCredentials() {
  try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialFile()))); } catch { return null; }
}
const mask = id => id ? `${id.slice(0, 6)}…${id.slice(-4)}` : '';
const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

// 自动找最新的上传文件夹：程序旁边、桌面、下载、文档里的小萝卜项目。
function findFolders() {
  const home = app.getPath('home'), roots = [path.dirname(process.execPath), app.getPath('desktop'), app.getPath('downloads'), path.join(app.getPath('documents'), 'luobokongzhi', 'release', 'installer'), path.join(home, 'Documents', 'luobokongzhi', 'release', 'installer')];
  const found = [];
  for (const root of [...new Set(roots)]) {
    let names = []; try { names = fs.readdirSync(root); } catch { continue; }
    for (const name of names) { const m = /^腾讯云上传-v(\d+\.\d+\.\d+)$/.exec(name); if (m && fs.existsSync(path.join(root, name, 'latest.json'))) found.push({ dir: path.join(root, name), version: m[1] }); }
  }
  return found.sort((a, b) => compareVersions(b.version, a.version));
}

ipcMain.handle('state', () => {
  const saved = loadCredentials();
  return { credentials: saved ? { saved: true, id: mask(saved.secretId) } : { saved: false }, encryption: safeStorage.isEncryptionAvailable(), folders: findFolders().slice(0, 5), version: app.getVersion() };
});
ipcMain.handle('online', async () => {
  const manifest = await onlineManifest(UPDATE_PUBLIC_KEY);
  return manifest ? { version: manifest.version, date: manifest.date, notes: manifest.notes } : null;
});
ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(win, { title: '选择「腾讯云上传-vX.Y.Z」文件夹', properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('inspect', async (_event, dir) => {
  const plan = await readUploadFolder(dir, UPDATE_PUBLIC_KEY, (kind, done, size) => send('inspect-progress', { kind, done, size }));
  return { dir, version: plan.manifest.version, notes: plan.manifest.notes, date: plan.manifest.date, files: plan.files.map(f => ({ kind: f.kind, size: f.size })), from: plan.manifest.update?.from?.length || 0 };
});
ipcMain.handle('save-credentials', async (_event, input) => {
  const credentials = { secretId: String(input?.secretId || '').trim(), secretKey: String(input?.secretKey || '').trim() };
  if (!safeStorage.isEncryptionAvailable()) throw new Error('这台电脑的系统加密不可用，没法安全保存密钥');
  await checkCredentials(credentials);
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(credentialFile(), safeStorage.encryptString(JSON.stringify(credentials)));
  return { saved: true, id: mask(credentials.secretId) };
});
ipcMain.handle('clear-credentials', () => { fs.rmSync(credentialFile(), { force: true }); return { saved: false }; });
ipcMain.handle('publish', async (_event, dir) => {
  if (busy) throw new Error('正在发布中');
  const credentials = loadCredentials();
  if (!credentials) throw new Error('请先保存上传密钥');
  busy = true;
  try {
    let last = 0;
    const manifest = await publishFolder({ dir, credentials, publicKey: UPDATE_PUBLIC_KEY, onStep: step => {
      // 上传进度每 0.2 秒报一次，其它状态马上报。
      if (step.status === 'uploading' || step.status === 'checking' && step.kind !== 'verify') { if (Date.now() - last < 200 && step.sent !== step.size) return; last = Date.now(); }
      send('publish-step', { ...step, time: Date.now() });
    } });
    return { version: manifest.version };
  } finally { busy = false; }
});
ipcMain.handle('open-bucket', () => shell.openExternal('https://console.cloud.tencent.com/cos/bucket?bucket=xiaoluobo-update-1300851355&region=ap-shanghai'));

app.whenReady().then(() => {
  win = new BrowserWindow({ width: 820, height: 760, minWidth: 640, minHeight: 600, title: '小萝卜发版助手', backgroundColor: '#eef4fa', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  // 发布中关窗口先确认，免得传一半。
  win.on('close', event => {
    if (!busy) return;
    const choice = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['继续发布', '仍然关闭'], defaultId: 0, cancelId: 0, title: '正在发布', message: '正在上传，关掉的话这次发布就中断了（下次重新点一键发布会接着传）。' });
    if (choice === 0) event.preventDefault();
  });
  win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
