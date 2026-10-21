const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {PNG}=require('node:module').createRequire(require.resolve('qrcode'))('pngjs');
const {createImageRenderer,imageEdge}=require('../lib/render-images.cjs');
const {startServer}=require('../server.cjs');
function png(width,height,red=180){const image=new PNG({width,height});for(let i=0;i<image.data.length;i+=4){image.data[i]=red;image.data[i+1]=40;image.data[i+2]=20;image.data[i+3]=i%8?128:255;}return PNG.sync.write(image);}
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-render-'));t.after(async()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-render-'));await fs.rm(dir,{recursive:true,force:true});});return dir;}

test('显示副本按用途缩小，透明度和原图保留，并发去重、磁盘复用及更新淘汰',async t=>{
  const dir=await fixture(t),source=path.join(dir,'original.png'),cache=path.join(dir,'cache'),errors=[];
  const renderer=createImageRenderer(error=>errors.push(error.message));t.after(()=>renderer.close());
  const original=png(320,160);await fs.writeFile(source,original);
  const copies=await Promise.all(Array.from({length:8},()=>renderer.get(source,64,cache)));
  assert.ok(copies.every(copy=>copy.equals(copies[0])));const image=PNG.sync.read(copies[0]);assert.equal(image.width,64);assert.equal(image.height,32);assert.ok(image.data[3]>0&&image.data[3]<255);
  assert.deepEqual(await fs.readFile(source),original);assert.equal((await fs.readdir(cache)).length,1);
  const second=createImageRenderer();t.after(()=>second.close());assert.deepEqual(await second.get(source,64,cache),copies[0]);
  await fs.writeFile(source,png(320,160,30));const future=new Date(Date.now()+2000);await fs.utimes(source,future,future);
  const updated=await renderer.get(source,64,cache);assert.equal(PNG.sync.read(updated).data[0],30);assert.equal((await fs.readdir(cache)).length,1);
  assert.deepEqual(await renderer.get(source,Infinity,cache),await fs.readFile(source));assert.deepEqual(errors,[]);
});

test('图片处理错误和关闭时回退原图，后续有效图片仍可处理',async t=>{
  const dir=await fixture(t),file=path.join(dir,'bad.png'),errors=[],renderer=createImageRenderer(error=>errors.push(error.message));t.after(()=>renderer.close());
  const invalid=png(200,100).subarray(0,33);await fs.writeFile(file,invalid);
  assert.deepEqual(await renderer.get(file,64,path.join(dir,'cache')),invalid);assert.equal(errors.length,1);
  await fs.writeFile(file,png(200,100));assert.equal(PNG.sync.read(await renderer.get(file,64,path.join(dir,'cache'))).width,64);
  await renderer.close();assert.deepEqual(await renderer.get(file,64,path.join(dir,'cache')),await fs.readFile(file));
});

test('关闭与并发缩图交叠时释放线程，读取方仍收到完整原图',async t=>{
  const dir=await fixture(t),file=path.join(dir,'source.png'),original=png(320,160),renderer=createImageRenderer();
  await fs.writeFile(file,original);const reading=Promise.all(Array.from({length:4},()=>renderer.get(file,64,path.join(dir,'cache'))));
  await renderer.close();assert.ok((await reading).every(bytes=>bytes.equals(original)));
});

test('模板显示图与缩略图减小像素，背景、旧素材接口与导出完整保留',async t=>{
  const dir=await fixture(t),runtime=await startServer({dataDir:dir});t.after(()=>runtime.close());
  const original=png(900,600),background=png(1600,900),input={format:'xiaoluobo-template',schema:1,name:'缩图测试',version:'1.0.0',workflow:'mix',dish_name:'面',assets:{pot:original.toString('base64'),sauce:original.toString('base64'),bowl:original.toString('base64'),background:background.toString('base64')}};
  const template=await runtime.noodle.templates.install(input),fetchBytes=async url=>{const response=await fetch(runtime.url+url);assert.equal(response.status,200);return Buffer.from(await response.arrayBuffer());};
  assert.equal(PNG.sync.read(await fetchBytes(template.assets.bowl)).width,512);
  const thumbnail=runtime.noodle.templates.list().find(item=>item.id===template.id).image;assert.equal(PNG.sync.read(await fetchBytes(thumbnail)).width,128);
  assert.deepEqual(await fetchBytes(template.assets.background),background);assert.deepEqual(await fetchBytes('/api/templates/'+template.id+'/assets/bowl.png'),original);
  assert.deepEqual((await runtime.noodle.templates.export(template.id)).assets,input.assets);
  const resumed=await new (require('../lib/templates.cjs').TemplateLibrary)(dir).init();assert.equal(resumed.get(template.id).assets.bowl,template.assets.bowl);
  assert.equal(imageEdge('bowl'),512);assert.equal(imageEdge('pot'),768);assert.equal(imageEdge('counter'),Infinity);
  assert.equal((await fetch(runtime.url+'/api/templates/'+template.id+'/render/missing.png')).status,400);
  const asset=await require('../lib/feeding-assets.cjs').saveAsset(runtime.feeding.dir,original);
  assert.deepEqual(await fetchBytes(asset),original);assert.equal(PNG.sync.read(await fetchBytes(asset.replace('/assets/','/thumb/'))).width,128);
  assert.equal(PNG.sync.read(await fetchBytes('/feeding/thumb/mouse_rice/mouse.png')).width,128);
});
