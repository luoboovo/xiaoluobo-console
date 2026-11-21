'use strict';
// 角色占位图：Q 版身体用代码画，衣服、假发、头套等特征贴的是截图里截出来的纹理（tex_*.png）。
// 所有角色朝右，画在 220x250 的画布上，脚底在 (FOOT_X, FOOT_Y)。正式生图到位后直接换成 PNG 即可。
const CHAR_W = 220, CHAR_H = 250, FOOT_X = 106, FOOT_Y = 244;
const OUT = '#2b1d16';
const SKIN = '#ffd9b8';

function makeChars(TEX) {
  const out = {};
  const P = (name, fn, pose) => {
    const c = document.createElement('canvas'); c.width = CHAR_W; c.height = CHAR_H;
    const g = c.getContext('2d'); g.lineJoin = 'round'; g.lineCap = 'round';
    fn(g, pose);
    out[name + '_' + pose] = { img: c, meta: { w: CHAR_W, h: FOOT_Y, footX: FOOT_X } };
  };

  // ---------- 基础图元 ----------
  const fs = (g, fill, path, lw = 4) => { g.beginPath(); path(); if (fill) { g.fillStyle = fill; g.fill(); } g.strokeStyle = OUT; g.lineWidth = lw; g.stroke(); };
  const circle = (g, x, y, r, fill, lw) => fs(g, fill, () => g.arc(x, y, r, 0, Math.PI * 2), lw);
  const ellipse = (g, x, y, rx, ry, fill, rot = 0, lw) => fs(g, fill, () => g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2), lw);
  const rrect = (g, x, y, w, h, r, fill, lw) => fs(g, fill, () => g.roundRect(x, y, w, h, r), lw);
  // 用截图纹理填充一个形状：先裁剪再铺图，最后描边
  const tex = (g, key, path, box, base) => {
    g.save(); g.beginPath(); path(); g.clip();
    if (base) { g.fillStyle = base; g.fill(); }
    const t = TEX[key]; if (t) g.drawImage(t, box[0], box[1], box[2], box[3]);
    g.restore(); g.beginPath(); path(); g.strokeStyle = OUT; g.lineWidth = 4; g.stroke();
  };
  const limb = (g, x1, y1, x2, y2, w, color) => {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokeStyle = OUT; g.lineWidth = w + 8; g.stroke();
    g.strokeStyle = color; g.lineWidth = w; g.stroke();
  };

  // ---------- 通用身体 ----------
  // o: {torso, torsoTex, pants, pantsTex, shoe, arm, hand, chubby, legsSpread}
  function legs(g, o, pose) {
    const spread = pose === 'attack' ? 14 : 0;
    const pathL = () => g.roundRect(84 - spread, 192, 20, 46, 8), pathR = () => g.roundRect(108 + spread, 192, 20, 46, 8);
    for (const p of [pathL, pathR]) {
      if (o.pantsTex) tex(g, o.pantsTex, p, [70 - spread, 188, 80 + spread * 2, 54], o.pants);
      else fs(g, o.pants, p);
    }
    if (o.barefoot) { ellipse(g, 92 - spread, 240, 14, 7, SKIN); ellipse(g, 122 + spread, 240, 14, 7, SKIN); }
    else { ellipse(g, 92 - spread, 240, 15, 8, o.shoe || '#3a2a22'); ellipse(g, 122 + spread, 240, 15, 8, o.shoe || '#3a2a22'); }
  }
  const torsoPath = (g, o) => () => { const w = o.chubby ? 92 : 72; g.roundRect(106 - w / 2, 124, w, 80, 24); };
  function torso(g, o) {
    const w = o.chubby ? 92 : 72, p = torsoPath(g, o);
    if (o.torsoTex) tex(g, o.torsoTex, p, o.torsoBox || [106 - w / 2 - 6, 118, w + 12, 92], o.torso);
    else fs(g, o.torso, p);
  }
  function armBack(g, o, pose) { limb(g, 84, 140, pose === 'attack' ? 70 : 78, pose === 'attack' ? 176 : 188, 15, o.arm); circle(g, pose === 'attack' ? 70 : 78, pose === 'attack' ? 180 : 192, 9, o.hand || SKIN, 3); }
  // 返回前手的位置，方便道具挂在手上
  function armFront(g, o, pose) {
    let hx = 132, hy = 190;
    if (pose === 'attack') { hx = 186; hy = 140; limb(g, 124, 142, hx, hy, 15, o.arm); }
    else limb(g, 126, 142, hx, hy - 4, 15, o.arm);
    circle(g, hx, hy, 9.5, o.hand || SKIN, 3);
    return [hx, hy];
  }
  function head(g, o) {
    if (o.maskTex) {
      const p = () => g.arc(108, 82, 50, 0, Math.PI * 2);
      tex(g, o.maskTex, p, o.maskBox || [52, 26, 112, 128], o.maskBase);
      return;
    }
    circle(g, 78, 92, 10, o.skin || SKIN, 3); // 耳朵
    circle(g, 108, 82, 50, o.skin || SKIN);
    g.fillStyle = 'rgba(255,120,120,0.35)'; g.beginPath(); g.ellipse(140, 104, 9, 6, 0, 0, 7); g.fill(); // 腮红
  }
  function eyes(g, kind = 'normal', color = '#2a1a12') {
    for (const x of [118, 142]) {
      if (kind === 'smug') {
        ellipse(g, x, 88, 7, 6, '#fff', 0, 3); circle(g, x + 2, 89, 4, color, 0.1);
        g.fillStyle = OUT; g.fillRect(x - 9, 80, 18, 5);
      } else if (kind === 'closed') {
        g.beginPath(); g.arc(x, 86, 6, Math.PI * 0.1, Math.PI * 0.9); g.strokeStyle = OUT; g.lineWidth = 3.5; g.stroke();
      } else {
        ellipse(g, x, 86, 7.5, 9.5, '#fff', 0, 3); circle(g, x + 2.5, 88, 5, color, 0.1);
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 4.5, 85, 1.8, 0, 7); g.fill();
      }
    }
  }
  function mouth(g, kind = 'smile') {
    g.strokeStyle = OUT; g.lineWidth = 3.5;
    if (kind === 'smile') { g.beginPath(); g.arc(134, 106, 8, 0.2, Math.PI - 0.2); g.stroke(); }
    else if (kind === 'flat') { g.beginPath(); g.moveTo(126, 112); g.lineTo(140, 112); g.stroke(); }
    else if (kind === 'smirk') { g.beginPath(); g.moveTo(124, 112); g.quadraticCurveTo(136, 114, 144, 106); g.stroke(); }
    else if (kind === 'open') fs(g, '#a8323a', () => g.ellipse(134, 112, 9, 8, 0, 0, 7), 3);
    else if (kind === 'grin') { fs(g, '#a8323a', () => { g.moveTo(120, 106); g.quadraticCurveTo(134, 126, 148, 104); g.closePath(); }, 3); g.fillStyle = '#fff'; g.fillRect(124, 106, 20, 4); }
  }
  function glasses(g, kind = 'round') {
    g.strokeStyle = '#1b1b1b'; g.lineWidth = 3.5;
    if (kind === 'sun') { for (const x of [118, 142]) circle(g, x, 87, 8.5, '#151515', 3); }
    else { for (const x of [118, 142]) { g.beginPath(); g.arc(x, 87, 12, 0, 7); g.stroke(); } }
    g.beginPath(); g.moveTo(129, 86); g.lineTo(131, 86); g.moveTo(106, 86); g.lineTo(82, 84); g.stroke();
  }

  // ---------- 发型 ----------
  function hairCap(g, color, fringe = 'messy') {
    fs(g, color, () => {
      g.moveTo(56, 104); g.bezierCurveTo(36, 18, 172, 4, 162, 76);
      if (fringe === 'messy') { g.lineTo(150, 62); g.lineTo(140, 76); g.lineTo(128, 60); g.lineTo(116, 74); g.lineTo(104, 60); g.lineTo(94, 78); g.lineTo(82, 72); }
      else if (fringe === 'bowl') { g.lineTo(162, 74); g.lineTo(84, 74); }
      else { g.quadraticCurveTo(130, 58, 92, 66); g.lineTo(82, 76); }
      g.lineTo(70, 104); g.closePath();
    });
  }
  function hairSpiky(g, color) {
    fs(g, color, () => {
      g.moveTo(58, 100); g.lineTo(44, 60); g.lineTo(66, 58); g.lineTo(56, 22); g.lineTo(84, 36); g.lineTo(92, 2); g.lineTo(112, 28); g.lineTo(130, 0); g.lineTo(140, 32);
      g.lineTo(168, 18); g.lineTo(160, 50); g.lineTo(178, 58); g.lineTo(156, 70); g.lineTo(150, 82); g.lineTo(140, 66); g.lineTo(128, 80); g.lineTo(118, 64); g.lineTo(104, 80); g.lineTo(96, 66); g.lineTo(82, 80); g.lineTo(72, 100); g.closePath();
    });
  }
  function hairUndercut(g, color) {
    g.fillStyle = 'rgba(70,50,40,0.28)'; g.beginPath(); g.ellipse(74, 76, 14, 18, 0, 0, 7); g.fill(); // 推短的两侧
    fs(g, color, () => { g.moveTo(62, 70); g.bezierCurveTo(58, 10, 150, 0, 166, 64); g.quadraticCurveTo(150, 46, 120, 52); g.quadraticCurveTo(90, 50, 76, 72); g.closePath(); });
  }
  function hairAfro(g) {
    const p = () => { g.moveTo(40, 108); g.bezierCurveTo(-4, 30, 60, -18, 110, 2); g.bezierCurveTo(170, -16, 220, 40, 172, 92); g.quadraticCurveTo(164, 44, 112, 48); g.quadraticCurveTo(72, 50, 62, 108); g.closePath(); };
    tex(g, 'tex_clown_wig', p, [20, -14, 190, 124], '#e85');
  }

  // ---------- 角色 ----------
  const chars = {
    ze(g, pose) {
      const o = { torso: '#3b7dd8', pants: '#2c3446', arm: '#3b7dd8' };
      legs(g, o, pose); armBack(g, o, pose); torso(g, o);
      g.strokeStyle = 'rgba(20,50,110,0.6)'; g.lineWidth = 3; for (const y of [146, 166, 186]) { g.beginPath(); g.moveTo(74, y); g.lineTo(138, y); g.stroke(); }
      rrect(g, 86, 120, 40, 14, 7, '#24508f');
      head(g, o); eyes(g, pose === 'attack' ? 'smug' : 'normal'); mouth(g, pose === 'attack' ? 'grin' : 'smirk'); hairCap(g, '#c98f55', 'messy'); glasses(g);
      const [hx, hy] = armFront(g, o, pose);
      if (pose === 'attack') limb(g, hx + 6, hy, hx + 26, hy - 2, 5, SKIN);
    },
    clown(g, pose) {
      const o = { torso: '#ffffff', pants: '#8a5a2b', pantsTex: 'tex_clown_pants', arm: '#ffffff', chubby: true, shoe: '#d33' };
      legs(g, o, pose); armBack(g, o, pose); torso(g, o);
      fs(g, '#f6d743', () => { g.moveTo(64, 132); g.lineTo(100, 128); g.lineTo(96, 204); g.lineTo(64, 198); g.closePath(); });
      fs(g, '#f6d743', () => { g.moveTo(116, 128); g.lineTo(150, 132); g.lineTo(150, 198); g.lineTo(120, 204); g.closePath(); });
      tex(g, 'tex_clown_scarf', () => g.roundRect(100, 140, 26, 70, 6), [92, 136, 44, 80], '#fd4');
      g.fillStyle = '#e33'; for (let x = 100; x < 126; x += 5) g.fillRect(x, 208, 3, 12);
      head(g, o); eyes(g); mouth(g, pose === 'attack' ? 'open' : 'flat'); hairAfro(g);
      if (TEX.tex_clown_bow) g.drawImage(TEX.tex_clown_bow, 88, 114, 40, 30);
      const [hx, hy] = armFront(g, o, pose);
      if (pose !== 'attack') drawHat(g, hx + 6, hy + 6, 0.8);
    },
    web(g, pose) {
      const o = { torso: '#d6262b', torsoTex: 'tex_web_suit', pants: '#2c5fc4', arm: '#d6262b', hand: '#d6262b', shoe: '#d6262b', maskTex: 'tex_web_mask', maskBase: '#d6262b' };
      legs(g, o, pose); armBack(g, o, pose); torso(g, o); head(g, o); armFront(g, o, pose);
    },
    venom(g, pose) {
      const o = { torso: '#1a1d24', torsoTex: 'tex_venom_suit', pants: '#1a1d24', arm: '#1a1d24', hand: '#1a1d24', shoe: '#111', maskTex: 'tex_venom_mask', maskBase: '#1d2230' };
      legs(g, o, pose); armBack(g, o, pose); torso(g, o); head(g, o);
      if (pose === 'attack') { fs(g, '#7a1020', () => g.ellipse(140, 118, 16, 10, 0, 0, 7), 3); g.fillStyle = '#fff'; for (let x = 126; x < 156; x += 6) { g.beginPath(); g.moveTo(x, 110); g.lineTo(x + 3, 118); g.lineTo(x + 6, 110); g.fill(); } }
      armFront(g, o, pose);
    },
    blue(g, pose) {
      const o = { torso: '#3fa8e0', torsoTex: 'tex_blue_suit', pants: '#3fa8e0', pantsTex: 'tex_blue_suit', arm: '#3fa8e0', hand: '#3fa8e0', skin: '#4cb3ea', shoe: '#2f86c0' };
      legs(g, o, pose); armBack(g, o, pose); torso(g, o);
      rrect(g, 72, 186, 70, 12, 5, '#c8323a');
      fs(g, '#4cb3ea', () => { g.moveTo(70, 80); g.lineTo(54, 50); g.lineTo(80, 70); g.closePath(); });
      head(g, o);
      g.strokeStyle = '#1f6fa8'; g.lineWidth = 4; for (const [x, y] of [[90, 60], [100, 110], [150, 64]]) { g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 6, x + 16, y); g.stroke(); }
      eyes(g, 'normal', '#e0b020'); mouth(g, 'flat');
      fs(g, '#1d2a3a', () => { g.moveTo(58, 90); g.bezierCurveTo(44, 20, 170, 8, 160, 70); g.quadraticCurveTo(120, 50, 86, 64); g.lineTo(70, 100); g.closePath(); });
      const [hx, hy] = armFront(g, o, pose);
      drawBow(g, hx, hy, pose === 'attack');
    },
    spear(g, pose) {
      const o = { torso: '#d62a20', torsoTex: 'tex_spear_vest', pants: '#1d1d1d', pantsTex: 'tex_spear_pants', arm: SKIN, barefoot: true };
      legs(g, o, pose); armBack(g, o, pose); torso(g, o);
      head(g, o); eyes(g); mouth(g, 'grin');
      fs(g, '#e23', () => g.ellipse(120, 66, 3, 6, 0, 0, 7), 2);
      hairCap(g, '#1b1b1b', 'smooth'); circle(g, 84, 34, 15, '#1b1b1b'); circle(g, 134, 30, 15, '#1b1b1b');
      rrect(g, 76, 26, 10, 6, 3, '#e33', 2); rrect(g, 126, 22, 10, 6, 3, '#e33', 2);
      const [hx, hy] = armFront(g, o, pose);
      drawSpear(g, hx, hy, pose === 'attack');
      if (pose === 'attack') { for (const x of [92, 122 + 14]) { circle(g, x - 14, 238, 13, null, 4); g.strokeStyle = '#ff9a2a'; g.lineWidth = 4; g.beginPath(); g.arc(x - 14, 238, 13, 0, 7); g.stroke(); } }
    },
    gourd(g, pose) {
      const o = { torso: '#8e44c9', pants: '#8e44c9', arm: '#fff4e0', shoe: '#222' };
      legs(g, o, pose); armBack(g, o, pose); torso(g, o);
      fs(g, '#fff', () => { g.moveTo(88, 126); g.lineTo(106, 160); g.lineTo(124, 126); g.closePath(); }, 3);
      fs(g, '#4caf50', () => { g.moveTo(70, 180); g.quadraticCurveTo(106, 168, 142, 180); g.lineTo(130, 204); g.lineTo(106, 192); g.lineTo(82, 204); g.closePath(); }, 3);
      head(g, o); eyes(g); mouth(g, 'smile'); hairCap(g, '#1b1b1b', 'bowl'); glasses(g);
      if (TEX.tex_gourd_top) { g.save(); g.beginPath(); g.ellipse(110, 20, 12, 20, 0, 0, 7); g.clip(); g.drawImage(TEX.tex_gourd_top, 96, 0, 28, 40); g.restore(); }
      if (pose === 'attack') { const [hx, hy] = armFront(g, o, pose); drawGourd(g, hx + 10, hy - 6); }
      else { limb(g, 80, 158, 136, 158, 14, '#fff4e0'); limb(g, 136, 166, 84, 166, 14, '#fff4e0'); } // 抱胸
    },
    white(g, pose) {
      const o = { torso: '#1d2433', torsoTex: 'tex_white_uniform', torsoBox: [60, 110, 92, 110], pants: '#1d2433', arm: '#1d2433' };
      legs(g, o, pose); armBack(g, o, pose); torso(g, o);
      rrect(g, 74, 196, 64, 7, 3, '#f4f4f4', 2);
      rrect(g, 92, 116, 30, 16, 6, '#1d2433');
      head(g, o); eyes(g, 'closed'); mouth(g, 'smirk'); hairSpiky(g, '#f3f5f8'); glasses(g, 'sun');
      const [hx, hy] = armFront(g, o, pose);
      if (pose === 'attack') { limb(g, hx + 4, hy - 4, hx + 10, hy - 22, 4, SKIN); limb(g, hx + 10, hy - 2, hx + 18, hy - 18, 4, SKIN); }
    },
    giant(g, pose) {
      const o = { torso: '#d93636', torsoTex: 'tex_giant_suit', torsoBox: [56, 116, 100, 96], pants: '#d93636', arm: '#2a3f7a', hand: '#d9dde4', chubby: true, shoe: '#d9dde4' };
      legs(g, o, pose); armBack(g, o, pose); torso(g, o);
      head(g, o); eyes(g); mouth(g, 'grin'); hairCap(g, '#1b1b1b', 'smooth'); glasses(g);
      if (pose === 'attack') { limb(g, 96, 172, 150, 130, 15, '#2a3f7a'); limb(g, 126, 112, 126, 178, 15, '#2a3f7a'); circle(g, 152, 128, 9, '#d9dde4', 3); circle(g, 126, 110, 9, '#d9dde4', 3); }
      else armFront(g, o, pose);
    },
    yu(g, pose) {
      const o = { torso: '#151515', pants: '#1a1a1a', arm: '#151515' };
      fs(g, '#c41e2a', () => { g.moveTo(90, 126); g.lineTo(40, 236); g.quadraticCurveTo(70, 246, 100, 232); g.lineTo(112, 130); g.closePath(); });
      if (pose === 'kneel') g.translate(0, 26);
      if (pose !== 'kneel') legs(g, o, pose); else { rrect(g, 80, 194, 46, 20, 9, '#1a1a1a'); ellipse(g, 76, 214, 15, 8, '#222'); }
      armBack(g, o, pose); torso(g, o);
      g.save(); g.beginPath(); torsoPath(g, o)(); g.clip(); g.strokeStyle = '#d4a63a'; g.lineWidth = 2.5;
      for (let y = 132; y < 204; y += 18) for (let x = 74; x < 140; x += 18) { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 1.5); g.stroke(); g.beginPath(); g.arc(x + 9, y + 9, 3, 0, 7); g.stroke(); }
      g.restore();
      fs(g, '#111', () => { g.moveTo(92, 124); g.lineTo(106, 146); g.lineTo(120, 124); g.closePath(); }, 3);
      if (pose === 'kneel') { g.translate(110, 90); g.rotate(0.25); g.translate(-110, -90); }
      head(g, o);
      g.strokeStyle = '#3a3a3a'; g.lineWidth = 2; g.beginPath(); g.moveTo(96, 120); g.lineTo(90, 132); g.stroke();
      eyes(g, pose === 'kneel' ? 'closed' : 'smug'); mouth(g, pose === 'attack' || pose === 'rage' ? 'open' : pose === 'kneel' ? 'flat' : 'smirk'); hairUndercut(g, '#c9955e');
      if (pose === 'kneel') fs(g, '#8fd3ff', () => { g.moveTo(66, 60); g.quadraticCurveTo(56, 80, 66, 84); g.quadraticCurveTo(76, 80, 66, 60); }, 2);
      armFront(g, o, pose === 'rage' ? 'attack' : pose);
    },
    guard(g, pose) {
      const o = { torso: '#111418', pants: '#111418', arm: SKIN };
      legs(g, o, pose); if (pose === 'attack') armBack(g, o, pose); torso(g, o);
      head(g, o); eyes(g); mouth(g, 'flat'); hairCap(g, '#141414', 'smooth');
      if (pose === 'attack') armFront(g, o, pose);
      else { limb(g, 80, 156, 134, 158, 14, SKIN); limb(g, 136, 168, 82, 168, 14, SKIN); }
    },
    thug(g, pose) {
      const o = { torso: '#1b1d22', pants: '#24262b', arm: '#1b1d22', shoe: '#eee' };
      legs(g, o, pose); armBack(g, o, pose); torso(g, o);
      g.save(); g.beginPath(); torsoPath(g, o)(); g.clip(); g.fillStyle = '#3a3e48'; for (let y = 140; y < 200; y += 14) g.fillRect(60, y, 100, 6); g.restore();
      head(g, o); eyes(g, pose === 'attack' ? 'normal' : 'normal'); mouth(g, pose === 'attack' ? 'open' : 'flat'); hairCap(g, '#141414', 'smooth');
      armFront(g, o, pose);
    }
  };

  for (const [name, fn] of Object.entries(chars)) { P(name, fn, 'idle'); P(name, fn, 'attack'); }
  P('yu', chars.yu, 'rage'); P('yu', chars.yu, 'kneel');
  return out;
}

