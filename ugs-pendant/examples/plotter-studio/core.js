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
  // ---- Hatch fill -------------------------------------------------------
  // Lines at a fixed angle on a global grid (so neighboring shapes line up),
  // clipped even-odd to a shape's closed contours (holes from compound paths work),
  // then trimmed so no line comes within `gap` mm of any contour.
  function solve(c0,c1,lo,hi){
    if(Math.abs(c1)<1e-12)return c0>=lo&&c0<=hi?[-Infinity,Infinity]:null;
    const a=(lo-c0)/c1,b=(hi-c0)/c1;return a<b?[a,b]:[b,a];
  }
  // Interval of u where (u,v) lies within g of edge a-b: the line meets a convex
  // capsule in one interval, found as the hull of its circle and slab hits.
  function capsule(e,v,g){
    const a=e.a,b=e.b,du=b.u-a.u,dv=b.v-a.v,len=Math.hypot(du,dv),ex=du/len,ey=dv/len,nx=-ey,ny=ex,parts=[];
    for(const p of [a,b]){const dy=v-p.v;if(Math.abs(dy)<=g){const h=Math.sqrt(g*g-dy*dy);parts.push([p.u-h,p.u+h]);}}
    const side=solve(-a.u*nx+(v-a.v)*ny,nx,-g,g),along=solve(-a.u*ex+(v-a.v)*ey,ex,0,len);
    if(side&&along){const lo=Math.max(side[0],along[0]),hi=Math.min(side[1],along[1]);if(lo<=hi)parts.push([lo,hi]);}
    return parts.length?[Math.min(...parts.map(p=>p[0])),Math.max(...parts.map(p=>p[1]))]:null;
  }
  // Returns polylines ([{x,y},...]). opt: wave/amp/wavelength/shift (wavy lines), zigzag (join line ends).
  function hatchLines(contours,angle,spacing,gap,opt={}){
    const th=angle*Math.PI/180,c=Math.cos(th),s=Math.sin(th),edges=[];let vmin=Infinity,vmax=-Infinity,umin=Infinity,umax=-Infinity;
    const amp=opt.wave?opt.amp:0,wavelength=opt.wavelength||10,shift=(opt.shift||0)*Math.PI/180,clearance=gap;
    for(const pts of contours){
      const r=pts.map(q=>({u:q.x*c+q.y*s,v:-q.x*s+q.y*c}));
      for(const q of r){vmin=Math.min(vmin,q.v);vmax=Math.max(vmax,q.v);umin=Math.min(umin,q.u);umax=Math.max(umax,q.u);}
      for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];if(a.u===b.u&&a.v===b.v)continue;edges.push({a,b,xa:{x:a.u,y:a.v},xb:{x:b.u,y:b.v},lo:Math.min(a.v,b.v),hi:Math.max(a.v,b.v),ulo:Math.min(a.u,b.u),uhi:Math.max(a.u,b.u)});}
    }
    const first=Math.ceil((vmin-amp)/spacing),last=Math.floor((vmax+amp)/spacing);
    if(last-first>20000)throw Error('Hatch spacing is too small for this artwork: more than 20,000 lines. Increase the spacing.');
    // Edges are filed by height, so a point or a line only looks at the few edges near it.
    const binH=Math.max((vmax-vmin)/1000,.25),binCount=Math.max(1,Math.floor((vmax-vmin)/binH)+1),bins=Array.from({length:binCount},()=>[]);
    const binOf=v=>Math.max(0,Math.min(binCount-1,Math.floor((v-vmin)/binH)));
    for(const e of edges)for(let k=binOf(e.lo);k<=binOf(e.hi);k++)bins[k].push(e);
    // A visible hatch can end at a covering shape's edge, which is not one of
    // this fill's own contours. Use those edges when assessing border turns.
    const borderBins=opt.visibleAbove?.length?Array.from({length:binCount},()=>[]):null;
    if(borderBins)for(const occ of opt.visibleAbove)for(const contour of occ.contours)for(let i=0;i<contour.length;i++){
      const p=contour[i],q=contour[(i+1)%contour.length],a={u:p.x*c+p.y*s,v:-p.x*s+p.y*c},b={u:q.x*c+q.y*s,v:-q.x*s+q.y*c};
      const lo=Math.min(a.v,b.v),hi=Math.max(a.v,b.v);
      if((a.u===b.u&&a.v===b.v)||hi<vmin-5||lo>vmax+5)continue;
      const e={a,b,lo,hi,ulo:Math.min(a.u,b.u),uhi:Math.max(a.u,b.u)};
      for(let k=binOf(lo);k<=binOf(hi);k++)borderBins[k].push(e);
    }
    const insideShape=(u,v)=>{let hit=false;for(const e of bins[binOf(v)])if((e.a.v<=v)!==(e.b.v<=v)&&u<e.a.u+(v-e.a.v)*(e.b.u-e.a.u)/(e.b.v-e.a.v))hit=!hit;return hit;};
    // True when some edge lies closer than r to the point.
    const nearerThan=(u,v,r)=>{
      for(let k=binOf(v-r);k<=binOf(v+r);k++)for(const e of bins[k]){
        if(v<e.lo-r||v>e.hi+r||u<e.ulo-r||u>e.uhi+r)continue;
        const dx=e.b.u-e.a.u,dy=e.b.v-e.a.v,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((u-e.a.u)*dx+(v-e.a.v)*dy)/l)):0;
        if(Math.hypot(u-e.a.u-t*dx,v-e.a.v-t*dy)<r)return true;
      }
      return false;
    };
    const nearerThanVisibleBorder=(u,v,r)=>{
      if(!borderBins)return false;
      for(let k=binOf(v-r);k<=binOf(v+r);k++)for(const e of borderBins[k]){
        if(v<e.lo-r||v>e.hi+r||u<e.ulo-r||u>e.uhi+r)continue;
        const dx=e.b.u-e.a.u,dy=e.b.v-e.a.v,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((u-e.a.u)*dx+(v-e.a.v)*dy)/l)):0;
        if(Math.hypot(u-e.a.u-t*dx,v-e.a.v-t*dy)<r)return true;
      }
      return false;
    };
    const edgesNear=(v,r)=>{const seen=new Set(),out=[];for(let k=binOf(v-r);k<=binOf(v+r);k++)for(const e of bins[k])if(!seen.has(e)){seen.add(e);out.push(e);}return out;};
    // A connector may join two line ends only if it is short and stays inside the shape, clear of the outline.
    // Zigzag connectors are kept short: up to three line spacings but no more than about 3 mm, and never less than 1.5 spacings.
    const maxLink=Math.max(spacing*1.5,Math.min(spacing*3,3))+amp*2;
    const linkable=(p,q)=>{
      if(Math.hypot(p.u-q.u,p.v-q.v)>maxLink)return false;
      for(const t of [.15,.3,.5,.7,.85]){const u=p.u+(q.u-p.u)*t,v=p.v+(q.v-p.v)*t;if(!insideShape(u,v)||(gap>0&&nearerThan(u,v,gap*.85)))return false;}
      return true;
    };
    // A wavy line is generated across the shape's whole width, then trimmed to the part that is
    // inside the shape and at least `gap` from its outline, so waves reach the gap at the sides too.
    let work=0;
    const waveRow=(n,v)=>{
      const count=Math.max(2,Math.ceil((umax-umin)/(wavelength/10))),base=[];
      for(let k=0;k<=count;k++){const u=umin+(umax-umin)*k/count;base.push({u,v:v+amp*Math.sin(2*Math.PI*u/wavelength+n*shift)});}
      const pieces=[];let cur=null;const done=()=>{if(cur&&cur.length>1&&length(cur.map(q=>({x:q.u,y:q.v})))>=.1)pieces.push(cur);cur=null;};
      const near=edgesNear(v,amp+gap);if(!near.length)return pieces;
      for(let i=0;i+1<base.length;i++){
        const a=base[i],b=base[i+1],pa={x:a.u,y:a.v},pb={x:b.u,y:b.v},ts=[0,1];
        const lov=Math.min(a.v,b.v)-gap,hiv=Math.max(a.v,b.v)+gap,lou=Math.min(a.u,b.u)-gap,hiu=Math.max(a.u,b.u)+gap;
        for(const e of near){
          if(e.hi<lov||e.lo>hiv||e.uhi<lou||e.ulo>hiu)continue;
          const t=cutParam(pa,pb,e.xa,e.xb);if(t!==null)ts.push(t);
          if(gap>0){const iv=segmentCapsule(pa,pb,e.xa,e.xb,gap);if(iv)ts.push(iv[0],iv[1]);}
        }
        ts.sort((x,y)=>x-y);
        for(let k=0;k+1<ts.length;k++){
          const t0=ts[k],t1=ts[k+1];if(t1-t0<1e-9)continue;
          work+=2*near.length;if(work>3e8)throw Error('Wavy fill is too detailed for this artwork. Increase the fill spacing or wavelength.');
          const mid=(t0+t1)/2,mu=a.u+(b.u-a.u)*mid,mv=a.v+(b.v-a.v)*mid;
          if(!insideShape(mu,mv)||(gap>0&&nearerThan(mu,mv,gap-1e-7))){done();continue;}
          const p0=t0===0?a:{u:a.u+(b.u-a.u)*t0,v:a.v+(b.v-a.v)*t0},p1=t1===1?b:{u:a.u+(b.u-a.u)*t1,v:a.v+(b.v-a.v)*t1};
          if(cur&&Math.hypot(cur.at(-1).u-p0.u,cur.at(-1).v-p0.v)<1e-9)cur.push(p1);else{done();cur=[p0,p1];}
        }
      }
      done();
      return pieces;
    };
    const chains=[];let chain=null;
    const flush=()=>{if(chain)chains.push(chain);chain=null;};
    // Zigzag: every line piece is collected, then ends of pieces on neighboring lines are joined wherever a
    // short connector stays inside the shape and clear of the outline. Shortest connectors go first, each
    // piece end takes at most one connector, and no connector may close a loop, so the result is a set of
    // continuous paths however many pieces a line is split into (holes, notches, separate lobes).
    const allPieces=[];
    // True when a straight connector stays within a band along the outline for its whole length.
    const hugsBorder=(P,Q)=>{
      const band=gap+Math.max(.3,spacing*.15)+amp;
      for(const t of [.1,.3,.5,.7,.9]){
        const u=P.u+(Q.u-P.u)*t,v=P.v+(Q.v-P.v)*t;
        if(!nearerThan(u,v,band)&&!nearerThanVisibleBorder(u,v,band))return false;
      }
      // ... and it must run in the same direction as the outline beside it, not cut across at an angle.
      const mu=(P.u+Q.u)/2,mv=(P.v+Q.v)/2;let edge=null,best=band;
      for(let k=binOf(mv-band);k<=binOf(mv+band);k++)for(const e of borderBins?bins[k].concat(borderBins[k]):bins[k]){
        if(mv<e.lo-best||mv>e.hi+best||mu<e.ulo-best||mu>e.uhi+best)continue;
        const dx=e.b.u-e.a.u,dy=e.b.v-e.a.v,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((mu-e.a.u)*dx+(mv-e.a.v)*dy)/l)):0,d=Math.hypot(mu-e.a.u-t*dx,mv-e.a.v-t*dy);
        if(d<best){best=d;edge=e;}
      }
      if(!edge)return false;
      const cx=Q.u-P.u,cy=Q.v-P.v,ex=edge.b.u-edge.a.u,ey=edge.b.v-edge.a.v;
      return Math.abs(cx*ex+cy*ey)>=.9986*Math.hypot(cx,cy)*Math.hypot(ex,ey);
    };
    const joinPieces=pieces=>{
      const byLine=new Map();pieces.forEach((pc,i)=>{if(!byLine.has(pc.n))byLine.set(pc.n,[]);byLine.get(pc.n).push(i);});
      const candidates=[];
      pieces.forEach((a,i)=>{
        for(const j of byLine.get(a.n+1)||[])for(const end of [0,1]){
          // Only like ends are joined (both left or both right), which makes the U-turn of a zigzag.
          const P=end?a.pts.at(-1):a.pts[0],Q=end?pieces[j].pts.at(-1):pieces[j].pts[0],length=Math.hypot(P.u-Q.u,P.v-Q.v);
          const why=opt.stats,note=reason=>{if(why){why.pairs=(why.pairs||0)+1;why[reason]=(why[reason]||0)+1;(why.reasons=why.reasons||new Map()).set(i+','+j+','+end,reason);}};
          if(length>maxLink){note('tooLong');continue;}
          if(!linkable(P,Q)){note('outsideOrTooClose');continue;}
          // A connector must look deliberate: either a square-on U-turn between neighboring lines (within about
          // 3 degrees of perpendicular, which in a cross-hatch is the other grid direction), or a stretch that
          // runs along the border (close to the outline and within about 3 degrees of its direction). Anything
          // else is visibly off axis, so those ends stay unjoined.
          const squareOn=Math.abs(P.u-Q.u)<=.053*length;
          if(!squareOn&&!hugsBorder(P,Q)){note('diagonal');continue;}
          if(opt.linkVisible&&!opt.linkVisible(P,Q)){note('coveredOrTooClose');continue;}
          note('ok');candidates.push({length,i,j,end});
        }
      });
      candidates.sort((x,y)=>x.length-y.length||x.i-y.i||x.end-y.end);
      const parent=pieces.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
      const link=pieces.map(()=>[null,null]);
      for(const cd of candidates){
        if(link[cd.i][cd.end]||link[cd.j][cd.end]){if(opt.stats)opt.stats.endTaken=(opt.stats.endTaken||0)+1;continue;}
        const ri=find(cd.i),rj=find(cd.j);if(ri===rj){if(opt.stats)opt.stats.wouldCloseLoop=(opt.stats.wouldCloseLoop||0)+1;continue;}
        if(opt.stats)opt.stats.joined=(opt.stats.joined||0)+1;
        parent[ri]=rj;link[cd.i][cd.end]={piece:cd.j,end:cd.end};link[cd.j][cd.end]={piece:cd.i,end:cd.end};
      }
      if(opt.stats){
        // For every end left free, what stopped it from joining a close neighbor on an adjacent line?
        const st=opt.stats;st.freeEnds=0;st.freeWithNeighbor={};
        pieces.forEach((a,i)=>[0,1].forEach(end=>{
          if(link[i][end])return;st.freeEnds++;
          const P=end?a.pts.at(-1):a.pts[0];let best=null;
          for(const dn of [-1,1])for(const j of byLine.get(a.n+dn)||[]){
            const Q=end?pieces[j].pts.at(-1):pieces[j].pts[0],d=Math.hypot(P.u-Q.u,P.v-Q.v);
            if(d<=spacing*1.6&&(!best||d<best.d))best={d,j,dn};
          }
          if(!best)return;
          const reason=(best.dn>0?st.reasons.get(i+','+best.j+','+end):st.reasons.get(best.j+','+i+','+end))||'?';
          const kind=reason==='ok'?(link[best.j][end]?'neighborEndAlreadyUsed':'wouldCloseLoop'):reason;
          st.freeWithNeighbor[kind]=(st.freeWithNeighbor[kind]||0)+1;
        }));
      }
      // Walk each path from one of its two free ends.
      const seen=new Set(),out=[];
      pieces.forEach((a,i)=>{
        if(seen.has(i))return;
        const free=link[i][0]?(link[i][1]?-1:1):0;   // which end of this piece has no connector (-1: none)
        if(free<0)return;                            // an inner piece; its path is reached from an end piece
        let at=i,enter=free,line=[];
        for(;;){
          seen.add(at);
          const pts=pieces[at].pts,forward=enter===0;
          for(const q of forward?pts:[...pts].reverse())line.push(q);
          const leave=1-enter,next=link[at][leave];
          if(!next)break;
          at=next.piece;enter=next.end;
        }
        out.push(line);
      });
      return out;
    };
    for(let n=first;n<=last;n++){
      const v=n*spacing;
      let pieces=[];
      if(opt.wave)pieces=waveRow(n,v);
      else{
        const xs=[];
        for(const e of edges)if((e.a.v<=v)!==(e.b.v<=v))xs.push(e.a.u+(v-e.a.v)*(e.b.u-e.a.u)/(e.b.v-e.a.v));
        if(xs.length>=2){
          xs.sort((p,q)=>p-q);
          let blocked=[];
          if(clearance>0){for(const e of edges)if(v>=e.lo-clearance&&v<=e.hi+clearance){const iv=capsule(e,v,clearance);if(iv)blocked.push(iv);}blocked.sort((p,q)=>p[0]-q[0]);}
          const row=[];
          for(let k=0;k+1<xs.length;k+=2){
            let from=xs[k];const to=xs[k+1];
            for(const [lo,hi] of blocked){
              if(hi<from||lo>to)continue;
              if(lo>from)row.push([from,lo]);
              from=Math.max(from,hi);if(from>=to)break;
            }
            if(from<to)row.push([from,to]);
          }
          pieces=row.filter(([p,q])=>q-p>=.1).map(([p,q])=>[{u:p,v},{u:q,v}]);
        }
      }
      if(opt.clipVisible)pieces=pieces.flatMap(opt.clipVisible);
      if(opt.zigzag){pieces.forEach(pts=>allPieces.push({n,pts}));continue;}
      // Odd lines run the other way, so neighboring lines make a back-and-forth sweep.
      if(n%2){pieces.reverse();pieces.forEach(line=>line.reverse());}
      pieces.forEach(line=>{flush();chain=line;flush();});
    }
    flush();
    if(opt.zigzag)chains.push(...joinPieces(allPieces));
    return chains.map(line=>line.map(q=>({x:q.u*c-q.v*s,y:q.u*s+q.v*c})));
  }
  const FILL_MODES=['hatch','cross','wavy','wavycross'];
  function hatchFills(paths,o,penOf,visibleOccluders=[],hiddenStats=null){
    const groups=new Map(),out=[];
    // Fill source: 'none' draws no fills, 'original' fills shapes that have a fill, 'all' fills every closed path.
    if(o.fillSource==='none')return {paths:[],overlaps:0};
    const fillAll=o.fillAll||o.fillSource==='all';
    for(const p of paths){
      if(!p.closed)continue;
      const color=p.fillColor||(fillAll?p.color:null);if(!color)continue;
      const pen=penOf(color),s=o.fills&&o.fills[pen];
      if(!(pen>0)||!s||s.mode==='none'||!s.mode)continue;
      const key=(p.group??p.id)+'|'+color;
      if(!groups.has(key))groups.set(key,{color,pen,s,name:p.name,group:p.group,contours:[],edge:0});
      groups.get(key).contours.push(p.points);
      // The gap is measured from the outer edge of the drawn outline to the center of a hatch line, so a gap of half
      // the pen width puts the hatch pen's edge just against the outline. The outline is centered on the region edge,
      // or, with each pen drawing its own outline just inside the region, moved in by the inset.
      if(o.mode==='plotter'&&penOf(p.color)>0&&!(o.skipUnstroked&&p.noStroke)){const w=penWidthOf(o,penOf(p.color)),d=(o.borders==='both'?(o.borderInset>0?o.borderInset:w/2):0)+w/2;groups.get(key).edge=Math.max(groups.get(key).edge,d);}
    }
    const boxes=[];
    for(const g of groups.values()){
      const s=g.s,wavy=s.mode==='wavy'||s.mode==='wavycross';
      if(!FILL_MODES.includes(s.mode))throw Error('Pen '+g.pen+' fill: unknown pattern.');
      if(!Number.isFinite(s.angle)||!(s.spacing>=.05&&s.spacing<=100)||!Number.isFinite(s.gap)||s.gap<0||s.gap>100)throw Error('Pen '+g.pen+' fill: angle must be a number, spacing 0.05-100 mm, gap 0-100 mm.');
      if(wavy&&(!(s.amp>=0&&s.amp<=20)||!(s.wavelength>=.5&&s.wavelength<=500)||!Number.isFinite(s.shift)))throw Error('Pen '+g.pen+' fill: wave height must be 0-20 mm, wavelength 0.5-500 mm, and the shift a number.');
      const box=bounds(g.contours.flat());
      const above=visibleOccluders.filter(occ=>occ.group>g.group&&occ.box.minX-s.gap<=box.maxX&&occ.box.maxX+s.gap>=box.minX&&occ.box.minY-s.gap<=box.maxY&&occ.box.maxY+s.gap>=box.minY);
      for(const angle of s.mode==='cross'||s.mode==='wavycross'?[s.angle,s.angle+90]:[s.angle]){
        const opt={wave:wavy,amp:s.amp,wavelength:s.wavelength,shift:s.shift,zigzag:!!s.zigzag};
        if(opt.zigzag&&above.length){
          const radians=angle*Math.PI/180,c=Math.cos(radians),sn=Math.sin(radians),budget={left:100000000};
          const world=p=>({x:p.u*c-p.v*sn,y:p.u*sn+p.v*c});
          const local=p=>({u:p.x*c+p.y*sn,v:-p.x*sn+p.y*c});
          opt.visibleAbove=above;
          opt.clipVisible=piece=>{
            const original=piece.map(world),clipped=clipHidden(original,false,above,budget,s.gap);
            if(!clipped)return [piece];
            if(hiddenStats){if(clipped.length)hiddenStats.trimmed++;else hiddenStats.removed++;}
            return clipped.map(line=>line.map(local));
          };
          // The same visibility and gap test used for hatch clipping also
          // checks the entire proposed connector, including tiny occluders.
          opt.linkVisible=(p,q)=>clipHidden([world(p),world(q)],false,above,budget,s.gap)===null;
        }
        for(const points of hatchLines(g.contours,angle,s.spacing,s.gap+g.edge,opt)){
          if(out.length>=100000)throw Error('Hatching would create more than 100,000 lines. Increase the fill spacing.');
          out.push({id:'f'+out.length,name:'Hatch '+g.name,color:g.color,closed:false,fill:true,group:g.group,gap:s.gap,visibleClipped:!!opt.clipVisible,points});
        }
      }
      boxes.push(box);
    }
    // Overlapping filled shapes are each hatched in full; there is no hidden-line removal yet.
    let overlaps=0;
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.minX<b.maxX&&b.minX<a.maxX&&a.minY<b.maxY&&b.minY<a.maxY)overlaps++;}
    return {paths:out,overlaps};
  }
  // ---- Hidden-line removal ----------------------------------------------
  // SVG paints later elements over earlier ones. Shapes that have a fill hide whatever
  // an element below them draws (outlines and hatch) inside their area (even-odd).
  function occluders(paths){
    const byGroup=new Map();
    for(const p of paths){
      if(!p.closed||!p.fillColor||p.group===undefined)continue;
      if(!byGroup.has(p.group))byGroup.set(p.group,{group:p.group,contours:[]});
      byGroup.get(p.group).contours.push(p.points);
    }
    // A covering shape can have tens of thousands of edges, so they are filed by height: a point or
    // segment only looks at the edges in its own height range, not at every edge of the shape.
    return [...byGroup.values()].map(o=>{
      const box=bounds(o.contours.flat()),binH=Math.max((box.maxY-box.minY)/500,.25),binCount=Math.max(1,Math.floor((box.maxY-box.minY)/binH)+1),bins=Array.from({length:binCount},()=>[]);
      const binOf=y=>Math.max(0,Math.min(binCount-1,Math.floor((y-box.minY)/binH)));
      for(const c of o.contours)for(let j=0;j<c.length;j++){
        const a=c[j],b=c[(j+1)%c.length];if(a.x===b.x&&a.y===b.y)continue;
        const e={a,b,ylo:Math.min(a.y,b.y),yhi:Math.max(a.y,b.y),xlo:Math.min(a.x,b.x),xhi:Math.max(a.x,b.x)};
        for(let k=binOf(e.ylo);k<=binOf(e.yhi);k++)bins[k].push(e);
      }
      return {...o,box,binOf,bins};
    });
  }
  // Even-odd: the point is covered when an odd number of edges lie to its right.
  const coveredBy=(occ,m)=>{
    if(!(m.x>=occ.box.minX&&m.x<=occ.box.maxX&&m.y>=occ.box.minY&&m.y<=occ.box.maxY))return false;
    let hit=false;
    for(const e of occ.bins[occ.binOf(m.y)])if((e.a.y>m.y)!==(e.b.y>m.y)&&m.x<(e.b.x-e.a.x)*(m.y-e.a.y)/(e.b.y-e.a.y)+e.a.x)hit=!hit;
    return hit;
  };
  const edgesInRange=(occ,y0,y1)=>{const seen=new Set(),out=[];for(let k=occ.binOf(y0);k<=occ.binOf(y1);k++)for(const e of occ.bins[k])if(!seen.has(e)){seen.add(e);out.push(e);}return out;};
  function cutParam(a,b,e0,e1){
    const dx=b.x-a.x,dy=b.y-a.y,ex=e1.x-e0.x,ey=e1.y-e0.y,den=dx*ey-dy*ex;
    if(Math.abs(den)<1e-12)return null;
    const t=((e0.x-a.x)*ey-(e0.y-a.y)*ex)/den,u=((e0.x-a.x)*dy-(e0.y-a.y)*dx)/den;
    return t>=0&&t<=1&&u>=0&&u<=1?t:null;
  }
  // Returns the visible pieces of a polyline, or null when nothing is hidden.
  // Interval of t in [0,1] where a point on segment a-b lies within g of edge e0-e1.
  function segmentCapsule(a,b,e0,e1,g){
    const L=dist(a,b),el=dist(e0,e1);if(L<1e-12||el<1e-12)return null;
    const dx=(b.x-a.x)/L,dy=(b.y-a.y)/L,uv=p=>({u:(p.x-a.x)*dx+(p.y-a.y)*dy,v:-(p.x-a.x)*dy+(p.y-a.y)*dx});
    const iv=capsule({a:uv(e0),b:uv(e1)},0,g);if(!iv)return null;
    const lo=Math.max(0,iv[0]/L),hi=Math.min(1,iv[1]/L);return lo<hi?[lo,hi]:null;
  }
  // True when some edge of the covering shape lies closer than r to the point.
  function nearerThanShape(occ,m,r){
    for(let k=occ.binOf(m.y-r);k<=occ.binOf(m.y+r);k++)for(const e of occ.bins[k]){
      if(m.y<e.ylo-r||m.y>e.yhi+r||m.x<e.xlo-r||m.x>e.xhi+r)continue;
      const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((m.x-e.a.x)*dx+(m.y-e.a.y)*dy)/l)):0;
      if(Math.hypot(m.x-e.a.x-t*dx,m.y-e.a.y-t*dy)<r)return true;
    }
    return false;
  }
  const EDGE_TOLERANCE=.03;
  // gap: stay this far from the covering shapes' outlines (used for hatch lines).
  function clipHidden(points,closed,occs,budget,gap=0){
    const pts=closed?[...points,points[0]]:points,pieces=[];let cur=null,changed=false;
    const flush=()=>{if(cur&&cur.length>1)pieces.push(cur);cur=null;};
    for(let i=0;i+1<pts.length;i++){
      const a=pts[i],b=pts[i+1],lo={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y)},hi={x:Math.max(a.x,b.x),y:Math.max(a.y,b.y)},near=occs.filter(o=>o.box.minX-gap<=hi.x&&o.box.maxX+gap>=lo.x&&o.box.minY-gap<=hi.y&&o.box.maxY+gap>=lo.y),ts=[0,1];
      for(const o of near){
        const edges=edgesInRange(o,lo.y-gap,hi.y+gap);
        budget.left-=edges.length+1;if(budget.left<0)throw Error('Hidden-line removal is too large. Increase the fill spacing or turn it off.');
        for(const e of edges){
          if(e.xhi<lo.x-gap||e.xlo>hi.x+gap)continue;
          const t=cutParam(a,b,e.a,e.b);if(t!==null)ts.push(t);
          if(gap>0){const iv=segmentCapsule(a,b,e.a,e.b,gap);if(iv)ts.push(iv[0],iv[1]);}
        }
      }
      ts.sort((x,y)=>x-y);
      for(let k=0;k+1<ts.length;k++){
        const t0=ts[k],t1=ts[k+1];if(t1-t0<1e-9)continue;
        const mid=(t0+t1)/2,m={x:a.x+(b.x-a.x)*mid,y:a.y+(b.y-a.y)*mid};
        // A line lying on the covering shape's own edge (shapes that share a boundary) stays visible; without
        // this, rounding noise along a shared edge chops the outline into many tiny pieces.
        if(near.some(o=>(coveredBy(o,m)&&!nearerThanShape(o,m,EDGE_TOLERANCE))||(gap>0&&nearerThanShape(o,m,gap-1e-7)))){flush();changed=true;continue;}
        const p0=t0===0?a:{x:a.x+(b.x-a.x)*t0,y:a.y+(b.y-a.y)*t0},p1=t1===1?b:{x:a.x+(b.x-a.x)*t1,y:a.y+(b.y-a.y)*t1};
        if(cur&&dist(cur.at(-1),p0)<1e-9)cur.push(p1);else{flush();cur=[p0,p1];}
      }
    }
    flush();
    if(!changed)return null;
    // A closed outline whose seam is visible comes back as one piece, not two.
    if(closed&&pieces.length>1&&dist(pieces[0][0],pts[0])<1e-9&&dist(pieces.at(-1).at(-1),pts[0])<1e-9){const last=pieces.pop();pieces[0]=last.concat(pieces[0].slice(1));}
    return pieces.filter(q=>length(q)>=.05);
  }
  function hideCovered(list,occs,stats,budget){
    const out=[];
    for(const p of list){
      if(p.visibleClipped){out.push(p);continue;}
      const above=p.group===undefined?[]:occs.filter(o=>o.group>p.group);
      const pieces=above.length?clipHidden(p.points,p.closed,above,budget,p.gap||0):null;
      if(!pieces){out.push(p);continue;}
      if(!pieces.length){stats.removed++;continue;}
      stats.trimmed++;
      pieces.forEach((points,k)=>out.push({...p,id:p.id+'.'+k,closed:false,points}));
    }
    return out;
  }
  // ---- Shared boundaries from overlapping fills -------------------------
  // Some traced SVGs store a small region only as a fill painted over a much
  // larger region.  In that case the lower region has no source contour at
  // the visible color boundary, so ordinary duplicate-line handling cannot
  // give it a border.  Walk the visible side of every filled contour and add
  // the missing neighboring-region candidate before pen filtering.
  function sharedBoundaryOutlines(paths,o,penOf,stats,insetOffsets=new Map()){
    if(o.mode!=='plotter'||!['one','both'].includes(o.borders))return [];
    const regions=occluders(paths).map(region=>{
      const source=paths.find(p=>p.group===region.group&&p.fillColor);
      return source?{...region,color:source.color,fillColor:source.fillColor,noStroke:source.noStroke,source}:null;
    }).filter(Boolean).sort((a,b)=>a.group-b.group);
    if(regions.length<2)return [];
    const edgeDistance=(p,a,b)=>{
      const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
      return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
    };
    const edgeMatches=(region,a,b,tol)=>{
      const lo={x:Math.min(a.x,b.x)-tol,y:Math.min(a.y,b.y)-tol},hi={x:Math.max(a.x,b.x)+tol,y:Math.max(a.y,b.y)+tol};
      for(const e of edgesInRange(region,lo.y,hi.y)){
        if(e.xhi<lo.x||e.xlo>hi.x)continue;
        const dx=b.x-a.x,dy=b.y-a.y,ex=e.b.x-e.a.x,ey=e.b.y-e.a.y,ll=Math.hypot(dx,dy)*Math.hypot(ex,ey);
        if(ll<1e-12||Math.abs(dx*ey-dy*ex)/ll>.08)continue;
        if([.2,.5,.8].every(t=>edgeDistance({x:a.x+dx*t,y:a.y+dy*t},e.a,e.b)<=tol))return true;
      }
      return false;
    };
    const topAt=point=>{for(let i=regions.length-1;i>=0;i--)if(coveredBy(regions[i],point))return regions[i];return null;};
    const candidate=[];
    const tolerance=Math.max(EDGE_TOLERANCE,Math.min(.1,(o.tolerance||.01)*3));
    let run=null;
    const flush=()=>{
      if(!run)return;
      const {source,target,side,offset}=run,raw=run.points;
      const closed=raw.length>2&&dist(raw[0],raw.at(-1))<1e-6;
      const points=closed?raw.slice(0,-1):raw;
      const shifted=offset?offsetPath(points,closed,side*offset):points;
      if(shifted&&shifted.length>=(closed?3:2)){
        candidate.push({id:'shared-'+source.group+'-'+candidate.length,name:'Shared border '+source.name+' / '+target.source.name,color:target.color,fillColor:target.fillColor,noStroke:target.noStroke,group:undefined,closed,derivedShared:true,points:shifted});
        stats.count++;
      }
      run=null;
    };
    const append=(source,target,a,b,side,offset)=>{
      const pen=penOf(target.color);if(!(pen>0)||!target.fillColor)return false;
      if(o.skipUnstroked&&target.noStroke)return false;
      if(offset>0&&edgeMatches(target,a,b,tolerance))return false;
      if(dist(a,b)<1e-9)return false;
      if(!run||run.source!==source||run.target!==target||run.side!==side||run.offset!==offset||dist(run.points.at(-1),a)>1e-6){
        flush();run={source,target,side,offset,points:[a,b]};
      }else run.points.push(b);
      return true;
    };
    for(const source of paths){
      if(!source.closed||!source.fillColor||source.group===undefined||source.points.length<3)continue;
      for(let i=0;i<source.points.length;i++){
        const a=source.points[i],b=source.points[(i+1)%source.points.length],dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy);if(L<1e-9)continue;
        const lo={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y)},hi={x:Math.max(a.x,b.x),y:Math.max(a.y,b.y)},ts=[0,1];
        for(const region of regions){
          if(region.group===source.group||region.box.maxX<lo.x||region.box.minX>hi.x||region.box.maxY<lo.y||region.box.minY>hi.y)continue;
          for(const e of edgesInRange(region,lo.y,hi.y)){
            if(e.xhi<lo.x||e.xlo>hi.x)continue;
            const t=cutParam(a,b,e.a,e.b);if(t!==null&&t>1e-7&&t<1-1e-7)ts.push(t);
          }
        }
        ts.sort((x,y)=>x-y);const cuts=[];for(const t of ts)if(!cuts.length||t-cuts.at(-1)>1e-7)cuts.push(t);
        for(let k=0;k+1<cuts.length;k++){
          const t0=cuts[k],t1=cuts[k+1];if(t1-t0<1e-7)continue;
           const p0={x:a.x+dx*t0,y:a.y+dy*t0},p1={x:a.x+dx*t1,y:a.y+dy*t1},m={x:a.x+dx*(t0+t1)/2,y:a.y+dy*(t0+t1)/2},nx=-dy/L,ny=dx/L;
           // A fixed 0.25 mm side probe can jump across a thin letter stroke
           // and see its yellow background on both sides. Walk the probe in
           // toward the boundary until one side is this source region.
           let left=null,right=null,probe=Math.min(.25,Math.max(.04,L*.1));
           for(let attempt=0;attempt<8;attempt++,probe*=.5){
             left=topAt({x:m.x+nx*probe,y:m.y+ny*probe});right=topAt({x:m.x-nx*probe,y:m.y-ny*probe});
             if(left&&right&&left.group!==right.group&&(left.group===source.group||right.group===source.group))break;
           }
           if(!left||!right||left.group===right.group||left.color===right.color){flush();continue;}
           if(left.group!==source.group&&right.group!==source.group){flush();continue;}
          const target=left.group===source.group?right:left,side=left.group===source.group?-1:1;
           let offset=0;
           if(o.borders==='both'){
             offset=o.borderInset>0?o.borderInset:penWidthOf(o,penOf(target.color))*.5;
             // If a narrow source needed less inset to keep its own outline,
             // shift the companion farther into the neighboring region. This
             // keeps its ink outside the source pen's physical stroke.
             if(penOf(source.color)>0&&insetOffsets.has(source.id)){
               const sourceHalf=penWidthOf(o,penOf(source.color))*.5;
               offset+=Math.max(0,sourceHalf-insetOffsets.get(source.id));
             }
           }
           if(!append(source,target,p0,p1,side,offset))flush();
        }
      }
      flush();
    }
    return candidate;
  }
  // ---- Thick lines --------------------------------------------------------
  // A pen with a line thickness larger than its pen width draws each outline as a band of
  // parallel strokes (offset copies of the path), spaced one pen width apart.
  const penWidthOf=(o,pen)=>{const w=o.penWidths&&o.penWidths[pen];return w>0?w:(o.penWidth>0?o.penWidth:.5);};
  function offsetPath(points,closed,d){
    const pts=points.filter((q,i,a)=>i===0||dist(q,a[i-1])>1e-9);
    if(closed&&pts.length>1&&dist(pts[0],pts.at(-1))<1e-9)pts.pop();
    const n=pts.length;if(n<2||(closed&&n<3))return null;
    const count=closed?n:n-1,normals=[];
    for(let i=0;i<count;i++){const a=pts[i],b=pts[(i+1)%n],l=dist(a,b);normals.push({x:-(b.y-a.y)/l,y:(b.x-a.x)/l});}
    const out=[];
    for(let i=0;i<n;i++){
      const p=pts[i],prev=closed?normals[(i+count-1)%count]:(i>0?normals[i-1]:null),next=closed?normals[i%count]:(i<count?normals[i]:null);
      if(!prev||!next){const m=prev||next;out.push({x:p.x+m.x*d,y:p.y+m.y*d});continue;}
      const k=1+prev.x*next.x+prev.y*next.y;
      // On the inside of a turn the two offset lines cross, and that crossing is the right corner however
      // sharp it is (the tip of an inset star). Only on the outside of a turn would a very sharp corner
      // spike outward, so only there is it beveled instead of mitered.
      const inner=d*(prev.x*next.y-prev.y*next.x)>0;
      if(!inner&&k<.25){
        // Around a sharp outside corner the true offset is a circular arc of radius |d|; a straight bevel would dip
        // closer to the original corner than the offset distance.
        const turn=Math.atan2(prev.x*next.y-prev.y*next.x,prev.x*next.x+prev.y*next.y),steps=Math.max(1,Math.ceil(Math.abs(turn)/(Math.PI/12))),a0=Math.atan2(prev.y,prev.x);
        for(let i=0;i<=steps;i++){const a=a0+turn*i/steps;out.push({x:p.x+Math.cos(a)*d,y:p.y+Math.sin(a)*d});}
      }
      else if(k>1e-6){
        // Miter point along the bisector; on the inside of an extremely sharp turn (a hairpin) the lines
        // cross far away, so the tip is cut off at six offsets from the corner.
        const scale=Math.min(Math.sqrt(2/k),6)*Math.abs(d)/Math.hypot(prev.x+next.x,prev.y+next.y),sign=d<0?-1:1;
        out.push({x:p.x+(prev.x+next.x)*scale*sign,y:p.y+(prev.y+next.y)*scale*sign});
      }else out.push({x:p.x+prev.x*d,y:p.y+prev.y*d});
    }
    return out;
  }
  // Offsetting past a tight curve or across a narrow neck folds the line over itself into small loops.
  // Find where the closed line crosses itself and cut out each loop that runs against the shape's own
  // direction, or that is too small to matter (`sign` is +1 for a counter-clockwise shape, -1 for clockwise).
  // Two sizeable pieces that both run the right way are a genuine pinch (a narrow neck closing), and
  // come back as two separate outlines. Always returns a list of closed outlines.
  function removeLoops(points,sign,minArea=.01,depth=0){
    const area=pts=>pts.reduce((sum,a,i)=>{const b=pts[(i+1)%pts.length];return sum+a.x*b.y-b.x*a.y;},0)/2;
    const orient=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const junk=a=>a*sign<0||Math.abs(a)<minArea;   // inverted, or too small to draw (under the offset squared)
    let pts=points;
    for(let pass=0;pass<1000;pass++){
      const m=pts.length;let next=null,split=null;
      const box=pts.map((a,i)=>{const b=pts[(i+1)%m];return [Math.min(a.x,b.x),Math.max(a.x,b.x),Math.min(a.y,b.y),Math.max(a.y,b.y)];});
      search:for(let i=0;i<m;i++)for(let j=i+2;j<m;j++){
        if(i===0&&j===m-1)continue;
        const A=box[i],B=box[j];if(A[1]<B[0]||B[1]<A[0]||A[3]<B[2]||B[3]<A[2])continue;
        const a=pts[i],b=pts[(i+1)%m],c=pts[j],d=pts[(j+1)%m],o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
        if(!(o1*o2<0&&o3*o4<0))continue;
        const t=o3/(o3-o4),x={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
        const loop=[x,...pts.slice(i+1,j+1)],rest=[...pts.slice(0,i+1),x,...pts.slice(j+1)],al=area(loop),ar=area(rest),jl=junk(al),jr=junk(ar);
        // drop the inverted or negligible piece; if both qualify drop the smaller; if neither does, move on to the next crossing
        if(jl&&(!jr||Math.abs(al)<=Math.abs(ar))){next=rest;break search;}
        if(jr){next=loop;break search;}
        split=[loop,rest];break search;
      }
      if(split)return depth<8?[...removeLoops(split[0],sign,minArea,depth+1),...removeLoops(split[1],sign,minArea,depth+1)]:[pts];
      if(!next)break;
      pts=next;if(pts.length<3)return [];
    }
    return [pts];
  }
  function thicken(list,o,penOf,stats){
    const out=[];
    for(const p of list){
      const pen=penOf(p.color),t=o.penThickness&&o.penThickness[pen],w=penWidthOf(o,pen);
      if(!(t>w+1e-9)){out.push(p);continue;}
      let half=(t-w)/2;
      if(p.closed){ // an inward offset larger than the shape's own thickness would turn it inside out
        const perimeter=length([...p.points,p.points[0]]),limit=perimeter>0?1.8*area(p.points)/perimeter:0;
        if(half>limit){half=limit;stats.clamped++;}
      }
      const strokes=Math.max(2,Math.ceil(2*half/w-1e-9)+1);
      const made=[];
      for(let k=0;k<strokes;k++){
        const points=offsetPath(p.points,p.closed,-half+k*(2*half)/(strokes-1));
        if(points)made.push({...p,id:p.id+'~'+k,points});
      }
      if(!made.length){out.push(p);continue;}
      stats.bands++;stats.strokes+=made.length;out.push(...made);
    }
    return out;
  }
  // ---- Borders inside their own regions -------------------------------------
  // Neighboring regions share a border. Instead of one pen keeping it, each region's outline can move
  // a little way into its own area (half a pen width by default), so the two pens' lines sit side
  // by side instead of on top of each other.
  function insetOutlines(list,o,penOf,stats,insetOffsets=new Map()){
    const signed=pts=>pts.reduce((sum,a,i)=>{const b=pts[(i+1)%pts.length];return sum+a.x*b.y-b.x*a.y;},0)/2;
    const groups=new Map();
    list.forEach((p,i)=>{
      if(!p.closed||!p.fillColor||p.group===undefined||!(penOf(p.color)>0))return;
      if(!groups.has(p.group))groups.set(p.group,[]);groups.get(p.group).push(i);
    });
    const replaced=new Map();
    for(const indexes of groups.values()){
      const boxes=indexes.map(i=>bounds(list[i].points));
      indexes.forEach((i,a)=>{
        const p=list[i],r=boxes[a];
        // Even-odd depth within the same shape: an outer edge has its fill inside, a hole's edge has it outside.
        let depth=0;
        indexes.forEach((j,b)=>{
          if(a===b)return;const q=boxes[b];
          if(r.minX<q.minX||r.maxX>q.maxX||r.minY<q.minY||r.maxY>q.maxY)return;
          if(inside(p.points[0],list[j].points))depth++;
        });
        const area0=signed(p.points),inward=depth%2===0,perimeter=length([...p.points,p.points[0]]);
        let d=o.borderInset>0?o.borderInset:penWidthOf(o,penOf(p.color))/2;
        // A thin region cannot move in by more than part of its own width.
        if(inward)d=Math.min(d,.9*Math.abs(area0)/Math.max(perimeter,1e-9));
        if(!(d>1e-6)){stats.skipped++;insetOffsets.set(p.id,0);return;}
        const shifted=amount=>{
          const raw=offsetPath(p.points,true,(inward?1:-1)*(area0>0?1:-1)*amount);
          const pieces=(raw?removeLoops(raw,area0>0?1:-1,Math.max(amount*amount,.01)):[]).filter(pc=>pc.length>=3);
          const movedArea=pieces.reduce((sum,pc)=>sum+Math.abs(signed(pc)),0);
          return pieces.length&&(inward?movedArea>0&&movedArea<Math.abs(area0):movedArea>Math.abs(area0))?pieces:[];
        };
        let pieces=shifted(d);
        // A full-width inset can erase a thin letter stem or narrow neck while
        // leaving the rest of its contour intact. Retry only that contour at
        // successively smaller insets; the actual 0.5 mm pen still draws it.
        // Keep normal insets wherever they retain the source contour.
        const keptLength=pieces.reduce((sum,pc)=>sum+length([...pc,pc[0]]),0);
        const materialLoss=perimeter-keptLength>Math.max(.5,4*penWidthOf(o,penOf(p.color)));
        if(inward&&(!pieces.length||(materialLoss&&keptLength<perimeter*.88))){
          let best=pieces,bestD=d,bestLength=keptLength;
          for(let k=0;k<3;k++){
            const trialD=d/Math.pow(2,k+1),trial=shifted(trialD);
            const trialLength=trial.reduce((sum,pc)=>sum+length([...pc,pc[0]]),0);
            if(trialLength>bestLength+1e-6){best=trial;bestD=trialD;bestLength=trialLength;}
            if(bestLength>=perimeter*.97)break;
          }
          if(bestD!==d){d=bestD;pieces=best;stats.recovered=(stats.recovered||0)+1;}
        }
        if(!pieces.length){stats.skipped++;insetOffsets.set(p.id,0);return;}
        insetOffsets.set(p.id,d);
        replaced.set(i,pieces.map((points,k)=>({...p,id:k?p.id+'^'+k:p.id,points})));stats.count++;
      });
    }
    return list.flatMap((p,i)=>replaced.get(i)||[p]);
  }
  const relLuminance=hex=>{
    const n=parseInt((hex||'#000000').slice(1),16),f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};
    return .2126*f(n>>16&255)+.7152*f(n>>8&255)+.0722*f(n&255);
  };
  // ---- Duplicate lines ----------------------------------------------------
  // Artwork often stores a shared border twice, once for each neighboring shape, so two pens (or one
  // pen twice) would plot exactly the same line. Walking the paths in plotting order, each path loses
  // the parts that lie within `tol` of a line that is already going to be drawn.
  function dedupeOutlines(list,rankOf,tol,stats){
    const cell=Math.max(tol*8,1),grid=new Map(),key=(x,y)=>x+','+y;let stamp=0;
    const addPath=(pts,closed)=>{
      const n=closed?pts.length:pts.length-1;
      for(let i=0;i<n;i++){
        const a=pts[i],b=pts[(i+1)%pts.length];if(a.x===b.x&&a.y===b.y)continue;
        const seg={a,b,lox:Math.min(a.x,b.x),hix:Math.max(a.x,b.x),loy:Math.min(a.y,b.y),hiy:Math.max(a.y,b.y),mark:0};
        for(let x=Math.floor((seg.lox-tol)/cell);x<=Math.floor((seg.hix+tol)/cell);x++)for(let y=Math.floor((seg.loy-tol)/cell);y<=Math.floor((seg.hiy+tol)/cell);y++){
          const k=key(x,y);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(seg);
        }
      }
    };
    const clip=(points,closed)=>{
      const pts=closed?[...points,points[0]]:points,pieces=[];let cur=null,changed=false,removedLength=0;
      const done=()=>{if(cur&&cur.length>1)pieces.push(cur);cur=null;};
      for(let i=0;i+1<pts.length;i++){
        const a=pts[i],b=pts[i+1],lox=Math.min(a.x,b.x)-tol,hix=Math.max(a.x,b.x)+tol,loy=Math.min(a.y,b.y)-tol,hiy=Math.max(a.y,b.y)+tol,L=dist(a,b),covered=[];
        stamp++;
        if(L>1e-12)for(let x=Math.floor(lox/cell);x<=Math.floor(hix/cell);x++)for(let y=Math.floor(loy/cell);y<=Math.floor(hiy/cell);y++){
          for(const e of grid.get(key(x,y))||[]){
            if(e.mark===stamp)continue;e.mark=stamp;
            if(e.hix<lox||e.lox>hix||e.hiy<loy||e.loy>hiy)continue;
            const iv=segmentCapsule(a,b,e.a,e.b,tol);if(iv)covered.push(iv);
          }
        }
        // Visible parts of this segment = the gaps between the covered intervals.
        covered.sort((u,v)=>u[0]-v[0]);
        const visible=[];let at=0;
        for(const [lo,hi] of covered){if(lo>at)visible.push([at,lo]);at=Math.max(at,hi);}
        if(at<1)visible.push([at,1]);
        const seen=visible.reduce((sum,[lo,hi])=>sum+(hi-lo),0);
        if(seen<1-1e-9){changed=true;removedLength+=(1-seen)*L;}
        for(const [t0,t1] of visible){
          if(t1-t0<1e-9)continue;
          const p0=t0===0?a:{x:a.x+(b.x-a.x)*t0,y:a.y+(b.y-a.y)*t0},p1=t1===1?b:{x:a.x+(b.x-a.x)*t1,y:a.y+(b.y-a.y)*t1};
          if(cur&&dist(cur.at(-1),p0)<1e-9)cur.push(p1);else{done();cur=[p0,p1];}
        }
        if(!visible.length||visible.at(-1)[1]<1)done();
      }
      done();
      if(!changed)return null;
      if(closed&&pieces.length>1&&dist(pieces[0][0],pts[0])<1e-9&&dist(pieces.at(-1).at(-1),pts[0])<1e-9){const last=pieces.pop();pieces[0]=last.concat(pieces[0].slice(1));}
      stats.length+=removedLength;
      return pieces.filter(q=>length(q)>=.05);
    };
    const order=list.map((_,i)=>i).sort((x,y)=>rankOf(list[x].pen)-rankOf(list[y].pen)||x-y),result=new Array(list.length);
    for(const index of order){
      const p=list[index];
      if(p.fill){result[index]=[p];continue;}
      const pieces=clip(p.points,p.closed);
      if(!pieces){result[index]=[p];addPath(p.points,p.closed);continue;}
      if(!pieces.length){stats.removed++;result[index]=[];continue;}
      stats.trimmed++;
      result[index]=pieces.map((points,k)=>({...p,id:p.id+'%'+k,closed:false,points,area:0}));
      for(const q of pieces)addPath(q,false);
    }
    return result.flat();
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
    // Pens: every color maps to a pen number (0 = skip). Only plotter mode has pens.
    const penMap=o.mode==='plotter'&&o.penMap&&typeof o.penMap==='object'?o.penMap:null;
    if(penMap)for(const [color,pen] of Object.entries(penMap))if(!Number.isSafeInteger(pen)||pen<0)throw Error('Pen numbers must be nonnegative whole numbers (0 = skip) for '+color+'.');
    const penOf=c=>penMap?(Object.hasOwn(penMap,c)?penMap[c]:1):1;
    const plotter=o.mode==='plotter';
    if(plotter&&o.penThickness)for(const [pen,t] of Object.entries(o.penThickness))if(!Number.isFinite(t)||t<0||t>50)throw Error('Line thickness for pen '+pen+' must be 0-50 mm.');
    if(o.borders!==undefined&&!['one','both'].includes(o.borders))throw Error('Shared borders: choose one pen or both pens.');
    if(o.borderInset!==undefined&&!(Number.isFinite(o.borderInset)&&o.borderInset>=0&&o.borderInset<=5))throw Error('Border inset must be 0-5 mm.');
    const inset={count:0,skipped:0,recovered:0},insetOffsets=new Map(),shared={count:0};
    let filled={paths:[],overlaps:0};
    let outlines=transformed.paths;const hiding={trimmed:0,removed:0},thick={bands:0,strokes:0,clamped:0};
    // Inset before hidden-line removal. Clipping the original outlines first turns covered
    // contours into open paths, which cannot receive the second (neighboring-pen) outline.
    // The inset line is already inside its own region, so hidden-line removal can still trim
    // the visible part without losing the both-pens border treatment.
    const visibleOccluders=plotter&&o.hideCovered?occluders(transformed.paths):[];
    if(plotter&&o.borders==='both')outlines=insetOutlines(outlines,o,penOf,inset,insetOffsets);
    if(plotter&&o.hideCovered){
      const budget={left:100000000};
      outlines=hideCovered(outlines,visibleOccluders,hiding,budget);
    }
    if(plotter&&o.borders)outlines=outlines.concat(sharedBoundaryOutlines(transformed.paths,o,penOf,shared,insetOffsets));
    // Build hatches only after visible/shared border geometry is known. They are
    // still clipped below by the same covering shapes, but their edge clearance
    // now reflects the final border mode rather than preceding it.
    if(plotter)filled=hatchFills(transformed.paths,o,penOf,visibleOccluders,hiding);
    if(plotter&&o.hideCovered){
      const budget={left:100000000};
      filled.paths=hideCovered(filled.paths,visibleOccluders,hiding,budget);
    }
    if(plotter&&o.penThickness)outlines=thicken(outlines,o,penOf,thick);
    // Stage orders outlines against hatch within a pen: lower stages are cut first.
    const initial=outlines.filter(p=>!(plotter&&o.skipUnstroked&&p.noStroke&&p.fillColor)).map(p=>({...p,stage:o.fillFirst?2:1,pen:penOf(p.color),area:p.closed?area(p.points):0}))
      .concat(filled.paths.map(f=>({...f,stage:o.fillFirst?1:2,pen:penOf(f.color),area:0}))).filter(p=>p.pen>0);
    // Pen sequence for the fixed orders (the nearest-pen order is decided as the plot is built).
    if(o.penOrder!==undefined&&!['number','light','dark','near'].includes(o.penOrder))throw Error('Unknown pen order.');
    // How light a pen is: the average luminance of its display colors.
    const penShade=(list,pen)=>{const colors=list.filter(p=>p.pen===pen).map(p=>(o.penColors||{})[p.color]||p.color);return colors.reduce((sum,c)=>sum+relLuminance(c),0)/colors.length;};
    const staticPenOrder=list=>{
      const pens=[...new Set(list.map(p=>p.pen))].sort((a,b)=>a-b);
      if(o.penOrder==='light'||o.penOrder==='dark'){
        const dir=o.penOrder==='light'?-1:1,shades=new Map(pens.map(pen=>[pen,penShade(list,pen)]));
        pens.sort((a,b)=>(shades.get(a)-shades.get(b))*dir||a-b);
      }
      return pens;
    };
    if(plotter&&o.dedupeTol!==undefined&&!(Number.isFinite(o.dedupeTol)&&o.dedupeTol>=0&&o.dedupeTol<=2))throw Error('Merge duplicate lines must be 0-2 mm.');
    if(o.dedupeKeep!==undefined&&!['first','last','dark','light'].includes(o.dedupeKeep))throw Error('A shared line is kept by the darkest, lightest, first or last pen.');
    const merged={trimmed:0,removed:0,length:0,emptied:[]};
    let remaining=initial;
    if(plotter&&o.dedupeTol>0&&initial.length){
      // One pen keeps a line two pens would both draw: the darkest or lightest pen, or the one plotted first (default) or last.
      const keep=o.dedupeKeep||'first';
      let ranks;
      if(keep==='dark'||keep==='light'){
        const pens=[...new Set(initial.map(p=>p.pen))],shades=new Map(pens.map(pen=>[pen,penShade(initial,pen)]));
        pens.sort((a,b)=>(shades.get(a)-shades.get(b))*(keep==='dark'?1:-1)||a-b);
        ranks=new Map(pens.map((pen,i)=>[pen,i]));
      }else ranks=new Map(staticPenOrder(initial).map((pen,i)=>[pen,keep==='last'?-i:i]));
      remaining=dedupeOutlines(initial,pen=>ranks.get(pen),o.dedupeTol,merged);
      merged.emptied=[...new Set(initial.map(p=>p.pen))].filter(pen=>!remaining.some(p=>p.pen===pen)).sort((a,b)=>a-b);
    }
    if(!remaining.length) throw Error(hiding.removed?'Hidden-line removal left nothing to draw.':penMap?'Every color is set to Skip. Assign at least one color to a pen.':'No paths selected.');
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
    // Bounding boxes are computed once per contour, and an outer edge is only compared against
    // the inner contour when it can reach the inner contour's box, so a drawing with hundreds of
    // detailed shapes stays fast.
    const boxes=new Map([...contours].map(([id,pts])=>[id,bounds(pts)]));
    if(o.inner) for(const outer of remaining.filter(p=>p.closed)) for(const child of remaining) {
      if(outer===child||outer.pen!==child.pen||outer.fill||child.fill)continue;
      const a=boxes.get(outer.id),b=boxes.get(child.id);
      if(b.minX<=a.minX||b.maxX>=a.maxX||b.minY<=a.minY||b.maxY>=a.maxY)continue;
      const op=contours.get(outer.id),cp=contours.get(child.id);
      if(!inside(cp[0],op))continue;
      let crossing=false;
      for(let i=0;i<op.length&&!crossing;i++){
        const p0=op[i],p1=op[(i+1)%op.length];
        if(Math.max(p0.x,p1.x)<b.minX||Math.min(p0.x,p1.x)>b.maxX||Math.max(p0.y,p1.y)<b.minY||Math.min(p0.y,p1.y)>b.maxY)continue;
        for(let j=0;j<cp.length-(child.closed?0:1);j++){
          if(++comparisons>50000000)throw Error('Containment calculation is too large. Increase sampling spacing or disable inner-first.');
          if(intersects(p0,p1,cp[j],cp[(j+1)%cp.length])){crossing=true;break;}
        }
      }
      if(!crossing)before.get(outer.id).add(child.id);
    }
    let position={x:0,y:0},travel=0;const ordered=[],done=new Set();
    // Each pen is cut completely before the next; ordering and "largest last" apply within a pen.
    // Pen order: by number (default), light to dark, dark to light, or whichever pen starts nearest next.
    const pens=[],pending=staticPenOrder(remaining);
    const nearestStart=pen=>{
      let best=Infinity;
      for(const p of remaining)if(p.pen===pen){
        const options=p.closed?(o.start==='auto'?p.points:[p.points[0]]):(o.reverse?[p.points[0],p.points.at(-1)]:[p.points[0]]);
        for(const q of options)best=Math.min(best,dist(position,q));
      }
      return best;
    };
    while(pending.length){
    let pick=0;
    if(o.penOrder==='near')pending.forEach((pn,i)=>{if(nearestStart(pn)<nearestStart(pending[pick])-1e-9)pick=i;});
    const pen=pending.splice(pick,1)[0];pens.push(pen);
    const rest=remaining.filter(p=>p.pen===pen);
    const largest=o.largest?rest.filter(p=>p.closed).reduce((a,p)=>!a||p.area>a.area?p:a,null):null;
    // Thousands of hatch paths make this loop hot, so it avoids rescanning or copying every remaining path:
    // the lowest stage is tracked with counts, and "original order" stops at the first ready path.
    const stageCounts=new Map();rest.forEach(p=>stageCounts.set(p.stage,(stageCounts.get(p.stage)||0)+1));
    let stage=Math.min(...stageCounts.keys());
    while(rest.length) {
      const ready=p=>(before.get(p.id).size===0||[...before.get(p.id)].every(id=>done.has(id))) && (p!==largest||rest.length===1);
      // "Reduce travel" orders outlines; hatch keeps its line-by-line sweep, which is already short and cheap.
      const nearestNow=o.order==='nearest'&&stage!==(o.fillFirst?1:2);
      let candidates;
      if(nearestNow){candidates=rest.filter(p=>p.stage===stage&&ready(p));if(!candidates.length)candidates=rest.filter(ready);}
      else{const first=rest.find(p=>p.stage===stage&&ready(p))||rest.find(ready);candidates=first?[first]:[];}
      if(!candidates.length) throw Error('Path-order constraints conflict. Disable largest-last or inner-first.');
      let best;
      if(nearestNow){
        // Closed paths and picked starts need the full orientation; a plain open path's start is just an end.
        const startOf=p=>{
          if(p.closed||locks[p.id]!==undefined||directions[p.id]!==undefined){const q=orient(p,position,o,locks,directions);return {q,point:q.points[0]};}
          const f=p.points[0],l=p.points.at(-1);return {q:null,point:o.start==='auto'&&o.reverse&&dist(position,l)<dist(position,f)?l:f};
        };
        let chosen=candidates[0],chosenStart=startOf(chosen);
        for(const p of candidates.slice(1)){const st=startOf(p);if(dist(position,st.point)<dist(position,chosenStart.point)){chosen=p;chosenStart=st;}}
        best=chosenStart.q||orient(chosen,position,o,locks,directions);
      }else best=orient(candidates[0],position,o,locks,directions);
      best=overlap(best,o.overlap);
      travel+=dist(position,best.points[0]);
      // Additional passes return to the same start with the tool raised/off.
      travel+=dist(best.points.at(-1),best.points[0])*(z.length-1);
      best.number=ordered.length+1;ordered.push(best);position=best.points.at(-1);done.add(best.id);rest.splice(rest.findIndex(p=>p.id===best.id),1);
      const left=stageCounts.get(best.stage)-1;if(left)stageCounts.set(best.stage,left);else{stageCounts.delete(best.stage);if(stageCounts.size)stage=Math.min(...stageCounts.keys());}
    }
    }
    if(ordered.reduce((n,p)=>n+p.points.length*z.length,0)>1000000)throw Error('Output exceeds one million moves. Reduce passes or increase sampling spacing.');
    const job={paths:ordered,pens,thick,merged,inset,shared,fills:filled.paths.length,fillOverlaps:o.hideCovered?0:filled.overlaps,hidden:hiding,depths:z,bounds:bounds(ordered.flatMap(p=>p.points)),origin:transformed.origin,travel,cut:ordered.reduce((n,p)=>n+length(p.points)*z.length,0)};
    if(plotter&&o.regCross){
      const margin=o.regMargin??8,marginY=o.regMarginY??margin,size=o.regSize??6,corner=o.regCorner||'bl';
      if(!(Number.isFinite(margin)&&margin>=0&&margin<=200&&Number.isFinite(marginY)&&marginY>=0&&marginY<=200))throw Error('Registration cross distance must be 0-200 mm.');
      if(!['bl','br','tl','tr'].includes(corner))throw Error('Registration cross corner: choose bottom or top, left or right.');
      if(!(Number.isFinite(size)&&size>0&&size<=50))throw Error('Registration cross size must be 0-50 mm.');
      // Outside the chosen corner of the artwork (default bottom left), at known work coordinates, so the same G10 L20 command works for every pen.
      // Measured from the artwork as imported, not from what is drawn: moving outlines inside their regions (or hiding
      // covered lines) would otherwise shift the cross by a fraction of a millimeter.
      const art=bounds(transformed.paths.flatMap(p=>p.points));
      job.registration={x:corner[1]==='l'?art.minX-margin:art.maxX+margin,y:corner[0]==='b'?art.minY-marginY:art.maxY+marginY,size};
    }
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
  // ---- Color grouping ----------------------------------------------------
  // k-means on colors in CIE Lab, so distances follow how different colors look.
  // Weighted by how much artwork uses each color; deterministic (no random start).
  function lab(hex){
    const n=parseInt(hex.slice(1),16),lin=v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);};
    const r=lin(n>>16&255),g=lin(n>>8&255),b=lin(n&255);
    const x=(.4124564*r+.3575761*g+.1804375*b)/.95047,y=.2126729*r+.7151522*g+.072175*b,z=(.0193339*r+.119192*g+.9503041*b)/1.08883;
    const f=t=>t>216/24389?Math.cbrt(t):(24389/27*t+16)/116;
    return [116*f(y)-16,500*(f(x)-f(y)),200*(f(y)-f(z))];
  }
  const labDist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  // Deterministic weighted k-means. After the heaviest color, a candidate's seed score is
  // its visual use multiplied by squared distance from the nearest existing center. This
  // keeps a tiny outlier shade from consuming a whole pen ahead of a major artwork color.
  function kmeans(pts,k){
    let centers=[pts.reduce((a,p)=>p.weight>a.weight?p:a).lab];
    while(centers.length<k){
      let best=null,far=-1;
      for(const p of pts){const d=Math.min(...centers.map(c=>labDist(c,p.lab))),score=p.weight*d*d;if(score>far){far=score;best=p;}}
      centers.push(best.lab);
    }
    let owner=new Array(pts.length).fill(-1);
    for(let round=0;round<100;round++){
      const next=pts.map(p=>{let bi=0,bd=Infinity;centers.forEach((c,i)=>{const d=labDist(c,p.lab);if(d<bd-1e-12){bd=d;bi=i;}});return bi;});
      const changed=next.some((v,i)=>v!==owner[i]);owner=next;
      centers=centers.map((c,i)=>{
        const members=pts.filter((_,j)=>owner[j]===i);if(!members.length)return c;
        const w=members.reduce((s,p)=>s+p.weight,0);
        return [0,1,2].map(axis=>members.reduce((s,p)=>s+p.lab[axis]*p.weight,0)/w);
      });
      if(!changed)break;
    }
    const error=pts.reduce((sum,p,i)=>sum+p.weight*labDist(p.lab,centers[owner[i]])**2,0);
    return {owner,centers,error};
  }
  // Low-chroma colors are neutral. Very dark colors also belong to the black family even
  // when compression or tracing gave them a slight red/blue tint.
  const NEUTRAL_CHROMA=10,DARK_NEUTRAL_L=20,NEAR_BLACK_L=12,NEAR_WHITE_L=92,EXTREME_MIN_SHARE=.005;
  // colors: [{color:'#rrggbb',weight}] in order of appearance. Returns pen numbers (1..k, by
  // first appearance) and, per pen, the member color closest to the group's center.
  function clusterColors(colors,k){
    if(!Number.isInteger(k)||k<1)throw Error('Number of pens must be a whole number of at least 1.');
    if(!colors.length)return {assign:{},reps:[]};
    k=Math.min(k,colors.length);
    const pts=colors.map(c=>({color:c.color,weight:Math.max(c.weight||1,1),lab:lab(c.color)}));
    const isNeutral=p=>p.lab[0]<DARK_NEUTRAL_L||Math.hypot(p.lab[1],p.lab[2])<NEUTRAL_CHROMA;
    const neutral=pts.filter(isNeutral),chromatic=pts.filter(p=>!isNeutral(p));
    let groups; // [{members:[pt], center}]
    const run=(list,count)=>{const result=kmeans(list,Math.min(count,list.length));return {groups:result.centers.map((center,i)=>({members:list.filter((_,j)=>result.owner[j]===i),center})).filter(g=>g.members.length),error:result.error};};
    if(k===1||!neutral.length||!chromatic.length){
      groups=run(pts,k).groups;
    }else{
      // Try every valid neutral/chromatic allocation and keep the one that best represents
      // the used artwork area. This preserves black/gray/white without automatically giving
      // insignificant dark shades pens that are needed by yellow, red, peach, etc.
      let best=null;
      for(let neutralPens=Math.max(1,k-chromatic.length);neutralPens<=Math.min(neutral.length,k-1);neutralPens++){
        const n=run(neutral,neutralPens),c=run(chromatic,k-neutralPens),candidate={groups:[...n.groups,...c.groups],error:n.error+c.error,neutralPens};
        if(!best||candidate.error<best.error-1e-9||(Math.abs(candidate.error-best.error)<=1e-9&&candidate.neutralPens<best.neutralPens))best=candidate;
      }
      groups=best.groups;
    }
    // Number pens by the first appearance of any member; reps are real colors from the artwork.
    const first=g=>Math.min(...g.members.map(m=>pts.indexOf(m)));
    groups.sort((x,y)=>first(x)-first(y));
    const assign={},reps=[];
    const totalWeight=pts.reduce((sum,p)=>sum+p.weight,0),meaningful=p=>p.weight/(totalWeight||1)>=EXTREME_MIN_SHARE;
    groups.forEach((g,index)=>{
      g.members.forEach(m=>{assign[m.color]=index+1;});
      let representative=g.members.reduce((a,m)=>labDist(g.center,m.lab)<labDist(g.center,a.lab)?m:a);
      // Preserve a real black or paper-white pen when that endpoint occupies a meaningful
      // part of the artwork. Intermediate grays may have more area and pull the cluster
      // center toward themselves, but should not replace the endpoint color that gives the
      // drawing its black outlines or white highlights. If both endpoints share the only
      // neutral group, keep the ordinary center because one physical pen cannot be both.
      const dark=g.members.filter(m=>isNeutral(m)&&m.lab[0]<=NEAR_BLACK_L&&meaningful(m));
      const light=g.members.filter(m=>isNeutral(m)&&m.lab[0]>=NEAR_WHITE_L&&meaningful(m));
      if(dark.length&&!light.length)representative=dark.reduce((a,m)=>m.lab[0]<a.lab[0]?m:a);
      else if(light.length&&!dark.length)representative=light.reduce((a,m)=>m.lab[0]>a.lab[0]?m:a);
      reps.push(representative.color);
    });
    return {assign,reps};
  }
  const PEN_CHANGES=['none','M0','M6','files'];
  // A plain-language name for a color ("dark blue", "light gray"), so a pen change reads naturally.
  function colorName(hex){
    const n=parseInt(String(hex).slice(1),16),r=n>>16&255,g=n>>8&255,b=n&255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,l=(mx+mn)/510;
    const sat=d===0?0:d/(255-Math.abs(mx+mn-255));
    if(!(sat>=.15&&d>=20))return l<.15?'black':l>.9?'white':l<.35?'dark gray':l>.7?'light gray':'gray';
    let h=mx===r?((g-b)/d+6)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h*=60;
    const base=h<15||h>=345?'red':h<40?'orange':h<65?'yellow':h<90?'lime':h<150?'green':h<190?'cyan':h<260?'blue':h<290?'purple':h<320?'magenta':'pink';
    if(base==='orange'&&l<.4)return 'brown';
    return (l<.3?'dark ':l>.72?'light ':'')+base;
  }
  // The comments that name a pen, in the form the dashboard's plotter view reads (`Pen 2: dark green #154c2a`: the
  // pen number, a color name and the hex code, with the hex last). A pen has one main color; any other colors
  // on the same pen go in a separate comment, by name only, so they cannot be mistaken for the pen's own color.
  const penColorsOf=(o,pen)=>[...new Set(Object.entries(o.penMap||{}).filter(([,v])=>v===pen).map(([c])=>(o.penColors||{})[c]||c))];
  const colorWords=c=>/^#[0-9a-f]{6}$/i.test(c)?colorName(c):c;
  const penLabel=(o,pen)=>{
    const colors=penColorsOf(o,pen);
    return 'Pen '+pen+(colors.length?': '+(/^#[0-9a-f]{6}$/i.test(colors[0])?colorName(colors[0])+' '+colors[0]:colors[0]):'');
  };
  const penAlso=(o,pen)=>{
    const colors=penColorsOf(o,pen);if(colors.length<2)return null;
    return 'Pen '+pen+' also draws '+colors.slice(1,4).map(colorWords).join(', ')+(colors.length>4?' +'+(colors.length-4)+' more':'');
  };
  // Everything a G-code file says about one pen: the label, its line width (its own comment, so the dashboard
  // reads the "0.4 mm" as the pen's width) and the other colors it draws.
  const penComments=(o,pen)=>[penLabel(o,pen),'Pen '+pen+' line width '+num(penWidthOf(o,pen))+' mm',penAlso(o,pen)].filter(Boolean).map(t=>'('+t+')');
  // 'M0' pauses for a manual pen swap, 'M6' sends T<n> M6, 'files' is handled by gcodeFiles.
  function gcode(job,o) {
    if(o.mode==='knife')return knifeGcode(job,o);
    const change=o.mode==='plotter'&&(job.pens||[]).length>1?(o.penChange||'none'):'none';
    if(!PEN_CHANGES.includes(change))throw Error('Invalid pen change mode.');
    if(change==='files')throw Error('Separate files are produced one per pen; use gcodeFiles.');
    const out=['(Plotter Studio - millimeters, absolute work coordinates)','(Finish all passes on each path; Z zero must match surface setting)','G21','G90','G17','G94'];
    const enabled=o.tool!=='none';
    if(enabled)out.push('M5');
    out.push('G0 Z'+num(o.safe));
    if(o.approach!==undefined&&!(Number.isFinite(o.approach)&&o.approach>=0&&o.approach<=50))throw Error('Rapid-down height must be 0-50 mm above the surface.');
    const approachZ=o.mode==='plotter'&&o.approach>0&&o.surface+o.approach<o.safe?o.surface+o.approach:null;
    // Registration cross: a small + left of and below the artwork. A pen that has just been swapped is centered
    // on it (G10 L20 sets the work position there), so every pen is aligned to the same mark. The comments
    // carry no sizes ("N mm"), which the Dashboard would read as a pen width.
    const reg=o.regCross?job.registration:null,regX=reg&&num(reg.x),regY=reg&&num(reg.y);
    const regCommand=reg?'G10 L20 P1 X'+regX+' Y'+regY:'';
    const firstPen=o.regFirstPen!==undefined?o.regFirstPen:(job.pens||[])[0];
    const crossFor=pen=>reg&&(o.regEvery!==false||pen===firstPen);
    const crossStrokes=reg?[[{x:reg.x-reg.size/2,y:reg.y},{x:reg.x+reg.size/2,y:reg.y}],[{x:reg.x,y:reg.y-reg.size/2},{x:reg.x,y:reg.y+reg.size/2}]]:[];
    if(reg)out.push('(Registration cross at X'+regX+' Y'+regY+'. After changing to a new pen, center its tip on the cross and send '+regCommand+'.)');
    const emitPath=(points,label)=>job.depths.forEach((z,pass)=>{
      out.push(`(${label} - pass ${pass+1}/${job.depths.length})`);
      if(enabled)out.push('M5');
      out.push('G0 Z'+num(o.safe),'G0 X'+num(points[0].x)+' Y'+num(points[0].y));
      // Rapid (G0) down to just above the surface, then lower the last bit at the lowering feed (G1).
      if(approachZ!==null&&approachZ>z)out.push('G0 Z'+num(approachZ));
      out.push('G1 Z'+num(z)+' F'+num(o.plunge));
      if(enabled)out.push(o.tool+' S'+num(o.power));
      simplify(points,o.outputTolerance??.01).slice(1).forEach((q,j)=>out.push('G1 X'+num(q.x)+' Y'+num(q.y)+(j===0?' F'+num(o.feed):'')));
      if(enabled)out.push('M5');
      out.push('G0 Z'+num(o.safe));
    });
    let currentPen=null;
    job.paths.forEach((p,i)=>{
      // A new pen group starts at a pen change; with no pen changes the whole job is one group.
      const startsGroup=change!=='none'?p.pen!==currentPen:currentPen===null;
      if(startsGroup){
        const firstGroup=currentPen===null;
        currentPen=p.pen;
        if(change!=='none'){
          // Over the cross before the swap, so the person starts the jog from the right place.
          out.push('G0 Z'+num(o.safe));
          if(reg&&!firstGroup)out.push('G0 X'+regX+' Y'+regY);
          out.push(...penComments(o,p.pen));
          if(reg&&!firstGroup)out.push('(MSG, Register: center the tip on the cross at X'+regX+' Y'+regY+', then send '+regCommand+')');
          out.push((change==='M0'?'M0':'T'+p.pen+' M6')+' (MSG, Load '+penLabel(o,p.pen).replace(/^Pen /,'pen ')+')');
        }
        if(crossFor(p.pen))crossStrokes.forEach((stroke,k)=>emitPath(stroke,'Registration cross '+(k+1)));
      }
      emitPath(p.points,'Path '+(p.number??i+1));
    });
    if(enabled)out.push('M5');
    out.push('(End - remains at safe Z)');return modal(out);
  }
  // One complete, independently runnable program per pen, in pen order.
  function gcodeFiles(job,o) {
    if(o.mode!=='plotter')throw Error('Separate pen files are only available in plotter mode.');
    return (job.pens||[1]).map(pen=>{
      const paths=job.paths.filter(p=>(p.pen??1)===pen);
      const text=gcode({...job,pens:[pen],paths},{...o,penChange:'none',regFirstPen:(job.pens||[])[0]});
      const extra=penColorsOf(o,pen).length-1;
      const first=pen===(job.pens||[])[0],reg=o.regCross&&job.registration;
      const note=reg?(first?'(This file draws the registration cross at X'+num(reg.x)+' Y'+num(reg.y)+'. Set work zero as usual.)':'(Before running: center this pen on the registration cross and send G10 L20 P1 X'+num(reg.x)+' Y'+num(reg.y)+')')+'\n':'';
      return {pen,label:penLabel(o,pen)+(extra>0?' (+'+extra+' color'+(extra===1?'':'s')+')':''),paths:paths.length,text:penComments(o,pen).join('\n')+'\n(This file plots pen '+pen+' only)\n'+note+text};
    });
  }
  const api={colorName,simplify,cleanPoints,bounds,area,depths,transform,plan,gcode,gcodeFiles,hatchLines,clusterColors,offsetPath,removeLoops,dedupeOutlines,insetOutlines,dist,length};
  if(typeof module!=='undefined')module.exports=api;else root.SvgCam=api;
})(typeof window==='undefined'?globalThis:window);
