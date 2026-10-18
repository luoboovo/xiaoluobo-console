const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {GIFT_URL,requestDouyin,normalizeGifts}=require('../lib/douyin.cjs');
const {bindings,overtimeDefaults}=require('../lib/platform-games.cjs');
(async()=>{
  const {body}=await requestDouyin(GIFT_URL),list=normalizeGifts(JSON.parse(body).data?.gifts);
  if(list.length<12)throw new Error('抖音礼物列表不足，保留原始种子');
  const data=path.join(__dirname,'..','data');await fs.mkdir(path.join(data,'images'),{recursive:true});
  await fs.writeFile(path.join(data,'douyin-gifts.json'),JSON.stringify({updatedAt:new Date().toISOString(),source:GIFT_URL,list},null,2)+'\n');
  const defaults=bindings('douyin',list),ids=new Set([defaults.gift_id,...['water_gift','tip_gift','raid_gift','restock_gift','review_gift','praise_gift','thief_gift','help_gift','clearqueue_gift'].map(k=>defaults[k].gift_id),...Object.values(defaults.throw_gifts).map(g=>g.gift_id),...overtimeDefaults('douyin',list).map(g=>g.gift_id)]);
  for(const id of ids){const gift=list.find(g=>g.id===id);if(!gift.icon)continue;const {body}=await requestDouyin(gift.icon);await fs.writeFile(path.join(data,'images',`dy-${id}-${createHash('sha256').update(gift.icon).digest('hex').slice(0,16)}.png`),body);}
  console.log(`已同步${list.length}项真实抖音礼物，缓存${ids.size}项默认礼物图片`);
})().catch(error=>{console.error(error.message);process.exitCode=1;});
