const fs=require('node:fs/promises');
const path=require('node:path');
const {startServer}=require('../server.cjs');

(async()=>{
  const dataDir=path.join(__dirname,'..','artifacts','.template-design-data-v3');
  const app=await startServer({port:3183,dataDir});
  const source=JSON.parse(await fs.readFile(path.join(__dirname,'..','artifacts','刀削面馆-v1.0.1.luobo'),'utf8'));
  const template=await app.noodle.templates.install(source);
  let shop=app.noodle.presets.find(p=>p.config.template_id===template.id);
  if(shop)await app.noodle.action({action:'preset_use',id:shop.id});
  else await app.noodle.action({action:'preset_create',name:'刀削面馆',template_id:template.id});
  app.noodle.mode='running';
  const rule=app.services.gifts.gifts?.find(g=>g.name==='粉丝团灯牌') || (Array.isArray(app.services.gifts)?app.services.gifts.find(g=>g.name==='粉丝团灯牌'):null);
  if(rule){app.noodle.config.gift_id=rule.id;app.noodle.config.gift_name=rule.name;}
  ['面馆常客','来碗热面'].forEach((name,i)=>app.noodle.enqueue(name,1,i+1));
  app.noodle.objects=[{id:1,kind:'bowl',x:490,y:465,noodles:1,sauce:0,scallions:true,cilantro:false},{id:2,kind:'bowl',x:630,y:465,noodles:1,sauce:0,scallions:false,cilantro:true}];
  app.noodle.serial=2;app.noodle.revision++;app.noodle.publish();
  console.log('设计预览 '+app.url+'/#presets');
  process.on('SIGINT',async()=>{await app.close();process.exit();});
})().catch(error=>{console.error(error.message);process.exitCode=1;});
