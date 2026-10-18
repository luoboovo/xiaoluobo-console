const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function atomicJson(file, data, { compact = false } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, compact ? JSON.stringify(data) : JSON.stringify(data, null, 2));
    await fs.rename(temp, file);
  } catch (error) {
    // A failed write must not leave half-written temp files next to the save.
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`无法读取 ${path.basename(file)}，原文件已保留`);
  }
}

module.exports = { atomicJson, readJson };
