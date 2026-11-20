// 弹幕姬的气泡身份与主题。要加新气泡：在 TIERS 里加一档（决定谁用），再在 overlay.css 里写 .tier-<key> 的样式；
// 要加整套新主题：在 THEMES 里登记，并在 overlay.css 里写 [data-theme="<key>"] 的样式。
(function () {
  // 从高到低匹配，第一档命中的生效。
  const TIERS = [
    { key: 'guard1', label: '总督', test: e => e.guard === 1 },
    { key: 'guard2', label: '提督', test: e => e.guard === 2 },
    { key: 'guard3', label: '舰长', test: e => e.guard === 3 },
    // 抖音粉丝团成员显示为「星守护」气泡，名字后面跟粉丝团等级。
    { key: 'star', label: e => `星守护 ${e.fansLevel}`, test: e => e.fansLevel > 0 },
    // B站戴了本直播间粉丝牌的观众。
    { key: 'fans', label: e => `${e.medalName || '粉丝'} ${e.medalLevel}`, test: e => e.medalLevel > 0 },
    { key: 'normal', label: '', test: () => true }
  ];
  const THEMES = [
    { key: 'wechat', name: '微信经典' },
    { key: 'candy', name: '糖果气泡' },
    { key: 'night', name: '夜间模式' }
  ];
  function tierOf(event) {
    const tier = TIERS.find(t => t.test(event)) || TIERS[TIERS.length - 1];
    return { key: tier.key, label: typeof tier.label === 'function' ? tier.label(event) : tier.label };
  }
  window.DanmakuSkins = { TIERS, THEMES, tierOf };
})();
