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

// ---- through plan(): fills follow the fill colour's pen, honour the fill rules, and order after outlines
const base={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-1,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
const shape=(id,pts,extra)=>({id,name:id,closed:true,color:'#000000',points:pts,...extra});
const doc={paths:[shape('a',rect(0,0,10,10),{color:'#ff0000',fillColor:'#0000ff',group:1}),shape('b',rect(20,0,30,10),{color:'#ff0000',fillColor:null,group:2})],page:rect(0,0,30,10)};
const fills={2:{mode:'hatch',angle:0,spacing:2,gap:.5}};
let job=core.plan(doc,{...base,penMap:{'#ff0000':1,'#0000ff':2},fills});
assert.deepStrictEqual(job.pens,[1,2]);
const hatch=job.paths.filter(p=>p.fill);
assert(hatch.length>0&&hatch.every(p=>p.pen===2&&p.color==='#0000ff'),'only the shape that has a fill is hatched, on its fill colour pen');
assert(hatch.length<10&&job.fills===hatch.length);
assert(job.paths.slice(0,2).every(p=>!p.fill),'outlines of pen 1 first');
// fill-all override hatches the unfilled shape in its stroke colour
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
