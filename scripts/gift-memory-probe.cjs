// Burst-gift memory probe: replays a realistic burst (gifts carry avatars, many viewers)
// through the real gift pipeline with live WebSocket clients attached, and reports
// batch count, bytes written to disk, bytes pushed to clients, time and heap/RSS peaks.
// Usage: node --expose-gc scripts/gift-memory-probe.cjs [count] [viewers] [historyPeople]
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {WebSocket} = require('ws');

// Count every save the engines make (atomicJson writes a temp file, then renames it).
let writes = 0, writeBytes = 0;
const writeFile = fs.writeFile;
fs.writeFile = async (file, data, ...rest) => {
  if (String(file).endsWith('.tmp')) { writes++; writeBytes += Buffer.byteLength(data); }
  return writeFile.call(fs, file, data, ...rest);
};
const { startServer } = require('../server.cjs');

const mib = bytes => Math.round(bytes / 1048576 * 10) / 10;

async function main() {
  const chatEvery = Number(process.env.CHAT_EVERY || 0);
  const count = Number(process.argv[2] || 3000), viewers = Number(process.argv[3] || 800), history = Number(process.argv[4] || 5000);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luobo-gift-memory-'));
  // A long stream has already collected many viewers in the overtime statistics.
  let app; const sockets = [];
  try {
    app = await startServer({ dataDir: dir, seedDir: path.join(__dirname, '..', 'data') });
    app.noodle.mode = 'running';
    app.noodle.config.gift_id = 90001;
    app.noodle.config.water_gift = null;
    app.overtime.clock = () => 0;
    await app.overtime.action({ action: 'configure', config: { initial_text:'60', time_unit:'分钟', gift_rules:[{gift_id:90001,gift_name:'压力礼物',operation:'add',value:1}] } });
    await app.overtime.action({ action: 'start' });
    if (history) app.overtime.state.people = Array.from({length:history}, (_, i) => ({key:'uid:' + (900000 + i), uid:900000 + i, user:'老观众' + i, simulated:false, face:'https://i0.hdslb.com/bfs/face/old' + i + '.jpg', added:'60', reduced:'0'}));
    let pushed = 0, frames = 0;
    for (const query of ['', '?console', '?scene', '?overtime', '?feeding']) {
      const ws = new WebSocket(app.url.replace('http', 'ws') + '/api/events/socket' + query, { headers: { Origin: app.url } });
      ws.on('message', data => { pushed += data.length; frames++; });
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      sockets.push(ws);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    let batches = 0;
    const receiveBatch = app.overtime.receiveBatch.bind(app.overtime);
    app.overtime.receiveBatch = (...args) => { batches++; return receiveBatch(...args); };
    global.gc?.(); global.gc?.();
    const base = process.memoryUsage();
    writes = 0; writeBytes = 0; pushed = 0; frames = 0;
    let heapPeak = base.heapUsed, rssPeak = base.rss, externalPeak = base.external + base.arrayBuffers;
    const sampler = setInterval(() => { const m = process.memoryUsage(); heapPeak = Math.max(heapPeak, m.heapUsed); rssPeak = Math.max(rssPeak, m.rss); externalPeak = Math.max(externalPeak, m.external + m.arrayBuffers); }, 5);
    const begin = performance.now();
    for (let i = 0; i < count; i++) {
      const uid = i % viewers + 1;
      const face = 'https://i0.hdslb.com/bfs/face/' + uid.toString(16).padStart(40, '0') + '.jpg';
      app.services.addGift({giftId:90001,giftName:'压力礼物',count:1,uid,user:'压力观众' + uid,face,transactionId:'burst-' + i});
      // Busy rooms interleave chat with gifts; chat is ordered with gifts, so it starts a new batch.
      if (chatEvery && i % chatEvery === 0) app.services.addEvent('chat', '压力观众' + uid, '冲冲冲', {uid, face});
    }
    const response = await fetch(app.url + '/api/overtime/action', {method:'POST',headers:{'Content-Type':'application/json','Origin':app.url},body:JSON.stringify({action:'pause'})});
    if (response.status !== 200) throw new Error('pause failed ' + response.status);
    const elapsedMs = Math.round(performance.now() - begin);
    await new Promise(resolve => setTimeout(resolve, 400));
    clearInterval(sampler);
    const state = app.overtime.snapshot();
    const report = {
      gifts: count, chatEvery, viewers, historyPeople: history,
      elapsedMs, overtimeBatches: batches,
      diskWrites: writes, diskWrittenMiB: mib(writeBytes),
      clientFrames: frames, clientPushedMiB: mib(pushed),
      heapPeakDeltaMiB: mib(heapPeak - base.heapUsed), rssPeakDeltaMiB: mib(rssPeak - base.rss), externalPeakDeltaMiB: mib(externalPeak - base.external - base.arrayBuffers),
      queue: app.noodle.queue.length, people: state.people.length, remaining: state.remaining,
    };
    console.log(JSON.stringify(report));
    if (process.env.PROBE_OUT) fsSync.writeFileSync(process.env.PROBE_OUT, JSON.stringify(report, null, 2));
  } finally {
    for (const ws of sockets) ws.terminate();
    await app?.close();
    await fs.rm(dir, {recursive:true,force:true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
