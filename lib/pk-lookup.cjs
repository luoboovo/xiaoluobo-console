const { roomId, signWbi } = require('./protocol.cjs');

// PK 查对手：查自己直播间现在跟谁 PK，再查对面直播间的大航海、在线人数、粉丝数等。
// services 是控制台的主连接或机器人的其他直播间连接（都要有 api / request / ensureWbi）。
const PK_FIELDS = [
  { id: 'guards', name: '舰长（大航海）' },
  { id: 'online', name: '在线人数' },
  { id: 'followers', name: '粉丝数' },
  { id: 'fansClub', name: '粉丝团' },
  { id: 'votes', name: 'PK 比分' },
  { id: 'watched', name: '看过人数' },
  { id: 'level', name: '主播等级' },
  { id: 'liveTime', name: '开播时长' },
  { id: 'area', name: '直播分区' },
  { id: 'title', name: '直播标题' },
];
const PK_FIELD_IDS = PK_FIELDS.map(f => f.id);
const STATUS = { 101: 'PK 准备中', 201: 'PK 进行中', 301: '惩罚时间', 401: 'PK 已结束' };
const LIVE = 'https://api.live.bilibili.com';
const count = value => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };
const text = (value, max) => String(value ?? '').trim().slice(0, max);
// B站老接口的开播时间是北京时间字符串，没开播是 0000-00-00。
const chinaTime = value => { const t = Date.parse(String(value || '').replace(' ', 'T') + '+08:00'); return Number.isFinite(t) && t > 0 ? t : 0; };

// 自己直播间正在打的 PK；没在 PK 返回 null。
async function battleInfo(services, own) {
  own = count(own);
  if (!own) return null;
  const { body } = await services.request(`${LIVE}/xlive/general-interface/v1/battle/getInfoById?room_id=${own}`, services.secretData?.cookie || '');
  let json;
  try { json = JSON.parse(body.toString('utf8')); } catch { throw new Error('B站返回异常，请稍后重试'); }
  const data = json?.code === 0 ? json.data : null;
  const sides = [data?.init_info, data?.match_info].filter(side => side && count(side.room_id));
  const ours = sides.find(side => count(side.room_id) === own), theirs = sides.find(side => count(side.room_id) !== own);
  if (!ours || !theirs) return null;
  const status = Number(data.status);
  return {
    active: status !== 401, status: STATUS[status] || 'PK 中', pkId: text(data.pk_id, 30), rivalRoom: count(theirs.room_id),
    rivalName: text(theirs.uname, 40), rivalUid: count(theirs.uid) || 0, ourVotes: count(ours.votes) ?? 0, rivalVotes: count(theirs.votes) ?? 0,
  };
}

async function roomInfo(services, room) {
  await services.ensureWbi();
  const query = signWbi({ room_id: room, web_location: '444.8' }, services.wbi.key);
  const { data } = await services.api(`${LIVE}/xlive/web-room/v1/index/getInfoByRoom?${query}`, `${services.secretData?.cookie || ''}; buvid3=${services.buvid}`);
  return data;
}

// 查一个直播间（房间号、短号或链接都行）。
async function lookupRoom(services, input, diagnostics) {
  const id = roomId(input);
  const { data: init } = await services.api(`${LIVE}/room/v1/Room/room_init?id=${id}`);
  const room = count(init?.room_id), uid = count(init?.uid) || 0;
  if (!room) throw new Error('没找到这个直播间');
  const rival = { roomId: room, shortId: count(init.short_id) || 0, uid, name: '', title: '', area: '', liveStatus: count(init.live_status) || 0, liveStart: 0, guards: null, online: null, followers: null, fansClub: null, watched: null, level: null };
  // 一个接口拿全；被B站风控拦了就换几个老接口拼起来（拿不到看过人数和等级）。
  const full = await roomInfo(services, room).catch(error => { diagnostics?.log('warn', 'pk.room_info_failed', { error }); return null; });
  const extra = [];
  if (full) {
    const info = full.room_info || {}, anchor = full.anchor_info || {};
    Object.assign(rival, {
      name: anchor.base_info?.uname, title: info.title, area: info.area_name,
      liveStatus: count(info.live_status) ?? rival.liveStatus, liveStart: (count(info.live_start_time) || 0) * 1000,
      guards: count(full.guard_info?.count), followers: count(anchor.relation_info?.attention), fansClub: count(anchor.medal_info?.fansclub),
      watched: full.watched_show?.switch === false ? null : count(full.watched_show?.num), level: count(anchor.live_info?.level),
    });
  } else {
    extra.push(
      services.api(`${LIVE}/room/v1/Room/get_info?room_id=${room}`).then(({ data }) => Object.assign(rival, { title: data.title, area: data.area_name, followers: count(data.attention), liveStatus: count(data.live_status) ?? rival.liveStatus, liveStart: chinaTime(data.live_time) })),
      services.api(`${LIVE}/live_user/v1/Master/info?uid=${uid}`).then(({ data }) => { rival.name = data.info?.uname; }),
      services.api(`${LIVE}/xlive/app-room/v2/guardTab/topListNew?roomid=${room}&ruid=${uid}&page=1&page_size=1&typ=0`).then(({ data }) => { rival.guards = count(data.info?.num); }),
      services.api(`${LIVE}/xlive/general-interface/v1/rank/getFansMembersRank?ruid=${uid}&page=1&page_size=1`).then(({ data }) => { rival.fansClub = count(data.num); }),
    );
  }
  extra.push(services.api(`${LIVE}/xlive/general-interface/v1/rank/getOnlineGoldRank?ruid=${uid}&roomId=${room}&page=1&pageSize=1`).then(({ data }) => { rival.online = count(data.onlineNum); }));
  const results = await Promise.allSettled(extra);
  for (const result of results) if (result.status === 'rejected') diagnostics?.log('warn', 'pk.stat_failed', { error: result.reason });
  if (!full && results.every(result => result.status === 'rejected')) throw new Error('B站暂时查不到这个直播间的数据，请稍后再试');
  return { ...rival, name: text(rival.name, 40) || `直播间${room}`, title: text(rival.title, 40), area: text(rival.area, 20), liveStart: rival.liveStatus === 1 ? rival.liveStart : 0 };
}

