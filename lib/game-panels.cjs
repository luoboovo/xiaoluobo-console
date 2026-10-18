const {randomUUID}=require('node:crypto');
const F=require('../public/feeding/shared.js');
const {ruleText}=require('../public/overtime/shared.js');
function mergeEntries(entries){const merged=new Map();for(const entry of entries){if(!entry?.gift_name)continue;const key=entry.gift_id?'id:'+entry.gift_id:'name:'+entry.gift_name;const previous=merged.get(key);if(previous){if(!previous.text.split('；').includes(entry.text))previous.text+='；'+entry.text;}else merged.set(key,{...entry,gift_id:entry.gift_id||0});}return [...merged.values()];}
function panelFor(game,{noodle,overtime,feeding}){
  let name,entries;
  if(game==='overtime'){name='加班机礼物面板';entries=overtime.state.config.gift_rules.map(rule=>({...rule,text:ruleText(rule)}));}
  else if(game==='feeding'){name='吃吃吃礼物面板';const c=feeding.state.config;entries=[...c.gift_food_rules.map(r=>({...r,text:F.ruleText(r)})),...c.gift_range_rules.map(r=>({...r,text:F.ruleText({...r,operation:'range'})}))];}
  else if(game==='noodle'){
    if(!noodle.activePreset)throw new Error('请先创建或选择店铺');
    const c=noodle.config,workflow=noodle.template().workflow;name=(noodle.presets.find(p=>p.id===noodle.activePreset)?.name||'店铺')+'礼物面板';
    entries=[{gift_id:c.gift_id,gift_name:c.gift_name,text:`${workflow==='burger'?'汉堡':workflow==='jasmine-latte'?'咖啡':workflow==='stir-fry'?'炒菜':'面条'}点单 · ${c.people_per_gift}位顾客`},...(workflow==='jasmine-latte'?[]:[{...c.water_gift,text:`圣水/饮料点单 · ${c.people_per_gift}位顾客`}]),{...c.throw_gifts.leaf,text:'投掷菜叶'},{...c.throw_gifts.egg,text:'投掷鸡蛋'},{...c.throw_gifts.cockroach,text:'投掷蟑螂'},{...c.tip_gift,text:'打赏 · 抛出1枚金币（100元）'},{...c.raid_gift,text:`查封店铺 ${c.raid_seconds}秒`},{...c.restock_gift,text:'补货 · 恢复五星并重新营业'},{...c.review_gift,text:'差评 · 降低评分'},{...c.praise_gift,text:'好评 · 提高评分'},{...c.thief_gift,text:`偷钱匣 ${c.thief_min}～${c.thief_max}元`},{...c.help_gift,text:'帮忙制作并出餐'},{...c.clearqueue_gift,text:'清空排队'}];
  }else throw new Error('请选择有效游戏');
  entries=mergeEntries(entries).map(({gift_id,gift_name,text})=>({gift_id,gift_name,text}));
  if(!entries.length)throw new Error('请先保存至少一条礼物配置');
  return {id:randomUUID(),name:name.slice(0,40),columns:1,template:'custom',entries};
}
async function generatePanel(game,games){const panel=panelFor(game,games);await games.overtime.action({action:'panels',panels:[...games.overtime.state.config.gift_panels,panel]});return panel;}
module.exports={panelFor,generatePanel,mergeEntries};
