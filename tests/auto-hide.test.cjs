const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAutoHidePolicy } = require('../auto-hide');
function replay(display, workArea, bounds) {
  const policy=createAutoHidePolicy();let visible=false;
  return { reset:()=>policy.reset(), tick:(x,y,now)=>visible=policy.update({cursor:{x,y},bounds,display,workArea,visible,now}) };
}
test('continuous bottom retention works with top, bottom, side and auto-hidden taskbars at different origins',()=>{
 for(const origin of [{x:0,y:0},{x:-1920,y:-1080},{x:100,y:50}]) {
  const display={...origin,width:1920,height:1080};
  for(const inset of [{top:0,bottom:48,left:0},{top:48,bottom:0,left:0},{top:0,bottom:0,left:48},{top:0,bottom:2,left:0}]) {
   const workArea={x:origin.x+inset.left,y:origin.y+inset.top,width:1920-inset.left,height:1080-inset.top-inset.bottom};
   const bottom=workArea.y+workArea.height;
   const bounds={x:workArea.x+400,y:bottom-196,width:900,height:188};
   const h=replay(display,workArea,bounds),x=bounds.x+450;
   assert.equal(h.tick(x,bottom-1,0),true);
   let now=150;
   for(let y=bottom-7;y<display.y+display.height;y+=2) {
    assert.equal(h.tick(x,y,now),true);assert.equal(h.tick(x,y,now+1200),true);now+=1500;
   }
   assert.equal(h.tick(x,bounds.y+90,now),true);
   assert.equal(h.tick(x,display.y+display.height+20,now+100),true);
   assert.equal(h.tick(x,display.y+display.height+20,now+900),false);
  }
 }
});
test('hidden retention corridor and side slop cannot trigger a reveal',()=>{
 const h=replay({x:0,y:0,width:1000,height:800},{x:0,y:0,width:1000,height:752},{x:200,y:556,width:600,height:188});
 for(const point of [[500,748-5],[500,770],[190,751],[500,650],[500,820],[500,-1]])assert.equal(h.tick(...point,0),false,point.toString());
 assert.equal(h.tick(500,799,10),true);
});
test('brief exits and re-entry reset the leave interval, hold expires and reset clears stale deadlines',()=>{
 const policy=createAutoHidePolicy();
 const base={display:{x:0,y:0,width:1000,height:800},workArea:{x:0,y:0,width:1000,height:752},bounds:{x:200,y:556,width:600,height:188}};
 let visible=false;
 const tick=(cursor,now)=>visible=policy.update({...base,cursor,now,visible});
 assert.equal(tick({x:500,y:751},1000),true);
 assert.equal(tick({x:0,y:0},1010),true);
 assert.equal(tick({x:0,y:0},1800),true);
 assert.equal(tick({x:0,y:0},2000),false);
 assert.equal(tick({x:500,y:799},2100),true);
 assert.equal(tick({x:0,y:0},2300),true);
 assert.equal(tick({x:500,y:650},2900),true);
 assert.equal(tick({x:0,y:0},3000),true);
 assert.equal(tick({x:0,y:0},3600),true);
 assert.equal(tick({x:0,y:0},3700),false);
 assert.equal(tick({x:500,y:799},4000),true);
 policy.reset();
 assert.equal(tick({x:0,y:0},4010),true);
 assert.equal(tick({x:0,y:0},4710),false);
});
