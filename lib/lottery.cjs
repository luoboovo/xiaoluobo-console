const {EventEmitter}=require('node:events');
const {randomInt,randomUUID}=require('node:crypto');
const path=require('node:path');
const {readJson,atomicJson}=require('./storage.cjs');
const {safeFace}=require('./avatar.cjs');

const MAX_PLAYERS=200;
const MODES=['wheel','duel','scratch'];
const DEFAULTS={mode:'wheel',keyword:'参加',match:'exact',duration:12,remove_winner:true};
function normalizeConfig(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('抽奖设置格式无效');
  const c={...DEFAULTS,...input};
  if(!MODES.includes(c.mode))throw new Error('请选择大转盘、决斗或刮刮乐');
  if(input.keyword===undefined)c.keyword={wheel:'参加',duel:'决斗',scratch:'刮刮乐'}[c.mode];
  if(typeof c.keyword!=='string'||!c.keyword.trim()||c.keyword.trim().length>40)throw new Error('报名口令需要1～40个字');
  if(!['exact','includes'].includes(c.match))throw new Error('报名匹配方式无效');
  if(!Number.isInteger(c.duration)||c.duration<5||c.duration>60)throw new Error('动画时长需要5～60秒的整数');
  if(typeof c.remove_winner!=='boolean')throw new Error('中奖移出设置无效');
  return {mode:c.mode,keyword:c.keyword.trim(),match:c.match,duration:c.duration,remove_winner:c.remove_winner};
}
function playerName(value){
  if(typeof value!=='string'||!value.trim()||value.trim().length>40)throw new Error('每个名字需要1～40个字');
  return value.trim();
}
function playerId(event){const uid=String(event.uid||'');return uid&&uid!=='0'?'uid:'+uid:'name:'+String(event.user||'').trim();}
class LotteryGame extends EventEmitter{
  constructor(dir,{platform='bilibili',mode='wheel',random=randomInt,now=Date.now}={}){
    super();if(!MODES.includes(mode))throw new Error('抽奖玩法无效');
    this.mode=mode;this.file=path.join(dir,`lottery-${mode}.json`);this.platform=platform;this.random=random;this.now=now;this.queue=Promise.resolve();
  }
  async init(){
    let saved=await readJson(this.file,null),migrated=false;
    if(!saved){
      const legacy=await readJson(path.join(path.dirname(this.file),'lottery.json'),null);
      if(legacy&&this.mode!=='scratch'){
        const owner=(legacy.config?.mode||'wheel')===this.mode;
        saved={config:owner?legacy.config:undefined,players:owner?legacy.players:[],round:owner?legacy.round:null,history:(legacy.history||[]).filter(h=>h.mode===this.mode)};migrated=true;
      }
    }
    this.state={config:normalizeConfig({...saved?.config,mode:this.mode}),players:saved?.players||[],enrolling:false,round:saved?.round||null,history:saved?.history||[]};
    if(!Array.isArray(this.state.players)||this.state.players.length>MAX_PLAYERS||!Array.isArray(this.state.history))throw new Error('抽奖存档格式无效，原文件已保留');
    if(migrated)await atomicJson(this.file,this.state,{compact:true});
    await this.tick();return this;
  }
  snapshot(){
    const state=structuredClone({...this.state,game:this.mode,platform:this.platform,now:this.now(),max_players:MAX_PLAYERS});
    if(this.mode==='scratch'&&state.round){
      const r=state.round,winner=r.players.find(p=>p.id===r.winner_id);
      if((r.peel>0||['tearing','done'].includes(r.status))&&winner)r.ticket_level=winner.level||Array.from(winner.name)[0];
      delete r.order;if(r.status!=='done')r.winner_id=null;
    }
    return state;
  }
  serial(work){const run=this.queue.then(work);this.queue=run.catch(()=>{});return run;}
  async commit(work){
    const before=structuredClone(this.state);
    try{const changed=work();if(changed===false)return this.snapshot();await atomicJson(this.file,this.state,{compact:true});}
    catch(error){this.state=before;throw error;}
    const state=this.snapshot();this.emit('state',state);return state;
  }
  busy(){if(this.state.round&&this.state.round.status!=='done')throw new Error('本轮正在进行，请等待结果');}
  finish(time=this.now()){
    const s=this.state,r=s.round;r.status='done';r.ends_at=time;
    const winner=r.players.find(p=>p.id===r.winner_id);
    s.history.unshift({id:r.id,mode:r.mode,winner:structuredClone(winner),count:r.players.length,time:r.ends_at});s.history=s.history.slice(0,50);
    if(r.remove_winner)s.players=s.players.filter(p=>p.id!==r.winner_id);
  }
  scratchAction(input){
    const r=this.state.round;
    if(!r||input.round_id!==r.id)throw new Error('签卡已更新，请重新选择');
    if(['done','tearing'].includes(r.status)&&input.action==='reveal')return false;
    if(input.action==='cancel'){
      if(r.status!=='revealing'||r.peel>0)throw new Error('已经撕开，不能放回');
      Object.assign(r,{status:'choosing',card_index:null,winner_id:null});return;
    }
    if(['pick','shake'].includes(input.action)){
      if(r.status!=='choosing')throw new Error('已经选定签卡，请先放回或撕开');
      if(input.action==='shake'){r.layout_seed++;r.shaken_at=this.now();return;}
      const card=input.card===undefined?this.random(r.players.length):input.card;
      if(!Number.isInteger(card)||card<0||card>=r.players.length)throw new Error('请选择有效的签卡');
      Object.assign(r,{card_index:card,winner_id:r.order[card],status:'revealing',peel:0,picked_at:this.now()});return;
    }
    if(r.status!=='revealing')throw new Error('请先选择一张签卡');
    if(input.action==='peel'){
      if(!Number.isFinite(input.progress)||input.progress<0||input.progress>1)throw new Error('撕开进度无效');
      r.peel=Math.max(r.peel||0,input.progress);if(r.peel<1)return;
    }
    Object.assign(r,{status:'tearing',tear_from:r.peel||0,tear_at:this.now(),ends_at:this.now()+(input.action==='peel'?450:1500)});
  }
  action(input){return this.serial(()=>this.commit(()=>{
    if(!input||typeof input!=='object')throw new Error('操作格式无效');
    const s=this.state;
    if(this.mode==='scratch'&&['pick','shake','cancel','peel','reveal'].includes(input.action))return this.scratchAction(input);
    if(!(['reset','replace'].includes(input.action)&&s.round?.status==='choosing'&&this.mode==='scratch'))this.busy();
    switch(input.action){
      case 'configure':
        if(input.config?.mode!==undefined&&input.config.mode!==this.mode)throw new Error('三个玩法的数据源独立，请切换到对应玩法');
        s.config=normalizeConfig({...s.config,...input.config,mode:this.mode});s.round=null;break;
      case 'enroll':
        if(typeof input.open!=='boolean')throw new Error('报名状态无效');
        s.enrolling=input.open;if(input.open)s.round=null;break;
      case 'replace':
        if(this.mode!=='scratch')throw new Error('此操作仅用于签卡奖项');
        s.players=[];s.round=null;s.enrolling=false;
        s.config=normalizeConfig({...s.config,...(input.remove_winner===undefined?{}:{remove_winner:input.remove_winner})});
        if(input.names==='')break;
      case 'add':{
        if(typeof input.names!=='string'||input.names.length>10000)throw new Error('名单格式无效');
        const names=input.names.split(this.mode==='scratch'?/[\r\n,，]+/:/\r?\n/).map(v=>v.trim()).filter(Boolean);
        if(!names.length)throw new Error('请先输入参赛名字，每行一个');
        const keys=new Set(s.players.map(p=>p.id));
        const additions=[];
        for(const line of names){
          const match=this.mode==='scratch'?line.match(/^(.*?)\s*[*×]\s*(-?\d+)$/):null;
          const text=match?match[1]:line,grade=this.mode==='scratch'?text.match(/^#([a-zA-Z0-9-]+)\s*(.*)/):null;
          const name=playerName(grade?grade[2]:text),count=match?Number(match[2]):1;
          if(count<1||count>MAX_PLAYERS)throw new Error('奖项数量需要1～200的整数');
          if(this.mode==='scratch'){
            const levels=new Set([...s.players,...additions].map(p=>p.level));
            const level=grade?grade[1].toUpperCase():[...s.players,...additions].find(p=>p.name===name)?.level||'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(v=>!levels.has(v))||'';
            for(let i=0;i<count;i++)additions.push({id:'ticket:'+randomUUID(),name,level,source:'manual'});
          }else{const id='manual:'+name.toLocaleLowerCase();if(!keys.has(id)){keys.add(id);additions.push({id,name,source:'manual'});}}
        }
        if(s.players.length+additions.length>MAX_PLAYERS)throw new Error(`每轮最多${MAX_PLAYERS}人，请减少名单`);
        if(!additions.length)return false;
        s.players.push(...additions);s.round=null;break;
      }
      case 'remove':s.players=s.players.filter(p=>p.id!==input.id);s.round=null;break;
      case 'clear':s.players=[];s.round=null;s.enrolling=false;break;
      case 'reset':s.round=null;break;
      case 'start':{
        const min=s.config.mode==='duel'?2:1;
        if(s.players.length<min)throw new Error(`至少需要${min}位参与者`);
        // Fisher–Yates gives every entrant the same chance; the server owns the result.
        const order=s.players.map(p=>p.id);
        for(let i=order.length-1;i>0;i--){const j=this.random(i+1);[order[i],order[j]]=[order[j],order[i]];}
        const started=this.now();
        s.round={id:randomUUID(),mode:this.mode,status:this.mode==='scratch'?'choosing':'running',players:structuredClone(s.players),order,winner_id:this.mode==='scratch'?null:order.at(-1),started_at:started,ends_at:started+s.config.duration*1000,remove_winner:s.config.remove_winner};
        if(this.mode==='scratch')Object.assign(s.round,{card_index:null,layout_seed:s.players.length+17,shaken_at:started-2000,peel:0});
        s.enrolling=false;break;
      }
      default:throw new Error('未知抽奖操作');
    }
  }));}
  receiveChat(event){return this.serial(()=>{
    const s=this.state,c=s.config;
    if(!s.enrolling||s.round&&s.round.status!=='done'||s.players.length>=MAX_PLAYERS||typeof event.text!=='string')return;
    const text=event.text.trim();
    if(c.match==='exact'?text!==c.keyword:!text.includes(c.keyword))return;
    if(typeof event.user!=='string'||!event.user.trim())return;
    const id=playerId(event);
    if(s.players.some(p=>p.id===id))return;
    return this.commit(()=>{s.players.push({id,name:Array.from(event.user.trim()).slice(0,40).join(''),source:'chat',face:safeFace(event.face)});});
  });}
  rememberFace(event){
    const face=safeFace(event.face);if(!face)return;
    return this.serial(()=>{
      const id=playerId(event),players=[...this.state.players,...(this.state.round?.players||[])].filter(p=>p.id===id&&p.face!==face);
      if(!players.length)return;
      return this.commit(()=>{for(const player of players)player.face=face;});
    });
  }
  tick(){return this.serial(()=>{
    const s=this.state,r=s.round;
    if(!['running','tearing'].includes(r?.status)||this.now()<r.ends_at)return;
    return this.commit(()=>{
      this.finish(r.ends_at);
    });
  });}
  deactivate(){return this.serial(()=>this.commit(()=>{
    this.state.enrolling=false;
    if(this.state.round&&this.state.round.status!=='done')this.state.round=null;
  }));}
  async close(){await this.queue;}
}
module.exports={LotteryGame,normalizeConfig,MAX_PLAYERS,MODES};
