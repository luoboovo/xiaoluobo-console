// 小萝卜弹幕姬：把弹幕排成微信聊天，礼物是红包，大额礼物和上舰是转账。
// 设置、背景和定制气泡都存在控制台里（弹幕姬页），这个画面连上就自动拿到。
// 地址参数：?preview=1 控制台预览用；?hd=2 高清渲染——排版和 420 × 720 一样，但按 2 倍像素画，
// 浏览器源设成 840 × 1440 再在 OBS 里缩小，字就不会因为小画面被拉大而发糊。
(function () {
  const params = new URLSearchParams(location.search), preview = params.has('preview');
  const hd = Math.min(4, Math.max(1, Number(params.get('hd')) || 1));
  if (hd > 1) { document.documentElement.style.setProperty('--hd', String(hd)); document.documentElement.classList.add('hd'); }
  const chat = document.getElementById('chat'), backdrop = document.getElementById('backdrop'), more = document.getElementById('more'), off = document.getElementById('off');
  let config = { theme: 'wechat', bg: true, size: 15, max: 40, fade: 0, big: 50, enter: false, social: true, like: false, device: 'iphone', group: '', badges: true };
  let bubbles = new Map(), enabled = true, liveTitle = '';

  // 微信群名：控制台填了就用填的，没填用直播间标题。
  function applyGroupName() { document.getElementById('group-name').textContent = config.group || liveTitle || '直播间'; }
  // 状态栏时间跟着电脑时间走。
  function tick() { const now = new Date(); document.getElementById('phone-clock').textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`; }
  tick(); setInterval(tick, 15000);
  function applySettings(next) {
    const badgesChanged = next && 'badges' in next && next.badges !== config.badges;
    config = { ...config, ...next };
    document.body.dataset.theme = config.theme;
    document.body.dataset.device = config.device || 'iphone';
    applyGroupName();
    if (badgesChanged) rerender();
    document.body.classList.toggle('transparent', !config.bg);
    document.documentElement.style.setProperty('--font-size', config.size + 'px');
    for (const skin of chat.querySelectorAll('.skin[data-bubble]')) { const bubble = bubbles.get(skin.dataset.bubble); if (bubble) styleSkin(skin, bubble); }
    trim();
  }
  // 背景图：铺满 / 完整显示 / 自定义（位置 + 缩放）。
  function applyBackground(bg = {}) {
    backdrop.hidden = !bg.image;
    if (!bg.image) return;
    backdrop.style.backgroundImage = `url("${bg.image}")`;
    backdrop.style.backgroundSize = bg.fit === 'custom' ? `${bg.scale}% auto` : bg.fit;
    backdrop.style.backgroundPosition = `${bg.x}% ${bg.y}%`;
    backdrop.style.opacity = String(bg.opacity / 100);
    backdrop.style.filter = bg.blur ? `blur(${bg.blur}px)` : '';
    backdrop.style.inset = bg.blur ? `-${bg.blur * 2}px` : '0';
  }
  function applyBubbles(list = []) {
    bubbles = new Map(list.map(b => [b.id, b]));
    for (const skin of chat.querySelectorAll('.skin[data-bubble]')) {
      const bubble = bubbles.get(skin.dataset.bubble);
      if (bubble) styleSkin(skin, bubble);
    }
  }
  function applyState(state) {
    if (!state) return;
    if (typeof state.liveTitle === 'string') { liveTitle = state.liveTitle; applyGroupName(); }
    if (state.settings) applySettings(state.settings);
    if ('background' in state) applyBackground(state.background);
    if (state.bubbles) applyBubbles(state.bubbles);
    if (typeof state.enabled === 'boolean') {
      // 总开关关掉：三个画面（预览、窗口、OBS）一起清空；重新打开时服务器会一起补上最近的消息。
      if (enabled && !state.enabled) clear();
      enabled = state.enabled;
      off.hidden = enabled || !preview;
    }
  }

  const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yuan = value => '¥' + value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function avatar(event) {
    const face = String(event.face || '').replace(/^http:\/\//, 'https://');
    const name = String(event.user || '观众'), color = [...name].reduce((sum, c) => sum + c.codePointAt(0), 0) % 8;
    const letter = `<span class="avatar-letter c${color}">${escapeHtml(Array.from(name)[0] || '·')}</span>`;
    return `<div class="avatar">${letter}${/^https:\/\//.test(face) ? `<img src="${escapeHtml(face)}" alt="" referrerpolicy="no-referrer">` : ''}</div>`;
  }
  // 礼物总价（元）：B站金瓜子 1000 = 1 元，抖音 1 抖币 = 0.1 元。免费礼物返回 0。
  function giftYuan(event) {
    if (event.guardName) return (Number(event.guardPrice) || 0) / 1000 * (event.count || 1);
    const unit = Number(event.giftUnit) || 0;
    return event.giftCoin === 'douyin' ? unit / 10 * (event.count || 1) : unit / 1000 * (event.count || 1);
  }
  // 身份标签：默认全部显示（房管、大航海、粉丝牌 / 星守护、消费等级、会员）；在控制台关掉就只显示最高的一个。
  const GUARD = { 1: '总督', 2: '提督', 3: '舰长' };
  function header(event, tier) {
    const badges = [];
    if (!config.badges) {
      if (tier.label) badges.push(`<span class="badge badge-${tier.key}">${escapeHtml(tier.label)}</span>`);
      if (event.admin) badges.push('<span class="badge badge-admin">房管</span>');
    } else {
      if (event.admin) badges.push('<span class="badge badge-admin">房管</span>');
      if (GUARD[event.guard]) badges.push(`<span class="badge badge-guard${event.guard}">${GUARD[event.guard]}</span>`);
      if (event.fansLevel > 0) badges.push(`<span class="badge badge-star">星守护${event.fansClub ? ' · ' + escapeHtml(event.fansClub) : ''} ${Number(event.fansLevel)}</span>`);
      if (event.medalLevel > 0) badges.push(`<span class="badge badge-medal"><b>${escapeHtml(event.medalName || '粉丝')}</b><i>${Number(event.medalLevel)}</i></span>`);
      const wealth = Number(event.wealthLevel) || 0;
      if (wealth > 0) badges.push(`<span class="badge badge-wealth w${Math.min(5, Math.floor(wealth / 10) + 1)}" title="消费等级">💎 ${wealth}</span>`);
      if (event.vip) badges.push(`<span class="badge badge-vip">${event.vip === 2 ? '年费会员' : '会员'}</span>`);
    }
    return `<div class="name-line">${badges.length ? `<span class="badges">${badges.join('')}</span>` : ''}<span class="name">${escapeHtml(event.user || '观众')}</span></div>`;
  }
  function giftIcon(event) {
    if (!event.giftId) return '';
    return `<img class="card-gift" src="/api/gifts/${encodeURIComponent(event.giftId)}/image?platform=${encodeURIComponent(event.platform || 'bilibili')}" alt="">`;
  }
  // 红包、转账两种卡片。
  function card(kind, title, sub, foot, event) {
    const icon = kind.startsWith('transfer') ? '<span class="card-icon transfer-icon" aria-hidden="true">⇄</span>' : '<span class="card-icon packet-icon" aria-hidden="true"><i></i></span>';
    return `<div class="card ${kind}"><div class="card-body">${icon}<div class="card-text"><strong>${title}</strong><span>${sub}</span></div>${giftIcon(event)}</div><div class="card-foot">${foot}</div></div>`;
  }
  function body(event) {
    if (event.type === 'gift') {
      const value = giftYuan(event), count = event.count || 1;
      if (event.guardName) return card('transfer guard', value > 0 ? yuan(value) : '开通', `开通${escapeHtml(event.guardName)}${count > 1 ? ` × ${count} 个月` : ''}`, '大航海转账', {});
      const name = escapeHtml(event.giftName || '礼物'), countText = `<b class="count">× ${count}</b>`;
      if (value >= config.big) return card('transfer', yuan(value), `${name} ${countText}`, '礼物转账', event);
      return card('packet', `${name} ${countText}`, value > 0 ? yuan(value) : '免费礼物', '直播红包', event);
    }
    if (event.superChat) return card('packet sc', escapeHtml(event.text), yuan(Number(event.price) || 0), '醒目留言 · 红包', {});
    // 表情包：像微信一样只显示图片，不套气泡（图片加载不出来时退回成文字气泡）。
    const sticker = imageUrl(event.sticker?.url);
    if (sticker) return `<div class="sticker" data-alt="${escapeHtml(event.sticker.alt || event.text)}"><img src="${escapeHtml(sticker)}" alt="${escapeHtml(event.sticker.alt || event.text)}" referrerpolicy="no-referrer"></div>`;
    const mention = event.mention?.name && !/^\s*[@＠]/.test(event.text) ? `<span class="mention">@${escapeHtml(event.mention.name)}</span> ` : '';
    const bubble = bubbles.get(event.bubble);
    if (bubble) return `<div class="skin" data-bubble="${escapeHtml(bubble.id)}"><div class="skin-text"><span>${mention}${richText(event)}</span></div></div>`;
    return `<div class="bubble">${mention}${richText(event)}</div>`;
  }
  // 只放行 B站 / 抖音图床的 https 图片（和服务器那边的检查一致）。
  function imageUrl(input) {
    try {
      const url = new URL(String(input || ''));
      if (url.protocol === 'https:' && ['hdslb.com', 'biliimg.com', 'douyinpic.com', 'byteimg.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return url.href;
    } catch {}
    return '';
  }
  // 文字里的小表情（[dog]、[微笑]…）换成小图，跟文字排在一行。
  function richText(event) {
    if (!Array.isArray(event.rich)) return escapeHtml(event.text);
    return event.rich.map(part => {
      const src = imageUrl(part.img);
      return src ? `<img class="emo" src="${escapeHtml(src)}" alt="${escapeHtml(part.alt || '')}" referrerpolicy="no-referrer">` : escapeHtml(part.text ?? part.alt ?? '');
    }).join('');
  }
  // 定制气泡：整张图按比例缩放，文字放进图里框好的那一块，字多了自动缩小。
  // 定制气泡像普通气泡一样按字数伸缩：高度和两行字的普通气泡差不多，左右两头（人物、装饰）原样不变形，只拉长中间那段。
  // 这一行留给气泡的宽度：聊天栏宽度减去头像和间距（和 .msg.has-skin .content 的 max-width 一致），再不超过气泡设定的最宽。
  function skinRoom(skin, bubble) {
    const row = skin.closest('.msg');
    if (!row || !row.clientWidth) return bubble.width;
    return Math.min(bubble.width, row.clientWidth - config.size * 3.2);
  }
  function styleSkin(skin, bubble) {
    // 气泡图用 border-image 画，里面的 <img> 只有弹幕里的小表情，别动它们。
    const { left, right, top, bottom } = bubble.box;
    // cap：两端固定不动的部分（可以比文字区宽，文字伸进两端里空着的气泡）；tile：中段平铺而不是拉长。
    const cap = { left: Math.max(left, bubble.cap?.left ?? left), right: Math.max(right, bubble.cap?.right ?? right) };
    let font = config.size * bubble.font / 100;
    const heightOf = f => f * 1.35 * 1.7 / Math.max(0.2, (100 - top - bottom) / 100);
    // fixed：整张图原样，宽度就是图片本身的宽高比。
    const narrowest = f => { if (bubble.fixed) return heightOf(f) * bubble.ratio; const unit = heightOf(f) * bubble.ratio / 100; return Math.max(unit * (cap.left + cap.right), unit * (left + right) + f * 2); };
    // 字号大、画面窄时两端放不下：整只气泡（连人物、装饰）等比缩小，不裁切、不压扁。
    const room = skinRoom(skin, bubble);
    if (narrowest(font) > room) font *= room / narrowest(font);
    const height = heightOf(font), unit = height * bubble.ratio / 100, capLeft = unit * cap.left, capRight = unit * cap.right;
    const px = v => Math.floor(v * 10) / 10 + 'px';
    // 长短切换：短气泡固定留 8 个字宽的文字区，长气泡固定撑满这一行；自动（或没有切换的气泡）按字数伸缩。
    const lengthWidth = () => {
      if (bubble.length === 'long') return px(room);
      if (bubble.length === 'short') return px(Math.min(room, Math.max(narrowest(font), unit * (left + right) + font * 8)));
      return '';
    };
    Object.assign(skin.style, {
      height: px(height), maxWidth: `min(100%, ${bubble.width}px)`, minWidth: px(narrowest(font)), width: bubble.fixed ? px(narrowest(font)) : lengthWidth(),
      borderWidth: `${px(height * top / 100)} ${px(capRight)} ${px(height * bottom / 100)} ${px(capLeft)}`,
      borderImageSource: `url("${bubble.image}")`, borderImageSlice: `${top}% ${cap.right}% ${bottom}% ${cap.left}% fill`,
      borderImageRepeat: bubble.tile ? 'round stretch' : 'stretch',
      color: bubble.color
    });
    const text = skin.querySelector('.skin-text');
    text.style.margin = `0 ${px(-unit * (cap.right - right))} 0 ${px(-unit * (cap.left - left))}`;
    text.classList.toggle('centered', bubble.fixed === true);
    skin.dataset.font = font;
    fitText(skin, bubble);
  }
  function fitText(skin) {
    const box = skin.querySelector('.skin-text');
    if (!skin.isConnected || !box.clientHeight) return;
    const span = box.firstElementChild;
    let size = Number(skin.dataset.font) || config.size;
    box.style.fontSize = size + 'px'; span.classList.remove('clamped'); span.style.webkitLineClamp = '';
    while ((box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1) && size > 9) { size -= 0.5; box.style.fontSize = size + 'px'; }
    // 缩到最小还放不下：只显示放得下的几行，最后用「…」收尾，不让字被拦腰截断。
    if (box.scrollHeight > box.clientHeight + 1) { span.classList.add('clamped'); span.style.webkitLineClamp = String(Math.max(1, Math.floor(box.clientHeight / (size * 1.35)))); }
  }
  const TIP_TYPES = { member: 'enter', social: 'social', like: 'like' };
  function tipRow(event, text) {
    const row = document.createElement('div');
    row.className = `tip tip-${event.type}`;
    row.innerHTML = `<span><b>${escapeHtml(event.user || '观众')}</b> ${escapeHtml(text)}</span>`;
    return row;
  }
  function render(event) {
    if (!event || !event.type) return null;
    const tip = TIP_TYPES[event.type];
    if (tip) return config[tip] ? tipRow(event, event.text || '') : null;
    if (event.type !== 'chat' && event.type !== 'gift') return null;
    // 换气泡的口令不进聊天，只出一行小提示。
    if (event.bubbleCommand) return tipRow(event, event.bubbleCommand.text);
    const tier = window.DanmakuSkins.tierOf(event);
    const row = document.createElement('div');
    row.className = `msg tier-${tier.key} type-${event.type}${event.superChat ? ' type-sc' : ''}${bubbles.has(event.bubble) ? ' has-skin' : ''}`;
    row.innerHTML = `${avatar(event)}<div class="content">${header(event, tier)}${body(event)}</div>`;
    for (const img of row.querySelectorAll('.avatar img, .card-gift')) img.addEventListener('error', () => img.remove(), { once: true });
    // 表情图加载失败：小表情换回 [dog] 这样的文字，表情包换回普通文字气泡。
    for (const img of row.querySelectorAll('.emo')) img.addEventListener('error', () => img.replaceWith(img.alt), { once: true });
    const stickerImg = row.querySelector('.sticker img');
    if (stickerImg) stickerImg.addEventListener('error', () => { const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = stickerImg.alt; stickerImg.parentElement.replaceWith(bubble); }, { once: true });
    if (stickerImg || row.querySelector('.emo')) for (const img of row.querySelectorAll('.sticker img, .emo')) img.addEventListener('load', () => stick(false), { once: true });
    return row;
  }

  const seen = new Set();
  let lastGift = null, unread = 0;
  // 鼠标往上滚看旧消息时，不再自动跳到最底下；新消息攒着，点「新消息」回到底部。
  const atBottom = () => chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
  let follow = true;
  chat.addEventListener('scroll', () => { follow = atBottom(); if (follow) { unread = 0; more.hidden = true; } });
  more.addEventListener('click', () => { follow = true; unread = 0; more.hidden = true; chat.scrollTop = chat.scrollHeight; });
  function stick(added) {
    if (follow) { chat.scrollTop = chat.scrollHeight; return; }
    if (added) { unread++; more.hidden = false; more.textContent = `↓ ${unread} 条新消息`; }
  }
  // B站连击会一条条发同一个礼物：同一个人 5 秒内送同一个礼物，合并到上一张红包里。
  function mergeGift(event) {
    if (event.type !== 'gift' || event.guardName || !lastGift) return false;
    const prev = lastGift;
    if (!prev.row.isConnected || prev.event.uid !== event.uid || prev.event.user !== event.user || prev.event.giftName !== event.giftName || event.time - prev.event.time > 5000) return false;
    prev.event = { ...prev.event, count: (prev.event.count || 1) + (event.count || 1), time: event.time };
    const fresh = render(prev.event);
    if (!fresh) return false;
    fresh.classList.add('bump');
    fresh.event = prev.event; prev.row.replaceWith(fresh); prev.row = fresh; schedule(fresh);
    return true;
  }
  // 消失倒计时从消息发出的时间（服务器打的时间）算起，几个画面同一时刻消失；补历史时已经过期的就不再显示。
  const leftMs = event => config.fade ? config.fade * 1000 - Math.max(0, Date.now() - (Number(event.time) || Date.now())) : Infinity;
  function add(event, animate = true) {
    if (leftMs(event) <= 0) return;
    if (event.id) { if (seen.has(event.id)) return; seen.add(event.id); if (seen.size > 1000) seen.delete(seen.values().next().value); }
    if (mergeGift(event)) return;
    const row = render(event);
    if (!row) return;
    if (!animate) row.classList.add('still');
    row.event = event;
    chat.append(row);
    const skin = row.querySelector('.skin');
    if (skin) styleSkin(skin, bubbles.get(skin.dataset.bubble));
    if (event.type === 'gift' && !event.guardName) lastGift = { event, row };
    schedule(row);
    trim();
    stick(animate);
  }
  function schedule(row) {
    if (!config.fade) return;
    clearTimeout(row.fadeTimer);
    row.fadeTimer = setTimeout(() => { row.classList.add('leaving'); setTimeout(() => row.remove(), 600); }, Math.max(0, leftMs(row.event || {})));
  }
  function trim() { while (chat.children.length > config.max) chat.firstElementChild.remove(); }
  // 开关「显示身份标签」后，把已经在屏幕上的消息按新设置重画一遍。
  function rerender() {
    for (const row of [...chat.children]) {
      if (!row.event) continue;
      const fresh = render(row.event);
      if (!fresh) continue;
      fresh.classList.add('still'); fresh.event = row.event;
      if (lastGift?.row === row) lastGift.row = fresh;
      row.replaceWith(fresh);
      const skin = fresh.querySelector('.skin'); if (skin) styleSkin(skin, bubbles.get(skin.dataset.bubble));
    }
  }
  // 清空时连「已显示过」的记录一起清掉，重连后补的历史消息才会重新画出来。
  function clear() { chat.replaceChildren(); seen.clear(); lastGift = null; unread = 0; more.hidden = true; follow = true; }
  new ResizeObserver(() => { for (const skin of chat.querySelectorAll('.skin')) { const b = bubbles.get(skin.dataset.bubble); if (b) styleSkin(skin, b); } if (follow) chat.scrollTop = chat.scrollHeight; }).observe(chat);

  // 控制台预览：没存好的设置草稿先在预览里生效（存好后服务器再推给所有画面）。
  // 「发几条试试」「清空」走服务器，预览、打开的窗口和 OBS 一起收到。
  window.addEventListener('message', message => {
    if (message.origin !== location.origin || !message.data) return;
    if (message.data.type === 'danmaku-draft') applyState(message.data.state);
  });

  const connection = document.getElementById('connection');
  const source = new LuoboEvents('/api/events?danmaku=1');
  source.addEventListener('open', () => { connection.hidden = true; });
  source.addEventListener('danmaku', event => applyState(JSON.parse(event.data)));
  source.addEventListener('danmaku-history', event => {
    if (!enabled) return;
    clear();
    for (const item of JSON.parse(event.data).slice().reverse()) add(item, false);
  });
  source.addEventListener('message', event => { if (enabled) add(JSON.parse(event.data)); });
  source.addEventListener('danmaku-demo', event => { if (enabled) add(JSON.parse(event.data)); });
  source.onerror = () => { if (preview) return; connection.hidden = false; connection.textContent = '连接中断，正在重连…'; };
})();
