/* Geometry/planning is independent of the browser, so it can be tested with Node. */
(function (root) {
  'use strict';
  const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const area = p => Math.abs(p.reduce((s,a,i) => {const b=p[(i+1)%p.length];return s+a.x*b.y-b.x*a.y;},0)/2);
  const bounds = points => points.reduce((b,p)=>({minX:Math.min(b.minX,p.x),minY:Math.min(b.minY,p.y),maxX:Math.max(b.maxX,p.x),maxY:Math.max(b.maxY,p.y)}),{minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity});
  const length = p => p.slice(1).reduce((s,a,i)=>s+dist(p[i],a),0);
  // Remove nearby redundant samples without flattening real corners. The
  // replacement chord must remain within 0.001 mm of every removed sample.
  function cleanPoints(points,closed,threshold=0,maxDeviation=.001) {
    if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw Error('Node cleanup must be from 0 to 1 mm.');
    if(!threshold||points.length<3)return points;
    const source=closed?[...points,points[0]]:points,result=[source[0]],pending=[];
    const deviation=(p,a,b)=>{
      const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
      const t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
      return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
    };
    const tolerance=Math.min(threshold,maxDeviation);
    for(let i=1;i<source.length-1;i++){
      const a=result.at(-1),b=source[i],c=source[i+1];
      if(pending.length<128&&(dist(a,b)<threshold||dist(b,c)<threshold)&&deviation(b,a,c)<=tolerance&&pending.every(q=>deviation(q,a,c)<=tolerance))pending.push(b);
      else {result.push(b);pending.length=0;}
    }
    result.push(source.at(-1));if(closed)result.pop();
    return result.length<(closed?3:2)?points:result;
  }
  function simplify(points,tolerance){
    if(!tolerance||points.length<3)return points;
    const keep=new Set([0,points.length-1]),stack=[[0,points.length-1]];
    while(stack.length){const [a,b]=stack.pop(),p=points[a],q=points[b],dx=q.x-p.x,dy=q.y-p.y,l=dx*dx+dy*dy;let max=tolerance,index=-1;
      for(let i=a+1;i<b;i++){const r=points[i],t=l?Math.max(0,Math.min(1,((r.x-p.x)*dx+(r.y-p.y)*dy)/l)):0,d=Math.hypot(r.x-p.x-t*dx,r.y-p.y-t*dy);if(d>max){max=d;index=i;}}
      if(index>=0){keep.add(index);stack.push([a,index],[index,b]);}
    }
    const result=[...keep].sort((a,b)=>a-b).map(i=>points[i]);
    return dist(points[0],points.at(-1))<1e-9&&result.length<4?points:result;
  }
  function modal(lines){let feed=null;return lines.map(line=>{
    if(line.startsWith('('))return line;
    return line.replace(/ F([\d.]+)/g,(word,value)=>{if(value===feed)return '';feed=value;return word;});
  }).join('\n')+'\n';}
  function inside(p, poly) {
    let hit=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
      const a=poly[i],b=poly[j];
      if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) hit=!hit;
    }
    return hit;
  }
  function depths(o) {
    if(o.mode==='knife')knifeSettings(o);
    if(o.mode==='laser') {
      if(!Number.isInteger(o.laserPasses)||o.laserPasses<1||o.laserPasses>1000) throw Error('Laser passes must be an integer from 1 to 1000.');
      return Array(o.laserPasses).fill(o.focus);
    }
    for(const k of ['surface','final','step'])if(!Number.isFinite(o[k]))throw Error('Enter a valid number for '+k+'.');
    if(o.final>o.surface) throw Error('Final Z must be at or below surface Z.');
    if(!(o.step>0)) throw Error('Step down must be greater than zero.');
    const n=Math.max(1,Math.ceil((o.surface-o.final)/o.step-1e-10));
    if(n*(o.mode==='knife'?o.knifePasses:1)>1000) throw Error('More than 1000 passes: increase step down.');
    const zs=Array.from({length:n},(_,i)=>Math.max(o.final,o.surface-(i+1)*o.step));
    if(o.mode==='knife'&&(o.knifeLift!==false||o.knifeAlign!==false)&&o.knifeSwivelZ<zs[0])throw Error('Swivel Z must be at or above the first cutting Z ('+zs[0]+') so a swivel never increases pressure.');
    return o.mode==='knife'?zs.flatMap(z=>Array(o.knifePasses).fill(z)):zs;
  }
  function transform(doc,o) {
    const r=o.rotation*Math.PI/180, c=Math.cos(r)*o.scale/100,s=Math.sin(r)*o.scale/100;
    const vector=v=>v?{x:(c*v.x-s*v.y)/(o.scale/100),y:(s*v.x+c*v.y)/(o.scale/100)}:null;
    const tr=p=>({...p,x:c*p.x-s*p.y,y:s*p.x+c*p.y,...(p.tin?{tin:vector(p.tin)}:{}),...(p.tout?{tout:vector(p.tout)}:{})});
    const paths=doc.paths.map(p=>({...p,points:p.points.map(tr)}));
    const b=bounds((o.originBounds==='page'?doc.page:paths.flatMap(p=>p.points)).map(p=>o.originBounds==='page'?tr(p):p));
    let origin;
    if(o.origin==='custom') origin={x:o.originX,y:o.originY};
    else origin={x:o.origin.includes('left')?b.minX:o.origin.includes('right')?b.maxX:(b.minX+b.maxX)/2,y:o.origin.includes('top')?b.maxY:o.origin.includes('bottom')?b.minY:(b.minY+b.maxY)/2};
    return {paths:paths.map(p=>({...p,points:p.points.map(q=>({...q,x:q.x-origin.x,y:q.y-origin.y}))})),origin};
  }
  function orient(p,position,o,locks,directions) {
    let pts=p.points.slice(),reverse=false, index=0;
    const flip=()=>{pts=pts.map(q=>({...q,...(q.tout?{tin:{x:-q.tout.x,y:-q.tout.y}}:{}),...(q.tin?{tout:{x:-q.tin.x,y:-q.tin.y}}:{})}));};
    const lock=locks[p.id], direction=directions[p.id];
    if(lock!==undefined) index=Math.min(pts.length-1,Math.max(0,lock));
    else if(o.start==='auto') {
      if(p.closed) {
        let best=Infinity;
        pts.forEach((v,i)=>{const d=dist(position,v);if(d<best){best=d;index=i;}});
      } else if(direction===undefined && o.reverse && dist(position,pts.at(-1))<dist(position,pts[0])) reverse=true;
    }
    if(p.closed) pts=pts.slice(index).concat(pts.slice(0,index));
    else if(reverse || (lock!==undefined && index>0)) {pts.reverse();flip();}
    if(p.closed && direction===true){pts=[pts[0],...pts.slice(1).reverse()];flip();}
    if(!p.closed && direction!==undefined && lock===undefined && direction) {pts.reverse();flip();}
    if(p.closed) pts.push({...pts[0]});
    return {...p,points:pts};
  }
  function overlap(p,mm) {
    if(!p.closed||mm===0) return p;
    const perimeter=length(p.points);
    if(mm>perimeter+1e-8) throw Error('Overlap exceeds a closed path perimeter. Reduce overlap.');
    const points=p.points.slice();let remaining=mm;
    for(let i=1;i<p.points.length && remaining>1e-9;i++) {
      const a=p.points[i-1],b=p.points[i],d=dist(a,b);
      if(!d) continue;
      const t=Math.min(1,remaining/d);points.push(t===1?{...b}:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,tin:{x:(b.x-a.x)/d,y:(b.y-a.y)/d},tout:{x:(b.x-a.x)/d,y:(b.y-a.y)/d}});remaining-=d*t;
    }
    return {...p,points};
  }
  function plan(doc,o,locks={},directions={}) {
    const required=['feed','plunge','safe','scale','rotation','overlap','originX','originY',...(o.mode!=='laser'?['surface','final','step']:o.mode==='laser'?['focus','laserPasses']:[]),...(o.tool!=='none'?['power','powerMax']:[])];
    for(const key of required) if(!Number.isFinite(o[key])) throw Error('Enter a valid number for '+key+'.');
    for(const key of required) if(Math.abs(o[key])>1000000)throw Error(key+' exceeds the supported numeric range.');
    if(o.feed<.001||o.plunge<.001||o.scale<=0||o.overlap<0) throw Error('Feeds must be at least 0.001; scale must be positive; overlap cannot be negative.');
    if(o.mode!=='laser' && o.step<.0001)throw Error('Step down must be at least 0.0001 mm (output resolution).');
    if(o.mode!=='knife' && o.safe<=(o.mode==='laser'?o.focus:o.surface)) throw Error('Safe Z must be above '+(o.mode==='laser'?'focus Z.':'surface Z.'));
    if(o.mode!=='knife' && Math.round(o.safe*10000)<=Math.round((o.mode==='laser'?o.focus:o.surface)*10000))throw Error('Safe Z clearance is smaller than output resolution (0.0001 mm).');
    if(!['plotter','knife','laser'].includes(o.mode)||!['none','M3','M4'].includes(o.tool)) throw Error('Invalid tool mode.');
    if(o.mode==='laser' && o.tool==='none') throw Error('Select M3 or M4 for laser mode.');
    if(o.tool!=='none' && (o.power<0||o.powerMax<=0||o.power>o.powerMax)) throw Error('S value must be between zero and the configured maximum.');
    if(o.outputTolerance!==undefined&&(!Number.isFinite(o.outputTolerance)||o.outputTolerance<0||o.outputTolerance>1))throw Error('Output tolerance must be 0–1 mm.');
    const z=depths(o), transformed=transform(doc,o);
    if(transformed.paths.some(p=>p.points.some(q=>![q.x,q.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=1000000))))throw Error('Transformed artwork exceeds the supported coordinate range.');
    const remaining=transformed.paths.map(p=>({...p,area:p.closed?area(p.points):0}));
    if(!remaining.length) throw Error('No paths selected.');
    const largest=o.largest?remaining.filter(p=>p.closed).reduce((a,p)=>!a||p.area>a.area?p:a,null):null;
    // Strict containment, not just size: crossing/touching contours are not holes.
    const before=new Map(remaining.map(p=>[p.id,new Set()]));
    let comparisons=0;
    function cross(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
    // Sampling adds many collinear points. Remove them for containment only;
    // the original sampled vertices remain intact for output and start picking.
    const contours=new Map(remaining.map(p=>{
      const reduced=[];
      for(const c of p.points){
        while(reduced.length>1){const a=reduced.at(-2),b=reduced.at(-1);if(Math.abs(cross(a,c,b))>1e-6*Math.max(dist(a,c),1e-9)||(b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)<0)break;reduced.pop();}
        reduced.push(c);
      }
      return [p.id,reduced];
    }));
    function intersects(a,b,c,d){
      if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.max(c.x,d.x)<Math.min(a.x,b.x)||Math.max(a.y,b.y)<Math.min(c.y,d.y)||Math.max(c.y,d.y)<Math.min(a.y,b.y))return false;
      return cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0;
    }
    if(o.inner) for(const outer of remaining.filter(p=>p.closed)) for(const child of remaining) {
      if(outer===child)continue;
      const op=contours.get(outer.id),cp=contours.get(child.id);
      const a=bounds(op),b=bounds(cp);
      if(b.minX<=a.minX||b.maxX>=a.maxX||b.minY<=a.minY||b.maxY>=a.maxY)continue;
      if(!inside(cp[0],op))continue;
      let crossing=false;
      for(let i=0;i<op.length&&!crossing;i++)for(let j=0;j<cp.length-(child.closed?0:1);j++){
        if(++comparisons>5000000)throw Error('Containment calculation is too large. Increase sampling spacing or disable inner-first.');
        if(intersects(op[i],op[(i+1)%op.length],cp[j],cp[(j+1)%cp.length])){crossing=true;break;}
      }
      if(!crossing)before.get(outer.id).add(child.id);
    }
    let position={x:0,y:0},travel=0;const ordered=[],done=new Set();
    while(remaining.length) {
      let candidates=remaining.filter(p=>[...before.get(p.id)].every(id=>done.has(id)) && (p!==largest||remaining.length===1));
      if(!candidates.length) throw Error('Path-order constraints conflict. Disable largest-last or inner-first.');
      let best=orient(candidates[0],position,o,locks,directions);
      if(o.order==='nearest') for(const p of candidates.slice(1)){const q=orient(p,position,o,locks,directions);if(dist(position,q.points[0])<dist(position,best.points[0]))best=q;}
      best=overlap(best,o.overlap);
      travel+=dist(position,best.points[0]);
      // Additional passes return to the same start with the tool raised/off.
      travel+=dist(best.points.at(-1),best.points[0])*(z.length-1);
      best.number=ordered.length+1;ordered.push(best);position=best.points.at(-1);done.add(best.id);remaining.splice(remaining.findIndex(p=>p.id===best.id),1);
    }
    if(ordered.reduce((n,p)=>n+p.points.length*z.length,0)>1000000)throw Error('Output exceeds one million moves. Reduce passes or increase sampling spacing.');
    const job={paths:ordered,depths:z,bounds:bounds(ordered.flatMap(p=>p.points)),origin:transformed.origin,travel,cut:ordered.reduce((n,p)=>n+length(p.points)*z.length,0)};
    return o.mode==='knife'?compensateKnife(job,o):job;
  }
  // Passive drag knife: the holder is offset ahead of the blade along its heading.
  // Analytic one-sided tangents retain real corners; smooth samples need no pivot.
  // Arc creation and Z lift use independent angle thresholds.
  function knifeSettings(o) {
    const usesSwivelZ=o.knifeLift!==false||o.knifeAlign!==false;
    if(usesSwivelZ&&!Number.isFinite(o.knifeSwivelZ))throw Error('Enter a valid contact Z for swivel movements.');
    for(const k of ['knifeOffset',...(usesSwivelZ?['knifeSwivelZ']:[]),'knifeAngle','knifeFeed','knifePasses',...(o.knifeAlign!==false?['knifeLead','knifeHeading']:[])])
      if(!Number.isFinite(o[k]))throw Error('Enter a calibrated/valid value for '+k+'.');
    if(o.knifeOffset<.0001||o.knifeOffset>100)throw Error('Blade offset must be from 0.0001 to 100 mm.');
    if(o.knifeArcAngle!==undefined&&(!Number.isFinite(o.knifeArcAngle)||o.knifeArcAngle<0||o.knifeArcAngle>180))throw Error('Swivel arc angle must be 0–180 degrees.');
    if(o.knifeAngle<1||o.knifeAngle>180)throw Error('Swivel lift angle must be from 1 to 180 degrees.');
    if(o.knifeFeed<.001||o.knifeFeed>1000000)throw Error('Swivel feed must be positive and at most 1000000 mm/min.');
    if(o.knifeAlign!==false&&(o.knifeLead<0||o.knifeLead>1000))throw Error('Alignment lead-in must be from 0 to 1000 mm.');
    if(o.knifeAlign!==false&&(o.knifeHeading< -180||o.knifeHeading>180))throw Error('Initial blade heading must be from -180 to 180 degrees.');
    if(!Number.isInteger(o.knifePasses)||o.knifePasses<1||o.knifePasses>1000)throw Error('Knife passes must be an integer from 1 to 1000.');
    if(usesSwivelZ&&Math.abs(o.knifeSwivelZ)>1000000)throw Error('Knife Z is outside the supported range.');
    if(!Number.isFinite(o.safe)||Math.round(o.safe*10000)<=Math.round(Math.max(o.surface,usesSwivelZ?o.knifeSwivelZ:o.surface)*10000))throw Error('Safe travel Z must be above Surface Z and Swivel Z.');
    if(o.tool!=='none')throw Error('Knife mode requires tool commands set to None.');
  }
  function compensateKnife(job,o) {
    const d=o.knifeOffset, runs=[];let heading=o.knifeHeading*Math.PI/180,total=0,travel=0,previous={x:0,y:0};
    const shift=(p,a)=>({x:p.x+d*Math.cos(a),y:p.y+d*Math.sin(a)});
    const turn=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
    // Bound chord deviation and angle even for very small offsets.
    const arcStep=Math.min(Math.PI/36,(o.spacing??.5)/d,2*Math.acos(Math.max(-1,1-.001/d)));
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of job.paths) {
      const pts=p.points.filter((v,i,a)=>i===0||dist(v,a[i-1])>1e-9);
      if(pts.length<2)throw Error('Path '+p.number+' is too short for knife compensation.');
      const angles=pts.slice(1).map((v,i)=>Math.atan2(v.y-pts[i].y,v.x-pts[i].x));
      const direction=(q,key,fallback)=>q[key]?Math.atan2(q[key].y,q[key].x):fallback;
      const incoming=pts.map((q,i)=>direction(q,'tin',angles[Math.max(0,i-1)]));
      const outgoing=pts.map((q,i)=>direction(q,'tout',angles[Math.min(i,angles.length-1)]));
      for(let pass=0;pass<job.depths.length;pass++) {
        const cutZ=job.depths[pass],moves=[];let swivels=0;
        const add=(q,z,kind)=>{
          if(++total>500000)throw Error('Compensated output is too large. Reduce passes or increase sample spacing.');
          if(![q.x,q.y,z].every(v=>Number.isFinite(v)&&Math.abs(v)<=1000000))throw Error('Compensated tool movement exceeds the supported coordinate range.');
          minX=Math.min(minX,q.x);maxX=Math.max(maxX,q.x);minY=Math.min(minY,q.y);maxY=Math.max(maxY,q.y);
          moves.push({...q,z,kind});
        };
        const arc=(center,from,to,z,kind)=>{
          const delta=turn(from,to);if(Math.abs(delta)<1e-10)return;
          const count=Math.ceil(Math.abs(delta)/arcStep);
          for(let n=1;n<=count;n++)add(shift(center,from+delta*n/count),z,kind);
        };
        const align=o.knifeAlign!==false,leadLength=align?o.knifeLead:0,first=outgoing[0],lead={x:pts[0].x-leadLength*Math.cos(first),y:pts[0].y-leadLength*Math.sin(first)};
        const start=shift(lead,align?heading:first);
        travel+=dist(previous,start);
        add(start,o.safe,'travel');
        if(align){
          add(start,o.knifeSwivelZ,'lower');
          arc(lead,heading,first,o.knifeSwivelZ,'alignment');
          if(leadLength>0)add(shift(pts[0],first),o.knifeSwivelZ,'lead');
        }
        add(shift(pts[0],first),cutZ,'lower');
        for(let i=0;i<angles.length;i++) {
          const sweep=Math.abs(turn(outgoing[i],incoming[i+1]));
          const tight=sweep>1e-6&&dist(pts[i],pts[i+1])/sweep<d;
          const end=shift(pts[i+1],incoming[i+1]);add(end,cutZ,tight?'curve':'cut');
          if(i+1===angles.length)continue;
          const delta=Math.abs(turn(incoming[i+1],outgoing[i+1]));
          const makeArc=delta>(o.knifeArcAngle??10)*Math.PI/180+1e-10;
          const lift=makeArc&&delta>=o.knifeAngle*Math.PI/180-1e-10&&o.knifeLift!==false;
          if(makeArc){
            swivels++;
            if(lift)add(end,o.knifeSwivelZ,'lift');
            arc(pts[i+1],incoming[i+1],outgoing[i+1],lift?o.knifeSwivelZ:cutZ,'swivel');
            if(lift)add(shift(pts[i+1],outgoing[i+1]),cutZ,'lower');
          }else if(delta>1e-10){
            // Below the arc threshold use a straight connection, kept separate
            // from smooth-run simplification so it cannot erase a corner.
            add(shift(pts[i+1],outgoing[i+1]),cutZ,'transition');
          }
        }
        heading=incoming.at(-1);previous=shift(pts.at(-1),heading);add(previous,o.safe,'retract');
        const optimized=[];
        for(let i=0;i<moves.length;){
          if(moves[i].kind!=='cut'){optimized.push(moves[i++]);continue;}
          const start=i;while(i<moves.length&&moves[i].kind==='cut'&&moves[i].z===moves[start].z)i++;
          const section=moves.slice(Math.max(0,start-1),i);
          const reduced=simplify(section,o.outputTolerance??.01);
          optimized.push(...reduced.slice(start?1:0));
        }
        runs.push({id:p.id,number:p.number,pass:pass+1,moves:optimized,swivels});
      }
    }
    job.knife={runs,bounds:{minX,minY,maxX,maxY},swivels:runs.reduce((n,r)=>n+r.swivels,0),initialHeading:o.knifeHeading};
    job.travel=travel;
    return job;
  }
  function knifeGcode(job,o) {
    knifeSettings(o);
    if(!job.knife)throw Error('Regenerate the knife plan before exporting.');
    const out=['(SVG to G-code - compensated passive drag knife)',
      '(On a floating Z axis, progressive Z can change pressure rather than material depth)',
      `(Offset ${num(o.knifeOffset)} mm; final Z ${num(o.final)}; step ${num(o.step)}; swivel Z ${o.knifeLift!==false||o.knifeAlign!==false?num(o.knifeSwivelZ):'unused'})`,
      `(Swivel arc above ${num(o.knifeArcAngle??10)} degrees; lift threshold ${num(o.knifeAngle)} degrees; lift ${o.knifeLift!==false?'ON':'OFF'})`,
      ...(o.knifeAlign!==false?[
        `(Before first pass: blade tip lies ${num(o.knifeHeading+180)} degrees CCW from +X relative to holder center)`,
        '(Entry alignment ON; blade direction is assumed unchanged during raised travel)',
        '(Alignment and lead-ins contact material; check their placement in preview)'
      ]:['(Entry alignment OFF: no entry arcs or lead-ins)',
        '(Assumes blade already trails the first cut direction at EVERY pass; an unaligned blade can wander)']),
      'G21','G90','G17','G94','M5','G0 Z'+num(o.safe)];
    for(const run of job.knife.runs) {
      out.push(`(Path ${run.number} - pass ${run.pass}/${job.depths.length})`);
      let prev=null,kind='';
      for(const m of run.moves) {
        if(m.kind!==kind&&['alignment','lead','swivel'].includes(m.kind))out.push('('+m.kind+')');
        kind=m.kind;
        if(m.kind==='travel')out.push('G0 X'+num(m.x)+' Y'+num(m.y));
        else if(m.kind==='retract')out.push('G0 Z'+num(m.z));
        else if(['lower','lift'].includes(m.kind)) {
          if(!prev||Math.abs(prev.z-m.z)>1e-9)out.push('G1 Z'+num(m.z)+' F'+num(o.plunge));
        } else out.push('G1 X'+num(m.x)+' Y'+num(m.y)+' F'+num(['cut','curve','transition'].includes(m.kind)?o.feed:o.knifeFeed));
        prev=m;
      }
    }
    out.push('(End - remains at safe Z)');return modal(out);
  }

  const num = n => Number(n.toFixed(4)).toString();
  function gcode(job,o) {
    if(o.mode==='knife')return knifeGcode(job,o);
    const out=['(SVG to G-code 0.6.0 - millimeters, absolute work coordinates)','(Finish all passes on each path; Z zero must match surface setting)','G21','G90','G17','G94'];
    const enabled=o.tool!=='none';
    if(enabled)out.push('M5');
    out.push('G0 Z'+num(o.safe));
    job.paths.forEach((p,i)=>{
      job.depths.forEach((z,pass)=>{
        out.push(`(Path ${p.number ?? i+1} - pass ${pass+1}/${job.depths.length})`);
        if(enabled)out.push('M5');
        out.push('G0 Z'+num(o.safe),'G0 X'+num(p.points[0].x)+' Y'+num(p.points[0].y),'G1 Z'+num(z)+' F'+num(o.plunge));
        if(enabled)out.push(o.tool+' S'+num(o.power));
        simplify(p.points,o.outputTolerance??.01).slice(1).forEach((q,j)=>out.push('G1 X'+num(q.x)+' Y'+num(q.y)+(j===0?' F'+num(o.feed):'')));
        if(enabled)out.push('M5');
        out.push('G0 Z'+num(o.safe));
      });
    });
    if(enabled)out.push('M5');
    out.push('(End - remains at safe Z)');return modal(out);
  }
  const api={simplify,cleanPoints,bounds,area,depths,transform,plan,gcode,dist,length};
  if(typeof module!=='undefined')module.exports=api;else root.SvgCam=api;
})(typeof window==='undefined'?globalThis:window);
