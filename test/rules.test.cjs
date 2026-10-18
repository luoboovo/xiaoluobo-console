const { test } = require('node:test');
const assert = require('node:assert/strict');
const { accepts, ready, contains, overlaps, radius } = require('../public/noodle/rules.js');

test('共享配方按顾客订单判断：圣水、臊子面、刀削面和拿铁各自匹配', () => {
  const water = { kind: 'water' }, noodles = { kind: 'bowl', noodles: 1, sauce: 0 };
  assert.equal(accepts(water, { order: 'water' }), true);
  assert.equal(accepts(water, { order: 'noodles' }), false);
  assert.equal(accepts(noodles, { order: 'water' }), false);
  assert.equal(accepts(noodles, {}), false);
  assert.equal(accepts(noodles, { recipe: 'knife-noodles' }), true);
  assert.equal(accepts({ ...noodles, sauce: 1 }, {}), true);
  assert.equal(accepts({ ...noodles, spoiled: true }, { recipe: 'knife-noodles' }), false);
  const latte = { kind: 'bowl', coffee: true, jasmine: true, milk: true };
  assert.equal(accepts(latte, { recipe: 'jasmine-latte' }), true);
  for (const key of ['coffee', 'jasmine', 'milk']) assert.equal(accepts({ ...latte, [key]: false }, { recipe: 'jasmine-latte' }), false);
  assert.equal(ready({ kind: 'coin' }), false);
  assert.equal(accepts(null, {}), false);
  assert.equal(accepts(latte, null), false);
});

test('共享碰撞在台面边缘和最小间距处保持一致', () => {
  const bowl = { kind: 'bowl', x: 374, y: 424 }, water = { kind: 'water', x: 460, y: 424 };
  assert.equal(contains(bowl.x, bowl.y, radius(bowl)), true);
  assert.equal(contains(bowl.x - 1, bowl.y, radius(bowl)), false);
  assert.equal(overlaps(bowl, water), false);
  assert.equal(overlaps(bowl, { ...water, x: water.x - 1 }), true);
});
