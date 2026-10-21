import { $, giftById, escapeHtml, image, toast, api, setPlatform } from './console-shared.js';
export let state, gifts = [], currentGift;
let events = [], filter = 'all', coin = 'all', visible = 72, loginTimer, loginRun = 0;
const eventRows = new Map();
let eventTimer, stateUiStamp = '';
const eventTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function scheduleEvents() {
  if (eventTimer) return;
  eventTimer = setTimeout(() => { eventTimer = null; renderEvents(); }, 150);
}
const emptyMarkup = '<div class="empty-state"><div class="empty-icon"><svg><use href="#i-chat"/></svg></div><strong>等待第一条消息</strong><span>连接直播间后，弹幕和礼物会出现在这里</span></div>';
const price = gift => gift.coinType==='douyin'?`${gift.price.toLocaleString()} 抖币`:gift.coinType === 'silver' ? `${gift.price.toLocaleString()} 银瓜子` : `¥${(gift.price / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 3 })}`;
function status(el, value) {
  el.className = `status ${value}`;
  el.textContent = { disconnected: '未连接', connecting: '连接中', connected: '已连接', authorizing: '等待授权', reconnecting: '重连中', error: '连接失败' }[value] || '未连接';
}
function renderState(next) {
  if(state&&(state.config.platform||'bilibili')!==(next.config.platform||'bilibili')){location.reload();return;}
  const first = !state; state = next;
  const douyin=state.config.platform==='douyin';setPlatform(douyin?'douyin':'bilibili');
  $('#chat-count').textContent = state.stats.chat; $('#received-gift-count').textContent = state.stats.gift;
  const stamp = JSON.stringify([state.version, state.config, state.live, state.account, state.gifts]);
  if (stamp === stateUiStamp) return;
  stateUiStamp = stamp;
  $('#live-platform').value=douyin?'douyin':'bilibili';
  $('#live-heading').textContent=douyin?'抖音直播':'B 站直播';
  $('#platform-pill-label').textContent=douyin?'抖音直播':'B 站直播';
  $('.live-card .bili-tile').textContent=douyin?'抖':'B';
  $('#platform-note').textContent=douyin?'先登录抖音，关闭登录窗口后连接网页版直播间。礼物需要有效登录态。':'切换平台会暂停当前玩法；两平台的礼物、店铺配置和统计分别保存。';
  $('[data-coin="gold"]').hidden=douyin;
  $('#app-version').textContent = state.version ? `小萝卜 · v${state.version}` : '小萝卜';
  if (first) $('#room-input').value = state.config.room;
  status($('#live-status'), state.live.status);
  const liveBusy = ['connecting', 'reconnecting'].includes(state.live.status);
  $('#live-button').innerHTML = `${state.live.status === 'connected' ? '断开直播间' : state.live.status === 'reconnecting' ? '停止重连' : liveBusy ? '取消连接' : '连接直播间'}<svg><use href="#i-arrow"/></svg>`;
  $('#live-note').textContent = state.live.error || (state.live.status === 'connected' ? `房间 ${state.live.roomId} · ${state.live.liveStatus === 1 ? '直播中' : '未开播，等待消息'}` : '等待连接');
  $('#live-note').classList.toggle('error', state.live.status === 'error');
  $('#account-status').textContent = state.account.loggedIn ? state.account.name || '已登录' : '游客模式';
  $('#login-button').innerHTML = `${douyin?'登录抖音':state.account.loggedIn ? '切换账号' : '扫码登录'} <span>↗</span>`;
  $('#room-title').textContent = state.live.status === 'connected' ? state.live.title || `房间 ${state.live.roomId}` : '等待直播间连接';
  $('.live-indicator').classList.toggle('on', state.live.status === 'connected');
  $('#gift-total').textContent = state.gifts.count.toLocaleString(); $('#library-total').textContent = state.gifts.count.toLocaleString();
  const date = state.gifts.updatedAt ? new Date(state.gifts.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  $('#gift-note').textContent = state.gifts.syncing ? '正在同步礼物与图片…' : state.gifts.error || (date ? `已同步 ${date} · ${state.gifts.cached} 张图片` : '点击刷新，同步礼物');
  $('#gift-note').classList.toggle('warning', Boolean(state.gifts.error));
  $('#library-date').textContent = douyin?`抖音礼物 · 价格单位为抖币${date?' · 最近同步 '+date:''}`:date ? `最近同步 ${date} · 仅付费礼物，同名同价已合并` : '仅保留付费礼物，同名同价已合并。';
  $('#sync-button').disabled = $('#library-sync').disabled = state.gifts.syncing;
  window.dispatchEvent(new CustomEvent('console-state', { detail: state }));
}
async function loadGifts() {
  gifts = await api('/api/gifts');
  giftById.clear();
  for (const gift of gifts) for (const id of [gift.id, ...(gift.alias_ids || [])]) giftById.set(id, gift);
  window.dispatchEvent(new Event('gifts-loaded'));
  const favorites = ['小花花', '牛哇牛哇', '打call', '干杯', '辣条', '爱心', '小心心'];
  const preview = favorites.map(name => gifts.find(g => g.name === name && g.icon)).filter(Boolean);
  for (const gift of gifts) { if (preview.length >= 4) break; if (gift.icon && !preview.includes(gift)) preview.push(gift); }
  $('#gift-preview').innerHTML = preview.slice(0, 4).map(g => `<button class="preview-gift" data-gift="${g.id}" title="${escapeHtml(g.name)}" aria-label="查看${escapeHtml(g.name)}"><img loading="lazy" src="${image(g)}" alt="${escapeHtml(g.name)}"></button>`).join('');
  renderGifts();
}
const navigation=$('.nav'),navMore=$('#nav-more'),navOverflow=$('#nav-overflow'),navItems=Array.from(navigation.querySelectorAll('.nav-item'));
function layoutNavigation(){
  const focused=document.activeElement,wasFocused=navigation.contains(focused);
  for(const item of navItems)navigation.insertBefore(item,navMore);
  navMore.hidden=true;
  const style=getComputedStyle(navigation),gap=parseFloat(style.columnGap)||0,available=navigation.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
  const widths=new Map(navItems.map(item=>[item,item.getBoundingClientRect().width]));
  if(navItems.reduce((sum,item)=>sum+widths.get(item),0)+gap*(navItems.length-1)>available){
    navMore.hidden=false;
    const active=navItems.find(item=>item.classList.contains('active'))||navItems[0],visible=new Set();
    let used=navMore.getBoundingClientRect().width;
    for(const item of [active,...navItems.filter(item=>item!==active)]){
      if(used+gap+widths.get(item)>available)break;
      visible.add(item);used+=gap+widths.get(item);
    }
    for(const item of navItems)if(!visible.has(item))navOverflow.append(item);
  }else navMore.open=false;
  if(wasFocused&&focused.isConnected){if(focused.parentElement===navOverflow&&!navMore.open)navMore.querySelector('summary').focus();else focused.focus({preventScroll:true});}
}
new ResizeObserver(layoutNavigation).observe(navigation);
new MutationObserver(layoutNavigation).observe(navigation,{characterData:true,subtree:true});
document.fonts.ready.then(layoutNavigation);
document.addEventListener('click',event=>{if(!navMore.contains(event.target))navMore.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&navMore.open){navMore.open=false;navMore.querySelector('summary').focus();event.preventDefault();}});
function syncPreviewFrames(view) {
  for(const [id,target] of [['noodle-frame','noodle'],['feeding-frame','feeding'],['overtime-frame','overtime'],['overtime-media-frame','overtime'],['bomb-frame','number-bomb'],['lottery-frame','lottery']]) {
    const frame=$('#'+id);
    if(view===target){if(frame.getAttribute('src')!==frame.dataset.src)frame.src=frame.dataset.src;}
    else if(frame.hasAttribute('src'))frame.removeAttribute('src');
  }
}
export function switchView(view) {
  history.replaceState(null, '', view === 'console' ? '/' : `/#${view}`);
  $('#console-view').hidden = view !== 'console'; $('#gifts-view').hidden = view !== 'gifts';
  $('#noodle-view').hidden = view !== 'noodle';
  $('#presets-view').hidden = view !== 'presets';
  $('#overtime-view').hidden = view !== 'overtime';
  $('#gift-rules-view').hidden = view !== 'gift-rules';
  $('#feeding-view').hidden = view !== 'feeding';
  $('#lottery-view').hidden = view !== 'lottery';
  $('#bomb-view').hidden = view !== 'number-bomb';
  syncPreviewFrames(view);
  $('#lottery-frame').contentWindow.postMessage({type:'lottery-preview-visibility',visible:view==='lottery'},location.origin);
  $('#feeding-frame').contentWindow.postMessage({type:'feeding-preview-visibility',visible:view==='feeding'},location.origin);
  $('#noodle-frame').contentWindow.postMessage({ type: 'noodle-preview-visibility', visible: view === 'noodle' }, location.origin);
  for(const id of ['#overtime-frame','#overtime-media-frame']) $(id).contentWindow.postMessage({type:'overtime-preview-visibility',visible:view==='overtime'},location.origin);
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  navMore.open=false;layoutNavigation();
  if (view === 'gifts') { renderGifts(); window.scrollTo(0, 0); }
  else $('#gift-grid').replaceChildren();
  if (view === 'console') renderEvents();
  else { eventRows.clear(); $('#events-list').replaceChildren(); }
  window.dispatchEvent(new CustomEvent('view-changed', { detail:view }));
}
function renderGifts() {
  if ($('#gifts-view').hidden) return;
  const query = $('#gift-search').value.trim().toLowerCase();
  const list = gifts.filter(g => (coin === 'all' || g.coinType === coin) && (!query || g.name.toLowerCase().includes(query) || String(g.id).includes(query) || g.alias_ids?.some(id => String(id).includes(query))));
  const sort = $('#gift-sort').value;
  list.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'zh-CN') : sort === 'price-desc' ? (a, b) => b.price - a.price : (a, b) => a.price - b.price);
  $('#gift-grid').innerHTML = list.slice(0, visible).map(g => `<button class="gift-item" data-gift="${g.id}" title="${escapeHtml(g.name)}"><img src="${g.icon ? image(g) : '/logo.svg'}" alt="${escapeHtml(g.name)}" loading="lazy"><strong>${escapeHtml(g.name)}</strong><span>${price(g)}</span><span class="gift-id">ID ${g.id}</span></button>`).join('');
  $('#load-more').hidden = visible >= list.length;
  $('#gift-results').textContent = list.length ? `显示 ${Math.min(visible, list.length)} / ${list.length} 种礼物` : '没有找到这个礼物';
}
function openGift(id) {
  currentGift = giftById.get(Number(id)); if (!currentGift) return;
  if (!window.dispatchEvent(new CustomEvent('gift-picked', { detail:currentGift, cancelable:true }))) return;
  $('#gift-detail').innerHTML = `<img loading="lazy" class="detail-image" src="${currentGift.icon ? image(currentGift) : '/logo.svg'}" alt="${escapeHtml(currentGift.name)}"><h2>${escapeHtml(currentGift.name)}</h2><p class="detail-price">${price(currentGift)}</p><p class="detail-id">B 站 · ID ${currentGift.id}</p><div class="detail-filename">礼物 ID 与图片可直接用于后续配置</div>`;
  $('#gift-detail .detail-id').textContent=`${state.config.platform==='douyin'?'抖音':'B站'} · ID ${currentGift.id}`;
  $('#download-gift').href = `${image(currentGift)}&download=1`; $('#download-gift').hidden = !currentGift.icon;
  $('#gift-dialog').showModal();
}
function renderEvents() {
  const list = events.filter(event => filter === 'all' || event.type === filter);
  const container=$('#events-list'), shown=new Set(list);
  for (const [event,row] of eventRows) if (!shown.has(event)) { row.remove(); eventRows.delete(event); }
  if ($('#console-view').hidden || document.hidden) return;
  if (!list.length) { container.innerHTML=emptyMarkup; return; }
  container.querySelector('.empty-state')?.remove();
  list.forEach((event,index) => {
    let row=eventRows.get(event);
    if (!row) {
      const holder=document.createElement('div');
      const giftImage = event.type === 'gift' ? giftById.get(event.giftId) : null;
      holder.innerHTML=`<div class="event-row ${escapeHtml(event.type)}"><div class="event-avatar">${giftImage?.icon ? `<img loading="lazy" src="${image(giftImage)}" alt="">` : escapeHtml(event.user ? Array.from(event.user)[0] : '·')}</div><span class="event-name">${escapeHtml(event.user || '系统')}</span><span class="event-text">${escapeHtml(event.text)}</span><time class="event-time">${eventTime.format(event.time)}</time></div>`;
      row=holder.firstElementChild;eventRows.set(event,row);
    }
    if (container.children[index]!==row) container.insertBefore(row,container.children[index] || null);
  });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleEvents(); });
