const Rules = require('../../public/noodle/rules.js');

function burgerAction(shop, input) {
  shop.checkRevision(input); shop.requireFood();
  if (shop.template().workflow !== 'burger') throw new Error('当前店铺不是汉堡店');
  const now = Date.now();
  const bowl = () => {
    const item = shop.objects.find(o => o.kind === 'bowl' && o.id === (input.bowl_id ?? shop.selected));
    if (!item?.bun) throw new Error('请先从烤箱取出烤好的面包胚');
    if (item.closed) throw new Error('汉堡已经盖好，请出餐或重新制作');
    return item;
  };
  const batch = food => {
    const item = shop.cooking.find(o => o.food === food && o.id === input.batch_id);
    if (!item) throw new Error('这份食材已被取走，请重新选择');
    if (now < item.ready_at) throw new Error(food === 'bun' ? '面包胚还在烤，请稍等' : '肉饼还没煎熟，请稍等');
    return item;
  };
  switch (input.action) {
    case 'burger_bake': case 'burger_grill': {
      const food = input.action === 'burger_bake' ? 'bun' : 'patty';
      if (shop.cooking.filter(o => o.food === food).length >= 4) throw new Error(food === 'bun' ? '烤箱最多烤 4 份面包胚' : '煎台最多煎 4 份肉饼');
      shop.cooking.push({ id: ++shop.serial, food, ready_at: now + shop.config.cook_seconds * 1000 });
      break;
    }
    case 'burger_take_bun': {
      const baked = batch('bun');
      if (shop.objects.length >= 500) throw new Error('请先清理台面');
      const free = point => !shop.objects.some(o => ['bowl', 'water'].includes(o.kind) && Rules.overlaps(o, { ...point, kind: 'bowl' }));
      let point;
      if (input.x !== undefined || input.y !== undefined) {
        if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || !Rules.contains(input.x, input.y, 54)) throw new Error('请把面包胚放在组装托盘上');
        point = { x: input.x, y: input.y };
        if (!free(point)) throw new Error('汉堡不能重叠');
      } else point = [410, 530, 650, 770].map(x => ({ x, y: 475 })).find(free);
      if (!point) throw new Error('托盘已满，请先出餐或整理');
      const item = { ...point, id: ++shop.serial, kind: 'bowl', noodles: 0, sauce: 0, bun: true, patty: false, toppings: [], closed: false };
      shop.objects.push(item); shop.selected = item.id;
      shop.cooking = shop.cooking.filter(o => o !== baked);
      break;
    }
    case 'burger_patty': {
      const item = bowl(), cooked = batch('patty');
      if (item.patty) throw new Error('已经放过肉饼');
      item.patty = true; shop.selected = item.id;
      shop.cooking = shop.cooking.filter(o => o !== cooked);
      break;
    }
    case 'burger_topping': {
      const item = bowl();
      if (!['tomato', 'lettuce', 'cheese', 'mustard', 'ketchup', 'salad', 'mayo'].includes(input.topping)) throw new Error('汉堡配料无效');
      if (item.toppings.includes(input.topping)) throw new Error('已经放过这份配料');
      item.toppings.push(input.topping); shop.selected = item.id;
      break;
    }
    case 'burger_close': {
      const item = bowl();
      item.closed = true; shop.selected = item.id;
      break;
    }
    default: throw new Error('汉堡操作无效');
  }
  shop.revision++;
}

module.exports = { burgerAction };
