const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {readJson,atomicJson}=require('./storage.cjs');
const {safeFace}=require('./avatar.cjs');

// 萝卜割草：主角身边一圈刀一直转，碰到怪就扣血。战斗在画面网页里实时模拟，
// 服务端只负责设置、开局状态，以及把礼物/弹幕变成按顺序编号的「指令」发给画面。
// 指令只在内存里排队（不落盘），画面断线重连后只接新的指令。
const EFFECTS={boss:'召唤头像BOSS',monster:'召唤高级怪物',swarm:'刷一波小草',heal:'主角回血',hurt:'主角扣血',disarm:'缴械',blade:'主角加刀',weapon:'空投武器',nuke:'清屏大招'};
const MAX_RULES=50,MAX_CUES=200,MAX_DUELS=30;
const DEFAULTS={
  hero_name:'小萝卜',hero_image:'',hero_size:72,hero_hp:1000,control_mode:'keyboard',hero_speed:220,blade_count:1,blade_damage:30,blade_radius:95,blade_speed:3.5,
  auto_spawn:true,auto_spawn_per_second:1.5,pickups:true,pickup_interval_seconds:10,
  monster_growth_percent:20,like_spawn:true,likes_per_monster:1,
  chat_spawn_keyword:'冲',chat_spawn_count:3,chat_heal_keyword:'加油',chat_heal_value:20,chat_match_mode:'exact',user_cooldown_seconds:3,
  boss_damage:40,
  gift_rules:[]
};
const VALUE_LIMITS={boss:[1,1000000],monster:[1,5],swarm:[1,200],heal:[1,100000],hurt:[1,100000],disarm:[1,60],blade:[1,12],weapon:[1,1],nuke:[1,1]};
// 礼物连送时的总量上限（召唤高级怪物的数值是等级，不随数量变）
const TOTAL_LIMITS={boss:1000000,swarm:2000,heal:1000000,hurt:1000000,disarm:120,blade:12};
const HERO_IMAGE=/^\/api\/feeding\/assets\/[a-f0-9]{64}\.(?:png|gif|webp|jpg)$/;
const NO_VALUE=new Set(['weapon','nuke']);
function text(value,max,label,required=true){
  if(typeof value!=='string')throw new Error(label+'无效');const v=value.trim();
  if(required&&!v||v.length>max)throw new Error(`${label}需要${required?1:0}～${max}个字`);return v;
}
function number(value,min,max,label,integer=false){
  if(!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))throw new Error(`${label}需要${min}～${max}${integer?'的整数':''}`);return value;
}
function normalizeRule(rule){
  if(!rule||typeof rule!=='object')throw new Error('礼物规则无效');
  if(!Object.hasOwn(EFFECTS,rule.effect))throw new Error('礼物作用无效');
  const [min,max]=VALUE_LIMITS[rule.effect];
  return {gift_id:number(Number(rule.gift_id||0),0,999999999,'礼物ID',true),gift_name:text(rule.gift_name,100,'礼物名称'),effect:rule.effect,value:NO_VALUE.has(rule.effect)?1:number(Number(rule.value),min,max,EFFECTS[rule.effect]+'数值',true)};
}
function normalizeConfig(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('割草设置无效');
  const c={...DEFAULTS,...input};delete c.boss_hp_per_gift;
  const next={
    hero_name:text(c.hero_name,12,'主角名字'),
    hero_image:c.hero_image===''||typeof c.hero_image==='string'&&HERO_IMAGE.test(c.hero_image)?c.hero_image:(()=>{throw new Error('主角图片无效，请重新上传PNG或GIF');})(),
    hero_size:number(c.hero_size,40,200,'主角大小',true),
    control_mode:['keyboard','auto'].includes(c.control_mode)?c.control_mode:(()=>{throw new Error('操作方式无效');})(),
    hero_speed:number(c.hero_speed,80,600,'主角移动速度',true),
    hero_hp:number(c.hero_hp,100,1000000,'主角血量',true),
    blade_count:number(c.blade_count,1,12,'刀的数量',true),
    blade_damage:number(c.blade_damage,1,100000,'每刀伤害',true),
    blade_radius:number(c.blade_radius,50,220,'旋转半径',true),
    blade_speed:number(c.blade_speed,.5,12,'旋转速度'),
    auto_spawn:typeof c.auto_spawn==='boolean'?c.auto_spawn:(()=>{throw new Error('自动刷怪开关无效');})(),
    auto_spawn_per_second:number(c.auto_spawn_per_second,0,20,'每秒刷怪'),
    pickups:typeof c.pickups==='boolean'?c.pickups:(()=>{throw new Error('地图道具开关无效');})(),
    pickup_interval_seconds:number(c.pickup_interval_seconds,2,120,'道具刷新间隔'),
    monster_growth_percent:number(c.monster_growth_percent,0,200,'怪物每分钟变强'),
    like_spawn:typeof c.like_spawn==='boolean'?c.like_spawn:(()=>{throw new Error('点赞召唤开关无效');})(),
    likes_per_monster:number(c.likes_per_monster,1,1000,'每只小草需要的点赞',true),
    chat_spawn_keyword:text(c.chat_spawn_keyword,20,'刷怪口令',false),
    chat_heal_keyword:text(c.chat_heal_keyword,20,'回血口令',false),
    chat_spawn_count:number(c.chat_spawn_count,1,50,'每次派出小怪数量',true),
    chat_heal_value:number(c.chat_heal_value,1,100000,'弹幕回血量',true),
    chat_match_mode:['exact','includes'].includes(c.chat_match_mode)?c.chat_match_mode:(()=>{throw new Error('弹幕匹配方式无效');})(),
    user_cooldown_seconds:number(c.user_cooldown_seconds,0,60,'每人弹幕CD'),
    boss_damage:number(c.boss_damage,1,100000,'BOSS伤害',true),
    gift_rules:Array.isArray(c.gift_rules)&&c.gift_rules.length<=MAX_RULES?c.gift_rules.map(normalizeRule):(()=>{throw new Error(`礼物规则最多${MAX_RULES}条`);})()
  };
  if(next.chat_spawn_keyword&&next.chat_spawn_keyword===next.chat_heal_keyword)throw new Error('刷怪口令和回血口令不能相同');
  return next;
}
function matches(rule,event){return rule.gift_id?(rule.gift_id===event.giftId||event.giftAliases?.includes(rule.gift_id)):rule.gift_name===event.giftName;}
// 新存档的默认礼物：按平台偏好名称选，礼物库里没有就跳过（不影响启动）。
const PREFERRED={bilibili:[['boss','小花花'],['monster','干杯'],['heal','打call'],['blade','人气票'],['weapon','牛哇牛哇'],['hurt','这个好诶'],['disarm','吃瓜']],douyin:[['boss','小心心'],['monster','大啤酒'],['heal','棒棒糖'],['blade','鲜花'],['weapon','玫瑰'],['hurt','比心'],['disarm','你最好看']]};
function defaultRules(platform,catalog=[]){
  const rules=[],used=new Set();
  for(const [effect,name] of PREFERRED[platform]||PREFERRED.bilibili){
    const gift=catalog.filter(g=>g.name===name&&!used.has(g.id)).sort((a,b)=>a.price-b.price||a.id-b.id)[0];
    if(!gift)continue;used.add(gift.id);
    rules.push({gift_id:gift.id,gift_name:gift.name,effect,value:{boss:1500,monster:3,swarm:12,heal:100,hurt:100,disarm:5,blade:1,weapon:1,nuke:1}[effect]});
  }
  return rules;
}
function viewer(event){return {user:String(event.user||'观众').trim().slice(0,24)||'观众',uid:String(event.uid??'').slice(0,40),face:safeFace(event.face)};}

