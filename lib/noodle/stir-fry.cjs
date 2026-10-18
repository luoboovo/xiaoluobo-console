const Food = require('../../public/noodle/stir-fry-food.js');
const Rules = require('../../public/noodle/rules.js');

function stirFryAction(shop,input) {
  shop.checkRevision(input);shop.requireFood();
  if(shop.template().workflow!=='stir-fry')throw new Error('当前店铺没有麻辣香锅');
  const scene=shop.stirfry,wok=scene.wok,now=Date.now();
  const ingredient=()=>{
    if(!Food.ingredients.some(item=>item.id===input.ingredient))throw new Error('请从菜柜选择食材');
    return input.ingredient;
  };
  const bowlPosition=()=>{
    const {x,y}=input;
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Rules.contains(x,y,54))throw new Error('请把碗放在托盘上');
    return {x,y};
  };
  const bowl=()=>{
    const item=shop.objects.find(o=>o.kind==='bowl' && o.id===(input.bowl_id??shop.selected));
    if(!item)throw new Error('请先从碗架拿一个空碗');return item;
  };
  switch(input.action) {
    case 'stir_pick':
      if(scene.basket.length>=24)throw new Error('选菜篮已满，请先下锅或丢弃');
      scene.basket.push(ingredient());break;
    case 'stir_add': {
      const items=input.ingredient===undefined?[...scene.basket]:[ingredient()];
      if(!items.length)throw new Error('请先从菜柜取食材');
      if(wok.ingredients.length+items.length>24)throw new Error('一锅最多放 24 份食材');
      if(!wok.id)wok.id=++shop.serial;
      wok.ingredients.push(...items);wok.started_at=now;wok.ready_at=now+shop.config.cook_seconds*1000;wok.last_stir_at=now;wok.stirs=0;
      if(input.ingredient===undefined)scene.basket=[];
      break;
    }
    case 'stir_toss':
      if(!wok.ingredients.length)throw new Error('请先把食材放进铁锅');
      if(Food.ready(wok,now))throw new Error('食材炒好了，请拖进空碗');
      if(wok.last_stir_at && now-wok.last_stir_at<180)throw new Error('慢一点，再翻一炒');
      wok.stirs++;wok.last_stir_at=now;break;
    case 'stir_bowl': {
      if(shop.objects.length>=500)throw new Error('请先清理台面');
      const point=bowlPosition();if(shop.objects.some(o=>['bowl','water'].includes(o.kind)&&Rules.overlaps(o,{...point,kind:'bowl'})))throw new Error('商品不能重叠');
      const item={...point,id:++shop.serial,kind:'bowl',noodles:0,sauce:0,ingredients:[],garnishes:[]};shop.objects.push(item);shop.selected=item.id;break;
    }
    case 'stir_move_bowl': {
      const item=bowl(),point=bowlPosition();if(shop.objects.some(o=>o!==item&&['bowl','water'].includes(o.kind)&&Rules.overlaps(o,{...point,kind:'bowl'})))throw new Error('商品不能重叠');
      Object.assign(item,point);break;
    }
    case 'stir_plate': {
      const item=bowl();
      if(item.ingredients.length)throw new Error('这只碗已经装了香锅');
      if(wok.id!==input.wok_id)throw new Error('锅里的食材已更新');
      if(!Food.ready(wok,now))throw new Error('食材还没炒熟');
      item.ingredients=[...wok.ingredients];item.noodles=1;shop.selected=item.id;
      scene.wok=Food.empty().wok;break;
    }
    case 'stir_garnish': {
      if(!Object.hasOwn(Food.garnishes,input.garnish))throw new Error('配料无效');
      const item=bowl();if(!item.ingredients.length||item.spoiled)throw new Error('请先把炒好的香锅装进碗，再撒配料');
      if(item.garnishes.includes(input.garnish))throw new Error('已经撒过'+Food.garnishes[input.garnish]);
      item.garnishes.push(input.garnish);
      scene.garnish_effect={id:item.id+':'+input.garnish,at:now,garnish:input.garnish,x:item.x,y:item.y};break;
    }
    case 'stir_drink': {
      if(!Object.hasOwn(Food.drinks,input.drink))throw new Error('请从冰柜选择饮料');
      if(shop.objects.length>=500)throw new Error('请先清理台面');
      const point=[370,450,530,610,690,770,830].map(x=>({x,y:475})).find(p=>!shop.objects.some(o=>['bowl','water'].includes(o.kind)&&Rules.overlaps(o,{...p,kind:'water'})));
      if(!point)throw new Error('托盘放满了，请先出餐或清理');
      const item={...point,id:++shop.serial,kind:'water',drink:input.drink,noodles:0,sauce:0};shop.objects.push(item);shop.selected=item.id;break;
    }
    case 'stir_discard':
      if(input.target==='basket')scene.basket=[];
      else if(input.target==='wok')scene.wok=Food.empty().wok;
      else if(input.target==='dish'){const item=bowl();shop.objects=shop.objects.filter(o=>o!==item);if(shop.selected===item.id)shop.selected=null;}
      else if(input.target==='drink')shop.objects=shop.objects.filter(o=>o.kind!=='water');
      else throw new Error('请选择要丢弃的物品');
      break;
    default:throw new Error('香锅操作无效');
  }
  shop.revision++;
}
module.exports={stirFryAction};
