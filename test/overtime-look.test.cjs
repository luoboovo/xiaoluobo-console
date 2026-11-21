const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OvertimeMachine, normalizeLook } = require('../lib/overtime.cjs');
const { atomicJson } = require('../lib/services.cjs');

const config = { initial_text:'60', time_unit:'分钟', clear_lock_default_unlocked:true, gift_rules:[{ gift_name:'加班花', gift_id:1, operation:'add', value:30 }] };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'luobo-overtime-look-'));
  t.after(() => fs.rm(dir,{ recursive:true, force:true }));
  await atomicJson(path.join(dir,'seed','overtime.json'), config);
  let now = 0;
  const machine = await new OvertimeMachine(dir,{ seedDir:path.join(dir,'seed'), clock:() => now }).init();
  return { dir, machine, advance:ms => now += ms };
}

test('加班机外观：默认值、颜色 / 不透明度 / 下班文字的校验', () => {
  assert.deepEqual(normalizeLook(), { background:'#526e82', opacity:93, text_color:'#fff8e7', done_text:'下班！' });
  assert.deepEqual(normalizeLook({ background:'#FF00AA', opacity:0, text_color:'#000000', done_text:'  今天到此为止  ' }), { background:'#ff00aa', opacity:0, text_color:'#000000', done_text:'今天到此为止' });
  for (const bad of [{ background:'red' }, { text_color:'#12345' }, { opacity:-1 }, { opacity:101 }, { opacity:50.5 }, { opacity:'50' }, { done_text:'' }, { done_text:'   ' }, { done_text:'字'.repeat(21) }, { done_text:5 }, null, []])
    assert.throws(() => normalizeLook(bad), undefined, JSON.stringify(bad));
  assert.equal(normalizeLook({ done_text:'🎉'.repeat(20) }).done_text.length, 40, '按字数算，不按编码长度');
});

test('保存外观不影响倒计时；改时间设置、导入旧配置都保留外观；重启后还在', async t => {
  const { dir, machine, advance } = await fixture(t);
  assert.deepEqual(machine.snapshot().config.look, normalizeLook(), '旧存档没有外观时用默认值');
  await machine.action({ action:'start' }); advance(90_000);
  const before = machine.snapshot();
  const after = await machine.action({ action:'look', look:{ background:'#000000', opacity:0, text_color:'#ffd34a', done_text:'收工啦' } });
  assert.equal(after.mode, 'running'); assert.equal(after.remaining, before.remaining);
  assert.deepEqual(after.config.look, { background:'#000000', opacity:0, text_color:'#ffd34a', done_text:'收工啦' });
  await assert.rejects(machine.action({ action:'look', look:{ done_text:'' } }), /下班文字/);
  assert.equal(machine.snapshot().config.look.done_text, '收工啦', '保存失败不改原来的外观');
  await machine.action({ action:'pause' });
  await machine.action({ action:'configure', config:{ ...config, initial_text:'30' } });
  assert.equal(machine.snapshot().config.look.done_text, '收工啦', '改时间设置不丢外观');
  const restored = await new OvertimeMachine(dir,{ seedDir:path.join(dir,'seed') }).init();
  assert.equal(restored.snapshot().config.look.text_color, '#ffd34a');
});
