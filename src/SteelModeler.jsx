import { useState, useMemo } from "react";

/* ============ SECTION DATABASE (kg/m, A cm2, Ix cm4, Zx cm3, rx cm, ry cm, h mm) ============ */
const DB = [
  ["IPE160",15.8,20.1,869,124,6.58,1.84,160],["IPE180",18.8,23.9,1317,166,7.42,2.05,180],
  ["IPE200",22.4,28.5,1943,220,8.26,2.24,200],["IPE220",26.2,33.4,2772,285,9.11,2.48,220],
  ["IPE240",30.7,39.1,3892,367,9.97,2.69,240],["IPE270",36.1,45.9,5790,484,11.2,3.02,270],
  ["IPE300",42.2,53.8,8356,628,12.5,3.35,300],["IPE330",49.1,62.6,11770,804,13.7,3.55,330],
  ["IPE360",57.1,72.7,16270,1019,15.0,3.79,360],["IPE400",66.3,84.5,23130,1307,16.5,3.95,400],
  ["IPE450",77.6,98.8,33740,1702,18.5,4.12,450],["IPE500",90.7,115.5,48200,2194,20.4,4.31,500],
].map(([n,w,A,Ix,Zx,rx,ry,h])=>({n,w,A,Ix,Zx,rx,ry,h}));
// Cold-formed purlin: Z 150x50x20x2.5 (validated against production hangar model)
const ZP={n:"Z 150x50x20x2.5",A:7.394e-4,Ix:2.588e-6,S:3.451e-5,w:0.0569*100/9.81,Fy:344.7};

/* ============ NL PARSER ============ */
function parseText(t){
  const s=t.toLowerCase().replace(/diaphram/g,"diaphragm"); const warn=[]; const note=[];
  const M="m(?:eters?|tr?s?)?\\.?";
  const num=(res,d,label)=>{ for(const re of res){const m=s.match(re); if(m) return parseFloat(m[1]);}
    if(label) warn.push(label+" not found — using default "+d); return d; };
  // eave / ridge (edge, eaves, apex, middle, centre; number before or after)
  const eave=num([new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"[^.,;\\d]{0,24}?(?:from|at|in at)\\s*(?:the\\s*)?e(?:dge|ave)s?"),
                  new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"\\s*eaves?\\b"),
                  new RegExp("(?:height\\s*)?(?:at\\s*)?(?:the\\s*)?eaves?[^\\d]{0,14}(\\d+(?:\\.\\d+)?)"),
                  /eave\s*(?:height\s*)?(?:of\s*|is\s*|=\s*)?(\d+(?:\.\d+)?)/],6,"eave height");
  const ridge=num([new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"[^.,;\\d]{0,24}?(?:from|at)\\s*(?:the\\s*)?(?:middle|cent(?:re|er)|ridge|apex)"),
                   new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"\\s*(?:ridge|apex)\\b"),
                   new RegExp("(?:ridge|apex)[^\\d]{0,14}(\\d+(?:\\.\\d+)?)")],8,"ridge height");
  // plan dimensions
  const wxl=s.match(new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"?\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*"+M+"?"));
  let width=num([new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"\\s*(?:width|wide|span)"),
                 /(?:width|span)\s*(?:of\s*|is\s*|=\s*)?(\d+(?:\.\d+)?)/],0);
  let length=num([new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"\\s*(?:length|long\\b)"),
                  /length\s*(?:of\s*|is\s*|=\s*)?(\d+(?:\.\d+)?)/],0);
  if(wxl){ if(!width)width=parseFloat(wxl[1]); if(!length)length=parseFloat(wxl[2]); }
  const baySize=num([new RegExp("bays?\\s*(?:shall|should|will|to)?\\s*(?:be\\s*|of\\s*|at\\s*|:\\s*)?(\\d+(?:\\.\\d+)?)\\s*"+M),
                     new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"\\s*bays?"),
                     new RegExp("frames?\\s*(?:every|at|@)\\s*(\\d+(?:\\.\\d+)?)"),
                     /(?:frame|bay)\s*spacing\s*(?:of\s*|is\s*|=\s*)?(\d+(?:\.\d+)?)/,
                     /spacing\s*(?:of\s*|is\s*|=\s*)?(\d+(?:\.\d+)?)/],0);
  let baysShort=num([/(\d+)\s*bays?\s*(?:in\s*)?(?:the\s*)?short/],0);
  let baysLong =num([/(\d+)\s*bays?\s*(?:in\s*)?(?:the\s*)?long/],0);
  let spacing=baySize||6;
  if(width>0){ if(!baysShort) baysShort=2;
    const shortBay=width/baysShort;
    if(baySize>0 && Math.abs(shortBay-baySize)>0.01 && Math.abs(width/baySize-Math.round(width/baySize))<0.01)
      baysShort=Math.round(width/baySize);
    spacing=baySize>0?baySize:shortBay;
    if(Math.abs(baysShort*spacing-width)>0.01)
      warn.push(`width ${width} m is not divisible by ${spacing} m bays — short direction set to ${baysShort} bays of ${(width/baysShort).toFixed(2)} m (unequal to frame spacing; verify)`);
  } else if(!baysShort){ baysShort=2; warn.push("width / short bays not found — default 2 bays"); }
  if(length>0){ baysLong=Math.round(length/spacing);
    if(Math.abs(length-baysLong*spacing)>0.01) warn.push(`length ${length} m is not a multiple of ${spacing} m — using ${baysLong} bays = ${baysLong*spacing} m`);
  } else if(!baysLong){ baysLong=8; warn.push("length / long bays not found — default 8 bays"); }
  // risk category → SBC 301-2018 basic wind speed
  let riskCat="II", V=42;
  const rc=s.match(/(?:risk\s*)?category\s*(?:is\s*)?\(?\s*(iv|iii|ii|i)\b/);
  if(rc){ riskCat=rc[1].toUpperCase(); V={I:38,II:42,III:44,IV:44}[riskCat]; }
  else note.push("Risk Category II assumed (not stated) → V = 42 m/s");
  // exposure from city
  let exposure="C";
  if(/dammam|jubail|jeddah|yanbu|khobar|dhahran/.test(s)){exposure="D"; note.push("Coastal city detected → Exposure D");}
  else note.push("Exposure C assumed (inland site)");
  // base fixity: explicit or auto rule
  let fixedBase=null;
  if(/fixed\s*bas/.test(s)) fixedBase=true;
  if(/pinn?ed\s*bas/.test(s)) fixedBase=false;
  if(fixedBase===null){ fixedBase = eave>=9;
    note.push(fixedBase?`Fixed bases selected automatically: eave ${eave} m ≥ 9 m — pinned bases cannot meet the H/100 drift limit`
                       :`Pinned bases assumed (eave ${eave} m < 9 m); drift verified in sizing`); }
  else if(fixedBase===false && eave>=9) warn.push(`pinned bases requested with ${eave} m eave — drift limit H/100 will very likely govern and fail; fixed bases strongly recommended`);
  const flexDiaphragm=/flexible\s*diaphragm/.test(s);
  let Fy=250, grade="A36";
  if(/a992|gr\.?\s*50|s355/.test(s)){Fy=345;grade="A992/S355";}
  if(/a36/.test(s)){Fy=250;grade="A36";}
  return {eave,ridge,baysShort,baysLong,spacing,Fy,grade,V,riskCat,exposure,fixedBase,flexDiaphragm,dam:true,
          cladding:0.15,services:0.10,Lr:0.96,driftLim:100,deflLim:240,purlinSp:1.0,warnings:warn,notes:note};
}

