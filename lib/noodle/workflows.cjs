const { randomUUID } = require('node:crypto');
const Layout = require('../../public/noodle/layout.js');

function cookAction(shop, input) {
    shop.checkRevision(input);
    shop.requireFood();
    const recipe=shop.template(); if(recipe.workflow!=='knife-noodles') throw new Error('当前面馆没有削面锅');
    const freeSpot=()=>[360,450,540,630,720,810].flatMap(x=>[420,490,550].map(y=>({x,y}))).find(p=>!shop.objects.some(o=>Math.hypot(o.x-p.x,o.y-p.y)<(o.kind==='bowl'?85:55)));
    if(input.action==='slice') {
      if(shop.objects.length>=500) throw new Error('请先清理台面');
      const spot=freeSpot();if(!spot)throw new Error('请先腾出放面的台面');
      shop.objects.push({id:++shop.serial,kind:'raw',...spot,noodles:0,sauce:0});
      shop.slice = { id: shop.serial, preset: shop.activePreset, at: Date.now() };
    } else if(input.action==='boil') {
      const raw=shop.objects.find(o=>o.id===input.object_id && o.kind==='raw');
      if(!raw) throw new Error('请把削好的生面放进锅');
      if(shop.cooking.length>=6) throw new Error('锅里最多煮 6 份面');
      shop.objects=shop.objects.filter(o=>o!==raw);
      if(shop.selected===raw.id)shop.selected=null;
      shop.cooking.push({id:raw.id,ready_at:Date.now()+shop.config.cook_seconds*1000});
    } else {
      const cooked=shop.cooking.find(batch=>Date.now()>=batch.ready_at); if(!cooked) throw new Error('面还没煮熟');
      if(shop.objects.length>=500)throw new Error('请先清理台面');
      const pot=Layout.stations(shop.config.layout).find(s=>s.kind==='noodles');
      const spot=Layout.stageToWorkspace(Layout.toStage(pot,shop.config.layout.modules.counter),shop.config.layout);
      shop.objects.push({id:++shop.serial,kind:'cooked',...spot,noodles:0,sauce:0});
      shop.cooking=shop.cooking.filter(batch=>batch!==cooked);
    }
    shop.revision++;
  }
function cafeAction(shop, input) {
    shop.checkRevision(input); shop.requireFood();
    if(shop.template().workflow!=='jasmine-latte') throw new Error('当前店铺没有咖啡机');
    if(input.action==='take_coffee') {
      const batch=shop.cooking[0];
      if(!batch) throw new Error('请先把杯子放入咖啡机');
      if(Date.now()<batch.ready_at) throw new Error('咖啡还在萃取，请稍等');
      if(shop.objects.length>=500) throw new Error('请先清理台面');
      const machine=Layout.stations(shop.config.layout).find(s=>s.kind==='noodles');
      const spot=Layout.stageToWorkspace(Layout.toStage({x:machine.x,y:machine.y+machine.height*.23},shop.config.layout.modules.counter),shop.config.layout);
      shop.objects.push({...batch.cup,...spot,coffee:true,at_machine:true});
      shop.selected=batch.id; shop.cooking=[];
    } else if(input.action==='brew_coffee') {
      if(shop.cooking.length) throw new Error('咖啡机正在萃取，请先取出咖啡');
      let cup=shop.objects.find(o=>o.id===input.object_id && o.kind==='bowl');
      const fresh=input.fresh_item;
      if(!cup && fresh?.id===shop.serial+1 && fresh.kind==='bowl') cup={id:fresh.id,kind:'bowl',x:500,y:475,noodles:0,sauce:0,coffee:false,jasmine:false,milk:false};
      if(!cup || cup.coffee || cup.spoiled) throw new Error('请把还没有咖啡的杯子放入咖啡机');
      shop.serial=Math.max(shop.serial,cup.id);
      shop.objects=shop.objects.filter(o=>o.id!==cup.id); shop.selected=null;
      shop.cooking=[{id:cup.id,cup:{...cup},ready_at:Date.now()+shop.config.cook_seconds*1000}];
    } else {
      const kind=input.action==='add_jasmine'?'jasmine':'milk';
      const cup=shop.objects.find(o=>o.id===input.bowl_id && o.kind==='bowl');
      if(!cup) throw new Error('请把配料放入杯子');
      if(cup.spoiled) throw new Error('这杯饮品已变质，请丢弃后重新制作');
      if(cup[kind]) throw new Error(kind==='jasmine'?'杯里已经放了茉莉花':'杯里已经倒了牛奶');
      const ingredient=shop.objects.find(o=>o.id===input.ingredient_id && o.kind===kind),fresh=input.fresh_item;
      if(!ingredient && !(fresh?.id===shop.serial+1 && fresh.kind===kind)) throw new Error('请先拿起'+(kind==='jasmine'?'茉莉花':'牛奶'));
      cup[kind]=true;
      shop.serial=Math.max(shop.serial,ingredient?.id ?? fresh.id);
      shop.objects=shop.objects.filter(o=>o!==ingredient); shop.selected=cup.id;
      shop.cafeEffect={id:randomUUID(),preset:shop.activePreset,kind,at:Date.now(),x:cup.x,y:cup.y};
    }
    shop.revision++;
  }

module.exports = { cookAction, cafeAction };
