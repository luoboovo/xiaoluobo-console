const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {readJson,atomicJson}=require('./storage.cjs');

// 泽小酱闯关：左边泽小酱军团（弹幕「1」），右边鱼僵军阵营（弹幕「2」）。
// 战斗在画面网页里实时模拟；服务端只管设置、开局状态，并把弹幕/礼物变成按顺序编号的「指令」发给画面。
// 指令只在内存里排队（不落盘），画面断线重连后只接新的指令。
// 兵种和技能的名字主播可以自己改（控制台「兵种名字」），这里是默认名。
const NAME_DEFAULTS={clown:'小丑兵',web:'蛛网侠',venom:'黑毒侠',blue:'蓝皮侠',spear:'红肚兜小将',gourd:'紫葫芦娃',white:'白毛大佬',giant:'胖光之巨人',thug:'条纹小弟',guard:'抱胸亲卫',whip:'虾线攻击',spray:'辣椒水'};
const NAME_KEYS=Object.keys(NAME_DEFAULTS);
function effectLabels(names=NAME_DEFAULTS){
  return {web:'召唤'+names.web,venom:'召唤'+names.venom,blue:'召唤'+names.blue,spear:'召唤'+names.spear,gourd:'召唤'+names.gourd,white:'召唤'+names.white,giant:names.giant+'（全屏光线）',
    guard:'鱼僵军：召唤'+names.guard,whip:'鱼僵军：'+names.whip,spray:'鱼僵军：'+names.spray+'（小丑全跑）'};
}
const EFFECTS=effectLabels();
const SIDE={web:'L',venom:'L',blue:'L',spear:'L',gourd:'L',white:'L',giant:'L',guard:'R',whip:'R',spray:'R'};
// 每个礼物召唤几个；技能类固定 1 次。连送按数量相乘，但一次最多这么多（防止刷屏卡顿）
const SKILLS=new Set(['giant','whip','spray']);
const TOTAL_LIMIT={unit:20,skill:3};
const MAX_RULES=50,MAX_CUES=300;
const DEFAULTS={chat_left_keyword:'1',chat_right_keyword:'2',chat_match_mode:'exact',user_cooldown_seconds:3,legend_scale:100,names:NAME_DEFAULTS,gift_rules:[]};

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
  return {gift_id:number(Number(rule.gift_id||0),0,999999999,'礼物ID',true),gift_name:text(rule.gift_name,100,'礼物名称'),effect:rule.effect,
    value:SKILLS.has(rule.effect)?1:number(Number(rule.value),1,10,EFFECTS[rule.effect]+'数量',true)};
}
function normalizeConfig(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('闯关设置无效');
  const c={...DEFAULTS,...input};
  const next={
    chat_left_keyword:text(c.chat_left_keyword,20,'加入泽小酱口令'),
    chat_right_keyword:text(c.chat_right_keyword,20,'加入鱼僵军口令'),
    chat_match_mode:['exact','includes'].includes(c.chat_match_mode)?c.chat_match_mode:(()=>{throw new Error('弹幕匹配方式无效');})(),
    user_cooldown_seconds:number(c.user_cooldown_seconds,0,60,'每人弹幕CD'),
    // 画面顶部礼物说明卡片的大小（%）
    legend_scale:number(Number(c.legend_scale),50,200,'礼物说明大小',true),
    names:normalizeNames(c.names),
    gift_rules:Array.isArray(c.gift_rules)&&c.gift_rules.length<=MAX_RULES?c.gift_rules.map(normalizeRule):(()=>{throw new Error(`礼物规则最多${MAX_RULES}条`);})()
  };
  if(next.chat_left_keyword===next.chat_right_keyword)throw new Error('两边的加入口令不能相同');
  return next;
}
function normalizeNames(input){
  if(input==null)return {...NAME_DEFAULTS};
  if(typeof input!=='object'||Array.isArray(input))throw new Error('兵种名字无效');
  // 没填的用默认名；填了就要 1～8 个字
  return Object.fromEntries(NAME_KEYS.map(key=>[key,input[key]===undefined||input[key]===''?NAME_DEFAULTS[key]:text(input[key],8,NAME_DEFAULTS[key]+'的名字')]));
}
function matches(rule,event){return rule.gift_id?(rule.gift_id===event.giftId||event.giftAliases?.includes(rule.gift_id)):rule.gift_name===event.giftName;}
// 新存档的默认礼物：按平台偏好名称选，礼物库里没有就跳过（不影响启动）。
const PREFERRED={
  bilibili:[['web','小花花'],['venom','打call'],['blue','牛哇牛哇'],['spear','人气票'],['gourd','这个好诶'],['white','吃瓜'],['giant','棒棒糖'],['guard','心动卡'],['whip','凉了'],['spray','冲浪']],
  douyin:[['web','小心心'],['venom','玫瑰'],['blue','人气票'],['spear','鲜花'],['gourd','棒棒糖'],['white','比心'],['giant','大啤酒'],['guard','番茄'],['whip','你最好看'],['spray','平底锅']]
};
function defaultRules(platform,catalog=[]){
  const rules=[],used=new Set();
  for(const [effect,name] of PREFERRED[platform]||PREFERRED.bilibili){
    const gift=catalog.filter(g=>g.name===name&&!used.has(g.id)).sort((a,b)=>a.price-b.price||a.id-b.id)[0];
    if(!gift)continue;used.add(gift.id);
    rules.push({gift_id:gift.id,gift_name:gift.name,effect,value:1});
  }
  return rules;
}
function viewer(event){return {user:String(event.user||'观众').trim().slice(0,24)||'观众',uid:String(event.uid??'').slice(0,40)};}

