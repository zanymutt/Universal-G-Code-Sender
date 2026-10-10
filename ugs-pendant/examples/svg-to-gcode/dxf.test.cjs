const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const D=require('./dxf-importer.js'),C=require('./core.js');
const pairs=tags=>tags.map(t=>t.join('\n')).join('\n')+'\n';
const entity=(type,tags=[])=>[[0,type],...tags];
const line=(x,y,x2,y2,extra=[])=>entity('LINE',[[10,x],[20,y],[11,x2],[21,y2],...extra]);
const circle=(x,y,r)=>entity('CIRCLE',[[10,x],[20,y],[40,r]]);
const arc=(x,y,r,a,b)=>entity('ARC',[[10,x],[20,y],[40,r],[50,a],[51,b]]);
const doc=(entities,unit=4,tables=[])=>pairs([[0,'SECTION'],[2,'HEADER'],[9,'$INSUNITS'],[70,unit],[0,'ENDSEC'],[0,'SECTION'],[2,'TABLES'],...tables,[0,'ENDSEC'],[0,'SECTION'],[2,'ENTITIES'],...entities,[0,'ENDSEC'],[0,'EOF']]);
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const raw={cleanup:0,mergeDistance:0,equalDistance:0};
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
test('Units convert inches to millimeters, preserve XY and page extents',()=>{
 const d=D.parse(doc(line(-1,2,3,4),1),raw);near(d.paths[0].points[0].x,-25.4);near(d.paths[0].points[0].y,50.8);near(d.width,101.6);near(d.height,50.8);near(d.page[0].x,-25.4);
});
test('Unitless/unknown drawings require a choice; overrides win',()=>{
 for(const unit of [0,99])assert.throws(()=>D.parse(doc(line(0,0,1,0),unit)),/units/);
 near(D.parse(doc(line(0,0,1,0),0),{dxfUnits:'in'}).width,25.4);
 near(D.parse(doc(line(0,0,1,0),6),{dxfUnits:'mm'}).width,1);
});
test('ARC crosses zero counterclockwise, including major arcs',()=>{
 const d=D.parse(doc(arc(0,0,10,350,10)),raw),p=d.paths[0].points;
 assert(p[0].y<0&&p.at(-1).y>0);assert(p.some(q=>q.x>9.99));
 const major=D.parse(doc(arc(0,0,10,10,350)),raw).paths[0].points;
 assert(major.some(p=>p.x<-9.99));assert(major.length>p.length);
});
test('Bulged polylines have correct positive/negative and major sweeps',()=>{
 for(const bulge of [1,-1,2,-2]){
  const t=entity('LWPOLYLINE',[[90,2],[10,0],[20,0],[42,bulge],[10,10],[20,0]]);
  const p=D.parse(doc(t),raw).paths[0].points;
  near(p[0].x,0);near(p.at(-1).x,10);
  assert(bulge>0?p.some(q=>q.y<-4.9):p.some(q=>q.y>4.9));
  if(Math.abs(bulge)>1)assert(p.some(q=>q.x<-.1));
 }
});
test('Legacy 2D polylines and closing bulges are supported',()=>{
 const t=[...entity('POLYLINE',[[70,1]]),...entity('VERTEX',[[10,0],[20,0],[42,1]]),...entity('VERTEX',[[10,10],[20,0],[42,1]]),...entity('SEQEND')];
 const d=D.parse(doc(t),raw);assert(d.paths[0].closed);near(d.height,10);
});
test('Shuffled and reversed lines join into one closed rectangle',()=>{
 const d=D.parse(doc([...line(10,0,0,0),...line(10,10,10,0),...line(0,0,0,10),...line(0,10,10,10)]),raw);
 assert.equal(d.paths.length,1);assert(d.paths[0].closed);near(C.area(d.paths[0].points),100);
});
test('Joined reversed arcs preserve curve side and form a closed D shape',()=>{
 const d=D.parse(doc([...line(0,-10,0,10),...arc(0,0,10,270,90)]),raw);
 assert.equal(d.paths.length,1);assert(d.paths[0].closed);assert(d.paths[0].points.some(p=>p.x>9.99));assert(d.paths[0].points.every(p=>p.x>-.0001));
});
test('Branch points, gaps and different layers are not joined through',()=>{
 assert.equal(D.parse(doc([...line(0,0,1,0),...line(1,0,2,0),...line(1,0,1,1)]),raw).paths.length,3);
 assert.equal(D.parse(doc([...line(0,0,1,0,[[8,'A']]),...line(1,0,2,0,[[8,'B']])]),raw).paths.length,2);
 assert.equal(D.parse(doc([...line(0,0,1,0),...line(1.001,0,2,0)]),raw).paths.length,2);
});
test('Hidden and paper-space geometry is skipped; annotations are reported',()=>{
 const d=D.parse(doc([...line(0,0,1,0),...line(0,0,50,0,[[8,'off']]),...line(0,0,100,0,[[67,1]]),...entity('TEXT',[[1,'label']])],4,entity('LAYER',[[2,'off'],[62,-7]])),raw);
 assert.equal(d.paths.length,1);near(d.width,1);assert(d.warnings.some(w=>w.includes('1 TEXT')));
});
test('Unsupported geometry rejects the entire drawing instead of partial cuts',()=>{
 for(const kind of ['INSERT','SPLINE','ELLIPSE','HATCH','3DFACE'])assert.throws(()=>D.parse(doc([...line(0,0,1,0),...entity(kind)])),/Unsupported DXF entity/);
});
test('Invalid, binary, 3D, tilted, fitted and malformed polylines reject',()=>{
 for(const text of ['AutoCAD Binary DXF\0','0\nSECTION\n2\nENTITIES\n',doc(line(0,0,1,0,[[30,1]])),doc(line(0,0,1,0,[[230,-1]])),doc(entity('LWPOLYLINE',[[90,3],[10,0],[20,0],[10,1],[20,1]])),doc([...entity('POLYLINE',[[70,8]]),...entity('VERTEX',[[10,0],[20,0]]),...entity('SEQEND')]),doc(arc(0,0,1,0,0)),doc(circle(0,0,-1)),doc(line('NaN',0,1,0))])assert.throws(()=>D.parse(text));
});
test('DXF circles use existing ordering, reversal, locked starts and G-code',()=>{
 const d=D.parse(doc([...circle(0,0,20),...circle(0,0,5)]),raw);
 const o={mode:'plotter',feed:1000,plunge:200,safe:5,surface:0,final:-.2,step:.2,focus:0,laserPasses:1,power:100,powerMax:1000,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:true,reverse:false,tool:'none',outputTolerance:0};
 const j=C.plan(d,o,{p0:3},{p0:true});assert.deepEqual(j.paths.map(p=>p.id),['p1','p0']);assert.deepEqual(j.paths.map(p=>p.number),[1,2]);
 const code=C.gcode(j,o);assert(code.includes('G21'));assert(code.includes('Path 1'));assert(!code.includes('NaN'));assert(!code.includes('M3'));
 const p=j.paths[1].points;near(p[0].x,d.paths[0].points[3].x+20);near(p[1].x,d.paths[0].points[2].x+20);
});
const sample=process.env.DXF_SAMPLE||path.resolve(__dirname,'../../../../dxf-samples/1_polylines.dxf');
if(process.env.DXF_SAMPLE||fs.existsSync(sample))test('Downloaded sample imports with explicit millimeter override',()=>{
 const text=fs.readFileSync(sample,'utf8'),prepared=D.prepare(text);
 assert.equal(prepared.items[0].matrix[0],1000); // The source declares meters.
 const d=D.parse(text,{...raw,dxfUnits:'mm'});assert.equal(d.paths.length,10);assert(d.paths.some(p=>p.closed));assert(d.warnings.some(w=>w.includes('Skipped 9 TEXT')));assert(d.vertices<100000);
 console.log('Sample:',d.paths.length,'contours,',d.paths.filter(p=>p.closed).length,'closed,',d.width.toFixed(2),'x',d.height.toFixed(2),'mm');
});
else console.log('SKIP downloaded sample: set DXF_SAMPLE to the ezdxf 1_polylines.dxf file to include this optional check.');
console.log(count+' DXF checks passed.');
