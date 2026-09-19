(async()=>{
  const results=[];let failed=0;const assert=(v,m='assertion failed')=>{if(!v)throw Error(m);};
  const wrap=s=>`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">${s}</svg>`;
  const test=(name,fn)=>{try{fn();results.push('PASS '+name);}catch(e){failed++;results.push('FAIL '+name+': '+e.message);}};
  test('Separate subpaths, relative moves and closed flags',()=>{const d=SvgImport.parse(wrap('<path d="M 0 0 l 10 0 0 10 z m 20 0 l 10 0"/>'));assert(d.paths.length===2);assert(d.paths[0].closed&&!d.paths[1].closed);assert(d.paths[1].points[0].x===20);});
  test('Physical mm and viewBox override DPI',()=>{const a=SvgImport.parse(wrap('<rect width="10" height="20"/>'),{dpi:300});const b=SvgCam.bounds(a.paths[0].points);assert(Math.abs(b.maxX-10)<.01);assert(Math.abs(b.maxY-b.minY-20)<.01);});
  test('Pixel dimensions default to 96 DPI',()=>{const a=SvgImport.parse('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><path d="M0 0 L96 96"/></svg>');assert(Math.abs(a.width-25.4)<1e-8);});
  test('Nested transforms and flipped Y axis',()=>{const a=SvgImport.parse(wrap('<g transform="translate(10 20)"><g transform="scale(2)"><path d="M 0 0 L 5 5"/></g></g>'));assert(a.paths[0].points[0].x===10);assert(a.paths[0].points[0].y===80);assert(a.paths[0].points.at(-1).x===20);});
  test('Curves, arcs and rounded rectangles import',()=>{const a=SvgImport.parse(wrap('<path d="M0 0 C1 2 3 4 10 10 S20 20 30 10 Q40 0 50 10 T70 10 A5 5 0 0 1 80 10"/><rect width="20" height="10" rx="2"/>'));assert(a.paths.length===2);assert(a.paths[0].points.length>100);});
  test('Hidden layer is ignored',()=>{const a=SvgImport.parse(wrap('<g style="display:none"><text>skip</text></g><path d="M0 0L10 10"/>'));assert(a.paths.length===1);});
  test('Reject visible text, script, clones and clipping',()=>{for(const s of ['<text>hello</text>','<script>alert(1)</script>','<use href="#x"/>','<path clip-path="url(#x)" d="M0 0L10 10"/>']){let threw=false;try{SvgImport.parse(wrap(s));}catch{threw=true;}assert(threw);}});
  test('Reject malformed path and unknown units',()=>{for(const s of ['<path d="M0 0 L10"/>','<path d="M0 0 R10 20"/>','<rect width="20%" height="10"/>']){let threw=false;try{SvgImport.parse(wrap(s));}catch{threw=true;}assert(threw);}});
  test('Basic shapes',()=>{const a=SvgImport.parse(wrap('<line x2="10" y2="10"/><polyline points="0,0 2,3 4,5"/><polygon points="0,0 10,0 5,5"/><circle r="4"/><ellipse rx="4" ry="8"/>'));assert(a.paths.length===5);});
  test('Sharp command endpoints survive sampling',()=>{const a=SvgImport.parse(wrap('<path d="M0 0L1.234 0L1.234 2.345Z"/>'),{spacing:.5});assert(a.paths[0].points.some(p=>Math.abs(p.x-1.234)<1e-5&&Math.abs(p.y-100)<1e-5));assert(a.paths[0].points.some(p=>Math.abs(p.x-1.234)<1e-5&&Math.abs(p.y-97.655)<1e-5));});
  const sample=await(await fetch('sample.svg')).text();test('Sample Inkscape-style document',()=>{const a=SvgImport.parse(sample);assert(a.paths.length===4);assert(a.width===80&&a.height===60);});
  document.getElementById('results').textContent=results.join('\n')+`\n\n${results.length-failed}/${results.length} passed`;
})();
