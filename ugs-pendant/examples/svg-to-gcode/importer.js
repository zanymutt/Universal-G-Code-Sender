(function(){
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const numberPattern=/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  function numbers(s){const v=(s.match(numberPattern)||[]).map(Number);if(v.some(n=>!Number.isFinite(n))||s.replace(numberPattern,'').replace(/[\s,]/g,''))throw Error('Invalid SVG numeric list.');return v;}
  function mm(value,dpi){
    const m=/^\s*([-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px|q)?\s*$/i.exec(value||'');
    if(!m)throw Error('SVG page dimensions must use mm, cm, in, pt, pc, px, or plain numbers.');
    return Number(m[1])*({mm:1,cm:10,in:25.4,pt:25.4/72,pc:25.4/6,q:.25,px:25.4/dpi}[m[2]?.toLowerCase()||'px']);
  }
  function matrix(value){
    let result=new DOMMatrix(),used='';const re=/([a-zA-Z]+)\s*\(([^)]*)\)/g;let m;
    while((m=re.exec(value||''))){used+=m[0];const a=numbers(m[2]);let t;
      if(m[1]==='matrix'&&a.length===6)t=new DOMMatrix(a);
      else if(m[1]==='translate'&&(a.length===1||a.length===2))t=new DOMMatrix().translate(a[0],a[1]||0);
      else if(m[1]==='scale'&&(a.length===1||a.length===2))t=new DOMMatrix().scale(a[0],a[1]??a[0]);
      else if(m[1]==='rotate'&&(a.length===1||a.length===3))t=new DOMMatrix().translate(a[1]||0,a[2]||0).rotate(a[0]).translate(-(a[1]||0),-(a[2]||0));
      else if(m[1]==='skewX'&&a.length===1)t=new DOMMatrix([1,0,Math.tan(a[0]*Math.PI/180),1,0,0]);
      else if(m[1]==='skewY'&&a.length===1)t=new DOMMatrix([1,Math.tan(a[0]*Math.PI/180),0,1,0,0]);
      else throw Error('Unsupported SVG transform: '+m[1]);
      result=result.multiply(t);
    }
    if((value||'').replace(re,'').replace(/[\s,]/g,''))throw Error('Invalid SVG transform.');
    return result;
  }
  // Separate subpaths before browser geometry sampling; never join pen-up moves.
  function splitPath(d){
    const tokens=d.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[];
    if(d.replace(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g,'').replace(/[\s,]/g,''))throw Error('Invalid SVG path data.');
    const count={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7};
    let i=0,cmd='',x=0,y=0,sx=0,sy=0,current=null;const paths=[];
    while(i<tokens.length){
      if(/^[a-z]$/i.test(tokens[i]))cmd=tokens[i++];
      if(!cmd)throw Error('SVG path command missing.');
      const up=cmd.toUpperCase(),relative=cmd!==up;
      if(up==='Z'){
        if(!current)throw Error('Close command without a path.');
        current.d+=' Z';current.ends.push(current.d.length);current.closed=true;x=sx;y=sy;cmd='';continue;
      }
      const n=count[up];if(!n)throw Error('Unsupported SVG path command '+cmd);
      const a=tokens.slice(i,i+n).map(Number);
      if(a.length!==n||a.some(v=>!Number.isFinite(v)))throw Error('Incomplete SVG '+cmd+' command.');i+=n;
      if(up==='A'&&(a[0]<0||a[1]<0||![0,1].includes(a[3])||![0,1].includes(a[4])))throw Error('Invalid SVG arc. Separate arc flags with spaces.');
      let nx=x,ny=y;
      if(up==='H')nx=a[0]+(relative?x:0);
      else if(up==='V')ny=a[0]+(relative?y:0);
      else {nx=a[n-2]+(relative?x:0);ny=a[n-1]+(relative?y:0);}
      if(up==='M') {current={d:`M ${nx} ${ny}`,closed:false,ends:[]};paths.push(current);sx=nx;sy=ny;cmd=relative?'l':'L';}
      else {
        if(!current)throw Error('SVG path must start with M.');
        if(current.closed){current={d:`M ${x} ${y}`,closed:false,ends:[]};paths.push(current);sx=x;sy=y;}
        current.d+=' '+cmd+' '+a.join(' ');
        current.ends.push(current.d.length);
      }
      x=nx;y=ny;
    }
    return paths;
  }
  function shape(el){
    const tag=el.localName;
    function v(name,fallback=0){const raw=el.getAttribute(name);if(raw===null)return fallback;const n=numbers(raw);if(n.length!==1)throw Error('Use plain SVG user units for shape attributes.');return n[0];}
    if(tag==='path')return splitPath(el.getAttribute('d')||'');
    if(tag==='line')return [{d:`M ${v('x1')} ${v('y1')} L ${v('x2')} ${v('y2')}`,closed:false}];
    if(tag==='polyline'||tag==='polygon'){
      const a=numbers(el.getAttribute('points')||'');if(a.length%2)throw Error('Odd SVG point count.');
      return a.length>=4?[{d:'M '+a.slice(0,2).join(' ')+' L '+a.slice(2).join(' ')+(tag==='polygon'?' Z':''),closed:tag==='polygon'}]:[];
    }
    if(tag==='rect'){
      const x=v('x'),y=v('y'),w=v('width'),h=v('height');
      if(w<0||h<0)throw Error('Negative rectangle size.');if(!w||!h)return [];
      const rx=Math.min(w/2,v('rx',v('ry'))),ry=Math.min(h/2,v('ry',v('rx')));
      if(rx<0||ry<0)throw Error('Negative corner radius.');
      const d=rx&&ry?`M ${x+rx} ${y} H ${x+w-rx} A ${rx} ${ry} 0 0 1 ${x+w} ${y+ry} V ${y+h-ry} A ${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h} H ${x+rx} A ${rx} ${ry} 0 0 1 ${x} ${y+h-ry} V ${y+ry} A ${rx} ${ry} 0 0 1 ${x+rx} ${y} Z`:`M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
      return [{d,closed:true}];
    }
    if(tag==='circle'||tag==='ellipse'){
      const x=v('cx'),y=v('cy'),rx=tag==='circle'?v('r'):v('rx'),ry=tag==='circle'?rx:v('ry');
      if(rx<0||ry<0)throw Error('Negative radius.');if(!rx||!ry)return [];
      return [{d:`M ${x-rx} ${y} A ${rx} ${ry} 0 1 0 ${x+rx} ${y} A ${rx} ${ry} 0 1 0 ${x-rx} ${y} Z`,closed:true}];
    }
    throw Error('Unsupported SVG element <'+tag+'>. Convert text/clones to paths and remove bitmap images first.');
  }
  function parse(text,{dpi=96,spacing=.25,cleanup=0}={}){
    if(text.length>5000000)throw Error('SVG exceeds 5 MB.');
    if(!(dpi>0&&dpi<=2400&&spacing>=.02&&spacing<=5))throw Error('DPI must be 1–2400; segment spacing must be 0.02–5 mm.');
    if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('Remove the SVG DOCTYPE/entity declarations first.');
    const xml=new DOMParser().parseFromString(text,'image/svg+xml');
    if(xml.querySelector('parsererror'))throw Error('Invalid SVG XML.');
    const root=xml.documentElement;if(root.localName!=='svg')throw Error('Choose an SVG file.');
    const vb=root.hasAttribute('viewBox')?numbers(root.getAttribute('viewBox')):null;
    if(vb&&(vb.length!==4||vb[2]<=0||vb[3]<=0))throw Error('Invalid viewBox.');
    const width=mm(root.getAttribute('width')||(vb?String(vb[2]):''),dpi),height=mm(root.getAttribute('height')||(vb?String(vb[3]):''),dpi),box=vb||[0,0,width*dpi/25.4,height*dpi/25.4];
    if(!(width>0&&height>0))throw Error('SVG page dimensions must be positive.');
    let sx=width/box[2],sy=height/box[3],ox=0,oy=0;
    const aspect=(root.getAttribute('preserveAspectRatio')||'xMidYMid meet').trim();
    if(aspect!=='none'){
      const m=/^(xMin|xMid|xMax)(YMin|YMid|YMax)(?:\s+(meet|slice))?$/.exec(aspect);if(!m||m[3]==='slice')throw Error('Unsupported preserveAspectRatio. Use meet or none.');
      sx=sy=Math.min(sx,sy);ox=(width-box[2]*sx)*({xMin:0,xMid:.5,xMax:1}[m[1]]);oy=(height-box[3]*sy)*({YMin:0,YMid:.5,YMax:1}[m[2]]);
    }
    const pageMatrix=new DOMMatrix([sx,0,0,sy,ox-box[0]*sx,oy-box[1]*sy]);
    if(!Number.isFinite(cleanup)||cleanup<0||cleanup>1)throw Error('Node cleanup must be from 0 to 1 mm.');
    const paths=[],warnings=[];let vertices=0,removed=0;
    function walk(el,parent,depth=0){
      if(depth>60)throw Error('SVG group nesting exceeds 60 levels.');
      const tag=el.localName;
      if(el.namespaceURI!==NS)return;
      if(['defs','metadata','title','desc','namedview'].includes(tag))return;
      if(['script','foreignObject','style','animate','animateTransform','set'].includes(tag))throw Error('Scripts, stylesheets, animation and embedded HTML are unsupported.');
      const styles=Object.fromEntries((el.getAttribute('style')||'').split(';').filter(Boolean).map(s=>{const i=s.indexOf(':');return [s.slice(0,i).trim(),s.slice(i+1).trim()];}));
      const prop=k=>styles[k]??el.getAttribute(k);
      if(prop('display')==='none'||prop('visibility')==='hidden'||prop('visibility')==='collapse'||prop('opacity')==='0')return;
      for(const k of ['clip-path','mask','filter','transform','d'])if((styles[k]&&styles[k]!=='none')||(['clip-path','mask','filter'].includes(k)&&el.hasAttribute(k)&&el.getAttribute(k)!=='none'))throw Error('Unsupported SVG '+k+' styling. Convert the visible artwork to plain paths.');
      const mat=parent.multiply(matrix(el.getAttribute('transform')));
      if(![mat.a,mat.b,mat.c,mat.d,mat.e,mat.f].every(Number.isFinite))throw Error('Non-finite SVG transform.');
      if(tag==='g'||el===root){for(const child of el.children)walk(child,mat,depth+1);return;}
      if(paths.length>=500)throw Error('Limit: 500 paths. Split this SVG into smaller jobs.');
      for(const source of shape(el))for(const sub of (source.ends?[source]:splitPath(source.d))){
        if(paths.length>=500)throw Error('Limit: 500 paths. Split this SVG into smaller jobs.');
        if(sub.ends.length>3000)throw Error('A path exceeds 3000 segments. Simplify or split it first.');
        const path=document.createElementNS(NS,'path');path.setAttribute('d',sub.d);
        const len=path.getTotalLength();if(!Number.isFinite(len))throw Error('Invalid path geometry.');if(len<=1e-8)continue;
        // Frobenius norm is an upper bound on transform stretch; sample in mm.
        const stretch=Math.hypot(mat.a,mat.b,mat.c,mat.d),steps=Math.max(1,Math.ceil(len*stretch/spacing));
        if(steps>100000||vertices+steps>100000)throw Error('Limit: 100,000 sampled points. Increase segment spacing.');
        // Include every command endpoint so sampling never trims a sharp corner.
        const probe=document.createElementNS(NS,'path');let previous=0;
        const distances=[0];
        for(const end of sub.ends){probe.setAttribute('d',sub.d.slice(0,end));const next=probe.getTotalLength();const count=Math.max(1,Math.ceil((next-previous)*stretch/spacing));for(let i=1;i<=count;i++)distances.push(previous+(next-previous)*i/count);previous=next;}
        if(distances.length+vertices>100000)throw Error('Limit: 100,000 sampled points. Increase segment spacing.');
        let points=[];
        for(const distance of distances){
          const p=path.getPointAtLength(distance),q=new DOMPoint(p.x,p.y).matrixTransform(mat),point={x:q.x,y:height-q.y};
          if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw Error('Non-finite path coordinates.');
          if(!points.length||SvgCam.dist(points.at(-1),point)>1e-8)points.push(point);
        }
        if(sub.closed&&points.length>1&&SvgCam.dist(points[0],points.at(-1))<1e-5)points.pop();
        if(points.length<(sub.closed?3:2))continue;
        const originalCount=points.length;points=SvgCam.cleanPoints(points,sub.closed,cleanup);removed+=originalCount-points.length;
        vertices+=originalCount;
        paths.push({id:'p'+paths.length,name:(el.getAttribute('id')||tag)+'/'+(paths.length+1),closed:sub.closed,points});
      }
    }
    walk(root,pageMatrix);
    if(!paths.length)throw Error('No supported visible vector paths found.');
    if(removed)warnings.push(`Node cleanup removed ${removed} nearby redundant points (threshold ${cleanup} mm).`);
    const openCount=paths.filter(p=>!p.closed).length;if(openCount)warnings.push(`${openCount} open path(s): SVG fill does not close the cutting path.`);
    warnings.push('SVG vectors define the intended cut. Fills and stroke widths do not define a scrap side. Knife mode adds holder-offset compensation.');
    return {paths,width,height,page:[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}],warnings,vertices};
  }
  window.SvgImport={parse,splitPath};
})();
