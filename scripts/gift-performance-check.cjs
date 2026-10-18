const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { startServer } = require('../server.cjs');

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-gift-performance-'));
  let app, timer;
  try {
    app = await startServer({ dataDir: dir, seedDir: path.join(__dirname, '..', 'data') });
    app.noodle.mode = 'running';
    app.noodle.config.gift_id = 90001;
    app.noodle.config.water_gift = null;
    app.overtime.clock = () => 0;
    await app.overtime.action({ action: 'configure', config: { initial_text:'60', time_unit:'分钟', gift_rules:[{gift_id:90001,gift_name:'压力礼物',operation:'add',value:1}] } });
    await app.overtime.action({ action: 'start' });
    const count = Number(process.env.GIFT_MESSAGES || 2000);
    let maxDelay = 0, previous = performance.now();
    timer = setInterval(() => { const now = performance.now(); maxDelay = Math.max(maxDelay, now - previous - 10); previous = now; }, 10);
    const begin = performance.now();
    for (let i = 0; i < count; i++) app.services.addGift({giftId:90001,giftName:'压力礼物',count:1,uid:i % 20 + 1,user:'压力观众' + (i % 20),transactionId:'burst-' + i});
    // Manual actions use the same queue as live gifts, so this measures how long controls stay blocked.
    const response = await fetch(app.url + '/api/overtime/action', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pause'})});
    assert.equal(response.status, 200);
    const state = (await response.json()).state;
    const elapsedMs = Math.round(performance.now() - begin);
    assert.equal(state.remaining, String(3600 + count * 60));
    assert.equal(state.people.reduce((sum, p) => sum + BigInt(p.added), 0n), BigInt(count) * 60n);
    assert.equal(app.noodle.queue.length, Math.min(count, 2000));
    assert.equal(app.services.state.stats.gift, count);
    assert.equal(state.history.length, Math.min(count, 200));
    const saved = JSON.parse(await fs.readFile(app.overtime.file, 'utf8'));
    assert.equal(saved.remaining, state.remaining);
    assert.equal(saved.seen.length, Math.min(count, 50000));
    const report = {messages:count,elapsedMs,maxEventLoopDelayMs:Math.round(maxDelay),queuedCustomers:app.noodle.queue.length,remaining:state.remaining,people:state.people.length};
    console.log(JSON.stringify(report));
    if (process.argv[2]) await fs.writeFile(path.resolve(process.argv[2]), JSON.stringify(report, null, 2));
    assert.ok(elapsedMs < 2000, `大量送礼阻塞操作 ${elapsedMs}ms，目标小于2000ms`);
    assert.ok(maxDelay < 250, `送礼阻塞事件循环 ${Math.round(maxDelay)}ms，目标小于250ms`);
  } finally {
    clearInterval(timer);
    await app?.close();
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'luobo-gift-performance-'));
    await fs.rm(dir, {recursive:true,force:true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
