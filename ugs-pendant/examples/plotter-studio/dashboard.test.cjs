// The dashboard's plotter view reads pen names, colors and widths from G-code comments (toolTable.ts).
// This runs that parser, the real one, on Plotter Studio's output. Skipped when the dashboard sources or
// their node_modules (for TypeScript) are not present.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),core=require('./core.js');
const dashboard=path.join(__dirname,'../../src/main/webapp-dashboard'),source=path.join(dashboard,'src/utils/toolTable.ts');
let ts=null;try{ts=require(path.join(dashboard,'node_modules/typescript'));}catch{}
if(!ts||!fs.existsSync(source)){console.log('dashboard compatibility skipped (dashboard sources or TypeScript not found)');process.exit(0);}
const compiled=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const sandbox={exports:{},Math,Number,Int32Array,Set,Map,Object,String,JSON};vm.runInNewContext(compiled,sandbox);
const scan=text=>JSON.parse(JSON.stringify(sandbox.exports.scanTools(text)));

const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const sq=(id,x,color)=>({id,name:id,color,closed:true,points:rect(x,0,x+5,5)});
const base={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-.2,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'svg',start:'original',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
const doc={paths:[sq('a',0,'#010001'),sq('b',10,'#154c2a'),sq('c',20,'#f99e0e'),sq('d',30,'#e02020')],page:rect(0,0,40,5)};
const o={...base,penWidth:.4,penWidths:{2:.3},penMap:{'#010001':1,'#154c2a':2,'#f99e0e':3,'#e02020':3},penChange:'M6'};
const result=scan(core.gcode(core.plan(doc,o),o));
assert.deepStrictEqual(result.changes.map(c=>c.tool),[1,2,3],'the dashboard sees three tool changes, in order');
const h=result.hints;
assert.strictEqual(h[1].color,'#010001');assert.strictEqual(h[1].name,'black');assert.strictEqual(h[1].diameter,.4,'pen 1 width');
assert.strictEqual(h[2].color,'#154c2a');assert.strictEqual(h[2].name,'dark green');assert.strictEqual(h[2].diameter,.3,'pen 2 has its own width');
assert.strictEqual(h[3].color,'#f99e0e','the other color on pen 3 does not replace its main color');assert.strictEqual(h[3].name,'orange');assert.strictEqual(h[3].diameter,.4);
// the message on the tool-change line gives the same pen
assert(/T2 M6 \(MSG, Load pen 2: dark green #154c2a\)/.test(core.gcode(core.plan(doc,o),o)));
// the per-pen files describe their pen too
const o2={...o,penChange:'files'},files=core.gcodeFiles(core.plan(doc,o2),o2),file3=scan(files[2].text).hints[3];
assert.strictEqual(file3.color,'#f99e0e');assert.strictEqual(file3.name,'orange');assert.strictEqual(file3.diameter,.4);
// the pause (M0) mode carries the same comments (the dashboard reads them; it only sees pen changes with T words)
const o3={...o,penChange:'M0'},m0=scan(core.gcode(core.plan(doc,o3),o3)).hints;
assert.strictEqual(m0[2].color,'#154c2a');assert.strictEqual(m0[2].diameter,.3);
console.log('dashboard compatibility ok');
// the registration cross adds comments and moves; none of them may be read as a pen, a color or a width
{
  const oR={...o,regCross:true,regMargin:8,regSize:6},text=core.gcode(core.plan(doc,oR),oR),r=scan(text);
  assert.deepStrictEqual(r.changes.map(c=>c.tool),[1,2,3],'the same three tool changes');
  for(const pen of [1,2,3]){
    assert.strictEqual(r.hints[pen].color,h[pen].color,'pen '+pen+' keeps its color');
    assert.strictEqual(r.hints[pen].name,h[pen].name,'pen '+pen+' keeps its name');
    assert.strictEqual(r.hints[pen].diameter,h[pen].diameter,'pen '+pen+' keeps its width: no registration comment is read as a size');
  }
  assert(/Register: center the tip on the cross/.test(text)&&/G10 L20 P1 X-8 Y-8/.test(text));
  const oF={...oR,penChange:'files'},file2=scan(core.gcodeFiles(core.plan(doc,oF),oF)[1].text).hints[2];
  assert.strictEqual(file2.color,'#154c2a');assert.strictEqual(file2.diameter,.3);
}
console.log('dashboard compatibility with registration ok');

