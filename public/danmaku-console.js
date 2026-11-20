import { $, toast } from './console-shared.js';

// 弹幕姬的设置不用存到后端：都拼在画面地址里，复制到 OBS / 直播姬就生效。本机记住上次的设置。
const KEY = 'luobo-danmaku-settings', form = $('#danmaku-settings'), frame = $('#danmaku-frame');
const DEFAULTS = { theme: 'wechat', bg: true, size: 15, max: 40, fade: 0, big: 50, enter: false, social: true, like: false };
form.elements.theme.innerHTML = window.DanmakuSkins.THEMES.map(t => `<option value="${t.key}">${t.name}</option>`).join('');

function load() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  const values = { ...DEFAULTS, ...saved };
  for (const [name, value] of Object.entries(values)) {
    const input = form.elements[name];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = value;
  }
}
function values() {
  const out = {};
  for (const name of Object.keys(DEFAULTS)) {
    const input = form.elements[name];
    out[name] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) || DEFAULTS[name] : input.value;
  }
  if (form.elements.fade.value === '0') out.fade = 0;
  return out;
}
// 只把和默认不一样的写进地址，地址短一点。
function query() {
  const v = values(), params = new URLSearchParams();
  for (const [name, value] of Object.entries(v)) {
    if (value === DEFAULTS[name]) continue;
    params.set(name, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return params.toString();
}
const address = () => `${location.origin}/danmaku/${query() ? '?' + query() : ''}`;
function apply() {
  try { localStorage.setItem(KEY, JSON.stringify(values())); } catch {}
  const q = query();
  frame.dataset.src = `/danmaku/?preview=1${q ? '&' + q : ''}`;
  frame.contentWindow?.postMessage({ type: 'danmaku-config', query: q }, location.origin);
}
load(); apply();
form.addEventListener('input', apply);
form.addEventListener('submit', event => event.preventDefault());

$('#danmaku-open').addEventListener('click', () => window.open(address(), '_blank', 'noopener'));
$('#danmaku-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(address()); toast('弹幕姬地址已复制，在直播软件里加「浏览器源」，建议 420 × 720'); }
  catch { toast('复制失败，请手动复制：' + address(), true); }
});

const DEMO = [
  { type: 'member', user: '路过的小鱼', text: '进入了直播间' },
  { type: 'chat', user: '路过的小鱼', text: '主播晚上好～' },
  { type: 'chat', user: '萝卜粉丝', text: '今天也来打卡啦', medalLevel: 12, medalName: '小萝卜' },
  { type: 'chat', user: '星星守护者', text: '冲冲冲！', fansLevel: 8, fansClub: '萝卜团', platform: 'douyin' },
  { type: 'gift', user: '萝卜粉丝', giftName: '小花花', count: 5, giftUnit: 100, giftCoin: 'gold', medalLevel: 12, medalName: '小萝卜' },
  { type: 'chat', user: '舰长大人', text: '这把稳了', guard: 3 },
  { type: 'chat', user: '提督阁下', text: '@舰长大人 你说得对', guard: 2, mention: { name: '舰长大人' } },
  { type: 'social', user: '新来的朋友', text: '关注了主播' },
  { type: 'gift', user: '提督阁下', giftName: '告白气球', count: 1, giftUnit: 52000, giftCoin: 'gold', guard: 2 },
  { type: 'chat', user: '总督殿下', text: '全场的礼物我包了', guard: 1, admin: true },
  { type: 'chat', user: '老板', text: '主播唱首歌吧！', superChat: true, price: 30 },
  { type: 'gift', user: '总督殿下', giftName: '舰长', guardName: '舰长', count: 1, guardPrice: 198000, guard: 1 }
];
let demoTimers = [];
$('#danmaku-demo').addEventListener('click', () => {
  demoTimers.forEach(clearTimeout);
  demoTimers = DEMO.map((event, index) => setTimeout(() => frame.contentWindow?.postMessage({ type: 'danmaku-demo', events: [event] }, location.origin), index * 380));
});
$('#danmaku-clear').addEventListener('click', () => { demoTimers.forEach(clearTimeout); frame.contentWindow?.postMessage({ type: 'danmaku-clear' }, location.origin); });
