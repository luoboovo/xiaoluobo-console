// 小萝卜弹幕姬：把弹幕排成微信聊天，礼物是红包，大额礼物和上舰是转账。
// 设置、背景和定制气泡都存在控制台里（弹幕姬页），这个画面连上就自动拿到；地址只有 ?preview=1 一个参数（控制台预览用）。
(function () {
  const params = new URLSearchParams(location.search), preview = params.has('preview');
  const chat = document.getElementById('chat'), backdrop = document.getElementById('backdrop'), more = document.getElementById('more'), off = document.getElementById('off');
  let config = { theme: 'wechat', bg: true, size: 15, max: 40, fade: 0, big: 50, enter: false, social: true, like: false };
  let bubbles = new Map(), enabled = true, demoing = false;

  function applySettings(next) {
    config = { ...config, ...next };
    document.body.dataset.theme = config.theme;
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
    if (state.settings) applySettings(state.settings);
    if ('background' in state) applyBackground(state.background);
    if (state.bubbles) applyBubbles(state.bubbles);
    if (typeof state.enabled === 'boolean') {
      if (enabled && !state.enabled && !preview) clear();
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
  function header(event, tier) {
    const badges = [];
    if (tier.label) badges.push(`<span class="badge badge-${tier.key}">${escapeHtml(tier.label)}</span>`);
    if (event.admin) badges.push('<span class="badge badge-admin">房管</span>');
    return `<div class="name-line">${badges.join('')}<span class="name">${escapeHtml(event.user || '观众')}</span></div>`;
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
    const mention = event.mention?.name && !/^\s*[@＠]/.test(event.text) ? `<span class="mention">@${escapeHtml(event.mention.name)}</span> ` : '';
    const bubble = bubbles.get(event.bubble);
    if (bubble) return `<div class="skin" data-bubble="${escapeHtml(bubble.id)}"><div class="skin-text"><span>${mention}${escapeHtml(event.text)}</span></div></div>`;
    return `<div class="bubble">${mention}${escapeHtml(event.text)}</div>`;
  }
  // 定制气泡：整张图按比例缩放，文字放进图里框好的那一块，字多了自动缩小。
  // 定制气泡像普通气泡一样按字数伸缩：高度和两行字的普通气泡差不多，左右两头（人物、装饰）原样不变形，只拉长中间那段。
  function styleSkin(skin, bubble) {
    skin.querySelector('img')?.remove();
    const font = config.size * bubble.font / 100, { left, right, top, bottom } = bubble.box;
    const height = font * 1.35 * 1.7 / Math.max(0.2, (100 - top - bottom) / 100);
    const px = v => Math.round(v * 10) / 10 + 'px';
    const capLeft = height * bubble.ratio * left / 100, capRight = height * bubble.ratio * right / 100;
    Object.assign(skin.style, {
      height: px(height), maxWidth: `min(100%, ${bubble.width}px)`, minWidth: px(capLeft + capRight + font * 2),
      borderWidth: `${px(height * top / 100)} ${px(capRight)} ${px(height * bottom / 100)} ${px(capLeft)}`,
      borderImageSource: `url("${bubble.image}")`, borderImageSlice: `${top}% ${right}% ${bottom}% ${left}% fill`,
      color: bubble.color
    });
    skin.dataset.font = font;
    fitText(skin, bubble);
  }
  function fitText(skin) {
    const box = skin.querySelector('.skin-text');
    if (!skin.isConnected || !box.clientHeight) return;
    let size = Number(skin.dataset.font) || config.size;
    box.style.fontSize = size + 'px';
    while ((box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1) && size > 9) { size -= 0.5; box.style.fontSize = size + 'px'; }
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
    prev.row.replaceWith(fresh); prev.row = fresh; schedule(fresh);
    return true;
  }
  function add(event, animate = true) {
    if (event.id) { if (seen.has(event.id)) return; seen.add(event.id); if (seen.size > 1000) seen.delete(seen.values().next().value); }
    if (mergeGift(event)) return;
    const row = render(event);
    if (!row) return;
    if (!animate) row.classList.add('still');
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
    row.fadeTimer = setTimeout(() => { row.classList.add('leaving'); setTimeout(() => row.remove(), 600); }, config.fade * 1000);
  }
  function trim() { while (chat.children.length > config.max) chat.firstElementChild.remove(); }
  function clear() { chat.replaceChildren(); lastGift = null; unread = 0; more.hidden = true; follow = true; }
  new ResizeObserver(() => { for (const skin of chat.querySelectorAll('.skin')) { const b = bubbles.get(skin.dataset.bubble); if (b) fitText(skin, b); } if (follow) chat.scrollTop = chat.scrollHeight; }).observe(chat);

  // 控制台预览：草稿即时生效，「发几条试试」塞演示消息。
  window.addEventListener('message', message => {
    if (message.origin !== location.origin || !message.data) return;
    const data = message.data;
    if (data.type === 'danmaku-draft') applyState(data.state);
    if (data.type === 'danmaku-demo') { demoing = true; for (const event of data.events || []) add({ ...event, id: undefined, time: Date.now() }); }
    if (data.type === 'danmaku-clear') clear();
  });

  const connection = document.getElementById('connection');
  const source = new LuoboEvents('/api/events?danmaku=1');
  source.addEventListener('open', () => { connection.hidden = true; });
  source.addEventListener('danmaku', event => applyState(JSON.parse(event.data)));
  source.addEventListener('danmaku-history', event => {
    if (!enabled || demoing) return;
    clear();
    for (const item of JSON.parse(event.data).slice().reverse()) add(item, false);
  });
  source.addEventListener('message', event => { if (enabled) add(JSON.parse(event.data)); });
  source.onerror = () => { if (preview) return; connection.hidden = false; connection.textContent = '连接中断，正在重连…'; };
})();
