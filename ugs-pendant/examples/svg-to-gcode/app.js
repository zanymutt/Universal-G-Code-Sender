(function(){
  'use strict';
  const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
  const importFields=['dpi','spacing','cleanup','curveSegments','tolerance','equalDistance','mergeDistance'];
  const numeric=['outputTolerance','feed','plunge','safe','surface','final','step','focus','laserPasses','power','powerMax','scale','rotation','overlap','originX','originY'];
  const knifeNumeric=['knifeArcAngle','knifeOffset','knifeSwivelZ','knifePasses','knifeAngle','knifeFeed','knifeLead','knifeHeading'];
  const choices=['mode','tool','origin','originBounds','order','start'];
  const tabs=[...document.querySelectorAll('[role=tab]')];
  function showTab(tab){tabs.forEach(t=>{const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;$(t.getAttribute('aria-controls')).hidden=!active;});window.Dropdowns?.refresh();}
  tabs.forEach((tab,i)=>{tab.onclick=()=>showTab(tab);tab.onkeydown=e=>{let index;if(e.key==='ArrowRight')index=(i+1)%tabs.length;else if(e.key==='ArrowLeft')index=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')index=0;else if(e.key==='End')index=tabs.length-1;else return;e.preventDefault();showTab(tabs[index]);tabs[index].focus({preventScroll:true});};});
  let documentData=null,svgText='',locks={},directions={},job=null,code='',pick=null,savePending=false,revision=0,importDirty=false,loadId=0;
  let importController=null;
  function busy(text,fraction){$('busy').hidden=false;$('busyText').textContent=text;document.querySelector('main').setAttribute('aria-busy','true');if(Number.isFinite(fraction))$('busyProgress').value=Math.max(0,Math.min(1,fraction));else $('busyProgress').removeAttribute('value');}
  function endBusy(){$('busy').hidden=true;document.querySelector('main').setAttribute('aria-busy','false');}
  function cancelImport(){loadId++;importController?.abort();importController=null;endBusy();}
  $('cancelWork').onclick=()=>{cancelImport();invalidate();documentData=null;job=null;importDirty=true;$('generate').disabled=true;$('summary').textContent='Import canceled';message('Import canceled. Choose another SVG or click Reimport.');};
  function settings(){const o={};numeric.forEach(k=>o[k]=$(k).value.trim()===''?NaN:Number($(k).value));choices.forEach(k=>o[k]=$(k).value);knifeNumeric.forEach(k=>o[k]=$(k).value.trim()===''?NaN:Number($(k).value));['inner','largest','reverse','knifeAlign','knifeLift'].forEach(k=>o[k]=$(k).checked);o.spacing=Number($('spacing').value);return o;}
  function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
  $('preview').setAttribute('tabindex','-1');
  function setPick(value){pick=value;$('preview').classList.toggle('picking',!!value);}
  function invalidate(){setPick(null);revision++;code='';$('output').value='';$('save').disabled=true;$('copy').disabled=true;}
  function el(tag,attrs,parent){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent.append(n);return n;}
  let fitBox=null,viewBox=null;
  function applyView(){if(viewBox)$('preview').setAttribute('viewBox',`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);$('zoomLevel').textContent=fitBox&&viewBox?Math.round(fitBox.w/viewBox.w*100)+'%':'100%';}
  function draw(){
    window.Dropdowns?.refresh();
    const svg=$('preview');svg.replaceChildren();if(!job){el('text',{x:50,y:50,'text-anchor':'middle','font-size':5},svg).textContent='Import an SVG to preview toolpaths';return;}
    const b=SvgCam.bounds([...job.paths.flatMap(p=>p.points),...(job.knife?[{x:job.knife.bounds.minX,y:job.knife.bounds.minY},{x:job.knife.bounds.maxX,y:job.knife.bounds.maxY}]:[]),{x:0,y:0}]),size=Math.max(b.maxX-b.minX,b.maxY-b.minY,1),pad=size*.08;
    fitBox={x:b.minX-pad,y:-b.maxY-pad,w:Math.max(b.maxX-b.minX,1)+2*pad,h:Math.max(b.maxY-b.minY,1)+2*pad};
    if(!viewBox)viewBox={...fitBox};applyView();
    const defs=el('defs',{},svg),marker=el('marker',{id:'arrow',viewBox:'0 0 10 10',refX:8,refY:5,markerWidth:5,markerHeight:5,orient:'auto'},defs);
    el('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#ffbf69'},marker);
    const holderLayer=el('g',{'data-layer':'holder'},svg),cutLayer=el('g',{'data-layer':'cut'},svg);
    let prev={x:0,y:0};
    job.paths.forEach((p,i)=>{
      const first=p.points[0];if(!job.knife)el('line',{x1:prev.x,y1:-prev.y,x2:first.x,y2:-first.y,stroke:'#718196','stroke-width':1,'vector-effect':'non-scaling-stroke','stroke-dasharray':'4 4'},cutLayer);
      el('polyline',{points:p.points.map(q=>q.x+','+(-q.y)).join(' '),fill:'none',stroke:'#101619','stroke-width':p.id===$('selected').value?5:4,'vector-effect':'non-scaling-stroke'},cutLayer);
      el('polyline',{'data-cut-path':p.id,points:p.points.map(q=>q.x+','+(-q.y)).join(' '),fill:'none',stroke:p.id===$('selected').value?'#6ce1f3':'#91cf9e','stroke-width':p.id===$('selected').value?3:2,'vector-effect':'non-scaling-stroke'},cutLayer);
      const last=p.points.at(-1);
      el('title',{},el('circle',{cx:last.x,cy:-last.y,r:size*.014,fill:'none',stroke:'#d99bff','stroke-width':2,'vector-effect':'non-scaling-stroke','data-marker':'end'},cutLayer)).textContent=`Path ${p.number} end`;
      el('title',{},el('circle',{cx:first.x,cy:-first.y,r:size*.008,fill:'#ffbf69','data-marker':'start'},cutLayer)).textContent=`Path ${p.number} start`;
      el('text',{x:first.x+size*.012,y:-first.y-size*.012,'font-size':size*.03},cutLayer).textContent=String(p.number);
      // A direction indicator spans enough distance to remain visible on sampled paths.
      let j=1;while(j<p.points.length-1&&SvgCam.dist(first,p.points[j])<size*.04)j++;
      el('line',{x1:first.x,y1:-first.y,x2:p.points[j].x,y2:-p.points[j].y,stroke:'#ffbf69','stroke-width':1,'vector-effect':'non-scaling-stroke','marker-end':'url(#arrow)'},cutLayer);
      prev=p.points.at(-1);
    });
    if(job.knife&&$('knifeOverlay').checked){
      let previous={x:0,y:0};
      for(const run of job.knife.runs){
        // Subsequent passes may have different entry arcs; show all actual runs.
        let group=[],kind=null;
        const flush=()=>{if(group.length>1)el('polyline',{points:group.map(q=>q.x+','+(-q.y)).join(' '),fill:'none',stroke:kind==='travel'?'#718196':kind==='cut'?'#64a9ff':'#ffa85c','stroke-width':run.id===$('selected').value?1.5:1,'vector-effect':'non-scaling-stroke','stroke-dasharray':kind==='cut'?'5 3':kind==='travel'?'4 4':'none','data-knife-move':kind,opacity:run.id===$('selected').value?.8:.55},holderLayer);};
        for(const m of run.moves){
          if(['lower','lift','retract'].includes(m.kind))continue;
          const next=m.kind==='travel'?'travel':['cut','transition'].includes(m.kind)?'cut':'swivel';
          if(next!==kind){flush();group=[previous];kind=next;}
          group.push(m);previous=m;
        }
        flush();
      }
    }
    el('path',{d:`M ${-pad/3} 0 H ${pad/3} M 0 ${-pad/3} V ${pad/3}`,stroke:'#ff7272','stroke-width':2,'vector-effect':'non-scaling-stroke'},svg);
  }
  function update(){
    viewBox=null;invalidate();job=null;$('generate').disabled=true;pick=null;
    const o=settings();$('depthSettings').hidden=o.mode==='laser';$('laserSettings').hidden=o.mode!=='laser';
    $('knifeSettings').hidden=o.mode!=='knife';$('knifeOverlayControl').hidden=o.mode!=='knife';
    $('tool').disabled=o.mode==='knife';$('power').disabled=o.mode==='knife';$('powerMax').disabled=o.mode==='knife';
    if(o.mode==='knife'){$('tool').value='none';o.tool='none';}
    $('knifeSwivelZ').disabled=!o.knifeAlign&&!o.knifeLift;$('knifeLead').disabled=!o.knifeAlign;$('knifeHeading').disabled=!o.knifeAlign;
    $('knifeHeadingHint').textContent=o.knifeAlign?`Before the FIRST pass, place the tip on the ${Number(o.knifeHeading)===0?'−X (left)':(Number(o.knifeHeading)+180)+'° CCW from +X'} side of the holder center. The setting describes the direction the holder would move with the blade trailing behind. Raised travel is assumed not to change blade direction; later entry turns use the previous cut direction.`:'Entry alignment is OFF: the holder moves directly to the compensated start at safe Z, then lowers and cuts. No entry arcs or lead-ins. This assumes the blade already trails the first segment at every pass; otherwise the beginning of the cut can wander. Corner swivels still apply.';
    try {
      const zs=SvgCam.depths(o);$('passes').textContent=`${zs.length} pass${zs.length===1?'':'es'} per path · Z: ${zs.length>8?zs.slice(0,3).join(', ')+', …, '+zs.at(-1):zs.map(v=>Number(v.toFixed(4))).join(', ')} mm`;
      if(!documentData){draw();return;}
      if(importDirty)throw Error('Click Reimport to apply SVG import settings.');
      job=SvgCam.plan(documentData,o,locks,directions);$('generate').disabled=false;
      const selected=$('selected').value;
      $('selected').replaceChildren(...job.paths.map(p=>new Option(`Path ${p.number} - ${p.name}${p.closed?' (closed)':' (open)'}`,p.id)));
      if(job.paths.some(p=>p.id===selected))$('selected').value=selected;
      const b=job.bounds;
      $('summary').textContent=`${job.paths.length} paths · ${(b.maxX-b.minX).toFixed(2)} × ${(b.maxY-b.minY).toFixed(2)} mm · ${job.depths.length} passes/path · travel ${job.travel.toFixed(1)} mm`+(job.knife?` · ${job.knife.swivels} corner swivels · holder ${(job.knife.bounds.maxX-job.knife.bounds.minX).toFixed(2)} × ${(job.knife.bounds.maxY-job.knife.bounds.minY).toFixed(2)} mm`:'');
      message((job.knife?'Knife: Surface / Final / Step down control progressive Z passes. Inspect the entry-alignment setting and orange holder movements.\n':'')+documentData.warnings.join('\n')+'\nPreview starts from work X0 Y0 for ordering; actual initial machine position may differ.');draw();
    }catch(e){$('passes').textContent='Check settings';$('summary').textContent='Preview invalid — correct settings before generating.';$('preview').replaceChildren();message(e.message,true);}finally{window.Dropdowns?.refresh();}
  }
  async function importSvg(){
    const request=++loadId;importController?.abort();const controller=new AbortController();importController=controller;
    const source=svgText,options=Object.fromEntries(importFields.map(k=>[k,Number($(k).value)])),started=performance.now();
    busy('Opening SVG…');
    invalidate();job=null;documentData=null;locks={};directions={};$('generate').disabled=true;$('selected').replaceChildren();
    for(const id of ['pickStart','pickOrigin','clearStarts','pathDirection'])$(id).disabled=true;
    try{
      const imported=await SvgImport.parseAsync(source,options,{signal:controller.signal,onProgress:p=>{if(request===loadId)busy(p.stage+(p.total?' · path '+p.path+' / '+p.total:''),p.fraction);}});
      if(request!==loadId)return;
      documentData=imported;
      importDirty=false;
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
    if(file.size>5000000){endBusy();message('SVG exceeds 5 MB.',true);return;}
    try{const text=await file.text();if(request!==loadId)return;svgText=text;$('reimport').disabled=false;importSvg();}catch(e){if(request===loadId){endBusy();invalidate();message(e.message,true);}}
  });
  $('reimport').onclick=importSvg;
  $('example').onclick=()=>{
    loadId++;
    svgText='<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="60mm" viewBox="0 0 80 60"><rect id="outer" x="5" y="5" width="70" height="50" rx="4"/><circle id="hole" cx="20" cy="20" r="6"/><path id="wave" d="M32 20 C40 5 55 35 65 18 M15 42 Q40 22 65 42"/></svg>';
    $('file').value='';$('reimport').disabled=false;importSvg();
  };
  importFields.forEach(id=>$(id).addEventListener('input',()=>{cancelImport();importDirty=true;invalidate();job=null;$('generate').disabled=true;message('Click Reimport to apply SVG import settings.');}));
  [...numeric,...knifeNumeric,...choices,'inner','largest','reverse','knifeAlign','knifeLift'].forEach(id=>$(id).addEventListener('input',()=>{
    if(id==='mode')$('tool').value=$('mode').value==='laser'?'M4':'none';update();
  }));
  $('knifeOverlay').onchange=draw;
  $('knifeCalibration').onclick=()=>{
    loadId++;svgText='<svg xmlns="http://www.w3.org/2000/svg" width="90mm" height="55mm" viewBox="0 0 90 55"><path id="square" d="M10 10 H30 V30 H10 Z"/><circle id="circle" cx="48" cy="20" r="10"/><path id="triangle" d="M65 30 L75 10 L85 30 Z"/><path id="open-line" d="M10 45 H30"/></svg>';
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
    try{if(!job||importDirty)throw Error('Import and check the preview before generating.');const o=settings();code=SvgCam.gcode(job,o);$('output').value=code;$('save').disabled=window.parent===window||savePending;$('copy').disabled=false;message(`Generated ${code.split('\n').length-1} lines. Inspect the paths and machine Z reference before running. Nothing has been sent.`);}
    catch(e){invalidate();message(e.message,true);}
  };

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
  let pan=null,suppressClick=false;
  $('preview').addEventListener('pointerdown',event=>{
    suppressClick=false;if(!job||pick||event.button!==0)return;
    const matrix=$('preview').getScreenCTM();if(!matrix)return;
    pan={id:event.pointerId,x:event.clientX,y:event.clientY,box:{...viewBox},inverse:matrix.inverse()};
    $('preview').setPointerCapture(event.pointerId);
  });
  $('preview').addEventListener('pointermove',event=>{
    if(!pan||pan.id!==event.pointerId)return;
    const from=new DOMPoint(pan.x,pan.y).matrixTransform(pan.inverse),to=new DOMPoint(event.clientX,event.clientY).matrixTransform(pan.inverse);
    if(Math.hypot(event.clientX-pan.x,event.clientY-pan.y)>3)suppressClick=true;
    viewBox={...pan.box,x:pan.box.x+from.x-to.x,y:pan.box.y+from.y-to.y};applyView();
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])$('preview').addEventListener(event,()=>{pan=null;});
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
    if(event.source!==window.parent||event.data?.type!=='fluid-response')return;
    const p=pending.get(event.data.id);if(!p)return;pending.delete(event.data.id);event.data.error?p.reject(Error(event.data.error)):p.resolve(event.data.result);
  });
  function host(method,params={}){
    return new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});window.parent.postMessage({type:'fluid-request',id,method,params},'*');});
  }
  let stored={},presets=[];
  const presetFields=[...numeric,...knifeNumeric,...choices,'knifeAlign','knifeLift','inner','largest','reverse',...importFields];
  function presetList(){
    $('presets').replaceChildren(new Option('Choose a preset',''));
    presets.forEach((p,i)=>$('presets').append(new Option(p.name,String(i))));
  }
  async function persist(next){
    const data={...stored,svgCamPresets:next};
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
    const oldImport=JSON.stringify(importFields.map(k=>$(k).value));
    for(const [k,v]of Object.entries({mergeDistance:.001,curveSegments:12,tolerance:.01,equalDistance:0,outputTolerance:.01}))$(k).value=preset.values[k]??v;
    $('cleanup').value=Object.hasOwn(preset.values,'cleanup')?preset.values.cleanup:'0';
    if(preset.values.mode==='knife'){$('knifeAlign').checked=true;$('knifeLift').checked=true;knifeNumeric.forEach(k=>$(k).value=({knifeArcAngle:'10',knifeOffset:'0.45',knifePasses:'1',knifeAngle:'30',knifeFeed:'200',knifeLead:'0',knifeHeading:'0'})[k]??'');}
    presetFields.forEach(k=>{if(Object.hasOwn(preset.values,k)){if($(k).type==='checkbox')$(k).checked=!!preset.values[k];else $(k).value=preset.values[k];}});
    let migrated=false;
    if(preset.values.mode==='knife'&&Object.hasOwn(preset.values,'knifeCutZ')){
      const oldZ=String(preset.values.knifeCutZ).trim();
      if(oldZ!==''&&Number.isFinite(Number(oldZ))){$('surface').value=oldZ;$('final').value=oldZ;$('step').value='0.2';migrated=true;}
      else {$('surface').value='';$('final').value='';}
    }
    $('presetName').value=preset.name;
    if(svgText&&oldImport!==JSON.stringify(importFields.map(k=>$(k).value)))importSvg();else update();
    message('Loaded preset: '+preset.name+(migrated?'. Previous fixed cut Z was kept as Surface and Final Z; repeats are preserved. Set Surface / Final / Step down for progressive passes.':''));
  };
  $('deletePreset').onclick=async()=>{
    if($('presets').value==='')return;const index=Number($('presets').value);
    $('deletePreset').disabled=true;
    try{await persist(presets.filter((_,i)=>i!==index));message('Preset deleted.');}catch(e){message(e.message,true);}finally{$('deletePreset').disabled=false;}
  };
  if(window.parent!==window)host('getSettings').then(data=>{
    stored=data&&typeof data==='object'?data:{};
    presets=Array.isArray(stored.svgCamPresets)?stored.svgCamPresets.filter(p=>typeof p.name==='string'&&p.values&&typeof p.values==='object'):[];
    presetList();$('savePreset').disabled=false;
  }).catch(e=>message('Could not load presets: '+e.message,true));
  $('save').onclick=async()=>{
    if(!code||savePending)return;savePending=true;$('save').disabled=true;const generation=revision;
    try{await new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});window.parent.postMessage({type:'fluid-request',id,method:'saveGcodeAs',params:{content:code}},'*');});message('Saved and opened in Dashboard. The machine has not been started.');}
    catch(e){message(e.message,true);}finally{savePending=false;$('save').disabled=!code||generation!==revision;}
  };
  $('copy').onclick=()=>{
    $('output').focus();$('output').select();
    try{if(!document.execCommand('copy'))throw Error();message('G-code copied.');}catch{message('G-code selected. Use your device’s Copy command.');}
  };
  update();
})();
