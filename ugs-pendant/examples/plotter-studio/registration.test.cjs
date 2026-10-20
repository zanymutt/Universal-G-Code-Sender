const assert=require('assert'),core=require('./core.js');
const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const sq=(id,x,color)=>({id,name:id,color,closed:true,points:rect(x,0,x+5,5)});
const base={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-.2,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
const doc={paths:[sq('a',0,'#010001'),sq('b',10,'#154c2a'),sq('c',20,'#f99e0e')],page:rect(0,0,30,5)};
const pens={'#010001':1,'#154c2a':2,'#f99e0e':3};
const run=(extra,d=doc)=>{const o={...base,penMap:pens,penChange:'M6',...extra},job=core.plan(d,o);return {o,job,text:core.gcode(job,o)};};
const at=(lines,pattern,from=0)=>{for(let i=from;i<lines.length;i++)if(pattern.test(lines[i]))return i;return -1;};

// ---- off by default: nothing changes
{
  const off=run({}),plain=run({regCross:false});
  assert.strictEqual(off.text,plain.text);assert(!/Registration|Register|G10/.test(off.text));assert.strictEqual(off.job.registration,undefined);
}
// ---- on: the cross is left of and below the artwork, outside the artwork's bounds
{
  const {job,text}=run({regCross:true,regMargin:8,regSize:6});
  assert.deepStrictEqual({x:job.registration.x,y:job.registration.y,size:job.registration.size},{x:-8,y:-8,size:6});
  assert(job.bounds.minX>=0&&job.bounds.minY>=0,'the job bounds do not include the cross');
  const lines=text.split('\n');
  assert(lines.includes('(Registration cross at X-8 Y-8. After changing to a new pen, center its tip on the cross and send G10 L20 P1 X-8 Y-8.)'));
  // pen 1 (first group): no jog request, then it draws the cross: a horizontal and a vertical stroke
  const t1=at(lines,/^T1 M6/);assert(t1>0);assert(!lines.slice(0,t1).some(l=>/Register:|^G0 X-8 Y-8$/.test(l)),'the first pen is not asked to register');
  const h=at(lines,/^\(Registration cross 1 /,t1);assert(h>t1);
  assert.deepStrictEqual(lines.slice(h,h+9).filter(l=>/^G[01] /.test(l)).slice(0,4),['G0 Z5','G0 X-11 Y-8','G1 Z-0.2 F200','G1 X-5 Y-8 F1000'],'horizontal stroke, 6 long, centered on the cross');
  const v=at(lines,/^\(Registration cross 2 /,t1);assert(lines.slice(v,v+9).includes('G0 X-8 Y-11')&&lines.slice(v,v+9).some(l=>/^G1 X-8 Y-5( |$)/.test(l)),'vertical stroke');
  // pen 2: over the cross, then its comments, the registration message, the tool change, then it draws the cross
  const over=at(lines,/^G0 X-8 Y-8$/),p2=at(lines,/^\(Pen 2: /),msg=at(lines,/^\(MSG, Register: /),t2=at(lines,/^T2 M6/),cross2=at(lines,/^\(Registration cross 1 /,t2);
  assert(over>0&&over<p2&&p2<msg&&msg<t2&&t2<cross2,'order: over the cross, pen comments, register message, tool change, cross');
  assert.strictEqual(lines[msg],'(MSG, Register: center the tip on the cross at X-8 Y-8, then send G10 L20 P1 X-8 Y-8)');
  assert.strictEqual(lines.filter(l=>/^\(MSG, Register: /.test(l)).length,2,'pens 2 and 3 are asked to register, pen 1 is not');
  assert.strictEqual(lines.filter(l=>/^\(Registration cross \d /.test(l)).length,6,'every pen draws both strokes');
}
// ---- the pause (M0) form does the same
{
  const lines=run({regCross:true,penChange:'M0'}).text.split('\n');
  const msg=at(lines,/^\(MSG, Register: /),m0=at(lines,/^M0 \(MSG, Load pen 2/);assert(msg>0&&msg<m0);
}
// ---- only the first pen draws it
{
  const lines=run({regCross:true,regEvery:false}).text.split('\n');
  assert.strictEqual(lines.filter(l=>/^\(Registration cross \d /.test(l)).length,2,'one cross: two strokes');
  assert(at(lines,/^\(Registration cross 1 /)<at(lines,/^T2 M6/),'drawn by the first pen');
  assert.strictEqual(lines.filter(l=>/^\(MSG, Register: /.test(l)).length,2,'later pens still re-register');
}
// ---- no pen changes: the cross is drawn once, at the start
{
  const lines=run({regCross:true,penChange:'none'}).text.split('\n');
  assert.strictEqual(lines.filter(l=>/^\(Registration cross \d /.test(l)).length,2);assert(!lines.some(l=>/Register:/.test(l)));
}
// ---- separate files
{
  const o={...base,penMap:pens,penChange:'files',regCross:true},job=core.plan(doc,o),files=core.gcodeFiles(job,o);
  assert(files[0].text.includes('(This file draws the registration cross at X-8 Y-8. Set work zero as usual.)'));
  assert(files[1].text.includes('(Before running: center this pen on the registration cross and send G10 L20 P1 X-8 Y-8)'));
  assert(files.every(f=>/\(Registration cross 1 - pass/.test(f.text)&&/\(Registration cross 2 - pass/.test(f.text)),'each file draws it to check the alignment');
  const first=core.gcodeFiles(job,{...o,regEvery:false});
  assert(/\(Registration cross 1/.test(first[0].text)&&!/\(Registration cross 1/.test(first[1].text)&&!/\(Registration cross 1/.test(first[2].text),'only the first pen\'s file draws it');
  assert(!/Registration|G10/.test(core.gcodeFiles(core.plan(doc,{...o,regCross:false}),{...o,regCross:false})[1].text));
}
// ---- settings are checked; plotter mode only
{
  assert.throws(()=>run({regCross:true,regMargin:-1}),/distance/);assert.throws(()=>run({regCross:true,regMargin:500}),/distance/);
  assert.throws(()=>run({regCross:true,regSize:0}),/size/);assert.throws(()=>run({regCross:true,regSize:80}),/size/);
  assert.strictEqual(core.plan(doc,{...base,mode:'laser',tool:'M4',focus:0,laserPasses:1,regCross:true}).registration,undefined);
  // other origins: the cross follows the artwork
  const shifted=run({regCross:true,origin:'top-right'}).job.registration,def=run({regCross:true}).job.registration;
  assert(shifted.x<def.x&&shifted.y<def.y,'with the origin at the top right the artwork is at negative coordinates, and so is the cross');
}
// ---- corners and separate X / Y distances (artwork spans X0-25 Y0-5)
{
  const at4=c=>{const r=run({regCross:true,regCorner:c,regMargin:4,regMarginY:10}).job.registration;return [r.x,r.y];};
  assert.deepStrictEqual(at4('bl'),[-4,-10]);assert.deepStrictEqual(at4('br'),[29,-10]);
  assert.deepStrictEqual(at4('tl'),[-4,15]);assert.deepStrictEqual(at4('tr'),[29,15]);
  assert.deepStrictEqual(run({regCross:true,regMargin:4}).job.registration.y,-4,'Y distance defaults to the X distance');
  assert.throws(()=>run({regCross:true,regCorner:'middle'}),/corner/);
}
// ---- hatch gap with both pens is measured from the moved outline
{
  const sqr={id:'s',name:'s',color:'#154c2a',fillColor:'#154c2a',closed:true,points:rect(0,0,20,20)};
  const o={fillSource:'original',fills:{2:{mode:'hatch',angle:0,spacing:1,gap:.5}},penWidths:{2:.5}};
  const edge=extra=>{const pts=core.plan({paths:[sqr],page:rect(0,0,20,20)},{...base,penMap:{'#154c2a':2},...o,...extra}).paths.filter(q=>q.fill).flatMap(q=>q.points.map(v=>v.x));return [Math.min(...pts),Math.max(...pts)];};
  const one=edge({borders:'one'}),both=edge({borders:'both'});
  assert(Math.abs(one[0]-.5)<.05,'one pen: hatch starts at the gap from the region edge');
  assert(Math.abs(both[0]-(.5+.25+.25))<.05,'both pens: the gap starts after the outline inset (half width) and half its width');
  assert(Math.abs(both[1]-(20-1))<.05);
}
console.log('registration ok');
{
  // inset outlines shrink the drawn bounds, but the cross is still exactly the distance from the artwork edge
  const r=run({regCross:true,regCorner:'tl',regMargin:8,regMarginY:50,borders:'both',penWidths:{1:1,2:1,3:1}}).job.registration;
  assert.deepStrictEqual([r.x,r.y],[-8,55],'artwork spans X0-25 Y0-5 as imported');
}
console.log('registration corner ok');