class BattleGame extends EventEmitter{
  constructor(dir,{platform='bilibili',catalog=[],now=Date.now}={}){
    super();this.file=path.join(dir,'battle.json');this.platform=platform;this.catalog=catalog;this.now=now;
    this.queue=Promise.resolve();this.cues=[];this.cooldowns=new Map();this.reported=new Set();
  }
  async init(){
    const saved=await readJson(this.file,null);
    if(!saved){
      this.state={config:normalizeConfig({gift_rules:defaultRules(this.platform,this.catalog)}),mode:'idle',round:1,seq:0,stats:{wins:0,losses:0},history:[]};
      await atomicJson(this.file,this.state);
    }else{
      const s=saved;
      if(!['idle','running','paused'].includes(s.mode)||!Number.isInteger(s.round)||!Number.isInteger(s.seq)||!s.stats||!Array.isArray(s.history))throw new Error('闯关存档无效，原文件已保留');
      this.state={config:normalizeConfig(s.config),mode:s.mode==='running'?'paused':s.mode,round:s.round,seq:s.seq,stats:{wins:Number(s.stats.wins)||0,losses:Number(s.stats.losses)||0},history:s.history.slice(0,30)};
    }
    return this;
  }
  snapshot(){return {...structuredClone(this.state),cues:this.cues.slice(),platform:this.platform,now:this.now(),effects:effectLabels(this.state.config.names),sides:SIDE,nameDefaults:NAME_DEFAULTS};}
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
    return cue;
  }
  applyGift(event,rules=this.state.config.gift_rules.filter(r=>matches(r,event))){
    if(!rules.length)return false;
    const count=Math.max(1,Math.min(100000,Math.floor(Number(event.count)||1))),who=viewer(event),gift=String(event.giftName||rules[0].gift_name).slice(0,100);
    for(const r of rules){
      const value=SKILLS.has(r.effect)?Math.min(TOTAL_LIMIT.skill,count):Math.min(TOTAL_LIMIT.unit,r.value*count);
      this.cue(r.effect,who,{side:SIDE[r.effect],gift,count,value});
    }
    return true;
  }
  receiveBatch(events){return this.serial(()=>{
    if(this.state.mode!=='running')return;
    let changed=false;for(const event of events)changed=this.applyGift(event)||changed;
    if(changed)this.publish();
  });}
  chatSide(event){
    const c=this.state.config,message=typeof event.text==='string'?event.text.trim():'';if(!message)return null;
    const hit=word=>word&&(c.chat_match_mode==='exact'?message===word:message.includes(word));
    return hit(c.chat_left_keyword)?'L':hit(c.chat_right_keyword)?'R':null;
  }
  receiveChat(event){return this.serial(()=>{
    if(this.state.mode!=='running')return;
    const side=this.chatSide(event);if(!side)return;
    const who=viewer(event),key=who.uid&&who.uid!=='0'?'uid:'+who.uid:'name:'+who.user,now=this.now();
    if(now-(this.cooldowns.get(key)??-Infinity)<this.state.config.user_cooldown_seconds*1000)return;
    this.cooldowns.set(key,now);while(this.cooldowns.size>10000)this.cooldowns.delete(this.cooldowns.keys().next().value);
    this.cue('join',who,{side,chat:true,value:1});
    this.publish();
  });}
  action(input){return this.serial(()=>{
    if(!input||typeof input!=='object')throw new Error('闯关操作无效');
    const s=this.state;
    switch(input.action){
      case 'configure':return this.commit(()=>{s.config=normalizeConfig({...s.config,...input.config});});
      case 'start':if(s.mode==='running')throw new Error('游戏已经在进行');return this.commit(()=>{s.mode='running';});
      case 'pause':if(s.mode!=='running')throw new Error('当前没有正在进行的游戏');return this.commit(()=>{s.mode='paused';});
      case 'reset':this.cues=[];return this.commit(()=>{s.mode='idle';s.round++;});
      case 'clear_history':return this.commit(()=>{s.history=[];s.stats={wins:0,losses:0};});
      case 'simulate':{
        if(s.mode!=='running')throw new Error('请先开始游戏，再试送');
        const user=typeof input.user==='string'&&input.user.trim()?input.user.trim().slice(0,24):'测试观众';
        if(input.join){
          if(!['L','R'].includes(input.join))throw new Error('阵营无效');
          this.cue('join',{user,uid:'test:'+user},{side:input.join,chat:true,value:1});return this.publish();
        }
        const rule=normalizeRule(input.rule),count=number(Number(input.count??1),1,100,'试送数量',true);
        this.applyGift({giftId:rule.gift_id,giftName:rule.gift_name,count,user,uid:'test:'+user},[rule]);
        return this.publish();
      }
      // 画面网页回报一局的结果；同一局只记第一次（可能同时开着好几个画面）。
      case 'report':{
        const key=`${s.round}:${Number(input.match)||0}`;
        if(!['win','lose'].includes(input.result)||this.reported.has(key))return this.snapshot();
        this.reported.add(key);while(this.reported.size>200)this.reported.delete(this.reported.values().next().value);
        const mvp=Array.isArray(input.mvp)?input.mvp.slice(0,3).map(v=>({name:String(v?.name||'').slice(0,24),dmg:Math.max(0,Math.round(Number(v?.dmg)||0))})).filter(v=>v.name):[];
        return this.commit(()=>{
          if(input.result==='win')s.stats.wins++;else s.stats.losses++;
          s.history.unshift({id:randomUUID(),result:input.result,mvp,time:this.now()});
          s.history.length=Math.min(s.history.length,30);
        });
      }
      default:throw new Error('未知闯关操作');
    }
  });}
  deactivate(){return this.serial(()=>this.state.mode==='running'?this.commit(()=>{this.state.mode='paused';}):undefined);}
  async close(){await this.queue;}
}
module.exports={BattleGame,normalizeConfig,normalizeRule,defaultRules,effectLabels,EFFECTS,SIDE,DEFAULTS,NAME_DEFAULTS};
