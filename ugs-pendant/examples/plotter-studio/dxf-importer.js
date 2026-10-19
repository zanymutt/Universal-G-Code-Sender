/* ASCII 2D DXF -> the same analytic geometry pipeline used by SVG. */
(function(root){
  'use strict';
  const units={1:['inches',25.4],2:['feet',304.8],4:['millimeters',1],5:['centimeters',10],6:['meters',1000],9:['mils',.0254],10:['yards',914.4],13:['microns',.001],14:['decimeters',100]};
  const overrides={mm:['millimeters',1],in:['inches',25.4],cm:['centimeters',10],m:['meters',1000],ft:['feet',304.8]};
  const get=(tags,code,fallback)=>tags.find(t=>t[0]===code)?.[1]??fallback;
  function num(tags,code,fallback){
    const raw=get(tags,code,fallback),n=Number(raw);
    if(raw===undefined||String(raw).trim()===''||!Number.isFinite(n))throw Error('Invalid or missing DXF numeric value (group '+code+').');
    return n;
  }
  function integer(tags,code,fallback){const n=num(tags,code,fallback);if(!Number.isInteger(n))throw Error('Invalid DXF integer (group '+code+').');return n;}
  function read(text){
    if(text.length>5000000)throw Error('DXF exceeds 5 MB.');
    if(text.startsWith('AutoCAD Binary DXF')||text.includes('\0'))throw Error('Binary DXF is not supported. Export an ASCII DXF.');
    const lines=text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/);while(lines.length&&lines.at(-1).trim()==='')lines.pop();
    if(lines.length%2)throw Error('Invalid DXF: incomplete group-code pair.');
    const pairs=[];
    for(let i=0;i<lines.length;i+=2){
      if(!/^\s*\d+\s*$/.test(lines[i])||Number(lines[i])>1071)throw Error('Invalid DXF group code at line '+(i+1)+'.');
      pairs.push([Number(lines[i]),lines[i+1].trim()]);
    }
    const sections=new Map();let section=null,eof=false;
    for(let i=0;i<pairs.length;i++){
      const [code,value]=pairs[i];
      if(code===999)continue;
      if(code===0&&value==='SECTION'){
        if(section||pairs[i+1]?.[0]!==2)throw Error('Invalid DXF SECTION.');
        section=pairs[++i][1];if(sections.has(section))throw Error('Duplicate DXF section '+section+'.');sections.set(section,[]);
      }else if(code===0&&value==='ENDSEC'){
        if(!section)throw Error('Unexpected DXF ENDSEC.');section=null;
      }else if(code===0&&value==='EOF'){
        if(section||i!==pairs.length-1)throw Error('Invalid DXF EOF.');eof=true;
      }else if(section)sections.get(section).push(pairs[i]);
      else throw Error('Invalid DXF structure.');
    }
    if(!eof||section||!sections.has('ENTITIES'))throw Error('Incomplete DXF: ENTITIES section and EOF are required.');
    return sections;
  }
  // AutoCAD Color Index -> '#rrggbb'. 1-9 are the fixed colors, 10-249 follow the
  // hue/shade pattern of the standard palette, 250-255 are greys. Color 7 is
  // white-or-black in CAD; paper is white here, so it plots black.
  const aciBase={1:'#ff0000',2:'#ffff00',3:'#00ff00',4:'#00ffff',5:'#0000ff',6:'#ff00ff',7:'#000000',8:'#808080',9:'#c0c0c0'};
  function aci(n){
    if(aciBase[n])return aciBase[n];
    if(n>=250&&n<=255){const g=Math.round(51+(n-250)*(255-51)/5);return '#'+g.toString(16).padStart(2,'0').repeat(3);}
    if(n<10||n>249)return '#000000';
    const hue=Math.floor((n-10)/10)*15,step=(n-10)%10,sat=step%2?.5:1,light=[1,1,.8,.8,.6,.6,.5,.5,.3,.3][step];
    const f=k=>{const a=((k+hue/60)%6+6)%6,v=Math.max(0,Math.min(1,Math.abs(a-3)-1));return Math.floor((1-sat+sat*v)*light*255+1e-9);};
    return '#'+[f(0),f(4),f(2)].map(c=>c.toString(16).padStart(2,'0')).join('');
  }
  function records(tags){
    const out=[];for(const tag of tags){if(tag[0]===0)out.push({type:tag[1],tags:[]});else if(out.length)out.at(-1).tags.push(tag);}return out;
  }
  function options(o){
    const v={spacing:.5,cleanup:0,curveSegments:12,tolerance:.01,equalDistance:0,mergeDistance:.001,joinEndpoints:false,joinDistance:.01,...o};
    for(const [k,min,max]of [['spacing',.02,5],['cleanup',0,1],['tolerance',.001,1],['equalDistance',0,1],['mergeDistance',0,.1],['joinDistance',0,5],['curveSegments',1,1000]]){
      if(!Number.isFinite(v[k])||v[k]<min||v[k]>max)throw Error('Invalid '+k+'; expected '+min+' to '+max+'.');
    }
    if(typeof v.joinEndpoints!=='boolean')throw Error('Endpoint joining must be on or off.');
    if(!Number.isInteger(v.curveSegments))throw Error('Curve segments must be an integer.');return v;
  }
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const pointText=p=>p.x+' '+p.y;
  function segment(a,b,bulge=0){
    const length=distance(a,b);
    if(length===0){if(bulge)throw Error('DXF arc has coincident endpoints.');return null;}
    if(!bulge)return {a,b,r:0};
    const r=length*(1+bulge*bulge)/(4*Math.abs(bulge));
    if(!Number.isFinite(r))throw Error('Invalid DXF bulge radius.');
    return {a,b,r,large:Math.abs(bulge)>1?1:0,sweep:bulge>0?1:0};
  }
  const reversed=s=>({...s,a:s.b,b:s.a,sweep:s.r?1-s.sweep:s.sweep});
  const command=s=>s.r?`A ${s.r} ${s.r} 0 ${s.large} ${s.sweep} ${pointText(s.b)}`:'L '+pointText(s.b);
  // Join only degree-two, same-layer LINE/ARC endpoints. Branches remain open.
  // The tiny matching tolerance absorbs export rounding, not intentional gaps.
  function join(edges,factor){
    const eps=1e-7/factor,buckets=new Map(),nodes=[];
    function node(p,layer){
      const x=Math.floor(p.x/eps),y=Math.floor(p.y/eps);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
        for(const n of buckets.get(JSON.stringify([layer,x+dx,y+dy]))||[])if(distance(n.p,p)<=eps)return n;
      }
      const n={p,edges:[]},key=JSON.stringify([layer,x,y]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(n);nodes.push(n);return n;
    }
    for(const e of edges){e.aNode=node(e.segments[0].a,e.layer);e.bNode=node(e.segments.at(-1).b,e.layer);e.aNode.edges.push(e);e.bNode.edges.push(e);}
    const used=new Set(),out=[];
    function walk(first,start){
      let edge=first,n=start;const segments=[],names=[];let index=first.index;
      while(edge&&!used.has(edge)){
        used.add(edge);index=Math.min(index,edge.index);names.push(edge.name);
        segments.push(...(n===edge.aNode?edge.segments:edge.segments.slice().reverse().map(reversed)));
        n=n===edge.aNode?edge.bNode:edge.aNode;
        if(n===start||n.edges.length!==2)break;
        edge=n.edges.find(e=>!used.has(e));
      }
      out.push({segments,closed:n===start,index,color:first.color,name:names[0]+(names.length>1?' + '+(names.length-1)+' joined':'')});
    }
    for(const e of edges)if(!used.has(e)&&(e.aNode.edges.length!==2||e.bNode.edges.length!==2))walk(e,e.aNode.edges.length!==2?e.aNode:e.bNode);
    for(const e of edges)if(!used.has(e))walk(e,e.aNode);
    return out;
  }
  function prepare(text,o={}){
    const opts=options(o),sections=read(text),header=sections.get('HEADER')||[];
    const at=header.findIndex(t=>t[0]===9&&t[1]==='$INSUNITS');
    const unitCode=at<0?0:integer([header[at+1]||[]],70,0);
    const choice=o.dxfUnits??'auto',unit=choice==='auto'?units[unitCode]:overrides[choice];
    if(!unit)throw Error(choice==='auto'?'DXF units are missing, unitless, or unsupported. Choose DXF units in Artwork, then Reimport.':'Invalid DXF units selection.');
    const [unitName,factor]=unit,warnings=[`DXF units: ${unitName}${choice==='auto'?' (from file)':' (manual override)'}. Output is millimeters.`];
    const hidden=new Set(),layerColor=new Map();
    for(const r of records(sections.get('TABLES')||[]))if(r.type==='LAYER'&&(num(r.tags,62,7)<0||(integer(r.tags,70,0)&1)))hidden.add(get(r.tags,2,''));
    for(const r of records(sections.get('TABLES')||[]))if(r.type==='LAYER'){const c=Math.abs(num(r.tags,62,7)),t=get(r.tags,420);layerColor.set(get(r.tags,2,''),t!==undefined?'#'+(Number(t)&0xffffff).toString(16).padStart(6,'0'):aci(c));}
    const entities=records(sections.get('ENTITIES')),paths=[],edges=[],skipped=new Map();let widths=false;
    const skip=type=>skipped.set(type,(skipped.get(type)||0)+1);
    const coord=(tags,x,y)=>{const p={x:num(tags,x),y:num(tags,y)};if(Math.max(Math.abs(p.x*factor),Math.abs(p.y*factor))>1000000)throw Error('DXF coordinates exceed the supported range. Check drawing units.');return p;};
    function flat(tags){
      for(const [code,value]of tags)if([30,31,38,39].includes(code)&&Math.abs(num([[code,value]],code)*factor)>1e-8)throw Error('Only flat 2D DXF at Z=0 is supported. Flatten the drawing before importing.');
      if(Math.abs(num(tags,210,0))>1e-10||Math.abs(num(tags,220,0))>1e-10||Math.abs(num(tags,230,1)-1)>1e-10)throw Error('DXF with a tilted or reversed extrusion axis is unsupported. Flatten it to the XY plane.');
    }
    function polyline(vertices,closed){
      if(vertices.length<2||vertices.length>3000)throw Error('DXF polyline needs 2 to 3000 vertices.');
      const segments=[];for(let j=0;j<vertices.length-(closed?0:1);j++){const s=segment(vertices[j],vertices[(j+1)%vertices.length],vertices[j].bulge);if(s)segments.push(s);}return segments;
    }
    for(let i=0;i<entities.length;i++){
      const r=entities[i],t=r.tags,index=i,layer=get(t,8,'0'),name=r.type+' '+get(t,5,String(i+1))+' ['+layer+']';let vertices=[];
      if(r.type==='POLYLINE'){
        while(entities[i+1]?.type==='VERTEX')vertices.push(entities[++i]);
        if(entities[++i]?.type!=='SEQEND')throw Error('DXF POLYLINE is missing SEQEND.');
      }
      if(integer(t,67,0)===1||integer(t,60,0)===1||hidden.has(layer)){skip('hidden/paper-space entities');continue;}
      if(['TEXT','MTEXT','ATTRIB','ATTDEF','DIMENSION','LEADER','MLEADER','POINT','VIEWPORT'].includes(r.type)){skip(r.type);continue;}
      if(!['LINE','ARC','CIRCLE','LWPOLYLINE','POLYLINE'].includes(r.type))throw Error('Unsupported DXF entity '+r.type+'. Convert blocks/splines/hatches to lines, arcs or 2D polylines before importing.');
      flat(t);let segments=[],closed=false;
      if(r.type==='LINE'){
        const s=segment(coord(t,10,20),coord(t,11,21));if(s)segments.push(s);
      }else if(r.type==='ARC'||r.type==='CIRCLE'){
        const center=coord(t,10,20),radius=num(t,40);if(!(radius>0&&radius*factor<=1000000))throw Error('DXF radius must be positive and within range.');
        const point=a=>({x:center.x+radius*Math.cos(a),y:center.y+radius*Math.sin(a)});
        if(r.type==='CIRCLE'){
          const a=point(0),b=point(Math.PI);segments=[{a,b,r:radius,large:0,sweep:1},{a:b,b:a,r:radius,large:0,sweep:1}];closed=true;
        }else{
          const start=num(t,50),end=num(t,51),sweep=((end-start)%360+360)%360;
          if(sweep<1e-10)throw Error('DXF ARC has a zero sweep. Use a CIRCLE for a full circle.');
          segments=[{a:point(start*Math.PI/180),b:point((start+sweep)*Math.PI/180),r:radius,large:sweep>180?1:0,sweep:1}];
        }
      }else{
        const flags=integer(t,70,0);closed=!!(flags&1);
        if(flags&~129)throw Error('Only ordinary 2D polylines are supported; flatten fitted curves, 3D polylines and meshes first.');
        let points=[];
        if(r.type==='LWPOLYLINE'){
          let vertex;
          for(const tag of t){if(tag[0]===10){vertex=[];points.push(vertex);}if(vertex&&[10,20,42].includes(tag[0]))vertex.push(tag);}
          if(integer(t,90)!==points.length)throw Error('DXF polyline vertex count does not match its data.');
        }else{
          points=vertices.map(v=>{flat(v.tags);if(integer(v.tags,70,0)!==0)throw Error('Fitted/3D DXF vertices are unsupported.');return v.tags;});
        }
        widths=widths||[t,...points,...vertices.map(v=>v.tags)].some(tags=>tags.some(([c,v])=>[40,41,43].includes(c)&&num([[c,v]],c)!==0));
        segments=polyline(points.map(tags=>({...coord(tags,10,20),bulge:num(tags,42,0)})),closed);
      }
      if(!segments.length){skip('zero-length entities');continue;}
      // True color (420) wins, then an explicit ACI (62); 0/256/missing follow the layer.
      const aciIndex=integer(t,62,256),trueColor=get(t,420);
      const color=trueColor!==undefined?'#'+(Number(trueColor)&0xffffff).toString(16).padStart(6,'0'):(aciIndex>0&&aciIndex<256)?aci(aciIndex):(layerColor.get(layer)||'#000000');
      const path={segments,closed,index,name,layer:layer+'|'+color,color};
      if(r.type==='LINE'||r.type==='ARC')edges.push(path);else paths.push(path);
      if(paths.length+edges.length>10000)throw Error('DXF exceeds 10,000 geometry entities. Split the drawing.');
    }
    const joined=join(edges,factor);if(joined.length<edges.length)warnings.push(`Joined ${edges.length} connected line/arc entities into ${joined.length} contour(s), within each layer.`);
    paths.push(...joined);paths.sort((a,b)=>a.index-b.index);
    if(paths.length>500)throw Error('Limit: 500 contours. Split this DXF into smaller jobs.');
    if(!paths.length)throw Error('No supported visible 2D geometry found in DXF model space.');
    for(const [type,count]of skipped)warnings.push(`Skipped ${count} ${type}: not cut geometry.`);
    if(widths)warnings.push('DXF polyline widths are ignored; cutting follows centerlines.');
    const items=paths.map(p=>{
      if(p.segments.length>3000)throw Error('A DXF contour exceeds 3000 segments. Split or simplify it.');
      return {d:'M '+pointText(p.segments[0].a)+' '+p.segments.map(command).join(' ')+(p.closed?' Z':''),closed:p.closed,name:p.name,color:p.color,matrix:[factor,0,0,-factor,0,0],height:0};
    });
    return {items,options:opts,width:1,height:1,dxfWarnings:warnings};
  }
  function finish(doc,prepared){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of doc.paths)for(const q of p.points){if(Math.max(Math.abs(q.x),Math.abs(q.y))>1000000)throw Error('DXF exceeds supported coordinate range. Check units.');minX=Math.min(minX,q.x);minY=Math.min(minY,q.y);maxX=Math.max(maxX,q.x);maxY=Math.max(maxY,q.y);}
    doc.width=maxX-minX;doc.height=maxY-minY;doc.page=[{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}];
    doc.warnings=[...prepared.dxfWarnings,...doc.warnings.filter(w=>!w.includes('SVG'))];
    const open=doc.paths.filter(p=>!p.closed).length;if(open)doc.warnings.push(`${open} open contour(s). Check gaps before cutting.`);
    doc.warnings.push('DXF geometry defines centerline cuts. DXF has no page; page origin bounds use artwork extents.');return doc;
  }
  function importError(error,prepared){if(error.name!=='AbortError')error.message=prepared.dxfWarnings[0]+' '+error.message;return error;}
  function parse(text,o){const prepared=prepare(text,o);const geometry=typeof module!=='undefined'?require('./geometry.js'):root.SvgGeometry;try{return finish(geometry.run(prepared),prepared);}catch(e){throw importError(e,prepared);}}
  async function parseAsync(text,o,{signal,onProgress=()=>{}}={}){
    const abort=()=>{if(signal?.aborted)throw new DOMException('Import canceled.','AbortError');};
    abort();onProgress({stage:'Reading DXF',fraction:0});await new Promise(resolve=>setTimeout(resolve,0));abort();
    const prepared=prepare(text,o);abort();
    onProgress({stage:prepared.dxfWarnings[0],fraction:0});
    try{return finish(await root.SvgImport.processPreparedAsync(prepared,{signal,onProgress}),prepared);}catch(e){throw importError(e,prepared);}
  }
  const api={aci,prepare,parse,parseAsync};if(typeof module!=='undefined')module.exports=api;else root.DxfImport=api;
})(typeof window==='undefined'?globalThis:window);
