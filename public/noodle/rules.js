(function(root) {
  const bench = { left: 320, right: 860, top: 370, bottom: 580 };
  const radius = item => item.kind === 'bowl' ? 54 : item.kind === 'water' ? 24 : 20;
  const contains = (x, y, r = 0) => x - r >= bench.left && x + r <= bench.right && y - r >= bench.top && y + r <= bench.bottom;
  const clamp = (x, y, r = 20) => ({
    x: Math.max(bench.left + r, Math.min(bench.right - r, x)),
    y: Math.max(bench.top + r, Math.min(bench.bottom - r, y))
  });
  const overlaps = (first, second) => Math.hypot(first.x - second.x, first.y - second.y) < radius(first) + radius(second) + 8;

  function ready(item, workflow = 'mix') {
    if (!item || item.spoiled) return false;
    if (item.kind === 'water') return true;
    if (item.kind !== 'bowl') return false;
    if(workflow==='burger')return Boolean(item.bun && item.patty && item.closed);
    if(workflow==='stir-fry')return Boolean(item.ingredients?.length);
    return Boolean(workflow === 'jasmine-latte'
      ? item.coffee && item.jasmine && item.milk
      : item.noodles >= 1 && (workflow === 'knife-noodles' || item.sauce >= 1));
  }

  function accepts(item, customer) {
    return Boolean(customer && ready(item, customer.recipe) && ((customer.order || 'noodles') === 'water' ? item.kind === 'water' : item.kind === 'bowl'));
  }

  function throwPosition(item, now=Date.now()) {
    if(item.kind!=='cockroach')return {x:item.x,y:item.y,angle:item.angle};
    const t=Math.max(0,now-item.at-1000)/1000,phase=item.id*.7;
    return {x:Math.max(32,Math.min(1248,item.x+Math.sin(t*.65)*48)),y:Math.max(32,Math.min(688,item.y+(Math.sin(t*.8+phase)-Math.sin(phase))*25)),angle:Math.atan2(Math.cos(t*.8+phase)*20,Math.cos(t*.65)*31.2)*180/Math.PI+90};
  }

  const rules = { bench, radius, contains, clamp, overlaps, ready, accepts, throwPosition };
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.NoodleRules = rules;
})(globalThis);
