// 加班机送礼特效：礼物图标从画面外画一道弧线飞向时钟，「啪」一下砸中，时钟弹一下并飘出「+1分钟」。
// overlay.js 收到新的送礼记录后调用 OvertimeGiftFx.play(record, {onHit})；onHit 在第一下砸中时回调，
// 让时钟这时才跳到新时间，看起来就像是礼物把时间「砸」上去的。
(() => {
  const MAX_FLYING = 24, PER_GIFT = 6, STAGGER = 95;
  let layer, flying = 0;
  const ensureLayer = () => {
    if (!layer) { layer = document.createElement('div'); layer.className = 'gift-fx'; layer.setAttribute('aria-hidden','true'); document.body.append(layer); }
    return layer;
  };
  const random = (min,max) => min + Math.random() * (max - min);
  const amountText = (record) => {
    const up = record.added !== '0', value = up ? record.added : record.reduced;
    if (record.operation === 'multiply') return '时间翻倍';
    if (record.operation === 'divide') return '时间缩短';
    return (up ? '+' : '−') + Overtime.formatDuration(value,true).replace(/\s+/g,'').replace(/分$/,'分钟');
  };
  // 打中的位置：倒计时文字本身的范围（文字是左对齐的，比整个 #time 盒子小）。
  function targetPoint(time) {
    let rect = time.getBoundingClientRect();
    const text = time.firstChild;
    if (text && text.nodeType === Node.TEXT_NODE) { const range = document.createRange(); range.selectNodeContents(time); const inner = range.getBoundingClientRect(); if (inner.width && inner.height) rect = inner; }
    return { x:rect.left + rect.width * random(.3,.7), y:rect.top + rect.height * random(.35,.65), size:Math.max(36,Math.min(120,rect.height * .55)) };
  }
  function giftNode(record, size) {
    const node = document.createElement('div');
    node.className = 'gift-fx-gift'; node.style.setProperty('--size',`${size}px`);
    const heart = () => { const span = document.createElement('span'); span.textContent = '💗'; return span; };
    if (record.gift_id) {
      const img = document.createElement('img'); img.alt = ''; img.src = `/api/gifts/${encodeURIComponent(record.gift_id)}/image`;
      img.addEventListener('error',() => img.replaceWith(heart()),{once:true});
      node.append(img);
    } else node.append(heart());
    return node;
  }
  function fly(record, time, onHit) {
    if (flying >= MAX_FLYING) { onHit?.(); return; }
    flying++;
    const target = targetPoint(time), size = target.size, w = innerWidth, h = innerHeight;
    const fromLeft = Math.random() < .5, start = { x:fromLeft ? -size : w + size, y:h * random(.75,1.05) };
    const control = { x:(start.x + target.x) / 2 + random(-.1,.1) * w, y:Math.max(size * .2, Math.min(start.y,target.y) - h * random(.35,.6)) };  // 弧线顶点别飞出画面
    const spin = (fromLeft ? 1 : -1) * random(240,480), frames = [];
    for (let i = 0; i <= 16; i++) {
      const t = Math.pow(i / 16, 1.35), u = 1 - t;  // 越飞越快
      const x = u*u*start.x + 2*u*t*control.x + t*t*target.x, y = u*u*start.y + 2*u*t*control.y + t*t*target.y;
      frames.push({ transform:`translate(${x - size/2}px,${y - size/2}px) rotate(${spin * t}deg) scale(${.7 + .5 * t})` });
    }
    const node = giftNode(record,size); ensureLayer().append(node);
    const animation = node.animate(frames,{ duration:random(620,760), easing:'linear', fill:'forwards' });
    animation.onfinish = animation.oncancel = () => { node.remove(); flying--; impact(record,target,time); onHit?.(); };
  }
  function impact(record, target, time) {
    const up = record.added !== '0', root = ensureLayer();
    const at = (el) => { el.style.left = `${target.x}px`; el.style.top = `${target.y}px`; root.append(el); return el; };
    const ring = at(document.createElement('div')); ring.className = 'gift-fx-ring' + (up ? '' : ' down'); ring.style.setProperty('--size',`${target.size * 2.4}px`);
    const pa = at(document.createElement('div')); pa.className = 'gift-fx-pa'; pa.textContent = '啪!'; pa.style.setProperty('--size',`${Math.max(18,target.size * .5)}px`); pa.style.setProperty('--tilt',`${random(-18,18)}deg`);
    const sparks = [];
    for (let i = 0; i < 8; i++) {
      const spark = at(document.createElement('i')); sparks.push(spark); spark.className = 'gift-fx-spark' + (up ? '' : ' down');
      const angle = i / 8 * Math.PI * 2 + random(-.25,.25), distance = target.size * random(.9,1.6);
      spark.style.setProperty('--dx',`${Math.cos(angle) * distance}px`); spark.style.setProperty('--dy',`${Math.sin(angle) * distance}px`);
    }
    // 时钟以被砸的位置为中心弹一下（加时）或缩一下（减时）。
    const rect = time.getBoundingClientRect();
    time.style.transformOrigin = `${target.x - rect.left}px ${target.y - rect.top}px`;
    time.classList.remove('gift-hit','gift-hit-down'); void time.offsetWidth; time.classList.add(up ? 'gift-hit' : 'gift-hit-down');
    setTimeout(() => { for (const el of [ring,pa,...sparks]) el.remove(); }, 700);
  }
  function label(record, time, delay) {
    setTimeout(() => {
      const target = targetPoint(time), node = document.createElement('div');
      node.className = 'gift-fx-label' + (record.added !== '0' ? '' : ' down');
      node.style.left = `${Math.min(innerWidth - 40, target.x + target.size * .4)}px`; node.style.top = `${target.y - target.size * .2}px`;
      node.style.setProperty('--size',`${Math.max(18,Math.min(64,target.size * .55))}px`);
      const amount = document.createElement('strong'); amount.textContent = amountText(record);
      const who = document.createElement('small'); who.textContent = `${record.user ? record.user + ' · ' : ''}${record.gift_name}${record.count > 1 ? ` ×${record.count}` : ''}`;
      node.append(amount,who); ensureLayer().append(node);
      setTimeout(() => node.remove(),1700);
    },delay);
  }
  window.OvertimeGiftFx = {
    play(record, time, { onHit } = {}) {
      const shots = Math.max(1,Math.min(PER_GIFT,Number(record.count) || 1));
      let hit = false;
      for (let i = 0; i < shots; i++) setTimeout(() => fly(record,time,() => { if (!hit) { hit = true; onHit?.(); } }), i * STAGGER);
      label(record,time,700);
    },
  };
})();
