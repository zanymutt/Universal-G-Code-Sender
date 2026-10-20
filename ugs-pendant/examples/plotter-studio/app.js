(function(){
  'use strict';
  const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
  const importFields=['dpi','spacing','cleanup','curveSegments','tolerance','equalDistance','mergeDistance','joinDistance'];
  const numeric=['approach','borderInset','dedupeTol','penWidth','outputTolerance','feed','plunge','safe','surface','final','step','focus','laserPasses','power','powerMax','scale','rotation','overlap','originX','originY'];
  const knifeNumeric=['knifeArcAngle','knifeOffset','knifeSwivelZ','knifePasses','knifeAngle','knifeFeed','knifeLead','knifeHeading'];
  const choices=['mode','tool','origin','originBounds','order','start','penChange','penOrder','fillSource','dedupeKeep','borders'];
  const tabs=[...document.querySelectorAll('[role=tab]')];
  function showTab(tab){tabs.forEach(t=>{const active=t===tab;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;$(t.getAttribute('aria-controls')).hidden=!active;});window.Dropdowns?.refresh();}
  tabs.forEach((tab,i)=>{tab.onclick=()=>showTab(tab);tab.onkeydown=e=>{let index;if(e.key==='ArrowRight')index=(i+1)%tabs.length;else if(e.key==='ArrowLeft')index=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')index=0;else if(e.key==='End')index=tabs.length-1;else return;e.preventDefault();showTab(tabs[index]);tabs[index].focus({preventScroll:true});};});
  let documentData=null,svgText='',fileFormat='svg',locks={},directions={},job=null,code='',pick=null,savePending=false,revision=0,importDirty=false,loadId=0;
  let importController=null;
  // color -> pen number (0 = skip). Kept across reimports for colors that still exist.
  let penAssign={},penMemory={},penColors={},penWidths={},penThickness={},fillSettings={},generatedFiles=[],previewBg=null;
  function busy(text,fraction){$('busy').hidden=false;$('busyText').textContent=text;document.querySelector('main').setAttribute('aria-busy','true');if(Number.isFinite(fraction))$('busyProgress').value=Math.max(0,Math.min(1,fraction));else $('busyProgress').removeAttribute('value');}
  function endBusy(){$('busy').hidden=true;document.querySelector('main').setAttribute('aria-busy','false');}
  function cancelImport(){loadId++;importController?.abort();importController=null;endBusy();}
  function syncEndpointJoinControl(){$('joinDistance').disabled=!$('joinEndpoints').checked;}
  $('cancelWork').onclick=()=>{cancelImport();invalidate();documentData=null;job=null;importDirty=true;$('generate').disabled=true;$('summary').textContent='Import canceled';message('Import canceled. Choose another SVG or DXF or click Reimport.');};
  function settings(){const o={};numeric.forEach(k=>o[k]=$(k).value.trim()===''?NaN:Number($(k).value));choices.forEach(k=>o[k]=$(k).value);knifeNumeric.forEach(k=>o[k]=$(k).value.trim()===''?NaN:Number($(k).value));['inner','largest','reverse','knifeAlign','knifeLift','fillFirst','skipUnstroked','hideCovered'].forEach(k=>o[k]=$(k).checked);o.fillAll=o.fillSource==='all';o.spacing=Number($('spacing').value);o.penMap={...penAssign};o.penColors={...penColors};o.penWidths=Object.fromEntries(Object.entries(penWidths).filter(([,v])=>v>0));o.penThickness={...penThickness};o.fills=Object.fromEntries(Object.entries(fillSettings).map(([pen,f])=>[pen,{mode:({lines:'hatch',cross:'cross',wavy:'wavy',wavycross:'wavycross'})[f.pattern]||'none',angle:f.angle,spacing:f.spacing,gap:f.gap,amp:f.amp,wavelength:f.wavelength,shift:f.shift,zigzag:f.zigzag}]));return o;}
  function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
  $('preview').setAttribute('tabindex','-1');
  function setPick(value){pick=value;$('preview').classList.toggle('picking',!!value);}
  function invalidate(){setPick(null);revision++;code='';generatedFiles=[];$('fileChoiceLabel').hidden=true;$('output').value='';$('save').disabled=true;$('copy').disabled=true;}
  function el(tag,attrs,parent){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent.append(n);return n;}
  let fitBox=null,viewBox=null;
  function applyView(){if(viewBox)$('preview').setAttribute('viewBox',`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);$('zoomLevel').textContent=fitBox&&viewBox?Math.round(fitBox.w/viewBox.w*100)+'%':'100%';}
  function colorList(){
    const counts=new Map(),entry=c=>{if(!counts.has(c))counts.set(c,{paths:0,fills:0,closed:0});return counts.get(c);};
    for(const p of documentData?.paths||[]){const e=entry(p.color||'#000000');e.paths++;if(p.closed)e.closed++;if(p.closed&&p.fillColor)entry(p.fillColor).fills++;}
    return [...counts].map(([c,n])=>[c,n.paths,n.fills,n.closed]);
  }
  function assignDefaults(onePen){
    penAssign={};colorList().forEach(([c],i)=>{penAssign[c]=onePen?1:i+1;});
  }
  function renderPens(){
    const list=colorList(),rows=$('penRows');rows.replaceChildren();
    $('penTable').hidden=!list.length;$('penPerColor').disabled=!list.length;$('penAllOne').disabled=!list.length;$('penCluster').disabled=list.length<2;$('penSkipWhite').disabled=!list.length;$('penPlotAll').disabled=!list.length;$('penCount').max=String(Math.max(1,list.length));
    $('penNote').textContent=list.length?(list.length+' color'+(list.length===1?'':'s')+' found. Untick a color to leave it out of the plot. Pens apply in plotter mode.'):'Import artwork to list its colors.';
    list.forEach(([color,count,fills])=>{
      const tr=document.createElement('tr'),swatch=document.createElement('input');swatch.type='color';swatch.value=penColors[color]||color;swatch.setAttribute('aria-label','Display color for '+color);
      // 'change' fires when the picker is closed; 'input' fires on every drag step and would redraw the whole job each time.
      swatch.addEventListener('change',()=>{penColors[color]=swatch.value;if($('penOrder').value==='light'||$('penOrder').value==='dark')update();else draw();});
      // The box turns a color off entirely (pen 0) and remembers its pen for turning it back on.
      const plot=document.createElement('input');plot.type='checkbox';plot.checked=penAssign[color]>0;plot.disabled=$('mode').value!=='plotter';
      plot.setAttribute('aria-label','Plot '+color+' (untick to skip this color)');
      plot.addEventListener('change',()=>{
        if(plot.checked)penAssign[color]=penMemory[color]>0?penMemory[color]:1;
        else{if(penAssign[color]>0)penMemory[color]=penAssign[color];penAssign[color]=0;}
        renderPens();updateSoon();
      });
      tr.className=penAssign[color]>0?'':'skipped';
      const c1=document.createElement('td');c1.append(plot,swatch,document.createTextNode(color));
      const c2=document.createElement('td');c2.textContent=String(count)+(fills?' · '+fills+' fill'+(fills===1?'':'s'):'');
      const input=document.createElement('input');input.type='number';input.min='0';input.max='99';input.step='1';input.value=String(penAssign[color]??1);input.setAttribute('aria-label','Pen for '+color+' (0 skips)');
      input.disabled=$('mode').value!=='plotter';
      input.addEventListener('input',()=>{
        penAssign[color]=input.value.trim()===''?NaN:Number(input.value);if(penAssign[color]>0)penMemory[color]=penAssign[color];
        plot.checked=penAssign[color]>0;tr.className=penAssign[color]>0?'':'skipped';
        renderFills();renderPenSizes();updateSoon();
      });
      const c3=document.createElement('td');c3.append(input);
      tr.append(c1,c2,c3);rows.append(tr);
    });
    renderFills();renderPenSizes();
  }
  // One row per pen in use: its own width and an optional line thickness (outlines drawn as a band).
  let penWidthSaveTimer=null;
  function savePenWidths(){
    clearTimeout(penWidthSaveTimer);
    penWidthSaveTimer=setTimeout(()=>saveStored({plotterStudioPenWidths:Object.fromEntries(Object.entries(penWidths).filter(([,v])=>v>0))}).catch(()=>{}),500);
  }
  function renderPenSizes(){
    const rows=$('penSizeRows');rows.replaceChildren();
    const pens=[...new Set(Object.values(penAssign).filter(v=>v>0))].sort((a,b)=>a-b);
    $('penSizeTable').hidden=!pens.length;
    for(const pen of pens){
      const tr=document.createElement('tr'),cell=node=>{const td=document.createElement('td');td.append(node);tr.append(td);};
      cell(document.createTextNode(String(pen)));
      const width=document.createElement('input');width.type='number';width.min='0.05';width.step='0.05';width.placeholder=String(penWidthValue());width.value=penWidths[pen]>0?String(penWidths[pen]):'';
      width.setAttribute('aria-label','Width of pen '+pen+' in millimeters (blank uses the default)');width.disabled=$('mode').value!=='plotter';
      width.addEventListener('input',()=>{const v=width.value.trim()===''?0:Number(width.value);if(v>0)penWidths[pen]=v;else delete penWidths[pen];savePenWidths();updateSoon();updateDialogWarn();});
      cell(width);
      const thick=document.createElement('input');thick.type='number';thick.min='0';thick.step='0.1';thick.placeholder='0';thick.value=penThickness[pen]>0?String(penThickness[pen]):'';
      thick.setAttribute('aria-label','Line thickness for pen '+pen+' in millimeters (0 draws a single line)');thick.disabled=$('mode').value!=='plotter';
      thick.addEventListener('input',()=>{penThickness[pen]=thick.value.trim()===''?0:Number(thick.value);updateSoon();});
      cell(thick);
      rows.append(tr);
    }
  }
  // One row per pen that has something to fill; Edit opens the pattern dialog.
  const penWidthValue=()=>{const w=Number($('penWidth').value);return Number.isFinite(w)&&w>0?w:.5;};
  // A pen's own width, else the default width.
  const widthOf=pen=>penWidths[pen]>0?penWidths[pen]:penWidthValue();
  const round2=n=>Number(n.toFixed(2));
  const fillDefaults=pen=>{const w=widthOf(pen);return {pattern:'none',angle:45,spacing:round2(Math.max(.2,w*2)),gap:round2(w),amp:round2(Math.max(.3,w*1.2)),wavelength:6,shift:0,zigzag:false};};
  const patternNames={none:'Off',lines:'Parallel lines',cross:'Cross-hatch',wavy:'Wavy lines',wavycross:'Wavy cross-hatch'};
  const isWavy=pattern=>pattern==='wavy'||pattern==='wavycross';
  let fillPens=[],fillDialogPen=null;
  function describeFill(f){
    if(f.pattern==='none')return 'Off';
    let text=patternNames[f.pattern]+' · '+f.angle+'° · spacing '+f.spacing+' mm';
    if(isWavy(f.pattern))text+=' · wave '+f.amp+' mm / '+f.wavelength+' mm'+(f.shift?' · shift '+f.shift+'°':'');
    return text+(f.zigzag?' · zigzag':'')+' · gap '+f.gap+' mm';
  }
  const pickOne=list=>list[Math.floor(Math.random()*list.length)];
  const randomIn=(lo,hi,step)=>Number((Math.round((lo+Math.random()*(hi-lo))/step)*step).toFixed(2));
  function randomizeFill(pen){
    // Ranges scale with the pen width so random settings never put lines closer than the pen can draw.
    const w=widthOf(pen),f=fillSettings[pen]=fillSettings[pen]||fillDefaults(pen),spacing=randomIn(Math.max(.3,w*1.3),Math.max(w*6,w*1.3+.6),.05);
    Object.assign(f,{pattern:pickOne(['lines','cross','wavy','wavycross']),angle:randomIn(0,175,5),spacing,gap:randomIn(w*.6,w*2.4,.05),amp:randomIn(w*.6,Math.max(w*1.5,spacing*1.2),.05),wavelength:randomIn(4,14,.5),shift:pickOne([0,45,90,180]),zigzag:Math.random()<.5});
  }
  function renderFills(){
    const rows=$('fillRows');rows.replaceChildren();
    const pens=new Set();
    const openOnly=new Set();
    const source=$('fillSource').value;
    for(const [color,,fills,closed] of colorList()){
      const pen=penAssign[color];if(!(pen>0)||source==='none')continue;
      if(fills>0||(source==='all'&&closed>0))pens.add(pen);else if(source==='all')openOnly.add(pen);
    }
    for(const pen of pens)openOnly.delete(pen);
    fillPens=[...pens].sort((a,b)=>a-b);
    $('fillTable').hidden=!fillPens.length;$('fillRandomAll').disabled=!fillPens.length||$('mode').value!=='plotter';
    $('fillNote').textContent=source==='none'?'Fills are off. Choose "Fill as in the original SVG" or "Fill all closed paths" to set up fills.'
      :fillPens.length?(source==='all'?'Every closed path is filled, with the pen assigned to its fill color (or its outline color when the artwork gives it no fill).':'Fills are drawn with the pen assigned to the shape\'s fill color. Only shapes that have a fill in the artwork are filled (an unspecified fill counts as none).')
      :(documentData?'No shape has a fill in the artwork. Choose "Fill all closed paths" to fill shapes anyway.':'Import artwork to set up fills.');
    // With "every closed shape", a pen holding only open paths (plain lines) has nothing to fill.
    if(fillPens.length&&openOnly.size)$('fillNote').textContent+=' Pen'+(openOnly.size>1?'s ':' ')+[...openOnly].sort((a,b)=>a-b).join(', ')+(openOnly.size>1?' hold':' holds')+' only open paths (lines), which cannot be filled, so '+(openOnly.size>1?'they are':'it is')+' not listed.';
    for(const pen of fillPens){
      const f=fillSettings[pen]=fillSettings[pen]||fillDefaults(pen),tr=document.createElement('tr'),cell=(node,className)=>{const td=document.createElement('td');if(className)td.className=className;td.append(node);tr.append(td);return td;};
      cell(document.createTextNode(String(pen)));cell(document.createTextNode(describeFill(f)),'fillSummary');
      const box=document.createElement('span'),button=(label,handler)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.disabled=$('mode').value!=='plotter';b.setAttribute('aria-label',label+' fill for pen '+pen);b.addEventListener('click',handler);box.append(b);};
      button('Edit',()=>openFillDialog(pen));
      button('Random',()=>{randomizeFill(pen);renderFills();update();});
      cell(box,'fillButtons');
      rows.append(tr);
    }
  }
  // Plain-language warnings for fill settings that cannot plot well with the entered pen width.
  function fillWarnings(onlyPen){
    const out=[];
    if($('mode').value!=='plotter')return out;
    for(const pen of fillPens){
      const f=fillSettings[pen],w=penWidths[pen]>0?penWidths[pen]:Number($('penWidth').value);
      if(!f||!(w>0)||f.pattern==='none'||(onlyPen!==undefined&&pen!==onlyPen))continue;
      if(f.spacing<w-1e-9)out.push(`Pen ${pen}: line spacing ${f.spacing} mm is narrower than the pen width ${w} mm, so neighboring lines will overlap.`);
      if(f.gap<w/2-1e-9)out.push(`Pen ${pen}: gap ${f.gap} mm is under half the pen width, so the hatch will touch the outline.`);
    }
    return out;
  }
  const warnBlock=()=>{const w=fillWarnings();return w.length?w.join('\n')+'\n':'';};
  const mergeNote=()=>{const m=job&&job.merged;if(!m||!(m.length>0))return '';return `Merged duplicate lines: ${m.length.toFixed(0)} mm of overlapping outline removed (${m.removed} duplicate path(s) dropped, ${m.trimmed} trimmed); each shared line is plotted once, by ${({dark:'the darkest pen',light:'the lightest pen',first:'the pen plotted first',last:'the pen plotted last'})[$('dedupeKeep').value]||'one pen'}.\n`+(m.emptied&&m.emptied.length?`Pen${m.emptied.length>1?'s':''} ${m.emptied.join(', ')} ${m.emptied.length>1?'have':'has'} nothing left to plot: every line ${m.emptied.length>1?'they':'it'} would draw is already drawn by another pen. Use Fill source to give ${m.emptied.length>1?"them their color":"it its color"} as hatch, or change "A shared line is kept by" to give ${m.emptied.length>1?"them":"it"} the shared lines.\n`:'');};
  const insetNote=()=>{const i=job&&job.inset;if(!i||!i.count)return '';return `Borders: ${i.count} outline${i.count===1?'':'s'} moved just inside ${i.count===1?'its':'their'} own region${i.count===1?'':'s'}`+(i.skipped?`; ${i.skipped} too thin to move`:'')+'.\n';};
  const thickNote=()=>{const t=job&&job.thick;if(!t||!t.bands)return '';return `Thick lines: ${t.bands} path(s) drawn as bands, ${t.strokes} strokes in all`+(t.clamped?`; ${t.clamped} closed shape(s) were limited so the inner strokes stay inside the shape`:'')+'.\n';};
  function updateDialogWarn(){
    if($('fillDialog').hidden||fillDialogPen===null)return;
    const w=fillWarnings(fillDialogPen);$('fdWarn').hidden=!w.length;$('fdWarn').textContent=w.join(' ');
  }
  function fillDialogFields(){
    const f=fillSettings[fillDialogPen];
    $('fdPattern').value=f.pattern;$('fdAngle').value=f.angle;$('fdSpacing').value=f.spacing;$('fdGap').value=f.gap;
    $('fdAmp').value=f.amp;$('fdLength').value=f.wavelength;$('fdShift').value=f.shift;$('fdZigzag').checked=f.zigzag;
    $('fdWave').hidden=!isWavy(f.pattern);$('fdBasic').hidden=f.pattern==='none';
    window.Dropdowns?.refresh();if(!$('fillDialog').hidden&&dialogPos)placeDialog();updateDialogWarn();
  }
  // The dialog floats without a backdrop: drag its title bar to move it and watch the preview update.
  let dialogPos=null;
  const dialogBody=()=>$('fillDialog').querySelector('.modalBody');
  let dialogWidth=null,dialogSaveTimer=null,lastDialogWidth=0;
  function saveDialogState(){
    clearTimeout(dialogSaveTimer);
    dialogSaveTimer=setTimeout(()=>{
      if(!dialogPos||$('fillDialog').hidden)return;
      const value={x:Math.round(dialogPos.x),y:Math.round(dialogPos.y),w:Math.round(dialogBody().offsetWidth)};
      if(JSON.stringify(value)===JSON.stringify(stored.plotterStudioDialog))return;
      saveStored({plotterStudioDialog:value}).catch(()=>{});
    },500);
  }
  function placeDialog(){
    const body=dialogBody();if(dialogWidth)body.style.width=dialogWidth+'px';
    const w=body.offsetWidth,h=body.offsetHeight;
    const at=dialogPos||{x:window.innerWidth-w-14,y:60};
    dialogPos={x:Math.max(0,Math.min(at.x,window.innerWidth-w)),y:Math.max(0,Math.min(at.y,window.innerHeight-h))};
    body.style.left=dialogPos.x+'px';body.style.top=dialogPos.y+'px';
  }
  function openFillDialog(pen){
    fillDialogPen=pen;$('fillDialogTitle').textContent='Pen '+pen+' fill';fillDialogFields();$('fillDialog').hidden=false;placeDialog();updateDialogWarn();$('fdDone').focus({preventScroll:true});
  }
  let dragging=null;
  $('fillDialogHead').addEventListener('pointerdown',event=>{
    if(event.target.closest('button')||(event.pointerType==='mouse'&&event.button!==0))return;
    dragging={id:event.pointerId,dx:event.clientX-dialogPos.x,dy:event.clientY-dialogPos.y};
    $('fillDialogHead').setPointerCapture(event.pointerId);event.preventDefault();
  });
  $('fillDialogHead').addEventListener('pointermove',event=>{
    if(!dragging||dragging.id!==event.pointerId)return;
    dialogPos={x:event.clientX-dragging.dx,y:event.clientY-dragging.dy};placeDialog();
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])$('fillDialogHead').addEventListener(name,()=>{if(dragging)saveDialogState();dragging=null;});
  // Dragging the popup's right edge changes its width; remember that too.
  new ResizeObserver(()=>{
    if($('fillDialog').hidden)return;
    const width=dialogBody().offsetWidth;if(!lastDialogWidth||Math.abs(width-lastDialogWidth)<1){lastDialogWidth=width;return;}
    lastDialogWidth=width;dialogWidth=width;placeDialog();saveDialogState();
  }).observe(dialogBody());
  window.addEventListener('resize',()=>{if(!$('fillDialog').hidden)placeDialog();});
  $('fdClose').onclick=()=>closeFillDialog();
  // Named fill styles: pattern, angle, spacing, gap and wave settings, reusable on any pen.
  const styleKeys=['pattern','angle','spacing','gap','amp','wavelength','shift','zigzag'],stylePatterns=['none','lines','cross','wavy','wavycross'];
  let fillStyles=[];
  function styleList(){
    $('fdStyle').replaceChildren(new Option('Choose a style',''));
    fillStyles.forEach((s,i)=>$('fdStyle').append(new Option(s.name,String(i))));window.Dropdowns?.refresh();
  }
  const validStyle=s=>s&&typeof s.name==='string'&&s.values&&stylePatterns.includes(s.values.pattern)&&['angle','spacing','gap','amp','wavelength','shift'].every(k=>Number.isFinite(s.values[k]))&&typeof s.values.zigzag==='boolean';
  $('fdStyle').addEventListener('change',()=>{const s=fillStyles[Number($('fdStyle').value)];if($('fdStyle').value!==''&&s)$('fdStyleName').value=s.name;});
  $('fdStyleSave').onclick=async()=>{
    const name=$('fdStyleName').value.trim();if(!name){message('Enter a style name.',true);return;}
    if(fillDialogPen===null)return;
    const f=fillSettings[fillDialogPen],values=Object.fromEntries(styleKeys.map(k=>[k,f[k]]));
    if(!validStyle({name,values})){message('Fix the highlighted numbers before saving a style.',true);return;}
    const next=fillStyles.filter(s=>s.name!==name);next.push({name,values});
    $('fdStyleSave').disabled=true;
    try{await saveStored({plotterStudioFillStyles:next});fillStyles=next;styleList();$('fdStyle').value=String(fillStyles.findIndex(s=>s.name===name));window.Dropdowns?.refresh();message('Fill style saved: '+name+'.');}
    catch(e){message('Could not save the fill style: '+e.message,true);}finally{$('fdStyleSave').disabled=false;}
  };
  $('fdStyleApply').onclick=()=>{
    const s=fillStyles[Number($('fdStyle').value)];if($('fdStyle').value===''||!s||fillDialogPen===null)return;
    Object.assign(fillSettings[fillDialogPen],s.values);fillDialogFields();renderFills();update();message('Applied fill style: '+s.name+'.');
  };
  $('fdStyleDelete').onclick=async()=>{
    const index=Number($('fdStyle').value);if($('fdStyle').value===''||!fillStyles[index])return;
    const name=fillStyles[index].name,next=fillStyles.filter((_,i)=>i!==index);
    try{await saveStored({plotterStudioFillStyles:next});fillStyles=next;styleList();message('Fill style deleted: '+name+'.');}
    catch(e){message('Could not delete the fill style: '+e.message,true);}
  };
  function closeFillDialog(){fillDialogPen=null;$('fillDialog').hidden=true;window.Dropdowns?.close();}
  function readFillDialog(){
    if(fillDialogPen===null)return;
    const f=fillSettings[fillDialogPen],num=id=>$(id).value.trim()===''?NaN:Number($(id).value);
    Object.assign(f,{pattern:$('fdPattern').value,angle:num('fdAngle'),spacing:num('fdSpacing'),gap:num('fdGap'),amp:num('fdAmp'),wavelength:num('fdLength'),shift:num('fdShift'),zigzag:$('fdZigzag').checked});
    $('fdWave').hidden=!isWavy(f.pattern);$('fdBasic').hidden=f.pattern==='none';
    placeDialog();renderFills();updateSoon();updateDialogWarn();
  }
  for(const id of ['fdPattern','fdAngle','fdSpacing','fdGap','fdAmp','fdLength','fdShift','fdZigzag'])$(id).addEventListener('input',readFillDialog);
  $('fdRandom').onclick=()=>{if(fillDialogPen===null)return;randomizeFill(fillDialogPen);fillDialogFields();renderFills();update();};
  $('fdDone').onclick=closeFillDialog;
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
    const holderLayer=el('g',{'data-layer':'holder'},svg),fillLayer=el('g',{'data-layer':'fill'},svg),cutLayer=el('g',{'data-layer':'cut'},svg),fillPaths=new Map();
    let prev={x:0,y:0};
    // With "Draw preview lines at the pen width" plotter lines use the real pen width in mm.
    // Declutter hides the numbers, start/end points, direction arrows and rapid (pen-up) moves; the drawing and the origin stay.
    const clean=$('declutter').checked;
    const penW=Number($('penWidth').value),toScale=$('penWidthPreview').checked&&$('mode').value==='plotter'&&penW>0;
    const scaled={'stroke-linecap':'round','stroke-linejoin':'round','stroke-opacity':.7};
    job.paths.forEach((p,i)=>{
      if(p.fill){
        // Hatch can be thousands of lines, so each pen's lines share one SVG path.
        const stroke=penStyle(p).stroke,w=toScale?widthOf(p.pen):0,key=stroke+'|'+w;
        let entry=fillPaths.get(key);if(!entry){entry={stroke,w,d:[]};fillPaths.set(key,entry);}
        entry.d.push('M'+p.points.map(q=>q.x.toFixed(3)+' '+(-q.y).toFixed(3)).join('L'));
        prev=p.points.at(-1);return;
      }
      const first=p.points[0];if(!job.knife&&!clean)el('line',{x1:prev.x,y1:-prev.y,x2:first.x,y2:-first.y,stroke:'var(--plugin-travel)','stroke-width':1,'vector-effect':'non-scaling-stroke','stroke-dasharray':'4 4'},cutLayer);
      if(!toScale)el('polyline',{points:p.points.map(q=>q.x+','+(-q.y)).join(' '),fill:'none',stroke:penStyle(p).halo,'stroke-width':p.id===$('selected').value?5:4,'vector-effect':'non-scaling-stroke'},cutLayer);
      el('polyline',{'data-cut-path':p.id,points:p.points.map(q=>q.x+','+(-q.y)).join(' '),fill:'none',stroke:p.id===$('selected').value?'var(--plugin-selected)':penStyle(p).stroke,...(toScale?{'stroke-width':widthOf(p.pen),...scaled}:{'stroke-width':p.id===$('selected').value?3:2,'vector-effect':'non-scaling-stroke'})},cutLayer);
      if(!clean){
        const last=p.points.at(-1);
        el('title',{},el('circle',{cx:last.x,cy:-last.y,r:size*.014,fill:'none',stroke:'var(--plugin-end)','stroke-width':2,'vector-effect':'non-scaling-stroke','data-marker':'end'},cutLayer)).textContent=`Path ${p.number} end`;
        el('title',{},el('circle',{cx:first.x,cy:-first.y,r:size*.008,fill:'var(--plugin-mark)','data-marker':'start'},cutLayer)).textContent=`Path ${p.number} start`;
        el('text',{x:first.x+size*.012,y:-first.y-size*.012,'font-size':size*.03},cutLayer).textContent=String(p.number);
        // The direction arrow points along the path but is capped at a fixed length, so a long
        // straight line gets a short arrow at its start instead of an arrow along its whole length.
        let j=1;while(j<p.points.length-1&&SvgCam.dist(first,p.points[j])<size*.04)j++;
        const target=p.points[j],span=SvgCam.dist(first,target),shrink=span>0?Math.min(span,size*.04)/span:0;
        el('line',{x1:first.x,y1:-first.y,x2:first.x+(target.x-first.x)*shrink,y2:-(first.y+(target.y-first.y)*shrink),stroke:'var(--plugin-mark)','stroke-width':1,'vector-effect':'non-scaling-stroke','marker-end':'url(#arrow)'},cutLayer);
      }
      prev=p.points.at(-1);
    });
    for(const {stroke,w,d} of fillPaths.values())el('path',{d:d.join(''),fill:'none',stroke,...(toScale?{'stroke-width':w,...scaled}:{'stroke-width':1,'vector-effect':'non-scaling-stroke',opacity:.85})},fillLayer);
    if(job.knife&&$('knifeOverlay').checked){
      let previous={x:0,y:0};
      for(const run of job.knife.runs){
        // Subsequent passes may have different entry arcs; show all actual runs.
        let group=[],kind=null;
        const flush=()=>{if(group.length>1&&!(clean&&kind==='travel'))el('polyline',{points:group.map(q=>q.x+','+(-q.y)).join(' '),fill:'none',stroke:kind==='travel'?'var(--plugin-travel)':kind==='cut'?'var(--plugin-knife-cut)':'var(--plugin-knife-move)','stroke-width':run.id===$('selected').value?1.5:1,'vector-effect':'non-scaling-stroke','stroke-dasharray':kind==='cut'?'5 3':kind==='travel'?'4 4':'none','data-knife-move':kind,opacity:run.id===$('selected').value?.8:.55},holderLayer);};
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
  // Re-planning is instant for small drawings. When the last plan took a while, edits wait for a short
  // pause in typing instead of recalculating on every keystroke.
  let updateTimer=null,lastUpdateMs=0;
  function update(){clearTimeout(updateTimer);const started=performance.now();updateNow();lastUpdateMs=performance.now()-started;}
  function updateSoon(){
    clearTimeout(updateTimer);
    if(lastUpdateMs<250){update();return;}
    $('summary').textContent='Recalculating…';updateTimer=setTimeout(update,350);
  }
  function updateNow(){
    viewBox=null;invalidate();job=null;$('generate').disabled=true;pick=null;
    const o=settings();$('depthSettings').hidden=o.mode==='laser';$('laserSettings').hidden=o.mode!=='laser';
    $('knifeSettings').hidden=o.mode!=='knife';$('knifeOverlayControl').hidden=o.mode!=='knife';
    $('penChange').disabled=o.mode!=='plotter';$('penOrder').disabled=o.mode!=='plotter';$('dedupeTol').disabled=o.mode!=='plotter';$('borders').disabled=o.mode!=='plotter';$('borderInset').disabled=o.mode!=='plotter'||o.borders!=='both';$('approach').disabled=o.mode!=='plotter';$('dedupeKeep').disabled=o.mode!=='plotter'||!(o.dedupeTol>0);$('penSizeRows').querySelectorAll('input').forEach(i=>i.disabled=o.mode!=='plotter');$('penRows').querySelectorAll('input').forEach(i=>i.disabled=o.mode!=='plotter');$('fillRows').querySelectorAll('button').forEach(i=>i.disabled=o.mode!=='plotter');$('fillRandomAll').disabled=o.mode!=='plotter'||!fillPens.length;['fillSource','fillFirst','skipUnstroked','hideCovered'].forEach(k=>$(k).disabled=o.mode!=='plotter');
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
      message(warnBlock()+insetNote()+mergeNote()+thickNote()+(job.hidden&&(job.hidden.trimmed||job.hidden.removed)?`Hidden-line removal trimmed ${job.hidden.trimmed} path(s) and removed ${job.hidden.removed} that were fully covered.
`:'')+(job.fillOverlaps?`${job.fillOverlaps} pair(s) of filled shapes overlap; each is hatched in full (turn on hidden-line removal to hide covered lines).\n`:'')+(job.knife?'Knife: Surface / Final / Step down control progressive Z passes. Inspect the entry-alignment setting and orange holder movements.\n':'')+documentData.warnings.join('\n')+'\nPreview starts from work X0 Y0 for ordering; actual initial machine position may differ.');draw();
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
  const isWhite=hex=>/^#[0-9a-f]{6}$/i.test(hex)&&[1,3,5].every(i=>parseInt(hex.slice(i,i+2),16)>=230);
  $('penSkipWhite').onclick=()=>{
    let count=0;
    for(const [color] of colorList())if(isWhite(penColors[color]||color)&&penAssign[color]>0){penMemory[color]=penAssign[color];penAssign[color]=0;count++;}
    renderPens();update();message(count?`Skipped ${count} white color${count===1?'':'s'}. They are left out of the plot; tick the box to bring one back.`:'No white colors to skip.');
  };
  $('penPlotAll').onclick=()=>{for(const [color] of colorList())if(!(penAssign[color]>0))penAssign[color]=penMemory[color]>0?penMemory[color]:1;renderPens();update();};
  $('penPerColor').onclick=()=>{assignDefaults(false);penColors={};renderPens();update();};
  $('penCluster').onclick=()=>{
    try{
      const wanted=Number($('penCount').value),list=colorList().filter(([c])=>penAssign[c]!==0);
      if(!list.length)throw Error('Every color is set to skip. Give a color a pen number first.');
      const result=SvgCam.clusterColors(list.map(([color,paths,fills])=>({color,weight:paths+fills})),wanted);
      for(const [color,pen] of Object.entries(result.assign)){penAssign[color]=pen;penColors[color]=result.reps[pen-1];}
      renderPens();update();
      if(!$('message').classList.contains('error'))message(`Grouped ${list.length} colors onto ${result.reps.length} pen${result.reps.length===1?'':'s'}. Each pen is shown in its most representative color; change a swatch to use another.
`+$('message').textContent);
    }catch(e){message(e.message,true);}
  };
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
  [...numeric,...knifeNumeric,...choices,'inner','largest','reverse','knifeAlign','knifeLift','fillFirst','skipUnstroked','hideCovered'].forEach(id=>$(id).addEventListener('input',()=>{
    if(id==='mode')$('tool').value=$('mode').value==='laser'?'M4':'none';if(id==='fillSource')renderFills();updateSoon();if(id==='penWidth')updateDialogWarn();
  }));
  $('knifeOverlay').onchange=draw;
  $('penWidthPreview').onchange=draw;
  $('declutter').onchange=()=>{draw();saveStored({plotterStudioDeclutter:$('declutter').checked}).catch(()=>{});};
  async function saveBackground(){
    if(window.parent===window)return;
    try{const data={...stored,previewBg};await host('saveSettings',{data});stored=data;}catch{}
  }
  // While the picker is open only the background itself changes (cheap); the redraw and save wait for 'change'.
  $('previewBg').addEventListener('input',()=>{$('preview').style.background=$('previewBg').value;});
  $('previewBg').addEventListener('change',()=>{applyBackground($('previewBg').value);saveBackground();});
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
  const presetFields=[...numeric,...knifeNumeric,...choices,'knifeAlign','knifeLift','inner','largest','reverse','fillFirst','skipUnstroked','hideCovered','joinEndpoints',...importFields,'dxfUnits'];
  const importState=()=>JSON.stringify([...importFields,'dxfUnits'].map(k=>$(k).value).concat($('joinEndpoints').checked));
  function presetList(){
    $('presets').replaceChildren(new Option('Choose a preset',''));
    presets.forEach((p,i)=>$('presets').append(new Option(p.name,String(i))));
  }
  // Saves extra keys into the plugin's settings (outside Dashboard they only live in memory).
  async function saveStored(patch){
    const data={...stored,...patch};
    if(window.parent!==window)await host('saveSettings',{data});
    stored=data;
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
    // Presets saved before 0.5.14 had a "hatch every closed shape" checkbox.
    if(Object.hasOwn(preset.values,'fillAll')&&!Object.hasOwn(preset.values,'fillSource')){$('fillSource').value=preset.values.fillAll?'all':'original';window.Dropdowns?.refresh();renderFills();}
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
    if(stored.plotterStudioDeclutter===true){$('declutter').checked=true;draw();}
    if(stored.plotterStudioPenWidths&&typeof stored.plotterStudioPenWidths==='object'){
      for(const [pen,w] of Object.entries(stored.plotterStudioPenWidths))if(Number(w)>0&&Number.isInteger(Number(pen)))penWidths[Number(pen)]=Number(w);
      renderPenSizes();update();
    }
    fillStyles=Array.isArray(stored.plotterStudioFillStyles)?stored.plotterStudioFillStyles.filter(validStyle):[];styleList();
    const d=stored.plotterStudioDialog;
    if(d&&Number.isFinite(d.x)&&Number.isFinite(d.y)){dialogPos={x:d.x,y:d.y};if(Number.isFinite(d.w))dialogWidth=Math.max(300,Math.min(900,d.w));}
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
