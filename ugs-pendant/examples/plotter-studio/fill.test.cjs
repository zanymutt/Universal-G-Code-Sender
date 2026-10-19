const assert=require('assert'),core=require('./core.js');
const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const len=s=>Math.hypot(s[1].x-s[0].x,s[1].y-s[0].y);
// square 10x10, horizontal lines every 1 mm, 0.5 mm gap: lines y=1..9, each from x=0.5 to 9.5
let segs=core.hatchLines([rect(0,0,10,10)],0,1,.5);
assert.strictEqual(segs.length,9);
assert(segs.every(s=>Math.abs(len(s)-9)<1e-9),'each line stops 0.5 mm short of both sides');
assert(segs.every(s=>Math.min(s[0].x,s[1].x)>=.5-1e-9&&Math.max(s[0].x,s[1].x)<=9.5+1e-9));
// boustrophedon: consecutive lines run in opposite directions
assert(Math.sign(segs[0][1].x-segs[0][0].x)!==Math.sign(segs[1][1].x-segs[1][0].x));
// gap 0 reaches the sides
segs=core.hatchLines([rect(0,0,10,10)],0,1,0);assert(segs.some(s=>Math.abs(len(s)-10)<1e-9));
// hole (same group): outer 0..10, inner 4..6 -> lines through the hole split in two, none enters it
segs=core.hatchLines([rect(0,0,10,10),rect(4,4,6,6)],0,1,.5);
for(const s of segs)for(const p of s){const inHoleBand=p.y>4-.5-1e-9&&p.y<6+.5+1e-9;if(inHoleBand)assert(p.x<=3.5+1e-9||p.x>=6.5-1e-9,'point '+JSON.stringify(p)+' too close to the hole');}
assert.strictEqual(segs.filter(s=>Math.abs(s[0].y-5)<1e-9).length,2);
// 45 degrees: every end stays at least `gap` from the outline
segs=core.hatchLines([rect(0,0,10,10)],45,1,.7);
assert(segs.length>5);
for(const s of segs)for(const p of s){const d=Math.min(p.x,10-p.x,p.y,10-p.y);assert(d>=.7-1e-6,'end at distance '+d);}
// lines at 45 degrees really are at 45 degrees
assert(segs.every(s=>Math.abs(Math.abs(s[1].x-s[0].x)-Math.abs(s[1].y-s[0].y))<1e-6));
// concave (L shape): a line crossing the notch is split and never leaves the shape
const L=[{x:0,y:0},{x:10,y:0},{x:10,y:4},{x:4,y:4},{x:4,y:10},{x:0,y:10}];
segs=core.hatchLines([L],0,1,.5);
assert(segs.every(s=>s.every(p=>p.x>=.5-1e-9&&p.y>=.5-1e-9&&(p.y<=4-.5+1e-9||p.x<=4-.5+1e-9))));
// too many lines is refused
assert.throws(()=>core.hatchLines([rect(0,0,1000,1000)],0,.01,0),/20,000/);

