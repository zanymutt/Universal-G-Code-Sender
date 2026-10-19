const assert=require('node:assert/strict'),C=require('./core.js');
const base={mode:'knife',feed:700,plunge:100,safe:5,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'custom',originBounds:'artwork',order:'svg',start:'original',inner:false,largest:false,reverse:false,tool:'none',knifeOffset:.45,surface:0,final:-2,step:2,knifeSwivelZ:-.5,knifePasses:1,knifeAngle:30,knifeFeed:150,knifeLead:0,knifeHeading:0};
const doc=(points,closed=false)=>({paths:[{id:'p',name:'test',closed,points:points.map(([x,y])=>({x,y}))}],page:[{x:0,y:0},{x:50,y:50}]});
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let count=0;const test=(name,fn)=>{fn();console.log('PASS '+name);count++;};
test('Straight cut advances holder by offset, not the desired tip path',()=>{
 for(const knifeOffset of [.45,3]){const j=C.plan(doc([[0,0],[10,0]]),{...base,knifeOffset});const m=j.knife.runs[0].moves;near(m[0].x,knifeOffset);near(m.find(q=>q.kind==='cut').x,10+knifeOffset);near(j.paths[0].points.at(-1).x,10);assert.equal(j.knife.swivels,0);}
});
test('90 degree swivel holds ideal blade tip on vertex with exact offset radius',()=>{
 for(const knifeOffset of [.45,3])for(const y of [-10,10]){const j=C.plan(doc([[0,0],[10,0],[10,y]]),{...base,knifeOffset});const r=j.knife.runs[0];assert.equal(r.swivels,1);const arc=r.moves.filter(q=>q.kind==='swivel');assert(arc.length>1);for(const q of arc){near(Math.hypot(q.x-10,q.y),knifeOffset);near(q.z,-.5);}near(arc.at(-1).x,10);near(arc.at(-1).y,Math.sign(y)*knifeOffset);}
});
test('Dense circle samples stay at cut Z without repeated corner lifts',()=>{
 const pts=Array.from({length:360},(_,i)=>[10*Math.cos(i*Math.PI/180),10*Math.sin(i*Math.PI/180)]);
 const j=C.plan(doc(pts,true),base);assert.equal(j.knife.swivels,0);assert(j.knife.runs[0].moves.some(m=>m.kind==='transition'));assert(j.knife.runs[0].moves.filter(m=>m.kind==='transition').every(m=>m.z===base.final));
});
test('Repeated open passes preserve heading and return only at safe Z',()=>{
 const o={...base,knifePasses:2};const j=C.plan(doc([[0,0],[10,0],[10,10]]),o);assert.deepEqual(j.depths,[-2,-2]);const a=j.knife.runs[1];near(a.moves[0].x,0);near(a.moves[0].y,.45);assert(a.moves.some(m=>m.kind==='alignment'));
 let z=null,xy=0;for(const line of C.gcode(j,o).split('\n')){if(line.startsWith('('))continue;const nz=line.match(/\bZ(-?[\d.]+)/);if(line.startsWith('G0')&&/X|Y/.test(line)){assert.equal(z,o.safe);xy++;}if(nz)z=Number(nz[1]);}assert.equal(xy,2);assert.equal(z,o.safe);
});
test('Heading carried across different paths and all passes finish on one path',()=>{
 const d=doc([[0,0],[0,10]]);d.paths.push({...doc([[20,0],[30,0]]).paths[0],id:'q'});const o={...base,knifePasses:2};const j=C.plan(d,o);assert.deepEqual(j.knife.runs.map(r=>r.id),['p','p','q','q']);const firstQ=j.knife.runs[2];near(firstQ.moves[0].x,20);near(firstQ.moves[0].y,.45);
});
test('Lead-in uses lighter Z, correct heading and visible compensated bounds',()=>{
 const o={...base,knifeLead:4,knifeHeading:90};const j=C.plan(doc([[0,0],[10,0]]),o);const m=j.knife.runs[0].moves;near(m[0].x,-4);near(m[0].y,.45);const lead=m.find(q=>q.kind==='lead');near(lead.x,.45);near(lead.z,-.5);assert(j.knife.bounds.minX<0);assert(C.gcode(j,o).includes('(alignment)'));
});
test('Reversal, locked starts, closed overlap and 180 degree turns remain finite',()=>{
 const d=doc([[0,0],[10,0],[10,10],[0,10]],true),o={...base,overlap:2};const j=C.plan(d,o,{p:2},{p:true});near(j.paths[0].points[0].x,10);near(j.paths[0].points.at(-1).y,8);assert.equal(j.knife.swivels,4);assert(!/NaN|Infinity/.test(C.gcode(j,o)));
 const u=C.plan(doc([[0,0],[10,0],[0,0]]),base);assert.equal(u.knife.swivels,1);const arc=u.knife.runs[0].moves.filter(m=>m.kind==='swivel');assert(arc.length>=12);for(let i=1;i<arc.length;i++){const mid={x:(arc[i-1].x+arc[i].x)/2,y:(arc[i-1].y+arc[i].y)/2};assert(base.knifeOffset-Math.hypot(mid.x-10,mid.y)<=.00501);}
});
test('Reject missing force calibration, invalid settings and tool-on commands',()=>{
 for(const bad of [{final:NaN},{knifeSwivelZ:undefined},{knifeOffset:0},{knifeOffset:101},{knifePasses:1.5},{knifePasses:1001},{knifeAngle:0},{knifeAngle:181},{knifeLead:-1},{knifeFeed:0},{knifeSwivelZ:-3},{safe:-1},{knifeHeading:181},{tool:'M3',power:10,powerMax:100}])assert.throws(()=>C.plan(doc([[0,0],[10,0]]),{...base,...bad}),JSON.stringify(bad));
});
test('Knife output explicitly disables spindle and never enables tool power',()=>{
 const g=C.gcode(C.plan(doc([[0,0],[10,0],[10,10]]),base),base);assert(g.includes('\nM5\n'));assert(!/^M[34]\b|\bS\d/m.test(g));assert(g.includes('G1 Z-0.5 F100'));assert(g.includes('F150'));assert(g.includes('F700'));
});
test('Duplicate samples do not produce invalid geometry',()=>{const j=C.plan(doc([[0,0],[0,0],[10,0],[10,0],[10,10]]),base);assert(!/NaN|Infinity/.test(C.gcode(j,base)));assert.throws(()=>C.plan(doc([[0,0],[0,0]]),base));});
test('G-code movement replay matches planned XYZ within output rounding',()=>{
 const o={...base,knifeHeading:40,knifeLead:2,knifePasses:2};const j=C.plan(doc([[0,0],[10,0],[10,10],[0,10]],true),o);
 const expected=j.knife.runs.flatMap(r=>r.moves);let xyz={x:0,y:0,z:o.safe},actual=[];
 for(const line of C.gcode(j,o).split('\n')){if(!/^G[01] /.test(line))continue;for(const axis of ['x','y','z']){const m=line.match(new RegExp('\\b'+axis.toUpperCase()+'(-?[\\d.]+)'));if(m)xyz[axis]=+m[1];}actual.push({...xyz});}
 // Remove repeated positions on each side (redundant same-Z moves are omitted).
 const unique=a=>a.filter((q,i)=>i===0||['x','y','z'].some(k=>Math.abs(q[k]-a[i-1][k])>1e-4));
 const e=unique(expected),a=unique(actual.slice(1));assert.equal(e.length,a.length);e.forEach((q,i)=>['x','y','z'].forEach(k=>assert(Math.abs(q[k]-a[i][k])<=.000051)));
});