class MowerGame extends EventEmitter{
  constructor(dir,{platform='bilibili',catalog=[],now=Date.now}={}){
    super();this.file=path.join(dir,'mower.json');this.platform=platform;this.catalog=catalog;this.now=now;
    this.queue=Promise.resolve();this.cues=[];this.cooldowns=new Map();this.reported=new Set();
  }
  async init(){
    const saved=await readJson(this.file,null);
    if(!saved){
      this.state={config:normalizeConfig({gift_rules:defaultRules(this.platform,this.catalog)}),mode:'idle',round:1,seq:0,stats:{bosses_defeated:0,hero_downs:0},duels:[]};
      await atomicJson(this.file,this.state);
    }else{
      const s=saved;
      if(!['idle','running','paused'].includes(s.mode)||!Number.isInteger(s.round)||!Number.isInteger(s.seq)||!s.stats||!Array.isArray(s.duels))throw new Error('割草存档无效，原文件已保留');
      this.state={config:normalizeConfig(s.config),mode:s.mode==='running'?'paused':s.mode,round:s.round,seq:s.seq,stats:{bosses_defeated:Number(s.stats.bosses_defeated)||0,hero_downs:Number(s.stats.hero_downs)||0},duels:s.duels.slice(0,MAX_DUELS)};
    }
    return this;
  }
  snapshot(){return {...structuredClone(this.state),cues:this.cues.slice(),platform:this.platform,now:this.now(),effects:EFFECTS};}
  serial(work){const run=this.queue.then(work);this.queue=run.catch(()=>{});return run;}
  async commit(work){
    const before=structuredClone(this.state);
    try{if(work()===false)return this.snapshot();await atomicJson(this.file,this.state);}
    catch(error){this.state=before;throw error;}
    return this.publish();
  }
  publish(){const next=this.snapshot();this.emit('state',next);return next;}
  cue(kind,who,extra={}){
    const cue={seq:++this.state.seq,id:randomUUID(),round:this.state.round,kind,time:this.now(),...who,...extra};
    this.cues.push(cue);if(this.cues.length>MAX_CUES)this.cues.splice(0,this.cues.length-MAX_CUES);
    if(cue.kind==='boss')this.reported.delete(cue.id);
    return cue;
  }
  // 一条礼物可能命中多条规则（同一个礼物绑了两个作用），每条都发指令。
  applyGift(event,rules=this.state.config.gift_rules.filter(r=>matches(r,event))){
    if(!rules.length)return false;
    const count=Math.max(1,Math.min(100000,Math.floor(Number(event.count)||1))),who=viewer(event),gift=String(event.giftName||rules[0].gift_name).slice(0,100);
    for(const r of rules){
      const value=NO_VALUE.has(r.effect)?1:r.effect==='monster'?r.value:Math.min(TOTAL_LIMITS[r.effect],r.value*count);
      this.cue(r.effect,who,{gift,count,value});
    }
    return true;
  }
  receiveBatch(events){return this.serial(()=>{
    if(this.state.mode!=='running')return;
    let changed=false;for(const event of events)changed=this.applyGift(event)||changed;
    if(changed)this.publish();
  });}
  chatKind(event){
    const c=this.state.config,message=typeof event.text==='string'?event.text.trim():'';if(!message)return null;
    const hit=word=>word&&(c.chat_match_mode==='exact'?message===word:message.includes(word));
    return hit(c.chat_spawn_keyword)?'minion':hit(c.chat_heal_keyword)?'heal':null;
  }
  receiveChat(event){return this.serial(()=>{
    if(this.state.mode!=='running')return;
    const kind=this.chatKind(event);if(!kind)return;
    const who=viewer(event),key=who.uid&&who.uid!=='0'?'uid:'+who.uid:'name:'+who.user,now=this.now();
    if(now-(this.cooldowns.get(key)??-Infinity)<this.state.config.user_cooldown_seconds*1000)return;
    this.cooldowns.set(key,now);while(this.cooldowns.size>10000)this.cooldowns.delete(this.cooldowns.keys().next().value);
    this.cue(kind,who,{chat:true,value:kind==='heal'?this.state.config.chat_heal_value:this.state.config.chat_spawn_count});
    this.publish();
  });}
  // 点赞攒够数量就召唤最低级的小草（抖音一条点赞消息可能带很多个赞，一次最多20只）。
  receiveLike(event){return this.serial(()=>{
    const c=this.state.config;if(this.state.mode!=='running'||!c.like_spawn)return;
    this.likeBank=(this.likeBank||0)+Math.max(1,Math.min(100000,Math.floor(Number(event.count)||1)));
    const n=Math.min(20,Math.floor(this.likeBank/c.likes_per_monster));if(!n)return;
    this.likeBank=Math.min(this.likeBank-n*c.likes_per_monster,c.likes_per_monster*20);
    this.cue('like',viewer(event),{value:n});this.publish();
  });}
  action(input){return this.serial(()=>{
    if(!input||typeof input!=='object')throw new Error('割草操作无效');
    const s=this.state;
    switch(input.action){
      case 'configure':return this.commit(()=>{s.config=normalizeConfig({...s.config,...input.config});});
      case 'start':if(s.mode==='running')throw new Error('游戏已经在进行');return this.commit(()=>{s.mode='running';});
      case 'pause':if(s.mode!=='running')throw new Error('当前没有正在进行的游戏');return this.commit(()=>{s.mode='paused';});
      case 'reset':this.cues=[];this.reported.clear();return this.commit(()=>{s.mode='idle';s.round++;});
      case 'clear_history':return this.commit(()=>{s.duels=[];s.stats={bosses_defeated:0,hero_downs:0};});
      case 'simulate':{
        if(s.mode!=='running')throw new Error('请先开始游戏，再试送');
        const rule=normalizeRule(input.rule),count=number(Number(input.count??1),1,1000,'试送数量',true);
        const user=typeof input.user==='string'&&input.user.trim()?input.user.trim().slice(0,24):'测试观众';
        this.applyGift({giftId:rule.gift_id,giftName:rule.gift_name,count,user,uid:'test:'+user},[rule]);
        return this.publish();
      }
      // 画面网页回报一场 BOSS 决斗的结果；同一只 BOSS 只记第一次（可能同时开着好几个画面）。
      case 'report':{
        const cue=this.cues.find(c=>c.id===input.cue_id&&c.kind==='boss');
        if(!cue||this.reported.has(cue.id)||!['win','lose'].includes(input.result))return this.snapshot();
        this.reported.add(cue.id);
        return this.commit(()=>{
          if(input.result==='win')s.stats.bosses_defeated++;else s.stats.hero_downs++;
          s.duels.unshift({id:cue.id,user:cue.user,face:cue.face,gift:cue.gift,count:cue.count,hp:Number.isInteger(input.hp)?input.hp:cue.value,result:input.result,time:this.now()});
          s.duels.length=Math.min(s.duels.length,MAX_DUELS);
        });
      }
      default:throw new Error('未知割草操作');
    }
  });}
  deactivate(){return this.serial(()=>this.state.mode==='running'?this.commit(()=>{this.state.mode='paused';}):undefined);}
  async close(){await this.queue;}
}
module.exports={MowerGame,normalizeConfig,normalizeRule,defaultRules,EFFECTS,DEFAULTS};
