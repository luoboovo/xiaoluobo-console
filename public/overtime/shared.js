(function (root) {
  const numbers = [['古戈尔',100],['大数',72],['无量',68],['不可思议',64],['那由他',60],['阿僧祗',56],['恒河沙',52],['极',48],['载',44],['正',40],['涧',36],['沟',32],['穰',28],['秭',24],['垓',20],['京',16],['兆',12],['亿',8],['万',4],['千',3]].map(([name, power]) => [name, 10n ** BigInt(power)]);
  const timeUnits = { 星期:10080n, 分钟:1n, 小时:60n, 周:10080n, 年:525600n, 月:43200n, 天:1440n, 日:1440n, 时:60n, 分:1n };
  function parseMinutes(input, unit = '分钟') {
    const raw = String(input ?? '').trim().replace(/[,，]/g, '');
    const match = raw.length <= 160 && raw.match(/^(\d+(?:\.\d+)?)(?:[eE]([+-]?\d+))?(.*)$/);
    if (!match || !['分钟','小时','天','周','月','年'].includes(unit)) throw new Error('请输入有效时间，例如 60、1.5小时、1亿或1e16');
    let suffix = match[3], multiplier = suffix ? 1n : timeUnits[unit];
    if (suffix) {
      const time = Object.keys(timeUnits).find(name => suffix.endsWith(name));
      if (time) { multiplier *= timeUnits[time]; suffix = suffix.slice(0, -time.length); }
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
    if (result <= 0n || result > 10n ** 100n) throw new Error('时间须大于零，初始时间最多为1古戈尔分钟');
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
  const operations = { add:'加时间', subtract:'减时间', multiply:'倍增加班', divide:'缩短加班', clear:'立即下班', lock_toggle:'切换清空锁', media:'只播放素材' };
  function ruleText(rule) {
    return ({ add:`＋${rule.value} 分钟`, subtract:`−${rule.value} 分钟`, multiply:`时间 ×${rule.value}`, divide:`时间 ÷${rule.value}`, clear:'立即下班', lock_toggle:'切换清空锁', media:'播放素材' })[rule.operation];
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
  const api = { parseMinutes, formatDuration, operations, ruleText, avatarUrl, ruleKey, panelRules, panelEntries, textGroups, normalizePanelStyle, applyPanelStyle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Overtime = api;
})(globalThis);
