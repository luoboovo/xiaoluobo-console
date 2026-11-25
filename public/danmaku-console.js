import { $, api, toast, escapeHtml } from './console-shared.js';
import { state as consoleState } from './app.js';

// 弹幕姬：设置、背景、定制气泡都存在本机控制台（按平台分开），直播画面连上就自动同步。
const form = $('#danmaku-settings'), bgForm = $('#danmaku-background'), frame = $('#danmaku-frame');
const dialog = $('#danmaku-bubble-dialog'), bubbleForm = $('#danmaku-bubble-form');
let current = null, draft = null;
form.elements.theme.innerHTML = window.DanmakuSkins.THEMES.map(t => `<option value="${t.key}">${t.name}</option>`).join('');

const post = message => frame.contentWindow?.postMessage(message, location.origin);
const platform = () => consoleState?.config?.platform || 'bilibili';
const timers = {};
function later(key, work, ms = 350) { clearTimeout(timers[key]); timers[key] = setTimeout(work, ms); }
async function act(input, quiet = true) {
  try { const { state } = await api('/api/danmaku/action', input); render(state); if (!quiet) toast('已保存'); return state; }
  catch (error) { toast(error.message, true); if (current) render(current, true); throw error; }
}
async function upload(file) {
  if (file.size > 16 * 1024 * 1024) throw new Error('图片不能超过 16MB');
  const response = await fetch('/api/feeding/assets', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Luobo-Platform': platform() }, body: file });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '上传失败');
  if (!/\.(png|jpg|gif|webp|bmp)$/.test(result.url)) throw new Error('请上传图片');
  return result.url;
}
const imageSize = url => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => reject(new Error('图片读不出来')); img.src = url; });

// —— 画面设置 ——
function settingsDraft() {
  const out = {};
  for (const input of form.elements) {
    if (!input.name) continue;
    out[input.name] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
  }
  return out;
}
form.addEventListener('input', () => {
  const settings = settingsDraft();
  post({ type: 'danmaku-draft', state: { settings } });
  later('settings', () => act({ action: 'settings', settings }).catch(() => {}));
});
form.addEventListener('submit', event => event.preventDefault());

// —— 背景 ——
function syncOutputs(root) { for (const range of root.querySelectorAll('input[type=range]')) range.nextElementSibling.textContent = range.value + (range.name === 'blur' ? 'px' : '%'); }
function bgDraft() {
  const out = { image: current?.background.image || '' };
  for (const input of bgForm.elements) if (input.name) out[input.name] = input.type === 'range' ? Number(input.value) : input.value;
  return out;
}
function bgVisibility() { for (const el of bgForm.querySelectorAll('[data-only]')) el.hidden = bgForm.elements.fit.value !== el.dataset.only; }
bgForm.addEventListener('input', () => {
  syncOutputs(bgForm); bgVisibility();
  const background = bgDraft();
  post({ type: 'danmaku-draft', state: { background } });
  later('background', () => act({ action: 'background', background }).catch(() => {}));
});
$('#danmaku-bg-upload').addEventListener('click', () => $('#danmaku-bg-file').click());
$('#danmaku-bg-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  try { const image = await upload(file); await act({ action: 'background', background: { image } }); toast('背景图已换上'); } catch (error) { toast(error.message, true); }
});
$('#danmaku-bg-remove').addEventListener('click', () => act({ action: 'background', background: { image: '' } }).then(() => toast('已去掉背景图'), () => {}));

