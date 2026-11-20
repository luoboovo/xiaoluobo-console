const { douyinRoom,parseRoomHtml,requestDouyin } = require('./douyin.cjs');

// 直播流（视频/音频）请求：隐藏网页一律不拉，既省流量也不会在后台出声。
function isStream(url){
  try{const u=new URL(url);return u.hostname.startsWith('pull-')||/\.(?:flv|m3u8|ts|m4s|mp4|aac|mp3)$/i.test(u.pathname);}catch{return false;}
}
// 在抖音直播网页里找评论输入框并聚焦、全选（之后用 insertText 覆盖输入）。在网页里执行，只动这个输入框。
const FIND_EDITOR=`(()=>{
  const seen=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  const verify=document.querySelector('#captcha_container,.captcha_verify_container,iframe[src*="verify"]');
  if(verify&&seen(verify))return {state:'verify'};
  const list=[...document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable="plaintext-only"]')]
    .filter(e=>seen(e)&&!e.closest('#douyin-header,#HeaderLayout,[data-e2e="searchbar-input"]'));
  const hint=e=>(e.getAttribute('placeholder')||e.getAttribute('data-placeholder')||e.getAttribute('aria-label')||'')+(e.closest('#RightPanelLayout,[class*="chatroom"],[class*="ChatRoom"],[class*="chat-room"]')?' 聊天区':'');
  const editor=list.find(e=>/说点什么|聊|评论|互动|发送|聊天区/.test(hint(e)))||list[list.length-1];
  if(!editor){
    const login=[...document.querySelectorAll('#RightPanelLayout button,#RightPanelLayout a,#RightPanelLayout p,#RightPanelLayout span')].some(e=>seen(e)&&/^登录/.test(e.textContent.trim()));
    return {state:login?'login':'missing'};
  }
  document.querySelectorAll('[data-xlb-editor]').forEach(e=>e.removeAttribute('data-xlb-editor'));
  editor.setAttribute('data-xlb-editor','1');
  editor.scrollIntoView({block:'center'});editor.focus();
  if(editor.tagName==='TEXTAREA')editor.select();
  else{const range=document.createRange();range.selectNodeContents(editor);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);}
  return {state:'ready'};
})()`;
// 评论框里现在的文字（找评论框时做了标记，不依赖焦点）。
const EDITOR_TEXT=`(()=>{const e=document.querySelector('[data-xlb-editor]');if(!e)return {text:null,xlbState:1};return {text:(e.tagName==='TEXTAREA'?e.value:e.innerText||e.textContent||'').trim(),xlbState:1};})()`;
// 输入没进去时，直接在网页里填字（模拟输入事件，React 能收到）。
const FILL_EDITOR=text=>`(()=>{const e=document.querySelector('[data-xlb-editor]');if(!e)return false;const text=${JSON.stringify(text)};e.focus();
  if(e.tagName==='TEXTAREA'){const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(e,'');if(!document.execCommand('insertText',false,text)){set.call(e,text);e.dispatchEvent(new InputEvent('input',{bubbles:true,data:text,inputType:'insertText'}));}}
  else{const r=document.createRange();r.selectNodeContents(e);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);if(!document.execCommand('insertText',false,text)){e.textContent=text;e.dispatchEvent(new InputEvent('input',{bubbles:true,data:text,inputType:'insertText'}));}}
  return true;})()`;
// 评论框旁边「发送」按钮的位置（页面坐标），找不到返回 null。
const SEND_BUTTON=`(()=>{const e=document.querySelector('[data-xlb-editor]');if(!e)return null;let box=e.parentElement;
  for(let i=0;i<6&&box;i++,box=box.parentElement){
    const b=[...box.querySelectorAll('button,[role="button"],div,span')].find(b=>b!==e&&!b.contains(e)&&!e.contains(b)&&b.children.length<=2&&(/^发送$/.test(b.textContent.trim())||/send-?btn|sendBtn|send_btn/i.test(String(b.className))));
    if(b){const r=b.getBoundingClientRect();if(r.width>0&&r.height>0)return {x:r.left+r.width/2,y:r.top+r.height/2,sendButton:1};}
  }return null;})()`;
const ENTER=String.fromCharCode(13);
const SEND_IDLE_MS=5*60*1000;
const failure=(message,code)=>Object.assign(new Error(message),{code});
// 网页卡住时 executeJavaScript 可能一直不返回；每次最多等 ms 毫秒。
function within(promise,ms,code='TIMEOUT'){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('抖音网页没有响应',code)),ms);timer.unref?.();})]).finally(()=>clearTimeout(timer));
}
const VERIFY_TEXT='抖音要求验证：请在控制台点「登录抖音」，在窗口里完成验证后再试';

