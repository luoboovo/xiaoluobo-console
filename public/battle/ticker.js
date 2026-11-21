'use strict';
// 后台计时器：窗口最小化、被挡住或切到后台时，网页的动画循环会被浏览器暂停，
// 但 Worker 里的计时器照常跳，战斗计算就靠它驱动，挂机也不会停。
let timer = null;
onmessage = event => {
  clearInterval(timer);
  const ms = Math.max(8, Number(event.data) || 16);
  timer = setInterval(() => postMessage(0), ms);
};