// —— 定制气泡列表 ——
const LENGTHS = { auto: '自动', short: '短', long: '长' };
const lengthSwitch = b => b.length ? `<span class="danmaku-length" role="group" aria-label="${escapeHtml(b.name)}长短">${Object.entries(LENGTHS).map(([key, label]) => `<button type="button" data-bubble-length="${key}" data-id="${escapeHtml(b.id)}" aria-pressed="${b.length === key}">${label}</button>`).join('')}</span>` : '';
const WHO = { all: '所有观众', fans: '粉丝牌 / 粉丝团', guard: '舰长及以上' };
function renderBubbles(list) {
  $('#danmaku-bubbles').innerHTML = list.length ? list.map(b => `<li><span class="danmaku-bubble-thumb"><img src="${escapeHtml(b.image)}" alt=""></span><span class="danmaku-bubble-info"><b>${escapeHtml(b.name)}${b.builtin ? '<em class="danmaku-builtin">内置</em>' : ''}</b><span>口令「${escapeHtml(b.keyword)}」· ${WHO[b.who]} · ${b.users} 人在用</span>${lengthSwitch(b)}</span><button type="button" class="text-button" data-bubble-edit="${escapeHtml(b.id)}">编辑</button></li>`).join('') : '<li class="danmaku-empty">还没有定制气泡</li>';
}
$('#danmaku-bubbles').addEventListener('click', event => {
  const length = event.target.closest('[data-bubble-length]');
  if (length) { act({ action: 'bubble_length', id: length.dataset.id, length: length.dataset.bubbleLength }, false).catch(() => {}); return; }
  const id = event.target.closest('[data-bubble-edit]')?.dataset.bubbleEdit;
  if (id) openEditor(current.bubbles.find(b => b.id === id));
});

function render(state, force = false) {
  if (!state) return;
  current = state;
  const editing = el => !force && el.contains(document.activeElement) && document.activeElement !== document.body;
  if (!editing(form)) for (const [name, value] of Object.entries(state.settings)) {
    const input = form.elements[name]; if (!input) continue;
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
  }
  const bg = state.background;
  if (!editing(bgForm)) { for (const name of ['fit', 'scale', 'x', 'y', 'opacity', 'blur']) bgForm.elements[name].value = bg[name]; syncOutputs(bgForm); bgVisibility(); }
  $('#danmaku-bg-fields').disabled = !bg.image;
  $('#danmaku-bg-remove').hidden = !bg.image;
  $('#danmaku-bg-empty').hidden = Boolean(bg.image);
  $('#danmaku-bg-thumb').hidden = !bg.image;
  $('#danmaku-bg-thumb').style.backgroundImage = bg.image ? `url("${bg.image}")` : '';
  $('#danmaku-bg-upload').textContent = bg.image ? '换一张' : '上传图片';
  renderBubbles(state.bubbles);
}
window.addEventListener('danmaku-state', event => render(event.detail));
api('/api/danmaku/state').then(render).catch(() => {});

