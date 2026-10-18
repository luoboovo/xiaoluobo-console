const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { NoodleShop } = require('../lib/noodle.cjs');
const { TemplateLibrary } = require('../lib/templates.cjs');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-cafe-sign-'));
  t.after(async () => {
    if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('luobo-cafe-sign-')) throw new Error('清理路径无效');
    await fs.rm(dir, { recursive: true, force: true });
  });
  const library = await new TemplateLibrary(dir).init();
  const data = JSON.parse(await fs.readFile(path.join(__dirname, '../artifacts/茉莉咖啡厅-v1.0.1.luobo'), 'utf8'));
  const template = await library.install(data);
  const shop = await new NoodleShop(dir, library).init();
  await shop.action({ action: 'preset_create', name: '茉莉咖啡厅', template_id: template.id });
  return { dir, library, template, shop };
}

test('咖啡厅默认不显示标题，背景自定义和留空均可保存并在重启后保留', async t => {
  const { dir, library, shop } = await fixture(t);
  assert.deepEqual(shop.config.sign, { top: '', title: '', bottom: '' });
  const custom = { top: '下午好', title: '小萝卜咖啡', bottom: '今天也要开心' };
  await shop.save({ ...shop.config, sign: custom });
  let reload = await new NoodleShop(dir, library).init();
  assert.deepEqual(reload.config.sign, custom);
  await reload.save({ ...reload.config, sign: { top: '', title: '', bottom: '' } });
  reload = await new NoodleShop(dir, library).init();
  assert.equal(reload.config.sign.title, '');
  await reload.save({ ...reload.config, sign: { top: '', title: '茉莉咖啡厅', bottom: '' } });
  assert.equal((await new NoodleShop(dir, library).init()).config.sign.title, '茉莉咖啡厅');
});

test('旧默认咖啡厅标题只清理一次，备份原配置并保留其他自定义招牌', async t => {
  const { dir, library, template, shop } = await fixture(t);
  const original = shop.activePreset;
  await shop.action({ action: 'preset_create', name: '我的咖啡', template_id: template.id });
  await shop.save({ ...shop.config, sign: { top: '下午好', title: '小萝卜咖啡', bottom: '欢迎光临' } });
  const saved = JSON.parse(await fs.readFile(shop.file, 'utf8'));
  delete saved.cafe_sign_defaults_version;
  for (const preset of saved.presets) {
    delete preset.config.cafe_sign_defaults_version;
    if (preset.id === original) preset.config.sign.title = '茉莉咖啡厅';
  }
  await fs.writeFile(shop.file, JSON.stringify(saved));
  const reload = await new NoodleShop(dir, library).init();
  assert.equal(reload.presets.find(preset => preset.id === original).config.sign.title, '');
  assert.equal(reload.config.sign.title, '小萝卜咖啡');
  assert.equal(reload.presets.find(preset => preset.id === 'saozi').config.sign.title, '臊子面馆');
  assert.deepEqual(JSON.parse(await fs.readFile(shop.file + '.before-cafe-sign-v2.3.4.json', 'utf8')), saved);
  assert.ok(reload.presets.every(preset => preset.config.cafe_sign_defaults_version === 1));
  await reload.action({ action: 'preset_use', id: original });
  await reload.save({ ...reload.config, sign: { top: '', title: '茉莉咖啡厅', bottom: '' } });
  assert.equal((await new NoodleShop(dir, library).init()).config.sign.title, '茉莉咖啡厅');
  assert.deepEqual(JSON.parse(await fs.readFile(shop.file + '.before-cafe-sign-v2.3.4.json', 'utf8')), saved);
});
