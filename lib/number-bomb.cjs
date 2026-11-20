const {EventEmitter}=require('node:events');
const {randomInt}=require('node:crypto');
const path=require('node:path');
const {readJson,atomicJson}=require('./storage.cjs');
const {safeFace}=require('./avatar.cjs');

const MAX_PLAYERS=100,MAX_KICKED=500;
// 主播在画面上点数字介入时用的身份：不占名单、不排队、不受 CD 限制。
const HOST={id:'host',name:'主播',face:''};
function normalizeConfig(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('数字炸弹设置无效');
  const {keyword='参与数字炸弹',min=1,max=100,user_cooldown_seconds=3,guess_mode='free'}=input;
  if(typeof keyword!=='string'||!keyword.trim()||keyword.trim().length>40)throw new Error('报名口令需要1～40个字');
  if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max>999999||min>=max)throw new Error('范围需要0～999999的整数，最小值须小于最大值');
  if(!Number.isFinite(user_cooldown_seconds)||user_cooldown_seconds<0||user_cooldown_seconds>60)throw new Error('每人猜数CD需要0～60秒');
  if(!['free','queue'].includes(guess_mode))throw new Error('猜数模式无效');
  return {keyword:keyword.trim(),min,max,user_cooldown_seconds,guess_mode};
}
function playerId(event){
  const uid=String(event.uid??'');
  return uid&&uid!=='0'?'uid:'+uid:'name:'+String(event.user||'').trim();
}
class NumberBomb extends EventEmitter{
  constructor(dir,{platform='bilibili',random=randomInt,now=Date.now}={}){
    super();this.file=path.join(dir,'number-bomb.json');this.platform=platform;this.random=random;this.now=now;this.queue=Promise.resolve();
  }
  async init(){
    const saved=await readJson(this.file,null);
    this.state={config:normalizeConfig(saved?.config),phase:saved?.phase||'enrolling',players:saved?.players||[],kicked:saved?.kicked||[],round:saved?.round||null,sequence:0};
    const s=this.state,r=s.round;
    if(!['enrolling','running','paused','exploded'].includes(s.phase)||!Array.isArray(s.players)||s.players.length>MAX_PLAYERS||s.players.some(p=>!p||typeof p.id!=='string'||typeof p.name!=='string'||p.name.length>40)||new Set(s.players.map(p=>p.id)).size!==s.players.length||!Array.isArray(s.kicked)||s.kicked.length>MAX_KICKED||s.kicked.some(id=>typeof id!=='string')||
      (s.phase!=='enrolling'&&!r)||r&&(!Number.isInteger(r.secret)||!Number.isInteger(r.min)||!Number.isInteger(r.max)||r.min<s.config.min||r.max>s.config.max||r.secret<r.min||r.secret>r.max||!Array.isArray(r.guesses)||r.guesses.length>20||!s.players.length||s.phase==='enrolling'||r.turn_id!==undefined&&!s.players.some(p=>p.id===r.turn_id)||(s.phase==='exploded'&&r.loser_id!==HOST.id&&!s.players.some(p=>p.id===r.loser_id))))throw new Error('数字炸弹存档无效，原文件已保留');
    for(const p of s.players){p.face=safeFace(p.face);delete p.message;}
    if(r){r.guessed_by??=Object.fromEntries(r.guesses.map(g=>[g.value,g.id]));r.turn_id??=s.players[0].id;}
    if(s.phase==='running')s.phase='paused';
    return this;
  }
  snapshot(){
    const snapshot=structuredClone({...this.state,platform:this.platform,now:this.now(),max_players:MAX_PLAYERS,host:HOST});
    delete snapshot.kicked;
    if(snapshot.round&&snapshot.phase!=='exploded')delete snapshot.round.secret;
    return snapshot;
  }
  serial(work){const run=this.queue.then(work);this.queue=run.catch(()=>{});return run;}
  async commit(work){
    const before=structuredClone(this.state);
    try{
      if(work()===false)return this.snapshot();
      await atomicJson(this.file,this.state,{compact:true});
    }catch(error){this.state=before;throw error;}
    const next=this.snapshot();this.emit('state',next);return next;
  }
  action(input){return this.serial(()=>this.commit(()=>{
    if(!input||typeof input!=='object')throw new Error('数字炸弹操作无效');
    const s=this.state;
    switch(input.action){
      case 'configure':
        if(s.phase!=='enrolling')throw new Error('请先重新报名，再修改设置');
        s.config=normalizeConfig({...s.config,...input.config});break;
      case 'start':
        if(s.phase!=='enrolling')throw new Error('本轮已经开始');
        if(!s.players.length)throw new Error('至少需要一位观众报名');
        this.newRound();break;
      case 'restart':
        if(s.phase==='enrolling')throw new Error('还没开始，直接点「开始游戏」');
        if(!s.players.length)throw new Error('至少需要一位观众报名');
        this.newRound();break;
      case 'pause':if(s.phase!=='running')throw new Error('当前没有正在进行的游戏');s.phase='paused';break;
      case 'resume':if(s.phase!=='paused')throw new Error('当前游戏没有暂停');s.phase='running';break;
      case 'reset':s.phase='enrolling';s.players=[];s.kicked=[];s.round=null;break;
      case 'kick':{
        const index=s.players.findIndex(p=>p.id===input.id);
        if(index<0)throw new Error('这位观众已经不在名单里了');
        const r=s.round;
        if(s.phase==='exploded'&&r.loser_id===input.id)throw new Error('踩中炸弹的观众要先「重开」或「重新报名」才能踢出');
        s.players.splice(index,1);
        if(!s.kicked.includes(input.id)){s.kicked.push(input.id);if(s.kicked.length>MAX_KICKED)s.kicked.shift();}
        if(!s.players.length&&s.phase!=='enrolling'){s.phase='enrolling';s.round=null;}
        else if(r&&r.turn_id===input.id)r.turn_id=s.players[index%s.players.length].id;
        break;
      }
      case 'guess':{
        // 主播随时介入：不管排队顺序和 CD，直接猜一个范围内的数
        if(s.phase!=='running')throw new Error(s.phase==='paused'?'游戏已暂停，继续后才能点数字':'游戏还没开始');
        const value=input.value,r=s.round;
        if(!Number.isInteger(value)||value<r.min||value>r.max)throw new Error('只能点还没排除的数字');
        this.applyGuess(HOST,value);break;
      }
      case 'reorder':{
        if(s.config.guess_mode!=='queue')throw new Error('请先开启排队模式');
        if(s.phase==='exploded')throw new Error('本轮已结束，请重新报名');
        const ids=input.ids,byId=new Map(s.players.map(p=>[p.id,p]));
        if(!Array.isArray(ids)||ids.length!==s.players.length||new Set(ids).size!==ids.length||ids.some(id=>!byId.has(id)))throw new Error('名单已更新，请按当前完整名单重新排序');
        s.players=ids.map(id=>byId.get(id));break;
      }
      default:throw new Error('未知数字炸弹操作');
    }
  }));}
  receiveChat(event){return this.serial(async()=>{
    const s=this.state;
    if(!['enrolling','running'].includes(s.phase)||typeof event.text!=='string')return;
    const id=playerId(event),text=event.text.trim();
    if(id==='name:')return;
    let player=s.players.find(p=>p.id===id);
    const joining=s.phase==='enrolling'&&!player&&text===s.config.keyword&&!s.kicked.includes(id);
    if(!player&&!joining||joining&&s.players.length>=MAX_PLAYERS)return;
    const numeric=/^\d{1,6}$/.test(text),value=Number(text),r=s.round;
    const valid=s.phase==='running'&&numeric&&value>=r.min&&value<=r.max;
    const wrongTurn=s.phase==='running'&&numeric&&s.config.guess_mode==='queue'&&r.turn_id!==id;
    const now=this.now(),retryAt=(player?.last_guess_at??-Infinity)+s.config.user_cooldown_seconds*1000;
    const cooling=valid&&!wrongTurn&&now<retryAt,accepted=valid&&!wrongTurn&&!cooling;
    const update=()=>{
      if(joining){player={id,name:String(event.user||'观众').trim().slice(0,40)||'观众',face:safeFace(event.face)};s.players.push(player);}
      const face=safeFace(event.face);if(face)player.face=face;
      const kind=wrongTurn?'turn':cooling?'cooldown':valid?(value===r.secret?'hit':value<r.secret?'low':'high'):s.phase==='running'&&numeric?'outside':'chat';
      player.message={text:text.slice(0,80),time:now,sequence:++s.sequence,kind,...(cooling?{retry_at:retryAt}:{})};
      if(accepted){
        player.last_guess_at=now;
        this.applyGuess(player,value);
        if(s.config.guess_mode==='queue'&&kind!=='hit')r.turn_id=s.players[(s.players.findIndex(p=>p.id===id)+1)%s.players.length].id;
      }
    };
    if(joining||accepted)return this.commit(update);
    update();this.emit('state',this.snapshot());
  });}
  newRound(){
    const s=this.state;
    s.round={min:s.config.min,max:s.config.max,secret:s.config.min+this.random(s.config.max-s.config.min+1),guesses:[],guessed_by:{},count:0,loser_id:null,turn_id:s.players[0].id};
    for(const p of s.players){delete p.message;delete p.last_guess_at;}
    s.phase='running';
  }
  applyGuess(player,value){
    const s=this.state,r=s.round,kind=value===r.secret?'hit':value<r.secret?'low':'high';
    r.guessed_by[value]=player.id;
    if(kind==='hit'){s.phase='exploded';r.loser_id=player.id;}
    else if(kind==='low')r.min=value+1;else r.max=value-1;
    r.guesses.unshift({id:player.id,name:player.name,value,kind,min:r.min,max:r.max,time:this.now()});r.guesses.length=Math.min(r.guesses.length,20);r.count++;
  }
  rememberFace(event){
    const face=safeFace(event.face);if(!face)return Promise.resolve();
    return this.serial(()=>{
      const player=this.state.players.find(p=>p.id===playerId(event));
      if(!player||player.face===face)return;
      return this.commit(()=>{player.face=face;});
    });
  }
  deactivate(){return this.serial(()=>this.state.phase==='running'?this.commit(()=>{this.state.phase='paused';}):undefined);}
  async close(){await this.queue;}
}
module.exports={NumberBomb,normalizeConfig,MAX_PLAYERS,HOST};