// —— 定制气泡编辑 ——
let editing = null;
const DEFAULT_BUBBLE = { name: '', keyword: '', who: 'all', image: '', ratio: 1672 / 941, box: { left: 48, right: 9, top: 33, bottom: 28 }, width: 360, font: 100, color: '#2b2b2b' };
function openEditor(bubble) {
  editing = structuredClone(bubble || { ...DEFAULT_BUBBLE, box: { ...DEFAULT_BUBBLE.box } });
  const f = bubbleForm.elements;
  f.name.value = editing.name; f.keyword.value = bubble ? editing.keyword : ''; f.who.value = editing.who;
  for (const side of ['left', 'right', 'top', 'bottom']) f[side].value = editing.box[side];
  f.width.value = editing.width; f.font.value = editing.font; f.color.value = editing.color; f.colorHex.value = editing.color.toUpperCase();
  $('#danmaku-bubble-delete').hidden = !bubble;
  $('#danmaku-bubble-title').textContent = bubble ? `编辑「${bubble.name}」` : '新建定制气泡';
  drawEditor();
  dialog.showModal();
}
function readEditor() {
  const f = bubbleForm.elements;
  editing.name = f.name.value.trim(); editing.who = f.who.value;
  editing.keyword = f.keyword.value.trim() || (editing.name ? `切换${editing.name}` : '');
  for (const side of ['left', 'right', 'top', 'bottom']) editing.box[side] = Number(f[side].value);
  editing.width = Number(f.width.value) || 300; editing.font = Number(f.font.value) || 100; editing.color = f.color.value;
}
function drawEditor() {
  const stage = $('#danmaku-bubble-stage'), box = $('#danmaku-bubble-box'), img = $('#danmaku-bubble-image');
  bubbleForm.elements.keyword.placeholder = bubbleForm.elements.name.value.trim() ? `切换${bubbleForm.elements.name.value.trim()}` : '切换萝卜专属气泡';
  stage.classList.toggle('empty', !editing.image);
  if (editing.image) img.src = editing.image; else img.removeAttribute('src');
  stage.style.aspectRatio = String(editing.ratio);
  Object.assign(box.style, { left: editing.box.left + '%', right: editing.box.right + '%', top: editing.box.top + '%', bottom: editing.box.bottom + '%', color: editing.color, justifyContent: editing.fixed ? 'center' : '', textAlign: editing.fixed ? 'center' : '' });
  // 编辑框里按实际宽度比例显示字号。
  const scale = stage.clientWidth / editing.width || 1;
  let size = 15 * editing.font / 100 * (editing.width / 300) * scale;
  box.style.fontSize = size + 'px';
  while ((box.scrollHeight > box.clientHeight + 1) && size > 6) { size -= 0.5; box.style.fontSize = size + 'px'; }
  syncOutputs(bubbleForm);
}
// 文字颜色：调色盘和色号框任选一个填，两边同步。色号可以写 #51435F、51435F，或者简写 #abc。
const hexOf = value => {
  const raw = String(value).trim().replace(/^#/, '');
  const full = /^[0-9a-f]{3}$/i.test(raw) ? raw.replace(/./g, c => c + c) : raw;
  return /^[0-9a-f]{6}$/i.test(full) ? '#' + full.toLowerCase() : '';
};
bubbleForm.addEventListener('input', event => {
  const f = bubbleForm.elements;
  if (event.target === f.colorHex) { const hex = hexOf(f.colorHex.value); f.colorHex.classList.toggle('invalid', !hex && f.colorHex.value.trim() !== ''); if (!hex) return; f.color.value = hex; }
  else if (event.target === f.color) { f.colorHex.value = f.color.value.toUpperCase(); f.colorHex.classList.remove('invalid'); }
  readEditor(); drawEditor();
});
bubbleForm.elements.colorHex.addEventListener('blur', () => { const f = bubbleForm.elements; f.colorHex.value = f.color.value.toUpperCase(); f.colorHex.classList.remove('invalid'); });
$('#danmaku-bubble-upload').addEventListener('click', () => $('#danmaku-bubble-file').click());
$('#danmaku-bubble-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  try {
    const url = await upload(file), { w, h } = await imageSize(url);
    editing.image = url; editing.ratio = Math.round(w / h * 10000) / 10000; delete editing.cap; editing.tile = false; editing.fixed = false; drawEditor();
  } catch (error) { toast(error.message, true); }
});
bubbleForm.addEventListener('submit', async event => {
  event.preventDefault(); readEditor();
  if (!editing.image) { toast('请先上传气泡图', true); return; }
  if (!editing.name) { toast('给气泡起个名字', true); return; }
  try { await act({ action: 'save_bubble', bubble: editing }); dialog.close(); toast(`已保存，观众发「${editing.keyword}」就能换上`); } catch {}
});
$('#danmaku-bubble-cancel').addEventListener('click', () => dialog.close());
$('#danmaku-bubble-delete').addEventListener('click', async () => {
  if (!editing?.id || !confirm(`删除「${editing.name}」？正在用它的观众会换回默认气泡。`)) return;
  try { await act({ action: 'delete_bubble', id: editing.id }); dialog.close(); toast('已删除'); } catch {}
});
$('#danmaku-bubble-new').addEventListener('click', () => openEditor(null));
new ResizeObserver(() => { if (dialog.open) drawEditor(); }).observe($('#danmaku-bubble-stage'));

