const path=require('node:path');
const fs=require('node:fs/promises');
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const {atomicJson,readJson}=require('./storage.cjs');
const {saveAsset}=require('./feeding-assets.cjs');
const F=require('../public/feeding/shared.js');
const Physics=require('./feeding-physics.cjs');
const defaults={initial_food_count:10,manual_step:100,food_size:56,consumer_size:170,active_theme_id:'radish',food_images:[],consumer_image:'',food_image_order:'random',range_radius:50,range_pickup_limit:100,range_hit_mode:'intersects',stats_visible:true,stats_scale:1,stats_x_ratio:.03,stats_y_ratio:.03,gift_effect_overlay_enabled:true,sound_enabled:true,sound_files:{},food_sound_files:{},star_blessings:['一切尽意，万事从欢','顺遂无虞，皆得所愿','浅予深深，长乐未央','旦逢良辰，顺颂时宜'],danmaku_match_mode:'exact',danmaku_case_sensitive:false,user_cooldown_seconds:1,danmaku_rules:[{keyword:'投喂',delta:1},{keyword:'吃',delta:-1}],gift_food_rules:[],gift_range_rules:[],custom_templates:[],gift_rule_templates:[]};
function number(value,min,max,label,integer=false){if(!Number.isFinite(value)||value<min||value>max||integer&&!Number.isSafeInteger(value))throw new Error(`${label}须为${min}–${max}${integer?'的整数':''}`);return value;}
function list(value,max,label){if(!Array.isArray(value)||value.length>max)throw new Error(`${label}最多${max}项`);return value;}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`${label}不能为空且最多${max}字`);return value.trim();}
function asset(value,audio=false){if(value===''||value==null)return '';if(typeof value!=='string'||!(audio?/^\/api\/feeding\/assets\/[a-f0-9]{64}\.(wav|mp3|ogg|m4a)$/:/^\/(?:api\/feeding\/assets\/[a-f0-9]{64}\.(png|jpg|gif|webp|bmp)|feeding\/assets\/(?:[a-z_]+\/)?[a-z_]+\.(png|svg))$/).test(value))throw new Error('请先上传本机素材');return value;}
function gift(rule,range=false){return {gift_name:text(rule?.gift_name,100,'礼物名称'),gift_id:number(Number(rule.gift_id||0),0,999999999,'礼物ID',true),...(range?{seconds:number(Number(rule.seconds),1,3600,'拾取秒数',true)}:{operation:Object.hasOwn(F.operations,rule.operation)&&rule.operation!=='range'?rule.operation:(()=>{throw new Error('礼物作用无效');})(),value:['clear','wind'].includes(rule.operation)?1:number(Number(rule.value),['multiply','divide'].includes(rule.operation)?1:.01,100000,'礼物数值')})};}
function theme(value){return {id:text(value.id,64,'模板编号'),name:text(value.name,40,'模板名称'),food_images:list(value.food_images,30,'食物图片').map(v=>asset(v)),consumer_image:asset(value.consumer_image),active_theme_id:String(value.active_theme_id||'radish')};}
function ruleTemplate(value){return {id:text(value.id,64,'方案编号'),name:text(value.name,40,'方案名称'),gift_food_rules:list(value.gift_food_rules,100,'礼物规则').map(r=>gift(r)),gift_range_rules:list(value.gift_range_rules||[],100,'范围规则').map(r=>gift(r,true))};}
function normalizeConfig(input={}){
  const c={...defaults,...input},next={};
  for(const [key,min,max,integer]of [['initial_food_count',0,F.MAX_COUNT,true],['manual_step',1,F.MAX_COUNT,true],['food_size',16,160,true],['consumer_size',40,400,true],['range_radius',10,400,true],['range_pickup_limit',1,2000,true],['stats_scale',.25,3,false],['stats_x_ratio',0,1,false],['stats_y_ratio',0,1,false],['user_cooldown_seconds',0,60,false]])next[key]=number(c[key],min,max,key,integer);
  for(const key of ['stats_visible','sound_enabled','gift_effect_overlay_enabled','danmaku_case_sensitive']){if(typeof c[key]!=='boolean')throw new Error('开关设置无效');next[key]=c[key];}
  for(const [key,values]of [['food_image_order',['random','sequence']],['range_hit_mode',['intersects','center','contains']],['danmaku_match_mode',['exact','contains']]]){if(!values.includes(c[key]))throw new Error('显示或弹幕模式无效');next[key]=c[key];}
  next.active_theme_id=String(c.active_theme_id||'radish').slice(0,64);next.food_images=list(c.food_images,30,'食物图片').map(v=>asset(v));next.consumer_image=asset(c.consumer_image);
  next.star_blessings=list(c.star_blessings,100,'祝福语').map(v=>text(v,100,'祝福语'));
  next.danmaku_rules=list(c.danmaku_rules,100,'弹幕规则').map(r=>({keyword:text(r.keyword,100,'关键词'),delta:number(r.delta,-10000,10000,'弹幕数量',true)}));
  next.gift_food_rules=list(c.gift_food_rules,100,'礼物规则').map(r=>gift(r));next.gift_range_rules=list(c.gift_range_rules,100,'范围规则').map(r=>gift(r,true));
  next.sound_files=Object.fromEntries(['add','remove','eat','gift'].map(k=>[k,asset(c.sound_files?.[k]||'',true)]));
  next.food_sound_files=Object.fromEntries(Object.entries(c.food_sound_files||{}).slice(0,30).map(([k,v])=>[asset(k),asset(v,true)]));
  next.custom_templates=list(c.custom_templates,30,'主题模板').map(theme);next.gift_rule_templates=list(c.gift_rule_templates,30,'礼物方案').map(ruleTemplate);
  return next;
}
function matches(r,event){return r.gift_id?(r.gift_id===event.giftId||event.giftAliases?.includes(r.gift_id)):r.gift_name===event.giftName;}
function matching(rules,event){const specific=rules.filter(r=>matches(r,event));return specific.length||!event.blindGiftName?specific:rules.filter(r=>r.gift_name===event.blindGiftName);}
class FeedingGame extends EventEmitter{
  constructor(dir,{catalog=[],legacyFiles=[],random=Math.random,platform='bilibili'}={}){super();this.dir=dir;this.file=path.join(dir,'feeding.json');this.catalog=catalog;this.legacyFiles=legacyFiles;this.random=random;this.platform=platform;this.cooldowns=new Map();this.consumerTrail=[];this.awake=true;this.stillFrames=0;this.queue=Promise.resolve();}
  // Feeding mutations share one queue so physics frames never wait behind noodle or overtime work.
  serial(work){const run=this.queue.then(work);this.queue=run.catch(()=>{});return run;}
  async init(){
    let stored=await readJson(this.file,null);
    if(!stored){let config=normalizeConfig();const gift=this.catalog.find(g=>g.name==='小花花'||g.name==='小心心')||this.catalog[0];if(gift)config.gift_food_rules=[{gift_id:gift.id,gift_name:gift.name,operation:'add',value:1}];
      for(const file of this.legacyFiles){const raw=await readJson(file,null);if(raw){config=await this.migrate(raw,path.dirname(file));break;}}
      stored={config,count:config.initial_food_count,eaten:0,mode:'idle',consumer:{x:1040,y:500},stats:{x:Math.min(F.WIDTH-100,config.stats_x_ratio*F.WIDTH),y:Math.min(F.HEIGHT-40,config.stats_y_ratio*F.HEIGHT)},placements:[],seq:0,revision:0,seen:[]};await atomicJson(this.file,stored);
    }
    this.state={...stored,config:normalizeConfig(stored.config),mode:stored.mode==='running'?'paused':stored.mode,range_until:0,manual_range:false,wind_until:0,cue:null};delete this.state.objects;this.seen=new Map(stored.seen||[]);this.objects=stored.objects||[];this.refill();return this;
  }
  async migrate(raw,base){
    // Only gameplay fields are selected; room credentials and license data never enter the console.
    const c={...defaults,...Object.fromEntries(Object.keys(defaults).filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]))};
    const copied=new Map();const copy=async p=>{if(!p)return '';if(copied.has(p))return copied.get(p);try{const body=await fs.readFile(path.resolve(base,p));const url=await saveAsset(this.dir,body);copied.set(p,url);return url;}catch{return '';}};
    c.food_images=(await Promise.all((c.food_images||[]).map(copy))).filter(Boolean);c.consumer_image=await copy(c.consumer_image);
    c.sound_files=Object.fromEntries(await Promise.all(Object.entries(c.sound_files||{}).map(async([k,v])=>[k,await copy(v)])));
    c.food_sound_files=Object.fromEntries((await Promise.all(Object.entries(c.food_sound_files||{}).map(async([k,v])=>[await copy(k),await copy(v)]))).filter(([k,v])=>k&&v));
    c.custom_templates=await Promise.all((c.custom_templates||[]).map(async(t,i)=>({id:String(t.id||'legacy-'+i),name:t.name,food_images:(await Promise.all((t.food_images||[]).map(copy))).filter(Boolean),consumer_image:await copy(t.consumer_image),active_theme_id:t.active_theme_id||'radish'})));
    c.gift_rule_templates=(c.gift_rule_templates||[]).map((t,i)=>({...t,id:String(t.id||'legacy-'+i)}));
    if(!raw.gift_food_rules&&raw.gift_delta_rules)c.gift_food_rules=raw.gift_delta_rules.map(r=>({...r,operation:r.delta<0?'subtract':'add',value:Math.abs(r.delta)}));
    return normalizeConfig(c);
  }
  refill(){
    const n=Math.min(F.MAX_SPRITES,this.state.count);this.objects.length=Math.min(n,this.objects.length);
    const occupied=new Set(this.objects.filter(o=>Number.isInteger(o.slot)).map(o=>o.slot));let slot=0;
    const allocate=()=>{while(occupied.has(slot))slot++;occupied.add(slot);return slot++;};
    // Keep each food's column when another food is removed; old saves acquire slots once.
    for(const object of this.objects)if(!Number.isInteger(object.slot))object.slot=allocate();
    while(this.objects.length<n)this.objects.push({id:++this.state.seq,slot:allocate()});
    const placements=new Map((this.state.placements||[]).map(p=>[p.id,p]));
    for(const object of this.objects)if(!Number.isFinite(object.x)||!Number.isFinite(object.y))Object.assign(object,Physics.spawn(object,this.state.config.food_size,placements.get(object.id)));
    const ids=new Set(this.objects.map(o=>o.id));this.state.placements=(this.state.placements||[]).filter(p=>ids.has(p.id));
    this.awake=true;this.stillFrames=0;
  }
  snapshot(){return {...this.state,platform:this.platform,seen:undefined,objects:this.objects,now:Date.now()};}
  async save(){await atomicJson(this.file,{...this.state,objects:this.objects,seen:[...this.seen],cue:null},{compact:true});}
  async close(){await this.queue;await this.save();}
  publish(){this.emit('state',this.snapshot());}
  // 30 frames per second for up to 2000 foods: 0.1px and 0.01rad keep frames small without visible jitter.
  physicsSnapshot(){return {revision:this.state.revision,objects:this.objects.map(({id,x,y,angle})=>({id,x:Math.round(x*10)/10,y:Math.round(y*10)/10,angle:Math.round(angle*100)/100})),consumer:this.state.consumer,now:Date.now()};}
  eat(ids){
    const selected=new Set(ids),first=this.objects.find(o=>selected.has(o.id));if(!first)return false;
    const c=this.state.config,t=F.themes.find(t=>t.id===c.active_theme_id)||F.themes[0],foods=c.food_images.length?c.food_images:t.foods;
    const count=this.objects.filter(o=>selected.has(o.id)).length;
    this.objects=this.objects.filter(o=>!selected.has(o.id));this.change(this.state.count-count,'eat');
    this.state.cue.food_url=foods[c.food_image_order==='sequence'?first.slot%foods.length:Math.floor(F.noise(first.id)*foods.length)];
    if(c.active_theme_id==='stars_jar'){const b=c.star_blessings;this.state.blessing=b[Math.floor(this.random()*b.length)]||'';}
    return true;
  }
  tick(){return this.serial(()=>this.step());}
  async step(){
    if(!this.awake&&!this.consumerTrail.length)return;
    const now=Date.now(),hold=this.hold?.expires>now?this.hold:null,held=new Set(hold?.ids||[]),wind=this.state.wind_until>now;
    if(hold?.kind==='food')for(const object of this.objects)if(held.has(object.id)){const offset=hold.offsets.get(object.id);object.x=Math.max(0,Math.min(F.WIDTH,hold.x+offset.x));object.y=Math.max(0,Math.min(F.HEIGHT,hold.y+offset.y));object.vx=object.vy=0;}
    const before=new Map(this.objects.map(o=>[o.id,{x:o.x,y:o.y}]));
    const movement=Physics.step(this.objects,this.state.config.food_size,held,wind);
    const trails=this.consumerTrail.splice(0),c=this.state.config;
    // Sweep the food's fall path against the eater, including manual releases before starting the game.
    const ids=this.objects.filter(o=>!held.has(o.id)&&(trails.some(path=>Physics.touches(o,path.from,path.to,c.consumer_size,c.food_size))||!wind&&(this.state.mode==='running'||o.released)&&o.y>before.get(o.id).y&&Physics.touches({...this.state.consumer,id:o.id},before.get(o.id),o,c.consumer_size,c.food_size))).map(o=>o.id);
    if(ids.length){const previousState=structuredClone(this.state),previousObjects=structuredClone(this.objects);try{if(this.eat(ids)){this.state.revision++;await this.save();this.publish();}}catch(error){this.state=previousState;this.objects=previousObjects;throw error;}}
    else if(!wind&&!held.size&&movement<1.5){if(++this.stillFrames>=30)this.awake=false;}else this.stillFrames=0;
    this.emit('physics',this.physicsSnapshot());
  }
  change(target,kind='add'){const previous=this.state.count;this.state.count=Math.max(0,Math.min(F.MAX_COUNT,Math.round(target)));if(this.state.count<previous)this.state.eaten+=previous-this.state.count;this.refill();this.state.cue={id:randomUUID(),kind,time:Date.now()};}
  operate(rule,count=1){const n=this.state.count,v=rule.value;let target=n;switch(rule.operation){case 'add':target=n+Math.round(v*count);break;case 'subtract':target=n-Math.round(v*count);break;case 'multiply':target=n===0?0:v<=1?n:count*Math.log(v)>=Math.log(F.MAX_COUNT/n)?F.MAX_COUNT:Math.round(n*v**count);break;case 'divide':target=v<=1?n:count*Math.log(v)>Math.log(Math.max(1,n))+1?0:Math.floor(n/v**count);break;case 'clear':target=0;break;case 'wind':for(let i=0;i<count;i++){const delta=Math.max(1,Math.round(Math.max(1,target)*(.1+this.random()*.4)));target=Math.max(0,Math.min(F.MAX_COUNT,target+(this.random()<.5?1:-1)*delta));}this.state.wind_until=Date.now()+2400;break;}this.change(target,rule.operation==='wind'?'wind':'gift');}
  action(input){return this.serial(()=>this.perform(input));}
  async perform(input){
    const before=structuredClone(this.state),objects=structuredClone(this.objects);
    try{switch(input.action){
      case 'configure':{const config=normalizeConfig(input.config);if(config.food_size!==this.state.config.food_size)for(const food of this.objects)food.rest=food.stuck=0;this.state.config=config;this.awake=true;this.stillFrames=0;break;}
      case 'start':case 'resume':this.state.mode='running';break;
      case 'pause':this.state.mode='paused';break;
      case 'reset':this.state.count=this.state.config.initial_food_count;this.state.eaten=0;this.state.placements=[];this.state.wind_until=0;this.state.range_until=0;this.state.manual_range=false;this.objects=[];this.refill();break;
      case 'delta':this.change(this.state.count+number(input.delta,-F.MAX_COUNT,F.MAX_COUNT,'数量',true),input.delta>0?'add':'remove');break;
      case 'clear':this.change(0,'remove');break;
      case 'wind':this.operate({operation:'wind',value:1});break;
      case 'range':this.state.manual_range=!this.state.manual_range;break;
      case 'consumer':{
        const from=this.state.consumer,to={x:number(input.x,20,F.WIDTH-20,'位置'),y:number(input.y,20,F.HEIGHT-20,'位置')};this.state.consumer=to;
        this.eat(this.objects.filter(o=>Physics.touches(o,from,to,this.state.config.consumer_size,this.state.config.food_size)).map(o=>o.id));break;
      }
      case 'stats':this.state.stats={x:number(input.x,0,F.WIDTH-100,'位置'),y:number(input.y,0,F.HEIGHT-40,'位置')};break;
      case 'drop':{
        if(input.revision!==this.state.revision){if(input.automatic===true)return this.snapshot();throw new Error('画面已更新，请重新拖动');}
        const ids=list(input.ids,this.state.config.range_pickup_limit,'抓取食物');if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!this.objects.some(o=>o.id===id)))throw new Error('食物已变化，请重新抓取');
        const x=number(input.x,0,F.WIDTH,'位置'),y=number(input.y,0,F.HEIGHT,'位置');
        const eaten=F.consumerHit(x,y,this.state.consumer,this.state.config.consumer_size);
        if(eaten)this.eat(ids);
        else{const moved=ids.map((id,i)=>({id,x:Math.max(10,Math.min(F.WIDTH-10,x+(F.noise(i,2)-.5)*Math.min(150,ids.length*5))),y:Math.max(10,Math.min(F.HEIGHT-10,y+(F.noise(i,4)-.5)*40))}));this.state.placements=[...this.state.placements.filter(p=>!ids.includes(p.id)),...moved];for(const p of moved){const object=this.objects.find(o=>o.id===p.id);Object.assign(object,p,{vx:(F.noise(p.id,23)-.5)*60,vy:0,rest:0,stuck:0,released:true});}this.awake=true;this.stillFrames=0;}
        this.hold=null;
        break;
      }
      case 'simulate':{const rule=gift(input.rule,input.rule?.operation==='range'),quantity=number(input.count,1,1000000,'礼物数量',true);this.applyGift({type:'gift',giftId:rule.gift_id,giftName:rule.gift_name,count:quantity},true);break;}
      default:throw new Error('吃吃吃操作无效');
    }this.state.revision++;await this.save();this.publish();return this.snapshot();}catch(e){this.state=before;this.objects=objects;throw e;}
  }
  applyGift(event,simulate=false){
    if(!simulate&&this.state.mode!=='running')return false;
    const key=event.transactionId?`${event.uid}:${event.giftId}:${event.transactionId}`:'';
    if(key&&this.seen.has(key)&&Date.now()-this.seen.get(key)<300000)return false;
    const food=matching(this.state.config.gift_food_rules,event),range=matching(this.state.config.gift_range_rules,event);if(!food.length&&!range.length)return false;
    const count=number(event.count,1,1000000,'礼物数量',true);for(const r of food)this.operate(r,count);
    if(range.length)this.state.range_until=Math.max(Date.now(),this.state.range_until||0)+Math.min(86400,Math.max(...range.map(r=>r.seconds))*count)*1000;
    this.state.cue={id:randomUUID(),kind:'gift',time:Date.now(),text:`${event.giftName} ×${count}`,effects:[...food.map(F.ruleText),...range.map(r=>F.ruleText({...r,operation:'range'}))].join(' · ')};
    if(key)this.seen.set(key,Date.now());while(this.seen.size>10000)this.seen.delete(this.seen.keys().next().value);this.state.revision++;return true;
  }
  receiveBatch(events){return this.serial(()=>this.applyBatch(events));}
  // Most gift batches touch no feeding rule; skip the rollback copies of every food and dedupe key for them.
  async applyBatch(events){if(this.state.mode!=='running'||!events.some(event=>matching(this.state.config.gift_food_rules,event).length||matching(this.state.config.gift_range_rules,event).length))return;const before=structuredClone(this.state),objects=structuredClone(this.objects),seen=new Map(this.seen);try{let changed=false;for(const event of events)changed=this.applyGift(event)||changed;if(changed){await this.save();this.publish();}}catch(e){this.state=before;this.objects=objects;this.seen=seen;throw e;}}
  // Danmaku rules this chat would trigger while running, ignoring the per-viewer cooldown.
  chatRules(event){if(this.state.mode!=='running'||typeof event.text!=='string')return [];const c=this.state.config,message=c.danmaku_case_sensitive?event.text:event.text.toLowerCase();return c.danmaku_rules.filter(r=>{const word=c.danmaku_case_sensitive?r.keyword:r.keyword.toLowerCase();return c.danmaku_match_mode==='exact'?message===word:message.includes(word);});}
  async receiveChat(event){if(this.state.mode!=='running')return;const c=this.state.config,key=String(event.uid||event.user);if(Date.now()-(this.cooldowns.get(key)||0)<c.user_cooldown_seconds*1000)return;const rules=this.chatRules(event);if(!rules.length)return;this.cooldowns.set(key,Date.now());while(this.cooldowns.size>10000)this.cooldowns.delete(this.cooldowns.keys().next().value);await this.action({action:'delta',delta:Math.max(-F.MAX_COUNT,Math.min(F.MAX_COUNT,rules.reduce((sum,r)=>sum+r.delta,0)))});}
  motion(input){
    if(typeof input.client!=='string'||input.client.length>64)return false;
    const x=number(input.x,0,F.WIDTH,'位置'),y=number(input.y,0,F.HEIGHT,'位置'),kind=input.kind||'food';if(!['food','consumer','stats'].includes(kind))return false;
    const ids=list(input.ids||[],this.state.config.range_pickup_limit,'抓取食物');if(ids.some(id=>!this.objects.some(o=>o.id===id)))return false;
    if(kind==='food'){
      const offsets=input.offsets?list(input.offsets,ids.length,'抓取偏移'):ids.map(()=>({x:0,y:0}));if(offsets.length!==ids.length)throw new Error('抓取偏移无效');
      this.hold={client:input.client,kind,ids,x,y,offsets:new Map(ids.map((id,i)=>[id,{x:number(offsets[i].x,-F.WIDTH,F.WIDTH,'偏移'),y:number(offsets[i].y,-F.HEIGHT,F.HEIGHT,'偏移')}])),expires:Date.now()+1000};
    }else if(kind==='consumer'){
      const to={x:Math.max(20,Math.min(F.WIDTH-20,x)),y:Math.max(20,Math.min(F.HEIGHT-20,y))};this.consumerTrail.push({from:this.state.consumer,to});if(this.consumerTrail.length>64)this.consumerTrail.shift();this.state.consumer=to;
    }
    this.awake=true;this.stillFrames=0;this.emit('motion',{client:input.client,revision:this.state.revision,kind,ids,x,y,time:Date.now()});return true;
  }
}
module.exports={FeedingGame,normalizeConfig,defaults,matching};