// 网页只用于生成当前版本的连接参数；消息接收由 Node WebSocket 负责。
// 机器人在抖音发言时，另开一个静音、不拉直播流的隐藏网页，用登录的账号在评论框里打字发送；空闲 5 分钟或断开直播间就关掉。
function createDouyinDesktop({BrowserWindow,session,requestImpl=requestDouyin,sendTimeoutMs=10000,readyTimeoutMs=30000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  const partition='persist:xiaoluobo-douyin';
  const browserSession=session.fromPartition(partition);
  browserSession.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
  let loginWindow, bootstrapWindow, sender=null, sendChain=Promise.resolve(), generation=0;
  // 隐藏网页（连接用、发言用）的 webContents id → 用途；只对这些网页拦截图片、字体和直播流。
  const hidden=new Map();
  function watchHidden(){
    if(!hidden.size)return browserSession.webRequest.onBeforeRequest(null);
    browserSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
      const role=hidden.get(details.webContentsId);
      // 发言网页不需要实时消息长连接，消息由控制台自己的连接接收。
      callback({cancel:!!role&&(['media','image','font'].includes(details.resourceType)||isStream(details.url)||(role==='sender'&&details.url.includes('/webcast/im/push/')))});
    });
  }
  function hide(win,role){
    // 隐藏网页始终静音；万一有声音漏网也不会在后台响。
    win.webContents.setAudioMuted?.(true);
    const id=win.webContents.id;hidden.set(id,role);watchHidden();
    win.once('closed',()=>{hidden.delete(id);watchHidden();});
  }
  const trusted=url=>{try {const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='douyin.com'||u.hostname.endsWith('.douyin.com'));}catch{return false;}};
  function windowFor(show,{width=1100,height=800}={}) {
    const win=new BrowserWindow({width,height,show,title:show?'登录抖音 · 小萝卜':'连接抖音',autoHideMenuBar:true,webPreferences:{partition,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,webSecurity:true}});
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
    // 登录页首页会自动播推荐直播，静音免得吵。
    loginWindow.webContents.setAudioMuted?.(true);
    loginWindow.loadURL('https://live.douyin.com/').catch(()=>{});
    await new Promise(resolve=>loginWindow.once('closed',()=>{loginWindow=null;resolve();}));
  }
  function closeSender(){
    const s=sender;sender=null;if(!s)return;
    clearTimeout(s.idle);
    if(!s.win.isDestroyed())s.win.destroy();
  }
  function cancel() {generation++;if(bootstrapWindow&&!bootstrapWindow.isDestroyed())bootstrapWindow.destroy();closeSender();}
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
      hide(win,'bootstrap');
      const finish=(error,result)=>{
        if(done)return;done=true;clearTimeout(timer);
        browserSession.webRequest.onBeforeSendHeaders(null);
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
  // 打开（或复用）这个直播间的发言网页，等评论框出来。
  async function openSender(room){
    if(sender&&sender.room===room&&!sender.win.isDestroyed())return sender;
    closeSender();
    const win=windowFor(false,{width:1400,height:900}),s={room,win,results:[]};
    sender=s;hide(win,'sender');
    win.once('closed',()=>{if(sender===s)sender=null;});
    // 读评论接口的返回，判断发出去没有（抖音的签名和验证都由网页自己处理）。
    try{
      const dbg=win.webContents.debugger,pending=new Set();
      dbg.attach('1.3');
      dbg.on('message',(_event,method,params)=>{
        if(method==='Network.responseReceived'&&params.response?.url?.includes('/webcast/room/chat/'))pending.add(params.requestId);
        else if((method==='Network.loadingFinished'||method==='Network.loadingFailed')&&pending.delete(params.requestId)){
          const read=method==='Network.loadingFailed'?Promise.resolve({failed:true}):dbg.sendCommand('Network.getResponseBody',{requestId:params.requestId}).then(r=>{try{return JSON.parse(r.base64Encoded?Buffer.from(r.body,'base64').toString():r.body);}catch{return {};}}).catch(()=>({}));
          read.then(result=>{s.results.push(result);s.notify?.();});
        }
      });
      // 页面还没加载时 Network.enable 不返回，所以等评论框出来、发送前再打开（失败下次再试）。
      s.network=()=>s.networkOn||=within(dbg.sendCommand('Network.enable'),3000).then(()=>true,()=>{s.networkOn=null;return false;});
      // 隐藏窗口没有系统焦点，普通的键盘输入会被丢掉；用调试通道直接把输入送进网页，并让网页以为自己有焦点。
      s.cdp=(method,params)=>within(dbg.sendCommand(method,params),3000);
      s.focus=()=>s.focusOn||=s.cdp('Emulation.setFocusEmulationEnabled',{enabled:true}).then(()=>true,()=>{s.focusOn=null;return false;});
    }catch{}
    win.loadURL(`https://live.douyin.com/${room}`).catch(()=>{});
    const deadline=Date.now()+readyTimeoutMs;
    while(sender===s){
      let found;try{found=await within(win.webContents.executeJavaScript(FIND_EDITOR),5000);}catch{}
      if(found?.state==='ready')return s;
      if(found?.state==='verify'){closeSender();throw failure(VERIFY_TEXT,'VERIFY');}
      if(Date.now()>deadline){closeSender();throw found?.state==='login'?failure('抖音登录已失效，请在控制台重新点「登录抖音」','LOGIN'):failure('没找到抖音评论框（可能需要重新登录或验证）','NO_EDITOR');}
      await sleep(500);
    }
    throw failure('抖音发言已取消','CANCELLED');
  }
  async function sendOnce(room,text){
    const s=await openSender(room),win=s.win;
    clearTimeout(s.idle);
    try{
      const found=await within(win.webContents.executeJavaScript(FIND_EDITOR),5000);
      if(found?.state==='verify'){closeSender();throw failure(VERIFY_TEXT,'VERIFY');}
      if(found?.state!=='ready')throw failure('没找到抖音评论框，请稍后再试','NO_EDITOR');
      await s.network?.();await s.focus?.();
      s.results.length=0;
      const answered=new Promise(resolve=>{s.notify=resolve;});
      const run=code=>within(win.webContents.executeJavaScript(code),5000).catch(()=>null);
      const typed=async()=>(await run(EDITOR_TEXT))?.text;
      // 打字：优先走调试通道；没进去就在网页里直接填。
      try{if(s.cdp)await s.cdp('Input.insertText',{text});else await within(win.webContents.insertText(text),5000);}catch{}
      let filled=await typed();
      if(filled!==text){await run(FILL_EDITOR(text));filled=await typed();}
      if(filled!==text)throw failure(`抖音评论框输入不进去（${filled==null?'评论框不见了':`框里是 ${[...filled].length} 个字`}）`,'NO_INPUT');
      const press=async()=>{
        if(s.cdp){
          try{
            await s.cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:ENTER,unmodifiedText:ENTER});
            await s.cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
            return;
          }catch{}
        }
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
        win.webContents.sendInputEvent({type:'char',keyCode:ENTER});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
      };
      await press();
      // 回车没反应就点「发送」按钮（用真实的鼠标点击）。
      await sleep(800);
      let clicked=false;
      if(!s.results.length&&(await typed())){
        const button=await run(SEND_BUTTON);
        if(button&&s.cdp){
          try{
            for(const type of ['mouseMoved','mousePressed','mouseReleased'])await s.cdp('Input.dispatchMouseEvent',{type,x:button.x,y:button.y,button:type==='mouseMoved'?'none':'left',clickCount:type==='mouseMoved'?0:1});
            clicked=true;
          }catch{}
        }
      }
      let timer;
      const result=s.results[0]||await Promise.race([answered.then(()=>s.results[0]),new Promise(resolve=>{timer=setTimeout(resolve,sendTimeoutMs,'timeout');})]);
      clearTimeout(timer);s.notify=null;
      if(result&&result!=='timeout'){
        if(result.failed)throw failure('抖音评论请求失败，请检查网络','NETWORK');
        const status=Number(result.status_code??0);
        if(status!==0){
          const message=String(result.data?.prompts||result.data?.message||result.status_message||result.message||status).slice(0,80);
          throw failure(`抖音：${message}`,/频繁|太快|稍后/.test(message)?'RATE':status);
        }
        return {ok:true};
      }
      const verify=await within(win.webContents.executeJavaScript(FIND_EDITOR),5000).catch(()=>null);
      if(verify?.state==='verify'){closeSender();throw failure(VERIFY_TEXT,'VERIFY');}
      // 读不到接口返回（比如调试通道没接上），但输入框已清空，也算发出去了。
      const left=await typed();
      if(left===''&&!s.results.length)return {ok:true};
      throw failure(`抖音评论没发出去（按了回车${clicked?'、点了发送':''}，评论框${left==null?'不见了':`还剩 ${[...left].length} 个字`}）`,'NO_RESPONSE');
    }finally{
      if(sender===s){clearTimeout(s.idle);s.idle=setTimeout(()=>{if(sender===s)closeSender();},SEND_IDLE_MS);s.idle.unref?.();}
    }
  }
  // 用登录的抖音账号在直播间发一条评论；多条排队一条一条发。
  function send(input,text){
    let room;try{room=douyinRoom(input);}catch(error){return Promise.reject(error);}
    const content=String(text||'').trim();
    if(!content)return Promise.reject(failure('评论内容为空','EMPTY'));
    if([...content].length>50)return Promise.reject(failure('抖音评论最多 50 个字','TOO_LONG'));
    const job=sendChain.then(async()=>{
      if(!(await account()).loggedIn)throw failure('请先在控制台点「登录抖音」登录，机器人用这个账号发评论','LOGIN');
      return sendOnce(room,content);
    });
    sendChain=job.catch(()=>{});
    return job;
  }
  return {account,login,bootstrap,cancel,send,stopSending:closeSender,get sending(){return !!sender;},close(){cancel();if(loginWindow&&!loginWindow.isDestroyed())loginWindow.destroy();}};
}
module.exports={createDouyinDesktop};
