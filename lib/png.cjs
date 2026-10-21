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

module.exports = { optimizePng, resizePng };
