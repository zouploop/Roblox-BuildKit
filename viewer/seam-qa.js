// Pure geometry shared by the editor and MCP. Bounding boxes only select candidates;
// they never prove a joint. Mesh/CSG contact remains explicitly unchecked here.
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const len=a=>Math.hypot(...a);
const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const ZERO=[0,0,0];
export function rotateStageVector(v,rot=ZERO) {
  const [x,y,z]=rot.map(d=>d*Math.PI/180),[sx,cx,sy,cy,sz,cz]=[Math.sin(x),Math.cos(x),Math.sin(y),Math.cos(y),Math.sin(z),Math.cos(z)];
  const a=[v[0]*cz-v[1]*sz,v[0]*sz+v[1]*cz,v[2]];
  const b=[a[0]*cy+a[2]*sy,a[1],-a[0]*sy+a[2]*cy];
  return [b[0],b[1]*cx-b[2]*sx,b[1]*sx+b[2]*cx];
}
const rotate=rotateStageVector;
export function stageWorldPoint(center,rot,v) { return add(center,rotateStageVector(v,rot)); }
const world=(p,v)=>stageWorldPoint(p.center,p.raw.rot,v);
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
    const candidate={gap,pointA,pointB,area,coverage:area/Math.min(A.area,B.area),confidence:'measured',type:'face-gap',region:{polygon,origin:A.c,u:A.u,v:A.v}};
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
      if(!raw||typeof raw!=='object'||Array.isArray(raw)||!vec(raw.size)||raw.size.some(v=>v<=0)||!vec(raw.pos??ZERO)||!vec(raw.rot??ZERO)||!vec(args.center??ZERO)){unsupported.push({opIndex,partIndex,reason:'invalid geometry'});return;}
      const shape=(raw.shape??'box').toLowerCase(),center=add(args.center??ZERO,raw.pos??ZERO),axes=[[1,0,0],[0,1,0],[0,0,1]].map(v=>rotate(v,raw.rot));
      const half=raw.size.map(v=>v/2),extent=[0,1,2].map(i=>axes.reduce((s,v,j)=>s+Math.abs(v[i])*half[j],0));
      const p={ref:{opIndex,partIndex},raw,center,axes,half,min:sub(center,extent),max:add(center,extent),shape,kind:args.kind,locked:raw.locked||args.locked};
      p.supported=!args.csg&&!raw.negate&&(!raw.op||raw.op==='union')&&['box','cylinder'].includes(shape);
      p.faces=shape==='box'?boxFaces(p):[];
      if(!p.supported)unsupported.push({...p.ref,reason:args.csg?'CSG surface':'unsupported surface: '+shape});
      parts.push(p);
      for(const [key,map] of [[raw.id,lookup.ids],[raw.name,lookup.names]])if(key!==undefined)map.set(key,map.has(key)?null:p);
    });
  });
  return {parts,byOp,unsupported};
}
function segmentBoxInterval(a,b,p,padding=0) {
  const delta=sub(b,a),localA=p.axes.map(axis=>dot(sub(a,p.center),axis)),localD=p.axes.map(axis=>dot(delta,axis));
  let enter=0,exit=1;
  for(let i=0;i<3;i++) {
    const half=p.half[i]+padding;
    if(Math.abs(localD[i])<1e-10) { if(Math.abs(localA[i])>half)return null; continue; }
    const first=(-half-localA[i])/localD[i],last=(half-localA[i])/localD[i];
    enter=Math.max(enter,Math.min(first,last));exit=Math.min(exit,Math.max(first,last));
    if(enter>exit)return null;
  }
  return [enter,exit];
}
function segmentPartInterval(a,b,p,padding=0) {
  const localA=p.axes.map(axis=>dot(sub(a,p.center),axis)),localD=p.axes.map((axis)=>dot(sub(b,a),axis));
  if(p.shape==='box')return segmentBoxInterval(a,b,p,padding);
  if(p.shape!=='cylinder')return null;
  const halfX=p.half[0]+padding,r=Math.min(p.half[1],p.half[2])+padding;
  let enter=0,exit=1;
  if(Math.abs(localD[0])<1e-10) { if(Math.abs(localA[0])>halfX)return null; }
  else {
    const first=(-halfX-localA[0])/localD[0],last=(halfX-localA[0])/localD[0];
    enter=Math.max(enter,Math.min(first,last));exit=Math.min(exit,Math.max(first,last));
    if(enter>exit)return null;
  }
  const radial=(t)=>{const y=localA[1]+localD[1]*t,z=localA[2]+localD[2]*t;return y*y+z*z;};
  const radialSpeed=localD[1]*localD[1]+localD[2]*localD[2];
  const closest=radialSpeed<1e-20?enter:Math.max(enter,Math.min(exit,-(localA[1]*localD[1]+localA[2]*localD[2])/radialSpeed));
  return radial(closest)<=r*r? [enter,exit]:null;
}
function treadLike(p) { return /tread|step|stair|deck/i.test(`${p.raw.name??''} ${p.kind??''}`); }
function supportCoverage(support,high) {
  if(support.shape!=='box'||high.shape!=='box')return 0;
  const corners=p=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sz])=>add(p.center,add(mul(p.axes[0],sx*p.half[0]),mul(p.axes[2],sz*p.half[2])))).map(point=>[point[0],point[2]]);
  const supportPolygon=convexHull(corners(support)),highPolygon=convexHull(corners(high));
  return polygonArea(intersectPolygon(supportPolygon,highPolygon))/Math.max(polygonArea(highPolygon),1e-8);
}
function axisAlignedBox(p) {
  return p.shape==='box'&&p.axes.every(axis=>{
    const largest=Math.max(...axis.map(value=>Math.abs(value)));
    return largest>=1-1e-6&&axis.filter(value=>Math.abs(value)>1e-6).length===1;
  });
}
function nextTreadSupport(a,b,parts,tolerance,budget) {
  const treadCandidate=treadLike(a)||treadLike(b);
  if(!treadCandidate)return {checks:0,treadCandidate:false};
  const rise=Math.abs(a.center[1]-b.center[1]);
  if(rise<=tolerance)return {checks:0,treadCandidate:true,rise};
  const high=a.center[1]>=b.center[1]?a:b,low=high===a?b:a;
  let checks=0;
  const check=(support)=>{
    if(checks>=budget)return {checks,treadCandidate:true,budgetExceeded:true};
    checks++;
    const verticalGap=high.min[1]-support.max[1];
    if(axisAlignedBox(support)&&axisAlignedBox(high)&&support.supported&&support!==high&&support.center[1]<high.center[1]&&verticalGap>=-tolerance&&verticalGap<=tolerance&&supportCoverage(support,high)>=.98) return {part:support,mode:'support-contact',checks};
    return undefined;
  };
  const first=check(low);
  if(first&&first.part)return first;
  if(checks>=budget)return {checks,treadCandidate:true,rise,budgetExceeded:true};
  for(const support of parts) {
    if(support===a||support===b||support===low)continue;
    const found=check(support);
    if(found&&found.part)return found;
    if(checks>=budget)return {checks,treadCandidate:true,rise,budgetExceeded:true};
  }
  return {checks,treadCandidate:true,rise};
}
function convexHull(points) {
  const sorted=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower=[];for(const point of sorted){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),point)<=0)lower.pop();lower.push(point);}
  const upper=[];for(const point of sorted.reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),point)<=0)upper.pop();upper.push(point);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function blockerCoverage(part,data) {
  if(part.shape!=='box'||!data.region)return 0;
  const {origin,u,v,polygon}=data.region,project=(point)=>[dot(sub(point,origin),u),dot(sub(point,origin),v)],corners=[];
  for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1])corners.push(add(part.center,add(add(mul(part.axes[0],sx*part.half[0]),mul(part.axes[1],sy*part.half[1])),mul(part.axes[2],sz*part.half[2]))));
  const covered=polygonArea(intersectPolygon(convexHull(corners.map(project)),polygon));
  return covered/Math.max(polygonArea(polygon),1e-8);
}
function classifyGap(a,b,data,parts,tolerance,budget) {
  if(budget<=0)return {type:data.type,classification:'seam',confidence:'unchecked',classificationConfidence:'unchecked',hint:'classification budget exhausted',classificationChecks:0,classificationBudgetExceeded:true};
  const support=nextTreadSupport(a,b,parts,tolerance,budget);
  let checks=support.checks;
  if(support.part)return {type:'clearance',classification:'next-tread-support',reason:support.mode,support:support.part.ref,classificationConfidence:'proven',classificationChecks:checks};
  let hint=support.treadCandidate?{reason:'tread-like gap without proven support'}:null;
  if(support.budgetExceeded)return {type:data.type,classification:'seam',confidence:'unchecked',classificationConfidence:'unchecked',hint:'classification budget exhausted',classificationChecks:checks,classificationBudgetExceeded:true};
  for(const part of parts) {
    if(part===a||part===b||!data.pointA||!data.pointB)continue;
    if(checks>=budget)return {type:data.type,classification:'seam',confidence:'unchecked',classificationConfidence:'unchecked',hint:'classification budget exhausted',classificationChecks:checks,classificationBudgetExceeded:true};
    checks++;
    if(!part.supported)continue;
    const interval=segmentPartInterval(data.pointA,data.pointB,part,0);
    if(!interval||interval[1]-interval[0]<=1e-6||interval[0]>=1-1e-6||interval[1]<=1e-6)continue;
    const coverage=blockerCoverage(part,data);
    if(coverage>=.98)return {type:'clearance',classification:'intervening-geometry',reason:'intervening geometry covers the seam region',intervening:[part.ref],classificationConfidence:'proven',classificationChecks:checks,interveningCoverage:coverage};
    hint??={reason:'partial intervening geometry'};
  }
  return {type:data.type,classification:'seam',...(hint?{confidence:'hint',hint:hint.reason,classificationConfidence:'hint'}:{}),classificationChecks:checks};
}
function issueScore(severity,classification,gap=0) {
  const severityScore=severity==='error'?2:1,kindScore=classification==='seam'?2:classification==='intentional-clearance'?0:1;
  return severityScore*1_000_000+kindScore*100_000+Math.min(10_000,Math.max(0,gap))*100+1;
}
function makeIssue(a,b,data,connection) {
  const severity=connection?'error':'warning',classification=data.classification??(connection?.type==='clearance'?'intentional-clearance':connection?'authored-joint':'seam');
  const ref=data.type==='clearance'?'Clearance':'Gap',suffix=connection?'authored joint':classification==='seam'?'suspected seam':classification;
  const issue={id:fingerprint(a,b,connection??data.type),severity,score:issueScore(severity,classification,data.gap),...data,classification,a:a.ref,b:b.ref,
    message:`${ref} ${data.gap.toFixed(3)} studs: ${a.raw.name??a.raw.id??a.ref.partIndex} → ${b.raw.name??b.raw.id??b.ref.partIndex} (${suffix})`};
  if(data.type!=='clearance'&&(classification==='seam'||connection)&&!b.locked&&data.gap<=.6&&data.confidence==='measured') {
    const delta=sub(data.pointA,data.pointB);
    issue.fix={index:b.ref.opIndex,partIndex:b.ref.partIndex,patch:{...b.raw,pos:add(b.raw.pos??ZERO,delta)}};
  }
  return issue;
}
export function scanStageIssues(ops,options={}) {
  const tolerance=options.tolerance??.02,maxGap=options.maxGap??.6,maxIssues=options.maxIssues??100,maxPairs=options.maxPairs??250000,maxClassificationChecks=options.maxClassificationChecks??Math.max(1,Math.min(maxPairs,maxIssues*32));
  if(!Array.isArray(ops)||![tolerance,maxGap,maxIssues,maxPairs,maxClassificationChecks].every(Number.isFinite)||tolerance<0||maxGap<=tolerance||maxIssues<1||maxPairs<1||maxClassificationChecks<1)throw new Error('Invalid seam scan options');
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
        all.push({id:`invalid:${opIndex}:${rule.id}`,type:'invalid-connection',classification:'invalid',severity:'error',score:2_000_001,confidence:'unchecked',message:`Connection ${rule.id}: missing or ambiguous part / invalid endpoint`,a:{opIndex,partIndex:-1}});continue;
      }
      authoredChecked++;
      explicitPairs.add(pairKey(a,b));
      const pointA=endpoint(a,rule.a),pointB=endpoint(b,rule.b),gap=len(sub(pointB,pointA));
      const failed=rule.type==='clearance'?(gap<(rule.min??0)||gap>(rule.max??Infinity)):gap>(rule.tolerance??tolerance);
      if(failed) {
        const issue=makeIssue(a,b,{type:rule.type,gap,pointA,pointB,confidence:'measured',...(rule.type==='clearance'?{classification:'intentional-clearance'}:{classification:'authored-joint'})},rule);
        // A move cannot be called a safe snap if this part participates in other declared joints.
        if(rules.filter(({rule:r,opIndex:i})=>resolve(i,r.a.part)===b||resolve(i,r.b.part)===b).length>1)delete issue.fix;
        all.push(issue);
      }
  }
  // ponytail: sweep-and-prune can still be quadratic in dense scenes; stop at maxPairs
  // and report partial coverage. Add spatial subdivision only if this budget is hit often.
  const sorted=parts.filter(p=>p.supported).sort((a,b)=>a.min[0]-b.min[0]);
  let pairsChecked=0,budgetExceeded=false,classificationChecks=0,classificationBudgetExceeded=false;
  outer:for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++) {
    const a=sorted[i],b=sorted[j];if(b.min[0]>a.max[0]+maxGap)break;
    if([1,2].some(k=>a.min[k]>b.max[k]+maxGap||b.min[k]>a.max[k]+maxGap))continue;
    if(pairsChecked>=maxPairs){budgetExceeded=true;break outer;}pairsChecked++;
    if(explicitPairs.has(pairKey(a,b)))continue;
    const seam=a.shape==='box'&&b.shape==='box'?faceGap(a,b,tolerance,maxGap):a.shape==='cylinder'&&b.shape==='cylinder'?cylinderGap(a,b,tolerance,maxGap):null;
    if(seam) {
      const classification=classifyGap(a,b,seam,parts,tolerance,maxClassificationChecks-classificationChecks);
      classificationChecks+=classification.classificationChecks??0;
      classificationBudgetExceeded ||= !!classification.classificationBudgetExceeded;
      all.push(makeIssue(a,b,{...seam,...classification}));
    }
  }
  all.sort((a,b)=>(b.score??0)-(a.score??0)||(a.id<b.id?-1:a.id>b.id?1:0));
  return {issues:all.slice(0,maxIssues),counts:{total:all.length,shown:Math.min(all.length,maxIssues),errors:all.filter(i=>i.severity==='error').length,warnings:all.filter(i=>i.severity==='warning').length},
    coverage:{status:unsupported.length||budgetExceeded||classificationBudgetExceeded?'partial':'complete',scope:'parallel box faces, parallel cylinder endcaps, and authored endpoints only',parts:parts.length,unsupportedParts:unsupported.length,unsupported:unsupported.slice(0,25),pairsChecked,authoredChecked,budgetExceeded,classificationChecks,classificationBudget:maxClassificationChecks,classificationBudgetExceeded,resultsTruncated:all.length>maxIssues,unchecked:'Curved sides, mixed primitive contacts, arbitrary mesh/CSG surfaces, and undeclared openings are not certified.'}};
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
    const id=p.raw.id,name=p.raw.name;
    const hasId=id&&actualIds.has(id);
    const q=hasId?(ids.get(id)===1&&actualIds.get(id)===1?actual.find(a=>a.buildkitId===id):null)
      :names.get(name)===1&&actualNames.get(name)===1?actual.find(a=>a.name===name):null;
    if(!q){if(p.supported)issues.push({type:'missing-or-ambiguous',a:p.ref,name,id});continue;}
    matched.add(q);
    if(!p.supported)continue;
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
