// 测试用模板包：名称、版本、玩法、招牌、布局和素材槽位取自真实发布的 .luobo（templates.json），
// 每个槽位现场生成一张颜色不同的小 PNG，测试不再依赖仓库外几十 MB 的模板包和原图。
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { PNG } = createRequire(require.resolve('qrcode'))('pngjs');
const packages = require('./templates.json');

function tinyPng(seed) {
  const image = new PNG({ width:4, height:4 }), color = createHash('sha256').update(seed).digest();
  for (let i = 0; i < image.data.length; i += 4) { image.data[i] = color[0]; image.data[i+1] = color[1]; image.data[i+2] = color[2]; image.data[i+3] = 255; }
  return PNG.sync.write(image);
}
const built = new Map();
// 返回新的对象，测试可以随意修改；同名包的素材内容每次相同。
function templatePackage(name) {
  if (!packages[name]) throw new Error('没有这个测试模板：' + name);
  if (!built.has(name)) {
    const { slots, ...meta } = packages[name];
    built.set(name, JSON.stringify({ ...meta, assets:Object.fromEntries(slots.map(slot => [slot, tinyPng(`${name}:${slot}`).toString('base64')])) }));
  }
  return JSON.parse(built.get(name));
}
const templateSource = name => JSON.stringify(templatePackage(name));

module.exports = { templatePackage, templateSource, tinyPng };
