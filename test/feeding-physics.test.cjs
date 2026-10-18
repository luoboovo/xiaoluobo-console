const {test}=require('node:test');
const assert=require('node:assert/strict');
const P=require('../lib/feeding-physics.cjs');

test('密集食物落地后完全停止位移和旋转',()=>{
  const foods=Array.from({length:2000},(_,i)=>P.spawn({id:i+1,slot:i},56));
  for(let i=0;i<600;i++)P.step(foods,56);
  assert.equal(foods.filter(o=>!P.asleep(o)).length,0,'落地20秒后仍有食物没有静止');
  const before=foods.map(({x,y,angle})=>({x,y,angle}));
  for(let i=0;i<60;i++)P.step(foods,56);
  assert.deepEqual(foods.map(({x,y,angle})=>({x,y,angle})),before);
});

test('大小食物落地后停止，拖动和刮风会唤醒静止食物',()=>{
  for(const size of [16,56,160]){
    const foods=Array.from({length:80},(_,i)=>P.spawn({id:i+1,slot:i},size));
    for(let i=0;i<600;i++)P.step(foods,size);
    assert.ok(foods.every(P.asleep),`尺寸 ${size} 仍有食物移动`);
    const food=foods[0];Object.assign(food,{x:300,y:100});
    P.step(foods,size,new Set([food.id]));assert.ok(!P.asleep(food));assert.equal(food.y,100);
    P.step(foods,size);assert.ok(food.y>100);
    P.step(foods,size,new Set(),true);assert.ok(foods.every(o=>!P.asleep(o)));
  }
});

test('移走底层食物后上层重新下落，新落下的食物不会晃动静止的食物',()=>{
  const lower=P.spawn({id:1,slot:0},56),upper=P.spawn({id:2,slot:1},56);
  lower.x=upper.x=300;lower.y=720-P.radius(lower,56);upper.y=lower.y-P.radius(lower,56)-P.radius(upper,56);
  for(const food of [lower,upper])Object.assign(food,{vx:0,vy:0,spin:0,rest:10});
  P.step([lower,upper],56);assert.ok(P.asleep(upper));
  const floor={x:lower.x,y:lower.y,angle:lower.angle};
  const falling=P.spawn({id:3,slot:2},56,{x:300,y:upper.y-100});
  for(let i=0;i<120;i++)P.step([lower,upper,falling],56);
  assert.deepEqual({x:lower.x,y:lower.y,angle:lower.angle},floor);
  const y=upper.y;P.step([upper],56);assert.ok(!P.asleep(upper));
  P.step([upper],56);assert.ok(upper.y>y);
});
