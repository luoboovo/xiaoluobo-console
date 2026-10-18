const fs=require('node:fs/promises');
const path=require('node:path');
const {metadata,png,MAX_PACKAGE_BYTES}=require('../lib/templates.cjs');
const Layout=require('../public/noodle/layout.js');

async function createTemplate() {
  const root=path.join(__dirname,'..'), assets={};
  for(const key of ['background','dough','pot','pot_empty','raw','bowl','scallions','cilantro']) {
    const bytes=await fs.readFile(path.join(root,'templates','daoxiao','assets',key+'.png'));
    assets[key]=bytes.toString('base64');png(assets[key]);
  }
  const layout=structuredClone(Layout.defaults);
  layout.modules.counter={x:210,y:240,scale:.67,visible:true};
  layout.props.trash.y=110;
  layout.props.fridge={x:-150,y:130,scale:1.25};
  layout.props.tray={x:0,y:8,scale:.86};
  layout.props.dough={x:694,y:95,scale:.8};
  layout.props.scallions={x:-145,y:7,scale:1};
  layout.props.cilantro={x:-145,y:7,scale:1};
  layout.props.cash={x:125,y:-28,scale:1};
  Object.assign(layout.stations.noodles,{x:110,y:45,scale:.85});
  Object.assign(layout.stations.bowl,{x:-100,y:-60,scale:.95});
  const manifest=metadata({format:'xiaoluobo-template',schema:1,name:'刀削面馆',version:'1.0.1',workflow:'knife-noodles',dish_name:'刀削面',cook_seconds:5,sign:{top:'',title:'刀削面馆',bottom:''},layout});
  await fs.writeFile(path.join(root,'templates','daoxiao','manifest.json'),JSON.stringify({...manifest,assets:Object.fromEntries(Object.keys(assets).map(key=>[key,'assets/'+key+'.png']))},null,2));
  const data=JSON.stringify({...manifest,assets});
  if(Buffer.byteLength(data)>MAX_PACKAGE_BYTES)throw new Error('模板文件超过导入限制');
  const output=path.join(root,'artifacts','刀削面馆-v1.0.1.luobo');
  await fs.writeFile(output,data);console.log(output);
}
createTemplate().catch(error=>{console.error(error.message);process.exitCode=1;});
