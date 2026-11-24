const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { deflateSync, inflateSync } = require('node:zlib');
const pngRequire = createRequire(require.resolve('qrcode'));
const { PNG } = pngRequire('pngjs');
const { crc32 } = pngRequire('pngjs/lib/crc');

function chunks(bytes) {
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid PNG signature');
  const parts = [];
  for (let offset = 8; offset < bytes.length;) {
    assert.ok(offset + 12 <= bytes.length, 'Truncated PNG chunk');
    const end = offset + bytes.readUInt32BE(offset) + 12;
    assert.ok(end <= bytes.length, 'Truncated PNG data');
    parts.push({ type: bytes.toString('ascii', offset + 4, offset + 8), bytes: bytes.subarray(offset, end), data: bytes.subarray(offset + 8, end - 4) });
    offset = end;
  }
  return parts;
}

function optimizePng(bytes) {
  const parts = chunks(bytes);
  // shortcut: keep APNG frames intact; extend only with a frame-aware lossless encoder.
  if (parts.some(part => part.type === 'acTL')) return bytes;
  const image = PNG.sync.read(bytes);
  // These generated PNGs compress better inside the installer with their original IDAT encoding.
  const signed = parts.some(part => part.type === 'caBX');
  const compressed = parts => Buffer.concat(parts.filter(part => part.type === 'IDAT').map(part => part.data));
  let best = compressed(parts);
  const filtered = inflateSync(best);
  for (const deflateStrategy of signed ? [] : [0, 1]) {
    const candidate = deflateSync(filtered, { level: 9, strategy: deflateStrategy });
    if (candidate.length < best.length) best = candidate;
    if (bytes[24] === 8 && [2, 6].includes(bytes[25]) && bytes[28] === 0) {
      const refiltered = compressed(chunks(PNG.sync.write(image, { colorType: bytes[25], deflateLevel: 9, deflateStrategy })));
      if (refiltered.length < best.length) best = refiltered;
    }
  }
  const idat = Buffer.alloc(best.length + 12);
  idat.writeUInt32BE(best.length); idat.write('IDAT', 4); best.copy(idat, 8);
  idat.writeInt32BE(crc32(idat.subarray(4, -4)), idat.length - 4);
  let inserted = false;
  const encoded = [bytes.subarray(0, 8)];
  for (const part of parts) {
    // Re-encoding invalidates C2PA signatures; original signed source files stay in the project.
    if (part.type === 'caBX') continue;
    if (part.type !== 'IDAT') encoded.push(part.bytes);
    else if (signed) encoded.push(part.bytes);
    else if (!inserted) { encoded.push(idat); inserted = true; }
  }
  const result = Buffer.concat(encoded);
  if (result.length >= bytes.length) return bytes;
  const decoded = PNG.sync.read(result);
  assert.equal(decoded.width, image.width);
  assert.equal(decoded.height, image.height);
  assert.deepEqual(decoded.data, image.data, 'PNG optimization must preserve every pixel and alpha value');
  return result;
}

// Area-average downscale in premultiplied alpha, so transparent edges keep no dark fringe.
function downscale(source, width, height, targetWidth, targetHeight) {
  const pass = (input, length, lines, target, stride, step, premultiply = false) => {
    const output = new Float32Array(target * lines * 4), ratio = length / target;
    for (let line = 0; line < lines; line++) for (let x = 0; x < target; x++) {
      const start = x * ratio, end = start + ratio, sum = [0, 0, 0, 0];
      for (let i = Math.floor(start); i < Math.min(length, Math.ceil(end)); i++) {
        const weight = Math.min(end, i + 1) - Math.max(start, i), offset = (line * stride + i * step) * 4;
        const alpha=premultiply?input[offset+3]/255:1;
        for (let c = 0; c < 4; c++) sum[c] += input[offset + c] * weight * (c<3?alpha:1);
      }
      const offset = (line * (step === 1 ? target : 1) + x * (step === 1 ? 1 : lines)) * 4;
      for (let c = 0; c < 4; c++) output[offset + c] = sum[c] / ratio;
    }
    return output;
  };
  // Rows first (width shrinks), then columns of the narrower image.
  const rows = pass(source, width, height, targetWidth, width, 1, true);
  const columns = pass(rows, height, targetWidth, targetHeight, 1, targetWidth);
  const result = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let i = 0; i < result.length; i += 4) {
    const alpha = columns[i + 3], scale = alpha > 0 ? 255 / alpha : 0;
    for (let c = 0; c < 3; c++) result[i + c] = Math.max(0, Math.min(255, Math.round(columns[i + c] * scale)));
    result[i + 3] = Math.max(0, Math.min(255, Math.round(alpha)));
  }
  return result;
}

