const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const Layout = require('../public/noodle/layout.js');
const Sign = require('../public/noodle/sign.js');
const {imageEdge}=require('./render-images.cjs');

const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const SLOTS = ['background','counter','pot','pot_empty','sauce','sauce_empty','fridge_empty','dough_empty','condiment_empty','seal','evil_bowl','bowl','bowl_empty','bowl_stack','bowl_noodles','bowl_sauce','portion_noodles','portion_sauce','raw','cooked','portion_scallions','portion_cilantro','dough','knife','ladle','scallions','cilantro','water','fridge','trash','cash','coin','leaf','egg','egg_splat','tray'];
SLOTS.push('coffee_machine','jasmine','portion_jasmine','milk','cup_empty','cup_coffee','cup_jasmine','cup_latte','cup_milk','cup_coffee_milk');
SLOTS.push('ingredient_sheet','sesame','cabinet','cola','iced_tea','portion_sesame');
SLOTS.push('bowl_sesame','bowl_scallions','bowl_sesame_scallions','bowl_cilantro','bowl_sesame_cilantro','bowl_scallions_cilantro','bowl_all');
SLOTS.push('griddle','oven','bun_raw','bun_bottom','bun_top','patty_raw','patty_cooked','tomato','lettuce','cheese','mustard','mustard_layer');
SLOTS.push('dirty_burger','cockroach_burger','cockroach','cockroach_walk');
SLOTS.push('ketchup','salad','mayo','ketchup_layer','salad_layer','mayo_layer');
const SHARED = { counter:'counter', bowl_empty:'bowl-empty', bowl_stack:'bowl-stack', bowl_noodles:'bowl-noodles', bowl_sauce:'bowl-sauce', portion_noodles:'portion-noodles', portion_sauce:'portion-sauce', water:'mineral-water', fridge:'water-fridge', trash:'trash-bin', cash:'cash-box', coin:'payment-coin', leaf:'throw-leaf', egg:'throw-egg', egg_splat:'egg-splat', tray:'bowl-area' };
Object.assign(SHARED, {pot_empty:'pot-empty',sauce_empty:'sauce-empty',fridge_empty:'fridge-empty',dough_empty:'board-empty',condiment_empty:'condiment-empty',seal:'shop-seal',evil_bowl:'evil-noodles'});
Object.assign(SHARED, {cooked:'portion-cooked',portion_scallions:'portion-scallions',portion_cilantro:'portion-cilantro'});
Object.assign(SHARED,{portion_sesame:'portion-sesame'});
Object.assign(SHARED,{dirty_burger:'dirty-burger',cockroach_burger:'cockroach-burger',cockroach:'cockroach',cockroach_walk:'cockroach-walk'});
const sharedAssets = Object.fromEntries(Object.entries(SHARED).map(([key,file])=>[key,`/noodle/${imageEdge(key)<Infinity?'render':'assets'}/${file}.png`]));
const BUILTIN = { id:'saozi', name:'臊子面馆', version:'1.0.0', workflow:'mix', dish_name:'臊子面', cook_seconds:5, sign:{top:'',title:'臊子面馆',bottom:''}, layout:Layout.defaults, assets:{...sharedAssets,pot:'/noodle/render/pot.png',sauce:'/noodle/render/sauce.png',bowl:'/noodle/render/bowl.png'} };