// ---- through plan(): fills follow the fill color's pen, honour the fill rules, and order after outlines
const base={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-1,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
const shape=(id,pts,extra)=>({id,name:id,closed:true,color:'#000000',points:pts,...extra});
const doc={paths:[shape('a',rect(0,0,10,10),{color:'#ff0000',fillColor:'#0000ff',group:1}),shape('b',rect(20,0,30,10),{color:'#ff0000',fillColor:null,group:2})],page:rect(0,0,30,10)};
const fills={2:{mode:'hatch',angle:0,spacing:2,gap:.5}};
let job=core.plan(doc,{...base,penMap:{'#ff0000':1,'#0000ff':2},fills});
assert.deepStrictEqual(job.pens,[1,2]);
const hatch=job.paths.filter(p=>p.fill);
assert(hatch.length>0&&hatch.every(p=>p.pen===2&&p.color==='#0000ff'),'only the shape that has a fill is hatched, on its fill color pen');
assert(hatch.length<10&&job.fills===hatch.length);
assert(job.paths.slice(0,2).every(p=>!p.fill),'outlines of pen 1 first');
// fill-all override hatches the unfilled shape in its stroke color
job=core.plan(doc,{...base,penMap:{'#ff0000':1,'#0000ff':2},fills:{1:{mode:'hatch',angle:0,spacing:2,gap:.5},2:fills[2]},fillAll:true});
assert(job.paths.some(p=>p.fill&&p.pen===1)&&job.paths.some(p=>p.fill&&p.pen===2));
// default: no fills configured -> nothing hatched, nothing changes
job=core.plan(doc,{...base,penMap:{'#ff0000':1,'#0000ff':2}});assert.strictEqual(job.fills,0);
// hatch before outlines within one pen
job=core.plan({paths:[doc.paths[0]],page:doc.page},{...base,penMap:{'#ff0000':1,'#0000ff':1},fills:{1:fills[2]},fillFirst:true});
assert(job.paths[0].fill&&!job.paths.at(-1).fill);
job=core.plan({paths:[doc.paths[0]],page:doc.page},{...base,penMap:{'#ff0000':1,'#0000ff':1},fills:{1:fills[2]}});
assert(!job.paths[0].fill&&job.paths.at(-1).fill);
// inner-first does not deadlock against hatch lines
assert(job.paths.length>1);
// skip unstroked drops the outline but keeps the hatch
job=core.plan({paths:[shape('c',rect(0,0,10,10),{color:'#0000ff',fillColor:'#0000ff',noStroke:true,group:1})],page:doc.page},{...base,penMap:{'#0000ff':1},fills:{1:fills[2]},skipUnstroked:true});
assert(job.paths.every(p=>p.fill));
// overlapping filled shapes are reported
const two={paths:[shape('d',rect(0,0,10,10),{fillColor:'#0000ff',group:1}),shape('e',rect(5,5,15,15),{fillColor:'#0000ff',group:2})],page:rect(0,0,15,15)};
job=core.plan(two,{...base,penMap:{'#0000ff':1},fills:{1:fills[2]}});assert.strictEqual(job.fillOverlaps,1);
// cross-hatch makes a second set at +90 degrees
const one={paths:[doc.paths[0]],page:doc.page},hOnly=core.plan(one,{...base,penMap:{'#0000ff':1,'#ff0000':1},fills:{1:{...fills[2],mode:'hatch'}}}).fills;
assert.strictEqual(core.plan(one,{...base,penMap:{'#0000ff':1,'#ff0000':1},fills:{1:{...fills[2],mode:'cross'}}}).fills,hOnly*2);
// bad settings are explained
assert.throws(()=>core.plan(doc,{...base,penMap:{'#ff0000':1,'#0000ff':2},fills:{2:{mode:'hatch',angle:0,spacing:0,gap:0}}}),/Pen 2 fill/);
// knife/laser never hatch
assert.strictEqual(core.plan(doc,{...base,mode:'laser',tool:'M4',focus:0,laserPasses:1,fills}).fills,0);
console.log('fill ok');

// ---- wavy lines
{
  const dist=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);
  const edgeDist=(p,r)=>Math.min(p.x-r.x0,r.x1-p.x,p.y-r.y0,r.y1-p.y);
  const square=[rect(0,0,20,20)],box={x0:0,y0:0,x1:20,y1:20};
  const waves=core.hatchLines(square,0,2,.5,{wave:true,amp:.8,wavelength:5,shift:0});
  assert(waves.length>5,'many wavy lines');
  // the wave is trimmed to the gap from the outline, not to the gap plus the wave height
  const allPts=waves.flat(),minEdge=Math.min(...allPts.map(p=>edgeDist(p,box)));
  assert(allPts.every(p=>edgeDist(p,box)>=.5-1e-6),'no point closer than the gap');
  assert(minEdge<.5+.02,'waves run right up to the gap ('+minEdge.toFixed(4)+' from the outline)');
  assert(waves.some(w=>w.some(p=>p.x<.5+.05))&&waves.some(w=>w.some(p=>p.x>20-.5-.05)),'reaches the left and right sides');
  assert(allPts.some(p=>p.y>20-.5-.05)&&allPts.some(p=>p.y<.5+.05),'reaches the top and bottom sides');
  // interior lines swing about 2 x amp and keep their shape
  const full=waves.filter(w=>w.length>20);assert(full.length>=3);
  for(const w of full){const ys=w.map(p=>p.y);assert(Math.max(...ys)-Math.min(...ys)>1.4,'the wave really swings (about 2 x amp)');}
  // phase shift moves neighboring lines relative to each other
  const shifted=core.hatchLines(square,0,2,.5,{wave:true,amp:.8,wavelength:5,shift:180});
  const offsetAt=(w,x)=>{const q=w.reduce((best,p)=>Math.abs(p.x-x)<Math.abs(best.x-x)?p:best);return q.y-Math.round(q.y/2)*2;};
  const mid=ws=>ws.filter(w=>w.length>20&&w.some(p=>Math.abs(p.x-6.5)<.3)).slice(2,4);
  const [m0,m1]=mid(waves),[s0,s1]=mid(shifted);
  assert(Math.abs(offsetAt(m0,6.5)-offsetAt(m1,6.5))<.05,'shift 0: neighboring lines swing together');
  assert(Math.abs(offsetAt(s0,6.5)+offsetAt(s1,6.5))<.05&&Math.abs(offsetAt(s0,6.5))>.1,'shift 180: neighboring lines swing oppositely');
  // a tall wave on a small shape still fills it right up to the gap (the reported case)
  const tall=core.hatchLines([rect(0,0,30,30)],135,1.15,.7,{wave:true,amp:2.1,wavelength:10,shift:0});
  assert(tall.length>10);
  const near=p=>Math.min(p.x,30-p.x,p.y,30-p.y);
  const tp=tall.flat();
  assert(tp.every(p=>near(p)>=.7-1e-6),'tall wave keeps the gap');
  assert(Math.min(...tp.map(near))<.7+.05,'tall wave reaches the gap');
  // coverage: every point of the square (outside the gap band) is within one line spacing of some hatch point
  let worst=0;
  for(let x=1;x<=29;x+=2)for(let y=1;y<=29;y+=2){const d=Math.min(...tp.map(p=>Math.hypot(p.x-x,p.y-y)));worst=Math.max(worst,d);}
  assert(worst<2.2,'the square is covered ('+worst.toFixed(2)+' mm from the nearest line at worst)');
}
// ---- zigzag: neighboring lines are joined so the pen stays down
{
  const plain=core.hatchLines([rect(0,0,10,10)],0,1,.5);
  const zig=core.hatchLines([rect(0,0,10,10)],0,1,.5,{zigzag:true});
  assert.strictEqual(plain.length,9);assert.strictEqual(zig.length,1,'one continuous path');
  assert.strictEqual(zig[0].length,18);
  assert(zig[0].every(p=>p.x>=.5-1e-9&&p.x<=9.5+1e-9&&p.y>=1-1e-9&&p.y<=9+1e-9));
  // connectors never run through a hole or leave the shape
  const withHole=core.hatchLines([rect(0,0,10,10),rect(4,4,6,6)],0,1,.5,{zigzag:true});
  assert(withHole.length<core.hatchLines([rect(0,0,10,10),rect(4,4,6,6)],0,1,.5).length,'some lines joined');
  for(const path of withHole)for(let i=1;i<path.length;i++){
    for(const t of [.1,.3,.5,.7,.9]){const x=path[i-1].x+(path[i].x-path[i-1].x)*t,y=path[i-1].y+(path[i].y-path[i-1].y)*t;
      assert(!(x>3.5+1e-6&&x<6.5-1e-6&&y>3.5+1e-6&&y<6.5-1e-6),'segment enters the hole clearance at '+x+','+y);
      assert(x>=.5-1e-6&&x<=9.5+1e-6&&y>=.5-1e-6&&y<=9.5+1e-6);}
  }
  // concave L: a connector across the notch is refused
  const L=[{x:0,y:0},{x:10,y:0},{x:10,y:4},{x:4,y:4},{x:4,y:10},{x:0,y:10}];
  for(const path of core.hatchLines([L],0,1,.5,{zigzag:true}))for(let i=1;i<path.length;i++){
    const x=(path[i-1].x+path[i].x)/2,y=(path[i-1].y+path[i].y)/2;assert(x<=4+1e-6||y<=4+1e-6,'connector crossed the notch');}
}
// ---- through plan(): wavy and zigzag settings
{
  const base2={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-1,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
  const d={paths:[{id:'a',name:'a',closed:true,color:'#ff0000',fillColor:'#ff0000',group:1,points:rect(0,0,20,20)}],page:rect(0,0,20,20)};
  const f=(extra)=>({1:{mode:'wavy',angle:0,spacing:2,gap:.5,amp:.6,wavelength:5,shift:0,...extra}});
  const wavy=core.plan(d,{...base2,penMap:{'#ff0000':1},fills:f({})});
  assert(wavy.paths.filter(p=>p.fill).some(p=>p.points.length>10)&&wavy.paths.filter(p=>p.fill).every(p=>p.points.length>=2));
  const zig=core.plan(d,{...base2,penMap:{'#ff0000':1},fills:f({zigzag:true})});
  assert(zig.fills<wavy.fills,'zigzag joins wavy lines');
  assert.throws(()=>core.plan(d,{...base2,penMap:{'#ff0000':1},fills:f({amp:-1})}),/wave height/);
  assert.throws(()=>core.plan(d,{...base2,penMap:{'#ff0000':1},fills:f({wavelength:0})}),/wavelength/);
  assert.throws(()=>core.plan(d,{...base2,penMap:{'#ff0000':1},fills:{1:{mode:'swirl',angle:0,spacing:1,gap:0}}}),/unknown pattern/);
}
console.log('wavy/zigzag ok');

// ---- wavy cross-hatch
{
  const sq=[rect(0,0,20,20)];
  const wavy=core.hatchLines(sq,0,2,.5,{wave:true,amp:.6,wavelength:5,shift:0});
  const base3={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-1,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
  const d={paths:[{id:'a',name:'a',closed:true,color:'#ff0000',fillColor:'#ff0000',group:1,points:rect(0,0,20,20)}],page:rect(0,0,20,20)};
  const one=core.plan(d,{...base3,penMap:{'#ff0000':1},fills:{1:{mode:'wavy',angle:0,spacing:2,gap:.5,amp:.6,wavelength:5,shift:0}}}).fills;
  const two=core.plan(d,{...base3,penMap:{'#ff0000':1},fills:{1:{mode:'wavycross',angle:0,spacing:2,gap:.5,amp:.6,wavelength:5,shift:0}}});
  assert.strictEqual(two.fills,one*2,'wavy cross-hatch = wavy lines at angle and angle+90');
  assert(two.paths.filter(p=>p.fill).filter(p=>p.points.length>10).length>=two.fills/2,'both sets are wavy');
}

// ---- hidden-line removal
{
  const base4={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-1,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
  const mk=(id,pts,group,fillColor)=>({id,name:id,closed:true,color:'#000000',fillColor,group,points:pts});
  const lower=mk('low',rect(0,0,10,10),1,'#ff0000'),upper=mk('up',rect(5,5,15,15),2,'#0000ff');
  const doc2=(a,b)=>({paths:[a,b],page:rect(0,0,15,15)});
  const o2={...base4,penMap:{'#000000':1,'#ff0000':1,'#0000ff':1},fills:{1:{mode:'hatch',angle:0,spacing:1,gap:0}}};
  const inUpper=p=>p.x>5+1e-6&&p.x<15-1e-6&&p.y>5+1e-6&&p.y<15-1e-6;
  // off: everything is drawn, overlap is reported
  let job=core.plan(doc2(lower,upper),o2);
  assert.strictEqual(job.fillOverlaps,1);
  assert(job.paths.some(p=>p.fill&&p.group===1&&p.points.some(inUpper)),'without removal the lower hatch runs under the upper shape');
  // on: the lower shape's outline and hatch stop at the upper shape's edge; the upper shape stays whole
  job=core.plan(doc2(lower,upper),{...o2,hideCovered:true});
  assert.strictEqual(job.fillOverlaps,0);
  assert(job.hidden.trimmed>0);
  const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  for(const p of job.paths){
    const fromLower=p.id==='low'||p.id.startsWith('low.')||(p.fill&&p.group===1);
    if(!fromLower)continue;
    for(let i=1;i<p.points.length;i++){const m=mid(p.points[i-1],p.points[i]);assert(!inUpper(m),'lower shape visible inside the upper one at '+JSON.stringify(m));}
  }
  const upperHatch=job.paths.filter(p=>p.fill&&p.group===2);
  assert(upperHatch.length>0&&upperHatch.every(p=>p.points.length>=2));
  assert(job.paths.some(p=>p.id==='up'&&p.closed),'the top shape keeps its closed outline');
  // the lower outline is now open pieces (it was cut), and the seam-visible pieces merge into one
  const lowPieces=job.paths.filter(p=>p.id.startsWith('low.'));
  assert(lowPieces.length===1&&!lowPieces[0].closed,'L-shaped visible outline is a single open piece');
  // swap the order: now the other shape is on top
  const flipped=core.plan(doc2({...lower,group:2},{...upper,group:1}),{...o2,hideCovered:true});
  assert(flipped.paths.some(p=>p.id==='low'&&p.closed),'now the 0..10 shape is whole');
  assert(flipped.paths.some(p=>p.id.startsWith('up.')));
  // a shape with no fill hides nothing
  job=core.plan(doc2(lower,{...upper,fillColor:null}),{...o2,hideCovered:true});
  assert.strictEqual(job.hidden.trimmed,0);
  assert(job.paths.some(p=>p.id==='low'&&p.closed));
  // completely covered shapes disappear
  const tiny=mk('tiny',rect(6,6,8,8),1,'#ff0000'),big=mk('big',rect(0,0,15,15),2,'#0000ff');
  job=core.plan(doc2(tiny,big),{...o2,hideCovered:true});
  assert(job.hidden.removed>0&&!job.paths.some(p=>p.id==='tiny'||p.id.startsWith('tiny.')));
  // without groups (DXF) nothing is removed
  const dxfLike=core.plan({paths:[{...lower,group:undefined},{...upper,group:undefined}],page:rect(0,0,15,15)},{...o2,hideCovered:true});
  assert.strictEqual(dxfLike.hidden.trimmed+dxfLike.hidden.removed,0);
  // knife/laser ignore it
  assert.strictEqual(core.plan(doc2(lower,upper),{...o2,mode:'laser',tool:'M4',focus:0,laserPasses:1,hideCovered:true}).hidden.trimmed,0);
}
console.log('wavy cross + hidden lines ok');

// ---- hidden-line removal keeps the edge gap from the covering shape
{
  const base5={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-1,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
  const mk=(id,pts,group)=>({id,name:id,closed:true,color:'#000000',fillColor:'#ff0000',group,points:pts});
  const lower=mk('low',rect(0,0,10,10),1),upper=mk('up',rect(5,5,15,15),2);
  const docG={paths:[lower,upper],page:rect(0,0,15,15)};
  const boundaryDist=p=>{ // distance to the upper rectangle's outline (0 on it), signed positive outside
    const dx=Math.max(5-p.x,0,p.x-15),dy=Math.max(5-p.y,0,p.y-15);
    if(dx>0||dy>0)return Math.hypot(dx,dy);
    return -Math.min(p.x-5,15-p.x,p.y-5,15-p.y);
  };
  for(const [mode,extra] of [['hatch',{}],['wavy',{amp:.4,wavelength:4,shift:0}],['hatch',{zigzag:true}]]){
    const gap=.6,o5={...base5,penMap:{'#000000':1,'#ff0000':1},hideCovered:true,fills:{1:{mode,angle:20,spacing:1,gap,...extra}}};
    const job=core.plan(docG,o5);
    const lowerHatch=job.paths.filter(p=>p.fill&&p.group===1);
    assert(lowerHatch.length>0);
    for(const p of lowerHatch)for(let i=0;i<p.points.length;i++){
      for(const t of i?[0,.5,1]:[0]){
        const a=p.points[i-1]||p.points[i],b=p.points[i],q={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
        const d=boundaryDist(q);
        assert(d>=gap-1e-6,mode+(extra.zigzag?'+zigzag':'')+': hatch of the covered shape comes within '+d.toFixed(4)+' of the covering outline at '+JSON.stringify(q));
      }
    }
    // the covering shape's own hatch is untouched and still reaches its own gap limit
    assert(job.paths.some(p=>p.fill&&p.group===2));
  }
  // with gap 0 the old behavior stays: the hatch runs right up to the edge
  const flush=core.plan(docG,{...base5,penMap:{'#000000':1,'#ff0000':1},hideCovered:true,fills:{1:{mode:'hatch',angle:0,spacing:1,gap:0}}});
  assert(flush.paths.filter(p=>p.fill&&p.group===1).some(p=>p.points.some(q=>Math.abs(boundaryDist(q))<1e-6)),'gap 0 reaches the edge');
  // a bigger gap pulls the hatch further back
  const wide=core.plan(docG,{...base5,penMap:{'#000000':1,'#ff0000':1},hideCovered:true,fills:{1:{mode:'hatch',angle:0,spacing:1,gap:2}}});
  assert(wide.paths.filter(p=>p.fill&&p.group===1).every(p=>p.points.every(q=>boundaryDist(q)>=2-1e-6)));
  // outlines of the covered shape still stop exactly at the edge (the gap is a fill setting)
  assert(flush.paths.filter(p=>p.id.startsWith('low.')).some(p=>p.points.some(q=>Math.abs(boundaryDist(q))<1e-6)));
}
console.log('hidden-line gap ok');
