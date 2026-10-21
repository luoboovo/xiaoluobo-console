/* Drawing and hit testing use the same projection of each paper ticket. */
class TicketPile {
  constructor(ctx){this.ctx=ctx;this.cards=[];this.key='';this.hover=-1;}
  random(seed){let n=seed|0;return()=>{n+=0x6D2B79F5;let t=Math.imul(n^n>>>15,1|n);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
  layout(count,seed){
    const key=count+':'+seed;if(this.key===key)return;this.key=key;
    const random=this.random(seed+9173),scale=count<12?.9:1;
    this.cards=Array.from({length:count},(_,index)=>{
      const radius=Math.pow(random(),.7),angle=random()*Math.PI*2,x=Math.cos(angle)*radius*330*scale,z=Math.sin(angle)*radius*260*scale;
      const standing=radius>.65&&z<0&&random()<.3;
      return {index,x,z,y:15+(1-radius)*95+random()*20,
        yaw:standing?random()*.8-.4:random()*Math.PI*2,tilt:standing?1.15+random()*.4:random()*.16,
        color:index%7,front:random()>.38,spin:random()*Math.PI*2,flight:80+random()*120};
    });
  }
  project(x,y,z){return {x:640+x*1.14,y:416+z*.78-y*.92};}
  matrix(card,age){
    const motion=Math.max(0,1-age/1700),air=Math.sin(Math.min(1,age/1700)*Math.PI)*motion;
    const yaw=card.yaw+motion*Math.sin(card.spin+age/170)*1.5,tilt=card.tilt+motion*Math.sin(age/160+card.spin)*1.1;
    const center=this.project(card.x+Math.sin(card.spin)*air*100,card.y+air*card.flight,card.z+Math.cos(card.spin)*air*80);
    const c=Math.cos(yaw),s=Math.sin(yaw),t=Math.cos(tilt),h=Math.sin(tilt);
    return {a:c*1.14,b:s*.78,c:-s*t*1.14,d:c*t*.78-h*.92,e:center.x,f:center.y,depth:card.z+card.y*.25};
  }
  paper(matrix,color,front,index,hover=false){
    const ctx=this.ctx,palette=['#ff8879','#ffe18a','#b87bea','#e58fc1','#74d68c','#89a5f5','#ffd198'],fill=palette[color%7],edge='#75584e';
    const draw=(dy,base)=>{ctx.save();ctx.transform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f+dy);ctx.lineJoin='round';ctx.lineWidth=4.5;ctx.strokeStyle=edge;
      ctx.beginPath();ctx.roundRect(-106,-65,212,130,10);ctx.fillStyle=base;ctx.fill();ctx.stroke();ctx.restore();};
    draw(5,'#d9ac78');draw(0,fill);
    ctx.save();ctx.transform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f);
    if(front){
      ctx.beginPath();ctx.moveTo(-87,-47);
      for(let x=-87;x<87;x+=8)ctx.lineTo(x,-47+(Math.floor((x+87)/8)%2?3:0));
      ctx.lineTo(87,44);for(let x=87;x>-87;x-=8)ctx.lineTo(x,44-(Math.floor((87-x)/8)%2?3:0));ctx.closePath();ctx.fillStyle='#fff8e75e';ctx.fill();
      ctx.beginPath();ctx.arc(0,44,12,0,Math.PI);ctx.fill();
    }else{
      ctx.strokeStyle='#fff8e780';ctx.lineWidth=4;ctx.lineCap='round';for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(-15+i*10,-13);ctx.lineTo(-22+i*10,13);ctx.stroke();}
    }
    if(hover){ctx.beginPath();ctx.roundRect(-107,-66,214,132,10);ctx.lineWidth=3;ctx.strokeStyle='#fffdf3';ctx.stroke();}
    ctx.restore();
  }
  draw({count,seed=1,age=2000,selected=-1,dim=false}){
    this.layout(count,seed);const ctx=this.ctx;
    if(dim)return;
    this.drawn=this.cards.map(card=>({...card,matrix:this.matrix(card,age)})).sort((a,b)=>a.matrix.depth-b.matrix.depth);
    ctx.save();
    for(const card of this.drawn){const p=this.project(card.x,0,card.z);ctx.save();ctx.translate(p.x+23,p.y+17);ctx.rotate(card.yaw*.5);ctx.scale(1,.55);ctx.beginPath();ctx.roundRect(-110,-65,220,130,17);ctx.fillStyle='#efdfa8b0';ctx.fill();ctx.restore();}
    for(const card of this.drawn)if(card.index!==selected)this.paper(card.matrix,card.color,card.front,card.index,this.hover===card.index);
    ctx.restore();
  }
  hit(x,y){
    for(const card of [...(this.drawn||[])].reverse()){
      const m=card.matrix,det=m.a*m.d-m.b*m.c;if(Math.abs(det)<.025)continue;
      const u=((x-m.e)*m.d-(y-m.f)*m.c)/det,v=((y-m.f)*m.a-(x-m.e)*m.b)/det;
      if(Math.abs(u)<106&&Math.abs(v)<65)return card.index;
    }return -1;
  }
  perforation(ctx,x,y,width,height,tab=false){
    ctx.beginPath();ctx.moveTo(x,y+4);
    for(let n=0;n<width;n+=14){const end=Math.min(width,n+14);ctx.lineTo(x+n,y);ctx.lineTo(x+Math.min(n+8,width),y);ctx.lineTo(x+Math.min(n+10,width),y+4);ctx.lineTo(x+Math.min(n+12,width),y+4);ctx.lineTo(x+end,y);}
    ctx.lineTo(x+width,y+height*.22);
    if(tab){ctx.bezierCurveTo(x+width+29,y+height*.2,x+width+29,y+height*.72,x+width,y+height*.72);}
    ctx.lineTo(x+width,y+height);
    for(let n=width;n>0;n-=14){ctx.lineTo(x+n,y+height);ctx.lineTo(x+Math.max(0,n-8),y+height);ctx.lineTo(x+Math.max(0,n-10),y+height-4);ctx.lineTo(x+Math.max(0,n-12),y+height-4);ctx.lineTo(x+Math.max(0,n-14),y+height);}
    ctx.lineTo(x,y+height*.72);if(!tab)ctx.bezierCurveTo(x-22,y+height*.72,x-22,y+height*.28,x,y+height*.28);
    ctx.closePath();
  }
  opened({index=0,phase,progress=0,winner,level='',arrive=1,elapsed=0}){
    const ctx=this.ctx,card=this.cards.find(c=>c.index===index),color=card?.color??index%7;
    const palette=['#ff8879','#ffe18a','#b87bea','#e58fc1','#74d68c','#89a5f5','#ffd198'];
    const p=Math.min(1,Math.max(0,progress)),done=phase==='done',eased=1-(1-Math.min(1,arrive))**3;
    const source=card?this.matrix(card,2000):{e:640,f:330},x=source.e+(640-305*p-source.e)*eased,y=source.f+(326-source.f)*eased,scale=.4+eased*2.1;
    ctx.save();ctx.translate(x,y);ctx.scale(scale,scale*.72);ctx.rotate(-.008);
    ctx.lineJoin='round';ctx.strokeStyle='#75584e';ctx.lineWidth=2.5;
    ctx.beginPath();ctx.roundRect(-106,-65,212,130,5);ctx.fillStyle='#d7a775';ctx.translate(0,4);ctx.fill();ctx.stroke();ctx.translate(0,-4);
    ctx.beginPath();ctx.roundRect(-106,-65,212,130,5);ctx.fillStyle=palette[color];ctx.fill();ctx.stroke();
    this.perforation(ctx,-87,-50,174,100);ctx.fillStyle='#fff';ctx.fill();
    if(p>0){
      const shadow=ctx.createLinearGradient(75,-50,95,-50);shadow.addColorStop(0,'#0000');shadow.addColorStop(1,'#0003');
      ctx.save();this.perforation(ctx,-87,-50,174,100);ctx.clip();ctx.fillStyle=shadow;ctx.fillRect(70,-50,30,100);ctx.restore();
    }
    const angle=p*Math.PI,flip=Math.cos(angle),gap=done?Math.min(3,elapsed/180):0;
    ctx.save();ctx.translate(87+gap,-Math.sin(angle)*8);ctx.scale(Math.max(.006,Math.abs(flip)),1);
    if(flip>=0){
      ctx.translate(-174,0);this.perforation(ctx,0,-50,174,100);ctx.fillStyle='#fff8e7';ctx.fill();
      ctx.lineWidth=.5;ctx.strokeStyle='#b9a58e';ctx.stroke();
    }else{
      ctx.rotate(done?Math.min(.035,elapsed/20000):0);
      this.perforation(ctx,0,-56,174,106,true);ctx.save();ctx.clip();
      ctx.fillStyle='#292b2b';ctx.fillRect(-2,-58,210,112);
      ctx.fillStyle='#3c559f';ctx.fillRect(-2,-56,185,17);ctx.fillStyle='#fff';ctx.fillRect(-2,-39,185,6);
      ctx.fillStyle='#656769';ctx.fillRect(-2,36,185,14);
      ctx.fillStyle='#fff';ctx.textAlign='left';ctx.textBaseline='middle';
      let fontSize=51;while(fontSize>18){ctx.font=`900 ${fontSize}px "Arial Black",Arial,sans-serif`;if(ctx.measureText(level).width<51)break;fontSize--;}
      ctx.fillText(level||'★',8,3);
      ctx.fillStyle='#9a9c9c';
      for(const [row,widths] of [[-19,[31,37,20]],[-5,[15,8,19,8,15,14]],[7,[13,23,24,13]]]){
        let left=54;for(const width of widths){ctx.beginPath();ctx.roundRect(left,row,width,row===-19?8:4,4);ctx.fill();left+=width+6;}
      }
      ctx.restore();this.perforation(ctx,0,-56,174,106,true);ctx.strokeStyle='#75584e';ctx.lineWidth=2.5;ctx.stroke();
    }
    ctx.restore();ctx.restore();
  }
}