function metadata(input) {
  if (!input || input.format !== 'xiaoluobo-template' || input.schema !== 1) throw new Error('请选择小萝卜模板文件（.luobo）');
  const text = (value,max,label) => { if(typeof value !== 'string' || !value.trim() || value.trim().length>max || /[\u0000-\u001f]/.test(value)) throw new Error(label+'无效'); return value.trim(); };
  if (!['mix','knife-noodles','jasmine-latte','stir-fry','burger'].includes(input.workflow)) throw new Error('此模板玩法尚不受支持');
  if (typeof input.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(input.version)) throw new Error('模板版本无效');
  const name=text(input.name,16,'模板名称'), dish_name=text(input.dish_name,12,'商品名称');
  const cook_seconds=input.cook_seconds ?? 5;
  if (!Number.isInteger(cook_seconds) || cook_seconds<1 || cook_seconds>60) throw new Error('煮面时间需为 1–60 秒');
  return {format:'xiaoluobo-template',schema:1,name,version:input.version,workflow:input.workflow,dish_name,cook_seconds,sign:Sign.validate(input.sign ?? {top:'',title:name,bottom:''}),layout:Layout.validate(input.layout ?? Layout.defaults)};
}
function assetSlots(assets,workflow) {
  if (!assets || typeof assets!=='object' || Array.isArray(assets) || Object.keys(assets).some(key=>!SLOTS.includes(key))) throw new Error('模板素材配置无效');
  const required=workflow==='stir-fry'?['background','ingredient_sheet','pot','bowl','sesame','scallions','cilantro','portion_scallions','portion_cilantro','trash']:workflow==='jasmine-latte'?['background','coffee_machine','jasmine','portion_jasmine','milk','cup_empty','cup_coffee','cup_jasmine','cup_latte','bowl']:workflow==='knife-noodles'?['background','dough','pot','raw','bowl','scallions','cilantro']:['pot','sauce','bowl'];
  if(workflow!=='burger' && required.some(key=>!assets[key])) throw new Error('模板缺少背景、锅具或玩法素材');
  if(workflow==='burger' && ['background','counter','tray','bowl','griddle','oven','bun_raw','bun_bottom','bun_top','patty_raw','patty_cooked','tomato','lettuce','cheese','mustard','mustard_layer'].some(key=>!assets[key])) throw new Error('模板缺少汉堡制作素材');
  return Object.keys(assets).sort();
}
function png(data) {
  if(typeof data!=='string' || data.length>16*1024*1024 || data.length%4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('素材需为有效 PNG');
  const bytes=Buffer.from(data,'base64');
  if(bytes.toString('base64')!==data) throw new Error('素材需为有效 PNG');
  if(bytes.length<33 || bytes.length>12*1024*1024 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii',12,16)!=='IHDR') throw new Error('素材需为有效 PNG');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(!width || !height || width>4096 || height>4096 || width*height>16777216) throw new Error('PNG 尺寸需在 4096 × 4096 以内');
  return bytes;
}
class TemplateLibrary {
  constructor(dataDir) { this.dir=path.join(dataDir,'templates'); this.items=new Map([['saozi',BUILTIN]]); }
  async init() {
    await fs.mkdir(this.dir,{recursive:true});
    for(const entry of await fs.readdir(this.dir,{withFileTypes:true})) {
      if(entry.isDirectory() && /^\.remove-[a-f0-9-]{36}$/.test(entry.name)) {
        const target=path.resolve(this.dir,entry.name);
        if(path.dirname(target)!==path.resolve(this.dir))throw new Error('模板清理路径无效');
        await fs.rm(target,{recursive:true,force:true}).catch(()=>{});continue;
      }
      if(!entry.isDirectory() || !/^t-[a-f0-9]{32}$/.test(entry.name)) continue;
      const saved=JSON.parse(await fs.readFile(path.join(this.dir,entry.name,'manifest.json'),'utf8'));
      const info=metadata(saved),slots=assetSlots(saved.assets,info.workflow);
      if(slots.some(key=>saved.assets[key]!==key+'.png')) throw new Error('已安装模板素材记录无效，原文件已保留');
      this.items.set(entry.name,this.descriptor(entry.name,info,slots));
    }
    return this;
  }
  descriptor(id,info,slots) {
    const assets={...sharedAssets,...(info.workflow==='knife-noodles'?{pot_empty:'/noodle/render/knife-pot-empty.png'}:{}),...Object.fromEntries(slots.map(key=>[key,`/api/templates/${id}/${imageEdge(key)<Infinity?'render':'assets'}/${key}.png`]))};
    if(info.workflow==='burger') for(const kind of ['ketchup','salad','mayo']) {
      assets[kind] ??= '/noodle/render/'+kind+'.png';
      assets[kind+'_layer'] ??= '/noodle/assets/'+kind+'_layer.svg';
    }
    return {...info,id,assets};
  }
  get(id='saozi') { const item=this.items.get(id); if(!item) throw new Error('这个模板尚未安装，请重新导入'); return item; }
  list() { return [...this.items.values()].map(({id,name,version,workflow,dish_name,assets})=>({id,name,version,workflow,dish_name,image:assets.bowl.replace('/render/','/thumb/')})); }
  removable(id) {
    if(id==='saozi')throw new Error('基础模板需保留，不能删除');
    if(typeof id!=='string' || !/^t-[a-f0-9]{32}$/.test(id))throw new Error('模板编号无效');
    this.get(id);
    const target=path.resolve(this.dir,id);
    if(path.dirname(target)!==path.resolve(this.dir))throw new Error('模板删除路径无效');
    return target;
  }
  async remove(id) {
    const target=this.removable(id),trash=path.resolve(this.dir,'.remove-'+randomUUID());
    if(path.dirname(trash)!==path.resolve(this.dir))throw new Error('模板清理路径无效');
    await fs.rename(target,trash);
    this.items.delete(id);
    // A locked asset is no longer installed; retry its cleanup on the next launch.
    await fs.rm(trash,{recursive:true,force:true}).catch(()=>{});
  }
  async install(input) {
    const info=metadata(input),slots=assetSlots(input.assets,info.workflow),files=slots.map(key=>[key,png(input.assets[key])]);
    if(files.reduce((n,[,bytes])=>n+bytes.length,0)>48*1024*1024) throw new Error('模板素材总大小超过 48 MB');
    const hash=createHash('sha256').update(JSON.stringify(info)); for(const [key,bytes] of files)hash.update(key).update(bytes);
    const id='t-'+hash.digest('hex').slice(0,32);
    if(this.items.has(id)) return this.get(id);
    if(this.items.size>=51) throw new Error('最多安装 50 个外部模板');
    const staging=path.join(this.dir,'.install-'+randomUUID());
    await fs.mkdir(staging);
    try {
      for(const [key,bytes] of files) await fs.writeFile(path.join(staging,key+'.png'),bytes);
      await fs.writeFile(path.join(staging,'manifest.json'),JSON.stringify({...info,assets:Object.fromEntries(slots.map(key=>[key,key+'.png']))},null,2));
      await fs.rename(staging,path.join(this.dir,id));
    } catch(error) { if(!path.resolve(staging).startsWith(path.resolve(this.dir)+path.sep+'.install-'))throw new Error('模板清理路径无效');await fs.rm(staging,{recursive:true,force:true});throw error; }
    const item=this.descriptor(id,info,slots);this.items.set(id,item);return item;
  }
  assetFile(id,slot) {
    const item=this.get(id); if(id==='saozi' || !SLOTS.includes(slot) || !item.assets[slot]?.startsWith('/api/templates/')) throw new Error('模板素材不存在');
    return path.join(this.dir,id,slot+'.png');
  }
  async asset(id,slot) { return fs.readFile(this.assetFile(id,slot)); }
  async export(id) {
    const item=this.get(id),assets={};
    for(const [key,url] of Object.entries(item.assets)) {
      if(id!=='saozi' && !url.startsWith('/api/templates/')) continue;
      const bytes=id==='saozi'?await fs.readFile(path.join(__dirname,'..','public',url.replace('/render/','/assets/').slice(1))):await this.asset(id,key);
      assets[key]=bytes.toString('base64');
    }
    return {...metadata({format:'xiaoluobo-template',schema:1,...item}),assets};
  }
}
module.exports={TemplateLibrary,BUILTIN,MAX_PACKAGE_BYTES,metadata,png};