// Shrinks the longest edge to maxEdge; smaller images and animated PNGs are returned unchanged.
function resizePng(bytes, maxEdge) {
  const parts = chunks(bytes);
  if (parts.some(part => part.type === 'acTL')) return bytes;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (Math.max(width, height) <= maxEdge) return bytes;
  const scale = maxEdge / Math.max(width, height);
  const target = new PNG({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
  target.data = downscale(PNG.sync.read(bytes).data, width, height, target.width, target.height);
  const encoded = chunks(PNG.sync.write(target, { colorType: 6, deflateLevel: 9 }));
  // Keep colour-space chunks so the smaller copy renders with the same colours.
  const colour = parts.filter(part => ['gAMA', 'cHRM', 'sRGB', 'iCCP'].includes(part.type)).map(part => part.bytes);
  return Buffer.concat([bytes.subarray(0, 8), encoded[0].bytes, ...colour, ...encoded.slice(1).map(part => part.bytes)]);
}

// 调色板压缩：把真彩色 PNG 转成最多 256 色的调色板 PNG（带透明度），插画、卡通素材一般小 4～6 倍。
// 颜色在「预乘透明度」空间里挑和比较（半透明边缘不会发黑或发白），中位切分 + k-means 选色，Floyd–Steinberg 抖动防止色带。
// 画质把关：解码回来和原图比 PSNR 低于 minPsnr（默认 34dB；煮面素材最差的一张约 37dB，放大两倍对比也看不出）就原样返回，不压这张。
function quantizePng(bytes, { minPsnr = 34, dither = 0.5, report } = {}) {
  const parts = chunks(bytes);
  if (parts.some(part => part.type === 'acTL') || bytes[25] === 3) return bytes;
  const { width, height, data } = PNG.sync.read(bytes), n = width * height;
  // 预乘后的像素：r·a, g·a, b·a, a（都在 0..255）。
  const pre = new Float32Array(n * 4);
  let clear = false;
  for (let i = 0; i < n; i++) {
    const o = i * 4, a = data[o + 3], k = a / 255;
    pre[o] = data[o] * k; pre[o + 1] = data[o + 1] * k; pre[o + 2] = data[o + 2] * k; pre[o + 3] = a;
    if (a === 0) clear = true;
  }
  // 直方图：每通道取高 5 位，2^20 个格子；完全透明的像素单独占调色板第 0 格。
  const BITS = 5, SHIFT = 8 - BITS, bin = (o, src) => ((src[o] >> SHIFT) << 15) | ((src[o + 1] >> SHIFT) << 10) | ((src[o + 2] >> SHIFT) << 5) | (src[o + 3] >> SHIFT);
  const counts = new Uint32Array(1 << 20), sums = new Float64Array((1 << 20) * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (data[o + 3] === 0) continue;
    const b = bin(o, data);
    counts[b]++;
    for (let c = 0; c < 4; c++) sums[b * 4 + c] += pre[o + c];
  }
  const entries = [];
  for (let b = 0; b < counts.length; b++) if (counts[b]) entries.push({ w: counts[b], v: [0, 1, 2, 3].map(c => sums[b * 4 + c] / counts[b]) });
  const slots = 256 - (clear ? 1 : 0);
  let palette;
  if (entries.length <= slots) palette = entries.map(e => e.v);
  else {
    // 中位切分：每次把「误差最大」的盒子沿方差最大的通道从加权中位数处切开。
    const stats = list => {
      let w = 0; const s = [0, 0, 0, 0], q = [0, 0, 0, 0];
      for (const e of list) { w += e.w; for (let c = 0; c < 4; c++) { s[c] += e.v[c] * e.w; q[c] += e.v[c] * e.v[c] * e.w; } }
      const variance = s.map((sum, c) => q[c] - sum * sum / w);
      return { list, w, mean: s.map(sum => sum / w), variance, error: variance.reduce((a, b) => a + b, 0) };
    };
    const boxes = [stats(entries)];
    while (boxes.length < slots) {
      let pick = -1;
      for (let i = 0; i < boxes.length; i++) if (boxes[i].list.length > 1 && (pick < 0 || boxes[i].error > boxes[pick].error)) pick = i;
      if (pick < 0) break;
      const box = boxes[pick], channel = box.variance.indexOf(Math.max(...box.variance));
      const sorted = box.list.slice().sort((a, b) => a.v[channel] - b.v[channel]);
      let half = 0, cut = 1;
      for (let i = 0; i < sorted.length - 1; i++) { half += sorted[i].w; if (half >= box.w / 2) { cut = i + 1; break; } cut = i + 1; }
      boxes.splice(pick, 1, stats(sorted.slice(0, cut)), stats(sorted.slice(cut)));
    }
    palette = boxes.map(box => box.mean);
    // k-means 微调几轮，颜色更贴近图里真正常用的颜色。
    for (let round = 0; round < 3; round++) {
      const acc = palette.map(() => [0, 0, 0, 0, 0]);
      for (const e of entries) {
        let best = 0, bestD = Infinity;
        for (let p = 0; p < palette.length; p++) {
          const c = palette[p], d = (e.v[0] - c[0]) ** 2 + (e.v[1] - c[1]) ** 2 + (e.v[2] - c[2]) ** 2 + (e.v[3] - c[3]) ** 2;
          if (d < bestD) { bestD = d; best = p; }
        }
        const a = acc[best]; for (let c = 0; c < 4; c++) a[c] += e.v[c] * e.w; a[4] += e.w;
      }
      palette = palette.map((c, p) => acc[p][4] ? acc[p].slice(0, 4).map(sum => sum / acc[p][4]) : c);
    }
  }
  if (clear) palette.unshift([0, 0, 0, 0]);
  // 半透明的颜色排前面，tRNS 块可以短一点。
  palette = palette.map(c => c.map(v => Math.max(0, Math.min(255, v)))).sort((a, b) => (a[3] >= 254.5) - (b[3] >= 254.5));
  const K = palette.length, flat = new Float32Array(K * 4);
  palette.forEach((c, p) => flat.set(c, p * 4));
  // 最近色查表：抖动后的颜色按每通道 6 位分格缓存，大图也只要一两秒。
  const cache = new Int16Array(1 << 24).fill(-1);
  const nearest = (r, g, b, a) => {
    const key = ((r >> 2) << 18) | ((g >> 2) << 12) | ((b >> 2) << 6) | (a >> 2);
    if (cache[key] >= 0) return cache[key];
    let best = 0, bestD = Infinity;
    for (let p = 0; p < K; p++) {
      const o = p * 4, d = (r - flat[o]) ** 2 + (g - flat[o + 1]) ** 2 + (b - flat[o + 2]) ** 2 + (a - flat[o + 3]) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return (cache[key] = best);
  };
  const transparent = clear ? palette.findIndex(c => c[3] === 0) : -1;
  const indices = Buffer.alloc((width + 1) * height);
  const err = new Float32Array(n * 4), DAMP = dither;
  for (let y = 0; y < height; y++) {
    indices[y * (width + 1)] = 0; // 每行的过滤方式：0（不过滤，调色板图这样压得最小）
    for (let x = 0; x < width; x++) {
      const i = y * width + x, o = i * 4;
      let index;
      if (data[o + 3] === 0) index = transparent;
      else {
        const v = [0, 1, 2, 3].map(c => Math.max(0, Math.min(255, pre[o + c] + err[o + c])));
        index = nearest(v[0] | 0, v[1] | 0, v[2] | 0, v[3] | 0);
        const spread = (dx, dy, f) => {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= width || yy >= height) return;
          const t = (yy * width + xx) * 4;
          if (data[t + 3] === 0) return;
          for (let c = 0; c < 4; c++) err[t + c] += (v[c] - flat[index * 4 + c]) * f * DAMP;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
      indices[y * (width + 1) + 1 + x] = index;
    }
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length); out.write(type, 4); body.copy(out, 8);
    out.writeInt32BE(crc32(out.subarray(4, -4)), out.length - 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 3;
  const unpremultiply = c => c[3] > 0 ? [0, 1, 2].map(k => Math.round(Math.min(255, c[k] * 255 / c[3]))) : [0, 0, 0];
  const plte = Buffer.from(palette.flatMap(unpremultiply));
  const alphas = palette.map(c => Math.round(c[3])), last = alphas.findLastIndex(a => a < 255);
  const colour = parts.filter(part => ['gAMA', 'cHRM', 'sRGB', 'iCCP'].includes(part.type)).map(part => part.bytes);
  const result = Buffer.concat([
    bytes.subarray(0, 8), chunk('IHDR', ihdr), ...colour, chunk('PLTE', plte),
    ...(last >= 0 ? [chunk('tRNS', Buffer.from(alphas.slice(0, last + 1)))] : []),
    chunk('IDAT', deflateSync(indices, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
  if (result.length >= bytes.length) return bytes;
  // 画质把关：解码回来，在预乘空间里和原图逐像素比。
  const decoded = PNG.sync.read(result).data;
  let mse = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4, k = decoded[o + 3] / 255;
    for (let c = 0; c < 3; c++) mse += (decoded[o + c] * k - pre[o + c]) ** 2;
    mse += (decoded[o + 3] - pre[o + 3]) ** 2;
  }
  const psnr = 10 * Math.log10(255 * 255 / Math.max(1e-9, mse / (n * 4)));
  report?.(psnr, result.length);
  return psnr >= minPsnr ? result : bytes;
}

module.exports = { optimizePng, resizePng, quantizePng };
