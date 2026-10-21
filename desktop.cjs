const { app, BrowserWindow, safeStorage, dialog, screen, ipcMain, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startServer } = require('./server.cjs');

app.setName('小萝卜游戏控制台');
let runtime, window, overtimeWindow, mediaWindow, overtimeSize, mediaSize, drag, diagnostics, stopDiagnostics, closing = false;
function showError(title,error){diagnostics?.log('error','desktop.error',{title,error});dialog.showErrorBox(title,error.message||String(error));}
const panelWindows = new Map();
ipcMain.on('overtime-drag', (event, phase) => {
  const panel = Array.from(panelWindows.values()).find(record => record.window && event.sender === record.window.webContents);
  const target = panel?.window || [overtimeWindow,mediaWindow].find(win => win && !win.isDestroyed() && event.sender === win.webContents);
  if (!target || target.isDestroyed() || event.sender.getURL() !== (panel?.url || runtime.url + (target === mediaWindow ? '/overtime/?media=1' : '/overtime/'))) return;
  const cursor = screen.getCursorScreenPoint();
  if (phase === 'start' || phase === 'resize-start') drag = { target, cursor, bounds:{...target.getContentBounds(),...(panel?.size || (target === mediaWindow ? mediaSize : overtimeSize))}, resize:phase === 'resize-start' };
  else if (phase === 'move' && drag?.target === target && !drag.resize) {
    // 复用设定尺寸，避免Windows屏幕缩放的取整误差在多次拖动间累积。
    target.setContentBounds({ ...drag.bounds, x:drag.bounds.x + cursor.x - drag.cursor.x, y:drag.bounds.y + cursor.y - drag.cursor.y });
  }
  else if (phase === 'resize-move' && drag?.target === target && drag.resize) {
    const media = target === mediaWindow, size = {width:Math.max(media ? 160 : panel ? 240 : 320,drag.bounds.width + cursor.x - drag.cursor.x),height:Math.max(media ? 90 : panel ? 160 : 180,drag.bounds.height + cursor.y - drag.cursor.y)};
    if (panel) panel.size = size; else if (media) mediaSize = size; else overtimeSize = size;
    target.setContentBounds({ ...drag.bounds, ...size });
  }
  else if (phase === 'end' && drag?.target === target) drag = null;
});
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    const dataDir = app.getPath('userData'), secretPath = path.join(dataDir, 'credentials.bin');
    diagnostics=require('./lib/diagnostics.cjs').createDiagnostics(dataDir);
    await diagnostics.ready;
    stopDiagnostics=require('./lib/desktop-diagnostics.cjs').monitorDesktop(app,diagnostics);
    const secrets = {
      load: async () => {
        try { return JSON.parse(safeStorage.decryptString(await fs.readFile(secretPath))); }
        catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('授权文件无法读取，原文件已保留'); }
      },
      save: async data => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭证加密不可用，无法保存授权');
        const temp = `${secretPath}.tmp`; await fs.writeFile(temp, safeStorage.encryptString(JSON.stringify(data))); await fs.rename(temp, secretPath);
      }
    };
    const douyin=require('./lib/douyin-desktop.cjs').createDouyinDesktop({BrowserWindow,session});
    app.on('before-quit',()=>douyin.close());
    runtime = await startServer({ dataDir, secrets, douyin, diagnostics, openLogs:async logDir=>{const error=await shell.openPath(logDir);if(error)throw new Error(error);}, port: 3181, overtimeLegacyFiles:[path.join(app.getPath('appData'), '小萝卜巨无霸加班机', 'config.json')],feedingLegacyFiles:[path.join(app.getPath('documents'),'ChatGPT','B站弹幕小游戏','config.json')] });
    const boundsPath = path.join(dataDir, 'overtime-window.json');
    const loadBounds = async file => {
      const bounds = await fs.readFile(file,'utf8').then(JSON.parse).catch(() => ({}));
      return ['x','y','width','height'].every(key => Number.isInteger(bounds[key])) && bounds.width > 0 && bounds.height > 0 && screen.getAllDisplays().some(({workArea:r}) => bounds.x < r.x+r.width && bounds.x+bounds.width > r.x && bounds.y < r.y+r.height && bounds.y+30 > r.y) ? bounds : {};
    };
    let overtimeBounds = await loadBounds(boundsPath);
    const panelBounds = new Map();
    for (const panel of runtime.overtime.state.config.gift_panels) panelBounds.set(panel.id,await loadBounds(path.join(dataDir,`gift-panel-${panel.id}-window.json`)));
    const mediaBoundsPath = path.join(dataDir,'overtime-media-window.json');
    let mediaBounds = await loadBounds(mediaBoundsPath);
    const quitIfOnlyMedia = () => { if (BrowserWindow.getAllWindows().every(win => win === mediaWindow)) app.quit(); };
    const showMedia = cue => {
      if (closing) return;
      if (!cue) { mediaWindow?.hide(); return; }
      if (mediaWindow && !mediaWindow.isDestroyed()) { mediaWindow.showInactive(); return; }
      mediaSize = {width:mediaBounds.width || 640,height:mediaBounds.height || 360};
      const workArea = screen.getPrimaryDisplay().workArea;
      mediaWindow = new BrowserWindow({title:'加班机 · 图片和视频',x:workArea.x+workArea.width-mediaSize.width-30,y:workArea.y+30,...mediaBounds,...mediaSize,useContentSize:true,minWidth:160,minHeight:90,show:false,frame:false,thickFrame:false,transparent:true,alwaysOnTop:true,resizable:true,autoHideMenuBar:true,backgroundColor:'#00000000',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required',preload:path.join(__dirname,'overtime-preload.cjs')}});
      const child = mediaWindow, url = runtime.url+'/overtime/?media=1';
      child.webContents.setWindowOpenHandler(() => ({action:'deny'}));
      child.webContents.on('will-navigate',(event,nextUrl) => {if(nextUrl !== url)event.preventDefault();});
      child.on('close',() => {mediaBounds={...child.getBounds(),...mediaSize};fs.writeFile(mediaBoundsPath,JSON.stringify(mediaBounds)).catch(error=>showError('素材浮窗位置保存失败',error));});
      child.on('closed',() => {mediaWindow=null;if(drag?.target===child)drag=null;quitIfOnlyMedia();});
      child.loadURL(url).then(() => {if(!child.isDestroyed() && runtime.overtime.mediaCue && !closing)child.showInactive();}).catch(error => {if(!closing)showError('素材浮窗加载失败',error);});
    };
    runtime.onOvertimeMedia(showMedia);
    window = new BrowserWindow({ width: 1280, height: 880, minWidth: 920, minHeight: 700, show: false, title: '小萝卜游戏控制台', icon: path.join(__dirname, 'public', 'app-icon.ico'), backgroundColor: '#dfebf7', autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' } });
    window.webContents.setWindowOpenHandler(({ url }) => {
      const panel = runtime.overtime.state.config.gift_panels.find(panel => url === `${runtime.url}/overtime/?panel=${panel.id}`);
      if (panel) {
        const existing = panelWindows.get(panel.id);
        if (existing?.window && !existing.window.isDestroyed()) { existing.window.show(); existing.window.focus(); return {action:'deny'}; }
        const bounds = panelBounds.get(panel.id) || {}, size = {width:bounds.width || 640,height:bounds.height || 360};
        panelWindows.set(panel.id,{url,size,window:null});
        return {action:'allow',overrideBrowserWindowOptions:{title:`${panel.name} · 礼物面板`,...bounds,...size,useContentSize:true,minWidth:240,minHeight:160,frame:false,thickFrame:false,transparent:true,alwaysOnTop:true,resizable:true,autoHideMenuBar:true,backgroundColor:'#00000000',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,preload:path.join(__dirname,'overtime-preload.cjs')}}};
      }
      if (url === runtime.url + '/overtime/') {
        if (overtimeWindow && !overtimeWindow.isDestroyed()) { overtimeWindow.show(); overtimeWindow.focus(); return { action:'deny' }; }
        overtimeSize = {width:overtimeBounds.width || 960,height:overtimeBounds.height || 320};
        return { action:'allow', overrideBrowserWindowOptions:{ title:'巨无霸加班机 · 浮窗', ...overtimeBounds, ...overtimeSize, useContentSize:true, minWidth:320, minHeight:180, frame:false, thickFrame:false, transparent:true, alwaysOnTop:true, resizable:true, autoHideMenuBar:true, backgroundColor:'#00000000', webPreferences:{ contextIsolation:true, nodeIntegration:false, sandbox:true, backgroundThrottling:false, autoplayPolicy:'no-user-gesture-required', preload:path.join(__dirname,'overtime-preload.cjs') } } };
      }
      if(url===runtime.url+'/feeding/')return {action:'allow',overrideBrowserWindowOptions:{title:'小萝卜吃吃吃 · 网页操作',width:1280,height:760,useContentSize:true,autoHideMenuBar:true,backgroundColor:'#e8ede8',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}}};
      if(url===runtime.url+'/number-bomb/')return {action:'allow',overrideBrowserWindowOptions:{title:'数字炸弹 · 直播画面',width:1280,height:720,useContentSize:true,autoHideMenuBar:true,backgroundColor:'#f6f1e7',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}}};
      if([runtime.url+'/lottery/',...['wheel','duel','scratch'].map(mode=>runtime.url+'/lottery/?game='+mode)].includes(url))return {action:'allow',overrideBrowserWindowOptions:{title:'抽奖工具 · 直播画面',width:1280,height:720,useContentSize:true,autoHideMenuBar:true,backgroundColor:'#f7f3e8',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}}};
      return url.startsWith(runtime.url + '/noodle/') ? { action:'allow', overrideBrowserWindowOptions:{ title:'弹幕面馆', width:1920, height:1080, useContentSize:true, autoHideMenuBar:true, backgroundColor:'#f6e5c4', webPreferences:{ contextIsolation:true, nodeIntegration:false, sandbox:true, backgroundThrottling:false } } } : { action:'deny' };
    });
    window.webContents.on('did-create-window', (child, details) => {
      const entry = Array.from(panelWindows).find(([,record]) => record.url === details.url);
      if (entry) {
        const [id,record] = entry; record.window = child;
        child.webContents.setWindowOpenHandler(() => ({action:'deny'}));
        child.webContents.on('will-navigate',(event,url) => {if(url !== record.url)event.preventDefault();});
        child.on('close',() => {const bounds = {...child.getBounds(),...record.size}; panelBounds.set(id,bounds); fs.writeFile(path.join(dataDir,`gift-panel-${id}-window.json`),JSON.stringify(bounds)).catch(error => showError('礼物面板位置保存失败',error));});
        child.on('closed',() => {panelWindows.delete(id); if(drag?.target === child)drag = null; quitIfOnlyMedia();});
        return;
      }
      if (details.url !== runtime.url + '/overtime/') return;
      overtimeWindow = child;
      child.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
      child.webContents.on('will-navigate', (event, url) => { if (url !== runtime.url + '/overtime/') event.preventDefault(); });
      child.on('close', () => { overtimeBounds = {...child.getBounds(),...overtimeSize}; fs.writeFile(boundsPath, JSON.stringify(overtimeBounds)).catch(error => showError('浮窗位置保存失败', error)); });
      child.on('closed', () => { overtimeWindow = null; if(drag?.target===child)drag=null; quitIfOnlyMedia(); });
    });
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(runtime.url + '/')) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_contents, permission, callback, details) => callback(permission === 'clipboard-sanitized-write' && details.requestingUrl.startsWith(runtime.url + '/')));
    window.webContents.session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => permission === 'clipboard-sanitized-write' && requestingOrigin === runtime.url);
    window.webContents.session.on('will-download', (_event, item) => {
      const source = item.getURL();
      if (!source.startsWith(runtime.url + '/') && !source.startsWith('blob:' + runtime.url + '/')) { item.cancel(); return; }
    });
    await window.loadURL(runtime.url);
    window.on('closed',quitIfOnlyMedia);
    window.show();
  }).catch(async error => {showError('控制台启动失败',error);stopDiagnostics?.();await diagnostics?.close().catch(()=>{});app.quit();});
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (!runtime || closing) return;
    event.preventDefault(); closing = true;stopDiagnostics?.();
    runtime.close().catch(error => showError('加班记录保存失败', error)).finally(async () => {stopDiagnostics?.();await diagnostics?.close().catch(()=>{});app.quit();});
  });
}
