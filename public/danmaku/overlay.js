// 小萝卜弹幕姬：把弹幕排成微信聊天，礼物是红包，大额礼物和上舰是转账。
// 地址参数（控制台「弹幕姬」页会帮你拼好）：
//   theme 主题  bg=0 透明背景  enter=1 显示进场  social=1 显示关注分享  like=1 显示点赞
//   max 最多条数  size 字号  fade 几秒后淡出（0 不淡出）  big 多少元起算「转账」  preview=1 控制台预览
(function () {
  const params = new URLSearchParams(location.search), chat = document.getElementById('chat');
  const config = {};
  function readConfig(source) {
    const num = (key, fallback, min, max) => { const v = Number(source.get(key)); return Number.isFinite(v) && source.has(key) ? Math.min(max, Math.max(min, v)) : fallback; };
    const themes = window.DanmakuSkins.THEMES.map(t => t.key);
    Object.assign(config, {
      theme: themes.includes(source.get('theme')) ? source.get('theme') : 'wechat',
      bg: source.get('bg') !== '0',
      enter: source.get('enter') === '1', social: source.get('social') !== '0', like: source.get('like') === '1',
      max: num('max', 40, 5, 200), size: num('size', 15, 10, 32), fade: num('fade', 0, 0, 600), big: num('big', 50, 1, 100000)
    });
    document.body.dataset.theme = config.theme;
    document.body.classList.toggle('transparent', !config.bg);
    document.documentElement.style.setProperty('--font-size', config.size + 'px');
    trim();
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
    return `<div class="bubble">${mention}${escapeHtml(event.text)}</div>`;
  }
  const TIP_TYPES = { member: 'enter', social: 'social', like: 'like' };
  function render(event) {
    if (!event || !event.type) return null;
    const tip = TIP_TYPES[event.type];
    if (tip) {
      if (!config[tip]) return null;
      const row = document.createElement('div');
      row.className = `tip tip-${event.type}`;
      row.innerHTML = `<span><b>${escapeHtml(event.user || '观众')}</b> ${escapeHtml(event.text || '')}</span>`;
      return row;
    }
    if (event.type !== 'chat' && event.type !== 'gift') return null;
    const tier = window.DanmakuSkins.tierOf(event);
    const row = document.createElement('div');
    row.className = `msg tier-${tier.key} type-${event.type}${event.superChat ? ' type-sc' : ''}`;
    row.innerHTML = `${avatar(event)}<div class="content">${header(event, tier)}${body(event)}</div>`;
    for (const img of row.querySelectorAll('img')) img.addEventListener('error', () => img.remove(), { once: true });
    return row;
  }

  const seen = new Set();
  let lastGift = null;
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
    if (event.type === 'gift' && !event.guardName) lastGift = { event, row };
    schedule(row);
    trim();
    chat.scrollTop = chat.scrollHeight;
  }
  function schedule(row) {
    if (!config.fade) return;
    clearTimeout(row.fadeTimer);
    row.fadeTimer = setTimeout(() => { row.classList.add('leaving'); setTimeout(() => row.remove(), 600); }, config.fade * 1000);
  }
  function trim() { while (chat.children.length > config.max) chat.firstElementChild.remove(); }

  readConfig(params);

  // 控制台预览：调整设置时即时生效，「发几条试试」塞演示消息。
  window.addEventListener('message', message => {
    if (message.origin !== location.origin || !message.data) return;
    if (message.data.type === 'danmaku-config') readConfig(new URLSearchParams(message.data.query));
    if (message.data.type === 'danmaku-demo') for (const event of message.data.events || []) add({ ...event, id: undefined, time: Date.now() });
    if (message.data.type === 'danmaku-clear') { chat.replaceChildren(); lastGift = null; }
  });

  const connection = document.getElementById('connection');
  const source = new LuoboEvents('/api/events?danmaku=1');
  source.addEventListener('open', () => { connection.hidden = true; });
  source.addEventListener('danmaku-history', event => {
    const list = JSON.parse(event.data);
    for (const item of list.slice().reverse()) add(item, false);
  });
  source.addEventListener('message', event => add(JSON.parse(event.data)));
  source.onerror = () => { if (params.has('preview')) return; connection.hidden = false; connection.textContent = '连接中断，正在重连…'; };
})();