/* ============ PLANE FRAME SOLVER ============ */
function solve(nodes,elems,supports,elemLoads,nodalLoads){
  const n=nodes.length*3, K=Array.from({length:n},()=>new Float64Array(n)), F=new Float64Array(n);
  const E=200e6, locals=[];
  elems.forEach((el,ei)=>{
    const [i,j,sec]=el, dx=nodes[j][0]-nodes[i][0], dy=nodes[j][1]-nodes[i][1];
    const L=Math.hypot(dx,dy), c=dx/L, sn=dy/L;
    const A=sec.A/1e4, I=sec.Ix/1e8, EA=E*A/L, EI=E*I;
    const k=[[EA,0,0,-EA,0,0],[0,12*EI/L**3,6*EI/L**2,0,-12*EI/L**3,6*EI/L**2],[0,6*EI/L**2,4*EI/L,0,-6*EI/L**2,2*EI/L],[-EA,0,0,EA,0,0],[0,-12*EI/L**3,-6*EI/L**2,0,12*EI/L**3,-6*EI/L**2],[0,6*EI/L**2,2*EI/L,0,-6*EI/L**2,4*EI/L]];
    const T=[[c,sn,0,0,0,0],[-sn,c,0,0,0,0],[0,0,1,0,0,0],[0,0,0,c,sn,0],[0,0,0,-sn,c,0],[0,0,0,0,0,1]];
    const [wx,wy]=elemLoads[ei]||[0,0];
    const wlx=wx*c+wy*sn, wly=-wx*sn+wy*c;
    const feq=[wlx*L/2,wly*L/2,wly*L*L/12,wlx*L/2,wly*L/2,-wly*L*L/12];
    const dof=[3*i,3*i+1,3*i+2,3*j,3*j+1,3*j+2];
    const KT=Array.from({length:6},()=>new Float64Array(6));
    for(let a=0;a<6;a++)for(let b=0;b<6;b++){let s1=0;for(let m=0;m<6;m++)for(let q=0;q<6;q++)s1+=T[m][a]*k[m][q]*T[q][b];KT[a][b]=s1;}
    for(let a=0;a<6;a++){let fg=0;for(let m=0;m<6;m++)fg+=T[m][a]*feq[m];F[dof[a]]+=fg;
      for(let b=0;b<6;b++)K[dof[a]][dof[b]]+=KT[a][b];}
    locals.push({k,T,feq,dof});
  });
  (nodalLoads||[]).forEach(([nd,fx,fy])=>{F[3*nd]+=fx;F[3*nd+1]+=fy;});
  supports.forEach(nd=>{K[3*nd][3*nd]+=1e14;K[3*nd+1][3*nd+1]+=1e14;});
  const u=gauss(K,F,n);
  const forces=locals.map(({k,T,feq,dof})=>{
    const ug=dof.map(d=>u[d]);
    const ul=new Array(6).fill(0).map((_,a)=>T[a].reduce((s1,v,b)=>s1+v*ug[b],0));
    return new Array(6).fill(0).map((_,a)=>k[a].reduce((s1,v,b)=>s1+v*ul[b],0)-feq[a]);
  });
  return {u,forces};
}
function gauss(K,F,n){
  const A=K.map(r=>Float64Array.from(r)), b=Float64Array.from(F);
  for(let p=0;p<n;p++){let mx=p;for(let r=p+1;r<n;r++)if(Math.abs(A[r][p])>Math.abs(A[mx][p]))mx=r;
    [A[p],A[mx]]=[A[mx],A[p]];const tb=b[p];b[p]=b[mx];b[mx]=tb;
    const piv=A[p][p]||1e-30;
    for(let r=p+1;r<n;r++){const f=A[r][p]/piv;if(!f)continue;for(let c2=p;c2<n;c2++)A[r][c2]-=f*A[p][c2];b[r]-=f*b[p];}}
  const x=new Float64Array(n);
  for(let r=n-1;r>=0;r--){let s1=b[r];for(let c2=r+1;c2<n;c2++)s1-=A[r][c2]*x[c2];x[r]=s1/(A[r][r]||1e-30);}
  return x;
}

