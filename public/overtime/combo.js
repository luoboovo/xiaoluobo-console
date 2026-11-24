// 加班机合体模式：时钟、礼物面板、常显文字、飘字放在同一张固定尺寸的画布里，整体等比缩放铺进窗口。
(() => {
  const $ = selector => document.querySelector(selector);
  const stage = $('#combo-stage'), panel = $('#combo-panel'), texts = $('#combo-texts'), floats = $('#combo-float');
  const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const giftImage = id => id ? `<img src="/api/gifts/${encodeURIComponent(id)}/image" alt="">` : '';
  let combo = null, stamp = '', panelStamp = '', floatStamp = '', offset = 0;
  const shown = new Map();  // 飘字 id → { item, node, timer }
  function place(node, box) { node.style.left = `${box.x}%`; node.style.top = `${box.y}%`; node.style.width = `${box.w}%`; node.style.height = `${box.h}%`; }
  function scale() {
    if (!combo?.enabled) return;
    const size = Math.min(innerWidth / combo.width,innerHeight / combo.height);
    stage.style.transform = `translate(${(innerWidth - combo.width * size) / 2}px,${(innerHeight - combo.height * size) / 2}px) scale(${size})`;
  }
  // 卡片大小按设置来；礼物太多放不下时自动缩小，保证面板里每个礼物都看得全。
  function fitPanel() {
    if (!combo?.enabled) return;
    const list = panel.querySelector('.combo-list'); if (!list) return;
    const fits = () => list.scrollHeight <= list.clientHeight + 1 && list.scrollWidth <= list.clientWidth + 1 && [...list.querySelectorAll('.combo-card')].every(card => card.scrollWidth <= card.clientWidth + 1);
    let high = combo.panel.size / 100 * 26, low = 5;
    const set = size => panel.style.setProperty('--card-size',`${size}px`);
    set(high); if (fits()) return;
    while (high - low > .25) { const middle = (low + high) / 2; set(middle); if (fits()) low = middle; else high = middle; }
    set(low);
  }
  function renderPanel(rules) {
    const next = JSON.stringify([combo.width,combo.height,combo.panel,combo.add_color,combo.reduce_color,rules.map(rule => [Overtime.ruleKey(rule),Overtime.ruleText(rule)])]);
    if (next === panelStamp) return;
    panelStamp = next;
    const settings = combo.panel;
    place(panel,settings.box);
    for (const key of ['theme','flow','card','align']) panel.dataset[key] = settings[key];
    panel.dataset.names = String(settings.show_name);
    panel.style.setProperty('--gap',`${settings.gap}px`); panel.style.setProperty('--plate',settings.opacity / 100);
    const entries = Overtime.comboRules(combo,rules), lines = Overtime.comboLines(settings,entries);
    panel.style.setProperty('--per-line',Math.max(1,...lines.map(line => line.length)));
    const card = rule => `<div class="combo-card" data-kind="${Overtime.comboKind(rule)}">${rule.gift_id ? `<span class="combo-icon">${giftImage(rule.gift_id)}</span>` : ''}<span class="combo-words"><span class="combo-name">${escape(rule.gift_name)}</span><b class="combo-effect">${escape(Overtime.comboEffect(rule,settings.labels))}</b></span></div>`;
    panel.innerHTML = `${settings.title ? `<h2 class="combo-title">${escape(settings.title)}</h2>` : ''}<div class="combo-list">${lines.map(line => `<div class="combo-line">${line.map(card).join('')}</div>`).join('') || '<p class="combo-empty">还没有礼物规则</p>'}</div>`;
    requestAnimationFrame(fitPanel);
  }
  function renderTexts() {
    texts.replaceChildren(...combo.texts.map(item => {
      const node = document.createElement('div'), inner = document.createElement('span');
      node.className = 'combo-text'; place(node,item); node.dataset.align = item.align;
      inner.textContent = item.text; node.append(inner);
      node.style.fontSize = `${item.size}px`; node.style.color = item.color; node.style.fontWeight = item.bold ? 900 : 500; node.style.setProperty('--stroke',item.stroke);
      return node;
    }));
  }
  function drop(id) { const entry = shown.get(id); if (!entry) return; clearTimeout(entry.timer); entry.animation?.cancel(); entry.node?.remove(); shown.delete(id); }
  function spawn(entry) {
    const item = entry.item, layout = Overtime.floatLayout(combo), text = Overtime.floatText(item,combo.float.show_user);
    const node = entry.node = document.createElement('div');
    node.className = 'combo-float-item'; node.dataset.kind = item.added === '0' ? 'reduce' : 'add';
    node.innerHTML = `${combo.float.show_icon ? giftImage(item.gift_id) : ''}${text.who ? `<span class="who">${escape(text.who)}</span><span class="verb">送</span>` : ''}<span class="what">${escape(text.what)}</span>${text.amounts.map(amount => `<b data-kind="${amount.kind}">${escape(amount.text)}</b>`).join('')}`;
    floats.append(node);
    let frames, duration;
    if (combo.float.style === 'rise') {
      duration = combo.float.seconds;
      frames = [{ transform:`translate(-50%,${layout.height}px) scale(.8)`, opacity:0 },{ opacity:1, offset:.1 },{ opacity:1, offset:.75 },{ transform:`translate(-50%,${-layout.line}px) scale(1)`, opacity:0 }];
    } else {
      node.style.top = `${item.lane % layout.lanes * layout.line}px`;
      duration = (layout.width + node.offsetWidth) / layout.speed;
      frames = [{ transform:`translateX(${layout.width}px)` },{ transform:`translateX(${-node.offsetWidth}px)` }];
    }
    entry.animation = node.animate(frames,{ duration:duration * 1000, fill:'both' });
    // 后打开的画面直接从飘到一半的位置接着飘，三个画面看到的是同一条。
    // 用 performance.now() 定起点：窗口被遮住时动画时间轴会停住，直接设 currentTime 会错位、前后两条叠在一起。
    entry.animation.startTime = performance.now() - Math.max(0,Date.now() - offset - item.at);
    entry.animation.onfinish = () => { node.remove(); entry.done = true; };
  }
  function renderFloats(list, now) {
    if (Number.isFinite(now)) offset = Date.now() - now;
    const next = JSON.stringify([combo.width,combo.height,combo.float]);
    if (next !== floatStamp) { floatStamp = next; place(floats,combo.float.box); floats.dataset.style = combo.float.style; floats.style.setProperty('--size',`${combo.float.size}px`); for (const id of [...shown.keys()]) drop(id); }
    floats.hidden = !combo.float.enabled;
    const alive = new Set(combo.float.enabled ? list.map(item => item.id) : []);
    for (const id of [...shown.keys()]) if (!alive.has(id)) drop(id);
    if (!combo.float.enabled) return;
    for (const item of list) {
      const known = shown.get(item.id);
      if (known) { known.item = item; continue; }  // 还没出发的可能又合并了几份，出发时用最新的内容。
      const entry = { item }, wait = item.at - (Date.now() - offset);
      shown.set(item.id,entry);
      if (wait > 0) entry.timer = setTimeout(() => spawn(entry),wait);
      else if (-wait < (combo.float.seconds * 4 + 5) * 1000) spawn(entry);
    }
  }
  // 返回 true 表示布局变了，时钟要重新适配字号。
  function render(state) {
    if (!state.config.combo) return false;
    const next = JSON.stringify(state.config.combo), changed = next !== stamp;
    if (changed) {
      stamp = next; combo = state.config.combo;
      document.body.classList.toggle('combo',combo.enabled);
      panel.hidden = texts.hidden = !combo.enabled;
      const clock = $('.overtime-overlay');
      if (!combo.enabled) {
        stage.style.cssText = ''; for (const key of ['left','top','width','height']) clock.style.removeProperty(key);
        floats.hidden = true; for (const id of [...shown.keys()]) drop(id); panelStamp = floatStamp = '';
      } else {
        stage.style.width = `${combo.width}px`; stage.style.height = `${combo.height}px`;
        // 浅色在这里算好：旧直播浏览器没有 CSS color-mix。
        const light = hex => `rgb(${[1,3,5].map(i => Math.round(parseInt(hex.slice(i,i + 2),16) * .55 + 255 * .45)).join(',')})`;
        for (const [key,value] of [['add',combo.add_color],['reduce',combo.reduce_color]]) { stage.style.setProperty(`--${key}`,value); stage.style.setProperty(`--${key}-light`,light(value)); }
        place(clock,combo.clock); scale(); renderTexts();
      }
    }
    if (combo.enabled) { renderPanel(state.config.gift_rules); renderFloats(state.floats || [],state.now); }
    return changed;
  }
  new ResizeObserver(scale).observe(document.documentElement);
  panel.addEventListener('load',fitPanel,true); document.fonts?.ready.then(fitPanel);
  window.OvertimeCombo = { render };
})();