// ---------- 道具（也给子弹用） ----------
function drawHat(g, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.beginPath(); g.moveTo(-26, 4); g.quadraticCurveTo(-30, -22, 0, -24); g.quadraticCurveTo(30, -22, 26, 4); g.closePath();
  g.fillStyle = '#2f7de0'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 4; g.stroke();
  g.beginPath(); g.ellipse(0, 4, 28, 9, 0, 0, 7); g.fillStyle = '#e8343a'; g.fill(); g.stroke();
  g.restore();
}
function drawBow(g, x, y, drawn) {
  g.strokeStyle = '#7a4a1e'; g.lineWidth = 5; g.beginPath(); g.arc(x - 6, y, 34, -1.2, 1.2); g.stroke();
  g.strokeStyle = '#eee'; g.lineWidth = 1.5; g.beginPath();
  const ax = x - 6 + Math.cos(1.2) * 34, ay = Math.sin(1.2) * 34;
  g.moveTo(ax, y - ay); g.lineTo(drawn ? x - 30 : ax, y); g.lineTo(ax, y + ay); g.stroke();
}
function drawSpear(g, x, y, thrust) {
  g.save(); g.translate(x, y); g.rotate(thrust ? 0 : -0.5);
  g.strokeStyle = OUT; g.lineWidth = 9; g.beginPath(); g.moveTo(-70, 0); g.lineTo(50, 0); g.stroke();
  g.strokeStyle = '#c0282a'; g.lineWidth = 5; g.stroke();
  g.beginPath(); g.moveTo(50, -8); g.lineTo(80, 0); g.lineTo(50, 8); g.closePath(); g.fillStyle = '#f2c230'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#e23'; g.beginPath(); g.moveTo(48, 0); g.lineTo(36, 14); g.lineTo(42, 0); g.fill();
  g.restore();
}
function drawGourd(g, x, y) {
  g.save(); g.translate(x, y); g.rotate(Math.PI / 2);
  g.fillStyle = '#9b4fd8'; g.strokeStyle = OUT; g.lineWidth = 4;
  g.beginPath(); g.arc(0, 10, 18, 0, 7); g.fill(); g.stroke();
  g.beginPath(); g.arc(0, -14, 12, 0, 7); g.fill(); g.stroke();
  g.restore();
}
