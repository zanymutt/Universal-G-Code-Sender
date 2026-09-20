/* Pure SVG geometry: no DOM, layout or whole-path length queries. */
(function(root){
  function createGeometry(){
    const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    const angle=(a,b)=>a&&b?Math.abs(Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y)):0;
    const unit=v=>{const n=Math.hypot(v.x,v.y);return n>1e-14?{x:v.x/n,y:v.y/n}:null;};
    function segments(d){
      const tokens=d.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[];
      const counts={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7};
      let i=0,cmd='',p={x:0,y:0},start=p,last='',control=null;const result=[];
      while(i<tokens.length){
        if(/^[a-z]$/i.test(tokens[i]))cmd=tokens[i++];const up=cmd.toUpperCase(),relative=up!==cmd;
        if(up==='Z'){result.push({type:'L',p0:p,p1:start});p=start;last='Z';control=null;cmd='';continue;}
        const count=counts[up];if(!count)throw Error('Invalid SVG command.');
        const a=tokens.slice(i,i+count).map(Number);i+=count;if(a.length!==count||a.some(v=>!Number.isFinite(v)))throw Error('Invalid SVG coordinates.');
        const point=(j)=>({x:a[j]+(relative?p.x:0),y:a[j+1]+(relative?p.y:0)});
        const reflect=()=>control?{x:2*p.x-control.x,y:2*p.y-control.y}:p;let s;
        if(up==='M'){p=point(0);start=p;cmd=relative?'l':'L';control=null;last=up;continue;}
        if(up==='L')s={type:'L',p0:p,p1:point(0)};
        if(up==='H')s={type:'L',p0:p,p1:{x:a[0]+(relative?p.x:0),y:p.y}};
        if(up==='V')s={type:'L',p0:p,p1:{x:p.x,y:a[0]+(relative?p.y:0)}};
        if(up==='C')s={type:'C',p0:p,p1:point(0),p2:point(2),p3:point(4)};
        if(up==='S')s={type:'C',p0:p,p1:/[CS]/.test(last)?reflect():p,p2:point(0),p3:point(2)};
        if(up==='Q')s={type:'Q',p0:p,p1:point(0),p2:point(2)};
        if(up==='T')s={type:'Q',p0:p,p1:/[QT]/.test(last)?reflect():p,p2:point(0)};
        if(up==='A')s=arc(p,point(5),a);
        control=s.type==='C'?s.p2:s.type==='Q'?s.p1:null;p=s.p3||s.p2||s.p1;last=up;result.push(s);
      }
      return result;
    }
    function arc(p0,p1,a){
      let rx=Math.abs(a[0]),ry=Math.abs(a[1]);if(!rx||!ry||dist(p0,p1)<1e-12)return {type:'L',p0,p1};
      const phi=a[2]*Math.PI/180,c=Math.cos(phi),s=Math.sin(phi),dx=(p0.x-p1.x)/2,dy=(p0.y-p1.y)/2,x=c*dx+s*dy,y=-s*dx+c*dy;
      const scale=x*x/(rx*rx)+y*y/(ry*ry);if(scale>1){rx*=Math.sqrt(scale);ry*=Math.sqrt(scale);}
      const k=(a[3]===a[4]?-1:1)*Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*y*y-ry*ry*x*x)/(rx*rx*y*y+ry*ry*x*x)));
      const cx=k*rx*y/ry,cy=-k*ry*x/rx,center={x:c*cx-s*cy+(p0.x+p1.x)/2,y:s*cx+c*cy+(p0.y+p1.y)/2};
      const start=Math.atan2((y-cy)/ry,(x-cx)/rx),end=Math.atan2((-y-cy)/ry,(-x-cx)/rx);let sweep=end-start;
      if(a[4]&&sweep<0)sweep+=2*Math.PI;if(!a[4]&&sweep>0)sweep-=2*Math.PI;
      return {type:'A',p0,p1,rx,ry,c,s,center,start,sweep};
    }
    function at(s,t){
      if(t===0)return s.p0;if(t===1)return s.p3||s.p2||s.p1;
      if(s.type==='L')return mix(s.p0,s.p1,t);
      if(s.type==='Q')return mix(mix(s.p0,s.p1,t),mix(s.p1,s.p2,t),t);
      if(s.type==='C')return mix(mix(mix(s.p0,s.p1,t),mix(s.p1,s.p2,t),t),mix(mix(s.p1,s.p2,t),mix(s.p2,s.p3,t),t),t);
      const a=s.start+s.sweep*t,x=s.rx*Math.cos(a),y=s.ry*Math.sin(a);return {x:s.center.x+s.c*x-s.s*y,y:s.center.y+s.s*x+s.c*y};
    }
    function derivative(s,t){
      const v=(a,b)=>({x:b.x-a.x,y:b.y-a.y});
      if(s.type==='L')return v(s.p0,s.p1);
      if(s.type==='Q'){const a=v(s.p0,s.p1),b=v(s.p1,s.p2);return {x:2*((1-t)*a.x+t*b.x),y:2*((1-t)*a.y+t*b.y)};}
      if(s.type==='C'){const a=v(s.p0,s.p1),b=v(s.p1,s.p2),c=v(s.p2,s.p3);return {x:3*((1-t)**2*a.x+2*(1-t)*t*b.x+t*t*c.x),y:3*((1-t)**2*a.y+2*(1-t)*t*b.y+t*t*c.y)};}
      const a=s.start+s.sweep*t,x=-s.rx*Math.sin(a)*s.sweep,y=s.ry*Math.cos(a)*s.sweep;return {x:s.c*x-s.s*y,y:s.s*x+s.c*y};
    }
    function roots(a,b,c){if(Math.abs(a)<1e-14)return Math.abs(b)<1e-14?[]:[-c/b];const d=b*b-4*a*c;if(d<0)return [];return [(-b-Math.sqrt(d))/(2*a),(-b+Math.sqrt(d))/(2*a)];}
    function cusps(s,all=false){
      if(!['C','Q'].includes(s.type))return [];
      const coeff=k=>s.type==='C'?[3*(-s.p0[k]+3*s.p1[k]-3*s.p2[k]+s.p3[k]),6*(s.p0[k]-2*s.p1[k]+s.p2[k]),3*(s.p1[k]-s.p0[k])]:[0,2*(s.p0[k]-2*s.p1[k]+s.p2[k]),2*(s.p1[k]-s.p0[k])];
      const x=coeff('x'),y=coeff('y'),scale=Math.max(...x.map(Math.abs),...y.map(Math.abs),1);
      return [...roots(...x),...roots(...y)].filter(t=>t>1e-9&&t<1-1e-9&&(all||Math.hypot(...Object.values(derivative(s,t)))<scale*1e-8)).sort((a,b)=>a-b).filter((t,i,a)=>!i||t-a[i-1]>1e-8);
    }
    function deviation(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
    function mergeNearby(points,closed,distance=0){
      if(!distance||points.length<3)return points;
      const box=p=>({minX:p.x,maxX:p.x,minY:p.y,maxY:p.y});
      const union=(a,b)=>({minX:Math.min(a.minX,b.minX),maxX:Math.max(a.maxX,b.maxX),minY:Math.min(a.minY,b.minY),maxY:Math.max(a.maxY,b.maxY)});
      const fits=b=>Math.hypot(b.maxX-b.minX,b.maxY-b.minY)<=distance;
      const groups=[];
      for(let i=0;i<points.length;){
        const start=i;let bounds=box(points[i++]);
        while(i<points.length){
          // Never collapse both endpoints of an open path into one vertex.
          if(!closed&&start===0&&i===points.length-1)break;
          const next=union(bounds,box(points[i]));if(!fits(next))break;
          bounds=next;i++;
        }
        const last=i-1,anchor=!closed&&last===points.length-1?points[last]:points[start];
        groups.push({bounds,count:i-start,point:{...anchor,tin:points[start].tin,tout:points[last].tout}});
      }
      if(groups.length<(closed?3:2))return points;
      // Handle a cluster crossing a closed contour's seam, keeping its start.
      if(closed&&groups.length>3){const first=groups[0],last=groups.at(-1),bounds=union(first.bounds,last.bounds);
        if(fits(bounds)){first.point.tin=last.point.tin;first.bounds=bounds;first.count+=last.count;groups.pop();}
      }
      return groups.map(g=>g.point);
    }
    function clean(points,closed,threshold,tolerance){
      if(!threshold||points.length<3)return points;
      const originals=points;points=points.map(p=>({...p}));
      const removedJogs=new Set(),signed=(a,b)=>Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y);
      const source=closed?[...points,points[0]]:points,result=[source[0]],pending=[];
      for(let i=1;i<source.length-1;i++){const a=result.at(-1),b=source[i],c=source[i+1];
        // A sub-tolerance connecting step may create two opposing corners.
        // Remove it only when the incoming/outgoing contour headings agree;
        // a real notch, rounded turn, or path endpoint must remain protected.
        const directions=b.tin&&b.tout&&c.tin&&c.tout;
        const turn1=directions?signed(b.tin,b.tout):0,turn2=directions?signed(c.tin,c.tout):0;
        const jog=i+2<source.length&&directions&&dist(b,c)<=Math.min(threshold,tolerance)
          &&turn1*turn2<0&&Math.min(Math.abs(turn1),Math.abs(turn2))>Math.PI/36
          &&angle(b.tout,c.tin)<Math.PI/180&&angle(b.tin,c.tout)<Math.PI/180;
        const reversal=angle(b.tin,b.tout)>Math.PI*5/6;
        const losesDirection=!reversal&&[...pending,b,c].some(p=>angle(a.tout,p.tin)>Math.PI/36);
        if((!losesDirection||jog)&&pending.length<128&&(dist(a,b)<threshold||dist(b,c)<threshold)&&deviation(b,a,c)<=tolerance&&pending.every(q=>deviation(q,a,c)<=tolerance)){
          if(jog){c.tin=b.tin;removedJogs.add(b);}
          pending.push(b);
        }
        else {result.push(b);pending.length=0;}
      }
      result.push(source.at(-1));if(closed)result.pop();if(result.length<(closed?3:2))return originals;
      // A removed run is replaced by a chord. Its endpoints need that chord's
      // directions, not stale derivatives from the removed geometry.
      const indices=new Map(points.map((p,i)=>[p,i]));
      for(let i=0;i<result.length-(closed?0:1);i++){const a=result[i],b=result[(i+1)%result.length];const ia=indices.get(a),ib=indices.get(b),between=[];for(let k=(ia+1)%points.length;k!==ib;k=(k+1)%points.length){between.push(points[k]);if(between.length>points.length)break;}if(between.filter(p=>!removedJogs.has(p)).some(p=>p.tin&&p.tout&&Math.abs(p.tin.x*p.tout.y-p.tin.y*p.tout.x)>1e-6||p.tin&&p.tout&&p.tin.x*p.tout.x+p.tin.y*p.tout.y<0)){const v=unit({x:b.x-a.x,y:b.y-a.y});a.tout=v;b.tin=v;}}
      return result;
    }
    function* sample(item,o){
      const m=item.matrix,world=p=>({x:m[0]*p.x+m[2]*p.y+m[4],y:item.height-(m[1]*p.x+m[3]*p.y+m[5])});
      const vector=v=>unit({x:m[0]*v.x+m[2]*v.y,y:-m[1]*v.x-m[3]*v.y});
      const segs=segments(item.d),points=[];let visited=0;
      if(segs.length>3000)throw Error('A path exceeds 3000 segments. Simplify or split it first.');
      const add=q=>{if(!Number.isFinite(q.x)||!Number.isFinite(q.y))throw Error('Non-finite path coordinates.');if(points.length&&dist(points.at(-1),q)<1e-10){points.at(-1).tout=q.tout;return;}points.push(q);if(points.length>100000)throw Error('Limit: 100,000 sampled points. Increase tolerance or step.');};
      for(const s of segs){
        if(s.type==='L'&&dist(s.p0,s.p1)<1e-12){yield ++visited/segs.length;continue;}
        const cuts=[0,...cusps(s,true),1],derivScale=Math.max(dist(s.p0,s.p3||s.p2||s.p1),1);
        const tangent=(t,side)=>{let v=derivative(s,t);if(Math.hypot(v.x,v.y)<derivScale*1e-9)v=derivative(s,Math.max(0,Math.min(1,t+side*1e-7)));return vector(v);};
        const vertex=(t,side)=>{const q=world(at(s,t)),v=tangent(t,side);return {...q,tin:v,tout:v};};
        const first=vertex(0,1);if(points.length)points.at(-1).tout=first.tout;else add(first);
        for(let part=1;part<cuts.length;part++){
          const left=cuts[part-1],right=cuts[part];if(left>0)points.at(-1).tout=tangent(left,1);
          const count=s.type==='L'?1:s.type==='A'?Math.max(1,Math.ceil(Math.abs(s.sweep)*(right-left)/(Math.PI/2))):Math.max(1,Math.ceil(o.curveSegments*(right-left)));
          const stack=[];for(let i=count-1;i>=0;i--)stack.push([left+(right-left)*i/count,left+(right-left)*(i+1)/count,0]);
          while(stack.length){const [a,b,depth]=stack.pop(),pa=world(at(s,a)),pb=world(at(s,b));const probes=[.25,.5,.75].map(f=>world(at(s,a+(b-a)*f)));
            const chain=[pa,...probes,pb],length=chain.slice(1).reduce((sum,q,i)=>sum+dist(chain[i],q),0);
            const headings=[tangent(a,1),...[.25,.5,.75].map(f=>tangent(a+(b-a)*f,1)),tangent(b,-1)];
            const split=s.type!=='L'&&(length>o.spacing||probes.some(q=>deviation(q,pa,pb)>o.tolerance/2)||headings.slice(1).some((v,i)=>angle(headings[i],v)>Math.PI/36));
            if(split){if(depth>=22)throw Error('Curve cannot meet the selected tolerance. Increase tolerance or repair the SVG.');const mid=(a+b)/2;stack.push([mid,b,depth+1],[a,mid,depth+1]);}
            else add(vertex(b,-1));
            if(++visited%256===0)yield Math.min(.99,segs.indexOf(s)/segs.length);
          }
          if(right<1)points.at(-1).tout=tangent(right,1);
        }
        yield (segs.indexOf(s)+1)/segs.length;
      }
      let closed=item.closed,gapClosed=false;
      if(!closed&&o.equalDistance>0&&points.length>=3&&dist(points[0],points.at(-1))<=o.equalDistance){closed=true;gapClosed=true;}
      if(closed&&points.length>1&&dist(points[0],points.at(-1))<=Math.max(1e-8,o.equalDistance)){
        points[0].tin=points.at(-1).tin;points.pop();
      }
      if(points.length<(closed?3:2))return null;
      const originalCount=points.length,merged=mergeNearby(points,closed,o.mergeDistance??0),cleaned=clean(merged,closed,o.cleanup,Math.min(o.cleanup,o.tolerance/2));
      return {points:cleaned,closed,gapClosed,originalCount,merged:originalCount-merged.length,removed:merged.length-cleaned.length};
    }
    function* process(prepared){
      const {items,options,width,height}=prepared,paths=[],warnings=[];let vertices=0,removed=0,mergedCount=0;
      for(let i=0;i<items.length;i++){
        const gen=sample(items[i],options);let step;while(!(step=gen.next()).done)yield {fraction:(i+step.value)/items.length,path:i+1,total:items.length};
        const r=step.value;if(!r)continue;vertices+=r.originalCount;removed+=r.removed;mergedCount+=r.merged;
        if(vertices>100000)throw Error('Limit: 100,000 sampled points. Increase tolerance or step.');
        if(r.gapClosed)warnings.push('Closed a same-path endpoint gap within '+options.equalDistance+' mm.');
        paths.push({id:'p'+paths.length,name:items[i].name,closed:r.closed,points:r.points});
      }
      if(!paths.length)throw Error('No supported visible vector paths found.');
      if(mergedCount)warnings.push(`Merged ${mergedCount} nearby vertices (maximum group size ${options.mergeDistance} mm).`);
      if(removed)warnings.push(`Short-move cleanup removed ${removed} redundant points.`);
      const open=paths.filter(p=>!p.closed).length;if(open)warnings.push(`${open} open path(s): SVG fill does not close the cutting path.`);
      warnings.push('SVG vectors define the intended cut. Fills and stroke widths do not define a scrap side. Knife mode adds holder-offset compensation.');
      return {paths,width,height,page:[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],warnings,vertices};
    }
    function run(prepared){const gen=process(prepared);let step;while(!(step=gen.next()).done){}return step.value;}
    return {segments,at,derivative,cusps,mergeNearby,sample,process,run};
  }
  const api=createGeometry();api.workerSource='const G=('+createGeometry.toString()+')();self.onmessage=e=>{try{const gen=G.process(e.data);let step,last=0;while(!(step=gen.next()).done){if(performance.now()-last>30){self.postMessage({progress:step.value});last=performance.now();}}self.postMessage({result:step.value});}catch(e){self.postMessage({error:e.message});}};';
  if(typeof module!=='undefined')module.exports=api;else root.SvgGeometry=api;
})(typeof window==='undefined'?globalThis:window);