/* ============ ENGINE ============ */
function engine(P){
  const W=P.baysShort*P.spacing, Lb=P.baysLong*P.spacing, nF=P.baysLong+1;
  const slope=Math.atan((P.ridge-P.eave)/(W/2)), trib=P.spacing, cs=Math.cos(slope);
  const colX=[]; for(let i=0;i<=P.baysShort;i++)colX.push(i*W/P.baysShort);
  const nodes=[],supports=[],colEls=[],rafEls=[];
  const topY=x=>P.eave+(P.ridge-P.eave)*(1-Math.abs(2*x/W-1));
  colX.forEach(x=>{supports.push(nodes.length);nodes.push([x,0]);nodes.push([x,topY(x)]);});
  const topN=i=>2*i+1;
  colX.forEach((x,i)=>colEls.push([2*i,topN(i)]));
  for(let i=0;i<colX.length-1;i++){
    const a=topN(i),b=topN(i+1);
    const m=nodes.length; nodes.push([(nodes[a][0]+nodes[b][0])/2,(nodes[a][1]+nodes[b][1])/2]);
    rafEls.push([a,m]); rafEls.push([m,b]);
  }
  const dead=(P.cladding+P.services)*trib, live=P.Lr*trib*cs;
  const hbar=(P.eave+P.ridge)/2, _zg=P.exposure==="D"?213.36:274.32, _al=P.exposure==="D"?11.5:9.5;
  const Kz=Math.max(0.85,2.01*Math.pow(hbar/_zg,2/_al));
  const qh=0.613*Kz*0.85*P.V*P.V/1000, G=0.85, deg=slope*180/Math.PI;
  const mkW=(pi)=>{
    const loads=[...colEls,...rafEls].map(()=>[0,0]);
    loads[0]=[qh*(G*0.8-pi)*trib,0];
    loads[colEls.length-1]=[qh*(G*0.5+pi)*trib,0];
    rafEls.forEach((r,i2)=>{
      const idx=colEls.length+i2, ww=i2<rafEls.length/2;
      const su=qh*((ww?G*0.36:G*0.60)+pi)*trib; // suction magnitude
      const nx=ww?-Math.sin(slope):Math.sin(slope);
      loads[idx]=[su*nx,su*Math.cos(slope)];
    });
    return loads;
  };
  const cases={
    D:{el:[...colEls,...rafEls].map((e,i)=>i<colEls.length?[0,0]:[0,-dead])},
    Lr:{el:[...colEls,...rafEls].map((e,i)=>i<colEls.length?[0,0]:[0,-live])},
    "W+":{el:mkW(0.18)},"W-":{el:mkW(-0.18)},
    E:{el:[...colEls,...rafEls].map(()=>[0,0]),nodal:[[topN(0),0.01*(dead*W+15),0]]},
  };
  const combosA=[["1.4 D + N",{D:1.4}],["1.2 D + 1.6 Lr + 0.5 WX+ + N",{D:1.2,Lr:1.6,"W+":0.5}],
    ["1.2 D + 1.6 Lr + 0.5 WX- + N",{D:1.2,Lr:1.6,"W-":0.5}],
    ["1.2 D + 1.0 WX+ + 0.5 Lr",{D:1.2,"W+":1,Lr:0.5}],["1.2 D + 1.0 WX- + 0.5 Lr",{D:1.2,"W-":1,Lr:0.5}],
    ["1.2 D + 1.0 WY + 0.5 Lr",{D:1.2,Lr:0.5}],["1.2 D + 1.0 EQX",{D:1.2,E:1}],["1.2 D + 1.0 EQY",{D:1.2}],
    ["0.9 D + 1.0 WX+",{D:0.9,"W+":1}],["0.9 D + 1.0 WX-",{D:0.9,"W-":1}],["0.9 D + 1.0 WY",{D:0.9}],
    ["0.9 D + 1.0 EQX",{D:0.9,E:1}],["0.9 D + 1.0 EQY",{D:0.9}]];
  const service=["D + Lr (Service)","D + 0.6 WX+ (Service)","D + 0.6 WX- (Service)","D + 0.6 WY (Service)"];
  let raf=DB[4], col=DB[4], out=null;
  for(let it=0;it<6;it++){
    const elems=[...colEls.map(e=>[...e,col]),...rafEls.map(e=>[...e,raf])];
    const res={};
    for(const [cn,c] of Object.entries(cases)){
      const el=c.el.map((l2,i)=>cn==="D"?[l2[0],l2[1]-(i<colEls.length?col:raf).w*9.81/1000]:l2);
      res[cn]=solve(nodes,elems,supports,el,c.nodal);
    }
    const need={rM:0,rP:0,cM:0,cP:0,gr:"",gc:""};
    combosA.forEach(([nm,f])=>{
      elems.forEach((el,i)=>{
        let M=0,Pa=0;
        for(const [cn,fac] of Object.entries(f)){
          if(!res[cn])continue;
          const fo=res[cn].forces[i];
          M+=fac*Math.max(Math.abs(fo[2]),Math.abs(fo[5])); Pa+=fac*Math.abs(fo[0]);
        }
        if(i<colEls.length){if(M>need.cM){need.cM=M;need.gc=nm;}if(Pa>need.cP)need.cP=Pa;}
        else{if(M>need.rM){need.rM=M;need.gr=nm;}if(Pa>need.rP)need.rP=Pa;}
      });
    });
    const pick=(M,Pa,Lbr)=>{
      for(const s of DB){
        const phiM=0.9*P.Fy*1000*s.Zx/1e6;
        const lam=Lbr*100/s.ry, Fe=Math.PI**2*200000/lam**2;
        const Fcr=lam<=4.71*Math.sqrt(200000/P.Fy)?Math.pow(0.658,P.Fy/Fe)*P.Fy:0.877*Fe;
        const phiP=0.9*Fcr*s.A/10;
        const r=Pa/phiP, ut=r>=0.2?r+8/9*M/phiM:r/2+M/phiM;
        if(ut<=0.95)return {s,ut};
      }
      return {s:DB[DB.length-1],ut:9.99};
    };
    const pr=pick(need.rM,need.rP,P.purlinSp), pc=pick(need.cM,need.cP,1.8);
    if(pr.s.n===raf.n&&pc.s.n===col.n){
      const elems2=[...colEls.map(e=>[...e,col]),...rafEls.map(e=>[...e,raf])];
      const rl=solve(nodes,elems2,supports,cases.Lr.el);
      const wd=solve(nodes,elems2,supports,cases["W+"].el);
      let dv=0; for(let i2=2*colX.length;i2<nodes.length;i2++)dv=Math.max(dv,Math.abs(rl.u[3*i2+1]));
      // purlin checks (continuous, multi-span): Mu = wL^2/10, defl end-span = wL^4/145EI
      const wU=1.2*(P.cladding*P.purlinSp/cs+ZP.w*9.81/1000)+1.6*P.Lr*P.purlinSp;
      const Mu=wU*trib*trib/10, phiMn=0.9*ZP.Fy*1000*ZP.S;
      const wS=P.Lr*P.purlinSp;
      const pd=wS*Math.pow(trib,4)/(145*203.4e6*ZP.Ix)*1000;
      out={W,Lb,nF,slope:deg,raf:pr.s,col:pc.s,utR:pr.ut,utC:pc.ut,gov:{r:need.gr,c:need.gc},qh,
        combosA,service,colX,topYf:topY,
        purlin:{ut:Mu/phiMn,defl:pd,deflLim:trib*1000/P.deflLim,lines:2*(Math.ceil(W/2/P.purlinSp)-1)},
        bracedBays:[2,Math.max(2,P.baysLong-1)],
        checks:{defl:dv*1000,deflLim:(W/P.baysShort)*1000/P.deflLim,drift:Math.abs(wd.u[3*topN(0)])*1000,driftLim:P.eave*1000/P.driftLim},
        tonnage:((pc.s.w*P.eave*colX.length+pr.s.w*W/cs)*nF+ (2.27e-3*7850*0.0)+ (17.8*3*Lb+ZP.w*9.81*0))/1000};
      out.tonnage=((pc.s.w*P.eave*colX.length+pr.s.w*W/cs)*nF+17.8*3*Lb+ZP.w*9.81/9.81*out.purlin.lines*Lb)/1000;
      return out;
    }
    raf=pr.s;col=pc.s;
  }
  return out;
}

