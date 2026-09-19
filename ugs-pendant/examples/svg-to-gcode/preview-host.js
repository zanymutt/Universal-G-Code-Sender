window.addEventListener('message',event=>{
  if(event.source!==document.querySelector('iframe').contentWindow||event.data?.type!=='fluid-request')return;
  const {id,method,params}=event.data;
  if(method==='getSettings'||method==='saveSettings'){
    if(method==='saveSettings')localStorage.setItem('svgCamTestSettings',JSON.stringify(params.data));
    event.source.postMessage({type:'fluid-response',id,result:JSON.parse(localStorage.getItem('svgCamTestSettings')||'{}')},'*');
  }
  if(method==='saveGcodeAs'){
    document.getElementById('status').textContent='Save As bridge received '+params.content.split('\n').length+' lines. No machine commands or disk writes.';
    event.source.postMessage({type:'fluid-response',id,result:{path:'simulated.gcode'}},'*');
  }
});
