(function(root) {
  const ingredients = [
    ['bokchoy','小青菜','vegetable'], ['broccoli','西兰花','vegetable'],
    ['lotus','藕片','vegetable'], ['potato','土豆片','vegetable'],
    ['enoki','金针菇','vegetable'], ['shiitake','香菇','vegetable'],
    ['fishball','丸子','seafood'], ['crab','蟹排','seafood'],
    ['beef','牛肉','meat'], ['lamb','羊肉','meat'],
    ['chicken','鸡肉','meat'], ['tofu','豆腐','vegetable']
  ].map(([id,name,category],index)=>({id,name,category,index}));
  const garnishes = {sesame:'芝麻',scallions:'葱花',cilantro:'香菜'};
  const drinks = {cola:'可乐',iced_tea:'冰红茶'};
  const bowlAssets=['bowl','bowl_sesame','bowl_scallions','bowl_sesame_scallions','bowl_cilantro','bowl_sesame_cilantro','bowl_scallions_cilantro','bowl_all'];
  const garnishMask = items => items.reduce((mask,key)=>mask | ({sesame:1,scallions:2,cilantro:4}[key]||0),0);
  const ready = (wok,now=Date.now()) => Boolean(wok?.ingredients.length && wok.ready_at>0 && now>=wok.ready_at);
  const empty = () => ({basket:[],wok:{id:null,ingredients:[],stirs:0,started_at:0,last_stir_at:0,ready_at:0},garnish_effect:null});
  const food = {ingredients,garnishes,drinks,empty,bowlAssets,garnishMask,ready};
  if(typeof module==='object' && module.exports)module.exports=food;
  else root.StirFryFood=food;
})(globalThis);
