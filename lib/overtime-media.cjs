const fs = require('node:fs/promises');
const { createReadStream, constants } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');

const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
const MEDIA_ID = /^[a-f0-9]{64}\.(png|jpg|gif|webp|mp4|webm)$/;
const TYPES = { png:'image/png', jpg:'image/jpeg', gif:'image/gif', webp:'image/webp', mp4:'video/mp4', webm:'video/webm' };
function mediaType(head) {
  if (head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (head[0]===255 && head[1]===216 && head[2]===255) return 'jpg';
  if (['GIF87a','GIF89a'].includes(head.toString('ascii',0,6))) return 'gif';
  if (head.toString('ascii',0,4)==='RIFF' && head.toString('ascii',8,12)==='WEBP') return 'webp';
  if (head.toString('ascii',4,8)==='ftyp' && ['isom','iso2','iso5','iso6','mp41','mp42','avc1','M4V ','MSNV','dash'].includes(head.toString('ascii',8,12))) return 'mp4';
  if (head.subarray(0,4).equals(Buffer.from([26,69,223,163])) && head.includes(Buffer.from('webm'))) return 'webm';
  throw new Error('请选择PNG、JPG、GIF、WebP图片或MP4、WebM视频');
}
function normalizeMedia(input) {
  if (!input || typeof input !== 'object' || !MEDIA_ID.test(input.asset || '') || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('素材信息无效，请重新选择文件');
  const kind = TYPES[path.extname(input.asset).slice(1)].startsWith('video/') ? 'video' : 'image';
  const duration = Number(input.duration ?? 5);
  if (!Number.isFinite(duration) || duration < 0.1 || duration > (kind === 'video' ? 600 : 120)) throw new Error(kind === 'video' ? '视频最长10分钟' : '图片显示时间须在0.1到120秒之间');
  if (input.green_screen !== undefined && typeof input.green_screen !== 'boolean') throw new Error('绿幕设置无效');
  return { asset:input.asset, name:input.name.trim(), kind, duration, green_screen:kind === 'video' && input.green_screen !== false };
}
async function uploadMedia(request, dataDir, name) {
  if (!name || name.length > 100) throw new Error('素材文件名无效');
  if (Number(request.headers?.['content-length']) > MAX_MEDIA_BYTES) { const error = new Error('素材文件最大200MB'); error.status = 413; throw error; }
  const dir = path.join(dataDir,'overtime-media'); await fs.mkdir(dir,{recursive:true});
  const temp = path.join(dir,randomUUID()+'.tmp'), file = await fs.open(temp,'wx');
  const hash = createHash('sha256'); let size = 0, head = Buffer.alloc(0), extension;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_MEDIA_BYTES) { const error = new Error('素材文件最大200MB'); error.status = 413; throw error; }
      if (head.length < 512) head = Buffer.concat([head,chunk.subarray(0,512-head.length)]);
      hash.update(chunk); await file.writeFile(chunk);
    }
    extension = mediaType(head);
    await file.close();
    const asset = hash.digest('hex')+'.'+extension;
    // 重新导入已有素材时刷新修改时间，避免它在保存规则前被当作旧素材清理。
    await fs.copyFile(temp,path.join(dir,asset),constants.COPYFILE_EXCL).catch(async error => { if (error.code !== 'EEXIST') throw error; const now = new Date(); await fs.utimes(path.join(dir,asset),now,now); });
    return { asset, name, kind:TYPES[extension].startsWith('video/') ? 'video' : 'image', bytes:size };
  } finally { await file.close().catch(()=>{}); await fs.unlink(temp).catch(()=>{}); }
}
async function serveMedia(request, response, dataDir, asset) {
  if (!MEDIA_ID.test(asset)) throw new Error('素材地址无效');
  const file = path.join(dataDir,'overtime-media',asset), {size} = await fs.stat(file);
  let start = 0, end = size - 1, partial = false;
  if (request.headers.range) {
    const match = request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    if (match && (match[1] || match[2])) {
      if (!match[1]) { const suffix = Number(match[2]); start = suffix > 0 && Number.isSafeInteger(suffix) ? Math.max(0,size-suffix) : size; }
      else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]),size-1) : size-1; }
      partial = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start;
    }
    if (!partial) { response.writeHead(416,{'Content-Range':`bytes */${size}`}); response.end(); return; }
  }
  response.writeHead(partial ? 206 : 200, { 'Content-Type':TYPES[path.extname(asset).slice(1)], 'Content-Length':end-start+1, 'Accept-Ranges':'bytes', 'Cache-Control':'no-store', ...(partial ? {'Content-Range':`bytes ${start}-${end}/${size}`} : {}) });
  await pipeline(createReadStream(file,{start,end}),response);
}
module.exports = { normalizeMedia, uploadMedia, serveMedia, MAX_MEDIA_BYTES };
