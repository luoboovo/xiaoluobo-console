const path = require('node:path');
const fs = require('node:fs/promises');
const { readJson, atomicJson } = require('./storage.cjs');
const { NoodleShop, config } = require('./noodle.cjs');
const { OvertimeMachine, normalizeConfig } = require('./overtime.cjs');
const { FeedingGame } = require('./feeding.cjs');
const { LotteryGame,MODES } = require('./lottery.cjs');
const { NumberBomb } = require('./number-bomb.cjs');
const { DEFAULTS, SHOP_GIFTS } = require('./noodle/config.cjs');

// 名称只是选择默认项的偏好；实际ID与名称始终取自当前礼物库。
const preferred={
  bilibili:['小花花','干杯','吃瓜','打call','送花花','心动盲盒','波仔盲盒','人气票','牛哇牛哇','凉了','这个好诶','应急食品'],
  douyin:['小心心','大啤酒','玫瑰','棒棒糖','鲜花','亲吻','加油鸭','抖音','你最好看','比心','为你闪耀','送你花花']
};
function bindings(platform,catalog) {
  const available=catalog.filter(g=>g.price>0),used=new Set();
  const picks=preferred[platform].map(name=>{
    const gift=available.filter(g=>g.name===name&&!used.has(g.id)).sort((a,b)=>a.price-b.price||a.id-b.id)[0]||available.find(g=>!used.has(g.id));
    if(!gift)throw new Error('礼物库不足，无法填充全部玩法');used.add(gift.id);
    return {gift_id:gift.id,gift_name:gift.name,match_name:true};
  });
  return {gift_id:picks[0].gift_id,gift_name:picks[0].gift_name,water_gift:picks[1],throw_gifts:{leaf:picks[2],egg:picks[3]},tip_gift:picks[4],...Object.fromEntries(SHOP_GIFTS.map((kind,index)=>[kind+'_gift',picks[index+5]]))};
}
function fillConfig(input,defaults,catalog,replace=false,cafe=false) {
  const next=structuredClone(input),byId=new Map();
  for(const gift of catalog)for(const id of [gift.id,...(gift.alias_ids||[])])byId.set(id,gift);
  const resolve=rule=>{
    if(!rule)return null;
    const gift=byId.get(rule.gift_id)||catalog.filter(g=>g.name===rule.gift_name).sort((a,b)=>a.price-b.price||a.id-b.id)[0];
    return gift?{...rule,gift_id:gift.id,gift_name:gift.name}:rule;
  };
  const order=replace?defaults:resolve({gift_id:next.gift_id,gift_name:next.gift_name});
  next.gift_id=order?.gift_id||defaults.gift_id;next.gift_name=order?.gift_name||defaults.gift_name;
  for(const key of ['water_gift','tip_gift',...SHOP_GIFTS.map(kind=>kind+'_gift')])next[key]=replace||JSON.stringify(next[key])===JSON.stringify(DEFAULTS[key])?defaults[key]:resolve(next[key])||defaults[key];
  next.throw_gifts={...next.throw_gifts,...Object.fromEntries(['leaf','egg'].map(kind=>[kind,replace||JSON.stringify(next.throw_gifts?.[kind])===JSON.stringify(DEFAULTS.throw_gifts[kind])?defaults.throw_gifts[kind]:resolve(next.throw_gifts?.[kind])||defaults.throw_gifts[kind]]))};
  if(next.throw_gifts.cockroach)next.throw_gifts.cockroach=resolve(next.throw_gifts.cockroach);
  if(cafe)next.water_gift=null;
  return config(next);
}
function overtimeDefaults(platform,catalog) {
  const names=platform==='douyin'?['小心心','大啤酒','棒棒糖','鲜花','亲吻','比心']:['小花花','干杯','人气票','送花花','舰长一号','电影票'];
  const operations=['add','subtract','multiply','divide','clear','lock_toggle'];
  return names.map((name,index)=>{
    const gift=catalog.filter(g=>g.name===name).sort((a,b)=>a.price-b.price||a.id-b.id)[0];
    if(!gift)throw new Error(`默认礼物“${name}”不在礼物库中`);
    return {gift_id:gift.id,gift_name:gift.name,operation:operations[index],value:index<2?1:index<4?2:1};
  });
}
async function createPlatformGames({dataDir,seedDir,templates,platform,catalog,source,legacyFiles=[],feedingLegacyFiles=[]}) {
  const dir=platform==='bilibili'?dataDir:path.join(dataDir,'douyin');await fs.mkdir(dir,{recursive:true});
  const defaults=bindings(platform,catalog),marker=path.join(dir,'gift-defaults-v240.json');
  const initialized=await readJson(marker,null),existing=await readJson(path.join(dir,'noodle.json'),null);
  if(!existing&&source){
    const presets=source.presets.map(p=>({...p,config:fillConfig(p.config,defaults,catalog,true,templates.get(p.config.template_id||'saozi').workflow==='jasmine-latte')}));
    const active=presets.find(p=>p.id===source.activePreset)?.config||fillConfig(source.config,defaults,catalog,true);
    await atomicJson(path.join(dir,'noodle.json'),{...active,presets,active_preset:source.activePreset});
  }
  const noodle=await new NoodleShop(dir,templates).init();
  noodle.defaults={...DEFAULTS,...defaults};
  if(!initialized){
    if(existing)await atomicJson(path.join(dir,'noodle.before-platform-gifts-v240.json'),existing);
    const presets=noodle.presets.map(p=>({...p,config:fillConfig(p.config,defaults,catalog,platform==='douyin'&&!existing,templates.get(p.config.template_id||'saozi').workflow==='jasmine-latte')}));
    await noodle.savePresets(presets,noodle.activePreset);
  }
  const overtimeFile=path.join(dir,'overtime.json');
  if(platform==='douyin'&&!await readJson(overtimeFile,null)){
    const rules=overtimeDefaults(platform,catalog),cfg=normalizeConfig({initial_text:'60',gift_rules:rules});
    await atomicJson(overtimeFile,{config:cfg,remaining:'3600',mode:'idle',clear_locked:false,people:[],history:[],seen:[]});
  }
  const overtime=await new OvertimeMachine(dir,{seedDir,legacyFiles:platform==='bilibili'?legacyFiles:[]}).init();
  if(!initialized){
    await atomicJson(overtime.file+'.before-platform-gifts-v240.json',overtime.state);
    const rules=overtime.state.config.gift_rules.map(rule=>{
      const gift=catalog.find(g=>g.id===rule.gift_id||g.alias_ids?.includes(rule.gift_id))||catalog.filter(g=>g.name===rule.gift_name).sort((a,b)=>a.price-b.price||a.id-b.id)[0];
      return gift?{...rule,gift_id:gift.id,gift_name:gift.name}:rule;
    });
    for(const rule of overtimeDefaults(platform,catalog))if(!rules.some(r=>r.operation===rule.operation)){
      const gift=rules.some(r=>r.gift_id===rule.gift_id)?catalog.find(g=>!rules.some(r=>r.gift_id===g.id)):null;
      rules.push(gift?{...rule,gift_id:gift.id,gift_name:gift.name}:rule);
    }
    if(rules.length<=100)overtime.state.config=normalizeConfig({...overtime.state.config,gift_rules:rules});
    await overtime.checkpoint();await atomicJson(marker,{version:1,platform});
  }
  const feeding=await new FeedingGame(dir,{catalog,platform,legacyFiles:platform==='bilibili'?feedingLegacyFiles:[]}).init();
  const lottery=Object.fromEntries(await Promise.all(MODES.map(async mode=>[mode,await new LotteryGame(dir,{platform,mode}).init()])));
  const numberBomb=await new NumberBomb(dir,{platform}).init();
  return {noodle,overtime,feeding,lottery,numberBomb,dir};
}
module.exports={bindings,fillConfig,overtimeDefaults,createPlatformGames};
