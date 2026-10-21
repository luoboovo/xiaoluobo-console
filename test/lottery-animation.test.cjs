const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function fixture(status='revealing'){
  let now=0,nextFrame;const opened=[],elements=new Map(),noop=()=>{};
  const ctx=new Proxy({},{get:()=>noop,set:()=>true});
  const element=id=>{if(!elements.has(id)){const attrs={};elements.set(id,{style:{},classList:{toggle:noop},getContext:()=>ctx,addEventListener:noop,setAttribute:(k,v)=>attrs[k]=v,getAttribute:k=>attrs[k],hidden:false});}return elements.get(id);};
  const context=vm.createContext({URLSearchParams,location:{search:'?game=scratch',origin:'http://local'},document:{getElementById:element,querySelectorAll:()=>[],body:element('body'),addEventListener:noop,hidden:false},
    Date:class extends Date{static now(){return 100000+now;}},performance:{now:()=>now},requestAnimationFrame:cb=>{nextFrame=cb;return 1;},setInterval:noop,addEventListener:noop,
    LuoboEvents:class{addEventListener(){}},TicketPile:class{draw(){}opened(data){opened.push({...data,time:now});}},fetch:()=>new Promise(()=>{})});
  vm.runInContext(fs.readFileSync(require.resolve('../public/lottery/game.js'),'utf8'),context);
  const players=Array.from({length:52},(_,i)=>({id:String(i),name:'奖项'+i}));
  context.initial={game:'scratch',platform:'bilibili',now:100000,players,config:{mode:'scratch'},round:{id:'round',status,players,card_index:7,layout_seed:69,shaken_at:98000,picked_at:100000,peel:0,ends_at:112000}};
  vm.runInContext('update(initial)',context);opened.length=0;
  const step=time=>{now=time;const callback=nextFrame;nextFrame=null;callback?.(now);};
  return {context,opened,step};
}

test('选签放大每个刷新帧都更新，不被30帧限制造成48ms停顿',()=>{
  const {opened,step}=fixture();for(let time=16;time<=480;time+=16)step(time);
  assert.ok(opened.length>=28,`480ms仅绘制${opened.length}帧`);
  assert.ok(opened.every((p,i)=>!i||p.time-opened[i-1].time<=20));
});

test('点击指定签卡后立刻开始放大，保存请求尚未返回也不阻塞动画',()=>{
  const {context,opened,step}=fixture('choosing');vm.runInContext("choose({action:'pick',card:7})",context);step(16);
  assert.ok(opened.length>0,'点选后仍等待服务器，没有启动动画');assert.equal(opened.at(-1).index,7);
});

test('延迟的同轮状态推送不重启动画，服务器时钟校正也不让放大倒退',()=>{
  const {context,opened,step}=fixture();step(160);const before=opened.at(-1).arrive;
  vm.runInContext('update(initial)',context);step(176);
  assert.ok(opened.at(-1).arrive>before);assert.equal(opened.at(-1).arrive,176/450);
});
