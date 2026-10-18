const fs=require('node:fs/promises');
const path=require('node:path');
const {metadata,png,MAX_PACKAGE_BYTES}=require('../lib/templates.cjs');
const Layout=require('../public/noodle/layout.js');

(async()=>{
  const root=path.join(__dirname,'..'),dir=path.join(root,'templates','jasmine-cafe'),assets={};
  const keys=['background','counter','tray','trash','cash','bowl_stack','coffee_machine','jasmine','portion_jasmine','milk','cup_empty','cup_coffee','cup_jasmine','cup_latte','cup_milk','cup_coffee_milk','evil_bowl','egg','leaf','egg_splat'];
  for(const key of keys){assets[key]=(await fs.readFile(path.join(dir,'assets',key+'.png'))).toString('base64');png(assets[key]);}
  assets.bowl=assets.cup_latte;
  const layout=structuredClone(Layout.defaults);
  Object.assign(layout.modules.counter,{x:169,y:200,scale:.72});
  Object.assign(layout.stations.noodles,{x:944,y:4,scale:1.25});
  Object.assign(layout.stations.bowl,{x:-1058,y:27,scale:.85});
  Object.assign(layout.props.jasmine,{x:-701,y:1,scale:1.1});
  Object.assign(layout.props.milk,{x:-979,y:-16,scale:1.05});
  Object.assign(layout.props.tray,{x:25,y:0,scale:1});
  Object.assign(layout.props.trash,{x:-12,y:252,scale:.85});
  Object.assign(layout.props.cash,{x:-780,y:-48,scale:.9});
  const manifest=metadata({format:'xiaoluobo-template',schema:1,name:'茉莉咖啡厅',version:'1.0.2',workflow:'jasmine-latte',dish_name:'茉莉花拿铁',cook_seconds:2,sign:{top:'',title:'',bottom:''},layout});
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({...manifest,assets:Object.fromEntries(Object.keys(assets).map(key=>[key,'assets/'+(key==='bowl'?'cup_latte':key)+'.png']))},null,2)+'\n');
  const data=JSON.stringify({...manifest,assets});
  if(Buffer.byteLength(data)>MAX_PACKAGE_BYTES)throw new Error('模板文件超过导入限制');
  await fs.writeFile(path.join(root,'artifacts','茉莉咖啡厅-v1.0.2.luobo'),data);
  console.log('茉莉咖啡厅模板已保存：'+(Buffer.byteLength(data)/1024/1024).toFixed(1)+' MB');
})().catch(error=>{console.error(error);process.exitCode=1;});
