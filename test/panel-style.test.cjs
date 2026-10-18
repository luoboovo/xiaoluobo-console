const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyPanelStyle, normalizePanelStyle } = require('../public/overtime/shared.js');

test('礼物面板兼容描边：三组样式独立，关闭描边可清除原效果，保留已保存配置', () => {
  const properties = new Map();
  const element = { dataset: {}, style: { setProperty: (key, value) => properties.set(key, value) } };
  const input = { transparent: true, title: { color: '#000000', stroke_width: 3, stroke_color: '#ffffff' }, gift: { stroke_width: 0.5, stroke_color: '#123456' }, effect: { stroke_width: 8, stroke_color: '#abcdef' } };
  const original = structuredClone(input);
  applyPanelStyle(element, input);
  assert.equal(element.dataset.transparent, 'true');
  assert.equal(properties.get('--title-color'), '#000000');
  for (const [key, color] of [['title', '#ffffff'], ['gift', '#123456'], ['effect', '#abcdef']]) {
    assert.match(properties.get(`--${key}-text-shadow`), new RegExp(`px 0 ${color}`));
  }
  assert.deepEqual(input, original);
  applyPanelStyle(element, { ...input, gift: { ...input.gift, stroke_width: 0 } });
  assert.equal(properties.get('--gift-text-shadow'), 'none');
  assert.notEqual(properties.get('--title-text-shadow'), 'none');
  applyPanelStyle(element);
  for (const key of ['title', 'gift', 'effect']) assert.equal(properties.get(`--${key}-text-shadow`), 'none');
  assert.equal(element.dataset.transparent, 'false');
});

test('礼物面板布局：默认隐藏名称、间距校验、图片随可见文字字号变化', () => {
  const defaults = normalizePanelStyle();
  assert.equal(defaults.show_gift_name, false);
  assert.equal(defaults.gift_text_gap, 6);
  for (const invalid of [{show_gift_name:'false'}, {show_gift_name:1}, {gift_text_gap:-1}, {gift_text_gap:201}, {gift_text_gap:1.5}, {gift_text_gap:'6'}]) assert.throws(() => normalizePanelStyle(invalid));
  const properties = new Map();
  const element = {dataset:{},style:{setProperty:(key,value) => properties.set(key,value)}};
  const style = {gift_text_gap:0,gift:{size:60},effect:{size:30}};
  applyPanelStyle(element, style);
  assert.equal(element.dataset.showGiftName, 'false');
  assert.equal(properties.get('--gift-text-gap'), '0px');
  assert.equal(properties.get('--gift-image-size'), '45px');
  applyPanelStyle(element, {...style,show_gift_name:true,gift_text_gap:200});
  assert.equal(element.dataset.showGiftName, 'true');
  assert.equal(properties.get('--gift-text-gap'), '200px');
  assert.equal(properties.get('--gift-image-size'), '90px');
});
