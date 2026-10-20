const assert=require('assert'),core=require('./core.js');
const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const base={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-1,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
const path=(id,points,color,closed=false,extra={})=>({id,name:id,closed,color,points,...extra});

// ---- offsetPath
{
  const left=core.offsetPath([{x:0,y:0},{x:10,y:0}],false,1);
  assert.deepStrictEqual(left.map(p=>[p.x,p.y]),[[0,1],[10,1]],'left of a +x line is +y');
  const right=core.offsetPath([{x:0,y:0},{x:10,y:0}],false,-1);assert.deepStrictEqual(right.map(p=>[p.x,p.y]),[[0,-1],[10,-1]]);
  // an L: the mitered corner sits at the intersection of the two offset lines
  const L=core.offsetPath([{x:0,y:0},{x:10,y:0},{x:10,y:10}],false,1);
  assert(Math.abs(L[1].x-9)<1e-9&&Math.abs(L[1].y-1)<1e-9,'miter at the corner: '+JSON.stringify(L[1]));
  // closed square (counter-clockwise): +d is inward
  const inward=core.offsetPath(rect(0,0,10,10),true,1);
  assert(inward.every(p=>p.x>=1-1e-9&&p.x<=9+1e-9&&p.y>=1-1e-9&&p.y<=9+1e-9)&&inward.length===4);
  // a hairpin never spikes: on the outside of the turn it is beveled, on the inside the tip is cut off
  const hairpin=[{x:0,y:0},{x:10,y:0},{x:0,y:.2}];
  const outer=core.offsetPath(hairpin,false,-1),inner=core.offsetPath(hairpin,false,1);
  assert(outer.length>3&&outer.every(p=>Math.abs(p.x)<20&&Math.abs(p.y)<20),'outside of a sharp turn is beveled');
  assert(inner.length===3&&Math.hypot(inner[1].x-10,inner[1].y)<=6.01,'inside of a sharp turn is a single point, cut off within six offsets of the corner');
  assert.strictEqual(core.offsetPath([{x:0,y:0},{x:0,y:0}],false,1),null);
}

// ---- thick lines through plan()
{
  const line=path('l',[{x:0,y:0},{x:10,y:0}],'#000000');
  const o={...base,penMap:{'#000000':1},penWidth:.5,penThickness:{1:2}};
  let job=core.plan({paths:[line],page:rect(0,0,10,1)},o);
  // thickness 2, pen 0.5: strokes 0.5 apart across a 1.5 span = 4 strokes
  assert.strictEqual(job.thick.bands,1);assert.strictEqual(job.thick.strokes,4);assert.strictEqual(job.paths.length,4);
  const ys=job.paths.map(p=>p.points[0].y).sort((a,b)=>a-b);
  assert(Math.abs(ys[3]-ys[0]-1.5)<1e-9,'outer strokes are (thickness - pen width) apart');
  assert(ys.every((y,i)=>i===0||Math.abs(y-ys[i-1]-.5)<1e-9),'strokes are one pen width apart');
  assert(job.paths.every(p=>Math.abs(core.length(p.points)-10)<1e-6),'each stroke is as long as the line');
  // a per-pen width changes the stroke count
  job=core.plan({paths:[line],page:rect(0,0,10,1)},{...o,penWidths:{1:1}});assert.strictEqual(job.thick.strokes,2);
  // thickness not larger than the pen width changes nothing
  job=core.plan({paths:[line],page:rect(0,0,10,1)},{...o,penThickness:{1:.5}});assert.strictEqual(job.paths.length,1);assert.strictEqual(job.thick.bands,0);
  // closed shapes keep closed strokes; a thick band around a small circle is clamped, not turned inside out
  const circle=[];for(let i=0;i<64;i++){const a=i/64*2*Math.PI;circle.push({x:3*Math.cos(a),y:3*Math.sin(a)});}
  job=core.plan({paths:[path('c',circle,'#000000',true)],page:rect(-3,-3,3,3)},{...o,penThickness:{1:20}});
  assert.strictEqual(job.thick.clamped,1);assert(job.paths.every(p=>p.closed));
  assert(job.paths.length>3);
  // thickness only applies to the pen it is set for
  const other=path('o',[{x:0,y:5},{x:10,y:5}],'#ff0000');
  job=core.plan({paths:[line,other],page:rect(0,0,10,5)},{...o,penMap:{'#000000':1,'#ff0000':2}});
  assert.strictEqual(job.paths.filter(p=>p.id==='o').length,1);assert.strictEqual(job.paths.filter(p=>p.id.startsWith('l~')).length,4);
  // bad values are explained; laser/knife ignore thickness
  assert.throws(()=>core.plan({paths:[line],page:rect(0,0,10,1)},{...o,penThickness:{1:-1}}),/Line thickness for pen 1/);
  assert.strictEqual(core.plan({paths:[line],page:rect(0,0,10,1)},{...o,mode:'laser',tool:'M4',focus:0,laserPasses:1}).paths.length,1);
}

// ---- pen order
{
  const shapes=[path('dark',rect(0,0,5,5),'#101080',true),path('far',rect(100,0,105,5),'#ffee00',true),path('mid',rect(10,0,15,5),'#c02020',true)];
  const doc={paths:shapes,page:rect(0,0,105,5)},pens={'#101080':1,'#ffee00':2,'#c02020':3};
  const seq=extra=>core.plan(doc,{...base,penMap:pens,...extra}).pens;
  assert.deepStrictEqual(seq({}),[1,2,3],'default: by number');
  assert.deepStrictEqual(seq({penOrder:'number'}),[1,2,3]);
  assert.deepStrictEqual(seq({penOrder:'light'}),[2,3,1],'light to dark: yellow, red, dark blue');
  assert.deepStrictEqual(seq({penOrder:'dark'}),[1,3,2]);
  assert.deepStrictEqual(seq({penOrder:'near'}),[1,3,2],'nearest next: pen 1 starts at the origin, then the red one beside it, then the far one');
  // the display color override decides light/dark
  const white=core.plan(doc,{...base,penMap:pens,penOrder:'light',penColors:{'#101080':'#ffffff'}}).pens;assert.strictEqual(white[0],1,'a pen displayed as white comes first when light is first');
  // the order carries into the G-code pen changes and the per-pen files
  const o={...base,penMap:pens,penOrder:'light',penChange:'M6'},job=core.plan(doc,o);
  assert.deepStrictEqual([...core.gcode(job,o).matchAll(/T(\d) M6/g)].map(m=>Number(m[1])),[2,3,1]);
  assert.deepStrictEqual(core.gcodeFiles(job,{...o,penChange:'files'}).map(f=>f.pen),[2,3,1]);
  assert.throws(()=>seq({penOrder:'random'}),/Unknown pen order/);
}
console.log('thick lines and pen order ok');
