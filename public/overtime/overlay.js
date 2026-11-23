(() => {
  const $ = selector => document.querySelector(selector), { formatDuration, panelEntries } = Overtime;
  const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const params = new URLSearchParams(location.search), mediaOnly = params.has('media'), panelId = params.get('panel');
  document.body.classList.toggle('media-only',mediaOnly);
  document.body.classList.toggle('rules-only',!!panelId);
  document.body.classList.toggle('capture',params.has('capture'));
  document.body.classList.toggle('preview',params.has('preview'));
  $('.overtime-overlay').classList.toggle('gift-panel-surface',!!panelId);
  $('#rules').hidden = !panelId;
  let state, panelStyleStamp, rulesMarkup;
  if (window.overtimeWindow) {
    document.body.classList.add('desktop-drag');
    for (const region of document.querySelectorAll('.overlay-header,.timer-panel,#rules,#resize,#media-stage')) {
      let dragging = false, frame;
      const resize = region.id === 'resize';
      region.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !resize && event.target.closest('button')) return;
        dragging = true; region.setPointerCapture(event.pointerId); window.overtimeWindow.drag(resize ? 'resize-start' : 'start'); event.preventDefault();
      });
      region.addEventListener('pointermove', () => { if (dragging && !frame) frame = requestAnimationFrame(() => { frame = null; if (dragging) window.overtimeWindow.drag(resize ? 'resize-move' : 'move'); }); });
      const end = () => { if (dragging) { dragging = false; cancelAnimationFrame(frame); frame = null; window.overtimeWindow.drag('end'); } };
      region.addEventListener('pointerup',end); region.addEventListener('pointercancel',end); region.addEventListener('lostpointercapture',end);
    }
  }
  // 下班画面：彩纸 + 大字（默认「下班！」，可在控制台改），字号按浮窗大小自动适配。
  let doneText = '下班！';
  const done = () => `<div class="done"><div class="confetti" aria-hidden="true">${'<i></i>'.repeat(18)}</div><div class="done-badge" aria-hidden="true">🎉</div><div class="done-text"><strong>${escape(doneText)}</strong></div></div>`;
  // 外观：背景颜色 + 不透明度（0 = 完全透明，连边框阴影一起去掉）+ 文字颜色。
  function applyLook(look) {
    if (!look) return;
    const surface = $('.overtime-overlay'), hex = look.background, alpha = look.opacity / 100;
    // 皮肤自带配色：选了皮肤就不用控制台里的背景/文字颜色。
    surface.dataset.skin = look.skin || 'default';
    renderLookImages(surface.dataset.skin === 'custom' ? look.images || [] : []);
    // 自定义皮肤里时钟可以挪位置、改大小（百分比）；字号由 fit() 按框自动填满。
    const panel = $('.timer-panel'), box = surface.dataset.skin === 'custom' ? look.clock : null, place = box ? `${box.x},${box.y},${box.w},${box.h}` : '';
    if (panel.dataset.place !== place) { panel.dataset.place = place; panel.classList.toggle('placed',!!box); for (const [key,value] of [['left',box?.x],['top',box?.y],['width',box?.w],['height',box?.h]]) value === undefined ? panel.style.removeProperty(key) : panel.style.setProperty(key,`${value}%`); requestAnimationFrame(fit); }
    if (!['default','custom'].includes(surface.dataset.skin)) { surface.style.removeProperty('--overtime-background'); surface.style.removeProperty('--overtime-text'); delete surface.dataset.transparent; if (look.done_text !== doneText) { doneText = look.done_text; const time = $('#time'); if (time.classList.contains('finished')) { time.innerHTML = done(); fit(); } } return; }
    const rgb = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)), mix = (t,c) => rgb.map(v => Math.round(v + (c - v) * t));
    const rgba = c => `rgba(${c.join(',')},${alpha})`;
    surface.style.setProperty('--overtime-background', `linear-gradient(135deg,${rgba(mix(.28,255))},${rgba(mix(.32,0))})`);
    surface.style.setProperty('--overtime-text', look.text_color);
    surface.dataset.transparent = String(look.opacity === 0);
    if (look.done_text !== doneText) { doneText = look.done_text; const time = $('#time'); if (time.classList.contains('finished')) { time.innerHTML = done(); fit(); } }
  }
  // 自定义皮肤的图片：位置、宽度按浮窗大小的百分比，高度按图片原比例。排在倒计时文字下面。
  let lookImagesStamp = '';
  function renderLookImages(images) {
    const stamp = JSON.stringify(images); if (stamp === lookImagesStamp) return; lookImagesStamp = stamp;
    let layer = $('.look-images');
    if (!images.length) { layer?.remove(); return; }
    if (!layer) { layer = document.createElement('div'); layer.className = 'look-images'; layer.setAttribute('aria-hidden','true'); $('.overtime-overlay').prepend(layer); }
    layer.replaceChildren(...images.map(image => { const img = document.createElement('img'); img.alt = ''; img.src = `/api/overtime/media/${image.asset}`; img.style.left = `${image.x}%`; img.style.top = `${image.y}%`; img.style.width = `${image.w}%`; return img; }));
  }
  function fitDone() {
    const box = $('#time'), done = box.querySelector('.done'); if (!done) return;
    let low = 12, high = 160;
    while (low < high) { const middle = Math.ceil((low + high) / 2); done.style.setProperty('--done-size', `${middle}px`); if (done.scrollHeight <= box.clientHeight + 1 && done.scrollWidth <= box.clientWidth + 1) low = middle; else high = middle - 1; }
    done.style.setProperty('--done-size', `${Math.max(12, Math.floor(low * .82))}px`);
  }
  function fit() {
    if (mediaOnly || panelId) return;
    if ($('#time').classList.contains('finished')) { $('#time').style.fontSize = ''; fitDone(); return; }
    const el = $('#time'); let low = 8, high = 110;
    while (low < high) { const middle = Math.ceil((low + high) / 2); el.style.fontSize = `${middle}px`; if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) low = middle; else high = middle - 1; }
    el.style.fontSize = `${low}px`;
  }
  // 送礼特效：礼物飞行途中时钟先停在旧时间，砸中那一下再跳到新时间。
  let seenGifts = null, holding = false, holdTimer;
  const release = () => { if (!holding) return; holding = false; clearTimeout(holdTimer); clock({}); };
  function giftEffects(next) {
    const recent = next.recent || [];
    if (!seenGifts) { seenGifts = new Set(recent.map(record => record.id)); return; }
    const fresh = recent.filter(record => !seenGifts.has(record.id)).reverse();
    for (const record of recent) seenGifts.add(record.id);
    if (seenGifts.size > 500) seenGifts = new Set(recent.map(record => record.id));
    if (!fresh.length || !window.OvertimeGiftFx || document.visibilityState === 'hidden') return;
    holding = true; clearTimeout(holdTimer); holdTimer = setTimeout(release,1600);
    fresh.forEach((record,i) => setTimeout(() => OvertimeGiftFx.play(record,$('#time'),{onHit:release}), i * 160));
  }
  function clock(next) {
    if (mediaOnly || panelId || !state) return;
    Object.assign(state,next);
    if (holding) return;
    const finished = state.mode !== 'idle' && state.remaining === '0', time = $('#time');
    if (finished !== time.classList.contains('finished')) time.innerHTML = '';
    time.classList.toggle('finished', finished);
    if (finished) { if (!time.firstChild) time.innerHTML = done(); }
    else time.textContent = state.mode === 'idle' ? '等待开机' : formatDuration(state.remaining);
    $('#time').classList.toggle('urgent',state.mode === 'running' && BigInt(state.remaining) <= 60n);
    fit();
  }
  function render(next) {
    if (mediaOnly) {
      window.dispatchEvent(new CustomEvent('overtime-volume',{detail:next.config.media_volume ?? 100}));
      window.dispatchEvent(new CustomEvent('overtime-media',{detail:next.media_cue || null}));
      return;
    }
    state = next;
    if (!panelId) { applyLook(next.config.look); giftEffects(next); clock(next); return; }
    const panel = state.config.gift_panels.find(panel => panel.id === panelId);
    // 送礼高峰每 100ms 推送一次；面板内容不变时不重建，避免 OBS 浏览器源反复请求和解码全部礼物图片。
    const styleStamp = JSON.stringify([panel?.name, panel?.columns, panel?.style]);
    if (styleStamp !== panelStyleStamp) {
      panelStyleStamp = styleStamp;
      $('#title').textContent = panel?.name || '礼物面板已删除';
      document.title = `${panel?.name || '礼物面板'} · 浮窗`;
      $('#rules').style.setProperty('--columns',panel?.columns || 1);
      Overtime.applyPanelStyle($('.overtime-overlay'),panel?.style);
    }
    const markup = panel ? panelEntries(panel,state.config.gift_rules).map(entry => `<div class="rule-row">${entry.gift_id ? `<img src="/api/gifts/${entry.gift_id}/image" alt="">` : ''}<span>${escape(entry.gift_name)}</span><b>${escape(entry.text)}</b></div>`).join('') || '<p class="muted">未选择展示礼物</p>' : '<p class="muted">请在「礼物面板」中创建面板</p>';
    if (markup !== rulesMarkup) { rulesMarkup = markup; $('#rules').innerHTML = markup; }
  }
  $('#close').addEventListener('click',() => window.close());
  document.addEventListener('error',event => { if (event.target instanceof HTMLImageElement && event.target.id !== 'media-image') event.target.remove(); },true);
  if (!mediaOnly && !panelId) new ResizeObserver(fit).observe($('#time'));
  const source = new LuoboEvents('/api/events?overtime=1');
  source.addEventListener('overtime',event => render(JSON.parse(event.data)));
  source.addEventListener('overtime-clock',event => clock(JSON.parse(event.data)));
  if (mediaOnly) source.addEventListener('overtime-media',event => window.dispatchEvent(new CustomEvent('overtime-media',{detail:JSON.parse(event.data)})));
})();
