import { $, api, toast, giftById, image, escapeHtml } from './console-shared.js';
import { switchView } from './app.js';
const { formatDuration, operations } = Overtime;
let machine, timeStamp = '', rulesStamp = '', timeDirty = false, rulesDirty = false, pickingRow, volumeTimer, volumePending = false, volumeRevision = 0, panelsStamp = '', panelsDirty = false;
let peoplePage = 0, peopleStamp = '', historyStamp = '';
const form = $('#overtime-settings'), ruleList = $('#overtime-rules');
async function action(input) {
  const result = await api('/api/overtime/action', input); render(result.state); return result.state;
}
function addRule(rule = { gift_name:'', gift_id:0, operation:'add', value:1 }) {
  const row = document.createElement('div'); row.className = 'overtime-rule'; row.dataset.giftId = rule.gift_id || 0; row.dataset.giftName = rule.gift_name;
  row.media = rule.media ? {...rule.media} : null;
  row.innerHTML = `<button type="button" class="rule-gift gift-binding" aria-label="从礼物库选择礼物"></button><select class="rule-operation" aria-label="礼物作用">${Object.entries(operations).map(([value,label]) => `<option value="${value}"${rule.operation === value ? ' selected' : ''}>${label}</option>`).join('')}</select><input class="rule-value" type="number" min="1" max="1000000000000" required aria-label="分钟数或倍率" value="${rule.value}"><button type="button" class="icon-button rule-remove" aria-label="删除礼物规则">×</button>`;
  row.insertAdjacentHTML('beforeend', '<div class="rule-media"><button type="button" class="text-button rule-media-pick">添加图片/视频</button><span class="rule-media-name"></span><input class="rule-media-file" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm" hidden><label class="rule-media-key" hidden><input class="rule-media-green" type="checkbox" checked>去掉绿幕</label><label class="rule-media-time" hidden>显示<input class="rule-media-seconds" type="number" min="0.1" max="120" step="0.1" value="5" aria-label="图片显示秒数">秒</label><button type="button" class="text-button rule-media-test" hidden>试播</button><button type="button" class="icon-button rule-media-clear" aria-label="移除素材" hidden>×</button></div>');
  row.querySelector('.rule-media-pick').addEventListener('click', () => row.querySelector('.rule-media-file').click());
  row.querySelector('.rule-media-file').addEventListener('change', event => upload(row,event));
  row.querySelector('.rule-media-clear').addEventListener('click', () => { row.media = null; mediaControls(row); rulesDirty = true; });
  row.querySelector('.rule-media-test').addEventListener('click', async () => { try { await action({action:'preview_media',media:rowMedia(row)}); } catch(error) { toast(error.message,true); } });
  const sync = () => { const operation = row.querySelector('select').value, value = row.querySelector('.rule-value'); value.disabled = ['clear','lock_toggle','media'].includes(operation); value.min = ['multiply','divide'].includes(operation) ? '2' : '1'; if (value.disabled) value.value = '1'; };
  row.querySelector('select').addEventListener('change', sync); sync(); ruleList.append(row); giftButton(row);
  mediaControls(row);
}
function mediaControls(row) {
  const media = row.media;
  row.querySelector('.rule-media-name').textContent = media?.name || '';
  row.querySelector('.rule-media-name').title = media?.name || '';
  row.querySelector('.rule-media-pick').textContent = media ? '更换素材' : '添加图片/视频';
  row.querySelector('.rule-media-key').hidden = media?.kind !== 'video';
  row.querySelector('.rule-media-time').hidden = media?.kind !== 'image';
  row.querySelector('.rule-media-test').hidden = row.querySelector('.rule-media-clear').hidden = !media;
  row.querySelector('.rule-media-green').checked = media?.green_screen !== false;
  const seconds = row.querySelector('.rule-media-seconds');
  seconds.value = media?.kind === 'image' ? media.duration : 5;
  seconds.disabled = media?.kind !== 'image';
}
function rowMedia(row) { return row.media ? {...row.media, green_screen:row.querySelector('.rule-media-green').checked, duration:row.media.kind === 'image' ? Number(row.querySelector('.rule-media-seconds').value) : row.media.duration} : null; }
async function probe(media) {
  const element = document.createElement(media.kind === 'video' ? 'video' : 'img');
  const wait = event => new Promise((resolve,reject) => { element.addEventListener(event,resolve,{once:true}); element.addEventListener('error',() => reject(new Error('素材无法读取；视频请使用MP4（H.264）或WebM')),{once:true}); });
  let timeout, seekTimeout;
  try {
    const loaded = wait(media.kind === 'video' ? 'loadedmetadata' : 'load');
    element.src = `/api/overtime/media/${media.asset}`;
    await Promise.race([loaded,new Promise((_,reject) => { timeout = setTimeout(() => reject(new Error('读取素材超时，请换一个文件重试')),15000); })]);
    if (media.kind === 'image') return 5;
    if (!Number.isFinite(element.duration)) { const sought = wait('seeked'); element.currentTime = 86400; await Promise.race([sought,new Promise((_,reject)=>{seekTimeout=setTimeout(()=>reject(new Error('无法读取视频时长')),10000);})]); }
    if (!Number.isFinite(element.duration) || element.duration <= 0 || element.duration > 600) throw new Error('视频最长10分钟，请使用可正常播放的视频');
    return element.duration;
  } finally { clearTimeout(timeout); clearTimeout(seekTimeout); element.removeAttribute('src'); if (media.kind === 'video') element.load(); }
}
async function upload(row,event) {
  const file = event.target.files[0]; if (!file) return;
  const button = row.querySelector('.rule-media-pick'); button.disabled = true; button.textContent = '正在导入…';
  try {
    if (file.size > 200*1024*1024) throw new Error('素材文件最大200MB');
    const response = await fetch(`/api/overtime/media?name=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
    const media = await response.json(); if (!response.ok) throw new Error(media.error || '素材导入失败');
    const duration = await probe(media); row.media = {asset:media.asset,name:media.name,kind:media.kind,duration,green_screen:media.kind === 'video'};
    rulesDirty = true; toast('素材已导入，点击“保存礼物规则”后由礼物触发');
  } catch(error) { toast(error.message,true); }
  finally { button.disabled = false; event.target.value = ''; mediaControls(row); }
}
function giftButton(row) {
  const gift = giftById.get(Number(row.dataset.giftId)), button = row.querySelector('.rule-gift');
  button.innerHTML = `${gift?.icon ? `<img loading="lazy" src="${image(gift)}" alt="">` : ''}<span class="gift-binding-name">${escapeHtml(row.dataset.giftName || '选择礼物 ↗')}</span>`;
  button.title = `${row.dataset.giftName || '选择礼物'} · 从礼物库选择`;
}
function clock(next) {
  if (!machine) return;
  Object.assign(machine, next); $('#overtime-mode').textContent = ({ idle:'等待开机', running:'加班中', paused:'已暂停', finished:'已下班' })[machine.mode];
  $('#overtime-start').textContent = machine.mode === 'running' ? '暂停加班' : machine.mode === 'idle' ? '开机加班' : machine.mode === 'finished' ? '重新开机' : '继续加班';
  $('#overtime-lock').textContent = machine.clear_locked ? '🔒 清空已锁定' : '🔓 清空未锁定';
}
function render(next) {
  machine = next; clock(next);
  if (!volumePending) {$('#overtime-volume').value=machine.config.media_volume;$('#overtime-volume-value').textContent=`${machine.config.media_volume}%`;}
  const stamp = JSON.stringify([machine.config.initial_text,machine.config.time_unit,machine.config.clear_lock_default_unlocked]);
  if (!timeDirty && stamp !== timeStamp) {
    timeStamp = stamp; $('#overtime-initial').value = machine.config.initial_text; $('#overtime-unit').value = machine.config.time_unit; $('#overtime-default-lock').checked = !machine.config.clear_lock_default_unlocked;
  }
  const nextRulesStamp = JSON.stringify(machine.config.gift_rules);
  if (!rulesDirty && nextRulesStamp !== rulesStamp) {
    rulesStamp = nextRulesStamp; ruleList.replaceChildren(); machine.config.gift_rules.forEach(addRule);
  }
  const selected = $('#overtime-test-rule').value;
  $('#overtime-test-rule').innerHTML = machine.config.gift_rules.map((rule,index) => `<option value="${index}">${escapeHtml(rule.gift_name)} · ${escapeHtml(Overtime.ruleText(rule))}</option>`).join('');
  if (selected) $('#overtime-test-rule').value = selected;
  renderStatistics();
  renderPanels();
}
function renderStatistics() {
  if (!machine || $('#console-view').hidden) return;
  // Keep DOM work bounded while preserving every viewer in the saved/exported statistics.
  const pages = Math.max(1,Math.ceil(machine.people.length / 100));
  peoplePage = Math.max(0,Math.min(peoplePage,pages - 1));
  const people = machine.people.slice(peoplePage * 100,(peoplePage + 1) * 100);
  $('#overtime-people-pages').hidden = pages === 1;
  $('#overtime-people-page').textContent = `第 ${peoplePage + 1} / ${pages} 页 · 共 ${machine.people.length.toLocaleString()} 人`;
  $('#overtime-people-prev').disabled = peoplePage === 0;
  $('#overtime-people-next').disabled = peoplePage === pages - 1;
  const nextPeopleStamp = JSON.stringify(people);
  if (nextPeopleStamp !== peopleStamp) {
    peopleStamp = nextPeopleStamp;
    $('#overtime-people').innerHTML = people.map(person => `<tr><td><div class="overtime-viewer"><img loading="lazy" class="overtime-avatar" src="${escapeHtml(Overtime.avatarUrl(person.face))}" alt=""><span>${escapeHtml(person.user)}${person.simulated ? ' [测试]' : ''}<small>${person.uid ? `UID ${person.uid}` : person.simulated ? '模拟观众' : '未收到UID，按昵称识别'}</small></span></div></td><td class="added">${escapeHtml(formatDuration(person.added))}</td><td class="reduced">${escapeHtml(formatDuration(person.reduced))}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">还没有观众加减班记录</td></tr>';
  }
  const nextHistoryStamp = JSON.stringify(machine.history);
  if (nextHistoryStamp !== historyStamp) {
    historyStamp = nextHistoryStamp;
    $('#overtime-history').innerHTML = machine.history.map(record => `<p>${new Date(record.time).toLocaleTimeString('zh-CN')} · ${escapeHtml(record.user)}${record.simulated ? ' [测试]' : ''} · ${escapeHtml(record.gift_name)} ×${record.count} → ${record.added !== '0' ? `加班 ${escapeHtml(formatDuration(record.added))}` : record.reduced !== '0' ? `减班 ${escapeHtml(formatDuration(record.reduced))}` : escapeHtml(record.effect)}</p>`).join('');
  }
  $('#overtime-totals').textContent = `累计加班 ${formatDuration(machine.people.reduce((sum,person) => sum + BigInt(person.added),0n))} · 累计减班 ${formatDuration(machine.people.reduce((sum,person) => sum + BigInt(person.reduced),0n))}`;
}
$('#overtime-people-prev').addEventListener('click', () => { peoplePage = Math.max(0,peoplePage - 1); renderStatistics(); });
$('#overtime-people-next').addEventListener('click', () => { if (machine) peoplePage = Math.max(0,Math.min(Math.ceil(machine.people.length / 100) - 1,peoplePage + 1)); renderStatistics(); });
window.addEventListener('view-changed', renderStatistics);
function config(settingsForm) {
  if (settingsForm === form) return {...machine.config,initial_text:$('#overtime-initial').value.trim(),time_unit:$('#overtime-unit').value,clear_lock_default_unlocked:!$('#overtime-default-lock').checked};
  return { ...machine.config, gift_rules:Array.from(ruleList.children).map(row => {
    if (!row.dataset.giftName) throw new Error('请从礼物库选择每条规则的礼物');
    const media = rowMedia(row);
    return { gift_name:row.dataset.giftName, gift_id:Number(row.dataset.giftId), operation:row.querySelector('select').value, value:Number(row.querySelector('.rule-value').value), ...(media ? {media} : {}) };
  }) };
}
for (const settingsForm of [form,$('#overtime-gift-settings')]) {
settingsForm.addEventListener('input', () => { if (settingsForm === form) timeDirty = true; else rulesDirty = true; });
settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  try { await action({ action:'configure', config:config(settingsForm) }); if (settingsForm === form) {timeDirty = false; timeStamp = '';} else {rulesDirty = false; rulesStamp = '';} render(machine); toast(settingsForm === form ? '时间设置已保存，初始时间在重置后生效' : '礼物规则已保存'); } catch (error) { toast(error.message,true); }
});
}
ruleList.addEventListener('click', event => {
  if (event.target.closest('.rule-remove')) { event.target.closest('.overtime-rule').remove(); rulesDirty = true; }
  if (event.target.closest('.rule-gift')) {
    pickingRow = event.target.closest('.overtime-rule');
    $('#overtime-pick-label').textContent = `为“${operations[pickingRow.querySelector('select').value]}”选择礼物，点击礼物后返回加班机。`;
    const back = $('#overtime-pick-note [data-view]'); back.dataset.view = 'overtime'; back.textContent = '取消选择，返回加班机';
    $('#overtime-pick-note').hidden = false; switchView('gifts');
  }
});
window.addEventListener('gift-picked', event => {
  if (!pickingRow?.isConnected || $('#gifts-view').hidden) return;
  event.preventDefault(); const gift = event.detail;
  if (pickingRow.classList.contains('panel-entry')) {
    pickingRow.dataset.giftId = gift.id; pickingRow.dataset.giftName = gift.name; giftButton(pickingRow);
    markPanelDirty(pickingRow.closest('form')); switchView('gift-rules'); toast('礼物已选择，填写作用文字后保存面板'); return;
  }
  if (Array.from(ruleList.children).some(row => row !== pickingRow && (Number(row.dataset.giftId) === gift.id || giftById.get(Number(row.dataset.giftId))?.id === gift.id))) { toast('这个礼物已有加班规则，请选择其他礼物',true); return; }
  pickingRow.dataset.giftId = gift.id; pickingRow.dataset.giftName = gift.name; giftButton(pickingRow); rulesDirty = true;
  switchView('overtime'); toast('礼物已选择，点击“保存礼物规则”生效');
});
window.addEventListener('view-changed', event => { if (event.detail !== 'gifts') { pickingRow = null; $('#overtime-pick-note').hidden = true; } });
$('#overtime-add-rule').addEventListener('click', () => { addRule(); rulesDirty = true; });
$('#overtime-volume').addEventListener('input',event=>{
  const volume = Number(event.target.value), revision = ++volumeRevision; volumePending=true; $('#overtime-volume-value').textContent=`${volume}%`; clearTimeout(volumeTimer);
  volumeTimer=setTimeout(async()=>{
    try {const result=await api('/api/overtime/action',{action:'volume',volume});if(revision===volumeRevision)render(result.state);} catch(error) {if(revision===volumeRevision)toast(error.message,true);}
    finally {if(revision===volumeRevision){volumePending=false;if(machine)render(machine);}}
  },150);
});
$('#overtime-stop-media').addEventListener('click', async () => { try { await action({action:'stop_media'}); } catch(error) { toast(error.message,true); } });
$('#overtime-start').addEventListener('click', async () => { try { if (timeDirty || rulesDirty) { toast('请先保存修改过的时间设置或礼物规则',true); return; } await action({ action:machine.mode === 'running' ? 'pause' : 'start' }); } catch (error) { toast(error.message,true); } });
for (const kind of ['reset','clear','lock','clear_stats']) $(`#overtime-${kind.replace('_','-')}`).addEventListener('click', async () => {
  if (kind === 'clear_stats' && !confirm('清空所有观众统计和最近明细？剩余加班时间不变。')) return;
  try { await action({ action:kind }); } catch (error) { toast(error.message,true); }
});
for (const operation of ['add','subtract']) $(`#overtime-manual-${operation}`).addEventListener('click', async () => { try { await action({ action:'manual', operation, minutes:$('#overtime-manual-minutes').value }); } catch (error) { toast(error.message,true); } });
$('#overtime-test').addEventListener('submit', async event => {
  event.preventDefault();
  try { if (!machine || machine.mode === 'idle') throw new Error('请先开机加班，再模拟礼物'); await action({ action:'simulate', rule:Number($('#overtime-test-rule').value), user:$('#overtime-test-user').value.trim(), count:Number($('#overtime-test-count').value) }); toast('模拟礼物已结算，统计标记为测试'); } catch (error) { toast(error.message,true); }
});
for(const [id,query,label,size] of [['#overtime-copy-url','capture=1','加班机','960 × 320'],['#overtime-copy-media-url','media=1&capture=1','素材','640 × 360']]) $(id).addEventListener('click',async()=>{
  const url = `${location.origin}/overtime/?${query}`;
  try {await navigator.clipboard.writeText(url);toast(`${label}地址已复制，网页素材建议${size}`);}
  catch {$('#obs-url-value').value=url;$('#obs-url-dialog').showModal();}
});
const panelList = $('#gift-panel-list');
function panelStyle(row) {
  const style = {transparent:row.querySelector('.panel-transparent').checked,background:row.querySelector('.panel-background').value,show_gift_name:row.querySelector('.panel-show-gift-name').checked,gift_text_gap:Number(row.querySelector('.panel-text-gap').value)};
  for (const key of Object.keys(Overtime.textGroups)) {
    const group = row.querySelector(`[data-text-group="${key}"]`);
    style[key] = {font:group.querySelector('.text-font').value.trim(),size:Number(group.querySelector('.text-size').value),color:group.querySelector('.text-color').value,stroke_color:group.querySelector('.text-stroke-color').value,stroke_width:Number(group.querySelector('.text-stroke-width').value)};
  }
  return style;
}
function panelConfig(row) {
  const base = {id:row.dataset.panelId,name:row.querySelector('.panel-name').value.trim(),columns:Number(row.querySelector('.panel-columns').value),template:row.dataset.template,style:panelStyle(row)};
  if (base.template === 'custom') return {...base,entries:Array.from(row.querySelectorAll('.panel-entry'),entry => ({gift_id:Number(entry.dataset.giftId),gift_name:entry.dataset.giftName,text:entry.querySelector('.panel-entry-text').value.trim()}))};
  return {...base,all_rules:row.querySelector('.panel-all').checked,gift_keys:Array.from(row.querySelectorAll('.panel-rule:checked'),input => input.value)};
}
function addPanelEntry(list, entry = {gift_id:0,gift_name:'',text:''}) {
  const row = document.createElement('div'); row.className = 'panel-entry'; row.dataset.giftId = entry.gift_id; row.dataset.giftName = entry.gift_name;
  row.innerHTML = `<button type="button" class="rule-gift gift-binding" aria-label="从礼物库选择礼物"></button><label>礼物作用<textarea class="panel-entry-text" rows="2" maxlength="200" required placeholder="输入作用文字，例如：点一首歌">${escapeHtml(entry.text)}</textarea></label><button type="button" class="icon-button panel-entry-remove" aria-label="删除自定义礼物">×</button>`;
  list.append(row); giftButton(row);
}
function addPanelStyleSettings(row,panel) {
  const style = Overtime.normalizePanelStyle(panel.style), controls = document.createElement('details');
  controls.className = 'panel-style-settings';
  controls.innerHTML = `<summary>样式设置 <span>背景 · 字体 · 描边</span></summary><div class="panel-style-background"><label><input type="checkbox" class="panel-transparent"${style.transparent ? ' checked' : ''}>背景透明</label><label>背景颜色<input type="color" class="panel-background" value="${style.background}" aria-label="背景颜色"></label></div><div class="panel-style-target"><label>设置文字<select class="panel-text-target">${Object.entries(Overtime.textGroups).map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label><button type="button" class="text-button" data-panel-action="outline-preset">黑字白描边</button></div>${Object.entries(Overtime.textGroups).map(([key,label]) => {const text = style[key];return `<fieldset data-text-group="${key}"${key !== 'title' ? ' hidden' : ''} aria-label="${label}样式"><div class="panel-style-fields"><label class="panel-font-field">字体<input class="text-font" list="panel-fonts" value="${escapeHtml(text.font)}" maxlength="60" required placeholder="选择或输入字体名称"></label><label>字号（px）<input type="number" class="text-size" value="${text.size}" min="8" max="120" step="1" required></label><label>文字颜色<input type="color" class="text-color" value="${text.color}"></label><label>描边颜色<input type="color" class="text-stroke-color" value="${text.stroke_color}"></label><label>描边粗细（px）<input type="number" class="text-stroke-width" value="${text.stroke_width}" min="0" max="8" step="0.5" required></label></div></fieldset>`;}).join('')}<p class="overtime-note">描边设为0可关闭。字体可选常用字体，也可输入本机已安装的字体名称。</p>`;
  controls.querySelector('.panel-style-target').insertAdjacentHTML('beforebegin',`<div class="panel-style-layout"><label><input type="checkbox" class="panel-show-gift-name"${style.show_gift_name ? ' checked' : ''}>显示礼物名称</label><label>礼物与文案间距（px）<input type="number" class="panel-text-gap" value="${style.gift_text_gap}" min="0" max="200" step="1" required></label></div><p class="overtime-note">图片大小随显示文字的字号自动调整。</p>`);
  const preview = row.querySelector('.gift-panel-preview'), wrapper = document.createElement('div');
  wrapper.className = 'gift-panel-preview-wrap'; preview.classList.add('gift-panel-surface');
  preview.before(controls,wrapper); wrapper.append(preview);
}
function panelPreview(row) {
  const panel = panelConfig(row), entries = Overtime.panelEntries(panel,machine.config.gift_rules);
  if (panel.template === 'overtime') row.querySelector('.gift-panel-rules').hidden = panel.all_rules;
  const preview = row.querySelector('.gift-panel-preview');
  preview.style.setProperty('--columns',panel.columns);
  row.querySelector('.panel-background').disabled = panel.style.transparent;
  row.querySelector('.gift-panel-preview-wrap').classList.toggle('is-transparent',panel.style.transparent);
  // 文字与数字输入中途可能为空，暂时保留上一次有效预览。
  try { Overtime.applyPanelStyle(preview,panel.style); } catch {}
  preview.innerHTML = `<h3>${escapeHtml(panel.name || '礼物规则')}</h3><div class="gift-panel-preview-list">${entries.map(entry => `<div class="rule-row">${entry.gift_id ? `<img loading="lazy" src="/api/gifts/${entry.gift_id}/image" alt="">` : ''}<span>${escapeHtml(entry.gift_name || '选择礼物')}</span><b>${escapeHtml(entry.text || '输入作用文字')}</b></div>`).join('') || '<span>未选择展示礼物</span>'}</div>`;
}
function renderPanels() {
  const stamp = JSON.stringify([machine.config.gift_panels,machine.config.gift_rules]);
  if (panelsDirty || stamp === panelsStamp) return;
  panelsStamp = stamp;
  const editors = new Map(Array.from(panelList.querySelectorAll('form'),row => [row.dataset.panelId,{open:row.querySelector('.panel-style-settings')?.open,target:row.querySelector('.panel-text-target')?.value}]));
  panelList.innerHTML = machine.config.gift_panels.map(panel => `<form class="overtime-card gift-panel-card" data-panel-id="${panel.id}" data-template="${panel.template}"><div class="overtime-stat-heading"><h3>${escapeHtml(panel.name)}</h3><button type="button" class="text-button" data-panel-action="delete">删除</button></div><p class="gift-panel-template-label">${panel.template === 'custom' ? '自定义文字模板' : '加班机模板'}</p><div class="gift-panel-fields"><label>面板标题<input class="panel-name" value="${escapeHtml(panel.name)}" maxlength="40" required></label><label>展示列数<select class="panel-columns">${[1,2,3].map(columns => `<option value="${columns}"${panel.columns === columns ? ' selected' : ''}>${columns} 列</option>`).join('')}</select></label></div>${panel.template === 'custom' ? '<div class="panel-entries"></div><button type="button" class="text-button" data-panel-action="add-entry">添加礼物 ＋</button><p class="overtime-note">选择礼物后输入作用文字，保存即可展示在面板中。</p>' : `<label class="gift-panel-all"><input type="checkbox" class="panel-all"${panel.all_rules ? ' checked' : ''}>展示全部礼物规则（包含之后新增的规则）</label><div class="gift-panel-rules">${machine.config.gift_rules.map(rule => `<label><input type="checkbox" class="panel-rule" value="${escapeHtml(Overtime.ruleKey(rule))}"${panel.gift_keys.includes(Overtime.ruleKey(rule)) ? ' checked' : ''}>${rule.gift_id ? `<img loading="lazy" src="/api/gifts/${rule.gift_id}/image" alt="">` : ''}<span>${escapeHtml(rule.gift_name)}</span><small>${escapeHtml(Overtime.ruleText(rule))}</small></label>`).join('') || '<p class="overtime-note">请先保存加班机规则</p>'}</div>`}<div class="gift-panel-preview" aria-label="礼物面板预览"></div><div class="overtime-tools"><button type="submit" class="button dark-button">保存面板</button><a class="button white-button" href="/overtime/?panel=${panel.id}" target="_blank" rel="noopener">打开浮窗 ↗</a><button type="button" class="button white-button" data-panel-action="url">复制面板地址</button><button type="button" class="button white-button" data-panel-action="duplicate">复制面板</button></div><p class="overtime-note panel-save-note" hidden>面板有未保存的修改，保存后应用到独立画面。</p></form>`).join('') || '<div class="gift-panel-empty">还没有礼物面板<br>选择上面的模板，创建第一个面板</div>';
  Array.from(panelList.querySelectorAll('form')).forEach((row,index) => {
    const panel = machine.config.gift_panels[index];
    if (panel.template === 'custom') panel.entries.forEach(entry => addPanelEntry(row.querySelector('.panel-entries'),entry));
    addPanelStyleSettings(row,panel);
    const editor = editors.get(panel.id);
    if (editor) { row.querySelector('.panel-style-settings').open = editor.open; row.querySelector('.panel-text-target').value = editor.target; row.querySelectorAll('[data-text-group]').forEach(group => group.hidden = group.dataset.textGroup !== editor.target); }
    panelPreview(row);
  });
}
function panelDrafts() { return Array.from(panelList.querySelectorAll('form'),panelConfig); }
async function savePanels(panels) {
  if (!Array.from(panelList.querySelectorAll('form')).every(row => {
    if (!panels.some(panel => panel.id === row.dataset.panelId)) return true;
    const invalid = row.querySelector(':invalid');
    const settings = invalid?.closest('.panel-style-settings'); if (settings) settings.open = true;
    const group = invalid?.closest('[data-text-group]');
    if (group) { row.querySelector('.panel-style-settings').open = true; row.querySelector('.panel-text-target').value = group.dataset.textGroup; row.querySelectorAll('[data-text-group]').forEach(item => item.hidden = item !== group); }
    return row.reportValidity();
  })) return false;
  await action({action:'panels',panels}); panelsDirty = false; panelsStamp = ''; renderPanels(); return true;
}
function markPanelDirty(row) { panelsDirty = true; row.querySelector('.panel-save-note').hidden = false; panelPreview(row); }
panelList.addEventListener('input', event => {
  const row = event.target.closest('form'); if (!row) return;
  if (event.target.matches('.panel-text-target')) { row.querySelectorAll('[data-text-group]').forEach(group => group.hidden = group.dataset.textGroup !== event.target.value); return; }
  markPanelDirty(row);
});
panelList.addEventListener('submit', async event => { event.preventDefault(); try { if (await savePanels(panelDrafts())) toast('礼物面板已保存'); } catch(error) { toast(error.message,true); } });
panelList.addEventListener('click', async event => {
  const entry = event.target.closest('.panel-entry'), form = event.target.closest('form');
  if (entry && event.target.closest('.panel-entry-remove')) { entry.remove(); markPanelDirty(form); return; }
  if (entry && event.target.closest('.rule-gift')) {
    pickingRow = entry;
    $('#overtime-pick-label').textContent = '为自定义礼物面板选择礼物，选好后返回填写作用文字。';
    const back = $('#overtime-pick-note [data-view]'); back.dataset.view = 'gift-rules'; back.textContent = '取消选择，返回礼物面板';
    $('#overtime-pick-note').hidden = false; switchView('gifts'); return;
  }
  const button = event.target.closest('[data-panel-action]'); if (!button) return;
  const row = button.closest('form'), id = row.dataset.panelId;
  try {
    const kind = button.dataset.panelAction;
    if (kind === 'outline-preset') { row.querySelectorAll('[data-text-group]').forEach(group => { group.querySelector('.text-color').value = '#000000'; group.querySelector('.text-stroke-color').value = '#ffffff'; group.querySelector('.text-stroke-width').value = group.dataset.textGroup === 'title' ? '3' : '2'; }); markPanelDirty(row); return; }
    if (kind === 'add-entry') { if (row.querySelectorAll('.panel-entry').length >= 100) throw new Error('每个面板最多配置100个礼物'); addPanelEntry(row.querySelector('.panel-entries')); markPanelDirty(row); return; }
    if (kind === 'url') {
      const url = `${location.origin}/overtime/?panel=${id}&capture=1`;
      try { await navigator.clipboard.writeText(url); toast('礼物面板地址已复制，网页素材建议640 × 360'); }
      catch { $('#obs-url-value').value = url; $('#obs-url-dialog').showModal(); }
      return;
    }
    if (kind === 'delete') {
      if (!confirm('删除这个礼物展示面板？礼物规则会保留。')) return;
      const panels = panelDrafts().filter(panel => panel.id !== id);
      if (await savePanels(panels)) toast('礼物面板已删除');
    } else if (kind === 'duplicate') {
      const panels = panelDrafts(), panel = panels.find(panel => panel.id === id);
      panels.push({...panel,id:crypto.randomUUID(),name:`${panel.name.slice(0,36)} 副本`});
      if (await savePanels(panels)) toast('已复制配置并创建新面板');
    }
  } catch(error) { toast(error.message,true); }
});
for (const button of document.querySelectorAll('[data-panel-template]')) button.addEventListener('click', async () => {
  try { if (!machine) return; const panels = panelDrafts(), template = button.dataset.panelTemplate; panels.push({id:crypto.randomUUID(),name:`${template === 'custom' ? '自定义' : '加班机'}面板 ${panels.length+1}`,columns:1,template,...(template === 'custom' ? {entries:[]} : {all_rules:true,gift_keys:[]})}); if (await savePanels(panels)) toast('礼物面板已创建'); }
  catch(error) { toast(error.message,true); }
});
$('#overtime-import').addEventListener('click', () => $('#overtime-import-file').click());
$('#overtime-import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 100000) throw new Error('配置文件过大'); const data = JSON.parse(await file.text()); await action({ action:'import', config:data.config || data }); timeDirty = rulesDirty = false; timeStamp = rulesStamp = ''; render(machine); toast('加班机配置已导入，当前时间和统计保留'); } catch (error) { toast(error.message,true); } finally { event.target.value = ''; }
});
window.addEventListener('gifts-loaded', () => { Array.from(ruleList.children).forEach(giftButton); panelList.querySelectorAll('.panel-entry').forEach(giftButton); });
// During gift bursts the server sends the viewer list at most once a second; frames without it keep the current list.
window.addEventListener('overtime-state', event => { const next = event.detail; if (!Object.hasOwn(next,'people')) next.people = machine?.people || []; render(next); });
window.addEventListener('generated-gift-panel',async()=>{try{const next=await api('/api/overtime/state');if(panelsDirty){const drafts=panelDrafts(),existing=new Set(drafts.map(p=>p.id));machine=next;machine.config.gift_panels=[...drafts,...next.config.gift_panels.filter(p=>!existing.has(p.id))];panelsDirty=false;panelsStamp='';renderPanels();panelsDirty=true;panelList.querySelectorAll('.panel-save-note').forEach(note=>note.hidden=false);}else{panelsStamp='';render(next);}}catch(e){toast(e.message,true);}});
window.addEventListener('before-generate-panel',event=>{if(event.detail==='overtime'&&rulesDirty){event.preventDefault();toast('请先保存礼物规则，再生成礼物面板',true);}});
window.addEventListener('overtime-clock', event => clock(event.detail));
api('/api/overtime/state').then(render).catch(error => toast(error.message,true));
