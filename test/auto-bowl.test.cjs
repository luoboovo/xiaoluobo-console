const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {NoodleShop}=require('../lib/noodle.cjs');
const {BUILTIN}=require('../lib/templates.cjs');
const Rules=require('../public/noodle/rules.js');
const Layout=require('../public/noodle/layout.js');

async function fixture(t,workflow='mix'){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'luobo-auto-bowl-'));
  t.after(async()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'luobo-auto-bowl-'));await fs.rm(dir,{recursive:true,force:true});});
  const shop=await new NoodleShop(dir).init();
  shop.template=()=>({...BUILTIN,workflow});
  shop.mode='running';return shop;
}

test('四种玩法点击一次只放一个空碗或杯，整齐排列、无重叠、随托盘布局变换',async t=>{
  for(const workflow of ['mix','knife-noodles','jasmine-latte','stir-fry'])await t.test(workflow,async t=>{
    const shop=await fixture(t,workflow);
    for(let i=0;i<4;i++){
      await shop.action({action:'place_bowl',revision:-1,x:-999,y:-999,count:99,noodles:99});
      assert.equal(shop.objects.length,i+1);
      const bowl=shop.objects.at(-1);
      assert.equal(bowl.kind,'bowl');assert.equal(bowl.noodles,0);assert.equal(bowl.sauce,0);
      assert.equal(shop.selected,bowl.id);
      assert.ok(Rules.contains(bowl.x,bowl.y,Rules.radius(bowl)));
      assert.ok(!shop.objects.slice(0,-1).some(other=>Rules.overlaps(other,bowl)));
      if(workflow==='stir-fry'){assert.deepEqual(bowl.ingredients,[]);assert.deepEqual(bowl.garnishes,[]);}
      if(workflow==='jasmine-latte'){assert.equal(!!bowl.coffee,false);assert.equal(!!bowl.jasmine,false);assert.equal(!!bowl.milk,false);}
    }
    const [a,b,c,d]=shop.objects;
    assert.equal(b.x-a.x,c.x-b.x);assert.equal(c.x-b.x,d.x-c.x);assert.equal(a.y,d.y);
    const layout=structuredClone(Layout.defaults);layout.props.tray={x:100,y:-30,scale:.65};layout.modules.counter={x:40,y:20,scale:.8,visible:true};
    for(const bowl of shop.objects){
      const stage=Layout.workspaceToStage(bowl,layout,workflow),roundtrip=Layout.stageToWorkspace(stage,layout,workflow);
      assert.ok(Math.abs(roundtrip.x-bowl.x)<1e-8&&Math.abs(roundtrip.y-bowl.y)<1e-8);
    }
  });
});

test('托盘满了不创建或移动物品，取走后补空位，瓶装商品占用碗位',async t=>{
  const shop=await fixture(t);
  for(let i=0;i<4;i++)await shop.action({action:'place_bowl'});
  const previous=structuredClone(shop.objects),serial=shop.serial,revision=shop.revision;
  await assert.rejects(shop.action({action:'place_bowl'}),/托盘.*满/);
  assert.deepEqual(shop.objects,previous);assert.equal(shop.serial,serial);assert.equal(shop.revision,revision);
  await shop.action({action:'discard',revision:shop.revision,object_id:previous[1].id});
  await shop.action({action:'place_bowl'});
  assert.equal(shop.objects.at(-1).x,previous[1].x);assert.equal(shop.objects.at(-1).y,previous[1].y);
  assert.deepEqual(shop.objects.slice(0,3),previous.filter((_,i)=>i!==1));
  shop.objects=[{...previous[0],kind:'water'}];shop.selected=null;
  await shop.action({action:'place_bowl'});assert.equal(shop.objects.at(-1).x,previous[1].x);
});

test('停业和暂停不能放碗，500件上限不变',async t=>{
  const shop=await fixture(t);
  for(const mode of ['closed','paused']){shop.mode=mode;await assert.rejects(shop.action({action:'place_bowl'}),/开始|继续/);assert.equal(shop.objects.length,0);}
  shop.mode='running';shop.tip(500);const previous=structuredClone(shop.objects);
  await assert.rejects(shop.action({action:'place_bowl'}),/500|清理/);assert.deepEqual(shop.objects,previous);
});

test('快速连续点击顺序执行且不丢点击，托盘满后停止积压请求，拖拽和搭建不误放碗',async()=>{
  const source=await fs.readFile(path.join(__dirname,'..','public','noodle','game.js'),'utf8');
  const place=source.match(/async function placeBowl\(\) \{[\s\S]*?\n\}/)?.[0];assert.ok(place);
  const calls=[];let release;
  const context=vm.createContext({output:null,building:false,busy:false,state:{mode:'running'},drag:{drag:null},throwDrag:null,pendingPot:null,bowlClicks:0,placingBowl:false,
    send:async action=>{calls.push(action);if(calls.length===1)await new Promise(resolve=>release=resolve);return {workspace_revision:calls.length};}});
  vm.runInContext(place,context);
  const first=context.placeBowl();context.placeBowl();context.placeBowl();context.placeBowl();
  assert.equal(calls.length,1);release();await first;assert.equal(calls.length,4);
  context.send=async()=>undefined;
  await context.placeBowl();assert.equal(context.bowlClicks,0);assert.equal(context.placingBowl,false);
  for(const [key,value]of [['building',true],['busy',true],['output','counter'],['throwDrag',{}],['pendingPot',{}]]){
    context[key]=value;const before=calls.length;await context.placeBowl();assert.equal(calls.length,before);context[key]=key==='building'||key==='busy'?false:null;
  }
});
