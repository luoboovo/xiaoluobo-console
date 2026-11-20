// 萝卜割草 · 直播画面。服务端只发指令（礼物/弹幕），战斗在这里按帧模拟。
// 每个打开的画面各自模拟；BOSS 决斗结果由先算完的画面回报，服务端只记第一次。
(()=>{
const W=1280,H=720,TAU=Math.PI*2;
let HERO_R=24;
const canvas=document.getElementById('mower-canvas'),ctx=canvas.getContext('2d');
const params=new URLSearchParams(location.search),transparent=params.has('transparent'),speedUp=Math.min(8,Math.max(1,Number(params.get('speed'))||1));
if(transparent)document.body.classList.add('transparent');
const clamp=(v,a,b)=>v<a?a:v>b?b:v,rand=(a,b)=>a+Math.random()*(b-a),dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
let scale=1,bg=null;
function fit(){
  const s=Math.min(innerWidth/W,innerHeight/H);scale=clamp(s*(devicePixelRatio||1),1,2);
  canvas.width=Math.round(W*scale);canvas.height=Math.round(H*scale);
  Object.assign(canvas.style,{width:W*s+'px',height:H*s+'px',left:(innerWidth-W*s)/2+'px',top:(innerHeight-H*s)/2+'px'});
  bg=null;
}
addEventListener('resize',fit);fit();

// —— 头像缓存：只走本机 /api/avatar 代理 ——
const faces=new Map();
function faceImage(face){
  if(!face)return null;let entry=faces.get(face);
  if(!entry){
    if(faces.size>400)faces.delete(faces.keys().next().value);
    const img=new Image();entry={img,ok:false};img.onload=()=>{entry.ok=true;};img.src='/api/avatar?url='+encodeURIComponent(face);faces.set(face,entry);
  }
  return entry.ok?entry.img:null;
}
const PALETTE=['#f3a46b','#7fb7e6','#d38fd8','#f2c94c','#6fcf97','#eb7a7a'];
const colorOf=name=>{let h=0;for(const ch of String(name))h=(h*31+ch.codePointAt(0))>>>0;return PALETTE[h%PALETTE.length];};
function drawAvatar(face,name,x,y,r,ring,ringWidth=3){
  const img=faceImage(face);
  ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.closePath();
  ctx.fillStyle=colorOf(name);ctx.fill();ctx.clip();
  if(img)ctx.drawImage(img,x-r,y-r,r*2,r*2);
  else{ctx.fillStyle='#fff';ctx.font=`bold ${Math.round(r*1.05)}px "Microsoft YaHei",sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(Array.from(String(name||'？'))[0]||'？',x,y+1);}
  ctx.restore();
  if(ring){ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.lineWidth=ringWidth;ctx.strokeStyle=ring;ctx.stroke();}
}

// —— 主角：小萝卜（与加班机里的萝卜同款造型） ——
const radish={
  leaves:[['M33 22C27 13 30 7 35 6c4 6 4 11-2 16Z','#9dbc80'],['M34 22C39 11 47 9 49 14c-1 6-8 9-15 8Z','#bad699'],['M32 22C21 19 17 14 20 10c8 1 13 6 12 12Z','#b4ce92']].map(([d,c])=>[new Path2D(d),c]),
  body:new Path2D('M21 25c5-6 19-6 24 1 6 10-1 24-13 31-12-7-18-22-11-32Z'),mouth:new Path2D('M30 40q3 4 6 0'),shine:new Path2D('m24 48 5 1m7-21 5 2')
};
const radishGradient=ctx.createLinearGradient(20,22,46,56);radishGradient.addColorStop(0,'#ffcfaa');radishGradient.addColorStop(1,'#f09b68');
// —— 主播上传的主角图片（PNG/GIF/WebP）。GIF 用 ImageDecoder 逐帧解码，直接画 <img> 只会停在第一帧 ——
let heroPic={url:'',img:null,anim:null};
function releaseHeroPic(){const a=heroPic.anim;heroPic.anim=null;a?.frame?.close();a?.decoder.close();}
async function loadHeroAnimation(pic,url){
  if(typeof ImageDecoder==='undefined')return;let decoder;
  try{
    const response=await fetch(url);if(!response.ok)throw Error('主角动图加载失败');
    decoder=new ImageDecoder({data:await response.arrayBuffer(),type:response.headers.get('Content-Type')});await decoder.tracks.ready;
    if(heroPic!==pic||!decoder.tracks.selectedTrack?.animated){decoder.close();return;}
    pic.anim={decoder,index:0,nextAt:0,pending:false,frame:null};
  }catch{decoder?.close();dispatchEvent(new CustomEvent('luobo-diagnostic',{detail:{event:'resource_error',message:'割草主角动图解码失败'}}));}
}
function heroPicture(){
  const url=cfg().hero_image||'';
  if(heroPic.url!==url){releaseHeroPic();heroPic={url,img:null,anim:null};if(url){const img=new Image();img.src=url;heroPic.img=img;if(/\.(gif|webp)$/.test(url))loadHeroAnimation(heroPic,url);}}
  const a=heroPic.anim;
  if(a&&!a.pending&&performance.now()>=a.nextAt){
    const track=a.decoder.tracks.selectedTrack;if(a.index>=track.frameCount)a.index=0;a.pending=true;
    a.decoder.decode({frameIndex:a.index}).then(({image})=>{if(heroPic.anim!==a){image.close();return;}a.frame?.close();a.frame=image;a.index++;a.nextAt=performance.now()+Math.max(20,(image.duration??100000)/1000);a.pending=false;}).catch(()=>{a.nextAt=Infinity;a.pending=false;});
  }
  return heroPic.img&&(a?.frame||heroPic.img.complete&&heroPic.img.naturalWidth)?heroPic:null;
}
function drawHero(h,t){
  const bob=Math.sin(t*9)*(Math.hypot(h.vx,h.vy)>20?2.5:1),size=cfg().hero_size||72,pic=heroPicture();
  if(h.vx<-15)h.facing=-1;else if(h.vx>15)h.facing=1;
  ctx.save();ctx.translate(h.x,h.y+bob);
  ctx.fillStyle='rgba(0,0,0,.18)';ctx.beginPath();ctx.ellipse(0,size*.36-bob,size*.32,size*.1,0,0,TAU);ctx.fill();
  if(h.down)ctx.rotate(Math.PI/2);
  if(pic){
    const frame=pic.anim?.frame,src=frame||pic.img,w0=frame?.displayWidth||pic.img.naturalWidth,h0=frame?.displayHeight||pic.img.naturalHeight,k=size/Math.max(w0,h0);
    if((h.facing||1)<0)ctx.scale(-1,1);
    if(h.hurt>0)ctx.filter='brightness(1.2) sepia(1) saturate(8) hue-rotate(-45deg)';
    ctx.drawImage(src,-w0*k/2,-h0*k/2,w0*k,h0*k);
    ctx.restore();
    if(h.shield>0&&!h.down){ctx.beginPath();ctx.arc(h.x,h.y,HERO_R+10,0,TAU);ctx.strokeStyle=`rgba(255,255,255,${.3+.3*Math.sin(t*20)})`;ctx.lineWidth=3;ctx.stroke();}
    return;
  }
  ctx.scale(1.45*size/72,1.45*size/72);ctx.translate(-33,-36);
  for(const [p,c] of radish.leaves){ctx.fillStyle=c;ctx.fill(p);}
  ctx.fillStyle=radishGradient;ctx.fill(radish.body);
  ctx.fillStyle='#79553e';
  if(h.down){ctx.strokeStyle='#79553e';ctx.lineWidth=1.6;for(const ex of [26,39]){ctx.beginPath();ctx.moveTo(ex-2,34);ctx.lineTo(ex+2,38);ctx.moveTo(ex+2,34);ctx.lineTo(ex-2,38);ctx.stroke();}}
  else{ctx.beginPath();ctx.ellipse(26,36,2,2.6,0,0,TAU);ctx.ellipse(39,36,2,2.6,0,0,TAU);ctx.fill();}
  ctx.strokeStyle='#79553e';ctx.lineWidth=1.8;ctx.lineCap='round';ctx.stroke(radish.mouth);
  ctx.fillStyle='#eaa29b';ctx.beginPath();ctx.ellipse(23,40,3.6,2,0,0,TAU);ctx.ellipse(42,40,3.6,2,0,0,TAU);ctx.fill();
  ctx.strokeStyle='#fff0d9';ctx.lineWidth=2;ctx.stroke(radish.shine);
  if(h.hurt>0){ctx.globalAlpha=Math.min(.6,h.hurt*2);ctx.fillStyle='#ff3b30';ctx.fill(radish.body);}
  ctx.restore();
  if(h.shield>0&&!h.down){ctx.beginPath();ctx.arc(h.x,h.y,HERO_R+10,0,TAU);ctx.strokeStyle=`rgba(255,255,255,${.3+.3*Math.sin(t*20)})`;ctx.lineWidth=3;ctx.stroke();}
}
// 镰刀形的旋转刀，割草专用
const sickle=new Path2D();sickle.arc(0,0,19,-Math.PI*.8,Math.PI*.8);sickle.arc(7,0,15,Math.PI*.74,-Math.PI*.74,true);sickle.closePath();
// 武器：默认镰刀，地图上能捡到更强的。伤害倍率乘「每刀伤害」，reach 是砍中判定半径。
const WEAPONS={
  sickle:{name:'镰刀',damage:1,reach:17,spin:14,rank:0},
  sword:{name:'宝剑',damage:1.6,reach:22,spin:0,rank:1},
  glaive:{name:'大刀',damage:2.2,reach:26,spin:0,rank:2},
  axe:{name:'战斧',damage:3,reach:25,spin:7,rank:3}
};
// 每种武器画在原点，+x 朝外（远离主角）
function drawWeapon(kind){
  ctx.lineJoin='round';
  if(kind==='sickle'){ctx.fillStyle='#e9eef2';ctx.fill(sickle);ctx.strokeStyle='#7d8b96';ctx.lineWidth=1.5;ctx.stroke(sickle);ctx.fillStyle='#8a5a35';ctx.beginPath();ctx.arc(0,0,4,0,TAU);ctx.fill();return;}
  if(kind==='sword'){
    ctx.fillStyle='#7a4a2a';ctx.fillRect(-18,-3,12,6);ctx.fillStyle='#e8b931';ctx.beginPath();ctx.arc(-19,0,3.5,0,TAU);ctx.fill();ctx.fillRect(-7,-9,4,18);
    ctx.beginPath();ctx.moveTo(-3,-4.5);ctx.lineTo(24,-3.5);ctx.lineTo(32,0);ctx.lineTo(24,3.5);ctx.lineTo(-3,4.5);ctx.closePath();
    const g=ctx.createLinearGradient(0,-5,0,5);g.addColorStop(0,'#ffffff');g.addColorStop(.5,'#c9d6ea');g.addColorStop(1,'#8fa3bf');ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='#5f7290';ctx.lineWidth=1.2;ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,.8)';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(24,0);ctx.stroke();return;
  }
  if(kind==='glaive'){
    ctx.fillStyle='#3d2a1e';ctx.fillRect(-24,-2.5,26,5);ctx.fillStyle='#d23b3b';ctx.beginPath();ctx.arc(-1,0,4,0,TAU);ctx.fill();ctx.beginPath();ctx.moveTo(-1,2);ctx.lineTo(-6,12);ctx.lineTo(3,10);ctx.fill();
    ctx.beginPath();ctx.moveTo(2,-5);ctx.lineTo(26,-8);ctx.quadraticCurveTo(38,0,28,14);ctx.quadraticCurveTo(14,7,2,6);ctx.closePath();
    const g=ctx.createLinearGradient(0,-8,0,14);g.addColorStop(0,'#ffffff');g.addColorStop(1,'#a9b3bd');ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='#59636d';ctx.lineWidth=1.4;ctx.stroke();
    ctx.fillStyle='#e8b931';ctx.fillRect(1,-6,3,12);return;
  }
  if(kind==='axe'){
    ctx.fillStyle='#7a4a2a';ctx.fillRect(-20,-2.5,40,5);
    ctx.beginPath();ctx.moveTo(10,-3);ctx.quadraticCurveTo(2,-14,14,-22);ctx.quadraticCurveTo(28,-12,20,-3);ctx.closePath();
    ctx.moveTo(10,3);ctx.quadraticCurveTo(2,14,14,22);ctx.quadraticCurveTo(28,12,20,3);ctx.closePath();
    const g=ctx.createLinearGradient(0,-22,0,22);g.addColorStop(0,'#d9dee3');g.addColorStop(.5,'#ffffff');g.addColorStop(1,'#d9dee3');ctx.fillStyle=g;ctx.fill();ctx.strokeStyle='#4c5560';ctx.lineWidth=1.5;ctx.stroke();
    ctx.fillStyle='#e8b931';ctx.beginPath();ctx.arc(15,0,3.5,0,TAU);ctx.fill();
  }
}
function drawBlades(h,t){
  const n=bladeCount(),R=bladeRadius(),base=t*bladeSpeed(),w=WEAPONS[world.weapon];
  ctx.save();ctx.lineCap='round';
  for(let i=0;i<n;i++){
    const a=base+i*TAU/n;
    ctx.beginPath();ctx.arc(h.x,h.y,R,a-.55,a);ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=w.reach*.8;ctx.stroke();
    ctx.save();ctx.translate(h.x+Math.cos(a)*R,h.y+Math.sin(a)*R);ctx.rotate(w.spin?a+t*w.spin:a);drawWeapon(world.weapon);ctx.restore();
  }
  ctx.restore();
}
function bladeCount(){return Math.min(12,cfg().blade_count+world.extraBlades);}
const levelHp=()=>1+.12*(world.heroLevel-1),levelDamage=()=>1+.1*(world.heroLevel-1),levelSpeed=()=>Math.min(2.5,1+.05*(world.heroLevel-1));
const bladeSpeed=()=>cfg().blade_speed*world.speedMul*levelSpeed(),bladeRadius=()=>cfg().blade_radius+world.radiusAdd;
const bladeDamage=()=>Math.max(1,Math.round(cfg().blade_damage*WEAPONS[world.weapon].damage*world.damageMul*levelDamage()));
// 地图道具：增幅 buff 和武器
const BUFFS={
  blade:{label:'+1刀',color:'#5aa9ff',weight:30},speed:{label:'转速',color:'#ffb547',weight:25},range:{label:'范围',color:'#b07cff',weight:15},
  power:{label:'攻击',color:'#ff6b5a',weight:15},heal:{label:'回血',color:'#5fd16f',weight:15}
};
const pickWeighted=list=>{let r=Math.random()*list.reduce((s,[,w])=>s+w,0);for(const [key,w] of list)if((r-=w)<0)return key;return list[0][0];};
function spawnPickup(kind,type,at,by){
  if(world.pickups.length>=6)world.pickups.shift();
  const h=world.hero;let p=at;
  for(let tries=0;!p&&tries<20;tries++){const c={x:rand(80,W-80),y:rand(130,H-80)};if(dist(c,h)>170)p=c;}
  p=p||{x:rand(80,W-80),y:rand(130,H-80)};
  world.pickups.push({id:++uid,kind,type,x:p.x,y:p.y,life:by?30:20,born:world.t,by});
}
function randomPickup(){
  if(Math.random()<.25){spawnPickup('weapon',pickWeighted([['sword',45],['glaive',35],['axe',20]]));return;}
  let type=pickWeighted(Object.entries(BUFFS).map(([k,v])=>[k,v.weight]));
  if(type==='blade'&&bladeCount()>=12)type='power';
  spawnPickup('buff',type);
}
const worthIt=p=>p.kind==='buff'?!(p.type==='heal'&&world.hero.hp>=world.hero.maxHp*.9):WEAPONS[p.type].rank>WEAPONS[world.weapon].rank;
function collect(p){
  const h=world.hero,c=cfg();p.taken=true;
  if(p.kind==='weapon'){
    const w=WEAPONS[p.type];
    if(w.rank>WEAPONS[world.weapon].rank){world.weapon=p.type;floatText(h.x,h.y-50,`换上${w.name}！`,'#ffe27a',24);burst(p.x,p.y,['#ffe27a','#ffffff'],18,220);}
    else{world.damageMul=Math.min(5,world.damageMul+.1);floatText(h.x,h.y-50,`${w.name}熔炼 · 攻击+10%`,'#ffb0a8',18);}
    return;
  }
  const b=BUFFS[p.type];burst(p.x,p.y,[b.color,'#ffffff'],14,180);
  switch(p.type){
    case 'blade':if(bladeCount()<12){world.extraBlades++;floatText(h.x,h.y-50,'+1 刀','#bfe6ff',24);}else{world.damageMul=Math.min(5,world.damageMul+.2);floatText(h.x,h.y-50,'攻击 +20%','#ffb0a8',22);}break;
    case 'speed':world.speedMul=Math.min(3,world.speedMul+.2);floatText(h.x,h.y-50,'转速提升','#ffd79a',22);break;
    case 'range':world.radiusAdd=Math.min(100,world.radiusAdd+15);floatText(h.x,h.y-50,'范围扩大','#dcc2ff',22);break;
    case 'power':world.damageMul=Math.min(5,world.damageMul+.2);floatText(h.x,h.y-50,'攻击 +20%','#ffb0a8',22);break;
    case 'heal':{const before=h.hp;h.hp=Math.min(h.maxHp,h.hp+Math.round(h.maxHp*.25));floatText(h.x,h.y-50,'+'+Math.round(h.hp-before),'#7dff8a',22);break;}
  }
  void c;
}
function drawPickup(p,t){
  if(p.life<3&&Math.floor(t*8)%2)return;
  const bob=Math.sin((t-p.born)*4)*4,y=p.y+bob;
  ctx.fillStyle='rgba(0,0,0,.18)';ctx.beginPath();ctx.ellipse(p.x,p.y+22,18,6,0,0,TAU);ctx.fill();
  if(p.kind==='weapon'){
    const glow=ctx.createRadialGradient(p.x,y,4,p.x,y,34);glow.addColorStop(0,'rgba(255,226,122,.85)');glow.addColorStop(1,'rgba(255,226,122,0)');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,y,34,0,TAU);ctx.fill();
    ctx.save();ctx.translate(p.x,y);ctx.rotate(-Math.PI/4+Math.sin(t*3)*.15);ctx.scale(1.15,1.15);drawWeapon(p.type);ctx.restore();
    label(p.by?`${fit16(p.by,6)}空投 · ${WEAPONS[p.type].name}`:WEAPONS[p.type].name,p.x,p.y+34,{size:13,color:'#fff3b0',width:3});
    return;
  }
  const b=BUFFS[p.type];
  ctx.beginPath();ctx.arc(p.x,y,19,0,TAU);ctx.fillStyle=b.color;ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#ffffff';ctx.stroke();
  ctx.beginPath();ctx.arc(p.x-6,y-7,5,0,TAU);ctx.fillStyle='rgba(255,255,255,.5)';ctx.fill();
  label(b.label,p.x,y+1,{size:b.label.length>2?12:13,color:'#fff',width:3,stroke:'rgba(0,0,0,.35)'});
}

// —— 背景：割过的草坪条纹 ——
function background(){
  if(bg)return bg;
  bg=document.createElement('canvas');bg.width=canvas.width;bg.height=canvas.height;const b=bg.getContext('2d');b.scale(scale,scale);
  for(let i=0;i<12;i++){b.fillStyle=i%2?'#86c064':'#8fca6c';b.fillRect(i*W/12,0,W/12+1,H);}
  let seed=7;const r=()=>(seed=(seed*16807)%2147483647)/2147483647;
  b.strokeStyle='rgba(60,110,40,.35)';b.lineWidth=2;b.lineCap='round';
  for(let i=0;i<260;i++){const x=r()*W,y=r()*H;b.beginPath();b.moveTo(x,y);b.lineTo(x-3,y-8);b.moveTo(x+3,y);b.lineTo(x+4,y-9);b.moveTo(x+6,y);b.lineTo(x+10,y-7);b.stroke();}
  for(let i=0;i<26;i++){const x=r()*W,y=r()*H;b.fillStyle=['#fff6a8','#ffffff','#ffc6d9'][i%3];for(let k=0;k<5;k++){b.beginPath();b.arc(x+Math.cos(k*TAU/5)*3.5,y+Math.sin(k*TAU/5)*3.5,2.6,0,TAU);b.fill();}b.fillStyle='#f2b23d';b.beginPath();b.arc(x,y,2,0,TAU);b.fill();}
  const v=b.createRadialGradient(W/2,H/2,H*.35,W/2,H/2,H*.95);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(20,50,10,.28)');b.fillStyle=v;b.fillRect(0,0,W,H);
  return bg;
}

// —— 状态 ——
let game=null,lastSeq=null,round=null,uid=0;
const world={};
const cfg=()=>game?.config||{hero_name:'小萝卜',hero_image:'',hero_size:72,hero_hp:1000,control_mode:'keyboard',hero_speed:220,blade_count:1,blade_damage:30,blade_radius:95,blade_speed:3.5,auto_spawn:true,auto_spawn_per_second:1.5,pickups:true,pickup_interval_seconds:10,monster_growth_percent:20,like_spawn:true,boss_damage:40,gift_rules:[]};
function resetWorld(){
  Object.assign(world,{t:0,hero:{x:W/2,y:H/2+30,vx:0,vy:0,hp:cfg().hero_hp,maxHp:cfg().hero_hp,hurt:0,shield:0,down:0,orbit:1,orbitFlip:4},
    enemies:[],bullets:[],particles:[],texts:[],feed:[],pickups:[],bossQueue:[],boss:null,banner:null,kills:0,downs:0,spawnAcc:0,pickupAcc:0,nextBossAt:0,flash:0,clock:0,disarm:0,xp:0,heroLevel:1,gems:[],levelGlow:0});
  resetBuffs();
}
function resetBuffs(){Object.assign(world,{weapon:'sickle',extraBlades:0,speedMul:1,radiusAdd:0,damageMul:1});}
resetWorld();
const announce=text=>{document.getElementById('mower-announcement').textContent=text;};
function feed(cue,text,color='#fff'){world.feed.unshift({face:cue?.face,name:cue?.user||'',text,color,life:7});world.feed.length=Math.min(world.feed.length,5);}
function floatText(x,y,text,color='#fff',size=18){if(world.texts.length>160)world.texts.shift();world.texts.push({x,y,text,color,size,life:.9,vy:-60});}
function burst(x,y,colors,n=10,speed=180){for(let i=0;i<n&&world.particles.length<600;i++){const a=rand(0,TAU),s=rand(.3,1)*speed;world.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rand(.4,.9),color:colors[i%colors.length],size:rand(2,5),spin:rand(-8,8),rot:rand(0,TAU)});}}
function edgePoint(){const side=Math.floor(rand(0,4)),m=40;return side===0?{x:rand(0,W),y:-m}:side===1?{x:W+m,y:rand(0,H)}:side===2?{x:rand(0,W),y:H+m}:{x:-m,y:rand(0,H)};}
// 怪物等级 1～5：点赞召唤 1 级小草；礼物可召唤高级怪；自动刷怪随时间解锁高等级。
const MONSTERS=[null,
  {name:'小草',hp:30,speed:[50,70],damage:6,r:[14,18],color:'#5fae43',dark:'#2f6a22'},
  {name:'蘑菇',hp:90,speed:[58,68],damage:10,r:[18,20],color:'#e0503f',dark:'#8a2a20'},
  {name:'仙人掌',hp:180,speed:[40,50],damage:14,r:[21,23],color:'#3e9a5a',dark:'#1f5a32',shoot:3.2},
  {name:'石头怪',hp:450,speed:[32,38],damage:22,r:[27,29],color:'#9aa0a6',dark:'#4f555b',heavy:true},
  {name:'树精',hp:1000,speed:[38,44],damage:30,r:[33,35],color:'#8a5a35',dark:'#4a2e18',dash:4.5,heavy:true}
];
// 怪物强度：每分钟按设置的百分比变强；主角倒下后回落一些。
const minutes=()=>world.clock/60,growth=()=>1+(cfg().monster_growth_percent??20)/100*minutes();
function spawnMonster(level,at,extra={}){
  if(world.enemies.length>=320)return null;
  const m=MONSTERS[level],p=at||edgePoint(),g=growth(),hp=Math.round(m.hp*g);
  const e={id:++uid,kind:'mob',level,x:p.x,y:p.y,vx:0,vy:0,r:rand(...m.r),hp,maxHp:hp,speed:rand(...m.speed)*Math.min(1.5,1+(g-1)*.15),damage:Math.round(m.damage*(1+(g-1)*.6)),
    hit:[],flash:0,wobble:rand(0,TAU),shootT:m.shoot?rand(1,m.shoot):0,dashT:m.dash?rand(2,m.dash):0,dashing:0,...extra};
  world.enemies.push(e);return e;
}
const spawnGrass=(at,extra)=>spawnMonster(1,at,extra);
function autoLevel(){
  const t=minutes(),list=[[1,10],[2,t>=1?4+t:0],[3,t>=2.5?2+t*.8:0],[4,t>=4?1+t*.5:0],[5,t>=6?.5+t*.3:0]].filter(([,w])=>w>0);
  return Number(pickWeighted(list));
}
function spawnViewer(cue,at){
  if(world.enemies.filter(e=>e.kind==='viewer').length>=120)return false;
  const p=at?{x:at.x+rand(-50,50),y:at.y+rand(-50,50)}:edgePoint(),g=growth(),hp=Math.round(160*g);
  world.enemies.push({id:++uid,kind:'viewer',x:p.x,y:p.y,vx:0,vy:0,r:22,hp,maxHp:hp,speed:rand(70,85),damage:Math.round(10*(1+(g-1)*.6)),hit:[],flash:0,face:cue.face,name:cue.user,wobble:0});
  return true;
}
const MAX_BOSSES=5,liveBosses=()=>world.enemies.filter(e=>e.kind==='boss'&&!e.dead&&e.state!=='leave');
const whoKey=cue=>cue.uid&&cue.uid!=='0'?'uid:'+cue.uid:'name:'+cue.user;

// —— 指令 ——
function apply(cue){
  const c=cfg(),h=world.hero;
  switch(cue.kind){
    case 'minion':{let n=0;const at=edgePoint();for(let i=0;i<Math.min(50,cue.value||1);i++)if(spawnViewer(cue,at))n++;if(n)feed(cue,`派出了${n}只自己的小怪`);break;}
    case 'heal':{if(h.down)break;const before=h.hp;h.hp=Math.min(h.maxHp,h.hp+cue.value);floatText(h.x,h.y-40,'+'+Math.round(h.hp-before),'#7dff8a',22);burst(h.x,h.y,['#7dff8a','#ffffff'],12,120);feed(cue,cue.chat?`给${c.hero_name}加油 +${cue.value}`:`送出${cue.gift}×${cue.count}，回血 +${cue.value}`,'#b8ffbf');break;}
    case 'swarm':{const n=Math.min(200,cue.value),center=edgePoint();for(let i=0;i<n;i++)spawnGrass({x:center.x+rand(-120,120),y:center.y+rand(-120,120)});feed(cue,`送出${cue.gift}×${cue.count}，刷来${n}只小草`,'#ffe08a');break;}
    case 'like':{
      const n=Math.min(20,cue.value),center=edgePoint();
      for(let i=0;i<n;i++)spawnGrass({x:center.x+rand(-80,80),y:center.y+rand(-80,80)},i?{}:{name:cue.user});
      const top=world.feed[0];
      if(top?.like&&top.name===cue.user){top.likes+=n;top.text=`点赞召唤了${top.likes}只小草`;top.life=7;}
      else{feed(cue,`点赞召唤了${n}只小草`,'#ffd6ea');world.feed[0].like=true;world.feed[0].likes=n;}
      break;
    }
    case 'monster':{
      const level=clamp(cue.value,1,5),n=Math.min(30,cue.count),center=edgePoint(),m=MONSTERS[level];
      for(let i=0;i<n;i++)spawnMonster(level,{x:center.x+rand(-90,90),y:center.y+rand(-90,90)},{name:cue.user,face:cue.face});
      feed(cue,`送出${cue.gift}×${cue.count}，召唤了 Lv.${level} ${m.name}${n>1?'×'+n:''}`,'#ffc48a');
      if(level>=4)floatText(W/2,140,`Lv.${level} ${m.name} 来袭！`,'#ffc48a',30);
      break;
    }
    case 'hurt':{
      if(h.down)break;
      h.hp-=cue.value;h.hurt=.4;floatText(h.x,h.y-40,'-'+cue.value,'#ff4d4d',26);burst(h.x,h.y,['#ff4d4d','#ffffff'],14,160);
      feed(cue,`送出${cue.gift}×${cue.count}，${c.hero_name}扣血 ${cue.value}`,'#ff9b9b');
      if(h.hp<=0)heroDown(`被 ${cue.user} 的礼物击倒`);
      break;
    }
    case 'disarm':{
      if(h.down)break;
      world.disarm=Math.min(120,world.disarm+cue.value);floatText(h.x,h.y-46,'被缴械了！','#ffb347',24);burst(h.x,h.y,['#c0c6cc','#ffffff'],16,220);
      feed(cue,`送出${cue.gift}×${cue.count}，${c.hero_name}被缴械 ${cue.value} 秒`,'#ffcf8a');
      break;
    }
    case 'blade':{const before=bladeCount();world.extraBlades=Math.min(12-c.blade_count,world.extraBlades+cue.value);floatText(h.x,h.y-46,`刀 +${bladeCount()-before}`,'#bfe6ff',22);feed(cue,`送出${cue.gift}×${cue.count}，${c.hero_name}加刀！`,'#bfe6ff');break;}
    case 'weapon':{const type=Math.random()<.5?'axe':'glaive',a=rand(0,TAU),p={x:clamp(h.x+Math.cos(a)*150,80,W-80),y:clamp(h.y+Math.sin(a)*150,130,H-80)};spawnPickup('weapon',type,p,cue.user);burst(p.x,p.y,['#ffe27a','#ffffff'],20,200);feed(cue,`送出${cue.gift}，空投了一把${WEAPONS[type].name}！`,'#ffe27a');break;}
    case 'nuke':{world.flash=1;for(const e of world.enemies)if(e.kind!=='boss'){burst(e.x,e.y,['#7cc35a','#4e8a33','#b7e39a'],6,240);world.kills++;dropXp(e.x,e.y,e.kind==='viewer'?4:XP_BY_LEVEL[e.level]||1);}world.enemies=world.enemies.filter(e=>e.kind==='boss');world.bullets=[];for(const b of liveBosses())if(b.state!=='enter')damage(b,Math.ceil(b.maxHp*.1));feed(cue,`送出${cue.gift}，清屏大招！`,'#ffd1f0');break;}
    case 'boss':{
      const key=whoKey(cue),b=liveBosses().find(x=>x.key===key&&x.hp>0);
      if(b){b.hp+=cue.value;b.maxHp+=cue.value;b.count+=cue.count;floatText(b.x,b.y-b.r-20,`血量 +${cue.value}`,'#ff9b9b',24);feed(cue,`追加${cue.gift}×${cue.count}，BOSS 更强了！`,'#ffb0b0');break;}
      const queued=world.bossQueue.find(q=>q.key===key);
      if(queued){queued.hp+=cue.value;queued.count+=cue.count;feed(cue,`追加${cue.gift}×${cue.count}，排队中的BOSS更强了`,'#ffb0b0');break;}
      if(world.bossQueue.length>=30)break;
      world.bossQueue.push({key,cue,hp:cue.value,count:cue.count});feed(cue,`送出${cue.gift}×${cue.count}，化身BOSS前来决斗！`,'#ffb0b0');
      break;
    }
  }
}
function report(boss,result){
  if(!game)return;
  fetch('/api/mower/action',{method:'POST',headers:{'Content-Type':'application/json','X-Luobo-Platform':game.platform},body:JSON.stringify({action:'report',cue_id:boss.cueId,result,hp:boss.maxHp})}).catch(()=>{});
}
function summonBoss(){
  const next=world.bossQueue.shift();if(!next)return;
  const c=next.cue,r=Math.min(90,58+Math.log10(Math.max(10,next.hp))*4);
  const taken=liveBosses().map(o=>o.x);let x=rand(160,W-160);for(let i=0;i<12&&taken.some(t=>Math.abs(t-x)<180);i++)x=rand(160,W-160);
  const boss={id:++uid,kind:'boss',key:next.key,cueId:c.id,x,y:-r-20,vx:0,vy:0,r,hp:next.hp,maxHp:next.hp,count:next.count,gift:c.gift,face:c.face,name:c.user,
    speed:72,damage:cfg().boss_damage,hit:[],flash:0,state:'enter',timer:1.4,lastAttack:'',dir:{x:0,y:1}};
  world.enemies.push(boss);
  world.banner={title:`${c.user} 前来决斗！`,sub:`${c.gift} ×${c.count} · 血量 ${next.hp.toLocaleString()}`,face:c.face,name:c.user,life:3,color:'#ffcf5a'};
  announce(`${c.user}化身BOSS前来决斗`);
}
function damage(e,amount){
  e.hp-=amount;e.flash=.12;
  if(e.kind==='boss'){floatText(e.x+rand(-e.r*.6,e.r*.6),e.y-e.r*.4,String(amount),'#fff3a8',20);if(e.hp<=0)bossDefeated(e);}
  else if(e.hp<=0)killEnemy(e);
}
// 经验：怪物等级越高掉得越多；宝石掉在地上，主角靠近会被吸过来。
const XP_BY_LEVEL=[0,1,3,6,15,30];
const xpNeed=level=>8+level*6+level*level;
function dropXp(x,y,value){
  if(!(value>0))return;
  if(world.gems.length>=250){const g=world.gems[0];g.v+=value;return;}
  world.gems.push({id:++uid,x:x+rand(-8,8),y:y+rand(-8,8),v:value});
}
function gainXp(value){
  world.xp+=value;
  while(world.xp>=xpNeed(world.heroLevel)){world.xp-=xpNeed(world.heroLevel);levelUp();}
}
function levelUp(){
  const h=world.hero,before=h.maxHp;world.heroLevel++;
  h.maxHp=Math.round(cfg().hero_hp*levelHp());
  if(!h.down)h.hp=Math.min(h.maxHp,h.hp+(h.maxHp-before)+Math.round(h.maxHp*.2));
  world.levelGlow=1;burst(h.x,h.y,['#ffe27a','#ffffff','#9be7ff'],26,260);
  floatText(h.x,h.y-60,`升级！Lv.${world.heroLevel}`,'#ffe27a',30);
  floatText(h.x,h.y-30,'血量 攻击 转速 提升','#ffffff',16);
}
function killEnemy(e){
  e.dead=true;world.kills++;dropXp(e.x,e.y,e.kind==='viewer'?4:XP_BY_LEVEL[e.level]||1);
  burst(e.x,e.y,e.kind==='viewer'?[colorOf(e.name),'#ffffff','#7cc35a']:[MONSTERS[e.level].color,MONSTERS[e.level].dark,'#b7e39a'],e.kind==='viewer'?16:6+e.level*3,200);
  if(e.kind==='mob'&&e.level>=3)floatText(e.x,e.y-e.r-8,`Lv.${e.level} ${MONSTERS[e.level].name} 被割了`,'#ffe2a8',15);
  if(e.kind==='viewer')floatText(e.x,e.y-28,e.name+' 被割了','#ffffff',15);
}
function bossDefeated(b){
  if(b.state==='leave'||b.dead)return;
  b.dead=true;world.flash=.7;
  burst(b.x,b.y,['#ffcf5a','#ff7a59','#ffffff',colorOf(b.name)],80,420);
  {const total=Math.min(300,40+Math.round(b.maxHp/150));for(let i=0;i<8;i++){const a=i*TAU/8;dropXp(b.x+Math.cos(a)*b.r*.6,b.y+Math.sin(a)*b.r*.6,Math.ceil(total/8));}}
  world.banner={title:`${cfg().hero_name} 击败了 ${b.name}！`,sub:`割下 BOSS · 血量 ${b.maxHp.toLocaleString()}`,face:b.face,name:b.name,life:3.2,color:'#7dff8a'};
  announce(`${cfg().hero_name}击败了${b.name}`);
  report(b,'win');world.nextBossAt=Math.max(world.nextBossAt,world.t+2);
  for(const e of world.enemies)if(e.summoned===b.id&&!e.dead)killEnemy(e);
}
function heroDown(reason='3 秒后满血复活'){
  const h=world.hero,list=liveBosses(),b=list.find(x=>x.id===world.lastHitBy)||list[0];
  h.down=3;h.hp=0;world.downs++;burst(h.x,h.y,['#f09b68','#ffcfaa','#9dbc80'],30,260);
  if(b){
    world.banner={title:`${b.name} 击倒了 ${cfg().hero_name}！`,sub:list.length>1?`场上 ${list.length} 个 BOSS 一起获胜，扬长而去`:'BOSS 获胜，扬长而去',face:b.face,name:b.name,life:3.2,color:'#ff8a8a'};
    announce(`${b.name}击倒了${cfg().hero_name}`);
    for(const o of list){report(o,'lose');o.state='leave';o.timer=2;floatText(o.x,o.y-o.r-24,'哈哈哈！','#ffdede',30);}world.nextBossAt=world.t+4;
  }else world.banner={title:`${cfg().hero_name} 倒下了`,sub:reason,life:2.4,color:'#ffd0a8'};
  world.bullets=[];resetBuffs();world.clock*=.6;world.disarm=0;
}

// —— 每帧模拟 ——
function update(dt){
  const c=cfg(),h=world.hero,running=game?.mode==='running';
  world.t+=dt;
  for(const p of world.particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.92;p.vy*=.92;p.life-=dt;p.rot+=p.spin*dt;}
  world.particles=world.particles.filter(p=>p.life>0);
  for(const t of world.texts){t.y+=t.vy*dt;t.vy*=.95;t.life-=dt;}
  world.texts=world.texts.filter(t=>t.life>0);
  for(const f of world.feed)f.life-=dt;world.feed=world.feed.filter(f=>f.life>0);
  if(world.banner&&(world.banner.life-=dt)<=0)world.banner=null;
  world.flash=Math.max(0,world.flash-dt*2);
  if(!running)return;
  {const target=Math.round(c.hero_hp*levelHp());if(h.maxHp!==target){h.hp=Math.round(h.hp/h.maxHp*target);h.maxHp=target;}}
  world.levelGlow=Math.max(0,world.levelGlow-dt);
  for(const g of world.gems){const d=dist(g,h);if(h.down)continue;if(d<HERO_R+12){g.taken=true;gainXp(g.v);}else if(d<130+HERO_R){const s=Math.min(d,(520-d*1.5)*dt);g.x+=(h.x-g.x)/d*s;g.y+=(h.y-g.y)/d*s;}}
  if(world.gems.some(g=>g.taken))world.gems=world.gems.filter(g=>!g.taken);
  h.hurt=Math.max(0,h.hurt-dt);h.shield=Math.max(0,h.shield-dt);
  if(!h.down)world.clock+=dt;world.disarm=Math.max(0,world.disarm-dt);
  if(h.down){h.down=Math.max(0,h.down-dt);h.vx=h.vy=0;if(!h.down){h.hp=h.maxHp;h.shield=2;for(const e of world.enemies)if(e.kind!=='boss'&&dist(e,h)<260)killEnemy(e);}}
  // 刷怪
  if(c.auto_spawn&&c.auto_spawn_per_second>0){world.spawnAcc+=dt*c.auto_spawn_per_second*Math.min(3,1+.12*minutes())*(liveBosses().length?.4:1);const auto=world.enemies.length;while(world.spawnAcc>=1){world.spawnAcc--;if(auto<160)spawnMonster(autoLevel());}}
  if(world.bossQueue.length&&world.t>=world.nextBossAt&&liveBosses().length<MAX_BOSSES){summonBoss();world.nextBossAt=world.t+1.5;}
  if(c.pickups){world.pickupAcc+=dt;if(world.pickupAcc>=c.pickup_interval_seconds){world.pickupAcc=0;if(world.pickups.filter(p=>!p.by).length<4)randomPickup();}}
  for(const p of world.pickups){p.life-=dt;if(!h.down&&dist(p,h)<HERO_R+20)collect(p);}
  world.pickups=world.pickups.filter(p=>p.life>0&&!p.taken);
  if(!h.down)heroAI(dt);
  h.x=clamp(h.x+h.vx*dt,HERO_R+6,W-HERO_R-6);h.y=clamp(h.y+h.vy*dt,HERO_R+70,H-HERO_R-40);
  // 敌人移动
  const grid=new Map(),cell=48,keyOf=(x,y)=>((x/cell)|0)+','+((y/cell)|0);
  for(const e of world.enemies){if(e.kind==='boss')continue;const k=keyOf(e.x,e.y);let list=grid.get(k);if(!list)grid.set(k,list=[]);list.push(e);}
  for(const e of world.enemies){
    e.flash=Math.max(0,e.flash-dt);
    if(e.kind==='boss'){bossBrain(e,dt);continue;}
    const dx=h.x-e.x,dy=h.y-e.y,d=Math.hypot(dx,dy)||1,kind=e.kind==='mob'?MONSTERS[e.level]:null;
    if(kind?.shoot&&!h.down&&(e.shootT-=dt)<=0){e.shootT=kind.shoot+rand(-.5,.8);if(d<520){world.bullets.push({x:e.x+dx/d*e.r,y:e.y+dy/d*e.r,vx:dx/d*240,vy:dy/d*240,r:6,life:3,damage:Math.max(1,Math.round(e.damage*.7)),color:'#5fbf4a',glow:'rgba(95,191,74,.3)'});e.flash=.08;}}
    if(kind?.dash&&!h.down&&(e.dashT-=dt)<=0){e.dashT=kind.dash+rand(-.5,1);if(d<420){e.dashing=.5;e.vx=dx/d*300;e.vy=dy/d*300;}}
    if(e.dashing>0){e.dashing-=dt;e.x+=e.vx*dt;e.y+=e.vy*dt;e.wobble+=dt*16;continue;}
    let ax=dx/d*e.speed,ay=dy/d*e.speed;
    if(h.down){ax=-ax*.4;ay=-ay*.4;}
    const gx=(e.x/cell)|0,gy=(e.y/cell)|0;
    for(let ix=-1;ix<=1;ix++)for(let iy=-1;iy<=1;iy++){const list=grid.get((gx+ix)+','+(gy+iy));if(!list)continue;for(const o of list){if(o===e)continue;const ox=e.x-o.x,oy=e.y-o.y,od=Math.hypot(ox,oy),min=e.r+o.r;if(od>0&&od<min){ax+=ox/od*(min-od)*8;ay+=oy/od*(min-od)*8;}}}
    e.vx+=(ax-e.vx)*Math.min(1,dt*4);e.vy+=(ay-e.vy)*Math.min(1,dt*4);
    e.x+=e.vx*dt;e.y+=e.vy*dt;e.wobble+=dt*8;
  }
  // 刀砍怪
  if(!h.down){
    const n=world.disarm>0?0:bladeCount(),R=bladeRadius(),base=world.t*bladeSpeed(),now=world.t,reach=WEAPONS[world.weapon].reach,hit=bladeDamage();
    for(let i=0;i<n;i++){
      const a=base+i*TAU/n,bx=h.x+Math.cos(a)*R,by=h.y+Math.sin(a)*R;
      for(const e of world.enemies){
        if(e.dead||e.kind==='boss'&&['enter','leave'].includes(e.state))continue;
        const dx=e.x-bx,dy=e.y-by;if(dx*dx+dy*dy>(e.r+reach)**2)continue;
        if(now-(e.hit[i]??-1)<.22)continue;e.hit[i]=now;
        damage(e,hit);
        if(e.kind!=='boss'){const kd=Math.hypot(e.x-h.x,e.y-h.y)||1,push=e.kind==='mob'&&MONSTERS[e.level].heavy?70:260;e.vx+=(e.x-h.x)/kd*push;e.vy+=(e.y-h.y)/kd*push;if(Math.random()<.35)floatText(e.x,e.y-e.r,String(hit),'#ffffff',14);}
        burst(bx,by,['#ffffff','#d9f2c8'],2,120);
      }
    }
    // 怪碰到主角
    for(const e of world.enemies){
      if(e.dead||e.kind==='boss'&&['enter','leave'].includes(e.state))continue;
      if(dist(e,h)<e.r+HERO_R-2&&h.shield<=0){
        hurtHero(e.kind==='boss'?(e.state==='charge'?Math.round(e.damage*1.5):e.damage):e.damage,e.kind==='boss'?e.id:0);
        const kd=dist(e,h)||1;if(e.kind!=='boss'){e.vx=(e.x-h.x)/kd*300;e.vy=(e.y-h.y)/kd*300;}
        if(h.down)break;
      }
    }
  }
  world.enemies=world.enemies.filter(e=>!e.dead&&(e.kind==='boss'||e.x>-200&&e.x<W+200&&e.y>-200&&e.y<H+200));
  // 子弹
  for(const b of world.bullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;if(!h.down&&h.shield<=0&&Math.hypot(b.x-h.x,b.y-h.y)<b.r+HERO_R-4){b.life=0;hurtHero(b.damage,b.from);}}
  world.bullets=world.bullets.filter(b=>b.life>0&&b.x>-40&&b.x<W+40&&b.y>-40&&b.y<H+40);
}
function hurtHero(amount,from=0){
  const h=world.hero;if(h.down)return;if(from)world.lastHitBy=from;
  h.hp-=amount;h.hurt=.25;h.shield=.45;floatText(h.x,h.y-34,'-'+amount,'#ff6b6b',20);
  if(h.hp<=0)heroDown();
}
function heroAI(dt){
  const h=world.hero,R=bladeRadius(),fighting=liveBosses().filter(x=>x.state!=='enter');let b=null,bd=Infinity;for(const x of fighting){const d=dist(x,h);if(d<bd){bd=d;b=x;}}
  let ax=0,ay=0;
  if(manual.active()||cfg().control_mode!=='auto'){ax=manual.x;ay=manual.y;}
  else{
    let target=b;
    if(!target){let best=Infinity;for(const e of world.enemies){if(e.kind==='boss')continue;const d=(e.x-h.x)**2+(e.y-h.y)**2;if(d<best){best=d;target=e;}}}
    let goal=null,best=Infinity;for(const p of world.pickups){if(!worthIt(p))continue;const d=dist(p,h);if(d<best&&(!b||d<260)){best=d;goal=p;}}
    if(goal){const dx=goal.x-h.x,dy=goal.y-h.y,d=Math.hypot(dx,dy)||1;ax+=dx/d*2.2;ay+=dy/d*2.2;}
    if(world.disarm>0)target=null;
    if(target&&!goal||target&&b){
      const dx=target.x-h.x,dy=target.y-h.y,d=Math.hypot(dx,dy)||1,want=b?R+b.r*.35:R*.85;
      const pull=clamp((d-want)/50,-2.2,2.2);ax+=dx/d*pull;ay+=dy/d*pull;
      if((h.orbitFlip-=dt)<0){h.orbit*=-1;h.orbitFlip=rand(2.5,5);}
      ax+=-dy/d*.7*h.orbit;ay+=dx/d*.7*h.orbit;
    }else{ax+=(W/2-h.x)/300+Math.cos(world.t*.7)*.4;ay+=(H/2+30-h.y)/300+Math.sin(world.t*.9)*.4;}
    for(const e of world.enemies){
      const dx=e.x-h.x,dy=e.y-h.y,d=Math.hypot(dx,dy)||1,safe=e.r+HERO_R+(e.kind==='boss'?30:10)+(world.disarm>0?110:45);
      if(d<safe){const k=(safe-d)/45*(e.kind==='boss'?3.2:1.6);ax-=dx/d*k;ay-=dy/d*k;}
    }
    for(const bl of world.bullets){
      const dx=bl.x-h.x,dy=bl.y-h.y,d=Math.hypot(dx,dy);if(d>170)continue;
      const closing=-(dx*bl.vx+dy*bl.vy)/(d||1);if(closing<=0)continue;
      const sv=Math.hypot(bl.vx,bl.vy)||1,side=Math.sign(dx*bl.vy/sv-dy*bl.vx/sv)||1;ax+=-bl.vy/sv*side*1.4;ay+=bl.vx/sv*side*1.4;
    }
    for(const w of fighting)if(w.state==='windup'){
      const lx=h.x-w.x,ly=h.y-w.y,along=lx*w.dir.x+ly*w.dir.y,perp=lx*-w.dir.y+ly*w.dir.x;
      if(along>0&&Math.abs(perp)<w.r+HERO_R+30){const s=Math.sign(perp)||1;ax+=-w.dir.y*s*4;ay+=w.dir.x*s*4;}
    }
    const m=110;if(h.x<m)ax+=(m-h.x)/m*2;if(h.x>W-m)ax-=(h.x-W+m)/m*2;if(h.y<m+60)ay+=(m+60-h.y)/m*2;if(h.y>H-m)ay-=(h.y-H+m)/m*2;
  }
  const len=Math.hypot(ax,ay),speed=cfg().hero_speed||220,tx=len>.05?ax/Math.max(1,len)*speed:0,ty=len>.05?ay/Math.max(1,len)*speed:0;
  h.vx+=(tx-h.vx)*Math.min(1,dt*7);h.vy+=(ty-h.vy)*Math.min(1,dt*7);
}
function bossBrain(b,dt){
  const h=world.hero,enraged=b.hp<b.maxHp*.45;
  b.timer-=dt;
  const toHero=()=>{const dx=h.x-b.x,dy=h.y-b.y,d=Math.hypot(dx,dy)||1;return {x:dx/d,y:dy/d,d};};
  switch(b.state){
    case 'enter':b.y+=(170-b.y)*Math.min(1,dt*3);if(b.timer<=0){b.state='chase';b.timer=1.6;}return;
    case 'leave':b.y-=260*dt;b.x+=Math.sin(world.t*6)*80*dt;if(b.y<-b.r-60)b.dead=true;return;
    case 'chase':{const v=toHero(),sp=b.speed*(enraged?1.35:1);b.vx+=(v.x*sp-b.vx)*Math.min(1,dt*3);b.vy+=(v.y*sp-b.vy)*Math.min(1,dt*3);
      if(b.timer<=0){const options=['windup','volley','summon'].filter(o=>o!==b.lastAttack||Math.random()<.2);const pick=options[Math.floor(Math.random()*options.length)];b.lastAttack=pick;
        if(pick==='windup'){b.state='windup';b.timer=enraged?.6:.85;const v2=toHero();b.dir={x:v2.x,y:v2.y};b.vx=b.vy=0;}
        else if(pick==='volley'){b.state='volley';b.timer=enraged?1.2:.6;b.shots=enraged?3:1;b.shotTimer=0;}
        else{b.state='summon';b.timer=.8;}}
      break;}
    case 'windup':b.vx*=.8;b.vy*=.8;{const v=toHero();b.dir.x+=(v.x-b.dir.x)*dt*1.5;b.dir.y+=(v.y-b.dir.y)*dt*1.5;const l=Math.hypot(b.dir.x,b.dir.y)||1;b.dir.x/=l;b.dir.y/=l;}if(b.timer<=0){b.state='charge';b.timer=.65;b.vx=b.dir.x*(enraged?640:540);b.vy=b.dir.y*(enraged?640:540);}break;
    case 'charge':if(Math.random()<.6)burst(b.x-b.dir.x*b.r,b.y-b.dir.y*b.r,['rgba(255,255,255,.8)','#d9f2c8'],1,60);if(b.timer<=0){b.state='recover';b.timer=.6;}break;
    case 'recover':b.vx*=.85;b.vy*=.85;if(b.timer<=0){b.state='chase';b.timer=enraged?1.1:1.8;}break;
    case 'volley':b.vx*=.85;b.vy*=.85;b.shotTimer-=dt;
      if(b.shotTimer<=0&&b.shots>0){b.shots--;b.shotTimer=.4;const n=enraged?18:14,off=rand(0,TAU),sp=enraged?250:210;for(let i=0;i<n;i++){const a=off+i*TAU/n;world.bullets.push({x:b.x+Math.cos(a)*b.r*.8,y:b.y+Math.sin(a)*b.r*.8,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r:9,life:3.5,damage:Math.max(1,Math.round(b.damage*.6)),from:b.id});}}
      if(b.timer<=0&&b.shots<=0){b.state='chase';b.timer=enraged?1.1:1.8;}break;
    case 'summon':b.vx*=.85;b.vy*=.85;if(b.timer<=0){const n=enraged?8:5;for(let i=0;i<n;i++){const a=i*TAU/n;spawnMonster(enraged?2:1,{x:b.x+Math.cos(a)*(b.r+30),y:b.y+Math.sin(a)*(b.r+30)},{summoned:b.id});}floatText(b.x,b.y-b.r-20,'小的们，上！','#ffffff',22);b.state='chase';b.timer=1.8;}break;
  }
  b.x+=b.vx*dt;b.y+=b.vy*dt;
  for(const o of world.enemies){if(o===b||o.kind!=='boss'||o.dead||o.state==='leave')continue;const dx=b.x-o.x,dy=b.y-o.y,d=Math.hypot(dx,dy)||1,min=b.r+o.r;if(d<min){b.x+=dx/d*(min-d)/2;b.y+=dy/d*(min-d)/2;}}
  if(b.x<b.r){b.x=b.r;b.vx=Math.abs(b.vx);}if(b.x>W-b.r){b.x=W-b.r;b.vx=-Math.abs(b.vx);}
  if(b.y<b.r+60){b.y=b.r+60;b.vy=Math.abs(b.vy);}if(b.y>H-b.r){b.y=H-b.r;b.vy=-Math.abs(b.vy);}
}

// —— 绘制 ——
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function bar(x,y,w,h,ratio,fill,back='rgba(0,0,0,.35)'){roundRect(x,y,w,h,h/2);ctx.fillStyle=back;ctx.fill();if(ratio>0){roundRect(x,y,Math.max(h,w*clamp(ratio,0,1)),h,h/2);ctx.fillStyle=fill;ctx.fill();}}
function label(text,x,y,{size=16,color='#fff',align='center',weight='bold',stroke='rgba(0,0,0,.55)',width=4}={}){
  ctx.font=`${weight} ${size}px "Microsoft YaHei","Segoe UI",sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';
  if(stroke){ctx.lineWidth=width;ctx.strokeStyle=stroke;ctx.lineJoin='round';ctx.strokeText(text,x,y);}
  ctx.fillStyle=color;ctx.fillText(text,x,y);
}
const fit16=(text,max)=>{const chars=Array.from(String(text));return chars.length>max?chars.slice(0,max).join('')+'…':String(text);};
function drawGrass(e){
  const s=e.r,w=Math.sin(e.wobble)*.12;
  ctx.save();ctx.translate(e.x,e.y);ctx.rotate(w);
  ctx.fillStyle='rgba(0,0,0,.15)';ctx.beginPath();ctx.ellipse(0,s*.85,s*.9,s*.3,0,0,TAU);ctx.fill();
  ctx.fillStyle=e.summoned?'#6f8f2d':'#3f8a2e';
  for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(i*s*.5-s*.25,-s*.4);ctx.lineTo(i*s*.55,-s*1.45+Math.abs(i)*s*.3);ctx.lineTo(i*s*.5+s*.25,-s*.4);ctx.fill();}
  ctx.beginPath();ctx.arc(0,0,s,0,TAU);ctx.fillStyle=e.flash>0?'#ffffff':e.summoned?'#94b744':'#5fae43';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#2f6a22';ctx.stroke();
  const h=world.hero,a=Math.atan2(h.y-e.y,h.x-e.x),px=Math.cos(a)*1.6,py=Math.sin(a)*1.6;
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-s*.35,-s*.1,s*.26,0,TAU);ctx.arc(s*.35,-s*.1,s*.26,0,TAU);ctx.fill();
  ctx.fillStyle='#1d2b16';ctx.beginPath();ctx.arc(-s*.35+px,-s*.1+py,s*.12,0,TAU);ctx.arc(s*.35+px,-s*.1+py,s*.12,0,TAU);ctx.fill();
  ctx.restore();
}
function eyes(e,s,y,white='#fff',pupil='#1d2b16',angry=false){
  const h=world.hero,a=Math.atan2(h.y-e.y,h.x-e.x),px=Math.cos(a)*s*.08,py=Math.sin(a)*s*.08;
  ctx.fillStyle=white;ctx.beginPath();ctx.arc(-s*.33,y,s*.2,0,TAU);ctx.arc(s*.33,y,s*.2,0,TAU);ctx.fill();
  ctx.fillStyle=pupil;ctx.beginPath();ctx.arc(-s*.33+px,y+py,s*.1,0,TAU);ctx.arc(s*.33+px,y+py,s*.1,0,TAU);ctx.fill();
  if(angry){ctx.strokeStyle=pupil;ctx.lineWidth=Math.max(2,s*.08);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-s*.55,y-s*.32);ctx.lineTo(-s*.15,y-s*.18);ctx.moveTo(s*.55,y-s*.32);ctx.lineTo(s*.15,y-s*.18);ctx.stroke();}
}
function drawMob(e){
  if(e.level===1)drawGrass(e);
  else{
    const s=e.r,m=MONSTERS[e.level],fill=e.flash>0?'#ffffff':m.color,w=Math.sin(e.wobble)*(e.level===4?.04:.1);
    ctx.save();ctx.translate(e.x,e.y);
    ctx.fillStyle='rgba(0,0,0,.18)';ctx.beginPath();ctx.ellipse(0,s*.9,s*.95,s*.3,0,0,TAU);ctx.fill();
    ctx.rotate(w);ctx.lineWidth=2;ctx.strokeStyle=m.dark;
    if(e.level===2){ // 蘑菇：奶油色菌柄 + 红色菌盖白点
      ctx.fillStyle=e.flash>0?'#fff':'#f6e7c8';ctx.beginPath();ctx.ellipse(0,s*.35,s*.55,s*.6,0,0,TAU);ctx.fill();ctx.stroke();
      ctx.fillStyle=fill;ctx.beginPath();ctx.ellipse(0,-s*.2,s*1.05,s*.75,0,Math.PI,0);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff';for(const [x,y,r] of [[-.5,-.5,.16],[.15,-.7,.13],[.6,-.35,.14],[-.1,-.35,.1]]){ctx.beginPath();ctx.arc(x*s,y*s,r*s,0,TAU);ctx.fill();}
      eyes(e,s,s*.3);
    }else if(e.level===3){ // 仙人掌：身体 + 两只手臂 + 刺
      ctx.fillStyle=fill;
      ctx.beginPath();ctx.roundRect(-s*.55,-s*1.05,s*1.1,s*2,s*.55);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.roundRect(-s*1.05,-s*.35,s*.42,s*.75,s*.2);ctx.roundRect(s*.63,-s*.6,s*.42,s*.75,s*.2);ctx.fill();ctx.stroke();
      ctx.strokeStyle='#e9f5c8';ctx.lineWidth=1.5;for(const [x,y] of [[-.3,-.7],[.3,-.4],[-.25,.2],[.28,.55],[-.85,-.2],[.85,-.45]]){ctx.beginPath();ctx.moveTo(x*s-3,y*s);ctx.lineTo(x*s+3,y*s-3);ctx.stroke();}
      ctx.fillStyle='#ff7ab6';ctx.beginPath();ctx.arc(0,-s*1.08,s*.2,0,TAU);ctx.fill();
      eyes(e,s,-s*.3,'#fff','#1d2b16',true);
    }else if(e.level===4){ // 石头怪：不规则石块 + 裂纹 + 怒眼
      ctx.fillStyle=fill;ctx.beginPath();
      const pts=[[-1,-.2],[-.75,-.85],[-.1,-1.05],[.65,-.8],[1.02,-.1],[.8,.7],[.05,.95],[-.8,.72]];
      pts.forEach(([x,y],i)=>i?ctx.lineTo(x*s,y*s):ctx.moveTo(x*s,y*s));ctx.closePath();ctx.fill();ctx.lineWidth=3;ctx.stroke();
      ctx.strokeStyle='rgba(60,64,70,.6)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-s*.5,-s*.6);ctx.lineTo(-s*.3,-s*.3);ctx.lineTo(-s*.45,0);ctx.moveTo(s*.4,s*.2);ctx.lineTo(s*.6,s*.5);ctx.stroke();
      ctx.fillStyle='#7a8086';ctx.beginPath();ctx.ellipse(s*.15,s*.5,s*.25,s*.12,0,0,TAU);ctx.fill();
      eyes(e,s,-s*.25,'#ffd34d','#3a2a10',true);
    }else{ // 树精：树干 + 树冠 + 发光的眼
      ctx.fillStyle=e.flash>0?'#fff':'#3f8a2e';
      for(const [x,y,r] of [[-.55,-.95,.55],[.55,-.95,.55],[0,-1.25,.6],[0,-.75,.55]]){ctx.beginPath();ctx.arc(x*s,y*s,r*s,0,TAU);ctx.fill();}
      ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(-s*.6,-s*.55,s*1.2,s*1.45,s*.3);ctx.fill();ctx.stroke();
      ctx.strokeStyle='rgba(50,30,15,.5)';ctx.beginPath();ctx.moveTo(-s*.3,-s*.4);ctx.lineTo(-s*.25,s*.7);ctx.moveTo(s*.25,-s*.3);ctx.lineTo(s*.3,s*.6);ctx.stroke();
      ctx.fillStyle='#2b1a0c';ctx.beginPath();ctx.ellipse(0,s*.4,s*.25,s*.15,0,0,TAU);ctx.fill();
      eyes(e,s,-s*.1,'#fff27a','#5a3a00',true);
      if(e.dashing>0){ctx.strokeStyle='rgba(255,255,255,.6)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,s*1.25,0,TAU);ctx.stroke();}
    }
    ctx.restore();
  }
  if(e.face){drawAvatar(e.face,e.name,e.x+e.r*.75,e.y-e.r*.85,9,'#ffffff',2);}
  if(e.name)label(`${e.level>1?'Lv.'+e.level+' ':''}${fit16(e.name,6)}`,e.x,e.y+e.r+12,{size:12,width:3,color:e.level>=4?'#ffd6a8':'#ffffff'});
  if(e.level>=2&&e.hp<e.maxHp)bar(e.x-e.r,e.y-e.r-12,e.r*2,5,e.hp/e.maxHp,'#ff6b6b');
}
function drawViewer(e){
  ctx.fillStyle='rgba(0,0,0,.18)';ctx.beginPath();ctx.ellipse(e.x,e.y+e.r+2,e.r*.9,e.r*.3,0,0,TAU);ctx.fill();
  ctx.fillStyle='#3f8a2e';for(let i=-1;i<=1;i++){ctx.beginPath();ctx.moveTo(e.x+i*10-5,e.y-e.r+4);ctx.lineTo(e.x+i*11,e.y-e.r-12+Math.abs(i)*4);ctx.lineTo(e.x+i*10+5,e.y-e.r+4);ctx.fill();}
  drawAvatar(e.face,e.name,e.x,e.y,e.r,e.flash>0?'#ffffff':'#3f8a2e',3);
  label(fit16(e.name,6),e.x,e.y+e.r+12,{size:12,width:3});
  if(e.hp<e.maxHp)bar(e.x-e.r,e.y-e.r-10,e.r*2,5,e.hp/e.maxHp,'#ff6b6b');
}
function drawBoss(b){
  const t=world.t,enraged=b.hp<b.maxHp*.45;
  if(b.state==='windup'){
    ctx.save();ctx.translate(b.x,b.y);ctx.rotate(Math.atan2(b.dir.y,b.dir.x));const a=.25+.25*Math.sin(t*30);
    ctx.fillStyle=`rgba(255,60,60,${a})`;ctx.fillRect(0,-b.r,420,b.r*2);ctx.restore();
  }
  ctx.fillStyle='rgba(0,0,0,.22)';ctx.beginPath();ctx.ellipse(b.x,b.y+b.r+4,b.r*.9,b.r*.28,0,0,TAU);ctx.fill();
  if(enraged){ctx.beginPath();ctx.arc(b.x,b.y,b.r+10+Math.sin(t*12)*3,0,TAU);ctx.fillStyle='rgba(255,70,50,.28)';ctx.fill();}
  drawAvatar(b.face,b.name,b.x,b.y,b.r,b.flash>0?'#ffffff':enraged?'#ff5a3c':'#ffcf5a',7);
  // 王冠
  const cx=b.x,cy=b.y-b.r-4,cw=b.r*.9;
  ctx.beginPath();ctx.moveTo(cx-cw/2,cy);ctx.lineTo(cx-cw/2,cy-22);ctx.lineTo(cx-cw/4,cy-10);ctx.lineTo(cx,cy-28);ctx.lineTo(cx+cw/4,cy-10);ctx.lineTo(cx+cw/2,cy-22);ctx.lineTo(cx+cw/2,cy);ctx.closePath();
  ctx.fillStyle='#ffcf3a';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#b8860b';ctx.stroke();
  ctx.fillStyle='#ff5a7a';ctx.beginPath();ctx.arc(cx,cy-9,4,0,TAU);ctx.fill();
  label(fit16(b.name,10),b.x,b.y+b.r+20,{size:18,color:'#ffe9a8'});
  if(b.state!=='leave'&&world.enemies.filter(e=>e.kind==='boss'&&!e.dead).length>1)bar(b.x-b.r,b.y-b.r-46,b.r*2,7,b.hp/b.maxHp,'#ff5a4a');
}
function drawHud(){
  const c=cfg(),h=world.hero;
  // 主角血条
  roundRect(16,14,330,70,16);ctx.fillStyle='rgba(20,45,15,.55)';ctx.fill();
  label(`Lv.${world.heroLevel} ${fit16(c.hero_name,8)}`,30,32,{size:17,align:'left',stroke:null,color:world.levelGlow>0?'#ffe27a':'#ffffff'});
  bar(30,66,240,7,world.xp/xpNeed(world.heroLevel),'#6ec8ff');label(`经验 ${Math.floor(world.xp)}/${xpNeed(world.heroLevel)}`,276,69,{size:10,align:'left',stroke:null,color:'#cfeeff'});
  bar(30,46,240,14,h.hp/h.maxHp,h.hp/h.maxHp<.3?'#ff6b6b':'#7ee07a');
  label(`${Math.max(0,Math.ceil(h.hp))}/${h.maxHp}`,150,53,{size:11,stroke:null});
  label(`割草 ${world.kills}`,334,32,{size:15,align:'right',color:'#e7ffd9',stroke:null});
  label(`${WEAPONS[world.weapon].name} ×${bladeCount()}`,334,53,{size:13,align:'right',color:'#cfe8ff',stroke:null});
  const chips=[[`怪物强度 ×${growth().toFixed(1)}`,'rgba(120,60,40,.75)']];if(world.disarm>0)chips.push([`缴械 ${Math.ceil(world.disarm)}s`,'#c8742e']);if(world.speedMul>1)chips.push(['转速×'+world.speedMul.toFixed(1),BUFFS.speed.color]);if(world.radiusAdd)chips.push(['范围+'+world.radiusAdd,BUFFS.range.color]);if(world.damageMul>1)chips.push(['攻击×'+world.damageMul.toFixed(1),BUFFS.power.color]);
  let cx=16;for(const [text,color] of chips){ctx.font='bold 12px "Microsoft YaHei",sans-serif';const w=ctx.measureText(text).width+18;roundRect(cx,90,w,22,11);ctx.fillStyle=color;ctx.fill();label(text,cx+w/2,101,{size:12,stroke:null});cx+=w+6;}
  // BOSS 血条
  const bossList=world.enemies.filter(e=>e.kind==='boss'&&!e.dead&&e.state!=='leave');
  if(bossList.length>1)bossList.forEach((o,i)=>{
    const x=W/2-230,y=12+i*34;roundRect(x,y,460,30,15);ctx.fillStyle='rgba(60,15,15,.6)';ctx.fill();
    drawAvatar(o.face,o.name,x+16,y+15,11,'#ffcf5a',2);label(`BOSS ${fit16(o.name,6)}`,x+32,y+15,{size:12,align:'left',stroke:null,color:'#ffe2a0'});
    bar(x+150,y+9,230,12,o.hp/o.maxHp,o.hp<o.maxHp*.45?'#ff3b2f':'#ff5a4a');label(Math.max(0,Math.ceil(o.hp)).toLocaleString(),x+450,y+15,{size:11,align:'right',stroke:null});
  });
  const b=bossList.length===1?bossList[0]:null;
  if(b){
    const x=W/2-260,y=16;roundRect(x,y,520,56,16);ctx.fillStyle='rgba(60,15,15,.6)';ctx.fill();
    drawAvatar(b.face,b.name,x+30,y+28,20,'#ffcf5a',2);
    label(`BOSS · ${fit16(b.name,10)}`,x+60,y+18,{size:15,align:'left',stroke:null,color:'#ffe2a0'});
    label(`${b.gift} ×${b.count}`,x+506,y+18,{size:12,align:'right',stroke:null,color:'#ffd6d6'});
    bar(x+60,y+31,446,15,b.hp/b.maxHp,'#ff5a4a');label(`${Math.max(0,Math.ceil(b.hp)).toLocaleString()} / ${b.maxHp.toLocaleString()}`,x+283,y+39,{size:11,stroke:null});
  }
  // 排队的挑战者
  if(world.bossQueue.length){
    const n=Math.min(5,world.bossQueue.length),w=96+n*34;roundRect(W-16-w,14,w,48,16);ctx.fillStyle='rgba(20,45,15,.55)';ctx.fill();
    label(`挑战者 ${world.bossQueue.length}`,W-w+2,38,{size:13,align:'left',stroke:null});
    world.bossQueue.slice(0,n).forEach((q,i)=>drawAvatar(q.cue.face,q.cue.user,W-w+92+i*34,38,14,'#ffcf5a',2));
  }
  // 事件播报
  world.feed.slice().reverse().forEach((f,i)=>{
    const y=H-96-i*40,a=Math.min(1,f.life);ctx.globalAlpha=a;
    ctx.font='bold 14px "Microsoft YaHei",sans-serif';const text=fit16(f.name,8)+' '+f.text,w=Math.min(560,ctx.measureText(text).width+62);
    roundRect(16,y-16,w,32,16);ctx.fillStyle='rgba(0,0,0,.45)';ctx.fill();
    drawAvatar(f.face,f.name,33,y,12,null);label(text,52,y,{size:14,align:'left',color:f.color,stroke:null});
    ctx.globalAlpha=1;
  });
  // 玩法提示
  const tips=[];if(c.like_spawn)tips.push('点赞召唤小草');if(c.chat_spawn_keyword)tips.push(`弹幕「${c.chat_spawn_keyword}」派出你的小怪`);if(c.chat_heal_keyword)tips.push(`「${c.chat_heal_keyword}」给${c.hero_name}回血`);
  const boss=c.gift_rules.find(r=>r.effect==='boss');if(boss)tips.push(`送「${boss.gift_name}」化身BOSS来决斗`);
  if(tips.length){const text=tips.join(' · ');ctx.font='bold 14px "Microsoft YaHei",sans-serif';const w=ctx.measureText(text).width+36;roundRect(W/2-w/2,H-38,w,28,14);ctx.fillStyle='rgba(20,45,15,.55)';ctx.fill();label(text,W/2,H-24,{size:14,stroke:null,color:'#f4ffe9'});}
}
function drawBanner(){
  const bn=world.banner;if(!bn)return;
  const a=Math.min(1,bn.life*2,(3.4-bn.life)*4),y=H/2-40;ctx.globalAlpha=clamp(a,0,1);
  roundRect(W/2-330,y-58,660,116,28);ctx.fillStyle='rgba(15,25,10,.72)';ctx.fill();
  if(bn.face!==undefined||bn.name){drawAvatar(bn.face,bn.name,W/2-260,y,40,bn.color,4);}
  label(bn.title,W/2+30,y-16,{size:34,color:bn.color,stroke:null});
  label(bn.sub,W/2+30,y+26,{size:17,color:'#ffffff',stroke:null,weight:'normal'});
  ctx.globalAlpha=1;
}
function drawOverlay(title,sub){
  ctx.fillStyle='rgba(15,30,10,.45)';ctx.fillRect(0,0,W,H);
  label(title,W/2,H/2-26,{size:54,color:'#fff7d6',stroke:'rgba(40,70,20,.8)',width:8});
  label(sub,W/2,H/2+30,{size:20,color:'#ffffff'});
}
function render(){
  ctx.setTransform(scale,0,0,scale,0,0);
  if(transparent)ctx.clearRect(0,0,W,H);else ctx.drawImage(background(),0,0,W,H);
  const h=world.hero,t=world.t;
  for(const g of world.gems){const s=g.v>=30?9:g.v>=10?8:g.v>=3?6.5:5,col=g.v>=30?'#ffcf3a':g.v>=10?'#c77dff':g.v>=3?'#5fe08a':'#6ec8ff';ctx.beginPath();ctx.moveTo(g.x,g.y-s);ctx.lineTo(g.x+s*.7,g.y);ctx.lineTo(g.x,g.y+s);ctx.lineTo(g.x-s*.7,g.y);ctx.closePath();ctx.fillStyle=col;ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='rgba(255,255,255,.85)';ctx.stroke();}
  for(const p of world.pickups)drawPickup(p,t);
  for(const e of world.enemies)if(e.kind==='mob')drawMob(e);
  for(const e of world.enemies)if(e.kind==='viewer')drawViewer(e);
  for(const p of world.particles){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.globalAlpha=Math.min(1,p.life*2);ctx.fillStyle=p.color;ctx.fillRect(-p.size,-p.size/3,p.size*2,p.size*.7);ctx.restore();}
  ctx.globalAlpha=1;
  for(const e of world.enemies)if(e.kind==='boss')drawBoss(e);
  if(world.levelGlow>0&&!h.down){ctx.beginPath();ctx.arc(h.x,h.y,HERO_R+20+(1-world.levelGlow)*60,0,TAU);ctx.strokeStyle=`rgba(255,226,122,${world.levelGlow})`;ctx.lineWidth=5;ctx.stroke();}
  drawHero(h,t);if(!h.down&&world.disarm<=0)drawBlades(h,t);
  if(!h.down&&world.disarm>0)label(`缴械 ${Math.ceil(world.disarm)}s`,h.x,h.y-HERO_R-30,{size:16,color:'#ffcf8a'});
  for(const b of world.bullets){ctx.beginPath();ctx.arc(b.x,b.y,b.r+4,0,TAU);ctx.fillStyle=b.glow||'rgba(255,80,120,.3)';ctx.fill();ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.fillStyle=b.color||'#ff4f7b';ctx.fill();ctx.beginPath();ctx.arc(b.x-2,b.y-2,b.r*.4,0,TAU);ctx.fillStyle='#ffd0dc';ctx.fill();}
  for(const tx of world.texts){ctx.globalAlpha=Math.min(1,tx.life*2.5);label(tx.text,tx.x,tx.y,{size:tx.size,color:tx.color,width:3});}
  ctx.globalAlpha=1;
  if(h.down)label(`${Math.ceil(h.down)} 秒后复活`,h.x,h.y-50,{size:18,color:'#ffe0c4'});
  drawHud();drawBanner();
  if(world.flash>0){ctx.fillStyle=`rgba(255,255,255,${world.flash*.6})`;ctx.fillRect(0,0,W,H);}
  if(!game)drawOverlay('萝卜割草','连接控制台中…');
  else if(game.mode==='idle')drawOverlay('萝卜割草',game.config.control_mode==='auto'?'等待主播开始游戏':'等待主播开始游戏 · WASD 或 ↑↓←→ 操作主角');
  else if(game.mode==='paused')drawOverlay('已暂停','主播暂停了游戏');
  // 键盘操作需要操作窗口有焦点；只在操作窗口里提示，同步出去的画面看不到
  if(playing&&game?.mode==='running'&&game.config.control_mode!=='auto'&&!document.hasFocus())label('点一下画面，再用 WASD 或 ↑↓←→ 操作主角',W/2,H-62,{size:16,color:'#fff7d6'});
}
// —— 键盘接管（画面窗口获得焦点时，WASD / 方向键手动操作主角） ——
const keys=new Set(),manual={x:0,y:0,until:0,active(){return performance.now()<this.until&&(this.x||this.y);}};
const KEYMAP={ArrowUp:[0,-1],KeyW:[0,-1],ArrowDown:[0,1],KeyS:[0,1],ArrowLeft:[-1,0],KeyA:[-1,0],ArrowRight:[1,0],KeyD:[1,0]};
function syncKeys(){manual.x=0;manual.y=0;for(const k of keys){manual.x+=KEYMAP[k][0];manual.y+=KEYMAP[k][1];}manual.until=performance.now()+(keys.size?60000:0);}
addEventListener('keydown',e=>{if(KEYMAP[e.code]){keys.add(e.code);syncKeys();e.preventDefault();}});
addEventListener('keyup',e=>{if(KEYMAP[e.code]){keys.delete(e.code);syncKeys();}});
addEventListener('blur',()=>{keys.clear();syncKeys();});

// 同一时刻只有一个画面在算战斗（服务端指定的「主画面」），其他画面照着它的每一帧显示，
// 所以操作窗口、复制的地址和控制台预览永远是同一局。
// 主画面优先是操作窗口（?play=1）；它关掉或卡住时，服务端立刻换一个画面接手，从最后一帧接着算，不重开也不停住。
const playing=params.has('play'),previewing=params.has('preview');
let leader=false,mirror=null,sentAt=0;
const mirroring=()=>!leader&&mirror&&mirror.cur.platform===game?.platform;
// 帧里带完整的战斗状态（只去掉每把刀的命中计时），接手的画面可以原样继续算。
const round2=(key,value)=>key==='hit'?undefined:typeof value==='number'&&key!=='t'&&!Number.isInteger(value)?Math.round(value*100)/100:value;
function sendFrame(now){
  const socket=source.socket;
  if(!leader||!game||now-sentAt<33||socket?.readyState!==1||socket.bufferedAmount>262144)return;
  sentAt=now;socket.send(JSON.stringify({type:'mower-frame',platform:game.platform,frame:{platform:game.platform,round,seq:lastSeq,uid,world}},round2));
}
// 两帧之间按编号插值，30 帧也能画得顺。
function showMirror(now){
  const {prev,cur,prevAt,curAt}=mirror,a=prev?clamp((now-curAt)/Math.max(16,curAt-prevAt),0,1):1,lerp=(p,c)=>p+(c-p)*a,w=cur.world,pw=prev?.world;
  const before=new Map(pw?pw.enemies.map(e=>[e.id,e]):[]);
  Object.assign(world,w,{
    t:pw?lerp(pw.t,w.t):w.t,
    hero:{...w.hero,...(pw?{x:lerp(pw.hero.x,w.hero.x),y:lerp(pw.hero.y,w.hero.y)}:{})},
    enemies:w.enemies.map(e=>{const p=before.get(e.id);return p?{...e,x:lerp(p.x,e.x),y:lerp(p.y,e.y)}:e;})
  });
}
// 成为主画面：有同一局的最后一帧就从那里接着算，再补上交接空档里到的礼物和弹幕。
function takeOver(){
  const cur=mirror?.cur;
  if(cur&&game&&cur.platform===game.platform&&cur.round===round){
    Object.assign(world,structuredClone(cur.world));
    for(const e of world.enemies)e.hit=[];
    uid=Math.max(uid,cur.uid||0);lastSeq=cur.seq??lastSeq;
    for(const cue of game.cues){
      if(cue.seq<=lastSeq||cue.round!==round)continue;
      lastSeq=cue.seq;if(game.mode==='running'&&game.now-cue.time<20000)apply(cue);
    }
  }
  mirror=null;last=performance.now();
}
let last=performance.now();
function frame(now){
  let dt=Math.min(.05,(now-last)/1000)*speedUp;last=now;
  if(leader)while(dt>0){const step=Math.min(dt,1/60);update(step);dt-=step;}
  else if(mirroring())showMirror(now);
  render();sendFrame(now);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// —— 接收服务端状态和指令 ——
function receive(next){
  const restarted=lastSeq!==null&&next.seq<lastSeq;
  if(round!==next.round||restarted){
    // 刚打开画面时跳过旧指令；画面开着时重新开局，新一局已经到的指令要照常执行。
    const fresh=next.cues.find(c=>c.round===next.round);
    lastSeq=round!==null&&fresh?fresh.seq-1:next.seq;
    if(round!==next.round)resetWorld();round=next.round;
  }
  game=next;HERO_R=Math.round((next.config.hero_size||72)/3);
  if(lastSeq===null)lastSeq=next.seq;
  for(const cue of next.cues){
    if(cue.seq<=lastSeq||cue.round!==next.round)continue;
    lastSeq=cue.seq;
    if(next.mode==='running'&&next.now-cue.time<20000&&leader)apply(cue);
  }
}
const connection=document.getElementById('mower-connection');
const source=new LuoboEvents('/api/events?mower=1'+(playing?'&play=1':'')+(previewing?'&preview=1':''));
source.addEventListener('mower',event=>receive(JSON.parse(event.data)));
source.addEventListener('mower-role',event=>{const was=leader;leader=JSON.parse(event.data).leader===true;if(leader&&!was)takeOver();});
source.addEventListener('mower-frame',event=>{if(leader)return;const cur=JSON.parse(event.data),now=performance.now();mirror={prev:mirror?.cur.platform===cur.platform&&now-mirror.curAt<500?mirror.cur:null,prevAt:mirror?.curAt||now,cur,curAt:now};});
source.onopen=()=>{connection.hidden=true;};
source.onerror=()=>{connection.textContent='连接中断，正在重连…';connection.hidden=false;};
})();
