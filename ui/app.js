'use strict';
/* Palace Studio: dependency-free CAD preview, forms, model persistence and Palace API. */
const $ = id => document.getElementById(id);
const clone = x => structuredClone(x);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fnum = x => Number(x).toLocaleString('en-US', {maximumFractionDigits:6});
const materials = {
  'Vacuum': {name:'Vacuum',eps:1,mu:1,loss:0,color:'#75b4db'},
  'Teflon': {name:'Teflon',eps:2.08,mu:1,loss:0.0004,color:'#48add0'},
  'FR4': {name:'FR4',eps:4.4,mu:1,loss:0.02,color:'#5dca93'},
  'Rogers 5880': {name:'Rogers 5880',eps:2.2,mu:1,loss:0.0009,color:'#d3af71'},
  'Alumina': {name:'Alumina',eps:9.8,mu:1,loss:0.0001,color:'#b1a7ec'},
  'Custom': {name:'Custom',eps:1,mu:1,loss:0,color:'#a4b1cf'}
};
function defaultScene() {
  return {name:'Cylindrical Cavity',unit:'mm',objects:[{id:'solid-1',name:'Cylinder1',type:'cylinder',position:[0,0,0],dimensions:{radius:27.4,height:54.8},material:clone(materials.Teflon),visible:true}],boundary:{type:'PEC',rs:0.0184},analysis:{type:'Eigenmode',target:2,modes:15,order:4,tol:1e-7,meshSize:6,save:3,amr:0}};
}
const ui = {scene:defaultScene(),selection:'solid-1',tab:'model',lower:'messages',dirty:false,grid:true,wire:false,api:false,gmsh:false,palace:false,logs:[],results:[],jobId:null,jobTimer:null,history:[],future:[],camera:{yaw:.58,pitch:.46,zoom:1,panX:0,panY:0}};
function activeObject(){return ui.scene.objects.find(o=>o.id===ui.selection)}
function nameForType(type){return {box:'Box',cylinder:'Cylinder',sphere:'Sphere'}[type]||'Solid'}
function shapeIcon(type){return {box:'▣',cylinder:'◉',sphere:'●'}[type]||'▣'}
function log(message,kind='info'){
  ui.logs.push({time:new Date().toLocaleTimeString('en-GB',{hour12:false}),message:String(message),kind});
  if(ui.logs.length>150)ui.logs.shift();
  $('messageCount').textContent=ui.logs.length;
  $('logLines').innerHTML=ui.logs.map(m=>`<div class="log-row ${m.kind}"><span class="log-time">${esc(m.time)}</span><span class="log-icon">${m.kind==='error'?'×':m.kind==='warn'?'!':'›'}</span><span class="log-text">${esc(m.message)}</span></div>`).join('');
  $('logLines').parentElement.scrollTop=$('logLines').parentElement.scrollHeight;
}
function toast(message,type='info'){
  const el=document.createElement('div');el.className='toast '+type;el.textContent=message;$('toasts').append(el);
  setTimeout(()=>el.remove(),4600);
}
function status(message){$('footerStatus').textContent=message}
function mutate(action){ui.history.push(JSON.stringify(ui.scene));if(ui.history.length>60)ui.history.shift();ui.future=[];action();ui.dirty=true;renderAll();}
function undo(){if(!ui.history.length)return;ui.future.push(JSON.stringify(ui.scene));ui.scene=JSON.parse(ui.history.pop());ui.selection=ui.scene.objects[0]?.id||'analysis';ui.dirty=true;renderAll();log('Undo design edit')}
function redo(){if(!ui.future.length)return;ui.history.push(JSON.stringify(ui.scene));ui.scene=JSON.parse(ui.future.pop());ui.selection=ui.scene.objects[0]?.id||'analysis';ui.dirty=true;renderAll();log('Redo design edit')}
function renderTree(){
  $('treeProjectName').textContent=ui.scene.name;
  $('objectCount').textContent=ui.scene.objects.length;
  $('objectTree').innerHTML=ui.scene.objects.map(o=>`<div class="tree-object ${ui.selection===o.id?'selected':''}" data-object="${esc(o.id)}"><span class="tree-dot" style="background:${esc(o.material.color||'#57b6d8')}"></span><span class="tree-icon">${shapeIcon(o.type)}</span><span>${esc(o.name)}</span><button class="tree-visibility" data-eye="${esc(o.id)}" title="Toggle visibility">${o.visible===false?'○':'◉'}</button></div>`).join('');
  document.querySelectorAll('.clickable[data-selection]').forEach(el=>el.classList.toggle('selected',el.dataset.selection===ui.selection));
  $('overviewUnit').textContent=ui.scene.unit;
  $('overviewBodies').textContent=String(ui.scene.objects.length).padStart(2,'0');
  $('overviewBoundary').textContent=ui.scene.boundary.type;
  $('viewUnit').textContent=ui.scene.unit;
  $('projectName').textContent=ui.scene.name;
  $('dirtyIndicator').classList.toggle('dirty',ui.dirty);
  $('footerOrder').textContent=ui.scene.analysis.order;
  status(ui.dirty?'Editing · Unsaved design':'Ready · No unsaved changes');
}
function row(label, input, key, options={}){
  const id=`prop-${key}`;
  const attrs=`id="${id}" data-edit="${esc(key)}"`;
  const placeholder=options.unit?`<div class="with-unit"><input type="number" step="any" ${attrs} value="${esc(input)}" ${options.min!==undefined?`min="${options.min}"`:''} /><span class="unit">${options.unit}</span></div>`:`<input type="number" step="any" ${attrs} value="${esc(input)}" ${options.min!==undefined?`min="${options.min}"`:''} />`;
  return `<div class="field"><label for="${id}">${esc(label)}</label>${placeholder}</div>`;
}
function selectRow(label,value,key,opts){return `<div class="field"><label for="prop-${esc(key)}">${esc(label)}</label><select id="prop-${esc(key)}" data-edit="${esc(key)}">${opts.map(x=>`<option ${x===value?'selected':''} value="${esc(x)}">${esc(x)}</option>`).join('')}</select></div>`}
function section(title,body){return `<section class="prop-section"><div class="section-title"><span class="section-caret">⌄</span>${esc(title)}</div>${body}</section>`}
function renderInspector(){
  let html='';
  const o=activeObject();
  if(o){
    html=`<div class="selected-identity"><div class="solid-avatar" style="color:${esc(o.material.color||'#65dcf1')}">${shapeIcon(o.type)}</div><div class="solid-identity"><strong>${esc(o.name)}</strong><small>${esc(o.type.toUpperCase())} · SOLID BODY</small></div></div>`;
    html+=section('GENERAL',`<div class="field"><label for="name-field">Name</label><input id="name-field" data-text="name" value="${esc(o.name)}" /></div>${selectRow('Material',o.material.name,'mat.name',Object.keys(materials))}`);
    html+=section('POSITION',o.position.map((v,i)=>row('XYZ'[i]+' position',v,`pos.${i}`,{unit:ui.scene.unit})).join(''));
    const defs=o.type==='box'?[['Width','width'],['Depth','depth'],['Height','height']]:o.type==='cylinder'?[['Radius','radius'],['Height','height']]:[['Radius','radius']];
    html+=section('DIMENSIONS',defs.map(([label,key])=>row(label,o.dimensions[key],`dim.${key}`,{unit:ui.scene.unit,min:.00001})).join(''));
    html+=section('MATERIAL PROPERTIES',row('Permittivity εᵣ',o.material.eps,'mat.eps',{min:.00001})+row('Permeability μᵣ',o.material.mu,'mat.mu',{min:.00001})+row('Loss tangent',o.material.loss,'mat.loss',{min:0}));
    if(ui.scene.objects.length>1)html+='<div class="notice warning">Multiple solids can be arranged visually, but solver export currently supports exactly one homogeneous solid.</div>';
  } else if(ui.selection==='boundary'){
    const b=ui.scene.boundary;
    html=`<div class="selected-identity"><div class="solid-avatar">▧</div><div class="solid-identity"><strong>Outer Boundary</strong><small>GLOBAL BOUNDARY ASSIGNMENT</small></div></div>`;
    html+=section('BOUNDARY CONDITIONS',selectRow('Type',b.type,'bc.type',['PEC','PMC','Impedance','Absorbing'])+(b.type==='Impedance'?row('Surface Rs',b.rs,'bc.rs',{unit:'Ω/□',min:.000001}):'')+'<p class="note">Applies uniformly to all exterior faces of the selected single-volume model.</p>');
  } else if(ui.selection==='analysis'){
    const a=ui.scene.analysis;
    html=`<div class="selected-identity"><div class="solid-avatar">◎</div><div class="solid-identity"><strong>Eigenmode Setup</strong><small>PALACE FINITE ELEMENT SOLVER</small></div></div>`;
    html+=section('SOLUTION SETUP',selectRow('Analysis type',a.type,'analysis.type',['Eigenmode'])+row('Target frequency',a.target,'analysis.target',{unit:'GHz',min:.00001})+row('Number of modes',a.modes,'analysis.modes',{min:1})+row('Saved field modes',a.save,'analysis.save',{min:0})+row('Convergence tol.',a.tol,'analysis.tol',{min:1e-15}));
    html+=section('MESH & SOLVER',row('FEM order',a.order,'analysis.order',{min:1})+row('Mesh element size',a.meshSize,'analysis.meshSize',{unit:ui.scene.unit,min:1e-6})+row('AMR iterations',a.amr,'analysis.amr',{min:0})+'<p class="note">Gmsh exports second-order curved tetrahedra. FEM approximation order is specified independently.</p>');
  } else if(ui.selection==='materials'){
    html=`<div class="selected-identity"><div class="solid-avatar">◈</div><div class="solid-identity"><strong>Material Library</strong><small>${Object.keys(materials).length} BUILT-IN PRESETS</small></div></div>`;
    html+=section('PRESETS',Object.values(materials).map(m=>`<div class="stat-row"><span><span class="inline-color" style="background:${m.color}"></span>${esc(m.name)}</span><strong>εᵣ ${m.eps}</strong></div>`).join(''));
    html+='<div class="notice">Select a solid from the project tree to assign a material or edit εᵣ, μᵣ, and loss tangent.</div>';
  } else {
    html=`<div class="selected-identity"><div class="solid-avatar">▥</div><div class="solid-identity"><strong>Simulation Results</strong><small>${ui.results.length} EIGENMODES</small></div></div><div class="notice">Use the Results ribbon or Eigenmodes bottom tab to inspect real Palace results.</div>`;
  }
  if(!o && ui.selection!=='analysis' && ui.selection!=='boundary'){
    html+=section('PROJECT',selectRow('Length unit',ui.scene.unit,'project.unit',['mm','um','cm','m']));
  }
  $('inspectorContent').innerHTML=html;
}
function renderAll(){renderTree();renderInspector();renderViewport();renderStatus();}
function renderStatus(){const o=activeObject();$('viewportTitle').textContent=o?.name||ui.scene.name;$('viewportSub').textContent=o?(o.material.name+' · Solid Body'):'Model workspace';$('footerShape').textContent=ui.scene.objects.length?'3D':'EMPTY';$('wireBtn').classList.toggle('on',ui.wire);$('gridBtn').classList.toggle('on',ui.grid);$('viewModeText').textContent=ui.wire?'Wireframe':'Shaded with edges';}
function selectObject(id){ui.selection=id;renderAll()}
function newObject(type){const n=ui.scene.objects.filter(o=>o.type===type).length+1;const id='solid-'+Date.now()+'-'+Math.random().toString(16).slice(2,5);const dimensions=type==='box'?{width:40,depth:30,height:14}:type==='cylinder'?{radius:15,height:30}:{radius:19};
  mutate(()=>{ui.scene.objects.push({id,name:nameForType(type)+n,type,position:[15*(ui.scene.objects.length),0,0],dimensions,material:clone(materials.Vacuum),visible:true});ui.selection=id});log('Created '+type+' object. Single-body export limit applies if more than one volume.');
}
function deleteObject(){const o=activeObject();if(!o)return;mutate(()=>{ui.scene.objects=ui.scene.objects.filter(x=>x.id!==o.id);ui.selection=ui.scene.objects[0]?.id||'analysis'});log('Deleted '+o.name);}
function duplicateObject(){const o=activeObject();if(!o)return;const c=clone(o);c.id='solid-'+Date.now();c.name=o.name+' Copy';c.position[0]+=10;mutate(()=>{ui.scene.objects.push(c);ui.selection=c.id});log('Duplicated '+o.name);}
function handleEdit(key,raw){
  const o=activeObject();const n=Number(raw);
  if(key==='project.unit'){
    if(!['mm','um','cm','m'].includes(raw))return;
    // Preserve physical dimensions when changing display units.
    const meters={mm:1e-3,um:1e-6,cm:1e-2,m:1};const factor=meters[ui.scene.unit]/meters[raw];
    mutate(()=>{for(const obj of ui.scene.objects){obj.position=obj.position.map(v=>v*factor);for(const k in obj.dimensions)obj.dimensions[k]*=factor;}ui.scene.analysis.meshSize*=factor;ui.scene.unit=raw});
    return;
  }
  if(key==='bc.type'){mutate(()=>ui.scene.boundary.type=raw);return}
  if(key==='bc.rs'){if(!Number.isFinite(n)||n<=0)return toast('Surface resistance must be > 0','error');mutate(()=>ui.scene.boundary.rs=n);return}
  if(key==='analysis.type')return;
  if(key.startsWith('analysis.')){
    const field=key.split('.')[1];const integerFields=['order','modes','save','amr'];
    if(!Number.isFinite(n)||(field==='save'||field==='amr'?n<0:n<=0)||(integerFields.includes(field)&&!Number.isInteger(n)))return toast('Enter a valid analysis value','error');
    mutate(()=>ui.scene.analysis[field]=n);return;
  }
  if(!o)return;
  if(key==='mat.name'){
    if(!materials[raw])return;
    mutate(()=>o.material=clone(materials[raw]));return;
  }
  if(!Number.isFinite(n))return toast('Expected a finite number','error');
  if(key.startsWith('dim.')&&(n<=0))return toast('Dimensions must be positive','error');
  if(key==='mat.eps'&&n<=0||key==='mat.mu'&&n<=0||key==='mat.loss'&&n<0)return toast('Invalid material parameter','error');
  mutate(()=>{
    if(key.startsWith('pos.'))o.position[Number(key.split('.')[1])]=n;
    if(key.startsWith('dim.'))o.dimensions[key.split('.')[1]]=n;
    if(key.startsWith('mat.')){o.material[key.split('.')[1]]=n;o.material.name='Custom'}
  });
}
function parseImportedScene(value){
  if(!value||typeof value!=='object'||!Array.isArray(value.objects)||!value.objects.length||value.objects.length>100||!value.analysis||!value.boundary)throw Error('Invalid scene file');
  if(!['mm','um','cm','m'].includes(value.unit))throw Error('Unsupported length unit');
  for(const o of value.objects){if(!['box','cylinder','sphere'].includes(o.type)||!Array.isArray(o.position)||o.position.length!==3||!o.material||!o.dimensions)throw Error('Unsupported model object');}
  return value;
}
function download(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function saveScene(){const payload=JSON.stringify(ui.scene,null,2);download(new Blob([payload],{type:'application/json'}),'palace-scene.json');ui.dirty=false;renderTree();toast('Scene JSON saved','success');log('Saved palace-scene.json')}
async function health(){try{const r=await fetch('/api/health');if(!r.ok)throw Error('offline');const d=await r.json();ui.api=true;ui.gmsh=d.gmsh;ui.palace=d.palace;$('backendLight').classList.add('ok');$('backendText').textContent=d.gmsh&&d.palace?'Solver available':d.gmsh?'Gmsh ready · Palace missing':'Local design backend';$('runNote').textContent=d.gmsh&&d.palace?'Runs locally. Solver jobs may take several minutes.':'Run requires Gmsh + Palace installed locally. Export Input works now.';log(`Backend ready · Gmsh: ${d.gmsh?'found':'not found'}, Palace: ${d.palace?'found':'not found'}`);}
  catch{ui.api=false;$('backendText').textContent='Offline UI only';$('backendLight').classList.remove('ok');log('Backend not reachable. Start python ui/server.py for exports and simulations.','warn');}
}
async function postJson(endpoint){const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(ui.scene)});if(!r.ok){const err=await r.json().catch(()=>({error:'Request failed'}));throw Error(err.error||'Request failed')}return r;}
async function validateModel(){try{const res=await (await postJson('/api/validate')).json();$('configPreview').textContent=JSON.stringify(res.config,null,2);toast('Palace configuration validated','success');log('Validated geometry and Palace JSON configuration');return res;}catch(e){toast(e.message,'error');log(e.message,'error');throw e;}}
async function exportInput(){try{const r=await postJson('/api/export');download(await r.blob(),'palace-eigenmode-input.zip');log('Exported reproducible Palace + Gmsh input bundle');toast('Input ZIP exported','success');}catch(e){toast(e.message,'error');log('Export blocked: '+e.message,'error');}}
function setRunStatus(text){$('runStatus').textContent=text}
async function startSolve(){
  if(!ui.gmsh||!ui.palace){toast('Install Gmsh and Palace to run locally. Export ZIP works without them.','error');log('Local solver unavailable; no simulation was run.','warn');return;}
  try{
    const res=await (await postJson('/api/run')).json();ui.jobId=res.id;setRunStatus('RUNNING');log('Launched Palace job '+ui.jobId.slice(0,8));$('runBtn').disabled=true;
    if(ui.jobTimer)clearInterval(ui.jobTimer);
    ui.jobTimer=setInterval(pollJob,1900);pollJob();
  }catch(e){toast(e.message,'error');log(e.message,'error');}
}
let priorStep='';
async function pollJob(){
  if(!ui.jobId)return;
  try{const r=await fetch('/api/jobs/'+ui.jobId);if(!r.ok)throw Error('job not found');const job=await r.json();if(priorStep!==job.step){priorStep=job.step;log(job.step)}
    if(job.state==='completed'){clearInterval(ui.jobTimer);ui.jobTimer=null;$('runBtn').disabled=false;setRunStatus('COMPLETE');ui.results=job.results||[];renderResults();log(`Palace solve completed. Loaded ${ui.results.length} eigenmodes.`);toast('Palace eigenmode simulation completed','success');setLower('results');}
    if(job.state==='failed'){clearInterval(ui.jobTimer);ui.jobTimer=null;$('runBtn').disabled=false;setRunStatus('FAILED');log(job.error||'Solver failed','error');toast('Solver failed · inspect messages','error');}
  }catch(e){log('Cannot fetch solver job status: '+e.message,'warn')}
}
async function loadBenchmark(){
  try {
    const res=await fetch('/api/benchmarks');if(!res.ok)throw Error('Could not list repository benchmarks');
    const {benchmarks}=await res.json();
    if(!benchmarks.length){toast('No verification/cylinder/**/eig.csv found in this repository','error');return}
    let choice=benchmarks[0];
    if(benchmarks.length>1){
      const listing=benchmarks.map((v,i)=>`${i+1}: ${v.path}`).join('\n');
      const value=prompt(`Select a saved eigenmode benchmark (number):\n${listing}`,'1');
      if(value===null)return;
      const index=Number(value)-1;if(!Number.isInteger(index)||index<0||index>=benchmarks.length)return toast('Invalid benchmark number','error');
      choice=benchmarks[index];
    }
    const result=await fetch('/api/benchmarks/'+choice.id);if(!result.ok)throw Error('Could not read benchmark');
    const data=await result.json();ui.results=data.results||[];ui.jobId=null;renderResults();setLower('results');
    log('Loaded '+ui.results.length+' eigenmodes from '+data.path);toast('Repository benchmark loaded','success');
  }catch(e){toast(e.message,'error');log(e.message,'error')}
}
function renderResults(){
  $('resultsCount').textContent=ui.results.length;
  if(!ui.results.length){$('resultsContent').className='result-placeholder';$('resultsContent').innerHTML='<div class="placeholder-symbol">◎</div><strong>No results loaded</strong><p>Load a genuine Palace eig.csv or run the solver.</p><button class="btn outlined" id="emptyImportBtn">Load eig.csv</button>';return;}
  $('resultsContent').className='';$('resultsContent').innerHTML=`<div class="result-summary">${ui.results.length} modes · Frequency (GHz) · ${ui.jobId?'Palace solver output':'Imported eig.csv'} <span style="color:#6a8199;float:right">No synthetic results</span></div><table class="result-table"><thead><tr><th>MODE</th><th>RE{F} (GHz)</th><th>QUALITY FACTOR (Q)</th></tr></thead><tbody>${ui.results.map(r=>`<tr><td>${r.mode}</td><td>${fnum(r.frequencyGHz)}</td><td>${Number.isFinite(r.q)?fnum(r.q):'—'}</td></tr>`).join('')}</tbody></table>`;
}
function parseCsv(s){
  const rows=s.trim().split(/\r?\n/).filter(r=>r&&!r.trimStart().startsWith('#')).map(x=>x.split(',').map(t=>t.trim().replace(/^"|"$/g,'')));
  if(rows.length<2)throw Error('CSV has no data');const headers=rows[0];const col=(a)=>headers.findIndex(k=>k.includes(a));const mi=headers.findIndex(k=>k==='m'),fi=col('Re{f}'),qi=headers.findIndex(k=>k==='Q');
  if(mi<0||fi<0)throw Error('Not a Palace eig.csv file: expected m and Re{f} (GHz) columns');
  return rows.slice(1).map(cols=>({mode:Number(cols[mi]),frequencyGHz:Number(cols[fi]),q:qi>=0?Number(cols[qi]):null})).filter(r=>Number.isFinite(r.mode)&&Number.isFinite(r.frequencyGHz));
}
function setTab(tab){ui.tab=tab;document.querySelectorAll('.ribbon-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));for(const t of ['model','analysis','results'])$(t+'Ribbon').classList.toggle('hidden',t!==tab);if(tab==='analysis')selectObject('analysis');if(tab==='results')setLower('results');}
function setLower(tab){ui.lower=tab;document.querySelectorAll('.lower-tab').forEach(b=>b.classList.toggle('active',b.dataset.lower===tab));for(const t of ['messages','results','json'])$(t+'Panel').classList.toggle('hidden',t!==tab);if(tab==='json'){if(ui.api)validateModel().catch(()=>{});else $('configPreview').textContent='Start the Python backend to preview a validated Palace config.';}}
function fit(){ui.camera.zoom=1;ui.camera.panX=0;ui.camera.panY=0;renderViewport()}
// --- Isometric 3D viewport, projected and depth-sorted with no CDN dependencies. ---
const cvs=$('sceneCanvas'), ctx=cvs.getContext('2d');let polygons=[], drag=null, totalScale=100, center=[0,0,0];
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
function bounds(){const objs=ui.scene.objects.filter(o=>o.visible!==false);let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  objs.forEach(o=>{let d=o.dimensions;let ext=o.type==='box'?[d.width/2,d.depth/2,d.height/2]:o.type==='cylinder'?[d.radius,d.radius,d.height/2]:[d.radius,d.radius,d.radius];for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],o.position[i]-ext[i]);hi[i]=Math.max(hi[i],o.position[i]+ext[i]);}});
  if(!objs.length)return{center:[0,0,0],size:100};const size=Math.max(...hi.map((x,i)=>x-lo[i]),1e-8);return{center:hi.map((x,i)=>(x+lo[i])/2),size};
}
function project(p,w,h){const C=ui.camera;const x=p[0]-center[0],y=p[1]-center[1],z=p[2]-center[2];const cy=Math.cos(C.yaw),sy=Math.sin(C.yaw),cp=Math.cos(C.pitch),sp=Math.sin(C.pitch);
  const xr=cy*x-sy*y,yr=sy*x+cy*y;const vert=cp*z-sp*yr;const depth=sp*z+cp*yr;const distance=totalScale*2.65/C.zoom;const factor=Math.min(w,h)*1.47/Math.max(distance-depth,totalScale*.16);
  return{x:w/2+(xr+C.panX)*factor,y:h/2-(vert+C.panY)*factor,depth};
}
function drawLine(a,b,w,h,color='#31506c',width=.8){const A=project(a,w,h),B=project(b,w,h);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke()}
function addFace(faces,obj,pts,normal){faces.push({obj,pts,normal})}
function objectFaces(o){const faces=[];const p=o.position,d=o.dimensions;const at=v=>[v[0]+p[0],v[1]+p[1],v[2]+p[2]];
  if(o.type==='box'){
    const [x,y,z]=[d.width/2,d.depth/2,d.height/2];const v=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]].map(at);
    for(const [idx,n] of [[[0,3,2,1],[0,0,-1]],[[4,5,6,7],[0,0,1]],[[0,1,5,4],[0,-1,0]],[[1,2,6,5],[1,0,0]],[[2,3,7,6],[0,1,0]],[[3,0,4,7],[-1,0,0]]])addFace(faces,o,idx.map(i=>v[i]),n);
  }else if(o.type==='cylinder'){
    const count=32,r=d.radius,h=d.height/2,top=[],bottom=[];
    for(let i=0;i<count;i++){const a=i*2*Math.PI/count;top.push(at([Math.cos(a)*r,Math.sin(a)*r,h]));bottom.push(at([Math.cos(a)*r,Math.sin(a)*r,-h]));}
    addFace(faces,o,top,[0,0,1]);addFace(faces,o,[...bottom].reverse(),[0,0,-1]);
    for(let i=0;i<count;i++){const j=(i+1)%count,a=(i+.5)*2*Math.PI/count;addFace(faces,o,[bottom[i],bottom[j],top[j],top[i]],[Math.cos(a),Math.sin(a),0]);}
  }else{
    const r=d.radius,L=12,N=24;
    for(let t=0;t<L;t++){const t1=t*Math.PI/L,t2=(t+1)*Math.PI/L;
      for(let u=0;u<N;u++){const p1=u*Math.PI*2/N,p2=(u+1)*Math.PI*2/N;
        const sph=(a,b)=>[r*Math.sin(a)*Math.cos(b),r*Math.sin(a)*Math.sin(b),r*Math.cos(a)];const pts=[sph(t1,p1),sph(t1,p2),sph(t2,p2),sph(t2,p1)].map(at);
        const a=(t1+t2)/2,b=(p1+p2)/2;addFace(faces,o,pts,[Math.sin(a)*Math.cos(b),Math.sin(a)*Math.sin(b),Math.cos(a)]);
      }
    }
  }
  return faces;
}
function hexColor(hex){const m=/^#?([0-9a-fA-F]{6})$/.exec(hex||'');const n=m?parseInt(m[1],16):0x61a9cb;return[(n>>16)&255,(n>>8)&255,n&255]}
function faceStyle(normal,color,selected){const light=[-.3,.7,1],length=Math.hypot(...normal)||1,dot=(normal[0]*light[0]+normal[1]*light[1]+normal[2]*light[2])/length;const intensity=clamp(.55+dot*.24,.27,.90)+(selected?.09:0);const c=hexColor(color).map(v=>Math.round(clamp(v*intensity+22,0,255)));return`rgb(${c.join(',')})`;}
function renderViewport(){
  if(!ctx)return;const rect=cvs.getBoundingClientRect();if(rect.width<5||rect.height<5)return;const dpr=Math.min(window.devicePixelRatio||1,2),w=rect.width,h=rect.height;
  if(cvs.width!==Math.round(w*dpr)||cvs.height!==Math.round(h*dpr)){cvs.width=Math.round(w*dpr);cvs.height=Math.round(h*dpr)}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const b=bounds();center=b.center;totalScale=b.size;
  // Floor grid follows current geometry scale (always world z=0).
  if(ui.grid){const step=Math.pow(10,Math.floor(Math.log10(totalScale/6||1)));const stride=step*(totalScale/step>20?5:1);const half=stride*9;ctx.save();for(let n=-9;n<=9;n++){
    const x=center[0]+n*stride,y=center[1]+n*stride;const alpha=n===0?'.42':'.12';drawLine([x,center[1]-half,0],[x,center[1]+half,0],w,h,`rgba(96,155,193,${alpha})`,n===0?1:.7);drawLine([center[0]-half,y,0],[center[0]+half,y,0],w,h,`rgba(96,155,193,${alpha})`,n===0?1:.7);
  }ctx.restore()}
  const axisSize=totalScale*.68;drawLine([0,0,0],[axisSize,0,0],w,h,'#a85e70',1.4);drawLine([0,0,0],[0,axisSize,0],w,h,'#589c7c',1.4);drawLine([0,0,0],[0,0,axisSize],w,h,'#638dbb',1.4);
  const faces=ui.scene.objects.filter(o=>o.visible!==false).flatMap(objectFaces);
  for(const f of faces){f.vertices=f.pts.map(p=>project(p,w,h));f.depth=f.vertices.reduce((s,p)=>s+p.depth,0)/f.vertices.length;}
  faces.sort((a,b)=>a.depth-b.depth);polygons=[];
  for(const face of faces){const selected=face.obj.id===ui.selection;const pts=face.vertices;ctx.beginPath();pts.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.closePath();
    if(!ui.wire){ctx.fillStyle=faceStyle(face.normal,face.obj.material?.color,selected);ctx.globalAlpha=face.obj.material?.name==='Vacuum'?.76:.91;ctx.fill();ctx.globalAlpha=1;}
    ctx.strokeStyle=selected?'rgba(135,233,253,.74)':'rgba(148,201,233,.29)';ctx.lineWidth=selected?1.1:.6;ctx.stroke();polygons.push({obj:face.obj.id,points:pts});
  }
  if(!ui.scene.objects.length){ctx.fillStyle='#6a839e';ctx.font='13px system-ui';ctx.textAlign='center';ctx.fillText('Create a solid using the Modeler toolbar',w/2,h/2)}
}
function pointInPolygon(x,y,vertices){let inside=false;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){
  const a=vertices[i],b=vertices[j];if(((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x))inside=!inside;
}return inside}
function pickObject(x,y){for(let i=polygons.length-1;i>=0;i--)if(pointInPolygon(x,y,polygons[i].points))return polygons[i].obj;return null}
// UI binding
$('tree').addEventListener('click',e=>{const eye=e.target.closest('[data-eye]');if(eye){const o=ui.scene.objects.find(o=>o.id===eye.dataset.eye);if(o)mutate(()=>o.visible=o.visible===false);return}const obj=e.target.closest('[data-object]');if(obj)return selectObject(obj.dataset.object);const choice=e.target.closest('[data-selection]');if(choice)return selectObject(choice.dataset.selection)});
$('inspectorContent').addEventListener('change',e=>{const el=e.target;if(el.dataset.edit)handleEdit(el.dataset.edit,el.value);if(el.dataset.text==='name'){const o=activeObject(),v=el.value.trim();if(o&&v)mutate(()=>o.name=v.slice(0,80))}});
$('projectName').addEventListener('blur',()=>{const s=$('projectName').textContent.trim();if(s&&s!==ui.scene.name)mutate(()=>ui.scene.name=s.slice(0,80));else $('projectName').textContent=ui.scene.name});
$('projectName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur()}});
document.querySelectorAll('[data-add]').forEach(btn=>btn.addEventListener('click',()=>newObject(btn.dataset.add)));
document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>{const preset=btn.dataset.view;ui.camera.yaw=preset==='iso'?.58:preset==='top'?0:0;ui.camera.pitch=preset==='top'?1.5704:preset==='front'?0:.46;fit()}));
document.querySelectorAll('.ribbon-tab').forEach(btn=>btn.addEventListener('click',()=>setTab(btn.dataset.tab)));
document.querySelectorAll('.lower-tab').forEach(btn=>btn.addEventListener('click',()=>setLower(btn.dataset.lower)));
$('duplicateBtn').onclick=duplicateObject;$('deleteBtn').onclick=deleteObject;$('fitBtn').onclick=fit;$('viewResetBtn').onclick=()=>{ui.camera.yaw=.58;ui.camera.pitch=.46;fit()};
$('gridBtn').onclick=()=>{ui.grid=!ui.grid;renderViewport();renderStatus()};$('wireBtn').onclick=()=>{ui.wire=!ui.wire;renderViewport();renderStatus()};
$('orbitHintBtn').onclick=()=>toast('Drag: orbit · Shift+drag: pan · Wheel: zoom · Click: select object');
$('resetBtn').onclick=()=>{if(!confirm('Replace the current scene with the sample cylindrical resonator?'))return;mutate(()=>{ui.scene=defaultScene();ui.selection='solid-1'});ui.results=[];ui.jobId=null;renderResults();fit();log('Reset design to sample cavity')};
$('saveBtn').onclick=saveScene;$('openBtn').onclick=()=>$('openFileInput').click();
$('openFileInput').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const scene=parseImportedScene(JSON.parse(await file.text()));mutate(()=>{ui.scene=scene;ui.selection=scene.objects[0].id});log('Opened scene '+scene.name);toast('Scene loaded','success');fit();}catch(err){toast(err.message,'error')}e.target.value=''};
$('validateBtn').onclick=()=>validateModel().catch(()=>{});$('exportBtn').onclick=exportInput;$('exportRibbonBtn').onclick=exportInput;
$('runBtn').onclick=startSolve;$('runRibbonBtn').onclick=startSolve;$('analysisFocusBtn').onclick=()=>selectObject('analysis');
$('resultFileInput').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{ui.results=parseCsv(await file.text());ui.jobId=null;renderResults();setLower('results');log(`Imported ${ui.results.length} eigenmodes from ${file.name}`);toast('Palace CSV imported','success')}catch(err){toast(err.message,'error')}e.target.value=''};
$('importResultsBtn').onclick=()=>$('resultFileInput').click();$('emptyImportBtn').onclick=()=>$('resultFileInput').click();$('resultsPanel').addEventListener('click',e=>{if(e.target.id==='emptyImportBtn')$('resultFileInput').click()});
$('loadBenchmarkBtn').onclick=loadBenchmark;
$('downloadJobBtn').onclick=()=>{if(!ui.jobId)return toast('No completed local simulation to download','error');window.location.href='/api/jobs/'+ui.jobId+'/download'};
$('clearLogBtn').onclick=()=>{ui.logs=[];log('Message console cleared')};$('collapseTreeBtn').onclick=()=>{$('tree').classList.toggle('hidden')};
cvs.addEventListener('pointerdown',e=>{cvs.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY,pan:e.shiftKey,moved:false}});
cvs.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)>3)drag.moved=true;if(drag.pan){const factor=totalScale*.003;ui.camera.panX+=dx*factor;ui.camera.panY-=dy*factor}else{ui.camera.yaw+=dx*.006;ui.camera.pitch=clamp(ui.camera.pitch+dy*.006,-1.52,1.52)}renderViewport()});
cvs.addEventListener('pointerup',e=>{if(drag&&!drag.moved){const r=cvs.getBoundingClientRect(),id=pickObject(e.clientX-r.left,e.clientY-r.top);if(id)selectObject(id)}drag=null});
cvs.addEventListener('wheel',e=>{e.preventDefault();ui.camera.zoom=clamp(ui.camera.zoom*Math.exp(-e.deltaY*.001),.12,16);renderViewport()},{passive:false});
window.addEventListener('resize',renderViewport);
window.addEventListener('keydown',e=>{const el=document.activeElement;if(['INPUT','SELECT','TEXTAREA'].includes(el?.tagName)||el?.isContentEditable)return;if(e.ctrlKey||e.metaKey){if(e.key.toLowerCase()==='s'){e.preventDefault();saveScene()}if(e.key.toLowerCase()==='d'){e.preventDefault();duplicateObject()}if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}if(e.key.toLowerCase()==='y'){e.preventDefault();redo()}}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteObject()}});
// Boot
log('Palace Studio v0.1 initialized');log('3D modeler ready · select a solid to edit its geometric parameters');log('Sample project: cylindrical cavity, Teflon εᵣ=2.08, PEC boundary');
renderAll();renderResults();health();
