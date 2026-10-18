const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { startServer } = require('../server.cjs');

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-performance-'));
  let app, reader, reading;
  const frames = {}, collect = () => { global.gc?.(); const m = process.memoryUsage(); return { heapMiB: +(m.heapUsed / 1048576).toFixed(2), rssMiB: +(m.rss / 1048576).toFixed(2) }; };
  try {
    app = await startServer({ dataDir: dir, seedDir: path.join(__dirname, '..', 'data') });
    app.noodle.mode = 'running'; app.noodle.enqueue('保留的排队顾客', 2000, 1); app.noodle.balance = 7; app.noodle.tip(2);
    const response = await fetch(app.url + '/api/events?console=1');
    reader = response.body.getReader();
    reading = (async () => {
      let carry = '';
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          carry += Buffer.from(chunk.value).toString('utf8');
          let boundary;
          while ((boundary = carry.indexOf('\n\n')) >= 0) {
            const frame = carry.slice(0, boundary); carry = carry.slice(boundary + 2);
            const type = frame.match(/^event: (.+)$/m)?.[1]; if (type) frames[type] = (frames[type] || 0) + 1;
          }
        }
      } catch { frames.disconnected = true; }
    })();
    await new Promise(resolve => setTimeout(resolve, 150));
    const start = collect(), rounds = [], begin = performance.now();
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 5000; i++) {
        const id = round * 5000 + i;
        app.services.addEvent('chat', '模拟观众' + id, '模拟持续弹幕 ' + '消息内容'.repeat(20), { uid: id + 1, face: i % 2 ? 'https://i0.hdslb.com/bfs/face-' + (id % 10000) + '.png' : '' });
      }
      const burst = collect();
      await new Promise(resolve => setTimeout(resolve, 150));
      rounds.push({ round: round + 1, burst, settled: collect() });
    }
    assert.equal(app.services.state.stats.chat, 50000);
    assert.equal(app.services.events.length, 200);
    assert.equal(app.noodle.queue.length, 2000);
    assert.equal(app.noodle.balance, 7);
    assert.equal(app.noodle.objects.filter(o => o.kind === 'coin').length, 2);
    assert.ok(app.noodle.faces.size <= 2000);
    const report = { version: require('../package.json').version, chats: 50000, elapsedMs: Math.round(performance.now() - begin), start, rounds, end: collect(), frames, retainedEvents: app.services.events.length, avatarAddresses: app.noodle.faces.size, queuedCustomers: app.noodle.queue.length };
    const target = process.argv[2];
    if (target) await fs.writeFile(path.resolve(target), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await reader?.cancel().catch(() => {}); await reading; await app?.close();
    if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'luobo-performance-')) throw new Error('清理路径无效');
    await fs.rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
