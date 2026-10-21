const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {pruneAssets,assetNames} = require('../lib/asset-cleanup.cjs');
const {cacheKey} = require('../lib/render-images.cjs');

async function directory(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-prune-'));
  t.after(async()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-prune-'));await fs.rm(dir,{recursive:true,force:true});});
  return dir;
}
const hash=c=>c.repeat(64);
async function put(file,age) {
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'x');
  const time=new Date(Date.now()-age);await fs.utimes(file,time,time);
}

test('素材清理：只删除超过保留期且没有被当前设置引用的上传素材',async t=>{
  const dir=await directory(t),old=2*60*60*1000;
  const media=path.join(dir,'overtime-media'),assets=path.join(dir,'feeding-assets');
  await put(path.join(media,hash('a')+'.mp4'),old);
  await put(path.join(media,hash('b')+'.mp4'),old);
  await put(path.join(media,hash('c')+'.png'),60*1000);
  await put(path.join(media,'0b4f3c1e-0000-4000-8000-000000000000.tmp'),old);
  await put(path.join(media,'readme.txt'),old);
  await put(path.join(assets,hash('d')+'.png'),old);
  await put(path.join(assets,hash('e')+'.mp3'),old);
  await put(path.join(assets,hash('f')+'.png'),old);
  const thumb=path.join(assets,'.render',cacheKey(path.join(assets,hash('e')+'.mp3'),128)+'_1234.png'),kept=path.join(assets,'.render',cacheKey(path.join(assets,hash('d')+'.png'),128)+'_1234.png');
  await put(thumb,old);await put(kept,old);
  const used=assetNames({config:{gift_rules:[{operation:'media',media:{asset:hash('a')+'.mp4'}}]},remaining:1n},{config:{food_images:['/api/feeding/assets/'+hash('d')+'.png'],sounds:{eat:'/api/feeding/thumb/'+hash('f')+'.png'}}});

  assert.deepEqual(await pruneAssets(dir,used),{removed:3,bytes:3});
  assert.deepEqual((await fs.readdir(media)).sort(),[hash('a')+'.mp4',hash('c')+'.png','readme.txt']);
  assert.deepEqual((await fs.readdir(assets)).sort(),['.render',hash('d')+'.png',hash('f')+'.png']);
  assert.deepEqual(await fs.readdir(path.join(assets,'.render')),[path.basename(kept)]);
  assert.deepEqual(await pruneAssets(dir,used,{now:Date.now()+old}),{removed:1,bytes:1});
});

test('素材清理：没有素材目录时不报错',async t=>{
  assert.deepEqual(await pruneAssets(await directory(t),assetNames({})),{removed:0,bytes:0});
});
