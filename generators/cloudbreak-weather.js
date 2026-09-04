// Cloudbreak Weather Station: all positions are local to a site clear of older builds.
export function generate(args = {}) {
  const origin = [360, 0, 0], ops = [], connections = [];
  const C = { hull:[43,66,78], trim:[177,132,76], deck:[139,113,84], wall:[218,209,183], roof:[50,112,111], glow:[133,226,217], iron:[61,69,79], glass:[120,179,192], red:[159,72,57] };
  let parts, prefix;
  const begin = name => { prefix=name; parts=[]; ops.push({action:'build',args:{kind:'prop',name,center:origin,parts,...(ops.length?{parent:'Cloudbreak_Weather_Station'}:{})}}); };
  const box = (name,pos,size,color=C.hull,material='Metal',extra={}) => {
    const p={id:prefix+'/'+name,name,pos,size,color,material,...extra};parts.push(p);return p;
  };
  const beam=(name,from,to,width,color=C.trim)=>{const p=buildkit.beamBetween({name:prefix+'/'+name,from,to,width,color,material:'Metal'});parts.push(p);return p;};
  const cylinder=(name,pos,height,diameter,color=C.trim,extra={})=>box(name,pos,[height,diameter,diameter],color,'Metal',{shape:'cylinder',rot:[0,0,90],...extra});
  const joint=(id,a,ap,b,bp,type='touch')=>connections.push({id:prefix+'/'+id,type,a:{part:a.id,point:ap},b:{part:b.id,point:bp},tolerance:.015});
  const rail=(name,points)=>parts.push(...buildkit.railingPath({name:prefix+'/'+name,points,height:3.2,width:.18,postSpacing:6,color:C.trim,material:'Metal',connections}));
  function platform(x,y,z,w,d,name) {
    const floor=box(name+'_Deck',[x,y-1,z],[w,2,d],C.deck,'WoodPlanks');
    const hull=box(name+'_Hull',[x,y-3.5,z],[w-3,3,d-3]);
    joint(name+'_Deck_Hull',floor,[0,-1,0],hull,[0,1.5,0]);
    for(const sx of [-1,1])for(const sz of [-1,1]){
      cylinder(name+'_LiftPod_'+sx+'_'+sz,[x+sx*(w/2-5),y-6,z+sz*(d/2-5)],3,5,C.iron);
      cylinder(name+'_LiftGlow_'+sx+'_'+sz,[x+sx*(w/2-5),y-7.6,z+sz*(d/2-5)],.2,4.5,C.glow,{neon:true,canCollide:false});
      beam(name+'_Diagonal_'+sx+'_'+sz,[x+sx*4,y-5,z],[x+sx*(w/2-1),y-1.9,z+sz*(d/2-1)],.65);
    }
    for(const s of [-1,1])box(name+'_Edge_'+s,[x,y+.12,z+s*(d/2-.3)],[w,.24,.6],C.trim);
    return floor;
  }
  begin('Cloudbreak_Weather_Station');
  const central=platform(0,60,0,36,40,'Central');
  // Rails have deliberate six-stud portals at the bridge endpoints, never across a path.
  rail('FrontRail',[[-17.7,60,13.2],[-17.7,60,19.7],[17.7,60,19.7],[17.7,60,13.2]]);
  rail('BackRail',[[-17.7,60,6.8],[-17.7,60,-19.7],[17.7,60,-19.7],[17.7,60,6.8]]);
  begin('Cloudbreak_West_Collector');
  const west=platform(-64,56,10,24,30,'West');
  rail('Outer',[[-52.3,56,13.2],[-52.3,56,24.7],[-75.7,56,24.7],[-75.7,56,-4.7],[-52.3,56,-4.7],[-52.3,56,6.8]]);
  cylinder('Collector_Base',[-66,56.5,6],1,10,C.iron);
  cylinder('Collector_Tank',[-66,59,6],4,8,C.roof);
  cylinder('Collector_Lid',[-66,61.25,6],.5,9,C.trim);
  cylinder('Collector_Water',[-66,61.55,6],.1,7,C.glow,{neon:true,canCollide:false});
  for(let i=0;i<8;i++){const a=i*Math.PI/4;beam('Collector_Rib'+i,[-66+4*Math.cos(a),61.5,6+4*Math.sin(a)],[-66+8*Math.cos(a),65,6+8*Math.sin(a)],.3);}
  for(let i=0;i<3;i++){box('Crate'+i,[-70+i*4,57.5,20],[3,3,3],C.deck,'WoodPlanks');box('CrateBand'+i,[-70+i*4,57.5,21.55],[3.1,.35,.1],C.trim);}
  begin('Cloudbreak_East_SkyDock');
  const east=platform(64,64,10,28,36,'East');
  rail('Outer',[[50.3,64,6.8],[50.3,64,-7.7],[77.7,64,-7.7],[77.7,64,27.7],[50.3,64,27.7],[50.3,64,13.2]]);
  for(const x of [61,73])for(const z of [0,16]){box('MooringFoot'+x+'_'+z,[x,64.5,z],[2,1,2],C.iron);beam('MooringPost'+x+'_'+z,[x,65,z],[x,76,z],.55);}
  beam('MooringCrossA',[61,76,0],[73,76,0],.55);beam('MooringCrossB',[61,76,16],[73,76,16],.55);
  cylinder('Winch',[66,65.5,22],3,3,C.red);cylinder('WinchCap',[66,67.1,22],.2,3.5,C.trim);
  begin('Cloudbreak_Bridges');
  const bridge=(name,from,to,leftFloor,rightFloor,leftPoint,rightPoint)=>{
    const p=buildkit.bridgeBetween({name,from,to,width:6,stepRise:.5,minTread:1,landingLength:6,thickness:.6,railHeight:3.2,railWidth:.18,postSpacing:6,color:C.roof,material:'Metal',connections});parts.push(...p);
    const decks=p.filter(p=>p.name.includes('/deck-'));
    const first=decks[0],last=decks.at(-1);
    joint(name+'_Start',leftFloor,leftPoint,first,[-first.size[0]/2,first.size[1]/2,0]);
    joint(name+'_Finish',last,[last.size[0]/2,last.size[1]/2,0],rightFloor,rightPoint);
  };
  bridge('West_Causeway',[-52,56,10],[-18,60,10],west,central,[12,1,0],[-18,1,10]);
  bridge('East_Causeway',[18,60,10],[50,64,10],central,east,[18,1,10],[-14,1,0]);
  begin('Cloudbreak_ChartRoom');
  // Finished wall panels are 1 stud thick. South entrance is 8 wide x 10 high.
  const north=box('NorthWall',[0,66,-17],[26,12,1],C.wall,'Plaster');
  box('SouthLeft',[-8.5,66,3],[9,12,1],C.wall,'Plaster');box('SouthRight',[8.5,66,3],[9,12,1],C.wall,'Plaster');
  box('DoorLintel',[0,71,3],[8,2,1],C.wall,'Plaster');
  for(const x of [-12.5,12.5]){
    box('SideSill'+x,[x,61.5,-7],[1,3,19],C.wall,'Plaster');
    box('SideHeader'+x,[x,71,-7],[1,2,19],C.wall,'Plaster');
    for(const z of [-15.5,-7,1.5])box('WindowPier'+x+'_'+z,[x,66.5,z],[1,7,2],C.wall,'Plaster');
    for(const z of [-11.25,-2.75]){box('Glass'+x+'_'+z,[x,66.5,z],[.2,7,6.5],C.glass,'Glass',{transparency:.42,canCollide:false});box('Mullion'+x+'_'+z,[x,66.5,z],[.35,7,.18],C.trim);}
  }
  const roof=box('WeatherRoof',[0,72.5+(args.broken ? .25 : 0),-7],[27,1,21],C.roof);
  joint('RoofSeal',north,[0,6,0],roof,[0,-.5,-10]);
  for(const z of [-17.55,3.55])box('RoofFascia'+z,[0,72.5,z],[27.2,1.3,.1],C.trim);
  for(const x of [-4.25,4.25])box('EntranceCasing'+x,[x,65,3.65],[.5,10,.3],C.trim);
  box('EntranceCap',[0,70.2,3.65],[9,.4,.3],C.trim);
  box('Canopy',[0,70.5,5],[10,.45,3],C.roof);
  for(const x of [-5,5])beam('CanopyBrace'+x,[x,68.5,3.5],[x,70.2,6.3],.25);
  // A single-room program: circulation enters south, chart table centre, storage north.
  box('ChartTable',[0,63.3,-7],[9,.6,6],C.deck,'WoodPlanks');
  for(const x of [-3.8,3.8])for(const z of [-9.3,-4.7])box('TableLeg'+x+'_'+z,[x,61.5,z],[.5,3,.5],C.iron);
  box('ChartPaper',[0,63.64,-7],[7,.08,4],C.wall,'SmoothPlastic',{canCollide:false});
  for(let i=0;i<5;i++)beam('MapRoute'+i,[-2+i,63.71,-8+Math.sin(i)],[ -1+i,63.71,-8+Math.sin(i+1)],.055,C.roof);
  cylinder('Compass',[2,63.85,-6],.25,.7,C.trim,{canCollide:false});
  for(const x of [-9,9]){
    box('ShelfBack'+x,[x,64,-16.325],[4,8,.35],C.roof);
    for(let j=0;j<4;j++){box('Shelf'+x+'_'+j,[x,60.35+j*2,-15.15],[4,.3,2],C.deck,'WoodPlanks');for(let k=0;k<3;k++)box('Atlas'+x+'_'+j+'_'+k,[x-1+k,61+j*2,-15.1],[.65,1,1.2],k%2?C.red:C.trim,'Fabric');}
  }
  for(const x of [-10.5,10.5])box('Bench'+x,[x,61.5,-5],[2,3,5],C.deck,'WoodPlanks');
  for(const x of [-6,6]){cylinder('EntryLampBase'+x,[x,60.3,7],.6,1.5,C.iron);cylinder('EntryLampPole'+x,[x,62.8,7],4.4,.25);cylinder('EntryLamp'+x,[x,65.3,7],.6,1,C.glow,{neon:true,light:{brightness:.8,range:14,color:[255,211,157]},canCollide:false});}
  begin('Cloudbreak_WeatherCrown');
  cylinder('RadarPedestal',[0,74,-7],2,7,C.iron);
  cylinder('RadarBearing',[0,75.15,-7],.3,8,C.trim);
  box('RadarGlobe',[0,79.3,-7],[8,8,8],C.glass,'Glass',{shape:'ball',transparency:.22,canCollide:false});
  for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;beam('Meridian'+i,[5*Math.cos(a),79.3+5*Math.sin(a),-7],[5*Math.cos(b),79.3+5*Math.sin(b),-7],.18);}
  beam('Aerial',[0,74,-7],[0,88,-7],.25);box('Beacon',[0,88.5,-7],[1,1,1],C.glow,'Neon',{shape:'ball',canCollide:false});
  begin('Cloudbreak_SurveyBalloon');
  box('BalloonBasket',[67,80,8],[9,1,8],C.deck,'WoodPlanks');
  for(const z of [4,12])box('BasketSide'+z,[67,82,z],[9,3,.4],C.trim);for(const x of [62.5,71.5])box('BasketEnd'+x,[x,82,8],[.4,3,8],C.trim);
  box('Envelope',[67,99,8],[25,25,25],C.red,'Fabric',{shape:'ball',canCollide:false});
  cylinder('BalloonCollar',[67,86.8,8],.6,6,C.trim);
  for(const x of [63,71])for(const z of [5,11])beam('Suspension'+x+'_'+z,[x,80.5,z],[x,88,z],.12);
  beam('TetherA',[61,76,0],[63,79.5,5],.16);beam('TetherB',[73,76,16],[71,79.5,11],.16);
  // Assign cross-assembly rules to one op; Stage canonicalizes them onto their owning parts.
  ops[0].args.connections=connections;
  return ops;
}
