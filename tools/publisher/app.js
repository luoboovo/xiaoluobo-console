// 发版助手界面：①上传密钥 ②选上传文件夹（自动核对签名和文件）③一键发布（进度 + 回读核对）。
(() => {
  const $ = s => document.querySelector(s), api = window.publisher;
  let release = null, online = null, keySaved = false, publishing = false;
  const mb = bytes => `${(bytes / 1048576).toFixed(1)} MB`;
  const names = { setup: '完整安装包', update: '更新包' };
  function toast(text, error = false) { const el = $('#toast'); el.textContent = text; el.className = 'toast' + (error ? ' error' : ''); el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, error ? 6000 : 3000); }
  const message = error => String(error?.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  function refresh() {
    $('#key-status').textContent = keySaved ? '已保存' : '未设置'; $('#key-status').classList.toggle('ok', keySaved);
    $('#key-saved').hidden = !keySaved; $('#key-form').hidden = keySaved;
    const ready = keySaved && release && !publishing;
    $('#publish').disabled = !ready;
    $('#publish').textContent = publishing ? '发布中…' : release ? `一键发布 v${release.version}` : '一键发布';
    $('#publish-hint').textContent = !keySaved ? '先保存上传密钥' : !release ? '再选要发布的版本' : online && online.version === release.version ? `线上已经是 v${release.version}，再发一次也没关系（已传过的文件会自动跳过）` : '发布后，所有控制台会在启动 20 秒后或点「检查更新」时弹出更新提示';
  }
  async function loadOnline() {
    $('#online-version').textContent = '读取中…'; $('#online-date').textContent = '';
    try {
      online = await api.online();
      $('#online-version').textContent = online ? `v${online.version}` : '还没有发布过';
      $('#online-date').textContent = online?.date ? new Date(online.date).toLocaleString('zh-CN', { hour12: false }) : '';
    } catch (error) { $('#online-version').textContent = '读取失败'; $('#online-date').textContent = message(error); }
    refresh();
  }
  async function inspect(dir) {
    $('#drop').hidden = true; $('#release').hidden = false; release = null; refresh();
    $('#release-version').textContent = '核对中…'; $('#release-path').textContent = dir; $('#release-files').innerHTML = ''; $('#release-notes').textContent = '';
    $('#release-check').className = 'check'; $('#release-check').textContent = '正在核对签名和文件…';
    try {
      const info = await api.inspect(dir);
      release = info;
      $('#release-version').textContent = `v${info.version}`;
      $('#release-files').innerHTML = info.files.map(f => `<li><span>${names[f.kind]}</span><b>${mb(f.size)}</b></li>`).join('');
      $('#release-notes').textContent = info.notes;
      $('#release-check').className = 'check ok';
      $('#release-check').textContent = `✓ 签名和文件都核对过了${info.from ? `，装了 ${info.from} 个旧版本的都能用更新包直接升级` : ''}`;
    } catch (error) {
      $('#release-version').textContent = '不能发布';
      $('#release-check').className = 'check bad'; $('#release-check').textContent = '✕ ' + message(error);
    }
    refresh();
  }
  api.on('inspect-progress', ({ kind, done, size }) => { if (!release) $('#release-check').textContent = `正在核对${names[kind]}… ${Math.floor(done / size * 100)}%`; });

  // —— 上传密钥 ——
  $('#key-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target, button = form.querySelector('button'); button.disabled = true; button.textContent = '验证中…';
    try { const result = await api.saveCredentials({ secretId: form.secretId.value, secretKey: form.secretKey.value }); keySaved = true; $('#key-id').textContent = result.id; form.reset(); toast('密钥验证通过，已保存'); }
    catch (error) { toast(message(error), true); }
    finally { button.disabled = false; button.textContent = '验证并保存'; refresh(); }
  });
  $('#key-change').addEventListener('click', async () => { await api.clearCredentials(); keySaved = false; refresh(); });

  // —— 选文件夹：按钮、拖进来、最近找到的 ——
  $('#choose').addEventListener('click', async () => { const dir = await api.chooseFolder(); if (dir) inspect(dir); });
  $('#release-change').addEventListener('click', () => { if (publishing) return; release = null; $('#release').hidden = true; $('#drop').hidden = false; refresh(); });
  document.addEventListener('dragover', event => { event.preventDefault(); $('#drop').classList.add('over'); });
  document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('#drop').classList.remove('over'); });
  document.addEventListener('drop', event => {
    event.preventDefault(); $('#drop').classList.remove('over');
    const file = event.dataTransfer.files[0]; if (!file || publishing) return;
    inspect(api.pathOf(file));
  });
  $('#recent').addEventListener('click', event => { const button = event.target.closest('[data-dir]'); if (button) inspect(button.dataset.dir); });

  // —— 一键发布 ——
  $('#publish').addEventListener('click', () => {
    $('#confirm-title').textContent = `发布 v${release.version}？`;
    $('#confirm-text').textContent = `发布后，所有装了控制台的电脑都会弹出「发现新版本 v${release.version}」。${online ? `线上现在是 v${online.version}。` : ''}`;
    $('#confirm').showModal();
  });
  $('#confirm-no').addEventListener('click', () => $('#confirm').close());
  const started = {};
  function step(kind, status, text, ratio) {
    const li = $(`#steps [data-kind="${kind}"]`); if (!li) return;
    li.className = status; li.querySelector('.status').textContent = text;
    if (ratio !== undefined) li.querySelector('.bar i').style.width = `${Math.round(ratio * 100)}%`;
  }
  api.on('publish-step', s => {
    if (s.status === 'checking' && s.kind !== 'verify') return step(s.kind, 'active', `核对 ${Math.floor(s.sent / s.size * 100)}%`, 0);
    if (s.status === 'skipped') return step(s.kind, 'done', '云上已有，跳过', 1);
    if (s.status === 'retry') return step(s.kind, 'warn', `出错，第 ${s.attempt} 次重试…`, 0);
    if (s.status === 'uploading') {
      started[s.kind] ??= { time: s.time, sent: s.sent };
      const seconds = (s.time - started[s.kind].time) / 1000, speed = seconds > 0.5 ? (s.sent - started[s.kind].sent) / seconds : 0;
      const left = speed > 0 ? Math.ceil((s.size - s.sent) / speed) : 0;
      return step(s.kind, 'active', `${Math.floor(s.sent / s.size * 100)}%${speed ? ` · ${mb(speed)}/s · 还要 ${left >= 60 ? Math.ceil(left / 60) + ' 分钟' : left + ' 秒'}` : ''}`, s.sent / s.size);
    }
    if (s.status === 'checking' && s.kind === 'verify') return step('verify', 'active', '核对中…', .5);
    if (s.status === 'done') return step(s.kind, 'done', '完成', 1);
  });
  $('#confirm-yes').addEventListener('click', async () => {
    $('#confirm').close();
    publishing = true; refresh();
    for (const k of Object.keys(started)) delete started[k];
    $('#steps').hidden = false; $('#result').hidden = true;
    for (const li of $('#steps').children) { li.className = ''; li.querySelector('.status').textContent = '等待'; li.querySelector('.bar i').style.width = '0'; }
    if (!release.files.some(f => f.kind === 'update')) $('#steps [data-kind="update"]').hidden = true;
    try {
      const result = await api.publish(release.dir);
      $('#result').className = 'result ok'; $('#result').innerHTML = `<strong>🎉 v${result.version} 发布成功</strong><span>所有控制台会在启动 20 秒后、或点「检查更新」时弹出更新提示。</span>`;
      await loadOnline();
    } catch (error) {
      $('#result').className = 'result bad'; $('#result').innerHTML = `<strong>发布没成功</strong><span></span><button class="link" type="button" id="retry">再试一次</button>`;
      $('#result span').textContent = message(error) + '。已经传上去的文件下次会自动跳过。';
    } finally { $('#result').hidden = false; publishing = false; refresh(); }
  });
  $('#result').addEventListener('click', event => { if (event.target.id === 'retry') $('#confirm-yes').click(); });
  $('#online-refresh').addEventListener('click', loadOnline);

  (async () => {
    const state = await api.state();
    keySaved = state.credentials.saved; $('#key-id').textContent = state.credentials.id || '';
    $('#recent').innerHTML = state.folders.length ? `<span class="muted">找到这些：</span>${state.folders.map(f => `<button class="chip" type="button" data-dir="${f.dir.replace(/"/g, '&quot;')}" title="${f.dir.replace(/"/g, '&quot;')}">v${f.version}</button>`).join('')}` : '';
    refresh(); loadOnline();
    if (state.folders[0]) inspect(state.folders[0].dir);
  })();
})();