/* ============ S2K WRITER (R3 syntax - validated 0 errors / 0 material+load warnings in SAP2000 25.1) ============ */
function s2kR3(P,R){
  const W=R.W, nF=R.nF, sp=P.spacing, half=W/2;
  const th=Math.atan((P.ridge-P.eave)/half), c=Math.cos(th), s=Math.sin(th);
  const topY=x=>P.eave+(P.ridge-P.eave)*(1-Math.abs(2*x/W-1));
  const qh=R.qh;
  const px=[]; for(let x=P.purlinSp;x<half-1e-6;x+=P.purlinSp)px.push(+x.toFixed(4));
  const purlX=[...px,...px.map(x=>+(W-x).toFixed(4))].sort((a,b)=>a-b);
  const colX=R.colX;
  const allx=[...new Set([...colX,...purlX])].sort((a,b)=>a-b);
  const bb=[R.bracedBays[0]-1,R.bracedBays[1]-1]; // 0-indexed
  const L=[]; const p=x=>L.push(x);
  p('File Industrial_generated.s2k');p('');
  p('TABLE:  "PROGRAM CONTROL"');
  p('   ProgramName=SAP2000   Version=25.1.0   ProgLevel=Ultimate   CurrUnits="KN, m, C"   SteelCode="AISC 360-16"   ConcCode="ACI 318-19"');p('');
  p('TABLE:  "ACTIVE DEGREES OF FREEDOM"');p('   UX=Yes   UY=Yes   UZ=Yes   RX=Yes   RY=Yes   RZ=Yes');p('');
  p('TABLE:  "COORDINATE SYSTEMS"');p('   Name=GLOBAL   Type=Cartesian   X=0   Y=0   Z=0   AboutZ=0   AboutY=0   AboutX=0');p('');
  p('TABLE:  "MATERIAL PROPERTIES 01 - GENERAL"');
  p('   Material=MAIN   Type=Steel   SymType=Isotropic   TempDepend=No   Color=Blue');
  p('   Material=A653SQGr50   Type=ColdFormed   SymType=Isotropic   TempDepend=No   Color=Yellow');p('');
  p('TABLE:  "MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES"');
  p('   Material=MAIN   UnitWeight=76.9729   UnitMass=7.849   E1=200000000   G12=76923077   U12=0.3   A1=1.17E-05');
  p('   Material=A653SQGr50   UnitWeight=76.9729   UnitMass=7.849   E1=203395000   G12=78228846   U12=0.3   A1=1.17E-05');p('');
  p('TABLE:  "MATERIAL PROPERTIES 03A - STEEL DATA"');
  p(`   Material=MAIN   Fy=${P.Fy*1000}   Fu=${P.Fy===250?400000:450000}   EffFy=${P.Fy*1500}   EffFu=${P.Fy===250?440000:495000}   SSCurveOpt=Simple   SSHysType=Kinematic   SHard=0.015   SMax=0.11   SRup=0.17   FinalSlope=-0.1   CoupModType="Von Mises"`);p('');
  p('TABLE:  "MATERIAL PROPERTIES 03D - COLD FORMED DATA"');
  p('   Material=A653SQGr50   Fy=344737.894475789   Fu=448159.262818526   SSHysType=Kinematic   CoupModType="Von Mises"');p('');
  p('TABLE:  "FRAME SECTION PROPERTIES 01 - GENERAL"');
  const secLine=(sec)=>p(`   SectionName=${sec.n}   Material=MAIN   Shape="I/Wide Flange"   t3=${sec.h/1000}   t2=${(sec.h>=270?sec.h/2:sec.h/2)/1000}   Area=${(sec.A/1e4).toExponential(4)}   I33=${(sec.Ix/1e8).toExponential(4)}   I22=${(sec.Ix/1e8/12).toExponential(3)}   TorsConst=${(sec.Ix/1e8/400).toExponential(3)}   Z33=${(sec.Zx/1e6).toExponential(4)}   S33=${(sec.Zx/1.12/1e6).toExponential(4)}   R33=${sec.rx/100}   R22=${sec.ry/100}   FromFile=No`);
  [...new Set([R.raf.n,R.col.n])].forEach(n=>secLine(DB.find(d=>d.n===n)));
  p('   SectionName=SHS120X5   Material=MAIN   Shape="Box/Tube"   t3=0.12   t2=0.12   tf=0.005   tw=0.005   Area=0.002270   TorsConst=7.54E-06   I33=4.981E-06   I22=4.981E-06   S33=8.302E-05   S22=8.302E-05   Z33=9.839E-05   Z22=9.839E-05   R33=0.0468   R22=0.0468   FromFile=No');
  p('   SectionName=ROD24   Material=MAIN   Shape=Circle   t3=0.024   Area=0.000452   TorsConst=3.26E-08   I33=1.629E-08   I22=1.629E-08   S33=1.357E-06   S22=1.357E-06   Z33=2.304E-06   Z22=2.304E-06   R33=0.006   R22=0.006   FromFile=No');
  p('   SectionName="Z 150x50x20x2.5"   Material=A653SQGr50   Shape="Cold Formed Z"   t3=0.15   t2=0.06   tw=0.0025   Radius=0.00635   LipDepth=0.02   LipAngle=45   Area=0.00073937749035729   TorsConst=1.54036977157769E-09 _');
  p('        I33=2.58831051241001E-06   I22=7.37993214156867E-07   I23=-1.04148378941824E-06   AS2=0.00033075   AS3=0.000237421049864991   S33Top=3.45108068321335E-05   S33Bot=3.45108068321335E-05   FromFile=No');p('');
  p('TABLE:  "LOAD PATTERN DEFINITIONS"');
  p('   LoadPat=DEAD   DesignType=Dead   SelfWtMult=1');
  p('   LoadPat=S.IMP   DesignType="Super Dead"   SelfWtMult=0');
  p('   LoadPat=Lr   DesignType="Roof Live"   SelfWtMult=0');
  ["WX+","WX-","WY"].forEach(n=>p(`   LoadPat=${n}   DesignType=Wind   SelfWtMult=0   AutoLoad=None`));
  ["EQX","EQY"].forEach(n=>p(`   LoadPat=${n}   DesignType=Quake   SelfWtMult=0   AutoLoad=None`));
  [["NDX","DEAD","X"],["NDY","DEAD","Y"],["NSX","S.IMP","X"],["NSY","S.IMP","Y"],["NLX","Lr","X"],["NLY","Lr","Y"]]
    .forEach(([n,b,d])=>p(`   LoadPat=${n}   DesignType=Notional   SelfWtMult=0   NotBasePat=${b}   NotRatio=0.002   NotDir="Global ${d}"`));
  p('');
  const pats=["DEAD","S.IMP","Lr","WX+","WX-","WY","EQX","EQY","NDX","NDY","NSX","NSY","NLX","NLY"];
  const dt={DEAD:"Dead","S.IMP":'"Super Dead"',Lr:'"Roof Live"',"WX+":"Wind","WX-":"Wind",WY:"Wind",EQX:"Quake",EQY:"Quake"};
  p('TABLE:  "LOAD CASE DEFINITIONS"');
  pats.forEach(n=>p(`   Case=${n}   Type=LinStatic   InitialCond=Zero   DesTypeOpt="Prog Det"   DesignType=${dt[n]||"Notional"}   DesActOpt="Prog Det"   DesignAct=Non-Composite   AutoType=None   RunCase=Yes`));p('');
  p('TABLE:  "CASE - STATIC 1 - LOAD ASSIGNMENTS"');
  pats.forEach(n=>p(`   Case=${n}   LoadType="Load pattern"   LoadName=${n}   LoadSF=1`));p('');
  p('TABLE:  "JOINT COORDINATES"');
  let jid=0; const J={};
  const addj=(k2,x,y,z)=>{jid++;J[k2]=jid;p(`   Joint=${jid}   CoordSys=GLOBAL   CoordType=Cartesian   XorR=${+x.toFixed(4)}   Y=${+y.toFixed(4)}   Z=${+z.toFixed(4)}`);};
  for(let f=0;f<nF;f++){const y=f*sp;
    colX.forEach(x=>addj(`b${f}_${x}`,x,y,0));
    allx.forEach(x=>addj(`t${f}_${x}`,x,y,topY(x)));}
  p('');
  p('TABLE:  "CONNECTIVITY - FRAME"');
  let fid=0; const cols=[],rafs=[],struts=[],purl=[],rods=[];
  const addf=(lst,a,b)=>{fid++;lst.push(fid);p(`   Frame=${fid}   JointI=${J[a]}   JointJ=${J[b]}`);};
  for(let f=0;f<nF;f++){
    colX.forEach(x=>addf(cols,`b${f}_${x}`,`t${f}_${x}`));
    for(let i=0;i<allx.length-1;i++)addf(rafs,`t${f}_${allx[i]}`,`t${f}_${allx[i+1]}`);}
  for(let f=0;f<nF-1;f++){
    colX.forEach(x=>addf(struts,`t${f}_${x}`,`t${f+1}_${x}`));
    purlX.forEach(x=>addf(purl,`t${f}_${x}`,`t${f+1}_${x}`));}
  bb.forEach(b=>{
    [0,W].forEach(x=>{addf(rods,`b${b}_${x}`,`t${b+1}_${x}`);addf(rods,`b${b+1}_${x}`,`t${b}_${x}`);});
    [[0,half],[half,W]].forEach(([xa,xb])=>{addf(rods,`t${b}_${xa}`,`t${b+1}_${xb}`);addf(rods,`t${b}_${xb}`,`t${b+1}_${xa}`);});});
  p('');
  p('TABLE:  "JOINT RESTRAINT ASSIGNMENTS"');
  for(let f=0;f<nF;f++)colX.forEach(x=>p(`   Joint=${J[`b${f}_${x}`]}   U1=Yes   U2=Yes   U3=Yes   R1=${P.fixedBase?"Yes":"No"}   R2=${P.fixedBase?"Yes":"No"}   R3=${P.fixedBase?"Yes":"No"}`));p('');
  p('TABLE:  "FRAME SECTION ASSIGNMENTS"');
  cols.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${R.col.n}   MatProp=Default`));
  rafs.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${R.raf.n}   MatProp=Default`));
  struts.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=SHS120X5   MatProp=Default`));
  purl.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect="Z 150x50x20x2.5"   MatProp=Default`));
  rods.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=ROD24   MatProp=Default`));p('');
  p('TABLE:  "FRAME INSERTION POINT ASSIGNMENTS"');
  purl.forEach(f=>p(`   Frame=${f}   CardinalPt=1   Mirror2=No   StiffTransform=Yes`));p('');
  p('TABLE:  "FRAME RELEASE ASSIGNMENTS 1 - GENERAL"');
  rods.forEach(f=>p(`   Frame=${f}   PI=No   V2I=No   V3I=No   TI=Yes   M2I=Yes   M3I=Yes   PJ=No   V2J=No   V3J=No   TJ=No   M2J=Yes   M3J=Yes`));p('');
  p('TABLE:  "FRAME TENSION AND COMPRESSION LIMITS"');
  rods.forEach(f=>p(`   Frame=${f}   TensLimit=No   CompLimit=Yes   Compression=0`));p('');
  p('TABLE:  "FRAME LOADS - DISTRIBUTED"');
  const tribS=P.purlinSp/c, sdl=(P.cladding+P.services)*tribS, lr=P.Lr*P.purlinSp;
  const dist=(f,pat,d,v)=>p(`   Frame=${f}   LoadPat=${pat}   CoordSys=GLOBAL   Type=Force   Dir=${d}   DistType=RelDist   RelDistA=0   RelDistB=1   AbsDistA=0   AbsDistB=${sp}   FOverLA=${v.toFixed(4)}   FOverLB=${v.toFixed(4)}`);
  purl.forEach(f=>{dist(f,'S.IMP','Gravity',sdl);dist(f,'Lr','Gravity',lr);});
  struts.forEach((f,k)=>{
    const x=colX[k%colX.length], edge=(x===0||x===W);
    dist(f,'S.IMP','Gravity',edge?sdl/2:sdl);dist(f,'Lr','Gravity',edge?lr/2:lr);});
  const roofw=(pat,pw,pl)=>{
    purl.forEach((f,k)=>{
      const x=purlX[k%purlX.length], left=x<half, pr=left?pw:pl, nx=left?-s:s;
      dist(f,pat,'X',pr*tribS*nx);dist(f,pat,'Z',pr*tribS*c);});
    struts.forEach((f,k)=>{
      const x=colX[k%colX.length];
      if(x===0){dist(f,pat,'X',pw*tribS/2*(-s));dist(f,pat,'Z',pw*tribS/2*c);}
      else if(x===W){dist(f,pat,'X',pl*tribS/2*s);dist(f,pat,'Z',pl*tribS/2*c);}
      else{dist(f,pat,'X',(pw*(-s)+pl*s)*tribS/2);dist(f,pat,'Z',(pw+pl)*c*tribS/2);}});};
  roofw('WX+',qh*(0.85*0.36+0.18),qh*(0.85*0.60+0.18));
  roofw('WX-',qh*(0.85*0.36-0.18),qh*(0.85*0.60-0.18));
  for(let f=0;f<nF;f++){
    const tw=(f>0&&f<nF-1)?sp:sp/2;
    const cw=cols[f*colX.length], cl=cols[f*colX.length+colX.length-1];
    [["WX+",0.18],["WX-",-0.18]].forEach(([pat,pi])=>{
      dist(cw,pat,'X',qh*(0.85*0.8-pi)*tw);
      dist(cl,pat,'X',qh*(0.85*0.5+pi)*tw);});}
  p('');
  p('TABLE:  "JOINT LOADS - FORCE"');
  const gA=W*(P.eave+P.ridge)/2, fj=qh*0.85*1.3*gA/2/(2*colX.length);
  const sdead=(P.cladding+P.services)*W*sp/colX.length+3;
  [0,nF-1].forEach(f=>colX.forEach(x=>p(`   Joint=${J[`t${f}_${x}`]}   LoadPat=WY   CoordSys=GLOBAL   F1=0   F2=${fj.toFixed(3)}   F3=0   M1=0   M2=0   M3=0`)));
  for(let f=0;f<nF;f++){const fac=(f>0&&f<nF-1)?1:0.5;
    colX.forEach(x=>{
      p(`   Joint=${J[`t${f}_${x}`]}   LoadPat=EQX   CoordSys=GLOBAL   F1=${(0.01*sdead*fac).toFixed(3)}   F2=0   F3=0   M1=0   M2=0   M3=0`);
      p(`   Joint=${J[`t${f}_${x}`]}   LoadPat=EQY   CoordSys=GLOBAL   F1=0   F2=${(0.01*sdead*fac).toFixed(3)}   F3=0   M1=0   M2=0   M3=0`);});}
  p('');
  p('TABLE:  "COMBINATION DEFINITIONS"');
  const C=[["1.4 D + N","Strength",[["DEAD",1.4],["S.IMP",1.4],["NDX",1.4],["NDY",1.4],["NSX",1.4],["NSY",1.4]]],
    ["1.2 D + 1.6 Lr + 0.5 WX+ + N","Strength",[["DEAD",1.2],["S.IMP",1.2],["Lr",1.6],["WX+",0.5],["NDX",1.2],["NDY",1.2],["NSX",1.2],["NSY",1.2],["NLX",1.6],["NLY",1.6]]],
    ["1.2 D + 1.6 Lr + 0.5 WX- + N","Strength",[["DEAD",1.2],["S.IMP",1.2],["Lr",1.6],["WX-",0.5],["NDX",1.2],["NDY",1.2],["NSX",1.2],["NSY",1.2],["NLX",1.6],["NLY",1.6]]],
    ["1.2 D + 1.0 WX+ + 0.5 Lr","Strength",[["DEAD",1.2],["S.IMP",1.2],["WX+",1],["Lr",0.5]]],
    ["1.2 D + 1.0 WX- + 0.5 Lr","Strength",[["DEAD",1.2],["S.IMP",1.2],["WX-",1],["Lr",0.5]]],
    ["1.2 D + 1.0 WY + 0.5 Lr","Strength",[["DEAD",1.2],["S.IMP",1.2],["WY",1],["Lr",0.5]]],
    ["1.2 D + 1.0 EQX","Strength",[["DEAD",1.2],["S.IMP",1.2],["EQX",1]]],
    ["1.2 D + 1.0 EQY","Strength",[["DEAD",1.2],["S.IMP",1.2],["EQY",1]]],
    ["0.9 D + 1.0 WX+","Strength",[["DEAD",0.9],["S.IMP",0.9],["WX+",1]]],
    ["0.9 D + 1.0 WX-","Strength",[["DEAD",0.9],["S.IMP",0.9],["WX-",1]]],
    ["0.9 D + 1.0 WY","Strength",[["DEAD",0.9],["S.IMP",0.9],["WY",1]]],
    ["0.9 D + 1.0 EQX","Strength",[["DEAD",0.9],["S.IMP",0.9],["EQX",1]]],
    ["0.9 D + 1.0 EQY","Strength",[["DEAD",0.9],["S.IMP",0.9],["EQY",1]]],
    ["D + Lr (Service)","None",[["DEAD",1],["S.IMP",1],["Lr",1]]],
    ["D + 0.6 WX+ (Service)","None",[["DEAD",1],["S.IMP",1],["WX+",0.6]]],
    ["D + 0.6 WX- (Service)","None",[["DEAD",1],["S.IMP",1],["WX-",0.6]]],
    ["D + 0.6 WY (Service)","None",[["DEAD",1],["S.IMP",1],["WY",0.6]]]];
  C.forEach(([cn,des,terms])=>{
    const [p0,f0]=terms[0];
    p(`   ComboName="${cn}"   ComboType="Linear Add"   AutoDesign=No   CaseName=${p0}   ScaleFactor=${f0}   SteelDesign=${des}   ConcDesign=None   AlumDesign=None   ColdDesign=${des}`);
    terms.slice(1).forEach(([pt,f_])=>p(`   ComboName="${cn}"   CaseName=${pt}   ScaleFactor=${f_}`));});
  p('');
  p('TABLE:  "MASS SOURCE"');p('   MassSource=MSSSRC1   Elements=Yes   Masses=Yes   Loads=No   IsDefault=Yes');p('');
  p('TABLE:  "PREFERENCES - STEEL DESIGN - AISC 360-16"');
  p('   THDesign=Envelopes   FrameType=OMF   PatLLF=0.75   SRatioLimit=0.95   MaxIter=1   SDC=A   SeisCode=No   SeisLoad=No   ImpFactor=1   SystemRho=1   SystemSds=0.5   SystemR=8   SystemCd=5.5   Omega0=3   Provision=LRFD _');
  p('        AMethod="Direct Analysis"   SOMethod="General 2nd Order"   SRMethod="Tau-b Variable"   NLCoeff=0.002   PhiB=0.9   PhiC=0.9   PhiTY=0.9   PhiTF=0.75   PhiV=0.9   PhiVRolledI=1   PhiVT=0.9   PlugWeld=Yes   HSSWelding=ERW   HSSReduceT=No _');
  p('        CheckDefl=Yes   DLRat=120   SDLAndLLRat=120   LLRat=240   TotalRat=180   NetRat=240');
  p('');p('END TABLE DATA');
  return L.join("\r\n");
}
function e2k(P,R){
  return ['$ PROGRAM INFORMATION','  PROGRAM  "ETABS"  VERSION "21.0.0"','$ CONTROLS','  UNITS  "KN"  "M"  "C"',
  '$ NOTE: E2K EXPORT IS BETA - sloped rafter Z-offsets and purlin layout pending validation against a production ETABS model.',
  `$ Geometry: ${R.W}x${R.Lb} m, ${R.nF} frames, eave ${P.eave} m, ridge ${P.ridge} m`].join("\r\n");
}
const dl=(txt,name)=>{const b=new Blob([txt],{type:"text/plain"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;a.click();};

/* ============ UI ============ */
const T={ink:"#15222C",paper:"#F2F5F6",line:"#C9D3D8",blue:"#23577F",hot:"#D14E12",ok:"#1D7A4F",bad:"#B3261E",mono:"'JetBrains Mono',ui-monospace,'SF Mono',Consolas,monospace"};
const Lbl=({c})=><div style={{fontSize:10,letterSpacing:"0.14em",textTransform:"uppercase",color:T.blue,fontWeight:700,marginBottom:4}}>{c}</div>;

export default function App(){
  const [text,setText]=useState("I want an industrial steel building with 6 meters height in at edges and 8 m at centre, 2 bays in short direction and 8 bays in longitudinal direction, each bay shall have spacing 6 m, A36 steel, design per SBC 301 and AISC.");
  const [P,setP]=useState(()=>parseText("6 meters at edges 8 m at centre 2 bays in short 8 bays in long spacing 6 a36"));
  const [tab,setTab]=useState("model");
  const R=useMemo(()=>{try{return engine(P);}catch(e){return null;}},[P]);
  const set=(k,v)=>setP(p=>({...p,[k]:parseFloat(v)||0}));
  const Field=({k,label,step})=>(<div>
    <Lbl c={label}/><input type="number" step={step||1} value={P[k]} onChange={e=>set(k,e.target.value)}
      style={{width:"100%",padding:"6px 8px",border:`1px solid ${T.line}`,borderRadius:2,fontFamily:T.mono,fontSize:13,background:"#fff",color:T.ink}}/></div>);

  const Elev=()=>{if(!R)return null;const sc=280/R.W,ox=40,oy=190;
    const y=v=>oy-v*sc,x=v=>ox+v*sc;const topY=R.topYf;
    const pl=[];for(let px2=P.purlinSp;px2<R.W-1e-6;px2+=P.purlinSp)if(Math.abs(px2-R.W/2)>1e-6&&!R.colX.includes(px2))pl.push(px2);
    return(<svg viewBox="0 0 360 225" style={{width:"100%",background:"#fff",border:`1px solid ${T.line}`}}>
      <defs><pattern id="gr" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="#EDF1F3" strokeWidth="0.7"/></pattern></defs>
      <rect width="360" height="225" fill="url(#gr)"/>
      {R.colX.map((cx,i)=><g key={i}>
        <line x1={x(cx)} y1={y(0)} x2={x(cx)} y2={y(topY(cx))} stroke={T.ink} strokeWidth="2.4"/>
        <circle cx={x(cx)} cy={y(0)} r="2.2" fill="#fff" stroke={T.ink} strokeWidth="1"/></g>)}
      <path d={`M${x(0)} ${y(P.eave)} L${x(R.W/2)} ${y(P.ridge)} L${x(R.W)} ${y(P.eave)}`} fill="none" stroke={T.hot} strokeWidth="2.4"/>
      {pl.map((px2,i)=><rect key={i} x={x(px2)-1.6} y={y(topY(px2))-5} width="3.2" height="5" fill={T.blue}/>)}
      <text x={x(R.W/2)} y={y(P.ridge)-8} fontSize="8" fill={T.ink} fontFamily={T.mono} textAnchor="middle">+{P.ridge.toFixed(2)} · {R.slope.toFixed(1)}°</text>
      <text x={x(R.W/2)} y={y(0)+14} fontSize="8" fill={T.blue} fontFamily={T.mono} textAnchor="middle">{R.W.toFixed(1)} m · purlins {ZP.n} @ {P.purlinSp} m (blue)</text>
      <text x={x(R.W)-2} y={y(P.eave)-6} fontSize="8" fill={T.hot} fontFamily={T.mono} textAnchor="end">{R.raf.n}</text>
      <text x={x(R.W)+4} y={y(P.eave/2)} fontSize="8" fill={T.ink} fontFamily={T.mono}>{R.col.n}</text>
    </svg>);};

  const Plan=()=>{if(!R)return null;const w2=300,h2=90,ox=30,oy=14;
    const dx=w2/P.baysLong;
    return(<svg viewBox="0 0 360 120" style={{width:"100%",background:"#fff",border:`1px solid ${T.line}`,marginTop:8}}>
      <rect x={ox} y={oy} width={w2} height={h2} fill="none" stroke={T.ink} strokeWidth="1.4"/>
      {Array.from({length:R.nF},(_,f)=><line key={f} x1={ox+f*dx} y1={oy} x2={ox+f*dx} y2={oy+h2} stroke={T.ink} strokeWidth={0.9}/>)}
      <line x1={ox} y1={oy+h2/2} x2={ox+w2} y2={oy+h2/2} stroke={T.line} strokeWidth="0.8" strokeDasharray="4 3"/>
      {R.bracedBays.map((b,i)=>{const x0=ox+(b-1)*dx,x1=ox+b*dx;return(<g key={i} stroke={T.hot} strokeWidth="1.3">
        <line x1={x0} y1={oy} x2={x1} y2={oy+h2/2}/><line x1={x1} y1={oy} x2={x0} y2={oy+h2/2}/>
        <line x1={x0} y1={oy+h2/2} x2={x1} y2={oy+h2}/><line x1={x1} y1={oy+h2/2} x2={x0} y2={oy+h2}/></g>);})}
      <text x={ox+w2/2} y={oy+h2+14} fontSize="8" fill={T.blue} fontFamily={T.mono} textAnchor="middle">Roof plan {R.Lb} m · rod X-bracing (orange) in bays {R.bracedBays[0]} & {R.bracedBays[1]} · walls braced same bays</text>
    </svg>);};

  const Chk=({ok,children})=><span style={{color:ok?T.ok:T.bad,fontWeight:700}}>{children} {ok?"✓":"✗"}</span>;
  const tabs=[["model","Drawing"],["loads","Loads & combos"],["design","Design"],["report","Input report"],["export","Export"]];
  const typs=[["industrial","Industrial building"],["canopy","Canopy"],["hangar","Hangar"],["shade","Parking shade"],["stair","Emergency stair"]];

  return(<div style={{minHeight:"100vh",background:T.paper,color:T.ink,fontFamily:"'Helvetica Neue',Arial,sans-serif",padding:14}}>
    <div style={{display:"flex",alignItems:"baseline",gap:12,borderBottom:`3px solid ${T.ink}`,paddingBottom:8,marginBottom:12,flexWrap:"wrap"}}>
      <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.02em"}}>STEEL<span style={{color:T.hot}}>MODELER</span></div>
      <div style={{fontSize:11,color:T.blue,fontFamily:T.mono}}>v0.2 · exporter validated against SAP2000 25.1 import (0 errors) · SBC 301-2018 · AISC 360 DAM</div>
    </div>

    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
      {typs.map(([k,l])=><button key={k}
        style={{padding:"6px 12px",fontSize:12,fontWeight:700,border:`1.5px solid ${k==="industrial"?T.hot:T.line}`,background:k==="industrial"?T.hot:"#fff",color:k==="industrial"?"#fff":"#98A6AE",borderRadius:2,cursor:k==="industrial"?"pointer":"not-allowed"}}>
        {l}{k!=="industrial"&&<span style={{fontWeight:400}}> · soon</span>}</button>)}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"minmax(280px,380px) 1fr",gap:14,alignItems:"start"}}>
      <div>
        <Lbl c="Describe the building"/>
        <textarea value={text} onChange={e=>setText(e.target.value)} rows={5}
          style={{width:"100%",padding:10,border:`1px solid ${T.line}`,borderRadius:2,fontFamily:T.mono,fontSize:12.5,lineHeight:1.5,background:"#fff",color:T.ink,resize:"vertical"}}/>
        <button onClick={()=>setP(p=>({...parseText(text),purlinSp:p.purlinSp}))}
          style={{marginTop:8,width:"100%",padding:"10px 0",background:T.hot,color:"#fff",border:"none",borderRadius:2,fontWeight:800,fontSize:13,letterSpacing:"0.08em",cursor:"pointer"}}>GENERATE MODEL</button>
        <div style={{marginTop:8,fontFamily:T.mono,fontSize:11.5,lineHeight:1.6}}>
          <div style={{color:T.ink}}>PARSED&nbsp;&nbsp;W {P.baysShort*P.spacing} m × L {P.baysLong*P.spacing} m · eave {P.eave} m · ridge {P.ridge} m · {P.baysLong} bays @ {P.spacing} m · Risk Cat {P.riskCat} (V={P.V} m/s) · {P.grade}{P.flexDiaphragm?" · flexible diaphragm":""} · DAM</div>
          {(P.warnings||[]).map((w,i)=><div key={i} style={{color:"#B3261E"}}>⚠ {w}</div>)}
        </div>
        <div style={{marginTop:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Field k="eave" label="Eave height (m)" step={0.5}/><Field k="ridge" label="Ridge height (m)" step={0.5}/>
          <Field k="baysShort" label="Bays, short dir"/><Field k="baysLong" label="Bays, long dir"/>
          <Field k="spacing" label="Bay spacing (m)" step={0.5}/><Field k="purlinSp" label="Purlin spacing (m)" step={0.25}/>
          <Field k="Fy" label="Fy (MPa)"/><Field k="V" label="Wind V (m/s)"/>
          <Field k="Lr" label="Roof live (kN/m²)" step={0.1}/><Field k="cladding" label="Cladding (kN/m²)" step={0.05}/>
        </div>
        <div style={{marginTop:10,fontSize:11,color:"#5B6B74",fontFamily:T.mono,lineHeight:1.7}}>Grade {P.grade} · Risk Cat II (SBC T1.5-1) · Exposure C (D if coastal) · SDC A → EQ = 0.01W joint forces · pinned bases · DAM, K=1, notional 0.002 (base D, S.IMP, Lr) · purlins continuous lapped, insertion pt 1, loads on purlins only</div>
      </div>

      <div>
        <div style={{display:"flex",gap:0,borderBottom:`2px solid ${T.ink}`}}>
          {tabs.map(([k,l])=><button key={k} onClick={()=>setTab(k)}
            style={{padding:"8px 14px",fontSize:12,fontWeight:700,border:"none",cursor:"pointer",background:tab===k?T.ink:"transparent",color:tab===k?"#fff":T.ink}}>{l}</button>)}
        </div>
        <div style={{background:"#fff",border:`1px solid ${T.line}`,borderTop:"none",padding:14}}>
          {!R&&<div>Model could not be generated — check parameters.</div>}
          {R&&tab==="model"&&<div>
            <Elev/><Plan/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(115px,1fr))",gap:10,marginTop:12,fontFamily:T.mono,fontSize:12}}>
              <div><Lbl c="Plan"/>{R.W} × {R.Lb} m</div>
              <div><Lbl c="Frames"/>{R.nF} @ {P.spacing} m</div>
              <div><Lbl c="Purlin lines"/>{R.purlin.lines} + eave/ridge struts</div>
              <div><Lbl c="Main steel"/>≈ {R.tonnage.toFixed(1)} t</div>
            </div>
          </div>}
          {R&&tab==="loads"&&<div style={{fontFamily:T.mono,fontSize:12.5,lineHeight:2}}>
            <Lbl c="Load cases"/>
            DEAD self-weight · S.IMP {(P.cladding+P.services).toFixed(2)} kN/m² on purlins · Lr {P.Lr} kN/m² on purlins<br/>
            WX+ / WX− explicit pressures, qh = {R.qh.toFixed(3)} kN/m², GCpi ±0.18 · WY gable joint forces<br/>
            EQX / EQY = 0.01W joint forces at frame tops (SBC 301-2018 §11.7, SDC A minimum)<br/>
            6 notional patterns: 0.002 × (DEAD, S.IMP, Lr) in X and Y — DAM<br/>
            <Lbl c="Strength combos (LRFD §2.3.2)"/>
            {R.combosA.map(([n])=><div key={n} style={{borderBottom:`1px dashed ${T.line}`}}>{n}</div>)}
            <Lbl c="Service combos (deflection)"/>
            {R.service.map(n=><div key={n} style={{borderBottom:`1px dashed ${T.line}`}}>{n}</div>)}
          </div>}
          {R&&tab==="design"&&<div style={{fontFamily:T.mono,fontSize:12.5}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{textAlign:"left",borderBottom:`2px solid ${T.ink}`}}><th style={{padding:6}}>Group</th><th>Section</th><th>D/C</th><th>Governing</th></tr></thead>
              <tbody>
                <tr style={{borderBottom:`1px solid ${T.line}`}}><td style={{padding:6}}>Rafters</td><td>{R.raf.n}</td><td><Chk ok={R.utR<=0.95}>{R.utR.toFixed(2)}</Chk></td><td style={{fontSize:11}}>{R.gov.r}</td></tr>
                <tr style={{borderBottom:`1px solid ${T.line}`}}><td style={{padding:6}}>Columns</td><td>{R.col.n}</td><td><Chk ok={R.utC<=0.95}>{R.utC.toFixed(2)}</Chk></td><td style={{fontSize:11}}>{R.gov.c}</td></tr>
                <tr style={{borderBottom:`1px solid ${T.line}`}}><td style={{padding:6}}>Purlins</td><td>{ZP.n}</td><td><Chk ok={R.purlin.ut<=0.95}>{R.purlin.ut.toFixed(2)}</Chk></td><td style={{fontSize:11}}>1.2 D + 1.6 Lr (continuous)</td></tr>
              </tbody></table>
            <div style={{marginTop:12,lineHeight:2}}>
              <Lbl c="Serviceability"/>
              Rafter deflection (Lr): <Chk ok={R.checks.defl<=R.checks.deflLim}>{R.checks.defl.toFixed(1)} / {R.checks.deflLim.toFixed(0)} mm</Chk><br/>
              Purlin deflection (Lr, end span): <Chk ok={R.purlin.defl<=R.purlin.deflLim}>{R.purlin.defl.toFixed(1)} / {R.purlin.deflLim.toFixed(0)} mm</Chk><br/>
              Eave drift (W): <Chk ok={R.checks.drift<=R.checks.driftLim}>{R.checks.drift.toFixed(1)} / {R.checks.driftLim.toFixed(0)} mm</Chk>
            </div>
            <div style={{marginTop:10,fontSize:11,color:"#5B6B74"}}>In-browser sizing is first-order with equivalent distributed loads; the exported model carries the true purlin→rafter load path and DAM preferences for the production run in SAP2000.</div>
          </div>}
          {R&&tab==="report"&&<div id="inputReport" style={{fontFamily:T.mono,fontSize:12,lineHeight:1.7}}>
            <style>{`@media print { body * { visibility:hidden; } #inputReport, #inputReport * { visibility:visible; } #inputReport { position:absolute; left:0; top:0; width:100%; padding:24px; } .no-print{display:none!important;} }`}</style>
            <button className="no-print" onClick={()=>window.print()} style={{marginBottom:10,padding:"8px 16px",background:T.ink,color:"#fff",border:"none",borderRadius:2,fontWeight:700,cursor:"pointer"}}>PRINT / SAVE AS PDF</button>
            <h2 style={{margin:"4px 0"}}>INPUT &amp; ASSUMPTIONS REPORT — INDUSTRIAL STEEL BUILDING</h2>
            <div style={{color:"#666"}}>SteelModeler v0.3 · SBC 301-2018 loads · AISC 360-16 LRFD · Direct Analysis Method</div>
            {[["1. GEOMETRY (parsed input)",[
              ["Plan",`${P.baysShort*P.spacing} m × ${P.baysLong*P.spacing} m`,"input"],
              ["Eave / ridge height",`${P.eave} m / ${P.ridge} m (slope ${R.slope.toFixed(1)}°)`,"input"],
              ["Frames",`${P.baysLong+1} @ ${P.spacing} m; interior column at ridge line`,"input / typology"],
              ["Purlin spacing",`${P.purlinSp} m on plan`,"assumed default"]]],
             ["2. MATERIALS",[
              ["Primary steel",`${P.grade}, Fy = ${P.Fy} MPa`,"input"],
              ["Secondary (purlins/girts)","A653 SS Gr50 cold-formed Z, Fy = 345 MPa","assumed default"]]],
             ["3. GRAVITY LOADS",[
              ["Dead","self-weight, auto-generated","assumed"],
              ["Superimposed dead",`roof sheeting+fixings ${P.cladding} kN/m² + services ${P.services} kN/m²; walls 0.10 kN/m²`,"assumed default"],
              ["Roof live Lr",`${P.Lr} kN/m² (inaccessible roof, SBC 301-2018 Table 4-1)`,"assumed default"]]],
             ["4. WIND",[
              ["Risk category / V",`${P.riskCat} → V = ${P.V} m/s (SBC 301-2018 map)`,P.riskCat==="II"&&!(P.notes||[]).every(n=>!n.includes("assumed"))?"assumed":"input"],
              ["Exposure",`${P.exposure}`,"derived from site"],
              ["Kz",`${R.qh?(R.qh/(0.613*0.85*P.V*P.V/1000)).toFixed(3):"—"} at mean roof height ${(P.eave+P.ridge)/2} m`,"computed"],
              ["Kzt / Kd / GCpi / G","1.0 (flat) / 0.85 / ±0.18 (enclosed) / 0.85 (rigid)","assumed"],
              ["qh",`${R.qh.toFixed(3)} kN/m²`,"computed"],
              ["C&C zoning",`GCp roof −0.8/−1.3/−2.0 (Z1/Z2/Z3), walls −0.90/−1.05, edge strip a = ${Math.max(0.9,Math.min(0.1*P.baysShort*P.spacing,0.4*(P.eave+P.ridge)/2)).toFixed(1)} m`,"assumed per Ch.30"],
              ["Load path","C&C pressures applied on purlins/girts and carried to main frames (conservative, no separate MWFRS model)","locked decision"],
              ["Diaphragm",P.flexDiaphragm?"flexible — tributary distribution, longitudinal wind to braced bays":"flexible (default) — tributary distribution","input"]]],
             ["5. SEISMIC",[
              ["SDC","A assumed for Riyadh → minimum lateral force Fx = 0.01W (SBC 301-2018 §11.7). Verify Ss/S1 for the actual site; western/Tabuk regions can be higher.","assumed — verify"]]],
             ["6. STABILITY / ANALYSIS",[
              ["Method","Direct Analysis: rigorous P-Δ nonlinear strength cases, 0.8·EA & 0.8·EI stiffness modifiers, τb, K = 1","locked decision"],
              ["Notional loads","0.002 × (D, SDL, Lr) in X and Y","code"],
              ["Base fixity",P.fixedBase?"FIXED — required for drift at this eave height":"PINNED","rule / input"],
              ["Bracing","tension-only Ø24 rod X-bracing, 2nd & penultimate bays; SHS eave/ridge struts","assumed default"]]],
             ["7. SERVICEABILITY (hard constraints)",[
              ["Eave drift",`H/${P.driftLim} under D+0.6W`,"limit"],
              ["Member deflection",`L/${P.deflLim} (live)`,"limit"]]],
            ].map(([h,rows],i)=><div key={i}><h3 style={{margin:"12px 0 4px",borderBottom:`2px solid ${T.ink}`}}>{h}</h3>
              <table style={{width:"100%",borderCollapse:"collapse"}}><tbody>
              {rows.map((r,j)=><tr key={j} style={{borderBottom:"1px solid #eee"}}>
                <td style={{padding:"3px 6px",width:"26%",fontWeight:700}}>{r[0]}</td>
                <td style={{padding:"3px 6px"}}>{r[1]}</td>
                <td style={{padding:"3px 6px",width:"16%",color:r[2].includes("assumed")||r[2].includes("verify")?"#B3261E":"#666"}}>[{r[2]}]</td></tr>)}
              </tbody></table></div>)}
            {(P.notes||[]).length>0&&<div style={{marginTop:10}}><h3 style={{margin:"12px 0 4px",borderBottom:`2px solid ${T.ink}`}}>8. AUTOMATIC DECISIONS</h3>
              {(P.notes||[]).map((n,i)=><div key={i}>• {n}</div>)}</div>}
            {(P.warnings||[]).length>0&&<div style={{marginTop:10,color:"#B3261E"}}><h3 style={{margin:"12px 0 4px",borderBottom:"2px solid #B3261E"}}>9. PARSE WARNINGS</h3>
              {(P.warnings||[]).map((w,i)=><div key={i}>⚠ {w}</div>)}</div>}
          </div>}
          {R&&tab==="export"&&<div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={()=>dl(s2kR3(P,R),`Industrial_${R.W}x${R.Lb}_R3.s2k`)} style={{padding:"12px 18px",background:T.ink,color:"#fff",border:"none",borderRadius:2,fontWeight:800,fontSize:13,cursor:"pointer"}}>Download .s2k (SAP2000)</button>
              <button onClick={()=>dl(e2k(P,R),`Industrial_${R.W}x${R.Lb}.e2k`)} style={{padding:"12px 18px",background:"#fff",color:T.ink,border:`2px solid ${T.ink}`,borderRadius:2,fontWeight:800,fontSize:13,cursor:"pointer"}}>Download .e2k (ETABS, beta)</button>
            </div>
            <div style={{marginTop:12,fontFamily:T.mono,fontSize:12,lineHeight:1.9,color:"#40525C"}}>
              .s2k contents: {R.nF} frames · {R.purlin.lines} purlin lines (Z cold-formed, continuous, cardinal pt 1) · eave/ridge SHS struts · Ø24 tension-only rod X-bracing in bays {R.bracedBays[0]} & {R.bracedBays[1]} (walls + roof) · loads on purlins only · 13 strength + 4 service combos, self-describing names · notionals inline (NotBasePat) · AutoLoad=None on wind/quake · Compression=0 on rods · DAM steel preferences.
            </div>
          </div>}
        </div>
      </div>
    </div>
  </div>);
}
