const fs=require('node:fs/promises');
const path=require('node:path');
const {metadata,png,MAX_PACKAGE_BYTES}=require('../lib/templates.cjs');
const Layout=require('../public/noodle/layout.js');
const Food=require('../public/noodle/stir-fry-food.js');

(async()=>{
  const root=path.join(__dirname,'..'),dir=path.join(root,'templates','mala-xiangguo'),assets={};
  for(const key of ['background','ingredient_sheet','cabinet','fridge','counter','tray','cola','iced_tea','pot','bowl_stack','bowl_empty',...Food.bowlAssets,'sesame','scallions','cilantro','portion_sesame','portion_scallions','portion_cilantro','trash']){
    assets[key]=(await fs.readFile(path.join(dir,'assets',key+'.png'))).toString('base64');png(assets[key]);
  }
  const layout=structuredClone(Layout.defaults);
  Object.assign(layout.stations.noodles,{side:'right',x:289,y:71,scale:.7});
  Object.assign(layout.stations.bowl,{side:'left',x:-54,y:-13,scale:.8});
  Object.assign(layout.stations.sauce,{x:-313,y:182,scale:.9});
  Object.assign(layout.props.cash,{x:-674,y:-36,scale:.9});
  Object.assign(layout.props.tray,{x:-103,y:0,scale:.8});
  for(const key of ['scallions','cilantro'])Object.assign(layout.props[key],{x:-313,y:182,scale:.9});
  const manifest=metadata({format:'xiaoluobo-template',schema:1,name:'麻辣香锅',version:'1.0.4',workflow:'stir-fry',dish_name:'麻辣香锅',cook_seconds:4,sign:{top:'',title:'麻辣香锅',bottom:''},layout});
  await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({...manifest,assets:Object.fromEntries(Object.keys(assets).map(key=>[key,'assets/'+key+'.png']))},null,2)+'\n');
  const data=JSON.stringify({...manifest,assets});if(Buffer.byteLength(data)>MAX_PACKAGE_BYTES)throw new Error('模板文件超过导入限制');
  const file=path.join(root,'artifacts','麻辣香锅-v1.0.4.luobo');await fs.writeFile(file,data);
  console.log(file+' ('+(Buffer.byteLength(data)/1024/1024).toFixed(1)+' MB)');
})().catch(error=>{console.error(error);process.exitCode=1;});
