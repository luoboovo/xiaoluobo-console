const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const noop=()=>{},ctx=new Proxy({},{get:()=>noop,set:()=>true});
const TicketPile=vm.runInNewContext(fs.readFileSync(require.resolve('../public/lottery/tickets.js'),'utf8')+';TicketPile',{OffscreenCanvas:class{getContext(){return ctx;}}});

test('签卡投影命中最上层，不误选被遮挡的签，摇动后布局可复现',()=>{
  const pile=new TicketPile(ctx),other=new TicketPile(ctx);
  for(const count of [1,12,52,200])for(const seed of [1,123,9176]){
    pile.draw({count,seed});other.draw({count,seed});assert.equal(pile.cards.length,count);
    assert.equal(JSON.stringify(pile.cards),JSON.stringify(other.cards));
    for(const card of pile.drawn){const m=card.matrix;assert.ok([m.a,m.b,m.c,m.d,m.e,m.f].every(Number.isFinite));assert.ok(Math.abs(m.a*m.d-m.b*m.c)>.025);}
    const top=pile.drawn.at(-1);assert.equal(pile.hit(top.matrix.e,top.matrix.f),top.index);
    assert.equal(pile.hit(-100,-100),-1);
  }
  const before=JSON.stringify(pile.cards);pile.draw({count:200,seed:9177});assert.notEqual(JSON.stringify(pile.cards),before);
});