// —— 打开 / 复制 / 演示 ——
// 给直播软件的地址带 ?hd=2：按 2 倍像素渲染，在 OBS 里缩小后文字清晰。
const address = () => `${location.origin}/danmaku/?hd=2`;
$('#danmaku-open').addEventListener('click', () => window.open(`${location.origin}/danmaku/`, '_blank', 'noopener'));
$('#danmaku-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(address()); toast('弹幕姬高清地址已复制：浏览器源宽高填 840 × 1440，再在 OBS 里拖小到合适大小，文字更清楚'); }
  catch { toast('复制失败，请手动复制：' + address(), true); }
});
const DEMO = [
  { type: 'member', user: '路过的小鱼', text: '进入了直播间' },
  { type: 'chat', user: '路过的小鱼', text: '主播晚上好～' },
  { type: 'chat', user: '萝卜粉丝', text: '今天也来打卡啦', medalLevel: 12, medalName: '小萝卜', wealthLevel: 8 },
  { type: 'chat', user: '星星守护者', text: '冲冲冲！', fansLevel: 8, fansClub: '萝卜团', wealthLevel: 23, platform: 'douyin' },
  { type: 'gift', user: '萝卜粉丝', giftName: '小花花', count: 5, giftUnit: 100, giftCoin: 'gold', medalLevel: 12, medalName: '小萝卜' },
  { type: 'chat', user: '舰长大人', text: '这把稳了', guard: 3, medalLevel: 21, medalName: '小萝卜', wealthLevel: 31, vip: 1 },
  { type: 'chat', user: '提督阁下', text: '@舰长大人 你说得对', guard: 2, medalLevel: 26, medalName: '小萝卜', wealthLevel: 42, mention: { name: '舰长大人' } },
  { type: 'social', user: '新来的朋友', text: '关注了主播' },
  { type: 'gift', user: '提督阁下', giftName: '告白气球', count: 1, giftUnit: 52000, giftCoin: 'gold', guard: 2 },
  { type: 'chat', user: '总督殿下', text: '全场的礼物我包了', guard: 1, admin: true, medalLevel: 32, medalName: '小萝卜', wealthLevel: 55, vip: 2 },
  { type: 'chat', user: '老板', text: '主播唱首歌吧！', superChat: true, price: 30 },
  { type: 'gift', user: '总督殿下', giftName: '舰长', guardName: '舰长', count: 1, guardPrice: 198000, guard: 1 }
];
function demoEvents() {
  const bubble = current?.bubbles?.[0];
  if (!bubble) return DEMO;
  return [...DEMO.slice(0, 3),
    { type: 'chat', user: '萝卜头', text: bubble.keyword, bubbleCommand: { text: `换上了「${bubble.name}」气泡` } },
    { type: 'chat', user: '萝卜头', text: '今天也要开心呀～一起聊天吧！', bubble: bubble.id, medalLevel: 5, medalName: '小萝卜' },
    ...DEMO.slice(3)];
}
let demoTimers = [];
// 演示消息和清空都走服务器：控制台预览、打开的画面窗口、OBS 里的地址三个画面一起显示、一起清空。
$('#danmaku-demo').addEventListener('click', () => {
  if (current?.enabled === false) { toast('弹幕姬总开关还关着，打开后再试', true); return; }
  demoTimers.forEach(clearTimeout);
  demoTimers = demoEvents().map((event, index) => setTimeout(() => api('/api/danmaku/demo', { events: [event] }).catch(error => toast(error.message, true)), index * 380));
});
$('#danmaku-clear').addEventListener('click', () => { demoTimers.forEach(clearTimeout); api('/api/danmaku/clear', {}).catch(error => toast(error.message, true)); });