// 对面直播间的观众名单（只要 UID）：在线榜（最多 500 人）和大航海（最多 600 人）。
// 有人隐藏了粉丝牌也能靠名单认出来；在线榜只列在对面互动过的人，纯潜水的不在里面。
async function rivalAudience(services, room, uid, { guards = true } = {}) {
  const online = new Set(), guardSet = new Set(), add = (set, id) => { const n = count(id); if (n) set.add(n); };
  for (let page = 1; page <= 10; page++) {
    const { data } = await services.api(`${LIVE}/xlive/general-interface/v1/rank/getOnlineGoldRank?ruid=${uid}&roomId=${room}&page=${page}&pageSize=50`);
    const list = Array.isArray(data?.OnlineRankItem) ? data.OnlineRankItem : [];
    for (const item of list) add(online, item.uid ?? item.uinfo?.uid);
    if (list.length < 50) break;
  }
  if (guards) for (let page = 1; page <= 20; page++) {
    const { data } = await services.api(`${LIVE}/xlive/app-room/v2/guardTab/topListNew?roomid=${room}&ruid=${uid}&page=${page}&page_size=30&typ=0`);
    const list = Array.isArray(data?.list) ? data.list : [];
    for (const item of [...(page === 1 && Array.isArray(data?.top3) ? data.top3 : []), ...list]) add(guardSet, item.uinfo?.uid ?? item.uid);
    if (list.length < 30 || page >= (count(data?.info?.page) || 1)) break;
  }
  return { online, guards: guardSet };
}
// 弹幕里的数字：1.2万、3.4亿。
const trim = value => (value >= 100 ? value.toFixed(0) : value.toFixed(1)).replace(/\.0$/, '');
const big = n => n == null ? '?' : n >= 1e8 ? trim(n / 1e8) + '亿' : n >= 1e4 ? trim(n / 1e4) + '万' : String(n);
function liveTime(start, now) {
  if (!start) return '没在播';
  const minutes = Math.max(0, Math.floor((now - start) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}小时${minutes % 60}分` : `${minutes}分钟`;
}
// 话术里能用的变量；{info} 是勾上的几项连起来。
function pkVars(rival, pk, fields, now = Date.now()) {
  const vars = {
    name: rival.name, room: rival.shortId || rival.roomId, guards: big(rival.guards), online: big(rival.online), followers: big(rival.followers), fansClub: big(rival.fansClub),
    watched: big(rival.watched), level: rival.level ?? '?', liveTime: liveTime(rival.liveStart, now), area: rival.area || '?', title: rival.title || '?',
    ours: pk ? big(pk.ourVotes) : '?', theirs: pk ? big(pk.rivalVotes) : '?',
  };
  const item = {
    guards: `舰长${vars.guards}`, online: `在线${vars.online}`, followers: `粉丝${vars.followers}`, fansClub: `粉丝团${vars.fansClub}`,
    votes: pk ? `比分${vars.ours}:${vars.theirs}` : '', watched: `${vars.watched}人看过`, level: `主播${vars.level}级`, liveTime: `已播${vars.liveTime}`,
    area: `${vars.area}区`, title: `标题「${vars.title}」`,
  };
  vars.info = PK_FIELD_IDS.filter(id => fields.includes(id) && item[id]).map(id => item[id]).join('，');
  return vars;
}

module.exports = { PK_FIELDS, PK_FIELD_IDS, battleInfo, lookupRoom, rivalAudience, pkVars };
