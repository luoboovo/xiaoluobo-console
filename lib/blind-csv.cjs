'use strict';
// 盲盒记录的 CSV 导出 / 导入：一位观众一行，金额用「元」。用 Excel、WPS 打开改完再导入，会覆盖当前平台的全部记录。
// 内部金额单位是「毫元」（1 元 = 1000），和 robot.cjs 里一致。

const COLUMNS = [
  { key: 'uid', title: 'UID' },
  { key: 'name', title: '昵称' },
  { key: 'count', title: '盲盒个数' },
  { key: 'cost', title: '投入(元)' },
  { key: 'value', title: '开出(元)' },
  { key: 'profit', title: '盈亏(元)' },
  { key: 'today_count', title: '今天个数' },
  { key: 'today_cost', title: '今天投入(元)' },
  { key: 'today_value', title: '今天开出(元)' },
  { key: 'updated_at', title: '最后更新' },
];
const MAX_ROWS = 20000;

const money = milli => (Math.round(milli / 10) / 100).toFixed(2);
const pad = n => String(n).padStart(2, '0');
const timeText = time => { const d = new Date(time); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function cell(value) {
  // 昵称以 = + - @ 开头时前面加个制表符，免得 Excel 当成公式执行（导入时会去掉首尾空白）。
  let text = String(value ?? '').replace(/[\r\n]+/g, ' ');
  if (/^[=+\-@]/.test(text)) text = '\t' + text;
  return /[",\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// rows: [{key, name, count, cost, value, today:{count,cost,value}|null, updated_at}]
function toCsv(rows) {
  const lines = [COLUMNS.map(c => c.title).join(',')];
  for (const r of rows) {
    const uid = r.key.startsWith('uid:') ? r.key.slice(4) : '';
    const t = r.today || { count: 0, cost: 0, value: 0 };
    // UID 写成 ="123"：Excel 打开时当文字，16 位的长 UID 不会变成科学计数法丢位数。
    lines.push([uid ? `="${uid}"` : '', cell(r.name), r.count, money(r.cost), money(r.value), money(r.value - r.cost), t.count, money(t.cost), money(t.value), r.updated_at ? timeText(r.updated_at) : ''].join(','));
  }
  // 带 BOM，Excel 双击打开不乱码。
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function parseRows(text) {
  const rows = []; let row = [], field = '', quoted = false, i = 0;
  text = String(text || '').replace(/^﻿/, '');
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field.trim() === '') { quoted = true; field = ''; i++; continue; }
    if (ch === '"' && field.trim() === '=') { quoted = true; field = '='; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = title => String(title || '').replace(/\s|（|）|\(|\)|元|¥|￥/g, '');
function columnIndex(header) {
  const names = header.map(norm), find = (...titles) => names.findIndex(n => titles.includes(n));
  return {
    uid: find('UID', 'uid', '用户ID', '观众UID'), name: find('昵称', '观众', '名字'), count: find('盲盒个数', '盲盒', '个数'),
    cost: find('投入'), value: find('开出'), today_count: find('今天个数'), today_cost: find('今天投入'), today_value: find('今天开出'), updated_at: find('最后更新'),
  };
}

function parseMoney(raw, label) {
  const text = String(raw ?? '').trim().replace(/^[¥￥]/, '').replace(/,/g, '');
  if (text === '') return 0;
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`${label}「${raw}」不是有效的金额`);
  const value = Number(text);
  if (value > 1e8) throw new Error(`${label}太大了`);
  return Math.round(value * 1000);
}
function parseCount(raw, label) {
  const text = String(raw ?? '').trim();
  if (text === '') return 0;
  if (!/^\d+$/.test(text)) throw new Error(`${label}「${raw}」要填整数`);
  const value = Number(text);
  if (value > 1e7) throw new Error(`${label}太大了`);
  return value;
}
function parseUid(raw) {
  let text = String(raw ?? '').trim();
  const formula = text.match(/^="?(.*?)"?$/); if (formula) text = formula[1].trim();
  text = text.replace(/^uid:/i, '').replace(/^'/, '');
  if (text === '' || text === '0') return '';
  if (/e\+?\d+$/i.test(text)) throw new Error(`UID「${raw}」被表格软件改成了科学计数法，位数已经丢了。请用导出的原文件改，或者把 UID 这列设成「文本」`);
  if (!/^\d{1,20}$/.test(text)) throw new Error(`UID「${raw}」不是数字`);
  return text;
}
function parseTime(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return 0;
  const time = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).getTime();
  return Number.isFinite(time) ? time : 0;
}

// 返回 [{key, name, count, cost, value, today:{count,cost,value}, updated_at}]；有错就抛出，写明第几行。
function parseCsv(text) {
  const rows = parseRows(text).filter(r => r.some(c => String(c).trim() !== ''));
  if (!rows.length) throw new Error('CSV 是空的');
  const at = rows.findIndex(r => r.some(c => norm(c) === '昵称'));
  if (at < 0) throw new Error('找不到表头（第一行要有「昵称」「盲盒个数」「投入(元)」「开出(元)」这几列）');
  const col = columnIndex(rows[at]);
  for (const [key, title] of [['name', '昵称'], ['count', '盲盒个数'], ['cost', '投入(元)'], ['value', '开出(元)']]) if (col[key] < 0) throw new Error(`表头缺少「${title}」这一列`);
  const data = rows.slice(at + 1);
  if (data.length > MAX_ROWS) throw new Error(`最多导入 ${MAX_ROWS} 行`);
  const result = [], seen = new Map(), errors = [];
  data.forEach((r, i) => {
    const line = at + i + 2, get = key => col[key] >= 0 ? r[col[key]] : '';
    try {
      const uid = parseUid(get('uid')), name = String(get('name') ?? '').trim().slice(0, 100);
      if (!uid && !name) throw new Error('UID 和昵称至少填一个');
      const count = parseCount(get('count'), '盲盒个数'), cost = parseMoney(get('cost'), '投入'), value = parseMoney(get('value'), '开出');
      const today = { count: parseCount(get('today_count'), '今天个数'), cost: parseMoney(get('today_cost'), '今天投入'), value: parseMoney(get('today_value'), '今天开出') };
      if (today.count > count || today.cost > cost || today.value > value) throw new Error('「今天」的数不能比总数还大');
      if (!count && !cost && !value) return; // 全是 0 的行跳过（相当于删掉这位观众）
      const key = uid ? 'uid:' + uid : 'name:' + name;
      if (seen.has(key)) throw new Error(`和第 ${seen.get(key)} 行是同一位观众`);
      seen.set(key, line);
      result.push({ key, name: name || '观众', count, cost, value, today, updated_at: parseTime(get('updated_at')) });
    } catch (error) { errors.push(`第 ${line} 行：${error.message}`); }
  });
  if (errors.length) throw new Error(errors.slice(0, 5).join('；') + (errors.length > 5 ? `；还有 ${errors.length - 5} 行有问题` : '') + '。没有导入任何记录');
  return result;
}

module.exports = { toCsv, parseCsv, COLUMNS };
