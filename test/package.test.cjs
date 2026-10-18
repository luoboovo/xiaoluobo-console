const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { PNG } = createRequire(require.resolve('qrcode'))('pngjs');
const { optimizePng } = require('../scripts/optimize-png.cjs');

test('打包 PNG 无损压缩：尺寸、颜色、透明度不变且不会变大', () => {
  const image = new PNG({ width: 64, height: 64 });
  for (let i = 0; i < image.data.length; i++) image.data[i] = i % 251;
  for (const colorType of [2, 6]) {
    const original = PNG.sync.write(image, { colorType, deflateLevel: 0 });
    const optimized = optimizePng(original);
    assert.ok(optimized.length < original.length);
    assert.deepEqual(PNG.sync.read(optimized).data, PNG.sync.read(original).data);
    assert.equal(optimized[25], colorType);
    assert.ok(optimizePng(optimized).length <= optimized.length);
    assert.throws(() => optimizePng(original.subarray(0, original.length - 1)));
  }
  assert.throws(() => optimizePng(Buffer.from('invalid PNG')));
});

test('带生成签名的 PNG 也无损压缩；原文件、尺寸和全部像素保留', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const original = fs.readFileSync(path.join(__dirname, '..', 'templates', 'daoxiao', 'assets', 'pot.png'));
  assert.ok(original.includes(Buffer.from('caBX')));
  const optimized = optimizePng(original);
  assert.ok(optimized.length < original.length);
  assert.deepEqual(PNG.sync.read(optimized).data, PNG.sync.read(original).data);
  assert.deepEqual(fs.readFileSync(path.join(__dirname, '..', 'templates', 'daoxiao', 'assets', 'pot.png')), original);
});

test('礼物调色板、透明度和色彩元数据在压缩后保留', () => {
  const fs = require('node:fs'), path = require('node:path');
  const dir = path.join(__dirname, '..', 'data', 'images');
  let checked = 0;
  for (const name of fs.readdirSync(dir)) {
    const original = fs.readFileSync(path.join(dir, name));
    if (original[25] !== 3 || !original.includes(Buffer.from('gAMA'))) continue;
    const optimized = optimizePng(original);
    assert.ok(optimized.length <= original.length);
    assert.equal(optimized[25], 3);
    assert.deepEqual(PNG.sync.read(optimized).data, PNG.sync.read(original).data);
    for (const type of ['PLTE', 'tRNS', 'gAMA', 'sRGB', 'iCCP']) {
      const data = bytes => { for (let offset = 8; offset < bytes.length; offset += bytes.readUInt32BE(offset) + 12) if (bytes.toString('ascii', offset + 4, offset + 8) === type) return bytes.subarray(offset, offset + bytes.readUInt32BE(offset) + 12); };
      assert.deepEqual(data(optimized), data(original));
    }
    checked++; break;
  }
  assert.equal(checked, 1);
});

test('打包缩图：最长边按上限缩小，比例、透明度和色彩信息保留，小图原样返回', () => {
  const { resizePng } = require('../scripts/optimize-png.cjs');
  const image = new PNG({ width: 400, height: 200 });
  for (let y = 0; y < 200; y++) for (let x = 0; x < 400; x++) {
    const i = (y * 400 + x) * 4;
    image.data[i] = 200; image.data[i + 1] = 40; image.data[i + 2] = 10; image.data[i + 3] = x < 200 ? 0 : 255;
  }
  const encoded = PNG.sync.write(image, { colorType: 6 });
  // Insert an sRGB chunk after IHDR the way image editors write it.
  const srgb = Buffer.from([0, 0, 0, 1, 0x73, 0x52, 0x47, 0x42, 0, 0xae, 0xce, 0x1c, 0xe9]);
  const original = Buffer.concat([encoded.subarray(0, 33), srgb, encoded.subarray(33)]);
  const resized = resizePng(original, 100), decoded = PNG.sync.read(resized);
  assert.equal(decoded.width, 100); assert.equal(decoded.height, 50);
  assert.ok(resized.includes(Buffer.from('sRGB')));
  // Opaque pixels keep their colour; transparent half stays transparent without a dark fringe.
  const pixel = x => decoded.data.subarray((25 * 100 + x) * 4, (25 * 100 + x) * 4 + 4);
  assert.deepEqual([...pixel(10)].slice(3), [0]);
  assert.deepEqual([...pixel(90)], [200, 40, 10, 255]);
  assert.deepEqual([...pixel(50)].slice(0, 3), [200, 40, 10]);
  assert.equal(resizePng(original, 400), original);
});