test('Knife progression uses identical Surface/Final/Step calculation to plotter',()=>{
 const o={...base,surface:0,final:-1.2,step:.5};
 const j=C.plan(doc([[0,0],[10,0],[10,10]]),o);assert.deepEqual(j.depths,[-.5,-1,-1.2]);
 assert.deepEqual(j.depths,C.depths({...o,mode:'plotter'}));
 j.knife.runs.forEach((r,i)=>{assert(r.moves.filter(m=>m.kind==='cut').every(m=>m.z===j.depths[i]));assert(r.moves.filter(m=>m.kind==='swivel').every(m=>m.z===o.knifeSwivelZ));});
 const g=C.gcode(j,o);for(const z of j.depths)assert(g.includes('G1 Z'+z+' F100'));
 assert.deepEqual(C.depths({...o,knifePasses:2}),[-.5,-.5,-1,-1,-1.2,-1.2]);
 assert.throws(()=>C.plan(doc([[0,0],[10,0]]),{...o,knifeSwivelZ:-.6}),/first cutting Z/);
});
test('Zero lead length removes straight lead but keeps required entry turn',()=>{
 const j=C.plan(doc([[0,0],[10,0],[10,10]]),{...base,knifeHeading:90,knifeLead:0});const m=j.knife.runs[0].moves;
 assert(m.some(q=>q.kind==='alignment'));assert(!m.some(q=>q.kind==='lead'));
});
test('Alignment off removes every entry turn/lead and retains corner swivels',()=>{
 const o={...base,knifeHeading:90,knifeLead:5,knifeAlign:false,surface:0,final:-1.2,step:.5};const j=C.plan(doc([[0,0],[10,0],[10,10]]),o);
 for(const r of j.knife.runs){assert(!r.moves.some(q=>['alignment','lead'].includes(q.kind)));assert(r.moves.some(q=>q.kind==='swivel'));near(r.moves[0].x,.45);near(r.moves[0].y,0);}
 const g=C.gcode(j,o);assert(g.includes('Entry alignment OFF'));assert(!g.includes('(alignment)'));assert(!g.includes('(lead)'));assert(g.includes('(swivel)'));
});

test('Corner lift off preserves XY swivel compensation at each progressive Z',()=>{
 const o={...base,knifeLift:false,knifeAlign:false,knifeSwivelZ:NaN,surface:0,final:-1.2,step:.5};
 const j=C.plan(doc([[0,0],[10,0],[10,10]]),o);
 for(const [i,r] of j.knife.runs.entries()){assert(!r.moves.some(m=>m.kind==='lift'));assert(r.moves.some(m=>m.kind==='swivel'));assert(r.moves.filter(m=>m.kind==='swivel').every(m=>m.z===j.depths[i]));}
 assert(!C.gcode(j,o).includes('NaN'));assert(C.gcode(j,o).includes('lift OFF'));
 const aligned=C.plan(doc([[0,0],[10,0],[10,10]]),{...o,knifeAlign:true,knifeHeading:90,knifeSwivelZ:0});
 assert(aligned.knife.runs[0].moves.some(m=>m.kind==='alignment'&&m.z===0));assert(!aligned.knife.runs[0].moves.some(m=>m.kind==='lift'));
});
console.log(`${count} knife checks passed.`);
