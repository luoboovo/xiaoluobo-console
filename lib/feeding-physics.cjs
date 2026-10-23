const F=require('../public/feeding/shared.js');
const radius=(food,size)=>size*(.39+F.noise(food.id,8)*.08);
function spawn(food,size,placement){
  const r=radius(food,size),columns=Math.max(1,Math.floor(F.WIDTH/size));
  return {...food,x:placement?.x??(r+F.noise(food.id,13)*(F.WIDTH-r*2)),y:placement?.y??(-r-F.noise(food.id,17)*420-Math.floor(food.slot/columns)*size),vx:(F.noise(food.id,23)-.5)*100,vy:0,angle:(F.noise(food.id,7)-.5)*Math.PI,spin:(F.noise(food.id,29)-.5)*2};
}
// reach is the eater's hit radius as a share of its size: falling food uses the tighter mouth,
// a dragged eater uses about its drawn width so food it visibly covers on the floor is eaten.
const MOUTH_REACH=.36,DRAG_REACH=.46;
function touches(food,from,to,size,foodSize,reach=MOUTH_REACH){
  const dx=to.x-from.x,dy=to.y-from.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((food.x-from.x)*dx+(food.y-from.y)*dy)/length)):0;
  return Math.hypot(food.x-from.x-dx*t,food.y-from.y-dy*t)<size*reach+radius(food,foodSize);
}
// A food that barely moves for REST_FRAMES frames sleeps: no gravity, and it acts as a fixed surface.
// It wakes again once nothing holds it up, so eating from a pile makes the foods above fall in a chain.
const REST_MOVE=.35,REST_FRAMES=10;
// Measure wobble around an anchor, so a single collision correction cannot restart the rest timer forever.
const STUCK_MOVE=4,STUCK_FRAMES=45;
// More food than one screen can hold overlaps evenly (smaller collision circles) instead of stacking off-screen.
const CROWD_FILL=.62;
// One overlap fix moves a food at most this far per pass, so crowded piles cannot fling foods around.
const MAX_PUSH=3;
const asleep=food=>food.rest>=REST_FRAMES;
const cellKey=(x,y)=>x*100003+y;
function grid(foods,cellSize){
  const cells=new Map();
  for(const food of foods){const key=cellKey(Math.floor(food.x/cellSize),Math.floor(food.y/cellSize));const cell=cells.get(key);if(cell)cell.push(food);else cells.set(key,[food]);}
  return cells;
}
function step(foods,size,held=new Set(),wind=false,dt=1/30){
  const fixed=food=>held.has(food.id)||asleep(food);
  if(wind)for(const food of foods)food.rest=food.stuck=0;
  const crowd=Math.min(1,Math.sqrt(F.WIDTH*F.HEIGHT*CROWD_FILL/(Math.max(1,foods.length)*Math.PI*(size*.43)**2)));
  const hit=food=>radius(food,size)*crowd,cellSize=Math.max(8,size*.94*crowd);
  const previous=new Map(foods.map(food=>[food.id,{x:food.x,y:food.y,moving:!fixed(food)}]));
  const bounds=food=>{
    const r=radius(food,size);
    if(food.x<r){food.x=r;food.vx=Math.abs(food.vx)*.25;}
    if(food.x>F.WIDTH-r){food.x=F.WIDTH-r;food.vx=-Math.abs(food.vx)*.25;}
    if(food.y>F.HEIGHT-r){food.y=F.HEIGHT-r;food.vy=Math.min(food.vy,0);food.vx*=.78;food.spin*=.8;}
  };
  for(const food of foods){
    if(fixed(food))continue;
    if(wind){food.vx+=(-(food.y-F.HEIGHT*.35)*2+(F.WIDTH/2-food.x)*.8)*dt;food.vy+=((food.x-F.WIDTH/2)*1.1-1100)*dt;if(food.y<-250)food.vy+=1800*dt;}
    food.vy=Math.min(1100,food.vy+1050*dt);food.vx=Math.max(-800,Math.min(800,food.vx*.995));food.x+=food.vx*dt;food.y+=food.vy*dt;food.angle+=food.spin*dt+food.vx*dt/Math.max(1,size)*.25;food.spin*=.99;bounds(food);
  }
  const integrated=new Map(foods.map(food=>[food.id,food.y]));
  // Nearby circles give loose piles without comparing every food with every other food.
  const contact=new Set();
  for(let pass=0;pass<3;pass++){
    const cells=grid(foods,cellSize);
    for(const [key,cell]of cells){
      const cellX=Math.round(key/100003),cellY=key-cellX*100003;
      for(let x=cellX-1;x<=cellX+1;x++)for(let y=cellY-1;y<=cellY+1;y++){
        const other=cells.get(cellKey(x,y));if(!other)continue;
        for(const a of cell)for(const b of other){
          if(b.id<=a.id)continue;const massA=fixed(a)?0:1,massB=fixed(b)?0:1,total=massA+massB;if(!total)continue;
          let dx=b.x-a.x,dy=b.y-a.y,distance=Math.hypot(dx,dy);const minimum=hit(a)+hit(b);if(distance>=minimum)continue;
          if(distance<.001){dx=F.noise(a.id+b.id,5)-.5;dy=-.5;distance=Math.hypot(dx,dy);}
          const nx=dx/distance,ny=dy/distance,push=Math.min(MAX_PUSH,(minimum-distance)*.85/total);
          a.x-=nx*push*massA;a.y-=ny*push*massA;b.x+=nx*push*massB;b.y+=ny*push*massB;contact.add(a);contact.add(b);
        }
      }
    }
    for(const food of foods)if(!fixed(food))bounds(food);
  }
  let movement=0;
  for(const food of foods){
    const before=previous.get(food.id),moved=Math.hypot(food.x-before.x,food.y-before.y);movement=Math.max(movement,moved);
    if(held.has(food.id)){food.rest=food.stuck=0;continue;}
    if(!before.moving)continue;
    // Overlap fixes move foods but never add speed (that is what kept dense piles shaking).
    // A food pushed up by what is below it stops falling, and touching foods slide with friction.
    if(contact.has(food)){food.vx*=.8;food.spin*=.8;if(food.y<integrated.get(food.id)-.01)food.vy=Math.min(food.vy,0);}
    const anchor=food.restAnchor,steady=anchor&&Math.hypot(food.x-anchor.x,food.y-anchor.y)<STUCK_MOVE;
    food.stuck=contact.has(food)&&steady?(food.stuck||0)+1:0;
    if(!steady)food.restAnchor={x:food.x,y:food.y};
    food.rest=food.stuck>=STUCK_FRAMES?REST_FRAMES:moved<REST_MOVE?(food.rest||0)+1:0;
    if(asleep(food)){food.vx=food.vy=food.spin=0;food.stuck=0;}
  }
  const cells=grid(foods,cellSize);
  for(const a of foods){
    if(!asleep(a)||a.y>=F.HEIGHT-radius(a,size)-.5)continue;
    const cellX=Math.floor(a.x/cellSize),cellY=Math.floor(a.y/cellSize),reach=hit(a)+1;let supported=false;
    for(let x=cellX-1;x<=cellX+1&&!supported;x++)for(let y=cellY;y<=cellY+1&&!supported;y++)for(const b of cells.get(cellKey(x,y))||[]){
      if(b!==a&&!held.has(b.id)&&b.y>a.y&&Math.hypot(b.x-a.x,b.y-a.y)<reach+hit(b)){supported=true;break;}
    }
    if(!supported)a.rest=a.stuck=0;
  }
  return movement;
}
module.exports={radius,spawn,touches,step,asleep,DRAG_REACH};
