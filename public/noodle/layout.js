(function(root) {
  const modules = ['background', 'counter', 'customers'];
  const kinds = ['noodles', 'sauce', 'bowl'];
  const props = ['fridge', 'trash', 'cash', 'tray', 'dough', 'scallions', 'cilantro', 'rating', 'jasmine', 'milk', 'bun_lid', 'chef', 'stats', 'gift_rule', 'thief_board', 'sign_top', 'sign_title', 'sign_bottom', 'cash_text', 'ketchup', 'salad', 'mayo', 'queue_overflow', 'queue_customers'];
  const boardLimits = { width:[180,1280], height:[160,720] };
  const defaults = {
    modules: Object.fromEntries(modules.map(key => [key, { x: 0, y: 0, scale: 1, visible: true }])),
    stations: Object.fromEntries(kinds.map(key => [key, { side: key === 'noodles' ? 'left' : 'right', x: 0, y: 0, scale: 1, locked: true }])),
    trash: { side: 'right' },
    queue: { rows:4, columns:20, scale:1 },
    props: Object.fromEntries(props.map(key => [key, { x: 0, y: 0, scale: 1 }]))
  };
  Object.assign(defaults.props.thief_board, {width:220, height:300});
  function validate(input) {
    if (!input || typeof input !== 'object') throw new Error('场景配置无效');
    const result = { modules: {}, stations: {}, props: {} };
    const queue = input.queue === undefined ? defaults.queue : input.queue;
    if (!queue || !Number.isInteger(queue.rows) || queue.rows < 1 || queue.rows > 6 || !Number.isInteger(queue.columns) || queue.columns < 1 || queue.columns > 40 || !Number.isFinite(queue.scale) || queue.scale < .5 || queue.scale > 2) throw new Error('排队设置无效：1–6 排，每排 1–40 人，顾客大小 50%–200%');
    result.queue = { rows:queue.rows, columns:queue.columns, scale:queue.scale };
    for (const group of ['modules', 'stations']) for (const key of group === 'modules' ? modules : kinds) {
      const item = input[group]?.[key];
      if (!item || !Number.isFinite(item.x) || Math.abs(item.x) > (group === 'modules' ? 600 : 1280) || !Number.isFinite(item.y) || Math.abs(item.y) > (group === 'modules' ? 360 : 720) || !Number.isFinite(item.scale) || item.scale < (group === 'modules' ? .5 : .25) || item.scale > (group === 'modules' ? 1.5 : 2)) throw new Error('位置或大小超出可搭建范围');
      if (group === 'modules') {
        if (typeof item.visible !== 'boolean') throw new Error('模块开关无效');
        result.modules[key] = { x: item.x, y: item.y, scale: item.scale, visible: item.visible };
      } else {
        if (!['left', 'right'].includes(item.side) || typeof item.locked !== 'boolean') throw new Error('取料位置无效');
        result.stations[key] = { side: item.side, x: item.x, y: item.y, scale: item.scale, locked: item.locked };
      }
    }
    const side = input.trash === undefined ? 'right' : input.trash?.side;
    if (!['left', 'right'].includes(side)) throw new Error('垃圾桶位置无效');
    result.trash = { side };
    for (const key of props) {
      const item = input.props === undefined || !['fridge','trash','cash','tray'].includes(key) && input.props?.[key] === undefined ? defaults.props[key] : input.props?.[key];
      if (!item || !Number.isFinite(item.x) || Math.abs(item.x) > 1280 || !Number.isFinite(item.y) || Math.abs(item.y) > 720 || !Number.isFinite(item.scale) || item.scale < .25 || item.scale > 2) throw new Error('物品位置或大小无效');
      result.props[key] = { x: item.x, y: item.y, scale: item.scale };
      if (key === 'thief_board') for (const dimension of ['width','height']) {
        const value = item[dimension] === undefined ? defaults.props.thief_board[dimension] : item[dimension];
        const [min,max] = boardLimits[dimension];
        if (!Number.isFinite(value) || value < min || value > max) throw new Error('榜单宽高超出范围');
        result.props[key][dimension] = value;
      }
    }
    return result;
  }
  function stations(layout, workflow) {
    if(workflow==='burger')return Object.entries({noodles:[790,275,285,190],sauce:[45,264,240,195],bowl:[54,458,120,85]}).map(([kind,[x,y,width,height]])=>{
      const item=layout.stations[kind];return {kind,x:x+width/2+item.x,y:y+height/2+item.y,width:width*item.scale,height:height*item.scale};
    });
    if(workflow==='stir-fry')return Object.entries({noodles:[441,254,347,232],sauce:[784,244,75,80],bowl:[202,478,158,126]}).map(([kind,[x,y,width,height]])=>{
      const item=layout.stations[kind];return {kind,x:x+width/2+item.x,y:y+height/2+item.y,width:width*item.scale,height:height*item.scale};
    });
    const sizes = { noodles: [250, 220], sauce: [210, 215], bowl: [150, 144] }, result = [];
    for (const side of ['left', 'right']) {
      const list = kinds.filter(kind => layout.stations[kind].side === side);
      const total = list.reduce((sum, kind) => sum + sizes[kind][0], 0) + Math.max(0, list.length - 1) * 10;
      const fit = Math.min(1, 300 / total);
      let edge = side === 'left' ? 24 : 1256 - total * fit;
      for (const kind of list) {
        const item = layout.stations[kind], baseWidth = sizes[kind][0] * fit, baseHeight = sizes[kind][1] * fit;
        result.push({ kind, x: edge + baseWidth / 2 + item.x, y: 505 - baseHeight / 2 + item.y, width: baseWidth * item.scale, height: baseHeight * item.scale });
        edge += baseWidth + 10 * fit;
      }
    }
    return result;
  }
  function position(index, queue = defaults.queue) {
    const row = Math.floor(index / queue.columns), col = index % queue.columns;
    const gap = queue.columns === 1 ? 0 : Math.min(60 * queue.scale, (1212 - 72 * queue.scale) / (queue.columns - 1));
    return { x: 34 + col * gap, y: Math.min(704, 720 - 12 * queue.scale) - 94 * queue.scale - row * 23 * queue.scale, layer: queue.rows * queue.columns - index };
  }
  const toStage = (point, module) => ({ x: point.x * module.scale + module.x, y: point.y * module.scale + module.y });
  const fromStage = (point, module) => ({ x: (point.x - module.x) / module.scale, y: (point.y - module.y) / module.scale });
  const itemModule = key => ['rating','stats','gift_rule','thief_board','queue_overflow','queue_customers'].includes(key) ? 'customers' : ['fridge', 'trash','sign_top','sign_title','sign_bottom'].includes(key) ? 'background' : 'counter';
  const itemConfig = (layout, key) => kinds.includes(key) ? layout.stations[key] : layout.props[key];
  function resizeBoard(item, edge, dx, dy) {
    const next = {...item}, horizontal = edge.includes('w') ? -1 : edge.includes('e') ? 1 : 0, vertical = edge.includes('n') ? -1 : edge.includes('s') ? 1 : 0;
    next.width = Math.round(Math.max(boardLimits.width[0], Math.min(boardLimits.width[1], item.width + horizontal * dx)));
    next.height = Math.round(Math.max(boardLimits.height[0], Math.min(boardLimits.height[1], item.height + vertical * dy)));
    if (horizontal < 0) next.x = Math.round(Math.max(-1280, Math.min(1280, item.x + (item.width - next.width) * item.scale)));
    if (vertical < 0) next.y = Math.round(Math.max(-720, Math.min(720, item.y + (item.height - next.height) * item.scale)));
    return next;
  }
  function propRect(layout, key, workflow) {
    const bases = { fridge: [layout.trash?.side === 'left' ? 995 : 275, 174, 145, 180], trash: [layout.trash?.side === 'left' ? 112 : 1128, 252, 128, 160], cash: [1010, 491, 116, 102], tray: [320*1280/1200, 370*720/740, 540*1280/1200, 210*720/740], dough:[225,355,150,104], scallions:[1010,345,92,70], cilantro:[1110,345,92,70], jasmine:[970,337,115,94], milk:[1100,320,106,122] };
    if(workflow==='stir-fry')Object.assign(bases,{fridge:[1023,143,240,533],trash:[1126,586,105,110],cash:[965,539,75,66],tray:[408,491,550,110],dough:[17,132,426,540],scallions:[859,244,75,80],cilantro:[934,244,75,80]});
    bases.bun_lid=[192,466,110,65];
    Object.assign(bases,{ketchup:[370,315,65,105],salad:[465,315,65,105],mayo:[560,315,65,105]});
    if(workflow==='burger')Object.assign(bases,{fridge:[18,165,110,138],trash:[1158,563,95,119],cash:[1040,542,105,92],tray:[330,443,640,130],dough:[1105,310,130,80],scallions:[1050,403,83,53],cilantro:[1151,403,98,53],jasmine:[1050,470,83,53],milk:[1160,464,65,105]});
    const [x, y, width, height] = bases[key], item = layout.props?.[key] || defaults.props[key];
    return { x: x + width/2 + item.x - width*item.scale/2, y: y + height/2 + item.y - height*item.scale/2, width: width*item.scale, height: height*item.scale, scale: item.scale };
  }
  const trashRect = (layout,workflow) => propRect(layout, 'trash',workflow);
  const workspaceToStage = (point, layout, workflow) => {
    const r = propRect(layout, 'tray',workflow);
    if(workflow==='stir-fry'||workflow==='burger')return toStage({x:r.x+(point.x-320)*r.width/540,y:r.y+(point.y-370)*r.height/210},layout.modules.counter);
    return toStage({ x: r.x+(point.x-320)*1280/1200*r.scale, y: r.y+(point.y-370)*720/740*r.scale }, layout.modules.counter);
  };
  const stageToWorkspace = (point, layout, workflow) => {
    const r = propRect(layout, 'tray',workflow), p = fromStage(point, layout.modules.counter);
    if(workflow==='stir-fry'||workflow==='burger')return {x:320+(p.x-r.x)*540/r.width,y:370+(p.y-r.y)*210/r.height};
    return { x: 320+(p.x-r.x)*1200/1280/r.scale, y: 370+(p.y-r.y)*740/720/r.scale };
  };
  function trashContains(point, layout, workflow) {
    if (!layout.modules.background.visible) return false;
    const p = fromStage(point, layout.modules.background), r = trashRect(layout,workflow);
    return p.x >= r.x + 16*r.scale && p.x <= r.x + r.width - 16*r.scale && p.y >= r.y + 8*r.scale && p.y <= r.y + 120*r.scale;
  }
  const api = { defaults, validate, stations, position, toStage, fromStage, itemModule, itemConfig, resizeBoard, propRect, workspaceToStage, stageToWorkspace, trashRect, trashContains };
  if (typeof module !== 'undefined') module.exports = api; else root.NoodleLayout = api;
})(globalThis);
