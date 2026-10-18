const fs = require('node:fs/promises');
const path = require('node:path');
const { metadata, png, MAX_PACKAGE_BYTES } = require('../lib/templates.cjs');
const Layout = require('../public/noodle/layout.js');

(async () => {
  const root = path.join(__dirname, '..'), dir = path.join(root, 'templates', 'american-burger');
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  const assets = {}, paths = {};
  const sources = [...JSON.parse(await fs.readFile(path.join(dir, 'sources.json'), 'utf8')),...JSON.parse(await fs.readFile(path.join(dir, 'sources-v1.0.1.json'), 'utf8')),...JSON.parse(await fs.readFile(path.join(dir, 'sources-v1.0.3.json'), 'utf8'))];
  for (const { key, path: source } of sources) {
    const file = path.join(dir, 'assets', key === 'counter' ? 'counter-v2.png' : key + '.png');
    if (!await fs.access(file).then(() => true, () => false)) await fs.copyFile(source, file);
    const slot = key === 'burger' ? 'bowl' : key;
    assets[slot] = (await fs.readFile(file)).toString('base64'); png(assets[slot]);
    paths[slot] = 'assets/' + path.basename(file);
  }
  const manifest = metadata({ format:'xiaoluobo-template', schema:1, name:'美式汉堡店', version:'1.0.3', workflow:'burger', dish_name:'美式汉堡', cook_seconds:4, sign:{top:'',title:'美式汉堡店',bottom:''}, layout:structuredClone(Layout.defaults) });
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({...manifest, assets:paths}, null, 2) + '\n');
  const data = JSON.stringify({...manifest, assets});
  if (Buffer.byteLength(data) > MAX_PACKAGE_BYTES) throw new Error('汉堡模板超过导入限制');
  const file = path.join(root, 'artifacts', '美式汉堡店-v1.0.3.luobo');
  await fs.writeFile(file, data); console.log(file + ' (' + (Buffer.byteLength(data)/1024/1024).toFixed(1) + ' MB)');
})().catch(error => { console.error(error); process.exitCode = 1; });
