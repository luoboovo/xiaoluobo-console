const F=Feeding,canvas=document.getElementById('game'),ctx=canvas.getContext('2d'),params=new URLSearchParams(location.search),preview=params.has('preview'),capture=params.has('capture'),client=crypto.randomUUID();
const sprites=new Map(),images=new Map(),clips=new Map();let state,drag,remote,lastCue='',lastFrame=0,lastMotion=0,motionBusy=false,committing=false,hover=null,scale=1,offsetX=0,offsetY=0,audio,active=true;
if(preview)active=!parent.document.getElementById('feeding-view')?.hidden;
function resize(){scale=Math.min(innerWidth/F.WIDTH,innerHeight/F.HEIGHT);offsetX=(innerWidth-F.WIDTH*scale)/2;offsetY=(innerHeight-F.HEIGHT*scale)/2;canvas.style.cssText=`width:${F.WIDTH*scale}px;height:${F.HEIGHT*scale}px;left:${offsetX}px;top:${offsetY}px`;const dpr=Math.min(2,devicePixelRatio||1);canvas.width=F.WIDTH*dpr;canvas.height=F.HEIGHT*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
addEventListener('resize',resize);resize();
function releaseImage(image){const animation=image.animation;image.animation=null;animation?.frame?.close();animation?.decoder.close();}
function animationError(){dispatchEvent(new CustomEvent('luobo-diagnostic',{detail:{event:'resource_error',message:'吃吃吃动图解码失败'}}));}
async function loadAnimation(image,url){
  if(typeof ImageDecoder==='undefined')return;let decoder;
  try{
    const response=await fetch(url);if(!response.ok)throw Error('动图加载失败');
    decoder=new ImageDecoder({data:await response.arrayBuffer(),type:response.headers.get('Content-Type')});await decoder.tracks.ready;
    if(images.get(url)!==image||!decoder.tracks.selectedTrack?.animated){decoder.close();return;}
    image.animation={decoder,index:0,loops:0,nextAt:0,pending:false,frame:null};
  }catch{decoder?.close();if(images.get(url)===image)animationError();}
}
function advanceImage(image,now){
  const a=image.animation;if(!a||a.pending||a.done||now<a.nextAt)return;
  const track=a.decoder.tracks.selectedTrack;
  if(a.index>=track.frameCount){if(a.loops>=track.repetitionCount){a.done=true;return;}a.index=0;a.loops++;}
  a.pending=true;
  a.decoder.decode({frameIndex:a.index}).then(({image:frame})=>{
    if(image.animation!==a){frame.close();return;}
    a.frame?.close();a.frame=frame;a.index++;a.nextAt=performance.now()+Math.max(20,(frame.duration??100000)/1000);a.pending=false;
  }).catch(()=>{if(image.animation===a){releaseImage(image);animationError();}});
}
function img(url){if(!images.has(url)){const value=new Image();value.src=url;images.set(url,value);if(/\.(gif|webp)$/.test(url))loadAnimation(value,url);}return images.get(url);}
// drawImage on an animated HTMLImageElement uses its first frame; draw decoded frames instead.
function picture(image,x,y,w,h=w){const frame=image?.animation?.frame,source=frame||image,width=frame?.displayWidth||image?.naturalWidth,height=frame?.displayHeight||image?.naturalHeight;if(width&&(frame||image.complete)){const ratio=Math.min(w/width,h/height);ctx.drawImage(source,x-width*ratio/2,y-height*ratio/2,width*ratio,height*ratio);}}
async function action(input){const response=await fetch('/api/feeding/action',{method:'POST',headers:{'Content-Type':'application/json','X-Luobo-Platform':state.platform},body:JSON.stringify(input)});const result=await response.json();if(!response.ok)throw new Error(result.error);apply(result.state);return result.state;}
// 每个音效文件复用一个播放器、最多保留 8 个；批量送礼时每次新建 Audio 会在 OBS 里堆出大量音频流。
function releaseClip(clip){clip.pause();clip.removeAttribute('src');clip.load();}
function releaseClips(){for(const clip of clips.values())releaseClip(clip);clips.clear();}
function playClip(url){let clip=clips.get(url);if(clip){clips.delete(url);clip.currentTime=0;}else{if(clips.size>=8){const [oldest,old]=clips.entries().next().value;clips.delete(oldest);releaseClip(old);}clip=new Audio(url);clip.volume=.35;}clips.set(url,clip);clip.play().catch(()=>{});}
function sound(kind,url){if(preview||!state.config.sound_enabled)return;try{if(url){playClip(url);return;}audio||=new AudioContext();audio.resume().catch(()=>{});const tones={add:[540,760],remove:[420,300],eat:[230,170,620],gift:[660,900,1220],wind:[180,260,360]}[kind]||[540,760];tones.forEach((f,i)=>{const o=audio.createOscillator(),g=audio.createGain(),start=audio.currentTime+i*.07;o.frequency.value=f;g.gain.setValueAtTime(.08,start);g.gain.exponentialRampToValueAtTime(.001,start+.09);o.connect(g);g.connect(audio.destination);o.start(start);o.stop(start+.1);});}catch{}}
function apply(next){
  const changed=state&&state.revision!==next.revision,platformChanged=state&&state.platform!==next.platform;state=next;
  if(platformChanged){sprites.clear();for(const image of images.values())releaseImage(image);images.clear();releaseClips();lastCue='';drag=null;remote=null;}
  if(changed&&drag&&!committing){if(drag.kind==='food'&&drag.ids.some(id=>!next.objects.some(o=>o.id===id)))drag=null;else drag.revision=next.revision;}
  if(remote?.revision!==state.revision)remote=null;
  const c=state.config,theme=F.themes.find(t=>t.id===c.active_theme_id)||F.themes[0],foods=c.food_images.length?c.food_images:theme.foods,ids=new Set(state.objects.map(o=>o.id));
  for(const id of sprites.keys())if(!ids.has(id))sprites.delete(id);
  state.objects.forEach(object=>{const url=foods[c.food_image_order==='sequence'?object.slot%foods.length:Math.floor(F.noise(object.id)*foods.length)];let sprite=sprites.get(object.id);if(!sprite){sprite={id:object.id,x:object.x,y:object.y,angle:object.angle};sprites.set(object.id,sprite);}sprite.target={x:object.x,y:object.y,angle:object.angle};sprite.url=url;sprite.image=img(url);});
  const consumerUrl=c.consumer_image||theme.consumer;state.consumerImage=img(consumerUrl);
  const used=new Set([...sprites.values()].map(s=>s.url));used.add(consumerUrl);for(const [url,image]of images)if(!used.has(url)){releaseImage(image);images.delete(url);}
  if(state.cue&&state.cue.id!==lastCue&&Date.now()-state.cue.time<3000){lastCue=state.cue.id;let url=c.sound_files[state.cue.kind];if(state.cue.kind==='eat'&&state.cue.food_url)url=c.food_sound_files[state.cue.food_url]||url;sound(state.cue.kind,url);}
}
const source=new LuoboEvents('/api/events?feeding=1');source.addEventListener('feeding',event=>{apply(JSON.parse(event.data));document.getElementById('connection').hidden=true;});source.onerror=()=>{document.getElementById('connection').hidden=false;document.getElementById('connection').textContent='连接中断，正在重连…';};source.addEventListener('feeding-motion',event=>{const motion=JSON.parse(event.data);if(motion.client!==client&&motion.revision===state?.revision)remote=motion;});
source.addEventListener('feeding-physics',event=>{const next=JSON.parse(event.data);if(!state||next.revision<state.revision)return;state.consumer=next.consumer;for(const object of next.objects){const sprite=sprites.get(object.id);if(sprite)sprite.target=object;}});
function label(text,x,y,size=30,color='#fff0d7',align='left'){ctx.font=`700 ${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign=align;ctx.lineWidth=5;ctx.strokeStyle='#4c382a';ctx.lineJoin='round';ctx.strokeText(text,x,y);ctx.fillStyle=color;ctx.fillText(text,x,y);}
function frame(now){requestAnimationFrame(frame);const dt=Math.min(.04,(now-lastFrame)/1000||.016);lastFrame=now;if(!state||!active)return;ctx.clearRect(0,0,F.WIDTH,F.HEIGHT);const c=state.config,wind=state.wind_until>Date.now(),range=c.range_radius,dragIds=new Set(drag?.ids||[]);
  for(const image of images.values())advanceImage(image,now);
  const consumer=drag?.kind==='consumer'?drag:remote?.kind==='consumer'&&Date.now()-remote.time<500?remote:state.consumer;picture(state.consumerImage,consumer.x,consumer.y,c.consumer_size);
  for(const sprite of sprites.values()){
    const blend=Math.min(1,dt*24);sprite.x+=(sprite.target.x-sprite.x)*blend;sprite.y+=(sprite.target.y-sprite.y)*blend;sprite.angle+=(sprite.target.angle-sprite.angle)*blend;let x=sprite.x,y=sprite.y,angle=sprite.angle;
    if(dragIds.has(sprite.id)){const delta=drag.offsets.get(sprite.id);x=drag.x+delta.x;y=drag.y+delta.y;}
    if(y<-c.food_size||y>F.HEIGHT+c.food_size)continue;ctx.save();ctx.translate(x,y);ctx.rotate(angle);picture(sprite.image,0,0,c.food_size*(.9+F.noise(sprite.id,8)*.2));ctx.restore();
  }
  if(c.stats_visible){const point=drag?.kind==='stats'?drag:remote?.kind==='stats'&&Date.now()-remote.time<500?remote:state.stats;label(`已吃 ${state.eaten.toLocaleString()}  /  剩余 ${state.count.toLocaleString()}`,point.x,point.y+32*c.stats_scale,28*c.stats_scale);}
  if(c.gift_effect_overlay_enabled&&state.cue?.text&&Date.now()-state.cue.time<4500){label(state.cue.text,640,48,26,'#fff','center');label(state.cue.effects,640,82,19,'#ffe1b5','center');}
  if(state.blessing&&state.cue?.kind==='eat'&&Date.now()-state.cue.time<4000)label(state.blessing,consumer.x,consumer.y-c.consumer_size/2-20,23,'#ffcfdf','center');
  if(wind){ctx.strokeStyle='#b9eaffaa';ctx.lineWidth=3;for(let i=0;i<18;i++){const y=(i*53+now*.2)%720,x=(i*137+now*.45)%1280;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+70,y-25,x+170,y);ctx.stroke();}}
  if(!capture&&hover&&(state.manual_range||state.range_until>Date.now())){ctx.beginPath();ctx.arc(hover.x,hover.y,range,0,Math.PI*2);ctx.fillStyle='#ffd47722';ctx.fill();ctx.strokeStyle='#dba43b';ctx.lineWidth=2;ctx.stroke();}
}
requestAnimationFrame(frame);
function point(event){return {x:Math.max(0,Math.min(F.WIDTH,(event.clientX-offsetX)/scale)),y:Math.max(0,Math.min(F.HEIGHT,(event.clientY-offsetY)/scale))};}
function showError(error){const el=document.getElementById('connection');el.textContent=error.message;el.hidden=false;setTimeout(()=>{el.hidden=source.readyState===LuoboEvents.OPEN;},3500);}
canvas.addEventListener('pointerdown',event=>{if(!state||capture||committing)return;const p=point(event),c=state.config;canvas.setPointerCapture(event.pointerId);audio?.resume();if(F.consumerHit(p.x,p.y,state.consumer,c.consumer_size)){drag={kind:'consumer',...p};return;}if(c.stats_visible&&p.x>=state.stats.x&&p.x<state.stats.x+460*c.stats_scale&&p.y>=state.stats.y&&p.y<state.stats.y+45*c.stats_scale){drag={kind:'stats',...p};return;}
  const range=state.manual_range||state.range_until>Date.now(),items=[...sprites.values()].filter(s=>range?c.range_hit_mode==='contains'?Math.hypot(s.x-p.x,s.y-p.y)+c.food_size/2<=c.range_radius:Math.hypot(s.x-p.x,s.y-p.y)<=c.range_radius+(c.range_hit_mode==='intersects'?c.food_size/2:0):Math.abs(s.x-p.x)<c.food_size/2&&Math.abs(s.y-p.y)<c.food_size/2).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y)).slice(0,range?c.range_pickup_limit:1);
  if(items.length)drag={kind:'food',...p,ids:items.map(s=>s.id),offsets:new Map(items.map(s=>[s.id,{x:s.x-p.x,y:s.y-p.y}])),revision:state.revision};
});
function sendMotion(){if(!drag||motionBusy||performance.now()-lastMotion<35)return;lastMotion=performance.now();motionBusy=true;fetch('/api/feeding/motion',{method:'POST',headers:{'Content-Type':'application/json','X-Luobo-Platform':state.platform},body:JSON.stringify({client,kind:drag.kind,ids:drag.ids||[],offsets:drag.ids?.map(id=>drag.offsets.get(id)),x:drag.x,y:drag.y,revision:drag.revision??state.revision})}).catch(()=>{}).finally(()=>motionBusy=false);}
canvas.addEventListener('pointermove',event=>{hover=point(event);if(!drag)return;Object.assign(drag,hover);sendMotion();});setInterval(sendMotion,150);
async function release(event,cancel=false){if(!drag)return;const held=drag;drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(cancel)return;committing=true;try{if(held.kind==='food')await action({action:'drop',ids:held.ids,x:held.x,y:held.y,revision:held.revision,food_url:sprites.get(held.ids[0])?.url});else await action({action:held.kind,x:held.kind==='stats'?Math.min(F.WIDTH-100,held.x):Math.max(20,Math.min(F.WIDTH-20,held.x)),y:held.kind==='stats'?Math.min(F.HEIGHT-40,held.y):Math.max(20,Math.min(F.HEIGHT-20,held.y))});}catch(e){showError(e);}finally{committing=false;}}
canvas.addEventListener('pointerup',event=>release(event));canvas.addEventListener('pointercancel',event=>release(event,true));canvas.addEventListener('lostpointercapture',()=>{drag=null;});canvas.addEventListener('pointerleave',()=>{hover=null;});
canvas.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='r'&&!capture){event.preventDefault();action({action:'range'}).catch(showError);}});
canvas.addEventListener('wheel',event=>{if(!state||capture||!state.config.stats_visible)return;const p=point(event),c=state.config;if(p.x>=state.stats.x&&p.x<state.stats.x+460*c.stats_scale&&p.y>=state.stats.y&&p.y<state.stats.y+45*c.stats_scale){event.preventDefault();action({action:'configure',config:{...c,stats_scale:Math.max(.25,Math.min(3,c.stats_scale+(event.deltaY<0?.1:-.1)))}}).catch(showError);}},{passive:false});
if(!preview&&!capture)document.getElementById('hint').hidden=false;
addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='feeding-preview-visibility'){active=!!event.data.visible;if(!active){drag=null;hover=null;}}});
addEventListener('pagehide',()=>{for(const image of images.values())releaseImage(image);releaseClips();});
