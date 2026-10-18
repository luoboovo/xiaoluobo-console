import { $, api, toast, giftById, escapeHtml, image } from './console-shared.js';
import { state, gifts, currentGift, switchView } from './app.js';
let shop, draft, draftSign, editing = false, selected = 'counter', selectedItem = '', saving = false;
const names = { background: '背景', counter: '桌台', customers: '顾客' };
const itemNames = { fridge: '冰柜', trash: '垃圾桶', cash: '钱匣', noodles: '煮面锅', sauce: '臊子桶', bowl: '碗架', tray: '放碗托盘', dough: '削面板', scallions: '葱花', cilantro: '香菜', rating: '店铺评分 / 五星牌', jasmine:'茉莉花',milk:'牛奶壶' };
Object.assign(itemNames,{chef:'机械臂 / 手',stats:'排队 / 出餐显示牌',gift_rule:'排队礼物文字',thief_board:'偷钱榜单',sign_top:'招牌上方小字',sign_title:'招牌标题文字',sign_bottom:'招牌下方小字',cash_text:'钱匣金额文字',ketchup:'番茄酱',salad:'沙拉酱',mayo:'蛋黄酱'});
const frame = $('#noodle-frame');
let presetStamp = '', renamingPreset = null, creatingTemplate = null, deletingTemplate = null, deletingPreset = null;
const post = () => frame.contentWindow.postMessage({ type: 'noodle-builder', enabled: editing, selected, item: selectedItem, layout: draft || shop?.config.layout, sign: draftSign || shop?.config.sign }, location.origin);
function giftButton(button, rule) {
  const stamp=JSON.stringify([rule?.gift_id,rule?.gift_name]);
  if(button.dataset.binding===stamp)return;
  button.dataset.binding=stamp;
  button.replaceChildren();
  const gift = rule?.gift_id ? giftById.get(rule.gift_id) : null;
  if (gift?.icon) { const img = document.createElement('img'); img.src = image(gift); img.alt = ''; button.append(img); }
  const name = document.createElement('span'); name.className = 'gift-binding-name'; name.textContent = rule?.gift_name || '选择礼物';
  button.append(name); button.title = name.textContent;
}
function render(next) {
  const changedPreset = shop?.active_preset !== next.active_preset;
  const changedDuration = changedPreset || shop?.config.raid_seconds !== next.config.raid_seconds;
  shop = next;
  if (changedDuration) $('#raid-seconds').value = shop.config.raid_seconds ?? 30;
  if (changedPreset || $('#thief-min').dataset.saved !== String(shop.config.thief_min)) { $('#thief-min').value=shop.config.thief_min; $('#thief-min').dataset.saved=String(shop.config.thief_min); }
  if (changedPreset || $('#thief-max').dataset.saved !== String(shop.config.thief_max)) { $('#thief-max').value=shop.config.thief_max; $('#thief-max').dataset.saved=String(shop.config.thief_max); }
  const cafe=shop.template?.workflow==='jasmine-latte';
  const stir=shop.template?.workflow==='stir-fry';
  const burger=shop.template?.workflow==='burger';
  $('#cook-duration-form').hidden = shop.template?.workflow !== 'knife-noodles' && !cafe && !stir && !burger;
  $('#cook-duration-form label').textContent=burger?'烘烤 / 煎制时长':stir?'翻炒火候':cafe?'萃取时长':'煮面时长';
  $('#cook-duration-form small').textContent=burger?'默认 4 秒，保存后下次制作生效':stir?'默认 4 秒，自动翻炒':cafe?'默认 2 秒':'默认 2 秒，保存后下次下锅生效';
  $('#cook-duration-form small').hidden=cafe;
  $('#cafe-recipe').hidden=true;
  $('#water-gift-pick').closest('.gift-setting').hidden=cafe;
  $('#water-gift-pick').closest('.gift-setting').querySelector('.gift-setting-label').lastChild.textContent=stir?'饮料':'圣水';
  $('.noodle-preview-header>span').lastChild.textContent=burger?'汉堡店现场':stir?'香锅店现场':cafe?'咖啡厅现场':'面馆现场';
  $('[data-view="noodle"]').lastChild.textContent=burger?'弹幕汉堡店':stir?'麻辣香锅':cafe?'弹幕咖啡厅':'弹幕面馆';
  frame.title=burger?'美式汉堡店交互预览':stir?'麻辣香锅交互预览':cafe?'茉莉咖啡厅交互预览':'弹幕面馆交互预览';
  $('[data-module-card="background"] .module-select small').textContent=stir?'香锅店招牌与墙面':cafe?'咖啡厅招牌与墙面':'面馆招牌与墙面';
  $('[data-module-card="counter"] .module-select small').textContent=stir?'分格菜柜、铁锅与配料':cafe?'咖啡机、茉莉花与牛奶':'料理台与取料桶';
  Object.assign(itemNames,{noodles:stir?'大铁锅':cafe?'咖啡机':'煮面锅',bowl:stir?'碗架':cafe?'杯架':'碗架',tray:stir?'放碗托盘':cafe?'放杯托盘':'放碗托盘',dough:stir?'食材柜':'削面板',sauce:stir?'芝麻':'臊子桶',cash:'钱匣'});
  Object.assign(itemNames,{scallions:'葱花',cilantro:'香菜',jasmine:'茉莉花',milk:'牛奶壶',bun_lid:'面包上盖'});
  if(burger){Object.assign(itemNames,{noodles:'煎肉饼台',sauce:'烤箱',bowl:'生面包胚',tray:'汉堡组装托盘',dough:'生肉饼',scallions:'番茄',cilantro:'生菜',jasmine:'芝士',milk:'黄芥末酱'});$('[data-module-card="background"] .module-select small').textContent='美式汉堡店招牌与墙面';$('[data-module-card="counter"] .module-select small').textContent='煎台、烤箱、面包与配料';}
  if (changedPreset || $('#cook-seconds').dataset.saved !== String(shop.config.cook_seconds)) {
    $('#cook-seconds').value = shop.config.cook_seconds ?? 2; $('#cook-seconds').dataset.saved = String(shop.config.cook_seconds);
  }
  drawSealCountdown();
  const knife = shop.template?.workflow === 'knife-noodles';
  $('#noodle-dish-name').textContent = shop.template?.dish_name || '臊子面';
  const dishIcon=shop.template?.assets.bowl || '/noodle/assets/bowl-sauce.png';
  if($('#noodle-dish-icon').getAttribute('src')!==dishIcon)$('#noodle-dish-icon').src=dishIcon;
  $('#use-noodle-gift').textContent = `用于${shop.template?.dish_name || '臊子面'}点单`;
  for (const option of $('#builder-item').options) {
    if (['dough','scallions','cilantro'].includes(option.value)) option.hidden = !knife&&!stir&&!burger;
    if (option.value === 'sauce') option.hidden = knife||cafe;
    if (['jasmine','milk'].includes(option.value)) option.hidden=!cafe&&!burger;
    if (['ketchup','salad','mayo'].includes(option.value)) option.hidden=!burger;
    if (option.value==='bun_lid') option.hidden=!burger;
    if (option.value==='fridge') option.hidden=cafe;
    if (option.value==='rating') option.hidden=false;
    if (itemNames[option.value]) option.textContent=itemNames[option.value];
  }
  if ($('#builder-item').querySelector(`option[value="${selectedItem}"]`)?.hidden) selectedItem = '';
  renderPresets();
  if (!editing) { draft = NoodleLayout.validate(shop.config.layout); draftSign = NoodleSign.validate(shop.config.sign); }
  $('#noodle-mode').textContent = shop.sealed ? '已查封' : { closed: '待开张', running: '营业中', paused: '休息中' }[shop.mode];
  $('#noodle-mode').classList.toggle('running', shop.mode === 'running' && !shop.sealed);
  $('#noodle-start').textContent = shop.mode === 'running' ? '暂停游戏' : shop.mode === 'paused' ? '继续游戏' : '开始游戏';
  $('#noodle-demo').disabled = shop.mode === 'closed' || editing;
  $('#noodle-start').disabled = editing;
  $('#noodle-queue').textContent = shop.queue_count;
  $('#noodle-served').textContent = shop.served;
  $('#noodle-balance').textContent = shop.balance || 0;
  $('#noodle-rating').textContent='★'.repeat(shop.stars ?? 5)+'☆'.repeat(5-(shop.stars ?? 5))+' '+(shop.points ?? 500);
  for(const kind of ['raid','restock','review','praise','thief','help','clearqueue']) {
    const rule=shop.config[kind+'_gift'];
    giftButton($(`[data-shop-pick="${kind}"]`),rule);
    $(`[data-shop-clear="${kind}"]`).hidden=!rule;
    $(`[data-shop-test="${kind}"]`).disabled=editing || saving;
  }
  const water = shop.config.water_gift; giftButton($('#water-gift-pick'), water); $('#water-gift-clear').hidden = !water;
  $('#water-demo').disabled = shop.mode === 'closed' || editing;
  $('#noodle-order-demo').disabled = shop.mode === 'closed' || editing;
  const tip = shop.config.tip_gift; giftButton($('#tip-gift-pick'), tip); $('#tip-gift-clear').hidden = !tip;
  $('#tip-demo').disabled = shop.mode === 'closed' || editing;
  const giftId = shop.config.gift_id || gifts.find(g => g.name === shop.config.gift_name)?.id;
  giftButton($('#noodle-gift'), { gift_id: giftId, gift_name: shop.config.gift_name });
  $('#cockroach-gift-setting').hidden=!burger;
  $('[data-bind-throw="cockroach"]').hidden=!burger;
  for (const kind of ['leaf', 'egg', 'cockroach']) {
    const rule = shop.config.throw_gifts?.[kind];
    giftButton($(`[data-throw-pick="${kind}"]`), rule);
    $(`[data-throw-clear="${kind}"]`).hidden = !rule;
    const label=$(`[data-throw-pick="${kind}"]`).closest('.gift-setting').querySelector('.gift-setting-label');
    label.lastChild.textContent=kind==='cockroach'?'蟑螂':cafe?(kind==='leaf'?'臭生菜':'臭鸡蛋'):(kind==='leaf'?'菜叶':'鸡蛋');
    const image=label.querySelector('img'),src=shop.template?.assets[kind] || '/noodle/assets/'+(kind==='cockroach'?'cockroach':'throw-'+kind)+'.png';if(image.getAttribute('src')!==src)image.src=src;
  }
  fields();
}
function fields() {
  const empty=!shop?.presets?.length;
  frame.hidden=empty;$('#noodle-empty').hidden=!empty;$('.noodle-builder').hidden=empty;
  $('.noodle-workspace').classList.toggle('no-shop',empty);
  $('#noodle-start').disabled=empty || saving || editing;
  $('#builder-fields').hidden = !editing;
  $('#noodle-build').textContent = editing ? '搭建中' : '搭建场景 ↗';
  $('#noodle-build').disabled = empty || editing;
  $('#noodle-restore').disabled = empty || saving;
  $('#noodle-save').disabled = saving;
  $('#preset-new').disabled = empty || saving || editing;
  $('#template-import').disabled = saving || editing;
  $('#raid-duration-save').disabled = empty || saving || editing;
  $('#raid-seconds').disabled = empty || saving || editing;
  $('#cook-seconds').disabled = empty || saving || editing;
  $('#cook-duration-save').disabled = empty || saving || editing;
  for (const id of ['thief-min','thief-max','thief-range-save']) $('#'+id).disabled=empty || saving || editing;
  document.querySelectorAll('[data-shop-test]').forEach(button => { button.disabled=empty || saving || editing; });
  $('#preset-editing-note').hidden = !editing;
  document.querySelectorAll('[data-preset-use],[data-preset-rename],[data-preset-delete],[data-template-create],[data-template-delete]').forEach(button => { button.disabled = saving || editing; });
  document.querySelectorAll('[data-module-card]').forEach(el => el.classList.toggle('selected', el.dataset.moduleCard === selected));
  if (!draft) return;
  const item = selectedItem ? NoodleLayout.itemConfig(draft, selectedItem) : draft.modules[selected];
  $('#builder-selected-name').textContent = selectedItem ? itemNames[selectedItem] : names[selected];
  $('#builder-item').value = selectedItem;
  $('#module-visible-label').hidden = !!selectedItem;
  $('#module-visible').checked = draft.modules[selected].visible;
  for (const key of ['x', 'y', 'scale']) {
    const limits = key === 'x' ? [-600,600,-1280,1280] : key === 'y' ? [-360,360,-720,720] : [50,150,25,200];
    $(`#module-${key}`).min = limits[selectedItem ? 2 : 0]; $(`#module-${key}`).max = limits[selectedItem ? 3 : 1];
    $(`#module-${key}`).value = key === 'scale' ? Math.round(item.scale * 100) : item[key];
    $(`#module-${key}-value`).textContent = key === 'scale' ? Math.round(item.scale * 100) + '%' : item[key];
  }
  $('#sign-fields').hidden = selected !== 'background' || !!selectedItem && !selectedItem.startsWith('sign_');
  for (const key of ['top', 'title', 'bottom']) $(`#sign-${key}`).value = draftSign[key];
}
function setEditing(value) {
  editing = value; draft = NoodleLayout.validate(shop.config.layout); draftSign = NoodleSign.validate(shop.config.sign); render(shop); post();
}
async function action(action, payload = {}) {
  const result = await api('/api/noodle/action', { action, ...payload, ...(action === 'save' && shop.active_preset ? { preset_id: shop.active_preset } : {}) }); render(result.state); return result.state;
}
function drawSealCountdown() {
  const countdown = $('#raid-countdown');
  countdown.hidden = !shop?.sealed;
  if (shop?.sealed) countdown.textContent = `查封剩余 ${Math.max(0, Math.ceil((shop.sealed_until - Date.now()) / 1000))} 秒`;
}
setInterval(drawSealCountdown, 1000);
$('#thief-range-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!shop || saving || editing) return;
  saving=true; fields();
  try { await action('save',{config:{...shop.config,thief_min:Number($('#thief-min').value),thief_max:Number($('#thief-max').value)}}); toast('偷钱金额范围已保存'); }
  catch(error) { toast(error.message,true); }
  finally { saving=false; fields(); }
});
$('#raid-duration-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!shop || saving || editing) return;
  const seconds = Number($('#raid-seconds').value);
  saving = true; fields();
  try { await action('save', { config: { ...shop.config, raid_seconds: seconds } }); toast('查封时长已保存，下次查封生效'); }
  catch (error) { toast(error.message, true); }
  finally { saving = false; fields(); }
});
$('#cook-duration-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!shop || saving || editing) return;
  const seconds = Number($('#cook-seconds').value);
  saving = true; fields();
  try { await action('save', { config: { ...shop.config, cook_seconds: seconds } }); toast(shop.template.workflow==='burger'?'烘烤与煎制时长已保存，下次制作生效':shop.template.workflow==='stir-fry'?'翻炒火候已保存':shop.template.workflow==='jasmine-latte'?'萃取时长已保存，下次制作生效':'煮面时长已保存，下次下锅生效'); }
  catch (error) { toast(error.message, true); }
  finally { saving = false; fields(); }
});
function renderPresets() {
  const presets = shop.presets || [], active = presets.find(p=>p.id === shop.active_preset);
  $('#noodle-preset-name').textContent = active?.name || '未创建店铺';
  const templates = shop.templates || [];
  const stamp = JSON.stringify([shop.active_preset, presets, templates]);
  if (stamp === presetStamp) return;
  presetStamp = stamp;
  $('#preset-list').innerHTML = presets.length?presets.map(p=>`<article class="preset-card${p.id === shop.active_preset ? ' current' : ''}"><div class="preset-card-top"><img src="${escapeHtml(templates.find(t=>t.id===p.template_id)?.image || '/noodle/assets/bowl.png')}" alt="">${p.id === shop.active_preset ? '<span class="preset-current">当前</span>' : ''}</div><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(templates.find(t=>t.id===p.template_id)?.dish_name || '臊子面')} · 独立礼物与布局</p><div class="preset-card-actions"><button class="button ${p.id === shop.active_preset ? 'dark-button' : 'white-button'}" data-preset-use="${escapeHtml(p.id)}">${templates.find(t=>t.id===p.template_id)?.workflow==='burger'?(p.id===shop.active_preset?'进入汉堡店':'使用汉堡店'):templates.find(t=>t.id===p.template_id)?.workflow==='stir-fry'?(p.id===shop.active_preset?'进入香锅店':'使用香锅店'):templates.find(t=>t.id===p.template_id)?.workflow==='jasmine-latte'?(p.id===shop.active_preset?'进入咖啡厅':'使用咖啡厅'):(p.id===shop.active_preset?'进入面馆':'使用面馆')}</button><button class="text-button" data-preset-rename="${escapeHtml(p.id)}">重命名</button><button class="text-button template-delete" data-preset-delete="${escapeHtml(p.id)}">删除店铺</button></div></article>`).join(''):'<div class="preset-empty">还没有店铺。从下面的「我的模板」创建一家，或导入一个新模板。</div>';
  $('#template-list').innerHTML = templates.map(t=>`<article class="preset-card template-card"><div class="preset-card-top"><img src="${escapeHtml(t.image)}" alt=""><span class="template-version">v${escapeHtml(t.version)}</span></div><h2>${escapeHtml(t.name)}</h2><p>${t.workflow==='burger'?'烤面包 → 煎肉饼 → 加料盖好 → 出餐':t.workflow==='stir-fry'?'十二格选菜 → 下锅翻炒 → 出锅加料':t.workflow==='jasmine-latte'?'咖啡 ＋ 茉莉花 ＋ 牛奶，顺序自由':t.workflow==='knife-noodles'?'点面团 → 下锅 → 装碗':'面条 ＋ 臊子，现拌现做'}</p><div class="preset-card-actions"><button class="button white-button" data-template-create="${escapeHtml(t.id)}">${t.workflow==='burger'?'创建汉堡店':t.workflow==='stir-fry'?'创建香锅店':t.workflow==='jasmine-latte'?'创建咖啡厅':'创建面馆'} ＋</button><a class="text-button" href="/api/templates/${escapeHtml(t.id)}/export" download>导出模板 ↗</a>${t.id==='saozi'?'<span class="template-base">基础模板</span>':`<button class="text-button template-delete" data-template-delete="${escapeHtml(t.id)}">删除模板</button>`}</div></article>`).join('');
}
function presetDialog(id = null, templateId = null) {
  renamingPreset = id; creatingTemplate = templateId;
  const preset = shop.presets.find(p=>p.id === id);
  $('#preset-dialog-title').textContent = id ? '重命名店铺' : '新增店铺';
  $('#preset-name').value = preset?.name || '';
  $('#preset-dialog-note').textContent = id ? '修改店铺名称。' : templateId ? `使用「${shop.templates.find(t=>t.id===templateId).name}」创建店铺。` : '复制当前店铺的配置，招牌改为新名称。';
  $('#preset-submit').textContent = id ? '保存名称' : '创建店铺';
  $('#preset-dialog').showModal(); $('#preset-name').focus();
}
$('#preset-new').addEventListener('click', () => { if (shop?.presets && !saving && !editing) presetDialog(); });
$('#preset-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-preset-delete]');if(!button || saving || editing)return;
  deletingPreset=button.dataset.presetDelete;
  const preset=shop.presets.find(p=>p.id===deletingPreset);
  $('#shop-delete-title').textContent=`删除「${preset.name}」？`;
  $('#shop-delete-note').textContent=`只删除这家店铺，${shop.templates.find(t=>t.id===preset.template_id)?.name || '对应模板'}仍保留在「我的模板」中，可以重新创建店铺。`;
  $('#shop-delete-dialog').showModal();$('#shop-delete-cancel').focus();
});
$('#shop-delete-form').addEventListener('submit',async event=>{
  event.preventDefault();if(saving || editing || !deletingPreset)return;
  saving=true;fields();$('#shop-delete-submit').disabled=true;
  try { await action('preset_delete',{id:deletingPreset});$('#shop-delete-dialog').close();setEditing(false);toast('店铺已删除，模板已保留'); }
  catch(error) { toast(error.message,true); }
  finally { saving=false;fields();$('#shop-delete-submit').disabled=false; }
});
$('#template-list').addEventListener('click', event => {
  const remove=event.target.closest('[data-template-delete]');
  if(remove && !saving && !editing) {
    deletingTemplate=remove.dataset.templateDelete;
    const template=shop.templates.find(t=>t.id===deletingTemplate),presets=shop.presets.filter(p=>p.template_id===deletingTemplate);
    $('#template-delete-title').textContent=`删除「${template.name}」？`;
    $('#template-delete-note').textContent=presets.length?`同时删除使用此模板的 ${presets.length} 家店铺：${presets.map(p=>p.name).join('、')}。当前店铺被删除时会切换到其他店铺；全部删除后可从模板重新创建。`:'从我的模板中移除此模板。';
    $('#template-delete-dialog').showModal();$('#template-delete-cancel').focus();return;
  }
  const button = event.target.closest('[data-template-create]');
  if (button && !saving && !editing) presetDialog(null, button.dataset.templateCreate);
});
$('#template-delete-form').addEventListener('submit',async event=>{
  event.preventDefault();if(saving || editing || !deletingTemplate)return;
  saving=true;fields();$('#template-delete-submit').disabled=true;
  try { const result=await api('/api/templates/delete',{id:deletingTemplate});render(result.state);$('#template-delete-dialog').close();setEditing(false);toast('模板已删除，需要时可重新导入安装'); }
  catch(error) { toast(error.message,true); }
  finally { saving=false;fields();$('#template-delete-submit').disabled=false; }
});
async function importTemplate(file) {
  if (saving || editing) { toast('请先保存或取消场景搭建', true); return; }
  if (!file || !/\.(luobo|json)$/i.test(file.name) || file.size > 64*1024*1024) { toast('请选择 64 MB 以内的店铺模板文件', true); return; }
  saving = true; fields(); $('#template-drop').classList.add('importing');
  $('#template-drop b').textContent = '正在安装模板…';
  try {
    const data = JSON.parse(await file.text());
    const result = await api('/api/templates/import', data);
    render(result.state); setEditing(false); switchView('presets'); toast('模板已安装，新店铺已创建');
  } catch (error) { toast(error.message, true); }
  finally { saving = false; fields(); $('#template-drop').classList.remove('importing'); $('#template-drop b').textContent = '把模板文件拖到这里'; }
}
$('#template-import').addEventListener('click', () => $('#template-file').click());
$('#template-file').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; importTemplate(file); });
document.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault(); switchView('presets'); $('#template-drop').classList.add('drag-over');
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('#template-drop').classList.remove('drag-over'); });
document.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault(); $('#template-drop').classList.remove('drag-over');
  if (event.dataTransfer.files.length !== 1) { toast('每次导入一个模板', true); return; }
  importTemplate(event.dataTransfer.files[0]);
});
$('#preset-form').addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  saving = true; fields(); $('#preset-submit').disabled = true;
  try {
    await action(renamingPreset ? 'preset_rename' : 'preset_create', { name: $('#preset-name').value, ...(renamingPreset ? { id: renamingPreset } : creatingTemplate ? { template_id: creatingTemplate } : {}) });
    $('#preset-dialog').close(); setEditing(false); toast(renamingPreset ? '店铺已重命名' : '店铺已创建');
  } catch (error) { toast(error.message, true); }
  finally { saving = false; fields(); $('#preset-submit').disabled = false; }
});
async function saveRule(gift) {
  if (!shop) return;
  const config = { ...shop.config, ...(gift ? { gift_id: gift.id, gift_name: gift.name } : {}), people_per_gift: 1 };
  await action('save', { config });
}
$('#noodle-start').addEventListener('click', async () => { try { await action(shop.mode === 'running' ? 'pause' : 'start'); } catch (error) { toast(error.message, true); } });
$('#noodle-demo').addEventListener('click', async () => { try { await action('demo'); } catch (error) { toast(error.message, true); } });
$('#noodle-order-demo').addEventListener('click', async () => { try { await action('demo_noodles'); } catch (error) { toast(error.message, true); } });
$('#noodle-gift').addEventListener('click', () => { switchView('gifts'); toast(`选择礼物，点击「用于${shop.template?.dish_name || '臊子面'}点单」`); });
$('#use-noodle-gift').addEventListener('click', async () => {
  try { await saveRule(currentGift); $('#gift-dialog').close(); switchView('noodle'); toast('排队礼物已更新'); } catch (error) { toast(error.message, true); }
});
async function saveWater(gift) { await action('save', { config: { ...shop.config, water_gift: gift ? { gift_id: gift.id, gift_name: gift.name } : null } }); }
$('#water-gift-pick').addEventListener('click', () => { switchView('gifts'); toast('选择礼物，点击「用于圣水点单」'); });
$('#use-water-gift').addEventListener('click', async event => {
  event.target.disabled = true;
  try { await saveWater(currentGift); $('#gift-dialog').close(); switchView('noodle'); toast('圣水礼物已更新'); } catch (error) { toast(error.message, true); }
  finally { event.target.disabled = false; }
});
$('#water-gift-clear').addEventListener('click', async () => { try { await saveWater(null); } catch (error) { toast(error.message, true); } });
$('#water-demo').addEventListener('click', async () => { try { await action('demo_water'); } catch (error) { toast(error.message, true); } });
async function saveTip(gift) { await action('save', { config: { ...shop.config, tip_gift: gift ? { gift_id: gift.id, gift_name: gift.name } : null } }); }
$('#tip-gift-pick').addEventListener('click', () => { switchView('gifts'); toast('选择礼物，点击「用于打赏金钱」'); });
$('#use-tip-gift').addEventListener('click', async event => {
  event.target.disabled = true;
  try { await saveTip(currentGift); $('#gift-dialog').close(); switchView('noodle'); toast('打赏礼物已更新'); } catch (error) { toast(error.message, true); }
  finally { event.target.disabled = false; }
});
$('#tip-gift-clear').addEventListener('click', async () => { try { await saveTip(null); } catch (error) { toast(error.message, true); } });
$('#tip-demo').addEventListener('click', async () => { try { await action('demo_tip'); } catch (error) { toast(error.message, true); } });
async function saveThrow(kind, gift) {
  const throw_gifts = { leaf: null, egg: null, ...shop.config.throw_gifts, [kind]: gift ? { gift_id: gift.id, gift_name: gift.name } : null };
  await action('save', { config: { ...shop.config, throw_gifts } });
}
const shopLabels={raid:'查封',restock:'补货',review:'差评',praise:'好评',thief:'偷钱',help:'帮忙',clearqueue:'清空排队'};
document.querySelectorAll('[data-shop-pick]').forEach(button=>button.addEventListener('click',()=>{switchView('gifts');toast(`选择礼物，点击「用于${shopLabels[button.dataset.shopPick]}」`);}));
document.querySelectorAll('[data-bind-shop]').forEach(button=>button.addEventListener('click',async()=>{
  button.disabled=true;
  try {await action('save',{config:{...shop.config,[button.dataset.bindShop+'_gift']:{gift_id:currentGift.id,gift_name:currentGift.name}}});$('#gift-dialog').close();switchView('noodle');toast('店铺礼物已更新');}
  catch(error){toast(error.message,true);}finally{button.disabled=false;}
}));
document.querySelectorAll('[data-shop-clear]').forEach(button=>button.addEventListener('click',async()=>{try{await action('save',{config:{...shop.config,[button.dataset.shopClear+'_gift']:null}});}catch(error){toast(error.message,true);}}));
document.querySelectorAll('[data-shop-test]').forEach(button=>button.addEventListener('click',async()=>{
  button.disabled=true;try{await action('demo_'+button.dataset.shopTest);}catch(error){toast(error.message,true);}finally{button.disabled=editing || saving;}
}));
document.querySelectorAll('[data-bind-throw]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  try { await saveThrow(button.dataset.bindThrow, currentGift); $('#gift-dialog').close(); switchView('noodle'); toast('投掷礼物已更新'); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}));
document.querySelectorAll('[data-throw-pick]').forEach(button => button.addEventListener('click', () => { switchView('gifts'); toast(`选择礼物，点击「用于丢${{leaf:'菜叶',egg:'鸡蛋',cockroach:'蟑螂'}[button.dataset.throwPick]}」`); }));
document.querySelectorAll('[data-throw-test]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  try { await action('test_throw', { kind: button.dataset.throwTest }); } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}));
document.querySelectorAll('[data-throw-clear]').forEach(button => button.addEventListener('click', async () => {
  try { await saveThrow(button.dataset.throwClear, null); } catch (error) { toast(error.message, true); }
}));
$('#noodle-build').addEventListener('click', () => { if (shop) setEditing(true); });
$('#noodle-cancel').addEventListener('click', () => setEditing(false));
$('#noodle-reset').addEventListener('click', () => { draft = structuredClone(shop?.template?.layout ?? NoodleLayout.defaults); fields(); post(); });
$('#noodle-restore').addEventListener('click', async () => {
  if (!shop || saving) return;
  saving = true; fields();
  try { await action('restore'); post(); toast('本局已复原'); }
  catch (error) { toast(error.message, true); }
  finally { saving = false; fields(); }
});
$('#noodle-save').addEventListener('click', async () => {
  if (saving) return;
  saving = true; fields();
  try { await action('save', { config: { ...shop.config, layout: draft, sign: draftSign } }); setEditing(false); toast('场景已保存'); }
  catch (error) { toast(error.message, true); }
  finally { saving = false; fields(); }
});
for (const key of ['x', 'y', 'scale']) $(`#module-${key}`).addEventListener('input', event => {
  const item = selectedItem ? NoodleLayout.itemConfig(draft, selectedItem) : draft.modules[selected];
  item[key] = Number(event.target.value) / (key === 'scale' ? 100 : 1); fields(); post();
});
$('#builder-item').addEventListener('change', event => { selectedItem = event.target.value; if (selectedItem) selected = NoodleLayout.itemModule(selectedItem); fields(); post(); });
$('#module-visible').addEventListener('change', event => { draft.modules[selected].visible = event.target.checked; post(); });
for (const key of ['top', 'title', 'bottom']) $(`#sign-${key}`).addEventListener('input', event => { draftSign[key] = event.target.value; post(); });
document.addEventListener('click', async event => {
  const presetUse = event.target.closest('[data-preset-use]'), presetRename = event.target.closest('[data-preset-rename]');
  if (presetRename && !saving && !editing) presetDialog(presetRename.dataset.presetRename);
  if (presetUse && !saving && !editing) {
    saving = true; fields();
    try { await action('preset_use', { id: presetUse.dataset.presetUse }); setEditing(false); switchView('noodle'); window.scrollTo(0, 0); }
    catch (error) { toast(error.message, true); }
    finally { saving = false; fields(); }
  }
  const moduleButton = event.target.closest('[data-select-module]');
  if (moduleButton) { selected = moduleButton.dataset.selectModule; selectedItem = ''; fields(); if (editing) post(); }
  const copy = event.target.closest('[data-copy-layer]');
  if (copy) {
    const url = `${location.origin}/noodle/?layer=${copy.dataset.copyLayer}`;
    try { await navigator.clipboard.writeText(url); toast(`${names[copy.dataset.copyLayer]}地址已复制 · 网页素材 1920 × 1080`); }
    catch { $('#obs-url-value').value = url; $('#obs-url-dialog').showModal(); $('#obs-url-value').select(); }
  }
  const button = event.target.closest('[data-noodle-action]');
  if (button) { try { await action(button.dataset.noodleAction); button.closest('details').open = false; } catch (error) { toast(error.message, true); } }
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data.type === 'noodle-ready' && shop) post();
  if (event.data.type === 'noodle-error' && typeof event.data.message === 'string') toast(event.data.message, true);
  if (event.data.type === 'noodle-layout' && editing) { try {
    draft = NoodleLayout.validate(event.data.layout);
    if (event.data.selected && names[event.data.selected]) selected = event.data.selected;
    if (event.data.item !== undefined && (!event.data.item || itemNames[event.data.item])) selectedItem = event.data.item;
    fields();
  } catch {} }
});
window.addEventListener('noodle-state', event => render(event.detail));
window.addEventListener('gifts-loaded', () => { document.querySelectorAll('.gift-binding').forEach(button=>delete button.dataset.binding); if (shop) render(shop); });
function liveStatus(current) {
  $('#noodle-live').textContent = current?.live.status === 'connected' ? `${current.config.platform==='douyin'?'抖音':'B站'}已接入 · ${current.live.roomId}` : '等待直播间连接';
  $('#noodle-live').classList.toggle('connected', current?.live.status === 'connected');
}
window.addEventListener('console-state', event => liveStatus(event.detail)); liveStatus(state);
let platform = 'obs', importing = false;
const sceneError = error => ['页面不存在', '接口不存在'].includes(error.message) ? '新版接入功能需在本场结束后重启控制台（台面和排队会清空）' : error.message;
function selectPlatform(value) {
  platform = value;
  const camera = value === 'douyin', native = value === 'bili';
  document.querySelectorAll('[data-scene-platform]').forEach(button => { button.classList.toggle('active', button.dataset.scenePlatform === value); button.setAttribute('aria-pressed', String(button.dataset.scenePlatform === value)); });
  $('#scene-method').textContent = native ? '直接导入直播姬空白横屏场景，不需要 OBS。' : camera ? '通过 OBS 接入，首次在直播软件中选择 OBS Virtual Camera。' : '自动创建背景、桌台、顾客，复用已有的 VTS 人物源。';
  $('#scene-import').textContent = native ? '一键导入直播姬' : camera ? '准备 OBS 场景' : '一键导入 OBS';
  $('#scene-hime-setup').hidden = !native;
  $('.scene-setup').hidden = $('.scene-manual').hidden = native;
  $('#scene-camera').hidden = !camera;
  $('#scene-camera-setup').hidden = $('#scene-platform-setup').hidden = $('#scene-audio-note').hidden = !camera;
  $('#scene-platform-setup').textContent = value === 'douyin' ? '直播伴侣「添加素材 → 摄像头」：选择 OBS Virtual Camera，设为 1920 × 1080。' : '直播姬「添加素材 → 摄像头」：选择 OBS Virtual Camera，设为 1920 × 1080。';
  if (camera) $('.scene-setup').open = true;
}
async function detectScenePlatform() {
  const checking = platform;
  $('#scene-status').textContent = checking === 'bili' ? '正在检测直播姬…' : '正在检测 OBS…'; $('#scene-status').className = 'scene-status'; $('#scene-result').hidden = true;
  try {
    const result = await api(checking === 'bili' ? '/api/hime/status' : '/api/obs/status');
    if (platform !== checking) return;
    $('#scene-status').textContent = result.message; $('#scene-status').classList.toggle('ready', result.available && !result.running);
    if (checking === 'bili') {
      $('#scene-hime-account').replaceChildren(...result.profiles.map(profile => { const option = document.createElement('option'); option.value = profile.id; option.textContent = '账号 ' + profile.id; return option; }));
      $('#scene-hime-account-label').hidden = result.profiles.length < 2;
    } else if (!result.available) $('.scene-setup').open = true;
  } catch (error) { if (platform === checking) { $('#scene-status').textContent = sceneError(error); $('#scene-status').classList.add('error'); } }
}
$('#scene-connect').addEventListener('click', () => { $('#scene-dialog').showModal(); detectScenePlatform(); });
document.querySelectorAll('[data-scene-platform]').forEach(button => button.addEventListener('click', () => { if (!importing) { selectPlatform(button.dataset.scenePlatform); detectScenePlatform(); } }));
async function importScene(camera) {
  if (importing) return;
  importing = true; $('#scene-import').disabled = $('#scene-camera').disabled = true;
  $('#scene-result').hidden = true; $('#scene-status').textContent = camera ? '正在准备场景和虚拟摄像机…' : '正在导入场景…'; $('#scene-status').className = 'scene-status';
  const native = platform === 'bili';
  const input = native ? { profile: $('#scene-hime-account').value } : $('.scene-manual').open ? { manual: true, port: Number($('#scene-port').value), password: $('#scene-password').value } : {};
  try {
    const result = await api(native ? '/api/hime/import' : camera ? '/api/obs/virtual-camera' : '/api/obs/import', input);
    $('#scene-status').textContent = native ? result.reused ? '直播姬场景已存在，可直接使用' : '已原生导入直播姬' : camera ? 'OBS 虚拟摄像机已启动' : result.reused ? 'OBS 场景已存在，可直接使用' : '场景已导入 OBS'; $('#scene-status').classList.add('ready');
    const sceneNumber = result.sceneName.match(/^Scene (\d+)$/)?.[1];
    $('#scene-result').textContent = native ? `打开直播姬，选择「${sceneNumber ? '场景 ' + sceneNumber : result.sceneName}」。${result.performer === false ? '将 VTS 人物素材放在背景与桌台之间。' : ''}` : camera ? `请确认 OBS 摄像机输出「${result.sceneName}」，再在直播软件中选择 OBS Virtual Camera。` : `在 OBS 场景列表选择「${result.sceneName}」。`;
    $('#scene-result').hidden = false;
  } catch (error) { $('#scene-status').textContent = sceneError(error); $('#scene-status').classList.add('error'); $('.scene-setup').open = true; }
  finally { importing = false; $('#scene-import').disabled = $('#scene-camera').disabled = false; }
}
$('#scene-import').addEventListener('click', () => importScene(false));
$('#scene-camera').addEventListener('click', () => importScene(true));
$('#scene-dialog').addEventListener('close', () => { $('#scene-password').value = ''; });
api('/api/noodle/state').then(next => { render(next); post(); }).catch(error => toast(error.message, true));
