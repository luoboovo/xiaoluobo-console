const path = require('node:path');
const fs = require('node:fs/promises');
const { ConsoleServices } = require('../lib/services.cjs');

(async () => {
  const seedDir = path.join(__dirname, '..', 'data');
  await fs.mkdir(seedDir, { recursive: true });
  const services = await new ConsoleServices({ dataDir: seedDir, seedDir }).init();
  const result = await services.syncGifts();
  console.log(`已保存 ${result.count} 种 B 站礼物，${result.failed} 张图片待重试`);
  if (result.failed) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