$('#noodle-frame').addEventListener('load', () => $('#noodle-frame').contentWindow.postMessage({ type: 'noodle-preview-visibility', visible: !$('#noodle-view').hidden }, location.origin));
for(const id of ['#overtime-frame','#overtime-media-frame']) $(id).addEventListener('load', () => $(id).contentWindow.postMessage({type:'overtime-preview-visibility',visible:!$('#overtime-view').hidden},location.origin));
async function syncGifts() {
  try { const result = await api('/api/gifts/sync', { room: $('#room-input').value.trim() }); await loadGifts(); toast(`已同步 ${result.count} 种礼物${state.config.platform==='douyin'?'，图片按需缓存':result.failed ? `，${result.failed} 张图片待重试` : '与图片'}`); }
  catch (error) { toast(error.message, true); }
}
async function refreshQr() {
  const run = ++loginRun; clearTimeout(loginTimer); $('#qr-container').textContent = ''; $('#qr-status').textContent = '正在获取二维码…';
  try {
    const qr = await api('/api/login/qr', {}); if (run !== loginRun || !$('#login-dialog').open) return;
    const img = document.createElement('img'); img.src = qr.image; img.alt = 'B站登录二维码'; $('#qr-container').replaceChildren(img); $('#qr-status').textContent = '等待扫码';
    async function poll() {
      if (run !== loginRun || !$('#login-dialog').open) return;
      try {
        const result = await api('/api/login/poll', {});
        if (run !== loginRun || !$('#login-dialog').open) return;
        if (result.code === 0) { $('#login-dialog').close(); toast('B 站登录成功'); return; }
        $('#qr-status').textContent = result.code === 86090 ? '已扫码，请在手机上确认' : result.code === 86038 ? '二维码已过期，请刷新' : '等待扫码';
        if (result.code !== 86038) loginTimer = setTimeout(poll, 2000);
      } catch (error) { $('#qr-status').textContent = error.message; }
    }
    loginTimer = setTimeout(poll, 2000);
  } catch (error) { if (run === loginRun) $('#qr-status').textContent = error.message; }
}
document.addEventListener('click', event => {
  const view = event.target.closest('[data-view]'); if (view) switchView(view.dataset.view);
  const gift = event.target.closest('[data-gift]'); if (gift) openGift(gift.dataset.gift);
  const close = event.target.closest('[data-close]'); if (close) $(`#${close.dataset.close}`).close();
  const messageFilter = event.target.closest('[data-filter]');
  if (messageFilter) { filter = messageFilter.dataset.filter; document.querySelectorAll('[data-filter]').forEach(el => el.classList.toggle('active', el === messageFilter)); renderEvents(); }
  const coinFilter = event.target.closest('[data-coin]');
  if (coinFilter) { coin = coinFilter.dataset.coin; visible = 72; document.querySelectorAll('[data-coin]').forEach(el => el.classList.toggle('active', el === coinFilter)); renderGifts(); }
});
$('#live-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api(`/api/live/${['connected', 'connecting', 'reconnecting'].includes(state.live.status) ? 'disconnect' : 'connect'}`, { room: $('#room-input').value.trim() }); }
  catch (error) { toast(error.message, true); }
});
$('#sync-button').addEventListener('click', syncGifts); $('#library-sync').addEventListener('click', syncGifts);
$('#gift-search').addEventListener('input', () => { visible = 72; renderGifts(); });
$('#gift-sort').addEventListener('change', () => { visible = 72; renderGifts(); });
$('#load-more').addEventListener('click', () => { visible += 72; renderGifts(); });
$('#settings-button').addEventListener('click', async () => {
  $('#settings-dialog').showModal();
  try{
    const info=await api('/api/diagnostics/info');
    $('#diagnostics-status').textContent=info.enabled?(info.lastError?`日志写入异常：${info.lastError}；目录：${info.logDir}`:`日志已开启：${info.logDir}`):'当前运行未开启诊断日志';
    $('#diagnostics-open').disabled=!info.enabled||!info.canOpen;
    $('#diagnostics-export').hidden=!info.enabled;
  }catch(error){$('#diagnostics-status').textContent='无法读取日志状态：'+error.message;}
});
$('#diagnostics-open').addEventListener('click', async () => {try{await api('/api/diagnostics/open',{});}catch(error){toast(error.message,true);}});
$('#import-config').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 100000) throw new Error('配置文件过大'); await api('/api/config/import', JSON.parse(await file.text())); const next = (await api('/api/state')).state; $('#room-input').value = next.config.room; $('#settings-dialog').close(); toast('配置已导入'); }
  catch (error) { toast(error.message || '配置文件无效', true); } finally { event.target.value = ''; }
});
$('#copy-gift').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(JSON.stringify({ platform: state.config.platform||'bilibili', id: currentGift.id, name: currentGift.name, price: currentGift.price, coinType: currentGift.coinType, image: image(currentGift), sourceImage: currentGift.icon }, null, 2)); toast('礼物信息已复制'); }
  catch { toast('复制失败，请使用导出礼物', true); }
});
$('#clear-events').addEventListener('click', async () => { try { await api('/api/events/clear', {}); events = []; renderEvents(); } catch (error) { toast(error.message, true); } });
$('#login-button').addEventListener('click', async () => {
  if(state.config.platform==='douyin'){
    const button=$('#login-button');button.disabled=true;
    try{toast('请在抖音窗口完成登录，关闭该窗口后返回连接直播间');await api('/api/login/douyin',{});renderState((await api('/api/state')).state);}catch(error){toast(error.message,true);}finally{button.disabled=false;}
  }else{$('#login-dialog').showModal();refreshQr();}
});
$('#live-platform').addEventListener('change',async event=>{
  event.target.disabled=true;
  try{await api('/api/platform',{platform:event.target.value});location.reload();}catch(error){event.target.value=state.config.platform||'bilibili';event.target.disabled=false;toast(error.message,true);}
});
$('#qr-refresh').addEventListener('click', refreshQr);
$('#login-dialog').addEventListener('close', () => { loginRun++; clearTimeout(loginTimer); });
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
document.addEventListener('error', event => {
  if (!(event.target instanceof HTMLImageElement)) return;
  if (event.target.classList.contains('overtime-avatar')) { if (!event.target.src.endsWith('/overtime/radish.svg')) event.target.src = '/overtime/radish.svg'; return; }
  if (!event.target.src.endsWith('/logo.svg') && !event.target.src.startsWith('data:')) { event.target.src = '/logo.svg'; event.target.title = '图片暂未下载'; }
}, true);
try { document.body.classList.toggle('dark', localStorage.getItem('theme') === 'dark'); } catch {}
$('#theme-button').addEventListener('click', () => { const dark = document.body.classList.toggle('dark'); try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {} });
if (['noodle', 'presets', 'gifts', 'overtime', 'gift-rules','feeding','lottery','number-bomb'].includes(location.hash.slice(1))) switchView(location.hash.slice(1));
else syncPreviewFrames('console');
(async () => {
  try {
    const initial = await api('/api/state'); renderState(initial.state); events = initial.events; renderEvents(); await loadGifts();
    const source = new LuoboEvents('/api/events?console=1');
    source.addEventListener('state', event => renderState(JSON.parse(event.data)));
    source.addEventListener('noodle', event => window.dispatchEvent(new CustomEvent('noodle-state', { detail: JSON.parse(event.data) })));
    source.addEventListener('overtime', event => window.dispatchEvent(new CustomEvent('overtime-state', { detail: JSON.parse(event.data) })));
    source.addEventListener('feeding', event => window.dispatchEvent(new CustomEvent('feeding-state', {detail:JSON.parse(event.data)})));
    source.addEventListener('lottery', event => window.dispatchEvent(new CustomEvent('lottery-state', {detail:JSON.parse(event.data)})));
    source.addEventListener('number-bomb', event => window.dispatchEvent(new CustomEvent('number-bomb-state', {detail:JSON.parse(event.data)})));
    source.addEventListener('overtime-clock', event => window.dispatchEvent(new CustomEvent('overtime-clock', { detail: JSON.parse(event.data) })));
    source.addEventListener('message', event => { events.unshift(JSON.parse(event.data)); events.length = Math.min(events.length, 200); scheduleEvents(); });
    source.onopen = async () => { $('#service-dot').classList.remove('off'); $('#service-label').textContent = '本地运行'; try { const next = await api('/api/state'); renderState(next.state); events = next.events; renderEvents(); } catch {} };
    source.onerror = () => { $('#service-dot').classList.add('off'); $('#service-label').textContent = '本地服务重连中'; };
  } catch (error) { toast(`加载失败：${error.message}`, true); }
})();
