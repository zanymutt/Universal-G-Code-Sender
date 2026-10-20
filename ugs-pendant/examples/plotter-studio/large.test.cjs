const assert=require('assert'),core=require('./core.js');
const base={mode:'plotter',tool:'none',feed:1000,plunge:200,safe:5,surface:0,final:-1,step:1,scale:100,rotation:0,overlap:0,originX:0,originY:0,origin:'bottom-left',originBounds:'artwork',order:'nearest',start:'auto',inner:true,largest:false,reverse:false,power:0,powerMax:1000};
// A big round outline densely sampled (curved, so it cannot be simplified), with 200 detailed circles inside it, like a patch with many parts
const circle=(cx,cy,r,n)=>Array.from({length:n},(_,i)=>({x:cx+r*Math.cos(i/n*2*Math.PI),y:cy+r*Math.sin(i/n*2*Math.PI)}));
const paths=[{id:'outer',name:'outer',closed:true,color:'#000000',points:circle(200,200,195,4000)}];
for(let i=0;i<200;i++)paths.push({id:'c'+i,name:'c'+i,closed:true,color:'#000000',points:circle(75+(i%10)*28,75+Math.floor(i/10)*12.5,5,800)});
const t0=Date.now();
const job=core.plan({paths,page:[{x:0,y:0},{x:400,y:0},{x:400,y:400},{x:0,y:400}]},base);
const ms=Date.now()-t0;
assert.strictEqual(job.paths.length,201);
assert.strictEqual(job.paths.at(-1).id,'outer','inner-first still puts the big outline last');
assert(ms<8000,'planning took '+ms+' ms');
console.log('large drawing ok ('+ms+' ms)');
