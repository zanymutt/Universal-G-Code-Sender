const assert=require('assert'),core=require('./core.js');
const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const base={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-1,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
const shape=(id,pts,color,closed=true)=>({id,name:id,closed,color,points:pts});
const len=job=>job.paths.reduce((n,p)=>n+core.length(p.closed?[...p.points,p.points[0]]:p.points),0);
const page=rect(0,0,30,10),pens={'#101010':1,'#ffee00':2};
const run=(paths,extra={})=>core.plan({paths,page},{...base,penMap:pens,...extra});

// ---- two neighbors share a border: it is plotted once
{
  const A=shape('A',rect(0,0,10,10),'#101010'),B=shape('B',rect(10,0,20,10),'#ffee00');
  const off=run([A,B]);assert.strictEqual(off.merged.length,0);assert(Math.abs(len(off)-80)<1e-6,'without merging both shapes plot their full outline');
  const job=run([A,B],{dedupeTol:.05});
  // the merge also takes up to one tolerance off each end of the shared edge, where the two outlines meet
  assert(Math.abs(len(job)-70)<.15,'the shared 10 mm edge is plotted once, got '+len(job));
  assert(Math.abs(job.merged.length-10)<.2&&job.merged.trimmed===1);
  assert(job.paths.some(p=>p.id==='A'&&p.closed),'the first pen keeps its closed outline');
  const b=job.paths.filter(p=>p.id.startsWith('B'));assert(b.length===1&&!b[0].closed,'the second shape becomes one open piece');
  assert(b[0].points.every(p=>p.x>=10-1e-9&&p.x<=20+1e-9));
}
// ---- rounding noise on the shared edge is merged; a real gap is not
{
  const A=shape('A',rect(0,0,10,10),'#101010');
  const trimmedBy=x=>run([A,shape('B',rect(x,0,x+10,10),'#ffee00')],{dedupeTol:.05}).merged.length;
  assert(trimmedBy(10.02)>9.9,'0.02 mm off is the same line');
  assert(trimmedBy(9.98)>9.9);
  assert(trimmedBy(10.2)===0,'0.2 mm apart is a different line');
  assert(trimmedBy(10.2)===0&&run([A,shape('B',rect(10.2,0,20.2,10),'#ffee00')],{dedupeTol:.05}).paths.length===2);
}
// ---- the pen plotted first keeps the line (pen order decides)
{
  const A=shape('A',rect(0,0,10,10),'#101010'),B=shape('B',rect(10,0,20,10),'#ffee00');
  const byNumber=run([A,B],{dedupeTol:.05});
  assert(byNumber.paths.some(p=>p.id==='A'&&p.closed)&&byNumber.paths.some(p=>p.id.startsWith('B%')),'pen 1 first: A whole');
  const lightFirst=run([A,B],{dedupeTol:.05,penOrder:'light'});
  assert(lightFirst.paths.some(p=>p.id==='B'&&p.closed)&&lightFirst.paths.some(p=>p.id.startsWith('A%')),'light first: the yellow shape keeps the edge');
  assert.deepStrictEqual(lightFirst.pens,[2,1]);
}
// ---- same pen: an exact repeat is dropped; partial overlap on a line trims the later one
{
  const sq=rect(0,0,10,10);
  const same=core.plan({paths:[shape('a',sq,'#101010'),shape('b',sq,'#101010')],page},{...base,penMap:pens,dedupeTol:.05});
  assert.strictEqual(same.paths.length,1);assert.strictEqual(same.merged.removed,1);
  const l1=shape('l1',[{x:0,y:0},{x:10,y:0}],'#101010',false),l2=shape('l2',[{x:15,y:0},{x:5,y:0}],'#ffee00',false); // opposite direction, overlaps 5..10
  const job=run([l1,l2],{dedupeTol:.05});
  const second=job.paths.find(p=>p.id.startsWith('l2'));
  assert(Math.abs(core.length(second.points)-4.95)<.01&&second.points.every(p=>p.x>=10.04),'only the part beyond the first line (plus its tolerance) remains');
}
// ---- off by default / zero; skipped pens claim nothing; hatch is left alone
{
  const A=shape('A',rect(0,0,10,10),'#101010'),B=shape('B',rect(10,0,20,10),'#ffee00');
  assert(Math.abs(len(run([A,B],{dedupeTol:0}))-80)<1e-6);
  assert.strictEqual(run([A,B],{dedupeTol:.05,penMap:{'#101010':0,'#ffee00':2}}).paths.filter(p=>p.id==='B'&&p.closed).length,1,'a skipped pen draws nothing, so it removes nothing');
  assert.throws(()=>run([A,B],{dedupeTol:5}),/Merge duplicate lines/);
  assert.throws(()=>run([A,B],{dedupeTol:-1}),/Merge duplicate lines/);
  assert.strictEqual(core.plan({paths:[A,B],page},{...base,mode:'laser',tool:'M4',focus:0,laserPasses:1,dedupeTol:.05}).paths.length,2,'plotter mode only');
}
// ---- property: nothing that is kept comes within the tolerance of a line kept before it
{
  const tol=.05,rnd=(()=>{let s=7;return()=>(s=(s*16807)%2147483647)/2147483647;})();
  const list=[];
  for(let i=0;i<14;i++){const x=Math.floor(rnd()*6)*5,y=Math.floor(rnd()*4)*5;list.push({...shape('s'+i,rect(x,y,x+5+Math.floor(rnd()*2)*5,y+5),i%2?'#101010':'#ffee00'),pen:1+i%2});}
  const stats={trimmed:0,removed:0,length:0},out=core.dedupeOutlines(list,pen=>pen,tol,stats);
  const dseg=(m,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((m.x-a.x)*dx+(m.y-a.y)*dy)/l)):0;return Math.hypot(m.x-a.x-t*dx,m.y-a.y-t*dy);};
  const segs=p=>{const pts=p.closed?[...p.points,p.points[0]]:p.points;return pts.slice(1).map((q,i)=>[pts[i],q]);};
  // plotting order: pen 1 paths in list order, then pen 2
  const ordered=[...out.filter(p=>p.pen===1),...out.filter(p=>p.pen===2)];
  for(let k=1;k<ordered.length;k++)for(const [a,b] of segs(ordered[k])){
    const m={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    for(let j=0;j<k;j++)for(const [c,d] of segs(ordered[j]))assert(dseg(m,c,d)>tol*.9,'a later line runs on an earlier one at '+JSON.stringify(m));
  }
  assert(stats.length>0);
}
console.log('dedupe ok');

