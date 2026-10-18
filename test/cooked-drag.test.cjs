const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Layout=require('../public/noodle/layout.js');
const source=fs.readFileSync(require.resolve('../public/noodle/game.js'),'utf8');
const pickup=source.match(/async function takeCooked\(pick\) \{[\s\S]*?\n\}/)[0];

test('取熟面按住即拖动；快速松手和取消在取面完成后正确处理，失败不生成面',async()=>{
  for(const outcome of ['held','released','cancelled','failed']) {
    let resolve,finishes=[];
    const context=vm.createContext({pendingPot:null,keyboardDrag:false,drag:{drag:null},workspace:{objects:[],selected:null},state:{mode:'running'},revision:0,layout:Layout.defaults,NoodleLayout:Layout,motionDirty:false,
      send:()=>new Promise(done=>{resolve=next=>{if(next)context.workspace.objects=[{id:next.object_serial,kind:'cooked',x:100,y:420}];done(next);};}),
      drawObjects:()=>{},highlight:()=>{},sendMotion:()=>{},finish:cancel=>finishes.push(cancel)});
    vm.runInContext(pickup,context);
    const pick={point:{x:100,y:410}};
    const pending=context.takeCooked(pick);
    pick.point={x:700,y:430};
    if(['released','cancelled'].includes(outcome))pick.released=true;
    if(outcome==='cancelled')pick.cancel=true;
    resolve(outcome==='failed'?undefined:{object_serial:7});await pending;
    assert.equal(context.pendingPot,null);
    if(outcome==='failed')assert.equal(context.drag.drag,null);
    else {
      assert.deepEqual(Layout.workspaceToStage(context.drag.drag.o,Layout.defaults),pick.point);
      assert.deepEqual(finishes,outcome==='released'?[false]:outcome==='cancelled'?[true]:[]);
      assert.equal(context.drag.drag.fresh,false);
    }
  }
});

test('熟面和生面使用不同素材，拖动配料不取料碗素材',async()=>{
  const {food}=await import('../public/noodle/food.js');
  const original=globalThis.document;
  globalThis.document={createElement:()=>({})};
  const asset=(key,fallback)=>({raw:'/template/raw.png',scallions:'/template/scallions-bowl.png',cilantro:'/template/cilantro-bowl.png'}[key]||'/noodle/assets/'+fallback+'.png');
  try {
    assert.equal(food('raw',asset).src,'/template/raw.png');
    assert.equal(food('cooked',asset).src,'/noodle/assets/portion-cooked.png');
    assert.equal(food('scallions',asset).src,'/noodle/assets/portion-scallions.png');
    assert.equal(food('cilantro',asset).src,'/noodle/assets/portion-cilantro.png');
  } finally {
    if(original===undefined)delete globalThis.document;else globalThis.document=original;
  }
});
