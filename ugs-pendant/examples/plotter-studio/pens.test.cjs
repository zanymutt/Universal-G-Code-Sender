const assert=require('assert'),core=require('./core.js');
const sq=(id,x,color)=>({id,name:id,color,closed:true,points:[{x,y:0},{x:x+5,y:0},{x:x+5,y:5},{x,y:5}]});
const doc={paths:[sq('a',0,'#ff0000'),sq('b',10,'#0000ff'),sq('c',20,'#ff0000'),sq('d',30,'#00ff00')],page:[{x:0,y:0},{x:40,y:0},{x:40,y:5},{x:0,y:5}]};
const base={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-1,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
// every color its own pen; pens are cut in number order
let o={...base,penMap:{'#ff0000':1,'#0000ff':2,'#00ff00':3},penChange:'M0'};
let job=core.plan(doc,o);
assert.deepStrictEqual(job.pens,[1,2,3]);
assert.deepStrictEqual(job.paths.map(p=>p.id),['a','c','b','d']);
assert.deepStrictEqual(job.paths.map(p=>p.number),[1,2,3,4]);
let g=core.gcode(job,o);
assert.strictEqual((g.match(/^M0$/gm)||[]).length,3);
assert(/\(Pen 2 \(#0000ff\)\)\nM0/.test(g));
// M6
g=core.gcode(job,{...o,penChange:'M6'});assert(/T2 M6/.test(g)&&!/^M0$/m.test(g));
// two colors sharing a pen: one group, no change
o={...base,penMap:{'#ff0000':1,'#0000ff':1,'#00ff00':1},penChange:'M0'};job=core.plan(doc,o);
assert.deepStrictEqual(job.pens,[1]);assert(!/^M0$/m.test(core.gcode(job,o)));
// skip
o={...base,penMap:{'#ff0000':1,'#0000ff':0,'#00ff00':0},penChange:'M0'};job=core.plan(doc,o);
assert.deepStrictEqual(job.paths.map(p=>p.id),['a','c']);
assert.throws(()=>core.plan(doc,{...base,penMap:{'#ff0000':0,'#0000ff':0,'#00ff00':0}}),/Skip/);
assert.throws(()=>core.plan(doc,{...base,penMap:{'#ff0000':1.5}}),/Pen numbers/);
// separate files
o={...base,penMap:{'#ff0000':2,'#0000ff':1,'#00ff00':1},penChange:'files'};job=core.plan(doc,o);
assert.deepStrictEqual(job.pens,[1,2]);
const files=core.gcodeFiles(job,o);
assert.strictEqual(files.length,2);assert.deepStrictEqual(files.map(f=>f.paths),[2,2]);
assert(files.every(f=>f.text.includes('G21')&&!/^M0$|M6/m.test(f.text)));
assert.throws(()=>core.gcode(job,o),/gcodeFiles/);
// inner-first never crosses pens (no deadlock)
const outer={id:'o',name:'o',color:'#ff0000',closed:true,points:[{x:0,y:0},{x:50,y:0},{x:50,y:50},{x:0,y:50}]};
const inner={id:'i',name:'i',color:'#0000ff',closed:true,points:[{x:10,y:10},{x:20,y:10},{x:20,y:20},{x:10,y:20}]};
job=core.plan({paths:[outer,inner],page:doc.page},{...base,penMap:{'#ff0000':1,'#0000ff':2}});
assert.deepStrictEqual(job.paths.map(p=>p.id),['o','i']);
// no penMap: unchanged behavior
job=core.plan(doc,base);assert.deepStrictEqual(job.paths.map(p=>p.id),['a','b','c','d']);
// laser ignores pens
job=core.plan(doc,{...base,mode:'laser',tool:'M4',focus:0,laserPasses:1,penMap:{'#ff0000':0}});assert.strictEqual(job.paths.length,4);
console.log('pens ok');

// ---- DXF color: explicit ACI, true color, ByLayer, layer color; joins never mix colors
const dxf=require('./dxf-importer.js');
assert.strictEqual(dxf.aci(1),'#ff0000');assert.strictEqual(dxf.aci(5),'#0000ff');assert.strictEqual(dxf.aci(7),'#000000');
assert.strictEqual(dxf.aci(10),'#ff0000');assert.strictEqual(dxf.aci(30),'#ff7f00');assert.strictEqual(dxf.aci(50),'#ffff00');assert.strictEqual(dxf.aci(250),'#333333');
const pair=(c,v)=>c+'\n'+v+'\n';
const line=(layer,x1,y1,x2,y2,extra='')=>pair(0,'LINE')+pair(8,layer)+extra+pair(10,x1)+pair(20,y1)+pair(11,x2)+pair(21,y2);
const text=pair(0,'SECTION')+pair(2,'HEADER')+pair(9,'$INSUNITS')+pair(70,4)+pair(0,'ENDSEC')
 +pair(0,'SECTION')+pair(2,'TABLES')+pair(0,'TABLE')+pair(2,'LAYER')
 +pair(0,'LAYER')+pair(2,'A')+pair(70,0)+pair(62,3)
 +pair(0,'LAYER')+pair(2,'B')+pair(70,0)+pair(62,5)
 +pair(0,'ENDTAB')+pair(0,'ENDSEC')
 +pair(0,'SECTION')+pair(2,'ENTITIES')
 +line('A',0,0,10,0)                 // layer A: green by layer
 +line('A',10,0,20,0,pair(62,1))     // same layer, explicit red, touches the first one
 +line('B',0,10,10,10)               // layer B: blue
 +line('B',0,20,10,20,pair(420,0x112233)) // true color
 +pair(0,'ENDSEC')+pair(0,'EOF');
const prepared=dxf.prepare(text,{});
const colors=prepared.items.map(i=>i.color).sort();
assert.deepStrictEqual(colors,['#00ff00','#0000ff','#112233','#ff0000'].sort());
assert.strictEqual(prepared.items.length,4); // the touching green/red lines were not joined into one contour
console.log('dxf color ok');

// display color override changes the pen label only
{const o={...base,penMap:{'#ff0000':1,'#0000ff':1},penColors:{'#ff0000':'#aa0000'},penChange:'M0'};
const j=core.plan(doc,o),other={...o,penMap:{'#ff0000':1,'#0000ff':2}};
assert(/\(Pen 1 \(#aa0000\)\)/.test(core.gcode(core.plan(doc,other),other)));console.log('pen color label ok');}

// ---- grouping colors onto N pens
{
  const colors=[{color:'#ff0000',weight:3},{color:'#0000ff',weight:2},{color:'#e02020',weight:1},{color:'#2040d0',weight:2},{color:'#ff6060',weight:1},{color:'#008000',weight:2},{color:'#000000',weight:4}];
  let r=core.clusterColors(colors,3);
  assert.strictEqual(r.assign['#ff0000'],r.assign['#e02020']);assert.strictEqual(r.assign['#ff0000'],r.assign['#ff6060']);
  assert.strictEqual(r.assign['#0000ff'],r.assign['#2040d0']);
  assert.notStrictEqual(r.assign['#ff0000'],r.assign['#0000ff']);
  assert.strictEqual(new Set(Object.values(r.assign)).size,3,'exactly three pens');
  assert.strictEqual(r.reps.length,3);assert(r.reps.every(c=>colors.some(x=>x.color===c)),'representatives are real colors');
  assert.strictEqual(r.assign['#ff0000'],1,'pens are numbered by first appearance');
  // one pen takes everything; asking for more pens than colors gives every color its own
  r=core.clusterColors(colors,1);assert(Object.values(r.assign).every(v=>v===1));
  r=core.clusterColors(colors,20);assert.strictEqual(new Set(Object.values(r.assign)).size,colors.length);
  // two pens: shades of one hue still stay together
  r=core.clusterColors(colors,2);assert.strictEqual(new Set(Object.values(r.assign)).size,2);
  assert.strictEqual(r.assign['#ff0000'],r.assign['#e02020']);assert.strictEqual(r.assign['#0000ff'],r.assign['#2040d0']);
  // deterministic, and the empty and invalid cases
  assert.deepStrictEqual(core.clusterColors(colors,3),core.clusterColors(colors,3));
  assert.deepStrictEqual(core.clusterColors([],3),{assign:{},reps:[]});
  assert.throws(()=>core.clusterColors(colors,0),/at least 1/);assert.throws(()=>core.clusterColors(colors,1.5),/whole number/);
  // weights matter: with two pens for red/orange/blue the heavy blue keeps its own pen
  r=core.clusterColors([{color:'#ff0000',weight:1},{color:'#ff8000',weight:1},{color:'#0000ff',weight:9}],2);
  assert.strictEqual(r.assign['#ff0000'],r.assign['#ff8000']);assert.notStrictEqual(r.assign['#0000ff'],r.assign['#ff0000']);
  console.log('cluster ok');
}

// ---- black, grays and white take precedence when grouping
{
  // the demo: nine shades of red/blue/green plus black, black appearing last
  const demo=[['#ff0000',1],['#e02020',1],['#ff6060',1],['#b01030',1],['#0000ff',1],['#2040d0',1],['#60a0ff',1],['#208040',1],['#000000',1]].map(([color,weight])=>({color,weight}));
  for(const k of [2,3,4,5]){
    const r=core.clusterColors(demo,k);
    const blackPen=r.assign['#000000'];
    const sharing=Object.keys(r.assign).filter(c=>r.assign[c]===blackPen);
    assert.deepStrictEqual(sharing,['#000000'],'with '+k+' pens black has a pen of its own');
    assert.strictEqual(new Set(Object.values(r.assign)).size,k,k+' pens used');
  }
  // 4 pens: black + three chromatic groups, so the light blue no longer outranks black
  let r=core.clusterColors(demo,4);
  assert.strictEqual(r.assign['#ff0000'],r.assign['#b01030']);
  assert.strictEqual(r.assign['#0000ff'],r.assign['#2040d0']);
  assert.notStrictEqual(r.assign['#ff0000'],r.assign['#208040']);
  // one pen is one pen: neutrals only get their own pen when there is another pen to hold the colors
  r=core.clusterColors(demo,1);assert(Object.values(r.assign).every(v=>v===1));
  // black, a mid gray and white are three tones: each gets a pen before chromatic colors get a second
  const mixed=[{color:'#ff0000',weight:2},{color:'#00a000',weight:2},{color:'#000000',weight:1},{color:'#808080',weight:1},{color:'#ffffff',weight:1},{color:'#0000ff',weight:2}];
  r=core.clusterColors(mixed,4);
  assert.strictEqual(new Set([r.assign['#000000'],r.assign['#808080'],r.assign['#ffffff']]).size,3,'black, gray and white each have a pen');
  assert(!['#ff0000','#00a000','#0000ff'].some(c=>[r.assign['#000000'],r.assign['#808080'],r.assign['#ffffff']].includes(r.assign[c])),'no chromatic color shares a neutral pen');
  // fewer pens than neutral tones: leave one pen for the chromatic colors
  r=core.clusterColors(mixed,2);
  assert.strictEqual(r.assign['#ff0000'],r.assign['#0000ff']);assert.notStrictEqual(r.assign['#ff0000'],r.assign['#000000']);
  assert.strictEqual(r.assign['#000000'],r.assign['#ffffff'],'neutrals share their single pen');
  // near-duplicates of black share a pen; an off-black with a tint still counts as neutral
  r=core.clusterColors([{color:'#000000',weight:1},{color:'#111111',weight:1},{color:'#ff0000',weight:1},{color:'#0000ff',weight:1}],3);
  assert.strictEqual(r.assign['#000000'],r.assign['#111111']);
  // only neutrals: ordinary grouping still works
  r=core.clusterColors([{color:'#000000',weight:1},{color:'#444444',weight:1},{color:'#bbbbbb',weight:1},{color:'#ffffff',weight:1}],2);
  assert.strictEqual(new Set(Object.values(r.assign)).size,2);
  assert.deepStrictEqual(core.clusterColors(demo,4),core.clusterColors(demo,4));
  console.log('neutral grouping ok');
}
