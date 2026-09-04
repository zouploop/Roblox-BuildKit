// Pure geometry shared by the editor and MCP. Bounding boxes only select candidates;
// they never prove a joint. Mesh/CSG contact remains explicitly unchecked here.
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const len=a=>Math.hypot(...a);
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const ZERO=[0,0,0];
function rotate(v,rot=ZERO) {
  const [x,y,z]=rot.map(d=>d*Math.PI/180),[sx,cx,sy,cy,sz,cz]=[Math.sin(x),Math.cos(x),Math.sin(y),Math.cos(y),Math.sin(z),Math.cos(z)];
  const a=[v[0]*cz-v[1]*sz,v[0]*sz+v[1]*cz,v[2]];
  const b=[a[0]*cy+a[2]*sy,a[1],-a[0]*sy+a[2]*cy];
  return [b[0],b[1]*cx-b[2]*sx,b[1]*sx+b[2]*cx];
}
const world=(p,v)=>add(p.center,rotate(v,p.raw.rot));
function fingerprint(a,b,extra='') {
  const text=JSON.stringify([a.ref,b?.ref,a.center,a.raw,b?.center,b?.raw,extra]);
  let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);
  return `${a.ref.opIndex}:${a.ref.partIndex}-${b?`${b.ref.opIndex}:${b.ref.partIndex}`:'none'}-${(h>>>0).toString(16)}`;
}
function boxFaces(p) {
  const out=[];
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]) {
    const j=(axis+1)%3,k=(axis+2)%3,n=mul(p.axes[axis],sign);
    const c=add(p.center,mul(n,p.half[axis])),u=p.axes[j],v=p.axes[k];
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,t])=>add(c,add(mul(u,s*p.half[j]),mul(v,t*p.half[k]))));
    out.push({c,n,u,v,corners,area:4*p.half[j]*p.half[k]});
  }
  return out;
}
// Convex polygon clipping in the first face's plane, preserving partial seam coverage.
function intersectPolygon(subject,clip) {
  let result=subject;
  for(let i=0;i<clip.length;i++) {
    const a=clip[i],b=clip[(i+1)%clip.length];
    const side=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
    const input=result;result=[];if(!input.length)break;
    for(let j=0;j<input.length;j++) {
      const p=input[j],q=input[(j+1)%input.length],sp=side(p),sq=side(q);
      if(sp>=-1e-8)result.push(p);
      if((sp>=0)!==(sq>=0)){const t=sp/(sp-sq);result.push(p.map((v,k)=>v+t*(q[k]-v)));}
    }
  }
  return result;
}
function polygonArea(p) {return Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0))/2;}
function faceGap(a,b,tolerance,maxGap) {
  let best=null;
  for(const A of a.faces)for(const B of b.faces) {
    if(dot(A.n,B.n)>-0.99999)continue;
    const gap=dot(sub(B.c,A.c),A.n);if(gap<=tolerance||gap>maxGap)continue;
    const project=p=>[dot(sub(p,A.c),A.u),dot(sub(p,A.c),A.v)];
    const polygon=intersectPolygon(B.corners.map(project),A.corners.map(project));
    const area=polygonArea(polygon);if(area<0.001)continue;
    const c=polygon.reduce((s,p)=>s.map((v,i)=>v+p[i]/polygon.length),[0,0]);
    const pointA=add(A.c,add(mul(A.u,c[0]),mul(A.v,c[1]))),pointB=add(pointA,mul(A.n,gap));
    const candidate={gap,pointA,pointB,area,coverage:area/Math.min(A.area,B.area),confidence:'measured',type:'face-gap'};
    if(!best||gap<best.gap)best=candidate;
  }
  return best;
}
function cylinderGap(a,b,tolerance,maxGap) {
  if(Math.abs(dot(a.axes[0],b.axes[0]))<.99999)return null;
  for(const sa of [-1,1])for(const sb of [-1,1]) {
    const na=mul(a.axes[0],sa),nb=mul(b.axes[0],sb);if(dot(na,nb)>-.99999)continue;
    const A=add(a.center,mul(na,a.half[0])),B=add(b.center,mul(nb,b.half[0]));
    const delta=sub(B,A),gap=dot(delta,na),lateral=sub(delta,mul(na,gap));
    const ra=Math.min(a.half[1],a.half[2]),rb=Math.min(b.half[1],b.half[2]);
    if(gap<=tolerance||gap>maxGap||len(lateral)>=ra+rb)continue;
    const pointA=add(A,mul(lateral,ra/(ra+rb))),pointB=add(pointA,mul(na,gap));
    return {gap,pointA,pointB,confidence:Math.abs(a.half[1]-a.half[2])+Math.abs(b.half[1]-b.half[2])<1e-7?'measured':'approximate',type:'endpoint-gap'};
  }
  return null;
}
function flatten(ops) {
  const parts=[],byOp=[],unsupported=[];
  ops.forEach((op,opIndex)=>{
    const args=op.args??{},lookup={ids:new Map(),names:new Map()};byOp[opIndex]=lookup;
    if(op.action!=='build'||args.kind!=='prop'||!Array.isArray(args.parts)){unsupported.push({opIndex,reason:'non-prop geometry'});return;}
    args.parts.forEach((raw,partIndex)=>{
      if(!vec(raw.size)||raw.size.some(v=>v<=0)||!vec(raw.pos??ZERO)||!vec(raw.rot??ZERO)||!vec(args.center??ZERO)){unsupported.push({opIndex,partIndex,reason:'invalid geometry'});return;}
      const shape=(raw.shape??'box').toLowerCase(),center=add(args.center??ZERO,raw.pos??ZERO),axes=[[1,0,0],[0,1,0],[0,0,1]].map(v=>rotate(v,raw.rot));
      const half=raw.size.map(v=>v/2),extent=[0,1,2].map(i=>axes.reduce((s,v,j)=>s+Math.abs(v[i])*half[j],0));
      const p={ref:{opIndex,partIndex},raw,center,axes,half,min:sub(center,extent),max:add(center,extent),shape,locked:raw.locked||args.locked};
      p.supported=!args.csg&&!raw.negate&&(!raw.op||raw.op==='union')&&['box','cylinder'].includes(shape);
      p.faces=shape==='box'?boxFaces(p):[];
      if(!p.supported)unsupported.push({...p.ref,reason:args.csg?'CSG surface':'unsupported surface: '+shape});
      parts.push(p);
      for(const [key,map] of [[raw.id,lookup.ids],[raw.name,lookup.names]])if(key!==undefined)map.set(key,map.has(key)?null:p);
    });
  });
  return {parts,byOp,unsupported};
}
function makeIssue(a,b,data,connection) {
  const ref=data.type==='clearance'?'Clearance':'Gap';
  const issue={id:fingerprint(a,b,connection??data.type),severity:connection?'error':'warning',...data,a:a.ref,b:b.ref,
    message:`${ref} ${data.gap.toFixed(3)} studs: ${a.raw.name??a.raw.id??a.ref.partIndex} → ${b.raw.name??b.raw.id??b.ref.partIndex}${connection?' (authored joint)':' (suspected seam)'}`};
  if(data.type!=='clearance'&&!b.locked&&data.gap<=.6&&data.confidence==='measured') {
    const delta=sub(data.pointA,data.pointB);
    issue.fix={index:b.ref.opIndex,partIndex:b.ref.partIndex,patch:{...b.raw,pos:add(b.raw.pos??ZERO,delta)}};
  }
  return issue;
}
export function scanStageIssues(ops,options={}) {
  const tolerance=options.tolerance??.02,maxGap=options.maxGap??.6,maxIssues=options.maxIssues??100,maxPairs=options.maxPairs??250000;
  if(!Array.isArray(ops)||![tolerance,maxGap,maxIssues,maxPairs].every(Number.isFinite)||tolerance<0||maxGap<=tolerance||maxIssues<1||maxPairs<1)throw new Error('Invalid seam scan options');
  const {parts,byOp,unsupported}=flatten(ops),all=[],explicitPairs=new Set(),globalIds=new Map();
  for(const p of parts)if(p.raw.id)globalIds.set(p.raw.id,globalIds.has(p.raw.id)?null:p);
  const pairKey=(a,b)=>[`${a.ref.opIndex}:${a.ref.partIndex}`,`${b.ref.opIndex}:${b.ref.partIndex}`].sort().join('|');
  const rules=ops.flatMap((op,opIndex)=>[...(op.args?.connections??[]),...(op.args?.parts??[]).flatMap(p=>p.connections??[])].map(rule=>({rule,opIndex})));
  const resolve=(opIndex,key)=>byOp[opIndex]?.ids.has(key)?byOp[opIndex].ids.get(key):globalIds.has(key)?globalIds.get(key):byOp[opIndex]?.names.get(key);
  const endpoint=(p,e)=>world(p,vec(e.size)?e.point.map((v,i)=>v*p.raw.size[i]/e.size[i]):e.point);
  let authoredChecked=0;
  for(const {rule,opIndex} of rules) {
      const a=resolve(opIndex,rule.a?.part),b=resolve(opIndex,rule.b?.part);
      if(!a||!b||!vec(rule.a?.point)||!vec(rule.b?.point)) {
        all.push({id:`invalid:${opIndex}:${rule.id}`,type:'invalid-connection',severity:'error',confidence:'unchecked',message:`Connection ${rule.id}: missing or ambiguous part / invalid endpoint`,a:{opIndex,partIndex:-1}});continue;
      }
      authoredChecked++;
      explicitPairs.add(pairKey(a,b));
      const pointA=endpoint(a,rule.a),pointB=endpoint(b,rule.b),gap=len(sub(pointB,pointA));
      const failed=rule.type==='clearance'?(gap<(rule.min??0)||gap>(rule.max??Infinity)):gap>(rule.tolerance??tolerance);
      if(failed) {
        const issue=makeIssue(a,b,{type:rule.type,gap,pointA,pointB,confidence:'measured'},rule);
        // A move cannot be called a safe snap if this part participates in other declared joints.
        if(rules.filter(({rule:r,opIndex:i})=>resolve(i,r.a.part)===b||resolve(i,r.b.part)===b).length>1)delete issue.fix;
        all.push(issue);
      }
  }
  // ponytail: sweep-and-prune can still be quadratic in dense scenes; stop at maxPairs
  // and report partial coverage. Add spatial subdivision only if this budget is hit often.
  const sorted=parts.filter(p=>p.supported).sort((a,b)=>a.min[0]-b.min[0]);
  let pairsChecked=0,budgetExceeded=false;
  outer:for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++) {
    const a=sorted[i],b=sorted[j];if(b.min[0]>a.max[0]+maxGap)break;
    if([1,2].some(k=>a.min[k]>b.max[k]+maxGap||b.min[k]>a.max[k]+maxGap))continue;
    if(pairsChecked>=maxPairs){budgetExceeded=true;break outer;}pairsChecked++;
    if(explicitPairs.has(pairKey(a,b)))continue;
    const seam=a.shape==='box'&&b.shape==='box'?faceGap(a,b,tolerance,maxGap):a.shape==='cylinder'&&b.shape==='cylinder'?cylinderGap(a,b,tolerance,maxGap):null;
    if(seam)all.push(makeIssue(a,b,seam));
  }
  all.sort((a,b)=>(a.severity==='error'?0:1)-(b.severity==='error'?0:1)||(b.gap??0)-(a.gap??0));
  return {issues:all.slice(0,maxIssues),counts:{total:all.length,shown:Math.min(all.length,maxIssues),errors:all.filter(i=>i.severity==='error').length,warnings:all.filter(i=>i.severity==='warning').length},
    coverage:{status:unsupported.length||budgetExceeded?'partial':'complete',scope:'parallel box faces, parallel cylinder endcaps, and authored endpoints only',parts:parts.length,unsupportedParts:unsupported.length,unsupported:unsupported.slice(0,25),pairsChecked,authoredChecked,budgetExceeded,resultsTruncated:all.length>maxIssues,unchecked:'Curved sides, mixed primitive contacts, arbitrary mesh/CSG surfaces, and undeclared openings are not certified.'}};
}

