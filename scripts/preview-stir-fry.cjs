const fs=require('node:fs/promises'),path=require('node:path');
const {startServer}=require('../server.cjs');
const {DEFAULTS}=require('../lib/noodle/config.cjs');
(async()=>{
  const app=await startServer({port:3184,dataDir:path.join(__dirname,'..','work','stir-fry-preview'),seedDir:path.join(__dirname,'..','data')});
  const input=JSON.parse(await fs.readFile(path.join(__dirname,'..','artifacts','麻辣香锅-v1.0.4.luobo'),'utf8'));
  const template=await app.noodle.templates.install(input);
  const preset=app.noodle.presets.find(p=>p.config.template_id===template.id || p.name==='麻辣香锅预览');
  if(preset && preset.config.template_id!==template.id)await app.noodle.savePresets(app.noodle.presets.map(p=>p.id===preset.id?{...p,config:{...p.config,template_id:template.id,sign:template.sign,layout:template.layout,cook_seconds:template.cook_seconds}}:p),preset.id);
  await app.noodle.action(preset?{action:'preset_use',id:preset.id}:{action:'preset_create',name:'麻辣香锅预览',template_id:template.id});
  const config=app.noodle.config;
  await app.noodle.action({action:'save',config:{...config,water_gift:config.water_gift??DEFAULTS.water_gift,throw_gifts:Object.fromEntries(['leaf','egg'].map(kind=>[kind,config.throw_gifts[kind]??DEFAULTS.throw_gifts[kind]]))}});
  await app.noodle.action({action:'start'});
  console.log(app.url+'/noodle/');
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.close().then(()=>process.exit()));
})().catch(error=>{console.error(error);process.exitCode=1;});
