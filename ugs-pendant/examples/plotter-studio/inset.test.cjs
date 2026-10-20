const assert=require('assert'),core=require('./core.js');
const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const base={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-.2,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
const shape=(id,pts,color,group,extra={})=>({id,name:id,closed:true,color,fillColor:color,group,points:pts,...extra});
const bbox=job=>core.bounds(job.paths.flatMap(p=>p.points));
const page=rect(0,0,20,10);

// ---- Rapid down to a height above the surface, then the last bit at the lowering feed
{
  const line={id:'l',name:'l',closed:false,color:'#000000',points:[{x:0,y:0},{x:10,y:0}]},doc={paths:[line],page:rect(0,0,10,1)};
  const text=extra=>{const o={...base,penMap:{'#000000':1},...extra};return core.gcode(core.plan(doc,o),o);};
  const off=text({});assert(/G0 X0 Y0\nG1 Z-0.2 F200/.test(off),'off: lowers the whole way with G1, as before');
  const on=text({approach:1});assert(/G0 X0 Y0\nG0 Z1\nG1 Z-0.2 F200/.test(on),'rapid to 1 mm above the surface, then G1');
  assert(!/G0 Z-/.test(on),'never rapids to or below the surface');
  assert(/G0 Z5\nG0 X0 Y0\nG1 Z-0.2/.test(text({approach:20})),'an approach height above Safe Z gives no extra move');
  assert.throws(()=>text({approach:-1}),/Rapid-down height/);
  assert(!/G0 Z1\n/.test(core.gcode(core.plan(doc,{...base,mode:'laser',tool:'M4',focus:0,laserPasses:1,approach:1}),{...base,mode:'laser',tool:'M4',focus:0,laserPasses:1,approach:1})),'plotter mode only');
  // deeper passes: still from the same height above the surface
  const multi=text({final:-1,step:.5,approach:1});assert.strictEqual((multi.match(/G0 Z1\n/g)||[]).length,2);
}

// ---- Both pens: each region's outline moves into its own region
{
  const A=shape('A',rect(0,0,10,10),'#101010',1),B=shape('B',rect(10,0,20,10),'#ffee00',2);
  const pens={'#101010':1,'#ffee00':2};
  const run=extra=>core.plan({paths:[A,B],page},{...base,penMap:pens,penWidth:.5,...extra});
  const one=run({}),both=run({borders:'both'});
  assert.strictEqual(one.inset.count,0);assert.strictEqual(both.inset.count,2);
  const a=both.paths.find(p=>p.id==='A'),b=both.paths.find(p=>p.id==='B');
  const ab=core.bounds(a.points),bb=core.bounds(b.points);
  assert(Math.abs(ab.minX-.25)<1e-9&&Math.abs(ab.maxX-9.75)<1e-9&&Math.abs(ab.minY-.25)<1e-9,'A moved in by half the 0.5 mm pen: '+JSON.stringify(ab));
  assert(Math.abs(bb.minX-10.25)<1e-9&&Math.abs(bb.maxX-19.75)<1e-9,'B moved into its own side');
  assert(Math.abs(bb.minX-ab.maxX-.5)<1e-9,'the two lines are one pen width apart, not on top of each other');
  assert(a.closed&&b.closed,'outlines stay closed');
  // the amount can be set, and different pen widths give different insets
  const wide=run({borders:'both',borderInset:.4}),wa=core.bounds(wide.paths.find(p=>p.id==='A').points);
  assert(Math.abs(wa.maxX-9.6)<1e-9);
  const mixed=run({borders:'both',penWidths:{1:.2,2:1}});
  assert(Math.abs(core.bounds(mixed.paths.find(p=>p.id==='A').points).maxX-9.9)<1e-9&&Math.abs(core.bounds(mixed.paths.find(p=>p.id==='B').points).minX-10.5)<1e-9);
  // no two plotted lines coincide now
  const dseg=(m,p,q)=>{const dx=q.x-p.x,dy=q.y-p.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((m.x-p.x)*dx+(m.y-p.y)*dy)/l)):0;return Math.hypot(m.x-p.x-t*dx,m.y-p.y-t*dy);};
  const edgeA=a.points.filter(p=>Math.abs(p.x-9.75)<1e-9);assert(edgeA.length>=2);
  assert(b.points.every(p=>dseg(p,{x:9.75,y:0},{x:9.75,y:10})>.2),'B never comes within a line width of A\'s edge');
}
// ---- a ring: the outer edge moves in, the hole's edge moves away from the hole (both into the filled ring)
{
  const ring=[shape('outer',rect(0,0,20,20),'#101010',1),shape('hole',rect(6,6,14,14),'#101010',1)];
  const job=core.plan({paths:ring,page:rect(0,0,20,20)},{...base,penMap:{'#101010':1},penWidth:.5,borders:'both'});
  const outer=core.bounds(job.paths.find(p=>p.id==='outer').points),hole=core.bounds(job.paths.find(p=>p.id==='hole').points);
  assert(Math.abs(outer.minX-.25)<1e-9&&Math.abs(outer.maxX-19.75)<1e-9,'the outer edge moves in');
  assert(Math.abs(hole.minX-5.75)<1e-9&&Math.abs(hole.maxX-14.25)<1e-9,'the hole edge moves away from the hole: '+JSON.stringify(hole));
  assert.strictEqual(job.inset.count,2);
  // a clockwise outline is handled the same as a counter-clockwise one
  const cw=shape('cw',rect(0,0,10,10).reverse(),'#101010',1);
  const j2=core.plan({paths:[cw],page:rect(0,0,10,10)},{...base,penMap:{'#101010':1},penWidth:.5,borders:'both'});
  const bb2=core.bounds(j2.paths[0].points);assert(Math.abs(bb2.minX-.25)<1e-9&&Math.abs(bb2.maxX-9.75)<1e-9);
}
// ---- thin regions are not turned inside out; shapes with no fill are left alone
{
  const sliver=shape('sliver',rect(0,0,.2,10),'#101010',1);
  const job=core.plan({paths:[sliver],page:rect(0,0,.2,10)},{...base,penMap:{'#101010':1},penWidth:.5,borders:'both'});
  const b=core.bounds(job.paths[0].points);
  assert(b.minX>=0&&b.maxX<=.2+1e-9&&b.maxX>b.minX,'a 0.2 mm sliver keeps a valid outline inside itself');
  const stroke=shape('s',rect(0,0,10,10),'#101010',1,{fillColor:null});
  const j2=core.plan({paths:[stroke],page:rect(0,0,10,10)},{...base,penMap:{'#101010':1},borders:'both'});
  assert.strictEqual(j2.inset.count,0);const bb=core.bounds(j2.paths[0].points);assert(bb.minX===0&&bb.maxX===10,'a stroke-only shape keeps its centerline');
  assert.throws(()=>core.plan({paths:[sliver],page},{...base,penMap:{'#101010':1},borders:'neither'}),/Shared borders/);
  assert.throws(()=>core.plan({paths:[sliver],page},{...base,penMap:{'#101010':1},borders:'both',borderInset:9}),/Border inset/);
  assert.strictEqual(core.plan({paths:[A=shape('x',rect(0,0,10,10),'#101010',1)],page},{...base,mode:'laser',tool:'M4',focus:0,laserPasses:1,borders:'both'}).inset.count,0,'plotter mode only');
}
// ---- sharp corners: an inset star keeps one point per tip, never crosses itself, and stays inside
{
  const star=[];for(let i=0;i<10;i++){const r=i%2?2:5,a=Math.PI/2+i*Math.PI/5;star.push({x:r*Math.cos(a)+5,y:r*Math.sin(a)+5});}
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const crossings=pts=>{let n=0;for(let i=0;i<pts.length;i++)for(let j=i+2;j<pts.length;j++){if(i===0&&j===pts.length-1)continue;const a=pts[i],b=pts[(i+1)%pts.length],c=pts[j],d=pts[(j+1)%pts.length];if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)n++;}return n;};
  const inside=(p,poly)=>{let h=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)h=!h;}return h;};
  const dseg=(m,p,q)=>{const dx=q.x-p.x,dy=q.y-p.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((m.x-p.x)*dx+(m.y-p.y)*dy)/l)):0;return Math.hypot(m.x-p.x-t*dx,m.y-p.y-t*dy);};
  for(const d of [.1,.25,.4]){
    const off=core.offsetPath(star,true,d);
    assert.strictEqual(off.length,10,'one point per corner at inset '+d+' (no bevel flaps)');
    assert.strictEqual(crossings(off),0,'the inset star does not cross itself');
    assert(off.every(p=>inside(p,star)),'every inset point is inside the star');
    assert(Math.abs(Math.min(...off.map(p=>Math.min(...star.map((q,i)=>dseg(p,q,star[(i+1)%star.length])))))-d)<1e-9,'the inset is exactly the distance asked for');
  }
  // through plan(): a star-shaped region with a fill keeps a clean, closed, smaller outline
  const region=shape('star',star,'#ffcc00',1),job=core.plan({paths:[region],page:rect(0,0,10,10)},{...base,penMap:{'#ffcc00':1},penWidth:.5,borders:'both'});
  const out=job.paths[0];assert(out.closed&&crossings(out.points.slice(0,-1))===0&&out.points.length>=10,'the planned star outline is clean');
  // the outside of a turn (a hole in the star's shape, offset outward) is also clean at sharp corners
  const hole=star.map(p=>({x:(p.x-5)*.5+5,y:(p.y-5)*.5+5}));
  const ring=core.plan({paths:[shape('outer',rect(0,0,10,10),'#ffcc00',1),shape('hole',hole,'#ffcc00',1)],page:rect(0,0,10,10)},{...base,penMap:{'#ffcc00':1},penWidth:.5,borders:'both'});
  const h=ring.paths.find(p=>p.id==='hole');assert(h&&crossings(h.points.filter((p,i,a)=>i<a.length-1||Math.hypot(p.x-a[0].x,p.y-a[0].y)>1e-9))===0,'a star-shaped hole edge offset outward does not cross itself');
}
console.log('inset ok');
