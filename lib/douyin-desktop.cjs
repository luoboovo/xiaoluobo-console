const { douyinRoom,parseRoomHtml,requestDouyin } = require('./douyin.cjs');

// 网页只用于生成当前版本的连接参数；消息接收由 Node WebSocket 负责。
function createDouyinDesktop({BrowserWindow,session,requestImpl=requestDouyin}) {
  const partition='persist:xiaoluobo-douyin';
  const browserSession=session.fromPartition(partition);
  browserSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  let loginWindow, bootstrapWindow, generation=0;
  const trusted=url=>{try {const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='douyin.com'||u.hostname.endsWith('.douyin.com'));}catch{return false;}};
  function windowFor(show) {
    const win=new BrowserWindow({width:1100,height:800,show,title:show?'登录抖音 · 小萝卜':'连接抖音',autoHideMenuBar:true,webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,webSecurity:true}});
    // app.setName 会把中文产品名加入 UA；登录页和 Worker 必须使用一致的浏览器标识。
    const userAgent=win.webContents.getUserAgent().replace(/\s(?:Electron|xiaoluobo-console|小萝卜游戏控制台)\/[\w.-]+/g,'');
    browserSession.setUserAgent(userAgent);
    win.webContents.setUserAgent(userAgent);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{if(!trusted(url))event.preventDefault();});
    return win;
  }
  async function account() {
    const cookies=await browserSession.cookies.get({domain:'.douyin.com'});
    const loggedIn=cookies.some(c=>['sessionid','sessionid_ss'].includes(c.name)&&c.value&&(!c.expirationDate||c.expirationDate>Date.now()/1000));
    return {loggedIn,name:loggedIn?'抖音登录态已保存':''};
  }
  async function login() {
    if(loginWindow&&!loginWindow.isDestroyed()){loginWindow.show();loginWindow.focus();return;}
    loginWindow=windowFor(true);
    loginWindow.loadURL('https://live.douyin.com/').catch(()=>{});
    await new Promise(resolve=>loginWindow.once('closed',()=>{loginWindow=null;resolve();}));
  }
  function cancel() {generation++;if(bootstrapWindow&&!bootstrapWindow.isDestroyed())bootstrapWindow.destroy();}
  async function bootstrap(input) {
    const room=douyinRoom(input);cancel();
    const attempt=generation;
    // 先检查开播状态，避免为已下播的房间启动渲染器和等待WebSocket。
    let initial;
    try{
      const cookies=await browserSession.cookies.get({url:'https://live.douyin.com/'});
      const cookie=cookies.map(c=>`${c.name}=${c.value}`).join('; ');
      initial=parseRoomHtml((await requestImpl(`https://live.douyin.com/${room}`,cookie)).body.toString());
    }catch{}
    if(attempt!==generation)throw new Error('抖音连接已取消');
    if(initial&&Number.isInteger(initial.status)&&initial.status!==2)throw new Error('该抖音直播间当前未开播，请开播后再连接');
    return new Promise((resolve,reject)=>{
      const win=bootstrapWindow=windowFor(false);let done=false,capturing=false;
      const finish=(error,result)=>{
        if(done)return;done=true;clearTimeout(timer);
        browserSession.webRequest.onBeforeSendHeaders(null);
        browserSession.webRequest.onBeforeRequest(null);
        if(!win.isDestroyed())win.destroy();if(bootstrapWindow===win)bootstrapWindow=null;
        if(error)reject(error);else resolve(result);
      };
      const timer=setTimeout(()=>finish(new Error('抖音未返回直播连接。请点击“登录抖音”完成登录或验证，关闭登录窗口后重试；并确认正在开播。')),45000);
      win.once('closed',()=>finish(new Error('抖音连接已取消')));
      win.webContents.once('dom-ready',()=>{
        win.webContents.executeJavaScript('document.documentElement.outerHTML').then(html=>{
          if(done||capturing)return;const info=parseRoomHtml(html);
          if(info&&Number.isInteger(info.status)&&info.status!==2)finish(new Error('该抖音直播间当前未开播，请开播后再连接'));
        }).catch(()=>{});
      });
      browserSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
        callback({cancel:details.webContentsId===win.webContents.id&&['media','image','font'].includes(details.resourceType)});
      });
      browserSession.webRequest.onBeforeSendHeaders({urls:['wss://*.douyin.com/*']},(details,callback)=>{
        if(details.webContentsId!==win.webContents.id||!details.url.includes('/webcast/im/push/'))return callback({requestHeaders:details.requestHeaders});
        if(capturing)return callback({cancel:true});capturing=true;
        const headers={};
        for(const [key,value]of Object.entries(details.requestHeaders))if(['cookie','user-agent','origin','referer'].includes(key.toLowerCase()))headers[key]=value;
        const url=new URL(details.url),title=win.getTitle().slice(0,200);
        callback({cancel:true});
        win.webContents.executeJavaScript('document.documentElement.outerHTML').then(html=>{
          if(done)return;
          const info=parseRoomHtml(html);
          if(!info||!Number.isInteger(info.status))return finish(new Error('未读到抖音直播间信息，请在登录窗口完成验证后重新连接'));
          if(info&&Number.isInteger(info.status)&&info.status!==2)return finish(new Error('该抖音直播间当前未开播，请开播后再连接'));
          finish(null,{url:url.href,headers,roomId:url.searchParams.get('room_id')||room,title:info?.title||title,liveStatus:info?.status===2?1:0});
        }).catch(()=>finish(new Error('无法读取抖音直播间信息，请重新连接')));
      });
      win.loadURL(`https://live.douyin.com/${room}`).catch(()=>{});
    });
  }
  return {account,login,bootstrap,cancel,close(){cancel();if(loginWindow&&!loginWindow.isDestroyed())loginWindow.destroy();}};
}
module.exports={createDouyinDesktop};
