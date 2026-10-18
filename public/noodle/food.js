export function food(kind, asset) {
  const element = document.createElement('img');
  element.className = 'loose-food';
  const slot = ['noodles', 'sauce', 'scallions', 'cilantro', 'jasmine'].includes(kind) ? 'portion_' + kind : kind;
  element.src = asset(slot, kind === 'water' ? 'mineral-water' : kind === 'coin' ? 'payment-coin' : 'portion-' + kind);
  element.alt = { noodles:'一份面条', sauce:'一份臊子', water:'圣水', coin:'金币（100元）', raw:'削好的生面', cooked:'煮熟的刀削面', scallions:'葱花', cilantro:'香菜', jasmine:'一份茉莉花', milk:'牛奶壶' }[kind];
  return element;
}

export function cafeCupAsset(item) {
  if (item.spoiled) return 'evil_bowl';
  if (!item.coffee) return item.milk ? 'cup_milk' : 'cup_empty';
  if (item.milk) return item.jasmine ? 'cup_latte' : 'cup_coffee_milk';
  return item.jasmine ? 'cup_jasmine' : 'cup_coffee';
}
