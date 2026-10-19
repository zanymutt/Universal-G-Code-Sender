(function(){
  'use strict';
  const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
  const importFields=['dpi','spacing','cleanup','curveSegments','tolerance','equalDistance','mergeDistance','joinDistance'];
  const numeric=['outputTolerance','feed','plunge','safe','surface','final','step','focus','laserPasses','power','powerMax','scale','rotation','overlap','originX','originY'];
  const knifeNumeric=['knifeArcAngle','knifeOffset','knifeSwivelZ','knifePasses','knifeAngle','knifeFeed','knifeLead','knifeHeading'];
  const choices=['mode','tool','origin','originBounds','order','start','penChange'];
  const tabs=[...document.querySelectorAll('[role=tab]')];
  function showTab(tab){tabs.forEach(t=>{const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;$(t.getAttribute('aria-controls')).hidden=!active;});window.Dropdowns?.refresh();}
  tabs.forEach((tab,i)=>{tab.onclick=()=>showTab(tab);tab.onkeydown=e=>{let index;if(e.key==='ArrowRight')index=(i+1)%tabs.length;else if(e.key==='ArrowLeft')index=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')index=0;else if(e.key==='End')index=tabs.length-1;else return;e.preventDefault();showTab(tabs[index]);tabs[index].focus({preventScroll:true});};});
  let documentData=null,svgText='',fileFormat='svg',locks={},directions={},job=null,code='',pick=null,savePending=false,revision=0,importDirty=false,loadId=0;
  let importController=null;
  // color -> pen number (0 = skip). Kept across reimports for colors that still exist.
  let penAssign={},penColors={},fillSettings={},generatedFiles=[],previewBg=null;
  function busy(text,fraction){$('busy').hidden=false;$('busyText').textContent=text;document.querySelector('main').setAttribute('aria-busy','true');if(Number.isFinite(fraction))$('busyProgress').value=Math.max(0,Math.min(1,fraction));else $('busyProgress').removeAttribute('value');}
  function endBusy(){$('busy').hidden=true;document.querySelector('main').setAttribute('aria-busy','false');}
  function cancelImport(){loadId++;importController?.abort();importController=null;endBusy();}
  function syncEndpointJoinControl(){$('joinDistance').disabled=!$('joinEndpoints').checked;}
  $('cancelWork').onclick=()=>{cancelImport();invalidate();documentData=null;job=null;importDirty=true;$('generate').disabled=true;$('summary').textContent='Import canceled';message('Import canceled. Choose another SVG or DXF or click Reimport.');};
  function settings(){const o={};numeric.forEach(k=>o[k]=$(k).value.trim()===''?NaN:Number($(k).value));choices.forEach(k=>o[k]=$(k).value);knifeNumeric.forEach(k=>o[k]=$(k).value.trim()===''?NaN:Number($(k).value));['inner','largest','reverse','knifeAlign','knifeLift','fillAll','fillFirst','skipUnstroked'].forEach(k=>o[k]=$(k).checked);o.spacing=Number($('spacing').value);o.penMap={...penAssign};o.penColors={...penColors};o.fills=Object.fromEntries(Object.entries(fillSettings).map(([pen,f])=>[pen,{mode:({lines:'hatch',cross:'cross',wavy:'wavy'})[f.pattern]||'none',angle:f.angle,spacing:f.spacing,gap:f.gap,amp:f.amp,wavelength:f.wavelength,shift:f.shift,zigzag:f.zigzag}]));return o;}
  function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
  $('preview').setAttribute('tabindex','-1');
  function setPick(value){pick=value;$('preview').classList.toggle('picking',!!value);}
  function invalidate(){setPick(null);revision++;code='';generatedFiles=[];$('fileChoiceLabel').hidden=true;$('output').value='';$('save').disabled=true;$('copy').disabled=true;}
  function el(tag,attrs,parent){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent.append(n);return n;}
  let fitBox=null,viewBox=null;
  function applyView(){if(viewBox)$('preview').setAttribute('viewBox',`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);$('zoomLevel').textContent=fitBox&&viewBox?Math.round(fitBox.w/viewBox.w*100)+'%':'100%';}
  function colorList(){
    const counts=new Map(),entry=c=>{if(!counts.has(c))counts.set(c,{paths:0,fills:0});return counts.get(c);};
    for(const p of documentData?.paths||[]){entry(p.color||'#000000').paths++;if(p.closed&&p.fillColor)entry(p.fillColor).fills++;}
    return [...counts].map(([c,n])=>[c,n.paths,n.fills]);
  }
  function assignDefaults(onePen){
    penAssign={};colorList().forEach(([c],i)=>{penAssign[c]=onePen?1:i+1;});
  }
  function renderPens(){
    const list=colorList(),rows=$('penRows');rows.replaceChildren();
    $('penTable').hidden=!list.length;$('penPerColor').disabled=!list.length;$('penAllOne').disabled=!list.length;
    $('penNote').textContent=list.length?(list.length+' color'+(list.length===1?'':'s')+' found. Pens apply in plotter mode.'):'Import artwork to list its colors.';
    list.forEach(([color,count,fills])=>{
      const tr=document.createElement('tr'),swatch=document.createElement('input');swatch.type='color';swatch.value=penColors[color]||color;swatch.setAttribute('aria-label','Display color for '+color);
      swatch.addEventListener('input',()=>{penColors[color]=swatch.value;update();});
      const c1=document.createElement('td');c1.append(swatch,document.createTextNode(color));
      const c2=document.createElement('td');c2.textContent=String(count)+(fills?' · '+fills+' fill'+(fills===1?'':'s'):'');
      const input=document.createElement('input');input.type='number';input.min='0';input.max='99';input.step='1';input.value=String(penAssign[color]??1);input.setAttribute('aria-label','Pen for '+color+' (0 skips)');
      input.disabled=$('mode').value!=='plotter';
      input.addEventListener('input',()=>{penAssign[color]=input.value.trim()===''?NaN:Number(input.value);renderFills();update();});
      const c3=document.createElement('td');c3.append(input);
      tr.append(c1,c2,c3);rows.append(tr);
    });
    renderFills();
  }
  // One row per pen that has something to fill; Edit opens the pattern dialog.
  const fillDefaults=()=>({pattern:'none',angle:45,spacing:1,gap:.5,amp:.6,wavelength:6,shift:0,zigzag:false});
  const patternNames={none:'Off',lines:'Parallel lines',cross:'Cross-hatch',wavy:'Wavy lines'};
  let fillPens=[],fillDialogPen=null;
  function describeFill(f){
    if(f.pattern==='none')return 'Off';
    let text=patternNames[f.pattern]+' · '+f.angle+'° · spacing '+f.spacing+' mm';
    if(f.pattern==='wavy')text+=' · wave '+f.amp+' mm / '+f.wavelength+' mm'+(f.shift?' · shift '+f.shift+'°':'');
    return text+(f.zigzag?' · zigzag':'')+' · gap '+f.gap+' mm';
  }
  const pickOne=list=>list[Math.floor(Math.random()*list.length)];
  const randomIn=(lo,hi,step)=>Number((Math.round((lo+Math.random()*(hi-lo))/step)*step).toFixed(2));
  function randomizeFill(pen){
    const f=fillSettings[pen]=fillSettings[pen]||fillDefaults(),spacing=randomIn(.6,3,.1);
    Object.assign(f,{pattern:pickOne(['lines','cross','wavy']),angle:randomIn(0,175,5),spacing,gap:randomIn(.2,1.2,.1),amp:randomIn(.3,Math.max(.5,spacing*1.2),.1),wavelength:randomIn(3,14,.5),shift:pickOne([0,45,90,180]),zigzag:Math.random()<.5});
  }
  function renderFills(){
    const rows=$('fillRows');rows.replaceChildren();
    const pens=new Set();
    for(const [color,,fills] of colorList()){const pen=penAssign[color];if(pen>0&&(fills>0||$('fillAll').checked))pens.add(pen);}
    fillPens=[...pens].sort((a,b)=>a-b);
    $('fillTable').hidden=!fillPens.length;$('fillRandomAll').disabled=!fillPens.length||$('mode').value!=='plotter';
    $('fillNote').textContent=fillPens.length?'Fills are drawn with the pen assigned to the shape\'s fill color. Only shapes that have a fill in the artwork are filled (an unspecified fill counts as none).':(documentData?'No shape has a fill. Tick "Hatch every closed shape" to fill shapes anyway.':'Import artwork to set up fills.');
    for(const pen of fillPens){
      const f=fillSettings[pen]=fillSettings[pen]||fillDefaults(),tr=document.createElement('tr'),cell=(node,className)=>{const td=document.createElement('td');if(className)td.className=className;td.append(node);tr.append(td);return td;};
      cell(document.createTextNode(String(pen)));cell(document.createTextNode(describeFill(f)),'fillSummary');
      const box=document.createElement('span'),button=(label,handler)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=$('mode').value!=='plotter';b.setAttribute('aria-label',label+' fill for pen '+pen);b.addEventListener('click',handler);box.append(b);};
      button('Edit',()=>openFillDialog(pen));
      button('Random',()=>{randomizeFill(pen);renderFills();update();});
      cell(box,'fillButtons');
      rows.append(tr);
    }
  }
  function fillDialogFields(){
    const f=fillSettings[fillDialogPen];
    $('fdPattern').value=f.pattern;$('fdAngle').value=f.angle;$('fdSpacing').value=f.spacing;$('fdGap').value=f.gap;
    $('fdAmp').value=f.amp;$('fdLength').value=f.wavelength;$('fdShift').value=f.shift;$('fdZigzag').checked=f.zigzag;
    $('fdWave').hidden=f.pattern!=='wavy';$('fdBasic').hidden=f.pattern==='none';
    window.Dropdowns?.refresh();
  }
  function openFillDialog(pen){
    fillDialogPen=pen;$('fillDialogTitle').textContent='Pen '+pen+' fill';fillDialogFields();$('fillDialog').hidden=false;$('fdDone').focus({preventScroll:true});
  }
  function closeFillDialog(){fillDialogPen=null;$('fillDialog').hidden=true;window.Dropdowns?.close();}
  function readFillDialog(){
    if(fillDialogPen===null)return;
    const f=fillSettings[fillDialogPen],num=id=>$(id).value.trim()===''?NaN:Number($(id).value);
    Object.assign(f,{pattern:$('fdPattern').value,angle:num('fdAngle'),spacing:num('fdSpacing'),gap:num('fdGap'),amp:num('fdAmp'),wavelength:num('fdLength'),shift:num('fdShift'),zigzag:$('fdZigzag').checked});
    $('fdWave').hidden=f.pattern!=='wavy';$('fdBasic').hidden=f.pattern==='none';
    renderFills();update();
  }
  for(const id of ['fdPattern','fdAngle','fdSpacing','fdGap','fdAmp','fdLength','fdShift','fdZigzag'])$(id).addEventListener('input',readFillDialog);
  $('fdRandom').onclick=()=>{if(fillDialogPen===null)return;randomizeFill(fillDialogPen);fillDialogFields();renderFills();update();};
  $('fdDone').onclick=closeFillDialog;
  $('fillDialog').addEventListener('pointerdown',event=>{if(event.target===$('fillDialog'))closeFillDialog();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('fillDialog').hidden)closeFillDialog();});
  $('fillRandomAll').onclick=()=>{fillPens.forEach(randomizeFill);renderFills();update();};
  // Cut color in the preview; add a halo when it would vanish against the theme.
  function luminance(hex){const n=parseInt(hex.slice(1),16),f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(n>>16&255)+.7152*f(n>>8&255)+.0722*f(n&255);}
  // With a custom background the halo is the background itself, or a contrasting tone
  // when the pen color would be hard to see on it.
  function penStyle(p){
    const bg=previewBg,bgLum=bg?luminance(bg):null,plain=bg||'var(--plugin-surface)';
    if($('mode').value!=='plotter'||!/^#[0-9a-f]{6}$/i.test(p.color||''))return {stroke:'var(--plugin-cut)',halo:plain};
    const shown=penColors[p.color]||p.color,l=luminance(shown);
    if(bg){const weak=(Math.max(l,bgLum)+.05)/(Math.min(l,bgLum)+.05)<2.2;return {stroke:shown,halo:weak?(bgLum>.5?'#303030':'#e0e0e0'):bg};}
    const light=document.documentElement.dataset.theme==='light',weak=light?l>.8:l<.12;
    return {stroke:shown,halo:weak?'var(--plugin-text-muted)':plain};
  }
  const rgbHex=css=>{const m=/(\d+)\D+(\d+)\D+(\d+)/.exec(css||'');return m?'#'+[1,2,3].map(i=>Number(m[i]).toString(16).padStart(2,'0')).join(''):'#101619';};
  function applyBackground(value){
    previewBg=/^#[0-9a-f]{6}$/i.test(value||'')?value.toLowerCase():null;
    const svg=$('preview');
    if(previewBg){svg.style.background=previewBg;svg.style.setProperty('--plugin-preview-text',luminance(previewBg)>.5?'#111':'#e6eef9');}
    else{svg.style.removeProperty('background');svg.style.removeProperty('--plugin-preview-text');}
    $('previewBg').value=previewBg||rgbHex(getComputedStyle(svg).backgroundColor);
    if(job)draw();
  }
  function draw(){
    window.Dropdowns?.refresh();
    const svg=$('preview');svg.replaceChildren();if(!job){el('text',{x:50,y:50,'text-anchor':'middle','font-size':5},svg).textContent='Import SVG or DXF to preview toolpaths';return;}
    const b=SvgCam.bounds([...job.paths.flatMap(p=>p.points),...(job.knife?[{x:job.knife.bounds.minX,y:job.knife.bounds.minY},{x:job.knife.bounds.maxX,y:job.knife.bounds.maxY}]:[]),{x:0,y:0}]),size=Math.max(b.maxX-b.minX,b.maxY-b.minY,1),pad=size*.08;
    fitBox={x:b.minX-pad,y:-b.maxY-pad,w:Math.max(b.maxX-b.minX,1)+2*pad,h:Math.max(b.maxY-b.minY,1)+2*pad};
    if(!viewBox)viewBox={...fitBox};applyView();
    const defs=el('defs',{},svg),marker=el('marker',{id:'arrow',viewBox:'0 0 10 10',refX:8,refY:5,markerWidth:5,markerHeight:5,orient:'auto'},defs);
    el('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'var(--plugin-mark)'},marker);
    const holderLayer=el('g',{'data-layer':'holder'},svg),cutLayer=el('g',{'data-layer':'cut'},svg);
    let prev={x:0,y:0};
    job.paths.forEach((p,i)=>{
      if(p.fill){
        el('polyline',{points:p.points.map(q=>q.x+','+(-q.y)).join(' '),fill:'none',stroke:penStyle(p).stroke,'stroke-width':1,'vector-effect':'non-scaling-stroke',opacity:.85},cutLayer);
        prev=p.points.at(-1);return;
      }
      const first=p.points[0];if(!job.knife)el('line',{x1:prev.x,y1:-prev.y,x2:first.x,y2:-first.y,stroke:'var(--plugin-travel)','stroke-width':1,'vector-effect':'non-scaling-stroke','stroke-dasharray':'4 4'},cutLayer);
      el('polyline',{points:p.points.map(q=>q.x+','+(-q.y)).join(' '),fill:'none',stroke:penStyle(p).halo,'stroke-width':p.id===$('selected').value?5:4,'vector-effect':'non-scaling-stroke'},cutLayer);
      el('polyline',{'data-cut-path':p.id,points:p.points.map(q=>q.x+','+(-q.y)).join(' '),fill:'none',stroke:p.id===$('selected').value?'var(--plugin-selected)':penStyle(p).stroke,'stroke-width':p.id===$('selected').value?3:2,'vector-effect':'non-scaling-stroke'},cutLayer);
      const last=p.points.at(-1);
      el('title',{},el('circle',{cx:last.x,cy:-last.y,r:size*.014,fill:'none',stroke:'var(--plugin-end)','stroke-width':2,'vector-effect':'non-scaling-stroke','data-marker':'end'},cutLayer)).textContent=`Path ${p.number} end`;
      el('title',{},el('circle',{cx:first.x,cy:-first.y,r:size*.008,fill:'var(--plugin-mark)','data-marker':'start'},cutLayer)).textContent=`Path ${p.number} start`;
      el('text',{x:first.x+size*.012,y:-first.y-size*.012,'font-size':size*.03},cutLayer).textContent=String(p.number);
      // A direction indicator spans enough distance to remain visible on sampled paths.
      let j=1;while(j<p.points.length-1&&SvgCam.dist(first,p.points[j])<size*.04)j++;
      el('line',{x1:first.x,y1:-first.y,x2:p.points[j].x,y2:-p.points[j].y,stroke:'var(--plugin-mark)','stroke-width':1,'vector-effect':'non-scaling-stroke','marker-end':'url(#arrow)'},cutLayer);
      prev=p.points.at(-1);
    });
    if(job.knife&&$('knifeOverlay').checked){
      let previous={x:0,y:0};
      for(const run of job.knife.runs){
        // Subsequent passes may have different entry arcs; show all actual runs.
        let group=[],kind=null;
        const flush=()=>{if(group.length>1)el('polyline',{points:group.map(q=>q.x+','+(-q.y)).join(' '),fill:'none',stroke:kind==='travel'?'var(--plugin-travel)':kind==='cut'?'var(--plugin-knife-cut)':'var(--plugin-knife-move)','stroke-width':run.id===$('selected').value?1.5:1,'vector-effect':'non-scaling-stroke','stroke-dasharray':kind==='cut'?'5 3':kind==='travel'?'4 4':'none','data-knife-move':kind,opacity:run.id===$('selected').value?.8:.55},holderLayer);};
        for(const m of run.moves){
          if(['lower','lift','retract'].includes(m.kind))continue;
          const next=m.kind==='travel'?'travel':['cut','transition'].includes(m.kind)?'cut':'swivel';
          if(next!==kind){flush();group=[previous];kind=next;}
          group.push(m);previous=m;
        }
        flush();
      }
    }
    el('path',{d:`M ${-pad/3} 0 H ${pad/3} M 0 ${-pad/3} V ${pad/3}`,stroke:'var(--plugin-cross)','stroke-width':2,'vector-effect':'non-scaling-stroke'},svg);
  }
  function update(){
    viewBox=null;invalidate();job=null;$('generate').disabled=true;pick=null;
    const o=settings();$('depthSettings').hidden=o.mode==='laser';$('laserSettings').hidden=o.mode!=='laser';
    $('knifeSettings').hidden=o.mode!=='knife';$('knifeOverlayControl').hidden=o.mode!=='knife';
    $('penChange').disabled=o.mode!=='plotter';$('penRows').querySelectorAll('input').forEach(i=>i.disabled=o.mode!=='plotter');$('fillRows').querySelectorAll('button').forEach(i=>i.disabled=o.mode!=='plotter');$('fillRandomAll').disabled=o.mode!=='plotter'||!fillPens.length;['fillAll','fillFirst','skipUnstroked'].forEach(k=>$(k).disabled=o.mode!=='plotter');
    $('tool').disabled=o.mode==='knife';$('power').disabled=o.mode==='knife';$('powerMax').disabled=o.mode==='knife';
    if(o.mode==='knife'){$('tool').value='none';o.tool='none';}
    $('knifeSwivelZ').disabled=!o.knifeAlign&&!o.knifeLift;$('knifeLead').disabled=!o.knifeAlign;$('knifeHeading').disabled=!o.knifeAlign;
    $('knifeHeadingHint').textContent=o.knifeAlign?`Before the FIRST pass, place the tip on the ${Number(o.knifeHeading)===0?'−X (left)':(Number(o.knifeHeading)+180)+'° CCW from +X'} side of the holder center. The setting describes the direction the holder would move with the blade trailing behind. Raised travel is assumed not to change blade direction; later entry turns use the previous cut direction.`:'Entry alignment is OFF: the holder moves directly to the compensated start at safe Z, then lowers and cuts. No entry arcs or lead-ins. This assumes the blade already trails the first segment at every pass; otherwise the beginning of the cut can wander. Corner swivels still apply.';
    try {
      const zs=SvgCam.depths(o);$('passes').textContent=`${zs.length} pass${zs.length===1?'':'es'} per path · Z: ${zs.length>8?zs.slice(0,3).join(', ')+', …, '+zs.at(-1):zs.map(v=>Number(v.toFixed(4))).join(', ')} mm`;
      if(!documentData){draw();return;}
      if(importDirty)throw Error('Click Reimport to apply import settings.');
      job=SvgCam.plan(documentData,o,locks,directions);$('generate').disabled=false;
      const selected=$('selected').value;
      $('selected').replaceChildren(...job.paths.filter(p=>!p.fill).map(p=>new Option(`Path ${p.number} - ${p.name}${p.closed?' (closed)':' (open)'}`,p.id)));
      if(job.paths.some(p=>p.id===selected&&!p.fill))$('selected').value=selected;
      const b=job.bounds;
      $('summary').textContent=`${job.paths.length-job.fills} paths${job.fills?` + ${job.fills} hatch lines`:''} · ${(b.maxX-b.minX).toFixed(2)} × ${(b.maxY-b.minY).toFixed(2)} mm · ${job.depths.length} passes/path · travel ${job.travel.toFixed(1)} mm`+(o.mode==='plotter'&&job.pens.length>1?` · ${job.pens.length} pens`:'')+(job.knife?` · ${job.knife.swivels} corner swivels · holder ${(job.knife.bounds.maxX-job.knife.bounds.minX).toFixed(2)} × ${(job.knife.bounds.maxY-job.knife.bounds.minY).toFixed(2)} mm`:'');
      message((job.fillOverlaps?`${job.fillOverlaps} pair(s) of filled shapes overlap; each is hatched in full (hidden-line removal is not implemented).\n`:'')+(job.knife?'Knife: Surface / Final / Step down control progressive Z passes. Inspect the entry-alignment setting and orange holder movements.\n':'')+documentData.warnings.join('\n')+'\nPreview starts from work X0 Y0 for ordering; actual initial machine position may differ.');draw();
    }catch(e){$('passes').textContent='Check settings';$('summary').textContent='Preview invalid — correct settings before generating.';$('preview').replaceChildren();message(e.message,true);}finally{window.Dropdowns?.refresh();}
  }
  async function importSvg(){
    const request=++loadId;importController?.abort();const controller=new AbortController();importController=controller;
    const source=svgText,format=fileFormat,options={...Object.fromEntries(importFields.map(k=>[k,Number($(k).value)])),joinEndpoints:$('joinEndpoints').checked,dxfUnits:$('dxfUnits').value},started=performance.now();
    busy('Opening '+format.toUpperCase()+'…');
    invalidate();job=null;documentData=null;locks={};directions={};$('generate').disabled=true;$('selected').replaceChildren();renderPens();
    for(const id of ['pickStart','pickOrigin','clearStarts','pathDirection'])$(id).disabled=true;
    try{
      const imported=await (format==='dxf'?DxfImport:SvgImport).parseAsync(source,options,{signal:controller.signal,onProgress:p=>{if(request===loadId)busy(p.stage+(p.total?' · path '+p.path+' / '+p.total:''),p.fraction);}});
      if(request!==loadId)return;
      documentData=imported;
      importDirty=false;
      {const before=penAssign;assignDefaults(false);for(const c of Object.keys(penAssign))if(Object.hasOwn(before,c))penAssign[c]=before[c];}
      renderPens();
      for(const p of documentData.paths){const op=document.createElement('option');op.value=p.id;op.textContent=`Path ${documentData.paths.indexOf(p)+1} - `+p.name+(p.closed?' (closed)':' (open)');$('selected').append(op);}
      for(const id of ['pickStart','pickOrigin','clearStarts','pathDirection'])$(id).disabled=false;
      $('pathDirection').value='auto';busy('Building preview…',1);await new Promise(resolve=>setTimeout(resolve,0));if(request!==loadId)return;update();
      if(job)$('summary').textContent+=' · loaded in '+((performance.now()-started)/1000).toFixed(2)+' s';
    }catch(e){if(request!==loadId||e.name==='AbortError')return;$('preview').replaceChildren();$('summary').textContent='Import failed';message(e.message,true);}
    finally{if(request===loadId){importController=null;endBusy();}}
  }
  $('file').addEventListener('change',async()=>{
    const file=$('file').files[0];if(!file)return;cancelImport();const request=++loadId;busy('Reading '+file.name+'…');
    invalidate();documentData=null;job=null;$('generate').disabled=true;$('reimport').disabled=true;$('preview').replaceChildren();
    if(file.size>5000000){endBusy();message('File exceeds 5 MB.',true);return;}
    try{const text=await file.text();if(request!==loadId)return;fileFormat=/\.dxf$/i.test(file.name)?'dxf':'svg';svgText=text;$('dxfControls').hidden=fileFormat!=='dxf';$('dpi').disabled=fileFormat==='dxf';$('reimport').disabled=false;importSvg();}catch(e){if(request===loadId){endBusy();invalidate();message(e.message,true);}}
  });
  $('penPerColor').onclick=()=>{assignDefaults(false);renderPens();update();};
  $('penAllOne').onclick=()=>{assignDefaults(true);renderPens();update();};
  $('reimport').onclick=importSvg;
  $('reimportDxf').onclick=importSvg;
  function svgExample(){fileFormat='svg';$('dxfControls').hidden=true;$('dpi').disabled=false;}
  $('example').onclick=()=>{
    svgExample();loadId++;
    svgText='<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="60mm" viewBox="0 0 80 60"><rect id="outer" x="5" y="5" width="70" height="50" rx="4"/><circle id="hole" cx="20" cy="20" r="6"/><path id="wave" d="M32 20 C40 5 55 35 65 18 M15 42 Q40 22 65 42"/></svg>';
    $('file').value='';$('reimport').disabled=false;importSvg();
  };
  [...importFields,'dxfUnits','joinEndpoints'].forEach(id=>$(id).addEventListener('input',()=>{if(id==='joinEndpoints')syncEndpointJoinControl();cancelImport();importDirty=true;invalidate();job=null;$('generate').disabled=true;message('Click Reimport to apply import settings.');}));
  [...numeric,...knifeNumeric,...choices,'inner','largest','reverse','knifeAlign','knifeLift','fillAll','fillFirst','skipUnstroked'].forEach(id=>$(id).addEventListener('input',()=>{
    if(id==='mode')$('tool').value=$('mode').value==='laser'?'M4':'none';if(id==='fillAll')renderFills();update();
  }));
  $('knifeOverlay').onchange=draw;
  async function saveBackground(){
    if(window.parent===window)return;
    try{const data={...stored,previewBg};await host('saveSettings',{data});stored=data;}catch{}
  }
  $('previewBg').addEventListener('input',()=>{applyBackground($('previewBg').value);saveBackground();});
  $('previewBgReset').onclick=()=>{applyBackground(null);saveBackground();};
  $('knifeCalibration').onclick=()=>{
    svgExample();loadId++;svgText='<svg xmlns="http://www.w3.org/2000/svg" width="90mm" height="55mm" viewBox="0 0 90 55"><path id="square" d="M10 10 H30 V30 H10 Z"/><circle id="circle" cx="48" cy="20" r="10"/><path id="triangle" d="M65 30 L75 10 L85 30 Z"/><path id="open-line" d="M10 45 H30"/></svg>';
    $('file').value='';$('reimport').disabled=false;importSvg();
  };
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&pick){setPick(null);message('Point picking canceled.');}});
  $('selected').onchange=()=>{setPick(null);$('pathDirection').value=directions[$('selected').value]===undefined?'auto':directions[$('selected').value]?'reverse':'forward';draw();};
  $('pathDirection').onchange=()=>{
    const id=$('selected').value,v=$('pathDirection').value;
    if(v==='auto')delete directions[id];else directions[id]=v==='reverse';
    if(documentData.paths.find(p=>p.id===id)?.closed===false)delete locks[id];
    update();
  };
  $('pickStart').onclick=()=>{if(!job)return;setPick('start');message('Tap near the selected path to lock its start (open paths snap to an endpoint).');$('preview').focus({preventScroll:true});};
  $('pickOrigin').onclick=()=>{if(!job)return;setPick('origin');message('Tap the preview to place work X0 Y0.');$('preview').focus({preventScroll:true});};
  $('clearStarts').onclick=()=>{locks={};update();};
  $('preview').addEventListener('click',event=>{
    if(suppressClick){suppressClick=false;return;}
    if(!pick||!job)return;
    const matrix=$('preview').getScreenCTM();if(!matrix)return;
    const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()),q={x:p.x,y:-p.y};
    if(pick==='origin'){
      $('origin').value='custom';$('originX').value=(q.x+job.origin.x).toFixed(4);$('originY').value=(q.y+job.origin.y).toFixed(4);
    } else {
      const transformed=SvgCam.transform(documentData,settings()).paths.find(p=>p.id===$('selected').value);let best=Infinity,index=0;
      transformed.points.forEach((p,i)=>{if(!transformed.closed&&i!==0&&i!==transformed.points.length-1)return;const d=SvgCam.dist(p,q);if(d<best){best=d;index=i;}});locks[transformed.id]=index;
    }
    update();message('Selection applied. Manual starts: '+Object.keys(locks).length+'.');
  });
  $('generate').onclick=()=>{
    try{if(!job||importDirty)throw Error('Import and check the preview before generating.');const o=settings();
      if(o.mode==='plotter'&&o.penChange==='files'&&job.pens.length>1){
        generatedFiles=SvgCam.gcodeFiles(job,o);
        $('fileChoice').replaceChildren(...generatedFiles.map((f,i)=>new Option(f.label+' - '+f.paths+' path'+(f.paths===1?'':'s'),String(i))));
        $('fileChoice').value='0';$('fileChoiceLabel').hidden=false;code=generatedFiles[0].text;
        message(`Generated ${generatedFiles.length} files, one per pen. Choose a pen under Pen file, then Save As or Copy; repeat for each pen. Nothing has been sent.`);
      }else{
        generatedFiles=[];$('fileChoiceLabel').hidden=true;code=SvgCam.gcode(job,{...o,penChange:o.penChange==='files'?'none':o.penChange});
        message(`Generated ${code.split('\n').length-1} lines. Inspect the paths and machine Z reference before running. Nothing has been sent.`);
      }
      $('output').value=code;$('save').disabled=window.parent===window||savePending;$('copy').disabled=false;}
    catch(e){invalidate();message(e.message,true);}
  };

  $('fileChoice').onchange=()=>{const f=generatedFiles[Number($('fileChoice').value)];if(!f)return;code=f.text;$('output').value=code;message('Showing '+f.label+'. Save As and Copy use this file.');};

  function zoom(factor,anchor){
    if(!job||!viewBox)return;
    const scale=Math.max(1,Math.min(32,fitBox.w/viewBox.w*factor));
    const w=fitBox.w/scale,h=fitBox.h/scale;
    const q=anchor||{x:viewBox.x+viewBox.w/2,y:viewBox.y+viewBox.h/2};
    viewBox={x:q.x-(q.x-viewBox.x)*w/viewBox.w,y:q.y-(q.y-viewBox.y)*h/viewBox.h,w,h};applyView();
  }
  $('zoomIn').onclick=()=>zoom(1.4);
  $('zoomOut').onclick=()=>zoom(1/1.4);
  $('zoomFit').onclick=()=>{if(fitBox){viewBox={...fitBox};applyView();}};
  $('preview').addEventListener('wheel',event=>{
    if(!job)return;event.preventDefault();const matrix=$('preview').getScreenCTM();if(!matrix)return;
    zoom(Math.exp(-event.deltaY*.002),new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse()));
  },{passive:false});
  let pan=null,pinch=null,suppressClick=false;
  const pointers=new Map();
  function screenPoint(event,inverse){return new DOMPoint(event.clientX,event.clientY).matrixTransform(inverse);}
  function pointerPair(){return [...pointers.values()].slice(0,2);}
  $('preview').addEventListener('pointerdown',event=>{
    suppressClick=false;if(!job||pick||(event.pointerType==='mouse'&&event.button!==0))return;
    const matrix=$('preview').getScreenCTM();if(!matrix)return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    $('preview').setPointerCapture(event.pointerId);
    if(pointers.size===1){
      pan={id:event.pointerId,x:event.clientX,y:event.clientY,box:{...viewBox},inverse:matrix.inverse()};pinch=null;
    }else if(pointers.size===2){
      const [one,two]=pointerPair();
      pinch={start:{...viewBox},inverse:matrix.inverse(),center:{x:(one.x+two.x)/2,y:(one.y+two.y)/2},distance:Math.max(1,Math.hypot(one.x-two.x,one.y-two.y))};
      pan=null;suppressClick=true;
    }
  });
  $('preview').addEventListener('pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pinch){
      const [one,two]=pointerPair();if(!one||!two)return;
      const center={x:(one.x+two.x)/2,y:(one.y+two.y)/2};
      const distance=Math.max(1,Math.hypot(one.x-two.x,one.y-two.y));
      const q=screenPoint({clientX:pinch.center.x,clientY:pinch.center.y},pinch.inverse);
      const now=screenPoint({clientX:center.x,clientY:center.y},pinch.inverse);
      const scale=Math.max(1,Math.min(32,fitBox.w/pinch.start.w*distance/pinch.distance));
      const w=fitBox.w/scale,h=fitBox.h/scale;
      const x=q.x-(q.x-pinch.start.x)*w/pinch.start.w+q.x-now.x;
      const y=q.y-(q.y-pinch.start.y)*h/pinch.start.h+q.y-now.y;
      viewBox={x,y,w,h};suppressClick=true;applyView();return;
    }
    if(!pan||pan.id!==event.pointerId)return;
    const from=new DOMPoint(pan.x,pan.y).matrixTransform(pan.inverse),to=new DOMPoint(event.clientX,event.clientY).matrixTransform(pan.inverse);
    if(Math.hypot(event.clientX-pan.x,event.clientY-pan.y)>3)suppressClick=true;
    viewBox={...pan.box,x:pan.box.x+from.x-to.x,y:pan.box.y+from.y-to.y};applyView();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])$('preview').addEventListener(event,e=>{
    pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;if(!pointers.size)pan=null;
  });
  const divider=$('divider');let resizing=false,split=55;
  function setSplit(value){split=Math.max(25,Math.min(75,value));$('work').style.setProperty('--split',split+'%');divider.setAttribute('aria-valuenow',Math.round(split));}
  divider.addEventListener('pointerdown',event=>{if(event.button!==0)return;resizing=true;divider.setPointerCapture(event.pointerId);event.preventDefault();});
  divider.addEventListener('pointermove',event=>{if(!resizing)return;const r=$('work').getBoundingClientRect();setSplit((event.clientX-r.left)/r.width*100);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])divider.addEventListener(event,()=>{resizing=false;});
  divider.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
    setSplit(event.key==='Home'?25:event.key==='End'?75:split+(event.key==='ArrowLeft'?-2:2));
  });
  divider.ondblclick=()=>setSplit(55);

  // Host bridge for saving generated files and persistent presets.
  let requestId=0;const pending=new Map();
  window.addEventListener('message',event=>{
    if(event.source!==window.parent)return;
    if(event.data?.type==='fluid-response'){
      const p=pending.get(event.data.id);if(!p)return;pending.delete(event.data.id);event.data.error?p.reject(Error(event.data.error)):p.resolve(event.data.result);
    }else if(event.data?.type==='fluid-event'&&event.data.event==='theme'){
      applyTheme(event.data.data);
    }
  });
  function host(method,params={}){
    return new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});window.parent.postMessage({type:'fluid-request',id,method,params},'*');});
  }
  // Matches this window's colors to Dashboard's own current theme/accent
  // choice instead of the fixed dark palette in style.css's :root - falls
  // back to that palette untouched if getTheme() isn't available (an older
  // Dashboard) or the call fails for any other reason.
  function applyTheme(theme){
    if(!theme||!theme.colors)return;
    const root=document.documentElement.style;
    root.setProperty('--plugin-bg',theme.colors.background);
    root.setProperty('--plugin-surface',theme.colors.surface);
    root.setProperty('--plugin-surface-raised',theme.colors.surfaceRaised);
    root.setProperty('--plugin-border',theme.colors.border);
    root.setProperty('--plugin-border-strong',theme.colors.borderStrong);
    root.setProperty('--plugin-text',theme.colors.text);
    root.setProperty('--plugin-text-muted',theme.colors.textMuted);
    root.setProperty('--plugin-accent',theme.colors.accent);
    // Selects the light or dark set of the extra colors in style.css.
    document.documentElement.dataset.theme=theme.mode==='light'?'light':'dark';
  }
  if(window.parent!==window){
    host('getTheme').then(applyTheme).catch(()=>{});
    host('subscribe',{event:'theme'}).catch(()=>{});
  }
  let stored={},presets=[];
  const presetFields=[...numeric,...knifeNumeric,...choices,'knifeAlign','knifeLift','inner','largest','reverse','fillAll','fillFirst','skipUnstroked','joinEndpoints',...importFields,'dxfUnits'];
  const importState=()=>JSON.stringify([...importFields,'dxfUnits'].map(k=>$(k).value).concat($('joinEndpoints').checked));
  function presetList(){
    $('presets').replaceChildren(new Option('Choose a preset',''));
    presets.forEach((p,i)=>$('presets').append(new Option(p.name,String(i))));
  }
  async function persist(next){
    const data={...stored,plotterStudioPresets:next};
    await host('saveSettings',{data});stored=data;presets=next;presetList();
  }
  $('savePreset').onclick=async()=>{
    const name=$('presetName').value.trim();if(!name){message('Enter a preset name.',true);return;}
    const values={};presetFields.forEach(k=>values[k]=$(k).type==='checkbox'?$(k).checked:$(k).value);
    $('savePreset').disabled=true;
    try{const next=presets.filter(p=>p.name!==name);next.push({name,values});await persist(next);message('Preset saved: '+name);}
    catch(e){message('Could not save preset: '+e.message,true);}finally{$('savePreset').disabled=false;}
  };
  $('loadPreset').onclick=()=>{
    const preset=presets[Number($('presets').value)];if($('presets').value===''||!preset)return;
    const oldImport=importState();
    $('dxfUnits').value=preset.values.dxfUnits??'auto';
    for(const [k,v]of Object.entries({mergeDistance:.001,curveSegments:12,tolerance:.01,equalDistance:0,joinDistance:.01,outputTolerance:.01}))$(k).value=preset.values[k]??v;
    $('cleanup').value=Object.hasOwn(preset.values,'cleanup')?preset.values.cleanup:'0';
    if(preset.values.mode==='knife'){$('knifeAlign').checked=true;$('knifeLift').checked=true;knifeNumeric.forEach(k=>$(k).value=({knifeArcAngle:'10',knifeOffset:'0.45',knifePasses:'1',knifeAngle:'30',knifeFeed:'200',knifeLead:'0',knifeHeading:'0'})[k]??'');}
    presetFields.forEach(k=>{if(Object.hasOwn(preset.values,k)){if($(k).type==='checkbox')$(k).checked=!!preset.values[k];else $(k).value=preset.values[k];}});
    syncEndpointJoinControl();
    let migrated=false;
    if(preset.values.mode==='knife'&&Object.hasOwn(preset.values,'knifeCutZ')){
      const oldZ=String(preset.values.knifeCutZ).trim();
      if(oldZ!==''&&Number.isFinite(Number(oldZ))){$('surface').value=oldZ;$('final').value=oldZ;$('step').value='0.2';migrated=true;}
      else {$('surface').value='';$('final').value='';}
    }
    $('presetName').value=preset.name;
    if(svgText&&oldImport!==importState())importSvg();else update();
    message('Loaded preset: '+preset.name+(migrated?'. Previous fixed cut Z was kept as Surface and Final Z; repeats are preserved. Set Surface / Final / Step down for progressive passes.':''));
  };
  $('deletePreset').onclick=async()=>{
    if($('presets').value==='')return;const index=Number($('presets').value);
    $('deletePreset').disabled=true;
    try{await persist(presets.filter((_,i)=>i!==index));message('Preset deleted.');}catch(e){message(e.message,true);}finally{$('deletePreset').disabled=false;}
  };
  if(window.parent!==window)host('getSettings').then(data=>{
    stored=data&&typeof data==='object'?data:{};
    if(typeof stored.previewBg==='string')applyBackground(stored.previewBg);
    presets=Array.isArray(stored.plotterStudioPresets)?stored.plotterStudioPresets.filter(p=>typeof p.name==='string'&&p.values&&typeof p.values==='object'):[];
    presetList();$('savePreset').disabled=false;
  }).catch(e=>message('Could not load presets: '+e.message,true));
  $('save').onclick=async()=>{
    if(!code||savePending)return;savePending=true;$('save').disabled=true;const generation=revision;
    try{await new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});window.parent.postMessage({type:'fluid-request',id,method:'saveGcodeAs',params:{content:code}},'*');});message('Saved and opened in Dashboard. The machine has not been started.');}
    catch(e){message(e.message,true);}finally{savePending=false;$('save').disabled=!code||generation!==revision;}
  };
  $('copy').onclick=async()=>{
    if(!code)return;
    // The async Clipboard API is the one that actually works from inside this
    // plugin's sandboxed iframe (needs the host's allow="clipboard-write" on
    // the iframe - see PluginWindow.tsx); execCommand below is the fallback
    // for an older dashboard build that doesn't set that yet.
    try{await navigator.clipboard.writeText(code);message('G-code copied.');return;}catch{}
    $('output').focus();$('output').select();
    try{if(!document.execCommand('copy'))throw Error();message('G-code copied.');}catch{message('G-code selected. Use your device’s Copy command.');}
  };
  syncEndpointJoinControl();applyBackground(null);update();
})();
