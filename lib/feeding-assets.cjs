const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const types={png:'image/png',jpg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',m4a:'audio/mp4'};
function assetType(body){
  if(body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'png';
  if(body[0]===255&&body[1]===216&&body[2]===255)return 'jpg';
  if(['GIF87a','GIF89a'].includes(body.toString('ascii',0,6)))return 'gif';
  if(body.toString('ascii',0,4)==='RIFF')return body.toString('ascii',8,12)==='WEBP'?'webp':body.toString('ascii',8,12)==='WAVE'?'wav':'';
  if(body.toString('ascii',0,2)==='BM')return 'bmp';
  if(body.toString('ascii',0,3)==='ID3'||body[0]===255&&(body[1]&224)===224)return 'mp3';
  if(body.toString('ascii',0,4)==='OggS')return 'ogg';
  if(body.toString('ascii',4,8)==='ftyp')return 'm4a';
  return '';
}
async function saveAsset(dir,body){
  const ext=assetType(body);
  if(!ext||body.length>16*1024*1024)throw new Error('请选择PNG、JPG、GIF、WebP、BMP图片或WAV、MP3、OGG、M4A音频，单个不超过16MB');
  const name=createHash('sha256').update(body).digest('hex')+'.'+ext;
  await fs.mkdir(path.join(dir,'feeding-assets'),{recursive:true});await fs.writeFile(path.join(dir,'feeding-assets',name),body);
  return '/api/feeding/assets/'+name;
}
async function uploadAsset(req,dir){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16*1024*1024)throw new Error('素材不能超过16MB');chunks.push(chunk);}return {url:await saveAsset(dir,Buffer.concat(chunks))};}
async function serveAsset(res,dir,name){const body=await fs.readFile(path.join(dir,'feeding-assets',name));res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)],'Cache-Control':'public, max-age=86400'});res.end(body);}
module.exports={saveAsset,uploadAsset,serveAsset};
