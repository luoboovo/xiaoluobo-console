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
  function fit() {
    if (mediaOnly || panelId) return;
    const el = $('#time'); let low = 8, high = 110;
    while (low < high) { const middle = Math.ceil((low + high) / 2); el.style.fontSize = `${middle}px`; if (el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1) low = middle; else high = middle - 1; }
    el.style.fontSize = `${low}px`;
  }
  function clock(next) {
    if (mediaOnly || panelId || !state) return;
    Object.assign(state,next);
    $('#time').textContent = state.mode === 'idle' ? '等待开机' : state.remaining === '0' ? '🎉 下班！' : formatDuration(state.remaining);
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
    if (!panelId) { clock(next); return; }
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
