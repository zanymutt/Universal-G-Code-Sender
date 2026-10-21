var e=/([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g,t=2*Math.PI,n=128,r=(e,t,n,r,i,a)=>{if(r!==void 0||i!==void 0)return{x:e.x+(r??0),y:e.y+(i??0)};if(a===void 0)return null;let o=t.x-e.x,s=t.y-e.y,c=Math.hypot(o,s);if(c===0)return null;let l=Math.sqrt(Math.max(0,a*a-c/2*(c/2))),u=(n?1:-1)*(a<0?-1:1);return{x:(e.x+t.x)/2+u*l*s/c,y:(e.y+t.y)/2-u*l*o/c}};function i(i,a={}){let o=[],s=[],c={...a.start??{x:0,y:0,z:0}},l=0,u=a.relative??!1,d=!1,ee=17,te=0,ne=null;return i.split(/\r?\n/).forEach((i,a)=>{let re=a+1,f=i.replace(/\([^)]*\)/g,``).replace(/;.*/,``).trim();if(!f||/^[%#$]/.test(f)||/^o\d/i.test(f)||f.includes(`[`))return;let p=[],m={},ie=0,ae=!1,h=!1,g=null,_=!1;for(let t of f.matchAll(e)){let e=t[1].toUpperCase(),n=parseFloat(t[2]);if(e===`X`||e===`Y`||e===`Z`||e===`I`||e===`J`||e===`R`)m[e]=n;else if(e===`F`)te=n;else if(e===`S`)p.push({kind:`spindleSpeed`,value:n});else if(e===`P`)ie=n;else if(e===`T`)g=Math.round(n);else if(e===`G`){let e=Math.round(n*10)/10;e>=0&&e<=3?l=e:e===4?h=!0:e===17||e===18||e===19?(ee=e,p.push({kind:`modal`,field:`plane`,value:`G${e}`})):e===20||e===21?(d=e===20,p.push({kind:`modal`,field:`units`,value:`G${e}`})):e===53?ae=!0:e>=54&&e<=59?p.push({kind:`modal`,field:`coordinateSystem`,value:`G${e}`}):(e===90||e===91)&&(u=e===91,p.push({kind:`modal`,field:`distanceMode`,value:`G${e}`}))}else if(e===`M`){let e=Math.round(n);e===3||e===4||e===5?p.push({kind:`spindle`,mode:`M${e}`}):e===7||e===8||e===9?p.push({kind:`coolant`,mode:`M${e}`}):e===6&&(_=!0)}}g!==null&&(ne=g),_&&p.push({kind:`toolChange`,tool:ne});let v=[];if((m.X!==void 0||m.Y!==void 0||m.Z!==void 0)&&!h&&!ae&&l<=3){let e={x:m.X===void 0?c.x:u?c.x+m.X:m.X,y:m.Y===void 0?c.y:u?c.y+m.Y:m.Y,z:m.Z===void 0?c.z:u?c.z+m.Z:m.Z},i=(e,t,n)=>({start:e,end:t,rapid:l===0,arc:n,lineNumber:re,feedRate:te,inches:d}),a=(l===2||l===3)&&ee===17?r(c,e,l===2,m.I,m.J,m.R):null;if(a){let r=Math.hypot(c.x-a.x,c.y-a.y),o=Math.atan2(c.y-a.y,c.x-a.x),s=Math.atan2(e.y-a.y,e.x-a.x)-o;if(l===2)for(;s>=0;)s-=t;else for(;s<=0;)s+=t;let u=Math.max(4,Math.ceil(Math.abs(s)/t*n)),d={...c};for(let t=1;t<=u;t++){let n=o+t/u*s,l=t===u?{...e}:{x:a.x+r*Math.cos(n),y:a.y+r*Math.sin(n),z:c.z+(e.z-c.z)*(t/u)};v.push(i(d,l,!0)),d=l}}else v.push(i({...c},e,!1));c.x=e.x,c.y=e.y,c.z=e.z}(v.length>0||p.length>0||h&&ie>0)&&(o.push({line:re,segments:v,effects:p,dwellSeconds:h?ie:0}),s.push(...v))}),{commands:o,segments:s}}function a(e,t){if(t<=1)return e.segments;let n=e.segments.filter(e=>e.lineNumber>=t);if(n.length===0)return n;let r=n[0];return[{start:{x:r.start.x,y:r.start.y,z:r.start.z+10},end:{...r.start},rapid:!1,arc:!1,lineNumber:r.lineNumber,feedRate:r.feedRate,inches:r.inches},...n]}var o=new Set(`G4 G10 G28 G28.1 G28.2 G28.3 G30 G53 G80 G92 G92.1 G92.2 G92.3 G0 G1 G2 G3 G33 G38.2 G38.3 G38.4 G38.5 G73 G76 G81 G82 G83 G84 G85 G86 G87 G88 G89 G17 G18 G19 G17.1 G18.1 G19.1 G90 G91 G90.1 G91.1 G93 G94 G95 G20 G21 G40 G41 G42 G41.1 G42.1 G43 G43.1 G49 G98 G99 G54 G55 G56 G57 G58 G59 G59.1 G59.2 G59.3 G61 G61.1 G64 G96 G97 G7 G8 M0 M1 M2 M30 M60 M3 M4 M5 M6 M7 M8 M9 M48 M49`.split(` `)),s=new Set([`G0`,`G1`,`G2`,`G3`,`G38.2`,`G38.3`,`G38.4`,`G38.5`,`G80`,`G81`,`G82`,`G83`,`G84`,`G85`,`G86`,`G87`,`G88`,`G89`]),c=`GMXYZABCIJKRFSNTPLOUVWHEQD`,l=e=>e>=`0`&&e<=`9`,u=e=>/\p{L}/u.test(e),d=e=>{if(e.startsWith(`$`))return[e];let t=[],n=!1,r=!1,i=0,a=``;for(let o of e){if(o===`(`&&!r){i===0&&a.length>0&&(t.push(a),a=``),a+=o,i++,n=!1;continue}if(i>0&&o===`)`){a+=o,i--,i===0&&(t.push(a),a=``);continue}if(o===`;`&&!r&&i===0){a.length>0&&(t.push(a),a=``),a+=o,r=!0;continue}if(r||i>0)a+=o;else if(/\s/.test(o))continue;else n&&!l(o)&&o!==`.`?(n=!1,t.push(a),a=``,u(o)&&(a+=o)):l(o)||o===`.`||o===`-`?(a+=o,n=!0):u(o)&&(a+=o)}return a.length>0&&t.push(a),t},ee=e=>{let t=e[0].toUpperCase(),n=1;for(let t=1;t<e.length&&(n=t,e[t]===`0`);t++);return t+e.slice(n)},te=e=>/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(e),ne=(e,t,n)=>{let r=0;for(let i of d(e)){if(i===``||i.startsWith(`(`)||i.startsWith(`;`)||i.startsWith(`$`))continue;let a=i[0].toUpperCase();if(a===`G`||a===`M`){let c=ee(i);o.has(c)?s.has(c)&&r++:n.push({lineNumber:t,severity:`WARNING`,message:`Unknown ${a}-code '${i}'. The controller may support it.`,source:e})}i.length>1&&c.includes(a)&&!te(i.slice(1))&&n.push({lineNumber:t,severity:`ERROR`,message:`Malformed numeric word '${i}'.`,source:e})}r>1&&n.push({lineNumber:t,severity:`ERROR`,message:`multiple motion codes appear in one block.`,source:e})},re=(e,t)=>{let n=(t??``).split(/\r\n|\r|\n/),r=[];return n.forEach((e,t)=>ne(e,t+1,r)),{fileName:e,lineCount:n.length,diagnostics:r}},f={"heart.gcode":`(Made in : Autodesk CAM Post Processor)
(G-Code optimized for Grbl 1.1 / BlackBox controller)
(Neo 11 OpenBuilds CNC : GRBL/BlackBox)
(Post-Processor : OpenbuildsFusion360PostGrbl_NeoMod_11_dualprobe.cps)
(V1.0.43)
(Units = mm)
(Laser UseZ = false)
(Laser UsePierce = false)

(Arcs are limited to the XY plane: if you want vertical arcs then)
(edit allowedCircularPlanes in the CPS file)

(Drawing name : Untitled)
(Program Name : yeheart)

(1 Operation :)
(1 : 2D Profile1)
(  Work Coordinate System : G54)
(  Tool 2: Plasma Cutter Diam = 1mm)
(  Machining time : 0h:0m:5s)

G90 G94 G17
G21

(Plasma pierce height 3)
(Plasma topHeight 1.5)

(Operation 1 of 1 : 2D Profile1)
G54
(Plasma cutting with GRBL.)
(Using pierce delay.)
G0 X14.536 Y-39.159 F2500
G0 X14.536 Y-39.159 Z25

(Torch height probe removed for the online demo)
G0 X14.536 Y-39.159  ; move over the start point
Z3
M4 S1000
G4 P0.4
G1 Z1.5 F2500
M8
G1 X17.615 Y-35.22
X17.684 Y-35.12
X17.74 Y-35.013
X17.782 Y-34.9
X17.811 Y-34.783
X17.825 Y-34.663
X17.825 Y-34.542
X17.811 Y-34.423
X17.782 Y-34.305
X17.739 Y-34.192
X17.682 Y-34.086
X17.614 Y-33.986
X17.534 Y-33.896
X17.443 Y-33.816
X16.009 Y-32.695
G2 X9.593 Y-30.954 I-1.223 J8.185
G3 X3.474 Y-28.118 I-23.564 J-42.817
G2 X8.283 Y-14.53 I4.193 J6.16
G1 X8.887 Y-14.726
X9.956 Y-14.975
X12.238 Y-14.602
G2 X21.285 Y-8.402 I10.022 J-4.924
X22.641 Y-3.304 I10.516 J-0.066
X35.606 Y-7.997 I5.852 J-4.087
G1 X35.929 Y-8.456
G3 X38.562 Y-9.098 I2.563 J4.788
G2 X46.372 Y-14.445 I-2.044 J-11.363
X55.301 Y-19.517 I2.327 J-6.299
X52.282 Y-27.616 I-6.105 J-2.337
X47.854 Y-30.697 I-11.319 J11.549
X42.407 Y-33.25 I-7.13 J8.125
X40.781 Y-33.225 I-0.738 J5.045
G1 X37.02 Y-38.421
G2 X31.552 Y-42.626 I-15.169 J14.064
G1 X31.465 Y-42.721
X31.388 Y-42.825
X31.325 Y-42.938
X31.274 Y-43.057
X31.238 Y-43.181
X31.216 Y-43.308
X31.209 Y-43.437
X31.217 Y-43.566
X31.239 Y-43.693
X31.276 Y-43.816
G2 X24.405 Y-48.465 I-5.701 J1.025
G1 X24.174 Y-48.371
X23.949 Y-48.263
X23.731 Y-48.141
X23.522 Y-48.006
X23.321 Y-47.858
X23.131 Y-47.697
X22.95 Y-47.524
X22.781 Y-47.341
X22.624 Y-47.147
X22.48 Y-46.943
X22.349 Y-46.731
X22.231 Y-46.511
X22.128 Y-46.284
X22.039 Y-46.051
X21.965 Y-45.812
X21.906 Y-45.57
X21.863 Y-45.324
X21.705 Y-45.133
X21.56 Y-44.932
X21.428 Y-44.723
X21.309 Y-44.506
X21.203 Y-44.282
X21.112 Y-44.052
X21.035 Y-43.817
X20.973 Y-43.577
X20.925 Y-43.334
X20.893 Y-43.088
X20.877 Y-42.841
X20.875 Y-42.594
X20.889 Y-42.346
X20.918 Y-42.101
X20.963 Y-41.857
X21.022 Y-41.617
X21.097 Y-41.38
X21.185 Y-41.149
X21.013 Y-40.208
X20.536 Y-36.527
X19.58 Y-35.569
X18.359 Y-34.532
X16.655 Y-33.2
M5
G4 p0.5
M9
G0 Z30
G0 Z40

M5
G0 X0 Y0
M30
`,"arcs-and-slot.nc":`(UGS Dashboard demo: a circular pocket and a rounded slot, cut in two passes)
(Units = mm)
G21 G90 G17 G54
M3 S12000
G0 Z5
(--- circular pocket, R20 centred on X40 Y30 ---)
G0 X60 Y30
G1 Z-1 F300
G2 X60 Y30 I-20 J0 F900
G1 Z-2 F300
G2 X60 Y30 I-20 J0 F900
G0 Z5
(--- slot from X10 to X70 with rounded ends ---)
G0 X10 Y70
G1 Z-1 F300
G1 X70 F900
G2 X70 Y60 I0 J-5
G1 X10
G2 X10 Y70 I0 J5
G1 Z-2 F300
G1 X70 F900
G2 X70 Y60 I0 J-5
G1 X10
G2 X10 Y70 I0 J5
G0 Z5
M5
G0 X0 Y0
M30
`,"Examples/spiral-pocket.nc":(()=>{let e=[`(UGS Dashboard demo: 60 x 40 mm pocket, three depth passes)`,`(Units = mm)`,`G21 G90 G17 G54`,`M3 S10000`,`G0 Z5`];for(let t=1;t<=3;t++){e.push(`(--- depth pass ${t}: Z-${t} ---)`),e.push(`G0 X0 Y0`),e.push(`G1 Z-${t} F250`);for(let t=0;t*2<39;t+=4){let n=t,r=t,i=60-t,a=40-t;e.push(`G1 X${n} Y${r} F800`),e.push(`G1 X${i} Y${r}`),e.push(`G1 X${i} Y${a}`),e.push(`G1 X${n} Y${a}`),e.push(`G1 X${n} Y${r+4}`)}e.push(`G0 Z5`)}return e.push(`M5`,`G0 X0 Y0`,`M30`),e.join(`
`)+`
`})()},p=`heart.gcode`,m=3e3,ie=40,ae=250,h=100,g={x:0,y:0,z:0},_={jogFeedRate:3e3,jogStepSizeXY:1,preferredUnits:`MM`,jogStepSizeZ:1,port:`Demo machine`,portRate:`115200`,firmwareVersion:`GRBL`,useZStepSize:!0,workspaceDirectory:`Online demo (nothing is saved)`},v={machineCoord:{x:0,y:0,z:0,a:null,b:null,c:null,units:`MM`},workCoord:{x:0,y:0,z:0,a:null,b:null,c:null,units:`MM`},feedSpeed:0,spindleSpeed:0,accessoryStates:{spindleCW:!1,flood:!1,mist:!1},overrides:{feed:100,rapid:100,spindle:100},floodCoolantOn:!1,motionMode:`G0`,coordinateSystem:`G54`,plane:`G17`,distanceMode:`G90`,feedMode:`G94`,units:`G21`,spindleMode:`M5`,toolNumber:0,state:`IDLE`,pins:{x:!1,y:!1,z:!1,a:!1,b:!1,c:!1,probe:!1,door:!1,hold:!1,softReset:!1,cycleStart:!1}},y={x:120,y:80,z:-30},b={G54:{x:120,y:80,z:-40},G55:{x:0,y:0,z:0},G56:{x:0,y:0,z:0},G57:{x:0,y:0,z:0},G58:{x:0,y:0,z:0},G59:{x:0,y:0,z:0}},oe=0,se={feedRateFast:100,feedRateSlow:10,retractDistance:3,delayAfterRetract:1,probeDiameter:3.175,plateThickness:15,maxTravel:25,compensateSoftLimits:!0},x=[{uuid:`m1`,name:`Home`,description:`Home all axes`,gcode:`$H`,color:`#4ade80`,icon:`home`},{uuid:`m2`,name:`Zero XY`,description:`Zero X/Y work offset`,gcode:`G10 L20 P1 X0 Y0`,color:`#60a5fa`,icon:`crosshairs`},{uuid:`m3`,name:`Spindle On`,description:void 0,gcode:`M3 S1000`}],S={...f},C={},ce=new Set,le=new Map([{path:`Samples/bowl-ballnose.nc`,size:105387,url:`samples/bowl-ballnose.nc`},{path:`Samples/electric_turtle.nc`,size:73556,url:`samples/electric_turtle.nc`},{path:`Samples/enclosure.nc`,size:149471,url:`samples/enclosure.nc`},{path:`Samples/GANESHA.gcode`,size:9247650,url:`samples/GANESHA.gcode`},{path:`Samples/laser-gradient-engrave.nc`,size:26698,url:`samples/laser-gradient-engrave.nc`},{path:`Samples/mountains.nc`,size:6555049,url:`samples/mountains.nc`},{path:`Samples/multi-tool-stock.nc`,size:3022,url:`samples/multi-tool-stock.nc`},{path:`Samples/ordbot_handle.nc`,size:141637,url:`samples/ordbot_handle.nc`},{path:`Samples/plasma-bracket.nc`,size:323,url:`samples/plasma-bracket.nc`},{path:`Samples/plotter-pens.nc`,size:17488,url:`samples/plotter-pens.nc`},{path:`Samples/pocket-multipass-flat.nc`,size:1483,url:`samples/pocket-multipass-flat.nc`},{path:`Samples/tool-change-m6.nc`,size:380,url:`samples/tool-change-m6.nc`},{path:`Samples/wave-relief-ballnose.nc`,size:246090,url:`samples/wave-relief-ballnose.nc`}].map(e=>[e.path,{size:e.size,url:e.url}]));Object.keys(S).concat([...le.keys()]).forEach((e,t)=>C[e]=Date.now()-t*17*60*1e3);var ue=async e=>{if(S[e]!==void 0)return!0;let t=le.get(e);if(!t)return!1;try{let n=await window.fetch(new URL(t.url,document.baseURI).toString());return n.ok?(S[e]=await n.text(),!0):!1}catch{return!1}},de={},w=``,T={commands:[],segments:[]},E=0,D={sendState:`IDLE`,fileName:``,rowCount:0,completedRowCount:0,remainingRowCount:0,sendDuration:0,sendRemainingDuration:0,lastCompletedLineNumber:-1},O=new Set,k,fe=0,A=e=>O.forEach(t=>t(e)),j=(e,t,n=``,r=!1)=>A({eventType:`CommandEvent`,event:{commandEventType:e,command:{command:t,response:n,isError:!1,isOk:r}}}),M=()=>{let e=b[v.coordinateSystem]??b.G54;Object.assign(v.machineCoord,{x:y.x,y:y.y,z:y.z}),Object.assign(v.workCoord,{x:y.x-e.x,y:y.y-e.y,z:y.z-e.z})},pe=()=>(M(),JSON.stringify(v)),N=()=>(M(),{x:v.workCoord.x,y:v.workCoord.y,z:v.workCoord.z}),P=()=>{let e=JSON.parse(pe());A({eventType:`ControllerStatusEvent`,event:{status:e,previousStatus:e}})},me=()=>v.state!==`IDLE`&&v.state!==`DISCONNECTED`,he=()=>{fe++,(me()||fe%2==0)&&P()},ge=e=>(O.add(e),k===void 0&&(k=window.setInterval(he,ae)),()=>{O.delete(e),O.size===0&&k!==void 0&&(window.clearInterval(k),k=void 0)}),_e=()=>{M();let{x:e,y:t,z:n}=v.machineCoord;return`<${v.state}|MPos:${e.toFixed(3)},${t.toFixed(3)},${n.toFixed(3)}|FS:${Math.round(v.feedSpeed)},${Math.round(v.spindleSpeed)}>`},F=()=>{v.accessoryStates.spindleCW&&(v.spindleSpeed=Math.round(oe*v.overrides.spindle/100))},ve=e=>{switch(e.kind){case`spindle`:v.spindleMode=e.mode,v.accessoryStates.spindleCW=e.mode!==`M5`,v.spindleSpeed=e.mode===`M5`?0:Math.round(oe*v.overrides.spindle/100);break;case`spindleSpeed`:oe=e.value,F();break;case`coolant`:v.floodCoolantOn=e.mode===`M8`,v.accessoryStates.flood=e.mode===`M8`,v.accessoryStates.mist=e.mode===`M7`;break;case`modal`:v[e.field]=e.value;break;case`toolChange`:L===`job`&&Fe(e.tool);break}},I=[],L=`idle`,R=!1,z={state:`INACTIVE`},B=!1,V,H,U=0,ye=0,W=null,G=[],be=e=>{let t=b[v.coordinateSystem]??b.G54;return{x:e.x+t.x,y:e.y+t.y,z:e.z+t.z}},xe=e=>e.rapid?m*(e.overridable?v.overrides.rapid:100)/100/60:(e.feed>0?e.feed:1e3)*(e.overridable?v.overrides.feed:100)/100/60,Se=(e,t)=>{let n=0,r={...t};for(let t of e){if(t.target){let e=Math.hypot(t.target.x-r.x,t.target.y-r.y,t.target.z-r.z);n+=e/(xe({...t,overridable:!1})||1),r=t.target}n+=t.dwell}return n},Ce=()=>v.state===`DISCONNECTED`?`DISCONNECTED`:B||L===`idle`?`IDLE`:R?`HOLD`:{jog:`JOG`,mdi:`RUN`,job:`RUN`,home:`HOME`,idle:`IDLE`}[L],K=()=>{v.state=Ce(),L!==`idle`&&!R||(v.feedSpeed=0)},we=()=>{let e=L;L=`idle`,R=!1,v.feedSpeed=0,e===`job`&&W&&(D.sendState=`COMPLETED`,D.completedRowCount=W.streamRows,D.remainingRowCount=0,D.sendRemainingDuration=0,W=null),K(),P();let t=G;G=[],t.forEach(e=>e()),e===`job`&&j(`COMMAND_SKIPPED`,``)},Te=e=>{if(!W)return;W.completedRows++,D.completedRowCount=W.completedRows,D.remainingRowCount=Math.max(0,W.streamRows-W.completedRows),D.lastCompletedLineNumber=e;let t=performance.now();t-ye>=h&&(ye=t,j(`COMMAND_SKIPPED`,``))},Ee=()=>{let e=performance.now(),t=Math.min(.25,(e-U)/1e3);if(U=e,R||B||I.length===0)return;let n=t;for(W&&(W.elapsed+=t,D.sendDuration=Math.round(W.elapsed*1e3),D.sendRemainingDuration=Math.max(0,Math.round((W.totalSeconds-W.elapsed)*1e3)));n>1e-9&&I.length>0;){let e=I[0];if(!e.started){if(e.started=!0,e.effect?.(),B)break;e.target&&(e.machineTarget=be(e.target)),v.feedSpeed=e.rapid?m:Math.round(e.feed*(e.overridable?v.overrides.feed:100)/100)}if(e.machineTarget){let t=e.machineTarget.x-y.x,r=e.machineTarget.y-y.y,i=e.machineTarget.z-y.z,a=Math.hypot(t,r,i);if(a>1e-9){let o=xe(e),s=o*n;if(s<a){let e=s/a;y.x+=t*e,y.y+=r*e,y.z+=i*e,n=0;break}y.x=e.machineTarget.x,y.y=e.machineTarget.y,y.z=e.machineTarget.z,n-=a/o}}if(e.dwell>0){let t=Math.min(n,e.dwell);if(e.dwell-=t,n-=t,e.dwell>1e-9)break}I.shift(),e.lastOfLine&&e.line>0&&Te(e.line),e.done?.()}I.length===0&&(H!==void 0&&(window.clearInterval(H),H=void 0),we())},q=(e,t)=>{t.length!==0&&v.state!==`DISCONNECTED`&&(L=e,R=!1,I.push(...t),K(),H===void 0&&(U=performance.now(),H=window.setInterval(Ee,ie)),P())},J=()=>{Ve(!1),Ne(),I=[],H!==void 0&&(window.clearInterval(H),H=void 0);let e=L;L=`idle`,R=!1,v.feedSpeed=0,e===`job`&&W&&(D.sendState=`CANCELED`,D.sendRemainingDuration=0,W=null,ve({kind:`spindle`,mode:`M5`})),G=[],K(),P()},De=()=>{L===`idle`||R||(R=!0,W&&(D.sendState=`PAUSED`),K(),P())},Oe=()=>{R&&(R=!1,U=performance.now(),W&&(D.sendState=`RUNNING`),K(),P())},ke=`toolChange.changeTool`,Ae=`toolChange.continue`,je=450,Y=e=>{z={...e,previousState:z.state},A({eventType:`InterceptorStateEvent`,event:z})},Me=e=>{B=e,e||(U=performance.now()),K(),P()},Ne=()=>{V!==void 0&&(window.clearTimeout(V),V=void 0);let e=z.state!==`INACTIVE`;B=!1,e&&Y({state:`INACTIVE`})},Pe=e=>{V=window.setTimeout(()=>{V=void 0,e()},je)},Fe=e=>{let t={triggerCommand:e===null?`M6`:`T${e} M6`,toolNumber:e};Y({...t,state:`PENDING`}),Me(!0),Pe(()=>{ve({kind:`spindle`,mode:`M5`}),Y({...t,state:`RUNNING`}),Pe(()=>Y({...t,state:`WAITING_FOR_USER`,prompt:{stepId:ke,options:[`CONTINUE`,`ABORT`]}}))})},Ie=e=>{if(e!==`CONTINUE`&&e!==`SKIP`&&e!==`ABORT`)return Q({errorMessage:`Missing response`},400);if(e===`ABORT`)return z.state===`INACTIVE`?Q({errorMessage:`There is nothing to abort`},409):(J(),Q(z));if(z.state!==`WAITING_FOR_USER`)return Q({errorMessage:`Nothing is waiting for an answer`},409);let t=z.prompt;if(!t||!t.options.includes(e))return Q({errorMessage:`The current step does not accept ${e}`},400);let n={triggerCommand:z.triggerCommand,toolNumber:z.toolNumber};return t.stepId===ke?Y({...n,state:`WAITING_FOR_USER`,prompt:{stepId:Ae,options:[`CONTINUE`,`ABORT`]}}):(Y({...n,state:`RESUMING`}),Pe(()=>{Y({state:`INACTIVE`}),Me(!1)})),Q(z)},Le=(e,t,n)=>{let r=[],i=t<=1;for(let a of e){let e=()=>a.effects.forEach(ve);if(a.line<t){a.effects.length>0&&r.push({target:null,rapid:!1,feed:0,overridable:!1,dwell:0,line:0,lastOfLine:!1,effect:e});continue}if(a.segments.length===0){r.push({target:null,rapid:!1,feed:0,overridable:!1,dwell:a.dwellSeconds,line:n?a.line:0,lastOfLine:!0,effect:e});continue}if(!i){i=!0;let e=a.segments[0];r.push({target:{x:e.start.x,y:e.start.y,z:e.start.z+10},rapid:!0,feed:0,overridable:!0,dwell:0,line:0,lastOfLine:!1}),r.push({target:{...e.start},rapid:!1,feed:e.feedRate,overridable:!0,dwell:0,line:0,lastOfLine:!1})}a.segments.forEach((t,i)=>{r.push({target:t.end,rapid:t.rapid,feed:t.feedRate,overridable:!0,dwell:0,line:n?a.line:0,lastOfLine:i===a.segments.length-1,effect:i===0&&a.effects.length>0?e:void 0})})}return r},Re=e=>{let t=I.length>0?I[I.length-1].target??N():N();return{target:{x:t.x+e.x,y:t.y+e.y,z:t.z+e.z},rapid:!1,feed:_.jogFeedRate,overridable:!1,dwell:0,line:0,lastOfLine:!1}},ze=500,Be=.05,X=null,Ve=e=>{X&&(window.clearInterval(X.timer),X=null,e&&L===`jog`&&J())},He=()=>{if(!X)return;let e=v.state===`IDLE`||v.state===`JOG`;if(performance.now()>X.expiresAt||!e){Ve(!0);return}if(I.length<2){let e=_.jogFeedRate/60*Be,{dir:t}=X;q(`jog`,[Re({x:t.x*e,y:t.y*e,z:t.z*e})])}},Ue=(e,t)=>{if(v.state===`DISCONNECTED`||L===`job`){t();return}let n=[];for(let t of e.split(/\r?\n/)){let e=t.trim(),r=e.toUpperCase();if(e){if(r===`$H`)We();else if(r===`$X`)v.state=`IDLE`;else if(r.startsWith(`$J=`))n.push(e.slice(3));else if(!r.startsWith(`$`))if(/G10\s+L20/.test(r)){let e=r.match(/P(\d)/),t=b[`G${53+(e?parseInt(e[1],10):1)}`]??b.G54;for(let e of[`X`,`Y`,`Z`]){let n=r.match(RegExp(`${e}(-?[0-9.]+)`));n&&(t[e.toLowerCase()]=y[e.toLowerCase()]-parseFloat(n[1]))}}else n.push(e)}}let r=Le(i(n.join(`
`),{start:N(),relative:v.distanceMode===`G91`}).commands,0,!1);if(r.length===0){t();return}G.push(t),q(`mdi`,r)},We=()=>{if(v.state===`DISCONNECTED`)return;let e=e=>{let t=b[v.coordinateSystem]??b.G54;return{x:e.x-t.x,y:e.y-t.y,z:e.z-t.z}},t={rapid:!0,feed:0,overridable:!1,dwell:0,line:0,lastOfLine:!1};q(`home`,[{...t,target:e({x:y.x,y:y.y,z:g.z})},{...t,target:e(g)}])},Ge=()=>T.commands.length,Z=e=>{S[e]!==void 0&&(w=e,T=i(S[e]),E=0,W=null,Object.assign(D,{sendState:`IDLE`,fileName:e,rowCount:Ge(),completedRowCount:0,remainingRowCount:Ge(),sendDuration:0,sendRemainingDuration:0,lastCompletedLineNumber:-1}),A({eventType:`FileStateEvent`,event:{fileState:`FILE_LOADED`}}))},Ke=()=>{w=``,T={commands:[],segments:[]},E=0,Object.assign(D,{sendState:`IDLE`,fileName:``,rowCount:0,completedRowCount:0,remainingRowCount:0,sendDuration:0,sendRemainingDuration:0,lastCompletedLineNumber:-1}),A({eventType:`FileStateEvent`,event:{fileState:`FILE_UNLOADED`}})},qe=()=>{if(!w||v.state===`DISCONNECTED`)return;if(L===`job`&&R){Oe();return}if(L!==`idle`)return;let e=Le(T.commands,E,!0),t=T.commands.filter(e=>e.line>=E);if(W={totalSeconds:Se(e,N()),elapsed:0,streamRows:t.length,completedRows:0},Object.assign(D,{sendState:`RUNNING`,rowCount:t.length,completedRowCount:0,remainingRowCount:t.length,sendDuration:0,sendRemainingDuration:Math.round(W.totalSeconds*1e3),lastCompletedLineNumber:-1}),e.length===0){D.sendState=`COMPLETED`,W=null;return}q(`job`,e)},Je=()=>{let e=[...new Set([...Object.keys(S),...le.keys()])],t=new Set(ce);for(let n of e){let e=n.split(`/`);for(let n=1;n<e.length;n++)t.add(e.slice(0,n).join(`/`))}return{fileList:e.map(e=>e.split(`/`).pop()),fileDetails:e.map(e=>({path:e,size:S[e]?.length??le.get(e)?.size??0,lastModified:C[e]??Date.now()})),folderList:[...t].sort()}},Q=(e,t=200)=>({status:t,body:JSON.stringify(e),contentType:`application/json`}),Ye=e=>({status:200,body:e,contentType:`text/plain`}),$=()=>Q({}),Xe=e=>Math.min(200,Math.max(10,e)),Ze=e=>{let t=v.overrides;switch(e){case`CMD_FEED_OVR_RESET`:t.feed=100;break;case`CMD_FEED_OVR_COARSE_PLUS`:t.feed=Xe(t.feed+10);break;case`CMD_FEED_OVR_COARSE_MINUS`:t.feed=Xe(t.feed-10);break;case`CMD_RAPID_OVR_RESET`:t.rapid=100;break;case`CMD_RAPID_OVR_MEDIUM`:t.rapid=50;break;case`CMD_RAPID_OVR_LOW`:t.rapid=25;break;case`CMD_SPINDLE_OVR_RESET`:t.spindle=100,F();break;case`CMD_SPINDLE_OVR_COARSE_PLUS`:t.spindle=Xe(t.spindle+10),F();break;case`CMD_SPINDLE_OVR_COARSE_MINUS`:t.spindle=Xe(t.spindle-10),F();break}},Qe=()=>{let e=N(),t={rapid:!0,feed:0,overridable:!1,dwell:0,line:0,lastOfLine:!1},n=[];e.z<5&&n.push({...t,target:{x:e.x,y:e.y,z:5}}),n.push({...t,target:{x:0,y:0,z:Math.max(e.z,5)}}),q(`mdi`,n)},$e=e=>{let t=b[v.coordinateSystem]??b.G54,n=e?[e.toLowerCase()]:[`x`,`y`,`z`];for(let e of n)(e===`x`||e===`y`||e===`z`)&&(t[e]=y[e])},et=async e=>{let{method:t,path:n,query:r,body:i}=e,o=typeof i==`string`?i:``,s=()=>{try{return JSON.parse(o||`{}`)}catch{return{}}},c=n.match(/^\/api\/v1\/plugins\/([^/]+)\/settings$/);if(c){let e=decodeURIComponent(c[1]);return t===`POST`&&(de[e]=s()),Q(de[e]??{})}switch(n){case`/api/v1/status/getStatus`:return{status:200,body:pe(),contentType:`application/json`};case`/api/v1/settings/getSettings`:return Q(_);case`/api/v1/settings/setSettings`:return Object.assign(_,s()),Q(_);case`/api/v1/machine/getPortList`:return Q([`Demo machine`]);case`/api/v1/machine/getSelectedPort`:return Q({selectedPort:`Demo machine`});case`/api/v1/machine/getSelectedFirmware`:return Q({selectedFirmware:`GRBL`});case`/api/v1/machine/getSelectedBaudRate`:return Q({selectedBaudRate:`115200`});case`/api/v1/machine/getFirmwareList`:return Q([`GRBL`]);case`/api/v1/machine/getBaudRateList`:return Q([`115200`]);case`/api/v1/machine/disconnect`:return J(),v.state=`DISCONNECTED`,P(),$();case`/api/v1/machine/connect`:return window.setTimeout(()=>{v.state===`DISCONNECTED`&&(v.state=`IDLE`,P())},400),$();case`/api/v1/machine/jog`:{if(v.state!==`IDLE`&&v.state!==`JOG`)return $();let e=Number(r.get(`x`))||0,t=Number(r.get(`y`))||0,n=Number(r.get(`z`))||0,i=_.jogStepSizeXY,a=_.useZStepSize?_.jogStepSizeZ:i;return q(`jog`,[Re({x:e*i,y:t*i,z:n*a})]),$()}case`/api/v1/machine/jogContinuous`:{let e=s(),t=e=>Math.max(-1,Math.min(1,Number(e)||0)),n={x:t(e.x),y:t(e.y),z:t(e.z)};if(n.x===0&&n.y===0&&n.z===0)return Ve(!0),Q({active:!1,reason:null});if(v.state===`DISCONNECTED`)return Q({active:!1,reason:`NOT_CONNECTED`});if(v.state!==`IDLE`&&v.state!==`JOG`)return Ve(!1),Q({active:!1,reason:`CANNOT_JOG`});let r=Math.hypot(n.x,n.y,n.z);r>1&&(n={x:n.x/r,y:n.y/r,z:n.z/r});let i=performance.now()+ze;return X?(X.dir=n,X.expiresAt=i):X={dir:n,expiresAt:i,timer:window.setInterval(He,25)},He(),Q({active:!0,reason:null})}case`/api/v1/machine/homeMachine`:return L===`idle`&&We(),$();case`/api/v1/machine/returnToZero`:return L===`idle`&&Qe(),$();case`/api/v1/machine/resetToZero`:return $e(r.get(`axis`)),P(),$();case`/api/v1/machine/softReset`:case`/api/v1/machine/killAlarm`:return J(),v.state!==`DISCONNECTED`&&(v.state=`IDLE`),P(),$();case`/api/v1/machine/sendOverride`:return Ze(r.get(`command`)??``),P(),$();case`/api/v1/machine/sendGcode`:{let e=s().commands??``;return j(`COMMAND_SENT`,e),Ue(e,()=>j(`COMMAND_COMPLETE`,e,`ok`,!0)),$()}case`/api/v1/macros/getMacroList`:return Q(x);case`/api/v1/macros/saveMacroList`:{let e=JSON.parse(o||`[]`);return x.length=0,x.push(...e),Q(x)}case`/api/v1/macros/runMacro`:{let e=s().gcode??``;return j(`COMMAND_SENT`,e),Ue(e,()=>j(`COMMAND_COMPLETE`,e,`ok`,!0)),$()}case`/api/v1/probe/getSettings`:return Q(se);case`/api/v1/probe/saveSettings`:return Object.assign(se,s()),$();case`/api/v1/probe/run`:{let{operation:e}=s();return await new Promise(e=>window.setTimeout(e,900)),Q({success:!0,probedPosition:{x:v.machineCoord.x+(e.startsWith(`X`)?-3.2:0),y:v.machineCoord.y+(e.startsWith(`Y`)?-3.2:0),z:e===`Z`?v.machineCoord.z-8.4:v.machineCoord.z,a:0,b:0,c:0,units:`MM`}})}case`/api/v1/interceptor`:return Q(z);case`/api/v1/interceptor/respond`:return Ie(s().response);case`/api/v1/files/getFileStatus`:return Q(D);case`/api/v1/files/getWorkspaceFileList`:return Q(Je());case`/api/v1/files/openWorkspaceFile`:{let e=r.get(`file`);if(e){if(!await ue(e))return Q({error:`Could not load "${e}"`},404);Z(e)}return $()}case`/api/v1/files/createWorkspaceFolder`:{let e=r.get(`path`);return e&&ce.add(e),$()}case`/api/v1/files/getFileContent`:{let e=r.get(`file`)||w;return await ue(e),Ye(S[e]??``)}case`/api/v1/files/saveFileContent`:return w&&(S[w]=o,C[w]=Date.now(),Z(w)),$();case`/api/v1/files/saveFileContentAs`:{let e=r.get(`filename`);return e&&(S[e]=o,C[e]=Date.now(),Z(e)),$()}case`/api/v1/files/uploadAndOpen`:if(i instanceof FormData){let e=i.get(`file`);e instanceof File&&(S[e.name]=await e.text(),C[e.name]=Date.now(),Z(e.name))}return $();case`/api/v1/files/closeFile`:return J(),Ke(),$();case`/api/v1/files/runFromLine`:return E=Math.max(0,parseInt(r.get(`line`)??`0`,10)||0),$();case`/api/v1/files/send`:return z.state===`INACTIVE`?(qe(),$()):Q({errorMessage:`A tool change is in progress. Answer it (continue or abort) instead of starting the file.`},409);case`/api/v1/files/pause`:return R?Oe():De(),$();case`/api/v1/files/cancel`:return J(),$();case`/api/v1/review`:return w?Q(re(w,t===`POST`?o:S[w]??``)):Q({error:`No file is currently loaded`},404);case`/api/v1/visualizer/getToolpath`:return Q(a(T,E));case`/api/v1/plugins/list`:return Q([{id:`nesting`,name:`Nesting`,description:`Nest requested copies of multiple G-code files onto a sheet using their outer shapes, with rotation, gap, origin and time estimate.`,version:`0.3.1`,entryUrl:`plugins/nesting/index.html`,allowMultipleInstances:!1},{id:`rotate-gcode`,name:`Transform G-code`,description:`Rotate, uniformly scale, flip, preview, and save the loaded G-code toolpath.`,version:`2.0.0`,entryUrl:`plugins/rotate-gcode/index.html`,allowMultipleInstances:!1}])}return console.warn(`Demo: no simulation for ${t} ${n}`),Q({error:`not simulated in the online demo`},404)},tt=()=>{M(),Z(p)},nt=`/api/v1/`,rt=`/ws/v1/events`,it=300,at=class extends EventTarget{static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;readyState=0;url;unsubscribe;verboseTimer;constructor(e){super(),this.url=e,window.setTimeout(()=>{this.readyState===0&&(this.readyState=1,this.dispatchEvent(new Event(`open`)),this.unsubscribe=ge(e=>this.deliver(e)))},0)}deliver(e){this.readyState===1&&this.dispatchEvent(new MessageEvent(`message`,{data:JSON.stringify(e)}))}send(e){this.readyState!==1||typeof e!=`string`||(e===`ping`?this.deliver({eventType:`Pong`}):e===`verbose:on`?(window.clearInterval(this.verboseTimer),this.verboseTimer=window.setInterval(()=>this.deliver({eventType:`ConsoleMessageEvent`,event:{message:_e()}}),it)):e===`verbose:off`&&(window.clearInterval(this.verboseTimer),this.verboseTimer=void 0))}close(){this.readyState!==3&&(this.readyState=3,window.clearInterval(this.verboseTimer),this.unsubscribe?.(),this.dispatchEvent(new Event(`close`)))}},ot=e=>typeof e==`string`||e instanceof FormData?e:null,st=()=>{tt();let e=window.fetch.bind(window);window.fetch=async(t,n)=>{let r=t instanceof Request?t.url:String(t),i=new URL(r,window.location.href),a=i.pathname.indexOf(nt);if(i.origin!==window.location.origin||a===-1)return e(t,n);let o=await et({method:(n?.method??(t instanceof Request?t.method:`GET`)).toUpperCase(),path:i.pathname.slice(a),query:i.searchParams,body:ot(n?.body)});return new Response(o.body,{status:o.status,headers:{"Content-Type":o.contentType}})};let t=window.WebSocket;window.WebSocket=new Proxy(t,{construct(e,t){let n=String(t[0]);return n.includes(rt)?new at(n):new e(...t)}})};export{st as installDemo};