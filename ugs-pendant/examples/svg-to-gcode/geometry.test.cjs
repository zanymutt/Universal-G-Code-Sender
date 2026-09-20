const assert=require('node:assert/strict'),G=require('./geometry.js'),C=require('./core.js');
const opts={spacing:.5,tolerance:.01,cleanup:.1,curveSegments:12,equalDistance:0};
const prepared=d=>({items:[{d,closed:/z\s*$/i.test(d),matrix:[1,0,0,1,0,0],height:100,name:'test'}],width:100,height:100,options:opts});
const base={mode:'knife',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-2,step:2,scale:100,rotation:0,overlap:0,origin:'custom',originBounds:'artwork',originX:0,originY:0,order:'svg',start:'original',inner:false,largest:false,knifeOffset:.45,knifeAngle:60,knifeArcAngle:10,knifeFeed:200,knifePasses:1,knifeAlign:false,knifeLift:true,knifeSwivelZ:-.5,outputTolerance:.01,spacing:.5};
function job(d,o={}){return C.plan(G.run(prepared(d)),{...base,...o});}
let checks=0;function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('Relative commands, smooth reflected cubic/quadratic controls, and close',()=>{const s=G.segments('M10 10 c0 10 10 10 10 0 s10 -10 10 0 q5 10 10 0 t10 0 h5 v5 z');assert.equal(s.length,7);assert.deepEqual(s[1].p1,{x:20,y:0});assert.deepEqual(s[3].p1,{x:45,y:0});assert.deepEqual(G.at(s.at(-1),1),{x:10,y:10});});
test('Cubic endpoints with zero derivative preserve actual corner directions',()=>{const j=job('M0 0 C0 0 10 0 10 0 C10 0 10 10 10 10');assert.equal(j.knife.swivels,1);const arc=j.knife.runs[0].moves.filter(m=>m.kind==='swivel');assert(arc.length>=18);for(const m of arc)assert(Math.abs(Math.hypot(m.x-10,m.y-100)-.45)<1e-8);});
test('Arc and lift thresholds are independent',()=>{const d='M0 0 L10 0 L20 -10';const j=job(d);assert.equal(j.knife.swivels,1);assert(!j.knife.runs[0].moves.some(m=>m.kind==='lift'));assert(j.knife.runs[0].moves.filter(m=>m.kind==='swivel').every(m=>m.z===-2));const lifted=job(d,{knifeAngle:30});assert(lifted.knife.runs[0].moves.some(m=>m.kind==='lift'));const noArc=job(d,{knifeArcAngle:50,knifeAngle:30});assert.equal(noArc.knife.swivels,0);assert(!noArc.knife.runs[0].moves.some(m=>m.kind==='lift'));assert(noArc.knife.runs[0].moves.some(m=>m.kind==='transition'));});
test('Output simplification cannot remove swivels or tight continuous turns',()=>{for(const d of ['M0 0 L10 0 L10 10','M0 0 L10 0 Q10.01 0 10.01 .01 L10.01 10']){const a=job(d,{outputTolerance:0}),b=job(d,{outputTolerance:1});const turns=j=>j.knife.runs[0].moves.filter(m=>['swivel','curve'].includes(m.kind));assert(turns(a).length>0);assert.deepEqual(turns(a),turns(b));}});
test('Cubic reversal cusps have two distinct one-sided directions',()=>{const p=prepared('M0 0 C10 0 -10 0 0 0');p.options={...opts,cleanup:0};const doc=G.run(p);assert(doc.paths[0].points.some(q=>q.tin&&q.tout&&q.tin.x*q.tout.x+q.tin.y*q.tout.y<-.99));assert(C.plan(doc,base).knife.swivels>=2);});
test('Ellipse arc endpoints and derivative are analytic',()=>{const s=G.segments('M10 0 A10 5 0 0 1 -10 0')[0];const p=G.at(s,.5);assert(Math.abs(p.x)<1e-8);assert(Math.abs(p.y-5)<1e-8);assert.deepEqual(G.at(s,1),{x:-10,y:0});});
test('Tiny redundant reversals are cleaned without flattening nearby tight bends',()=>{const p=prepared('M0 0 L10 0 L9.9999 0 L20 0');const doc=G.run(p);assert(doc.paths[0].points.length<4);assert(doc.paths[0].points.every((p,i,a)=>!i||p.x>=a[i-1].x));assert.equal(C.plan(doc,base).knife.swivels,0);const round=G.run(prepared('M0 0 L10 0 Q10.01 0 10.01 .01 L10.01 10'));assert(round.paths[0].points.length>5);});
test('Invalid swivel arc thresholds rejected',()=>{for(const v of [-1,181,NaN])assert.throws(()=>job('M0 0 L10 0',{knifeArcAngle:v}));});
test('Sub-tolerance opposing corner pair is removed and no swivel/lift remains',()=>{
 const d='M0 0 L10 -.7 L10 -.699478 L20 -1.399478';
 const before=prepared(d);before.options={...opts,cleanup:0};assert.equal(C.plan(G.run(before),base).knife.swivels,2);
 const after=job(d);assert.equal(after.knife.swivels,0);assert(!after.knife.runs[0].moves.some(m=>m.kind==='lift'));
 const pts=after.paths[0].points;assert.deepEqual({x:pts[0].x,y:pts[0].y},{x:0,y:100});assert.deepEqual({x:pts.at(-1).x,y:pts.at(-1).y},{x:20,y:101.399478});
});
test('Opposing turns remain when outside tolerance or their surrounding directions differ',()=>{
 const d='M0 0 L10 -.7 L10 -.699478 L20 -1.399478',p=prepared(d);p.options={...opts,tolerance:.001};assert.equal(C.plan(G.run(p),base).knife.swivels,2);
 assert.equal(job('M0 0 L10 0 L10 .02 L20 .02').knife.swivels,2);
 assert.equal(job('M0 0 L10 0 L10 .0005 L20 5').knife.swivels,2);
});
test('Cleanup keeps endpoints when the tiny step ends the path',()=>{
 const j=job('M0 0 L10 0 L10 .0005');assert.equal(j.paths[0].points.length,3);assert.equal(j.knife.swivels,1);
});
test('Nearby merging retains a genuine net corner and removes its tiny intermediate edge',()=>{
 const p=prepared('M0 0 L10 0 L10.0002 -.0002 L10.0002 -10');p.options={...opts,cleanup:0,mergeDistance:.001};
 const merged=G.run(p);assert.equal(merged.paths[0].points.length,3);assert.equal(C.plan(merged,base).knife.swivels,1);
 p.options.mergeDistance=0;assert.equal(G.run(p).paths[0].points.length,4);assert.equal(C.plan(G.run(p),base).knife.swivels,2);
});
test('Merge groups cannot grow through a chain and never change open endpoints',()=>{
 const points=Array.from({length:11},(_,i)=>({x:i*.0006,y:0,tin:{x:1,y:0},tout:{x:1,y:0}}));
 const result=G.mergeNearby(points,false,.001);assert(result.length>=6);assert.equal(result[0].x,0);assert.equal(result.at(-1).x,points.at(-1).x);
 for(const p of points)assert(result.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<=.001));
});
test('Merge handles a closed seam, preserves minimum geometry and does not join paths',()=>{
 const v=(x,y)=>({x,y,tin:{x:1,y:0},tout:{x:0,y:1}});
 const seam=G.mergeNearby([v(0,0),v(10,0),v(10,10),v(0,10),v(0,.0001)],true,.001);assert.equal(seam.length,4);assert.equal(seam[0].x,0);assert.equal(seam[0].y,0);
 const tiny=[v(0,0),v(.0001,0),v(0,.0001)];assert.equal(G.mergeNearby(tiny,true,.001).length,3);
 const p=prepared('M0 0 L10 0');p.items.push({...p.items[0],d:'M10.0001 0 L20 0'});p.options={...opts,mergeDistance:.001};assert.equal(G.run(p).paths.length,2);
});
console.log(checks+' geometry/corner checks passed');