// Exact matrix comparison avoids Euler-order and rounded scene-dump ambiguity.
// Names are a fallback only when unique on BOTH sides; duplicate ids fail closed.
export function compareStageGeometry(ops,dump,tolerance=.001) {
  if(!Number.isFinite(tolerance)||tolerance<0)throw new Error('Invalid comparison tolerance');
  const {parts,unsupported}=flatten(ops),actual=Array.isArray(dump.parts)?dump.parts:[];
  const count=(items,key)=>{const m=new Map();for(const p of items){const k=key(p);if(k)m.set(k,(m.get(k)??0)+1);}return m;};
  const names=count(parts,p=>p.raw.name),ids=count(parts,p=>p.raw.id),actualNames=count(actual,p=>p.name),actualIds=count(actual,p=>p.buildkitId);
  const issues=[],matched=new Set();let checked=0,unchecked=unsupported.length;
  for(const p of parts) {
    if(!p.supported)continue;
    const id=p.raw.id,name=p.raw.name;
    const hasId=id&&actualIds.has(id);
    const q=hasId?(ids.get(id)===1&&actualIds.get(id)===1?actual.find(a=>a.buildkitId===id):null)
      :names.get(name)===1&&actualNames.get(name)===1?actual.find(a=>a.name===name):null;
    if(!q){issues.push({type:'missing-or-ambiguous',a:p.ref,name,id});continue;}
    matched.add(q);
    if(!Array.isArray(q.cframe)||q.cframe.length!==12||!q.cframe.every(Number.isFinite)||!vec(q.exactSize)) {
      unchecked++;issues.push({type:'imprecise-readback',a:p.ref,name});continue;
    }
    checked++;
    const matrix=[...p.center,...[0,1,2].flatMap(i=>p.axes.map(axis=>axis[i]))];
    const positionError=Math.max(...p.center.map((v,i)=>Math.abs(v-q.cframe[i])));
    const rotationError=Math.max(...matrix.slice(3).map((v,i)=>Math.abs(v-q.cframe[i+3])));
    const sizeError=Math.max(...p.raw.size.map((v,i)=>Math.abs(v-q.exactSize[i])));
    const rawShape=String(q.shape??'').toLowerCase(),shape=rawShape==='block'?'box':rawShape;
    if(positionError>tolerance||rotationError>tolerance||sizeError>tolerance||shape!==p.shape)issues.push({type:'geometry-mismatch',a:p.ref,name,positionError,rotationError,sizeError,expectedShape:p.shape,actualShape:shape});
  }
  const extras=actual.filter(p=>!matched.has(p));
  const partial=!!unchecked||dump.truncated===true||dump.coverage!=='complete';
  return {clean:!partial&&!issues.length&&!extras.length,coverage:partial?'partial':'complete',checked,unchecked,issues,extraParts:extras.map(p=>({name:p.name,id:p.buildkitId})),scope:'primitive transforms, sizes and shapes; not CSG surface fidelity, materials or lighting'};
}
