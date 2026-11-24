// 加班机「合体模式」的设置：改了自动保存；预览画面上盖一层虚线框，直接拖动摆位置。
import { $, api, toast, escapeHtml } from './console-shared.js';
const { comboRules, ruleKey, ruleText } = Overtime;
const form = $('#overtime-combo'), editor = $('#combo-editor'), previewStage = $('#overtime-preview-stage'), orderList = $('#combo-order'), textList = $('#combo-texts-list');
let draft = null, rules = [], timer, revision = 0, pending = false, stamp = '', orderStamp = '', selected = '', drag = null, draggingKey = '';
const round = value => Math.round(value * 100) / 100, clamp = (value,min,max) => round(Math.max(min,Math.min(max,value)));
const get = path => path.split('.').reduce((value,key) => value[key],draft);
const set = (path,value) => { const keys = path.split('.'), last = keys.pop(); keys.reduce((target,key) => target[key],draft)[last] = value; };
function save(delay = 250) {
  const current = ++revision; pending = true; clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      const result = await api('/api/overtime/action',{action:'combo',combo:{...draft,texts:draft.texts.filter(item => item.text.trim())}});
      if (current !== revision) return;
      pending = false; stamp = ''; receive(result.state);
    } catch (error) { if (current === revision) { pending = false; stamp = ''; toast(error.message,true); refetch(); } }
  },delay);
}
const refetch = () => api('/api/overtime/state').then(receive).catch(error => toast(error.message,true));
function receive(state) {
  if (!state?.config?.combo) return;
  rules = state.config.gift_rules;
  if (!pending && !drag) {
    const next = JSON.stringify(state.config.combo);
    if (next !== stamp) {
      stamp = next;
      // 正在新填、还空着的常显文字先留着，不被保存结果冲掉。
      const blank = (draft?.texts || []).filter(item => !item.text.trim());
      draft = structuredClone(state.config.combo); draft.texts.push(...blank);
      fill();
    }
  }
  if (draft) drawOrder();
}
function fill() {
  for (const input of form.elements) {
    if (!input.name || input === document.activeElement && input.type !== 'checkbox' && input.type !== 'radio') continue;
    const value = get(input.name);
    if (input.type === 'checkbox') input.checked = value;
    else if (input.type === 'radio') input.checked = input.value === value;
    else input.value = Array.isArray(value) ? value.join(',') : value;
  }
  outputs(); drawTexts(); layout();
}
function outputs() {
  for (const input of form.querySelectorAll('.combo-range input')) input.nextElementSibling.textContent = input.name === 'panel.gap' ? `${input.value}px` : `${input.value}%`;
  form.elements['panel.opacity'].closest('label').classList.toggle('is-off',draft.panel.theme === 'bare');
}
function layout() {
  $('#combo-body').hidden = !draft.enabled;
  editor.hidden = !draft.enabled;
  previewStage.classList.toggle('is-combo',draft.enabled);
  previewStage.style.setProperty('--ratio',`${draft.width} / ${draft.height}`);
  previewStage.style.setProperty('--ratio-number',draft.width / draft.height);
  drawEditor();
}
// ---- 预览上的摆放框 ----
function boxes() {
  return [['clock','倒计时',draft.clock],['panel','礼物面板',draft.panel.box],...(draft.float.enabled ? [['float','飘字区域',draft.float.box]] : []),...draft.texts.map((item,index) => [`text:${index}`,`文字 ${index + 1}`,item])];
}
const boxOf = id => boxes().find(([key]) => key === id)?.[2];
function position(node, box) { for (const [key,property] of [['x','left'],['y','top'],['w','width'],['h','height']]) node.style[property] = `${box[key]}%`; }
function drawEditor() {
  if (!draft.enabled || drag) return;
  const focused = editor.contains(document.activeElement) ? document.activeElement.dataset.box : '';
  editor.replaceChildren(...boxes().map(([id,label,box]) => {
    const node = document.createElement('div'); node.className = 'combo-box' + (id === selected ? ' selected' : ''); node.dataset.box = id; node.tabIndex = 0; node.setAttribute('aria-label',`${label}：方向键移动，Shift 加方向键改大小`);
    node.innerHTML = `<em>${label}</em><i class="combo-box-resize" aria-hidden="true"></i>`; position(node,box); return node;
  }));
  if (focused) editor.querySelector(`[data-box="${focused}"]`)?.focus();
}
function mark(id) { selected = id; for (const node of editor.children) node.classList.toggle('selected',node.dataset.box === id); }
editor.addEventListener('pointerdown', event => {
  const node = event.target.closest('.combo-box'); if (!node || event.button !== 0) return;
  const box = boxOf(node.dataset.box), rect = editor.getBoundingClientRect();
  mark(node.dataset.box); node.focus({preventScroll:true});
  drag = { node, box, start:{...box}, x:event.clientX, y:event.clientY, width:rect.width, height:rect.height, resize:!!event.target.closest('.combo-box-resize'), moved:false };
  editor.setPointerCapture(event.pointerId); event.preventDefault();
});
editor.addEventListener('pointermove', event => {
  if (!drag) return;
  const dx = (event.clientX - drag.x) / drag.width * 100, dy = (event.clientY - drag.y) / drag.height * 100;
  if (!drag.moved && Math.hypot(event.clientX - drag.x,event.clientY - drag.y) < 2) return;
  drag.moved = true;
  if (drag.resize) { drag.box.w = clamp(drag.start.w + dx,5,150); drag.box.h = clamp(drag.start.h + dy,2,150); }
  else { drag.box.x = clamp(drag.start.x + dx,-50,97); drag.box.y = clamp(drag.start.y + dy,-50,97); }
  position(drag.node,drag.box);
});
const endDrag = () => { if (!drag) return; const moved = drag.moved; drag = null; if (moved) save(0); };
for (const type of ['pointerup','pointercancel','lostpointercapture']) editor.addEventListener(type,endDrag);
editor.addEventListener('focusin', event => { const node = event.target.closest('.combo-box'); if (node) mark(node.dataset.box); });
editor.addEventListener('keydown', event => {
  const box = boxOf(selected), step = { ArrowLeft:['x','w',-.5], ArrowRight:['x','w',.5], ArrowUp:['y','h',-.5], ArrowDown:['y','h',.5] }[event.key];
  if (!box || !step) return;
  event.preventDefault();
  if (event.shiftKey) box[step[1]] = clamp(box[step[1]] + step[2],step[1] === 'w' ? 5 : 2,150); else box[step[0]] = clamp(box[step[0]] + step[2],-50,97);
  drawEditor(); save();
});
// ---- 表单 ----
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', event => {
  const input = event.target; if (!draft || !input.name) return;
  let value = input.type === 'checkbox' ? input.checked : input.value;
  if (input.name === 'panel.lines') { value = input.value.split(/[^\d]+/).filter(Boolean).map(Number); }
  else if (['number','range'].includes(input.type)) value = Number(input.value);
  // 数字输到一半（空着、超出范围）先不保存。
  if (input.type === 'number' && (input.value === '' || !input.checkValidity())) return;
  if (input.name === 'panel.lines' && (value.length > 20 || value.some(count => count < 1 || count > 20))) return;
  set(input.name,value); outputs(); layout(); save(input.name === 'enabled' ? 0 : 250);
});
form.addEventListener('focusout', () => { if (draft && !pending) fill(); });
const PRESETS = {
  tall:{ width:540, height:960, clock:{x:0,y:0,w:100,h:17}, panel:{x:0,y:46,w:100,h:54}, float:{x:0,y:32,w:100,h:13}, per_line:2, text:[18,6] },
  wide:{ width:960, height:540, clock:{x:0,y:0,w:100,h:30}, panel:{x:0,y:52,w:100,h:48}, float:{x:0,y:31,w:100,h:20}, per_line:4, text:[30,9] },
  side:{ width:1280, height:420, clock:{x:0,y:0,w:48,h:58}, panel:{x:50,y:0,w:50,h:100}, float:{x:0,y:62,w:48,h:38}, per_line:3, text:[58,14] }
};
for (const button of form.querySelectorAll('[data-combo-preset]')) button.addEventListener('click', () => {
  const preset = PRESETS[button.dataset.comboPreset];
  Object.assign(draft,{width:preset.width,height:preset.height,clock:{...preset.clock}}); draft.panel.box = {...preset.panel}; draft.float.box = {...preset.float}; draft.panel.per_line = preset.per_line; draft.panel.lines = []; draft.panel.flow = 'row';
  draft.texts.forEach((item,index) => Object.assign(item,{x:preset === PRESETS.side ? 0 : 5,w:preset === PRESETS.side ? 48 : 90,y:preset.text[0] + index * 7,h:Math.min(preset.text[1],7)}));
  fill(); save(0);
});
$('#combo-float-demo').addEventListener('click', async () => { try { await api('/api/overtime/action',{action:'float_demo'}); } catch (error) { toast(error.message,true); } });
// ---- 礼物顺序 ----
function drawOrder() {
  const list = comboRules(draft,rules,true), next = JSON.stringify([list.map(rule => [ruleKey(rule),rule.gift_name,ruleText(rule)]),draft.panel.hidden,draft.panel.labels]);
  if (next === orderStamp || orderList.contains(document.activeElement) && document.activeElement.matches('input[type=text]')) return;
  orderStamp = next;
  orderList.innerHTML = list.map(rule => { const key = ruleKey(rule); return `<div class="combo-order-row" draggable="true" data-key="${escapeHtml(key)}"><span class="combo-grip" aria-hidden="true">⠿</span><input type="checkbox" ${draft.panel.hidden.includes(key) ? '' : 'checked'} aria-label="在面板显示${escapeHtml(rule.gift_name)}">${rule.gift_id ? `<img loading="lazy" src="/api/gifts/${rule.gift_id}/image" alt="">` : ''}<span class="combo-order-name" title="${escapeHtml(rule.gift_name)}">${escapeHtml(rule.gift_name)}</span><input type="text" maxlength="30" value="${escapeHtml(draft.panel.labels[key] || '')}" placeholder="${escapeHtml(ruleText(rule))}" aria-label="${escapeHtml(rule.gift_name)}的面板文字"><button type="button" class="icon-button" data-move="-1" aria-label="上移">↑</button><button type="button" class="icon-button" data-move="1" aria-label="下移">↓</button></div>`; }).join('') || '<p class="overtime-note">先在下面添加礼物规则并保存。</p>';
}
const keysNow = () => comboRules(draft,rules,true).map(ruleKey);
function reorder(keys) { draft.panel.order = keys; drawOrder(); save(0); }
orderList.addEventListener('click', event => {
  const button = event.target.closest('[data-move]'); if (!button) return;
  const keys = keysNow(), key = button.closest('[data-key]').dataset.key, from = keys.indexOf(key), to = from + Number(button.dataset.move);
  if (to < 0 || to >= keys.length) return;
  keys.splice(to,0,keys.splice(from,1)[0]); reorder(keys);
  orderList.children[to]?.querySelector(`[data-move="${button.dataset.move}"]`).focus();
});
orderList.addEventListener('input', event => {
  const key = event.target.closest('[data-key]').dataset.key;
  if (event.target.type === 'checkbox') draft.panel.hidden = event.target.checked ? draft.panel.hidden.filter(item => item !== key) : [...draft.panel.hidden,key];
  else { const text = event.target.value.trim(); if (text) draft.panel.labels[key] = text; else delete draft.panel.labels[key]; }
  save();
});
orderList.addEventListener('dragstart', event => { if (event.target.matches?.('input')) { event.preventDefault(); return; } const row = event.target.closest('[data-key]'); draggingKey = row?.dataset.key || ''; if (draggingKey) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain',draggingKey); row.classList.add('dragging'); } });
orderList.addEventListener('dragover', event => {
  if (!draggingKey) return; event.preventDefault();
  const over = event.target.closest('[data-key]'), row = orderList.querySelector('.dragging');
  if (over && row && over !== row) { const rect = over.getBoundingClientRect(); over.parentNode.insertBefore(row,event.clientY < rect.top + rect.height / 2 ? over : over.nextSibling); }
});
orderList.addEventListener('drop', event => event.preventDefault());
orderList.addEventListener('dragend', () => { if (!draggingKey) return; draggingKey = ''; orderList.querySelector('.dragging')?.classList.remove('dragging'); reorder([...orderList.querySelectorAll('[data-key]')].map(row => row.dataset.key)); });
// ---- 常显文字 ----
function drawTexts() {
  if (textList.contains(document.activeElement)) return;
  textList.innerHTML = draft.texts.map((item,index) => `<div class="combo-text-row" data-index="${index}"><textarea data-text="text" rows="2" maxlength="100" placeholder="例如：距离 100 💰🏃" aria-label="常显文字 ${index + 1}">${escapeHtml(item.text)}</textarea><button type="button" class="icon-button" data-remove-text aria-label="删除这条文字">×</button><div class="combo-text-style"><label>字号<input type="number" data-text="size" min="10" max="200" value="${item.size}"></label><label>颜色<input type="color" data-text="color" value="${item.color}"></label><label>描边<input type="color" data-text="stroke" value="${item.stroke}"></label><label>对齐<select data-text="align">${Object.entries(Overtime.COMBO_ALIGNS).map(([value,label]) => `<option value="${value}"${item.align === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="combo-check"><input type="checkbox" data-text="bold"${item.bold ? ' checked' : ''}>加粗</label></div></div>`).join('');
}
textList.addEventListener('input', event => {
  const input = event.target, key = input.dataset.text; if (!key) return;
  if (input.type === 'number' && (input.value === '' || !input.checkValidity())) return;
  draft.texts[Number(input.closest('[data-index]').dataset.index)][key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
  drawEditor(); save();
});
textList.addEventListener('click', event => {
  if (!event.target.closest('[data-remove-text]')) return;
  draft.texts.splice(Number(event.target.closest('[data-index]').dataset.index),1); document.activeElement?.blur(); selected = ''; drawTexts(); drawEditor(); save(0);
});
$('#combo-add-text').addEventListener('click', () => {
  if (draft.texts.length >= 10) { toast('常显文字最多 10 条',true); return; }
  draft.texts.push({ text:'', x:5, y:Math.min(90,18 + draft.texts.length * 7), w:90, h:7, size:34, color:'#ffffff', stroke:'#000000', bold:true, align:'center' });
  drawTexts(); drawEditor(); textList.lastElementChild.querySelector('textarea').focus();
});
window.addEventListener('overtime-rendered', event => receive(event.detail));
