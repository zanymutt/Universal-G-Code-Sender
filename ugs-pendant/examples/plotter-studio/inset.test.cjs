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

// ---- Both pens remain available when hidden-line removal clips a small overlap
{
  // The upper region covers the last 0.1 mm of A. Its edge is still outside A's
  // inset line, so both regions have a visible, closed border to plot.
  const A=shape('A-overlap',rect(0,0,10,10),'#101010',1),B=shape('B-overlap',rect(9.9,0,20,10),'#ffee00',2);
  const job=core.plan({paths:[A,B],page:rect(0,0,20,10)},{...base,penMap:{'#101010':1,'#ffee00':2},penWidth:.5,borders:'both',hideCovered:true,dedupeTol:0});
  assert.strictEqual(job.inset.count,2,'both region outlines are inset before clipping');
  assert(job.paths.some(p=>p.id==='A-overlap'&&p.closed),'the lower region keeps a closed inset outline');
  assert(job.paths.some(p=>p.id==='B-overlap'&&p.closed),'the upper region keeps its closed inset outline');
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
// ---- both pens derive the missing lower-region edge from an overlaid fill
{
  const lower=shape('lower',rect(0,0,10,10),'#777777',1),upper=shape('upper',rect(2,2,8,8),'#ffffff',2);
  const job=core.plan({paths:[lower,upper],page:rect(0,0,10,10)},{...base,penMap:{'#777777':1,'#ffffff':2},penWidth:.5,borders:'both',hideCovered:true,dedupeTol:0,fills:{1:{mode:'none',angle:0,spacing:1,gap:0},2:{mode:'none',angle:0,spacing:1,gap:0}}});
  assert(job.shared.count>0,'the overlaid white region creates shared-boundary candidates');
  const gray=job.paths.filter(p=>p.derivedShared&&p.color==='#777777');
  assert(gray.length>0,'the gray pen gets the missing companion boundary');
  assert(gray.some(p=>p.points.some(q=>Math.abs(q.x-1.75)<1e-9||Math.abs(q.x-8.25)<1e-9)),'the gray companion is inset into the gray side');
  assert(job.paths.some(p=>p.id==='upper'&&p.color==='#ffffff'),'the white outline remains independent');
  const one=core.plan({paths:[lower,upper],page:rect(0,0,10,10)},{...base,penMap:{'#777777':1,'#ffffff':2},penWidth:.5,borders:'one',hideCovered:true,dedupeTol:.05,dedupeKeep:'dark',fills:{1:{mode:'none',angle:0,spacing:1,gap:0},2:{mode:'none',angle:0,spacing:1,gap:0}}});
  assert(one.paths.some(p=>p.derivedShared&&p.color==='#777777'),'one-pen mode has a selectable gray shared candidate');
  assert(!one.paths.some(p=>p.id==='upper'&&p.color==='#ffffff'),'dark shared-line selection removes the white duplicate');
  const skipped=core.plan({paths:[lower,upper],page:rect(0,0,10,10)},{...base,penMap:{'#777777':1,'#ffffff':0},penWidth:.5,borders:'both',hideCovered:true,dedupeTol:0,fills:{1:{mode:'none',angle:0,spacing:1,gap:0}}});
  assert(skipped.paths.some(p=>p.derivedShared&&p.color==='#777777'),'skipping white leaves the gray companion intact');
}
// ---- a sampled overlaid eye has one continuous companion outline
{
  const eye=Array.from({length:80},(_,i)=>{const a=i*2*Math.PI/80;return {x:5+3*Math.cos(a),y:5+2*Math.sin(a)};});
  const gray=shape('gray',rect(0,0,10,10),'#777777',1),white=shape('white-eye',eye,'#ffffff',2);
  const o={...base,penMap:{'#777777':1,'#ffffff':2},penWidth:.5,borders:'both',hideCovered:true,dedupeTol:0,fillSource:'none'};
  const job=core.plan({paths:[gray,white],page:rect(0,0,10,10)},o);
  const companion=job.paths.filter(p=>p.derivedShared&&p.color==='#777777');
  assert.strictEqual(companion.length,1,'sampled eye segments form one gray companion path');
  assert(companion[0].closed&&companion[0].points.length>=80,'the gray boundary is a closed, smooth polyline');
  const code=core.gcode(job,o);
  assert.strictEqual((code.match(/\(Path \d+ - pass 1\/1\)/g)||[]).length,job.paths.length,'each continuous outline lowers the pen once');
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
// A real converted letter from the Gadsden SVG has narrow diagonal strokes.
// Its full 0.5 mm inset drops most of one contour; a smaller local inset keeps it.
{
  const G=require('./geometry.js');
  const d='M -553.06203 519.09648 L -555.94203 519.09648 C -557.62207 519.09652 -558.80207 520.17651 -559.48203 522.33648 C -559.72207 523.09651 -559.84207 523.85651 -559.84203 524.61648 L -559.84203 557.07648 L -563.68203 557.07648 L -586.96203 521.19648 L -586.96203 549.87648 C -586.96204 551.67648 -586.40204 553.17648 -585.28203 554.37648 C -584.64205 555.05648 -583.90205 555.39648 -583.06203 555.39648 L -580.78203 555.39648 L -580.78203 557.07648 L -595.12203 557.07648 L -595.12203 555.39648 L -592.18203 555.39648 C -590.62204 555.39648 -589.46204 554.35648 -588.70203 552.27648 C -588.42204 551.43648 -588.28204 550.63648 -588.28203 549.87648 L -588.28203 521.25648 C -588.28204 520.37651 -588.72204 519.71651 -589.60203 519.27648 C -589.88204 519.11652 -590.16204 519.03652 -590.44203 519.03648 L -593.56203 519.03648 L -593.56203 517.41648 L -584.20203 517.41648 L -561.22203 552.27648 L -561.22203 524.61648 C -561.22207 522.53651 -561.80207 520.95651 -562.96203 519.87648 C -563.56207 519.35651 -564.26207 519.09652 -565.06203 519.09648 L -567.34203 519.09648 L -567.34203 517.41648 L -553.06203 517.41648 L -553.06203 519.09648';
  const s=25.4/96,doc=G.run({items:[{d,closed:false,fillColor:'#101010',color:'#101010',group:2,matrix:[s,0,0,s,600*s,0],height:600*s,name:'letter'}],width:20,height:25,options:{spacing:.5,tolerance:.03,cleanup:0,curveSegments:8,equalDistance:0,mergeDistance:.001}});
  assert(doc.paths[0].closed,'filled letter is implicitly closed');
  const sourceLength=core.length([...doc.paths[0].points,doc.paths[0].points[0]]);
  const yellow=shape('paper',rect(0,0,20,25),'#ffee00',1);
  const o={...base,penMap:{'#ffee00':1,'#101010':2},penWidth:.5,borders:'both',hideCovered:true,dedupeTol:0,fillSource:'none'};
  const job=core.plan({paths:[yellow,...doc.paths],page:rect(0,0,20,25)},o);
  assert(job.inset.recovered>=1,'the thin letter receives an adaptive inset');
  const black=job.paths.filter(p=>p.color==='#101010');
  assert(black.reduce((n,p)=>n+core.length(p.points),0)>sourceLength*.9,'most of the black letter remains at 0.5 mm');
  assert(job.paths.some(p=>p.derivedShared&&p.color==='#ffee00'),'the yellow companion is retained');
  const ordinary=core.plan({paths:[shape('wide',rect(2,2,8,8),'#101010',1),shape('right',rect(8,2,14,8),'#ffee00',2)],page:rect(0,0,14,10)},o);
  assert.equal(ordinary.inset.recovered,0,'wide neighboring regions keep their standard inset');
}
// A 0.2 mm black strip drawn with a 0.5 mm pen protrudes beyond its region.
// Its yellow companion must move outward by that same protrusion.
{
  const yellow=shape('paper',rect(0,0,10,10),'#ffee00',1),black=shape('strip',rect(5,1,5.2,9),'#101010',2);
  const o={...base,penMap:{'#ffee00':1,'#101010':2},penWidth:.5,borders:'both',hideCovered:true,dedupeTol:0,fillSource:'none'};
  const job=core.plan({paths:[yellow,black],page:rect(0,0,10,10)},o);
  const atY=(paths,y)=>paths.flatMap(p=>{
    const xs=[];for(let i=0;i<p.points.length-1;i++){
      const a=p.points[i],b=p.points[i+1];
      if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))xs.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));
    }return xs;
  });
  const bx=atY(job.paths.filter(p=>p.id==='strip'),5).sort((a,b)=>a-b);
  const yx=atY(job.paths.filter(p=>p.derivedShared&&p.color==='#ffee00'),5).sort((a,b)=>a-b);
  assert(bx.length>=2&&yx.length>=2,'both colors retain the narrow strip border');
  assert(bx[0]-yx[0]>=.5-1e-6&&yx.at(-1)-bx.at(-1)>=.5-1e-6,'yellow ink sits just outside black ink on both sides');
}
console.log('inset ok');
