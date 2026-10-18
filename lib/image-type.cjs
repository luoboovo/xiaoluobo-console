const PNG = Buffer.from([137,80,78,71,13,10,26,10]);

// Sniff the real format from magic bytes; remote URLs and file names are not trusted.
function imageType(body) {
  if (!Buffer.isBuffer(body)) return '';
  if (body.subarray(0,8).equals(PNG)) return 'image/png';
  if (body[0] === 255 && body[1] === 216 && body[2] === 255) return 'image/jpeg';
  if (['GIF87a','GIF89a'].includes(body.toString('ascii',0,6))) return 'image/gif';
  if (body.toString('ascii',0,4) === 'RIFF' && body.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  return '';
}

module.exports = { imageType };
