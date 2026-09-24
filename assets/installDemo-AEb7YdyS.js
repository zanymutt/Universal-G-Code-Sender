var e=/([A-Za-z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g,t=2*Math.PI,n=128,r=(e,t,n,r,i,a)=>{if(r!==void 0||i!==void 0)return{x:e.x+(r??0),y:e.y+(i??0)};if(a===void 0)return null;let o=t.x-e.x,s=t.y-e.y,c=Math.hypot(o,s);if(c===0)return null;let l=Math.sqrt(Math.max(0,a*a-c/2*(c/2))),u=(n?1:-1)*(a<0?-1:1);return{x:(e.x+t.x)/2+u*l*s/c,y:(e.y+t.y)/2-u*l*o/c}};function i(i,a={}){let o=[],s=[],c={...a.start??{x:0,y:0,z:0}},l=0,u=a.relative??!1,d=!1,ee=17,f=0;return i.split(/\r?\n/).forEach((i,a)=>{let te=a+1,p=i.replace(/\([^)]*\)/g,``).replace(/;.*/,``).trim();if(!p||/^[%#$]/.test(p)||/^o\d/i.test(p)||p.includes(`[`))return;let m=[],h={},g=0,_=!1,v=!1;for(let t of p.matchAll(e)){let e=t[1].toUpperCase(),n=parseFloat(t[2]);if(e===`X`||e===`Y`||e===`Z`||e===`I`||e===`J`||e===`R`)h[e]=n;else if(e===`F`)f=n;else if(e===`S`)m.push({kind:`spindleSpeed`,value:n});else if(e===`P`)g=n;else if(e===`G`){let e=Math.round(n*10)/10;e>=0&&e<=3?l=e:e===4?v=!0:e===17||e===18||e===19?(ee=e,m.push({kind:`modal`,field:`plane`,value:`G${e}`})):e===20||e===21?(d=e===20,m.push({kind:`modal`,field:`units`,value:`G${e}`})):e===53?_=!0:e>=54&&e<=59?m.push({kind:`modal`,field:`coordinateSystem`,value:`G${e}`}):(e===90||e===91)&&(u=e===91,m.push({kind:`modal`,field:`distanceMode`,value:`G${e}`}))}else if(e===`M`){let e=Math.round(n);e===3||e===4||e===5?m.push({kind:`spindle`,mode:`M${e}`}):(e===7||e===8||e===9)&&m.push({kind:`coolant`,mode:`M${e}`})}}let y=[];if((h.X!==void 0||h.Y!==void 0||h.Z!==void 0)&&!v&&!_&&l<=3){let e={x:h.X===void 0?c.x:u?c.x+h.X:h.X,y:h.Y===void 0?c.y:u?c.y+h.Y:h.Y,z:h.Z===void 0?c.z:u?c.z+h.Z:h.Z},i=(e,t,n)=>({start:e,end:t,rapid:l===0,arc:n,lineNumber:te,feedRate:f,inches:d}),a=(l===2||l===3)&&ee===17?r(c,e,l===2,h.I,h.J,h.R):null;if(a){let r=Math.hypot(c.x-a.x,c.y-a.y),o=Math.atan2(c.y-a.y,c.x-a.x),s=Math.atan2(e.y-a.y,e.x-a.x)-o;if(l===2)for(;s>=0;)s-=t;else for(;s<=0;)s+=t;let u=Math.max(4,Math.ceil(Math.abs(s)/t*n)),d={...c};for(let t=1;t<=u;t++){let n=o+t/u*s,l=t===u?{...e}:{x:a.x+r*Math.cos(n),y:a.y+r*Math.sin(n),z:c.z+(e.z-c.z)*(t/u)};y.push(i(d,l,!0)),d=l}}else y.push(i({...c},e,!1));c.x=e.x,c.y=e.y,c.z=e.z}(y.length>0||m.length>0||v&&g>0)&&(o.push({line:te,segments:y,effects:m,dwellSeconds:v?g:0}),s.push(...y))}),{commands:o,segments:s}}function a(e,t){if(t<=1)return e.segments;let n=e.segments.filter(e=>e.lineNumber>=t);if(n.length===0)return n;let r=n[0];return[{start:{x:r.start.x,y:r.start.y,z:r.start.z+10},end:{...r.start},rapid:!1,arc:!1,lineNumber:r.lineNumber,feedRate:r.feedRate,inches:r.inches},...n]}var o=new Set(`G4 G10 G28 G28.1 G28.2 G28.3 G30 G53 G80 G92 G92.1 G92.2 G92.3 G0 G1 G2 G3 G33 G38.2 G38.3 G38.4 G38.5 G73 G76 G81 G82 G83 G84 G85 G86 G87 G88 G89 G17 G18 G19 G17.1 G18.1 G19.1 G90 G91 G90.1 G91.1 G93 G94 G95 G20 G21 G40 G41 G42 G41.1 G42.1 G43 G43.1 G49 G98 G99 G54 G55 G56 G57 G58 G59 G59.1 G59.2 G59.3 G61 G61.1 G64 G96 G97 G7 G8 M0 M1 M2 M30 M60 M3 M4 M5 M6 M7 M8 M9 M48 M49`.split(` `)),s=new Set([`G0`,`G1`,`G2`,`G3`,`G38.2`,`G38.3`,`G38.4`,`G38.5`,`G80`,`G81`,`G82`,`G83`,`G84`,`G85`,`G86`,`G87`,`G88`,`G89`]),c=`GMXYZABCIJKRFSNTPLOUVWHEQD`,l=e=>e>=`0`&&e<=`9`,u=e=>/\p{L}/u.test(e),d=e=>{if(e.startsWith(`$`))return[e];let t=[],n=!1,r=!1,i=0,a=``;for(let o of e){if(o===`(`&&!r){i===0&&a.length>0&&(t.push(a),a=``),a+=o,i++,n=!1;continue}if(i>0&&o===`)`){a+=o,i--,i===0&&(t.push(a),a=``);continue}if(o===`;`&&!r&&i===0){a.length>0&&(t.push(a),a=``),a+=o,r=!0;continue}if(r||i>0)a+=o;else if(/\s/.test(o))continue;else n&&!l(o)&&o!==`.`?(n=!1,t.push(a),a=``,u(o)&&(a+=o)):l(o)||o===`.`||o===`-`?(a+=o,n=!0):u(o)&&(a+=o)}return a.length>0&&t.push(a),t},ee=e=>{let t=e[0].toUpperCase(),n=1;for(let t=1;t<e.length&&(n=t,e[t]===`0`);t++);return t+e.slice(n)},f=e=>/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(e),te=(e,t,n)=>{let r=0;for(let i of d(e)){if(i===``||i.startsWith(`(`)||i.startsWith(`;`)||i.startsWith(`$`))continue;let a=i[0].toUpperCase();if(a===`G`||a===`M`){let c=ee(i);o.has(c)?s.has(c)&&r++:n.push({lineNumber:t,severity:`WARNING`,message:`Unknown ${a}-code '${i}'. The controller may support it.`,source:e})}i.length>1&&c.includes(a)&&!f(i.slice(1))&&n.push({lineNumber:t,severity:`ERROR`,message:`Malformed numeric word '${i}'.`,source:e})}r>1&&n.push({lineNumber:t,severity:`ERROR`,message:`multiple motion codes appear in one block.`,source:e})},p=(e,t)=>{let n=(t??``).split(/\r\n|\r|\n/),r=[];return n.forEach((e,t)=>te(e,t+1,r)),{fileName:e,lineCount:n.length,diagnostics:r}},m={"heart.gcode":`(Made in : Autodesk CAM Post Processor)
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
`})()},h=`heart.gcode`,g=3e3,_=40,v=250,y=100,ne={x:0,y:0,z:0},b={jogFeedRate:3e3,jogStepSizeXY:1,preferredUnits:`MM`,jogStepSizeZ:1,port:`Demo machine`,portRate:`115200`,firmwareVersion:`GRBL`,useZStepSize:!0,workspaceDirectory:`Online demo (nothing is saved)`},x={machineCoord:{x:0,y:0,z:0,a:null,b:null,c:null,units:`MM`},workCoord:{x:0,y:0,z:0,a:null,b:null,c:null,units:`MM`},feedSpeed:0,spindleSpeed:0,accessoryStates:{spindleCW:!1,flood:!1,mist:!1},overrides:{feed:100,rapid:100,spindle:100},floodCoolantOn:!1,motionMode:`G0`,coordinateSystem:`G54`,plane:`G17`,distanceMode:`G90`,feedMode:`G94`,units:`G21`,spindleMode:`M5`,toolNumber:0,state:`IDLE`,pins:{x:!1,y:!1,z:!1,a:!1,b:!1,c:!1,probe:!1,door:!1,hold:!1,softReset:!1,cycleStart:!1}},S={x:120,y:80,z:-30},C={G54:{x:120,y:80,z:-40},G55:{x:0,y:0,z:0},G56:{x:0,y:0,z:0},G57:{x:0,y:0,z:0},G58:{x:0,y:0,z:0},G59:{x:0,y:0,z:0}},w=0,re={feedRateFast:100,feedRateSlow:10,retractDistance:3,delayAfterRetract:1,probeDiameter:3.175,plateThickness:15,maxTravel:25,compensateSoftLimits:!0},T=[{uuid:`m1`,name:`Home`,description:`Home all axes`,gcode:`$H`,color:`#4ade80`,icon:`home`},{uuid:`m2`,name:`Zero XY`,description:`Zero X/Y work offset`,gcode:`G10 L20 P1 X0 Y0`,color:`#60a5fa`,icon:`crosshairs`},{uuid:`m3`,name:`Spindle On`,description:void 0,gcode:`M3 S1000`}],E={...m},D={},ie=new Set;Object.keys(E).forEach((e,t)=>D[e]=Date.now()-t*17*60*1e3);var ae={},O=``,k={commands:[],segments:[]},A=0,j={sendState:`IDLE`,fileName:``,rowCount:0,completedRowCount:0,remainingRowCount:0,sendDuration:0,sendRemainingDuration:0,lastCompletedLineNumber:-1},M=new Set,N,oe=0,P=e=>M.forEach(t=>t(e)),F=(e,t,n=``,r=!1)=>P({eventType:`CommandEvent`,event:{commandEventType:e,command:{command:t,response:n,isError:!1,isOk:r}}}),I=()=>{let e=C[x.coordinateSystem]??C.G54;Object.assign(x.machineCoord,{x:S.x,y:S.y,z:S.z}),Object.assign(x.workCoord,{x:S.x-e.x,y:S.y-e.y,z:S.z-e.z})},se=()=>(I(),JSON.stringify(x)),L=()=>(I(),{x:x.workCoord.x,y:x.workCoord.y,z:x.workCoord.z}),R=()=>{let e=JSON.parse(se());P({eventType:`ControllerStatusEvent`,event:{status:e,previousStatus:e}})},ce=()=>x.state!==`IDLE`&&x.state!==`DISCONNECTED`,le=()=>{oe++,(ce()||oe%2==0)&&R()},ue=e=>(M.add(e),N===void 0&&(N=window.setInterval(le,v)),()=>{M.delete(e),M.size===0&&N!==void 0&&(window.clearInterval(N),N=void 0)}),de=()=>{I();let{x:e,y:t,z:n}=x.machineCoord;return`<${x.state}|MPos:${e.toFixed(3)},${t.toFixed(3)},${n.toFixed(3)}|FS:${Math.round(x.feedSpeed)},${Math.round(x.spindleSpeed)}>`},z=()=>{x.accessoryStates.spindleCW&&(x.spindleSpeed=Math.round(w*x.overrides.spindle/100))},fe=e=>{switch(e.kind){case`spindle`:x.spindleMode=e.mode,x.accessoryStates.spindleCW=e.mode!==`M5`,x.spindleSpeed=e.mode===`M5`?0:Math.round(w*x.overrides.spindle/100);break;case`spindleSpeed`:w=e.value,z();break;case`coolant`:x.floodCoolantOn=e.mode===`M8`,x.accessoryStates.flood=e.mode===`M8`,x.accessoryStates.mist=e.mode===`M7`;break;case`modal`:x[e.field]=e.value;break}},B=[],V=`idle`,H=!1,U,W=0,pe=0,G=null,K=[],me=e=>{let t=C[x.coordinateSystem]??C.G54;return{x:e.x+t.x,y:e.y+t.y,z:e.z+t.z}},he=e=>e.rapid?g*(e.overridable?x.overrides.rapid:100)/100/60:(e.feed>0?e.feed:1e3)*(e.overridable?x.overrides.feed:100)/100/60,ge=(e,t)=>{let n=0,r={...t};for(let t of e){if(t.target){let e=Math.hypot(t.target.x-r.x,t.target.y-r.y,t.target.z-r.z);n+=e/(he({...t,overridable:!1})||1),r=t.target}n+=t.dwell}return n},_e=()=>x.state===`DISCONNECTED`?`DISCONNECTED`:V===`idle`?`IDLE`:H?`HOLD`:{jog:`JOG`,mdi:`RUN`,job:`RUN`,home:`HOME`,idle:`IDLE`}[V],q=()=>{x.state=_e(),V!==`idle`&&!H||(x.feedSpeed=0)},ve=()=>{let e=V;V=`idle`,H=!1,x.feedSpeed=0,e===`job`&&G&&(j.sendState=`COMPLETED`,j.completedRowCount=G.streamRows,j.remainingRowCount=0,j.sendRemainingDuration=0,G=null),q(),R();let t=K;K=[],t.forEach(e=>e()),e===`job`&&F(`COMMAND_SKIPPED`,``)},ye=e=>{if(!G)return;G.completedRows++,j.completedRowCount=G.completedRows,j.remainingRowCount=Math.max(0,G.streamRows-G.completedRows),j.lastCompletedLineNumber=e;let t=performance.now();t-pe>=y&&(pe=t,F(`COMMAND_SKIPPED`,``))},be=()=>{let e=performance.now(),t=Math.min(.25,(e-W)/1e3);if(W=e,H||B.length===0)return;let n=t;for(G&&(G.elapsed+=t,j.sendDuration=Math.round(G.elapsed*1e3),j.sendRemainingDuration=Math.max(0,Math.round((G.totalSeconds-G.elapsed)*1e3)));n>1e-9&&B.length>0;){let e=B[0];if(e.started||(e.started=!0,e.effect?.(),e.target&&(e.machineTarget=me(e.target)),x.feedSpeed=e.rapid?g:Math.round(e.feed*(e.overridable?x.overrides.feed:100)/100)),e.machineTarget){let t=e.machineTarget.x-S.x,r=e.machineTarget.y-S.y,i=e.machineTarget.z-S.z,a=Math.hypot(t,r,i);if(a>1e-9){let o=he(e),s=o*n;if(s<a){let e=s/a;S.x+=t*e,S.y+=r*e,S.z+=i*e,n=0;break}S.x=e.machineTarget.x,S.y=e.machineTarget.y,S.z=e.machineTarget.z,n-=a/o}}if(e.dwell>0){let t=Math.min(n,e.dwell);if(e.dwell-=t,n-=t,e.dwell>1e-9)break}B.shift(),e.lastOfLine&&e.line>0&&ye(e.line),e.done?.()}B.length===0&&(U!==void 0&&(window.clearInterval(U),U=void 0),ve())},J=(e,t)=>{t.length!==0&&x.state!==`DISCONNECTED`&&(V=e,H=!1,B.push(...t),q(),U===void 0&&(W=performance.now(),U=window.setInterval(be,_)),R())},Y=()=>{B=[],U!==void 0&&(window.clearInterval(U),U=void 0);let e=V;V=`idle`,H=!1,x.feedSpeed=0,e===`job`&&G&&(j.sendState=`CANCELED`,j.sendRemainingDuration=0,G=null,fe({kind:`spindle`,mode:`M5`})),K=[],q(),R()},xe=()=>{V===`idle`||H||(H=!0,G&&(j.sendState=`PAUSED`),q(),R())},Se=()=>{H&&(H=!1,W=performance.now(),G&&(j.sendState=`RUNNING`),q(),R())},Ce=(e,t,n)=>{let r=[],i=t<=1;for(let a of e){let e=()=>a.effects.forEach(fe);if(a.line<t){a.effects.length>0&&r.push({target:null,rapid:!1,feed:0,overridable:!1,dwell:0,line:0,lastOfLine:!1,effect:e});continue}if(a.segments.length===0){r.push({target:null,rapid:!1,feed:0,overridable:!1,dwell:a.dwellSeconds,line:n?a.line:0,lastOfLine:!0,effect:e});continue}if(!i){i=!0;let e=a.segments[0];r.push({target:{x:e.start.x,y:e.start.y,z:e.start.z+10},rapid:!0,feed:0,overridable:!0,dwell:0,line:0,lastOfLine:!1}),r.push({target:{...e.start},rapid:!1,feed:e.feedRate,overridable:!0,dwell:0,line:0,lastOfLine:!1})}a.segments.forEach((t,i)=>{r.push({target:t.end,rapid:t.rapid,feed:t.feedRate,overridable:!0,dwell:0,line:n?a.line:0,lastOfLine:i===a.segments.length-1,effect:i===0&&a.effects.length>0?e:void 0})})}return r},we=e=>{let t=B.length>0?B[B.length-1].target??L():L();return{target:{x:t.x+e.x,y:t.y+e.y,z:t.z+e.z},rapid:!1,feed:b.jogFeedRate,overridable:!1,dwell:0,line:0,lastOfLine:!1}},Te=(e,t)=>{if(x.state===`DISCONNECTED`||V===`job`){t();return}let n=[];for(let t of e.split(/\r?\n/)){let e=t.trim(),r=e.toUpperCase();if(e){if(r===`$H`)Ee();else if(r===`$X`)x.state=`IDLE`;else if(r.startsWith(`$J=`))n.push(e.slice(3));else if(!r.startsWith(`$`))if(/G10\s+L20/.test(r)){let e=r.match(/P(\d)/),t=C[`G${53+(e?parseInt(e[1],10):1)}`]??C.G54;for(let e of[`X`,`Y`,`Z`]){let n=r.match(RegExp(`${e}(-?[0-9.]+)`));n&&(t[e.toLowerCase()]=S[e.toLowerCase()]-parseFloat(n[1]))}}else n.push(e)}}let r=Ce(i(n.join(`
`),{start:L(),relative:x.distanceMode===`G91`}).commands,0,!1);if(r.length===0){t();return}K.push(t),J(`mdi`,r)},Ee=()=>{if(x.state===`DISCONNECTED`)return;let e=e=>{let t=C[x.coordinateSystem]??C.G54;return{x:e.x-t.x,y:e.y-t.y,z:e.z-t.z}},t={rapid:!0,feed:0,overridable:!1,dwell:0,line:0,lastOfLine:!1};J(`home`,[{...t,target:e({x:S.x,y:S.y,z:ne.z})},{...t,target:e(ne)}])},De=()=>k.commands.length,X=e=>{E[e]!==void 0&&(O=e,k=i(E[e]),A=0,G=null,Object.assign(j,{sendState:`IDLE`,fileName:e,rowCount:De(),completedRowCount:0,remainingRowCount:De(),sendDuration:0,sendRemainingDuration:0,lastCompletedLineNumber:-1}),P({eventType:`FileStateEvent`,event:{fileState:`FILE_LOADED`}}))},Oe=()=>{O=``,k={commands:[],segments:[]},A=0,Object.assign(j,{sendState:`IDLE`,fileName:``,rowCount:0,completedRowCount:0,remainingRowCount:0,sendDuration:0,sendRemainingDuration:0,lastCompletedLineNumber:-1}),P({eventType:`FileStateEvent`,event:{fileState:`FILE_UNLOADED`}})},ke=()=>{if(!O||x.state===`DISCONNECTED`)return;if(V===`job`&&H){Se();return}if(V!==`idle`)return;let e=Ce(k.commands,A,!0),t=k.commands.filter(e=>e.line>=A);if(G={totalSeconds:ge(e,L()),elapsed:0,streamRows:t.length,completedRows:0},Object.assign(j,{sendState:`RUNNING`,rowCount:t.length,completedRowCount:0,remainingRowCount:t.length,sendDuration:0,sendRemainingDuration:Math.round(G.totalSeconds*1e3),lastCompletedLineNumber:-1}),e.length===0){j.sendState=`COMPLETED`,G=null;return}J(`job`,e)},Ae=()=>{let e=Object.keys(E),t=new Set(ie);for(let n of e){let e=n.split(`/`);for(let n=1;n<e.length;n++)t.add(e.slice(0,n).join(`/`))}return{fileList:e.map(e=>e.split(`/`).pop()),fileDetails:e.map(e=>({path:e,size:E[e].length,lastModified:D[e]??Date.now()})),folderList:[...t].sort()}},Z=(e,t=200)=>({status:t,body:JSON.stringify(e),contentType:`application/json`}),je=e=>({status:200,body:e,contentType:`text/plain`}),Q=()=>Z({}),$=e=>Math.min(200,Math.max(10,e)),Me=e=>{let t=x.overrides;switch(e){case`CMD_FEED_OVR_RESET`:t.feed=100;break;case`CMD_FEED_OVR_COARSE_PLUS`:t.feed=$(t.feed+10);break;case`CMD_FEED_OVR_COARSE_MINUS`:t.feed=$(t.feed-10);break;case`CMD_RAPID_OVR_RESET`:t.rapid=100;break;case`CMD_RAPID_OVR_MEDIUM`:t.rapid=50;break;case`CMD_RAPID_OVR_LOW`:t.rapid=25;break;case`CMD_SPINDLE_OVR_RESET`:t.spindle=100,z();break;case`CMD_SPINDLE_OVR_COARSE_PLUS`:t.spindle=$(t.spindle+10),z();break;case`CMD_SPINDLE_OVR_COARSE_MINUS`:t.spindle=$(t.spindle-10),z();break}},Ne=()=>{let e=L(),t={rapid:!0,feed:0,overridable:!1,dwell:0,line:0,lastOfLine:!1},n=[];e.z<5&&n.push({...t,target:{x:e.x,y:e.y,z:5}}),n.push({...t,target:{x:0,y:0,z:Math.max(e.z,5)}}),J(`mdi`,n)},Pe=e=>{let t=C[x.coordinateSystem]??C.G54,n=e?[e.toLowerCase()]:[`x`,`y`,`z`];for(let e of n)(e===`x`||e===`y`||e===`z`)&&(t[e]=S[e])},Fe=async e=>{let{method:t,path:n,query:r,body:i}=e,o=typeof i==`string`?i:``,s=()=>{try{return JSON.parse(o||`{}`)}catch{return{}}},c=n.match(/^\/api\/v1\/plugins\/([^/]+)\/settings$/);if(c){let e=decodeURIComponent(c[1]);return t===`POST`&&(ae[e]=s()),Z(ae[e]??{})}switch(n){case`/api/v1/status/getStatus`:return{status:200,body:se(),contentType:`application/json`};case`/api/v1/settings/getSettings`:return Z(b);case`/api/v1/settings/setSettings`:return Object.assign(b,s()),Z(b);case`/api/v1/machine/getPortList`:return Z([`Demo machine`]);case`/api/v1/machine/getSelectedPort`:return Z({selectedPort:`Demo machine`});case`/api/v1/machine/getSelectedFirmware`:return Z({selectedFirmware:`GRBL`});case`/api/v1/machine/getSelectedBaudRate`:return Z({selectedBaudRate:`115200`});case`/api/v1/machine/getFirmwareList`:return Z([`GRBL`]);case`/api/v1/machine/getBaudRateList`:return Z([`115200`]);case`/api/v1/machine/disconnect`:return Y(),x.state=`DISCONNECTED`,R(),Q();case`/api/v1/machine/connect`:return window.setTimeout(()=>{x.state===`DISCONNECTED`&&(x.state=`IDLE`,R())},400),Q();case`/api/v1/machine/jog`:{if(x.state!==`IDLE`&&x.state!==`JOG`)return Q();let e=Number(r.get(`x`))||0,t=Number(r.get(`y`))||0,n=Number(r.get(`z`))||0,i=b.jogStepSizeXY,a=b.useZStepSize?b.jogStepSizeZ:i;return J(`jog`,[we({x:e*i,y:t*i,z:n*a})]),Q()}case`/api/v1/machine/homeMachine`:return V===`idle`&&Ee(),Q();case`/api/v1/machine/returnToZero`:return V===`idle`&&Ne(),Q();case`/api/v1/machine/resetToZero`:return Pe(r.get(`axis`)),R(),Q();case`/api/v1/machine/softReset`:case`/api/v1/machine/killAlarm`:return Y(),x.state!==`DISCONNECTED`&&(x.state=`IDLE`),R(),Q();case`/api/v1/machine/sendOverride`:return Me(r.get(`command`)??``),R(),Q();case`/api/v1/machine/sendGcode`:{let e=s().commands??``;return F(`COMMAND_SENT`,e),Te(e,()=>F(`COMMAND_COMPLETE`,e,`ok`,!0)),Q()}case`/api/v1/macros/getMacroList`:return Z(T);case`/api/v1/macros/saveMacroList`:{let e=JSON.parse(o||`[]`);return T.length=0,T.push(...e),Z(T)}case`/api/v1/macros/runMacro`:{let e=s().gcode??``;return F(`COMMAND_SENT`,e),Te(e,()=>F(`COMMAND_COMPLETE`,e,`ok`,!0)),Q()}case`/api/v1/probe/getSettings`:return Z(re);case`/api/v1/probe/saveSettings`:return Object.assign(re,s()),Q();case`/api/v1/probe/run`:{let{operation:e}=s();return await new Promise(e=>window.setTimeout(e,900)),Z({success:!0,probedPosition:{x:x.machineCoord.x+(e.startsWith(`X`)?-3.2:0),y:x.machineCoord.y+(e.startsWith(`Y`)?-3.2:0),z:e===`Z`?x.machineCoord.z-8.4:x.machineCoord.z,a:0,b:0,c:0,units:`MM`}})}case`/api/v1/files/getFileStatus`:return Z(j);case`/api/v1/files/getWorkspaceFileList`:return Z(Ae());case`/api/v1/files/openWorkspaceFile`:{let e=r.get(`file`);return e&&X(e),Q()}case`/api/v1/files/createWorkspaceFolder`:{let e=r.get(`path`);return e&&ie.add(e),Q()}case`/api/v1/files/getFileContent`:return je(E[r.get(`file`)||O]??``);case`/api/v1/files/saveFileContent`:return O&&(E[O]=o,D[O]=Date.now(),X(O)),Q();case`/api/v1/files/saveFileContentAs`:{let e=r.get(`filename`);return e&&(E[e]=o,D[e]=Date.now(),X(e)),Q()}case`/api/v1/files/uploadAndOpen`:if(i instanceof FormData){let e=i.get(`file`);e instanceof File&&(E[e.name]=await e.text(),D[e.name]=Date.now(),X(e.name))}return Q();case`/api/v1/files/closeFile`:return Y(),Oe(),Q();case`/api/v1/files/runFromLine`:return A=Math.max(0,parseInt(r.get(`line`)??`0`,10)||0),Q();case`/api/v1/files/send`:return ke(),Q();case`/api/v1/files/pause`:return H?Se():xe(),Q();case`/api/v1/files/cancel`:return Y(),Q();case`/api/v1/review`:return O?Z(p(O,t===`POST`?o:E[O]??``)):Z({error:`No file is currently loaded`},404);case`/api/v1/visualizer/getToolpath`:return Z(a(k,A));case`/api/v1/plugins/list`:return Z([{id:`nesting`,name:`Nesting`,description:`Nest requested copies of multiple G-code files onto a sheet using their outer shapes, with rotation, gap, origin and time estimate.`,version:`0.3.1`,entryUrl:`plugins/nesting/index.html`,allowMultipleInstances:!1},{id:`rotate-gcode`,name:`Rotate G-code`,description:`Rotate the loaded toolpath by an angle around the origin or its center. Lines containing FluidNC expressions/variables ({...}, #, ?) are left completely untouched.`,version:`1.0.0`,entryUrl:`plugins/rotate-gcode/index.html`,allowMultipleInstances:!1}])}return console.warn(`Demo: no simulation for ${t} ${n}`),Z({error:`not simulated in the online demo`},404)},Ie=()=>{I(),X(h)},Le=`/api/v1/`,Re=`/ws/v1/events`,ze=300,Be=class extends EventTarget{static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;readyState=0;url;unsubscribe;verboseTimer;constructor(e){super(),this.url=e,window.setTimeout(()=>{this.readyState===0&&(this.readyState=1,this.dispatchEvent(new Event(`open`)),this.unsubscribe=ue(e=>this.deliver(e)))},0)}deliver(e){this.readyState===1&&this.dispatchEvent(new MessageEvent(`message`,{data:JSON.stringify(e)}))}send(e){this.readyState!==1||typeof e!=`string`||(e===`ping`?this.deliver({eventType:`Pong`}):e===`verbose:on`?(window.clearInterval(this.verboseTimer),this.verboseTimer=window.setInterval(()=>this.deliver({eventType:`ConsoleMessageEvent`,event:{message:de()}}),ze)):e===`verbose:off`&&(window.clearInterval(this.verboseTimer),this.verboseTimer=void 0))}close(){this.readyState!==3&&(this.readyState=3,window.clearInterval(this.verboseTimer),this.unsubscribe?.(),this.dispatchEvent(new Event(`close`)))}},Ve=e=>typeof e==`string`||e instanceof FormData?e:null,He=()=>{Ie();let e=window.fetch.bind(window);window.fetch=async(t,n)=>{let r=t instanceof Request?t.url:String(t),i=new URL(r,window.location.href),a=i.pathname.indexOf(Le);if(i.origin!==window.location.origin||a===-1)return e(t,n);let o=await Fe({method:(n?.method??(t instanceof Request?t.method:`GET`)).toUpperCase(),path:i.pathname.slice(a),query:i.searchParams,body:Ve(n?.body)});return new Response(o.body,{status:o.status,headers:{"Content-Type":o.contentType}})};let t=window.WebSocket;window.WebSocket=new Proxy(t,{construct(e,t){let n=String(t[0]);return n.includes(Re)?new Be(n):new e(...t)}})};export{He as installDemo};