// ---- who keeps a shared line, and pens left with nothing
{
  const A=shape('A',rect(0,0,10,10),'#101010'),B=shape('B',rect(10,0,20,10),'#ffee00');
  const first=run([A,B],{dedupeTol:.05,dedupeKeep:'first'}),last=run([A,B],{dedupeTol:.05,dedupeKeep:'last'});
  assert(first.paths.some(p=>p.id==='A'&&p.closed)&&first.paths.some(p=>p.id.startsWith('B%')));
  assert(last.paths.some(p=>p.id==='B'&&p.closed)&&last.paths.some(p=>p.id.startsWith('A%')),'last: the pen plotted later keeps the shared edge');
  assert.deepStrictEqual(first.merged.emptied,[]);
  // a pen whose every line is a copy of the other pen's line is left with nothing, and is named
  const dup=shape('B2',rect(0,0,10,10),'#ffee00');
  const job=run([A,dup],{dedupeTol:.05});
  assert.deepStrictEqual(job.merged.emptied,[2]);assert.deepStrictEqual(job.pens,[1],'the empty pen is not in the pen sequence');
  assert.deepStrictEqual(run([A,dup],{dedupeTol:.05,dedupeKeep:'last'}).merged.emptied,[1],'with last, the other pen is the one left empty');
  assert.throws(()=>run([A,B],{dedupeTol:.05,dedupeKeep:'sometimes'}),/darkest, lightest, first or last/);
}
console.log('dedupe keep ok');

// ---- darkest / lightest pen keeps the shared line, whatever the plotting order
{
  const A=shape('A',rect(0,0,10,10),'#ffee00'),B=shape('B',rect(10,0,20,10),'#101010'); // light pen 2? no: pens map below
  const pensLB={'#ffee00':1,'#101010':2};   // the light pen is pen 1 (plotted first); the dark pen is pen 2
  const go=keep=>core.plan({paths:[A,B],page},{...base,penMap:pensLB,dedupeTol:.05,dedupeKeep:keep});
  const dark=go('dark'),light=go('light'),first=go('first');
  assert(dark.paths.some(p=>p.id==='B'&&p.closed)&&dark.paths.some(p=>p.id.startsWith('A%')),'dark: the black shape keeps the shared line even though it is plotted second');
  assert(light.paths.some(p=>p.id==='A'&&p.closed)&&light.paths.some(p=>p.id.startsWith('B%')),'light: the yellow shape keeps it');
  assert(first.paths.some(p=>p.id==='A'&&p.closed),'first: pen 1 keeps it');
  assert.deepStrictEqual(dark.pens,[1,2],'the plotting order is unchanged');
  // the display color override decides which pen counts as dark
  const swapped=core.plan({paths:[A,B],page},{...base,penMap:pensLB,penColors:{'#ffee00':'#000000'},dedupeTol:.05,dedupeKeep:'dark'});
  assert(swapped.paths.some(p=>p.id==='A'&&p.closed),'a pen displayed as black counts as the darkest');
  // a thin region between two colors: black owns both edges, the colored shapes lose theirs
  const band=shape('band',rect(10,0,12,10),'#101010');
  const g=shape('G',rect(0,0,10,10),'#208040'),y=shape('Y',rect(12,0,22,10),'#ffee00');
  const job=core.plan({paths:[g,band,y],page:rect(0,0,22,10)},{...base,penMap:{'#208040':1,'#101010':2,'#ffee00':3},dedupeTol:.05,dedupeKeep:'dark'});
  assert(job.paths.some(p=>p.id==='band'&&p.closed),'the black sliver keeps its whole outline');
  assert(job.merged.length>19,'both shared edges (10 mm each) are taken from the colored shapes: '+job.merged.length);
}
console.log('dedupe dark ok');
