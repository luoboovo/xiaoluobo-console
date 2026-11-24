(function (root) {
  const numbers = [['古戈尔',100],['大数',72],['无量',68],['不可思议',64],['那由他',60],['阿僧祗',56],['恒河沙',52],['极',48],['载',44],['正',40],['涧',36],['沟',32],['穰',28],['秭',24],['垓',20],['京',16],['兆',12],['亿',8],['万',4],['千',3]].map(([name, power]) => [name, 10n ** BigInt(power)]);
  const timeUnits = { 星期:10080n, 分钟:1n, 小时:60n, 周:10080n, 年:525600n, 月:43200n, 天:1440n, 日:1440n, 时:60n, 分:1n };
  // 秒为最小单位：礼物规则和手动加减可以选 秒 / 分钟 / 小时（/ 天）。
  const secondUnits = { 星期:604800n, 分钟:60n, 小时:3600n, 秒:1n, 周:604800n, 年:31536000n, 月:2592000n, 天:86400n, 日:86400n, 时:3600n, 分:60n };
  const RULE_UNITS = ['秒','分钟','小时'];
  function parseMinutes(input, unit = '分钟') { return parseUnits(input, unit, timeUnits, ['分钟','小时','天','周','月','年'], '初始时间最多为1古戈尔分钟'); }
  // 返回秒数：手动加减时间用，例如 parseSeconds('30','秒')、parseSeconds('1.5小时')。
  function parseSeconds(input, unit = '分钟') { return parseUnits(input, unit, secondUnits, ['秒','分钟','小时','天'], '时间太大了'); }
  function parseUnits(input, unit, table, allowed, tooBig) {
    const raw = String(input ?? '').trim().replace(/[,，]/g, '');
    const match = raw.length <= 160 && raw.match(/^(\d+(?:\.\d+)?)(?:[eE]([+-]?\d+))?(.*)$/);
    if (!match || !allowed.includes(unit)) throw new Error('请输入有效时间，例如 60、1.5小时、1亿或1e16');
    let suffix = match[3], multiplier = suffix ? 1n : table[unit];
    if (suffix) {
      const time = Object.keys(table).find(name => suffix.endsWith(name));
      if (time) { multiplier *= table[time]; suffix = suffix.slice(0, -time.length); }
      if (suffix) {
        const number = numbers.find(([name]) => suffix === name);
        if (!number) throw new Error('时间单位无法识别');
        multiplier *= number[1];
      }
    }
    const exponent = Number(match[2] || 0) - (match[1].split('.')[1]?.length || 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 260) throw new Error('时间超出可输入范围');
    const numerator = BigInt(match[1].replace('.', '')) * multiplier * 10n ** BigInt(Math.max(0, exponent));
    const divisor = 10n ** BigInt(Math.max(0, -exponent));
    const result = (numerator + divisor / 2n) / divisor;
    if (result <= 0n || result > 10n ** 100n) throw new Error(`时间须大于零，${tooBig}`);
    return result;
  }
  function formatDuration(input, compact = false) {
    let remaining = BigInt(input);
    if (remaining < 0n) remaining = -remaining;
    const units = [['年',31536000n],['月',2592000n],['周',604800n],['天',86400n],['小时',3600n],['分',60n],['秒',1n]];
    const parts = [];
    for (const [name, size] of units) {
      const value = remaining / size; remaining %= size;
      if (name === '年' && value >= 1000n) {
        let years = value, started = false;
        for (const [label, magnitude] of numbers) {
          const count = years / magnitude; years %= magnitude;
          if (count) started = true;
          if (started && (!compact || count)) {
            const digits = count.toString();
            const rendered = compact && digits.length > 12 ? `约${digits[0]}.${digits.slice(1,3)}e${digits.length-1}` : digits;
            parts.push(`${rendered}${label}年`);
          }
        }
        if (!compact || years) parts.push(`${years}年`);
      } else if (value || (!compact && parts.length) || name === '秒' && !parts.length) {
        parts.push(`${value}${name}`);
      }
      if (compact && parts.length >= 2) break;
    }
    return parts.join('  ');
  }
  const operations = { add:'加时间', subtract:'减时间', random_add:'随机加时间', random_subtract:'随机减时间', random_both:'随机加减时间', multiply:'倍增加班', divide:'缩短加班', clear:'立即下班', lock_toggle:'切换清空锁', media:'只播放素材' };
  const signed = n => n > 0 ? `＋${n}` : n < 0 ? `−${-n}` : '0';
  function ruleText(rule) {
    const unit = rule.unit || '分钟';
    return ({ add:`＋${rule.value} ${unit}`, subtract:`−${rule.value} ${unit}`, random_add:`随机＋${rule.value}～${rule.value_max} ${unit}`, random_subtract:`随机−${rule.value}～${rule.value_max} ${unit}`, random_both:`随机 ${signed(rule.value)}～${signed(rule.value_max)} ${unit}`, multiply:`时间 ×${rule.value}`, divide:`时间 ÷${rule.value}`, clear:'立即下班', lock_toggle:'切换清空锁', media:'播放素材' })[rule.operation];
  }
  const avatarUrl = face => face ? `/api/avatar?url=${encodeURIComponent(face)}` : '/overtime/radish.svg';
  const ruleKey = rule => rule.gift_id ? `id:${rule.gift_id}` : `name:${rule.gift_name}`;
  const panelRules = (panel, rules) => rules.filter(rule => panel.all_rules || panel.gift_keys.includes(ruleKey(rule)));
  const panelEntries = (panel, rules) => panel.template === 'custom' ? panel.entries : panelRules(panel,rules).map(rule => ({gift_id:rule.gift_id,gift_name:rule.gift_name,text:ruleText(rule)}));
  const textGroups = {title:'面板标题',gift:'礼物名称',effect:'作用文字'};
  function normalizePanelStyle(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('面板样式无效');
    const color = (value,fallback) => {
      const result = value ?? fallback;
      if (typeof result !== 'string' || !/^#[a-f0-9]{6}$/i.test(result)) throw new Error('请选择有效颜色');
      return result.toLowerCase();
    };
    const transparent = input.transparent ?? false;
    if (typeof transparent !== 'boolean') throw new Error('背景透明设置无效');
    const show_gift_name = input.show_gift_name ?? false, gift_text_gap = input.gift_text_gap ?? 6;
    if (typeof show_gift_name !== 'boolean') throw new Error('礼物名称显示设置无效');
    if (!Number.isInteger(gift_text_gap) || gift_text_gap < 0 || gift_text_gap > 200) throw new Error('礼物与文案间距须为0–200px的整数');
    const style = {transparent,background:color(input.background,'#526e82'),show_gift_name,gift_text_gap};
    for (const key of Object.keys(textGroups)) {
      const text = input[key] ?? {};
      if (!text || typeof text !== 'object' || Array.isArray(text)) throw new Error('文字样式无效');
      const size = text.size ?? (key === 'title' ? 24 : 18), font = text.font ?? 'Microsoft YaHei', stroke_width = text.stroke_width ?? 0;
      if (!Number.isInteger(size) || size < 8 || size > 120 || typeof font !== 'string' || !/^[\p{L}\p{N} ._-]{1,60}$/u.test(font) || !Number.isFinite(stroke_width) || stroke_width < 0 || stroke_width > 8 || stroke_width * 2 % 1) throw new Error('字号须为8–120，描边为0–8，字体请填写有效名称');
      style[key] = {size,font,color:color(text.color,'#ffffff'),stroke_color:color(text.stroke_color,'#ffffff'),stroke_width};
    }
    return style;
  }
  function applyPanelStyle(element,input) {
    const style = normalizePanelStyle(input);
    element.dataset.transparent = String(style.transparent);
    element.dataset.showGiftName = String(style.show_gift_name);
    element.style.setProperty('--panel-background',style.background);
    element.style.setProperty('--gift-text-gap',`${style.gift_text_gap}px`);
    const imageTextSize = style.show_gift_name ? Math.max(style.gift.size,style.effect.size) : style.effect.size;
    element.style.setProperty('--gift-image-size',`${Math.round(imageTextSize * 1.5)}px`);
    for (const key of Object.keys(textGroups)) {
      const text = style[key];
      element.style.setProperty(`--${key}-size`,`${text.size}px`);
      element.style.setProperty(`--${key}-font`,`${JSON.stringify(text.font)}, sans-serif`);
      element.style.setProperty(`--${key}-color`,text.color);
      // 旧直播浏览器不支持 HTML 的 paint-order，零模糊阴影描边始终位于文字后面。
      const radius = text.stroke_width / 2;
      const shadow = radius ? Array.from({length:16},(_,index) => {
        const angle = index * Math.PI / 8;
        return `${(Math.cos(angle) * radius).toFixed(3)}px ${(Math.sin(angle) * radius).toFixed(3)}px 0 ${text.stroke_color}`;
      }).join(',') : 'none';
      element.style.setProperty(`--${key}-text-shadow`,shadow);
    }
  }
  // ---- 合体模式：时钟、礼物面板、常显文字、飘字放在同一张画布里 ----
  // 画布尺寸固定（width × height），各画面整体等比缩放显示，所以控制台预览、打开的窗口、OBS 里完全一样。
  // clock / panel.box / float.box / texts 的位置都是占画布宽高的百分比。
  const COMBO_THEMES = { bare:'透明描边', glass:'深海玻璃', candy:'奶油糖果', night:'霓虹夜场', paper:'手帐便签' };
  const COMBO_CARDS = { side:'图标在左', stack:'图标在上', pill:'紧凑一行' };
  const COMBO_FLOAT_STYLES = { scroll:'从右往左飘过', rise:'从下往上飘' };
  const COMBO_ALIGNS = { left:'靠左', center:'居中', right:'靠右' };
  const DEFAULT_COMBO = {
    enabled:false, width:540, height:960, clock:{x:0,y:0,w:100,h:17},
    panel:{ box:{x:0,y:46,w:100,h:54}, theme:'bare', title:'', flow:'row', per_line:2, lines:[], card:'side', align:'center', size:100, gap:12, opacity:88, show_name:true, order:[], hidden:[], labels:{} },
    float:{ enabled:true, box:{x:0,y:32,w:100,h:13}, style:'scroll', size:26, seconds:6, show_user:true, show_icon:true },
    texts:[], add_color:'#2fb574', reduce_color:'#f0566a'
  };
  const COMBO_KEY = /^(id:\d{1,9}|name:.{1,100})$/u;
  function normalizeCombo(input = {}) {
    const object = value => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('合体模式设置无效'); return value; };
    const merged = {...DEFAULT_COMBO,...object(input)}, panel = {...DEFAULT_COMBO.panel,...object(merged.panel)}, float = {...DEFAULT_COMBO.float,...object(merged.float)};
    const bool = value => { if (typeof value !== 'boolean') throw new Error('合体模式开关无效'); return value; };
    const int = (value,min,max,label) => { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}须为${min}～${max}的整数`); return value; };
    const pick = (value,options,label) => { if (typeof value !== 'string' || !Object.hasOwn(options,value)) throw new Error(`请选择有效的${label}`); return value; };
    const color = value => { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('请选择有效颜色'); return value.toLowerCase(); };
    const box = (value,label) => {
      object(value);
      const number = (key,min,max) => { if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error(`${label}的位置或大小无效`); return Math.round(value[key] * 100) / 100; };
      return { x:number('x',-50,120), y:number('y',-50,120), w:number('w',5,150), h:number('h',2,150) };
    };
    const keys = value => { if (!Array.isArray(value) || value.length > 200 || value.some(key => typeof key !== 'string' || !COMBO_KEY.test(key))) throw new Error('面板礼物顺序无效'); return [...new Set(value)]; };
    const labels = {};
    for (const [key,value] of Object.entries(object(panel.labels)).slice(0,200)) {
      const text = typeof value === 'string' ? value.trim() : null;
      if (text === null || !COMBO_KEY.test(key) || [...text].length > 30) throw new Error('面板礼物文字最多30个字');
      if (text) labels[key] = text;
    }
    const title = typeof panel.title === 'string' ? panel.title.trim() : null;
    if (title === null || [...title].length > 20) throw new Error('面板标题最多20个字');
    if (!Array.isArray(panel.lines) || panel.lines.length > 20) throw new Error('每排个数最多填20排');
    if (!Array.isArray(merged.texts) || merged.texts.length > 10) throw new Error('常显文字最多10条');
    const texts = merged.texts.map(item => {
      object(item);
      const text = typeof item.text === 'string' ? item.text.trim() : '';
      if (!text || [...text].length > 100) throw new Error('常显文字需要1～100个字');
      return { text, ...box(item,'常显文字'), size:int(item.size ?? 32,10,200,'常显文字字号'), color:color(item.color ?? '#ffffff'), stroke:color(item.stroke ?? '#000000'), bold:bool(item.bold ?? true), align:pick(item.align ?? 'center',COMBO_ALIGNS,'对齐方式') };
    });
    return {
      enabled:bool(merged.enabled), width:int(merged.width,240,3840,'画面宽度'), height:int(merged.height,120,3840,'画面高度'), clock:box(merged.clock,'时钟'),
      panel:{ box:box(panel.box,'礼物面板'), theme:pick(panel.theme,COMBO_THEMES,'面板样式'), title, flow:pick(panel.flow,{row:1,column:1},'排列方式'), per_line:int(panel.per_line,1,20,'每排数量'), lines:panel.lines.map(value => int(value,1,20,'每排个数')), card:pick(panel.card,COMBO_CARDS,'卡片样式'), align:pick(panel.align,COMBO_ALIGNS,'对齐方式'), size:int(panel.size,40,250,'卡片大小'), gap:int(panel.gap,0,60,'卡片间距'), opacity:int(panel.opacity,0,100,'底板不透明度'), show_name:bool(panel.show_name), order:keys(panel.order), hidden:keys(panel.hidden), labels },
      float:{ enabled:bool(float.enabled), box:box(float.box,'飘字区域'), style:pick(float.style,COMBO_FLOAT_STYLES,'飘字方式'), size:int(float.size,12,80,'飘字字号'), seconds:int(float.seconds,3,30,'飘字时长'), show_user:bool(float.show_user), show_icon:bool(float.show_icon) },
      texts, add_color:color(merged.add_color), reduce_color:color(merged.reduce_color)
    };
  }
  // 按控制台里排的顺序列出礼物；没排过的新礼物接在最后。all = 连隐藏的也列出（控制台排序用）。
  function comboRules(combo, rules, all = false) {
    const rank = new Map(combo.panel.order.map((key,index) => [key,index])), hidden = new Set(combo.panel.hidden);
    return rules.map((rule,index) => ({rule,key:ruleKey(rule),rank:rank.get(ruleKey(rule)) ?? rank.size + index})).sort((a,b) => a.rank - b.rank).filter(item => all || !hidden.has(item.key)).map(item => item.rule);
  }
  // 分排：lines 指定前几排各放几个（比如 1、2、2），之后每排 per_line 个。
  function comboLines(panel, items) {
    const result = [];
    for (let at = 0; at < items.length;) { const count = panel.lines[result.length] || panel.per_line; result.push(items.slice(at,at + count)); at += count; }
    return result;
  }
  const comboKind = rule => ({ add:'add', multiply:'add', random_add:'add', subtract:'reduce', random_subtract:'reduce', divide:'reduce', clear:'reduce', random_both:'random' })[rule.operation] || 'special';
  const comboEffect = (rule, labels = {}) => labels[ruleKey(rule)] || ruleText(rule).replace(/\s+/g,'').replace(/＋/g,'+').replace(/−/g,'-');
  const amountText = value => formatDuration(value,true).replace(/\s+/g,'').replace(/分$/,'分钟');
  // 飘字文案：谁 / 送了什么 / 加减多少。主播手动加减没有「谁」，显示「加时 +5分钟」「减时 -1分钟」。
  function floatText(item, showUser = true) {
    const amounts = [];
    if (item.added !== '0') amounts.push({kind:'add',text:`+${amountText(item.added)}`});
    if (item.reduced !== '0') amounts.push({kind:'reduce',text:`-${amountText(item.reduced)}`});
    if (item.source === 'manual') return { who:'', what:item.added === '0' ? '减时' : item.reduced === '0' ? '加时' : '加减时', amounts };
    if (item.source === 'more') return { who:'', what:`还有${item.count}笔礼物`, amounts };
    return { who:showUser ? item.user : '', what:`${item.gift_name}${item.count > 1 ? ` ×${item.count}` : ''}`, amounts };
  }
  // 飘字区域的像素尺寸、行高、行数和速度（像素 / 秒），服务器排队和画面显示用同一份。
  function floatLayout(combo) {
    const width = combo.width * combo.float.box.w / 100, height = combo.height * combo.float.box.h / 100, line = combo.float.size * 2;
    const rise = combo.float.style === 'rise';
    return { width, height, line, lanes:rise ? 1 : Math.max(1,Math.floor(height / line)), speed:(rise ? height + line : width) / combo.float.seconds };
  }
  // 一条飘字要占多久的道（秒）：同一条道上前一条完全进来了，后一条才出发，不会叠在一起。按偏宽估算。
  function floatClear(item, combo) {
    const layout = floatLayout(combo);
    if (combo.float.style === 'rise') return layout.line / layout.speed;
    const text = floatText(item,combo.float.show_user), chars = [...`${text.who}${text.what}${text.amounts.map(amount => amount.text).join('')}`].reduce((sum,char) => sum + (/[ -~]/.test(char) ? .68 : 1.08),0);
    return (chars + 6) * combo.float.size / layout.speed;
  }
  const api = { COMBO_THEMES, COMBO_CARDS, COMBO_FLOAT_STYLES, COMBO_ALIGNS, DEFAULT_COMBO, normalizeCombo, comboRules, comboLines, comboKind, comboEffect, floatText, floatLayout, floatClear, parseMinutes, parseSeconds, RULE_UNITS, formatDuration, operations, ruleText, avatarUrl, ruleKey, panelRules, panelEntries, textGroups, normalizePanelStyle, applyPanelStyle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Overtime = api;
})(globalThis);
