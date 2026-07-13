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

/* ============ S2K WRITER (R8 methodology: NL P-Delta, DAM modifiers, zoned C&C, gable wind) ============ */
const DIM={IPE160:[160,82,7.4,5,68.3,3.6],IPE180:[180,91,8,5.3,101,4.8],IPE200:[200,100,8.5,5.6,142,7],
 IPE220:[220,110,9.2,5.9,205,9.1],IPE240:[240,120,9.8,6.2,284,12.9],IPE270:[270,135,10.2,6.6,420,15.9],
 IPE300:[300,150,10.7,7.1,604,20.1],IPE330:[330,160,11.5,7.5,788,28.1],IPE360:[360,170,12.7,8,1043,37.3],
 IPE400:[400,180,13.5,8.6,1318,51.1],IPE450:[450,190,14.6,9.4,1676,66.9],IPE500:[500,200,16,10.2,2142,89.3],
 IPE550:[550,210,17.2,11.1,2668,123],IPE600:[600,220,19,12,3387,165]};
function secRow(name,lib){
  const e=lib.find(r=>r.n===name), d=DIM[name];
  const A=e.A/1e4, I33=e.Ix/1e8, Z33=e.Zx/1e6, S33=I33/(d[0]/2000);
  const I22=d[4]/1e8, S22=I22/(d[1]/2000), Z22=1.56*S22, J=d[5]/1e8;
  const AS2=d[0]/1000*d[3]/1000, AS3=5/6*2*(d[1]/1000)*(d[2]/1000);
  return `   SectionName=${name}   Material=MAIN   Shape="I/Wide Flange"   t3=${+(d[0]/1000).toFixed(4)}   t2=${+(d[1]/1000).toFixed(4)}   tf=${+(d[2]/1000).toFixed(4)}   tw=${+(d[3]/1000).toFixed(4)}   t2b=${+(d[1]/1000).toFixed(4)}   tfb=${+(d[2]/1000).toFixed(4)}   Area=${A.toFixed(6)}   TorsConst=${J.toExponential(3).toUpperCase()}   I33=${I33.toExponential(4).toUpperCase()}   I22=${I22.toExponential(4).toUpperCase()}   AS2=${AS2.toFixed(6)}   AS3=${AS3.toFixed(6)} _
        S33=${S33.toExponential(4).toUpperCase()}   S22=${S22.toExponential(4).toUpperCase()}   Z33=${Z33.toExponential(4).toUpperCase()}   Z22=${Z22.toExponential(4).toUpperCase()}   R33=${(e.rx/100).toFixed(4)}   R22=${(e.ry/100).toFixed(4)}   FromFile=No`;
}
function s2kR8(P,R){
  const W=P.baysShort*P.spacing, sp=P.spacing, nB=P.baysLong, nF=nB+1, eave=P.eave, ridge=P.ridge;
  const th=Math.atan((ridge-eave)/(W/2)), c=Math.cos(th), s=Math.sin(th);
  const topY=x=>eave+(ridge-eave)*(1-Math.abs(2*x/W-1));
  const colSec=R.col, rafSec=R.raf, intSec=R.col;
  const hbar=(eave+ridge)/2,zg=P.exposure==="D"?213.36:274.32,al=P.exposure==="D"?11.5:9.5;
  const qh=0.613*Math.max(0.85,2.01*Math.pow(hbar/zg,2/al))*0.85*P.V*P.V/1000;
  const GZ=[];for(let z=1.8;z<eave-1.1;z+=1.8)GZ.push(+z.toFixed(2));
  const GT=GZ.map((z,i)=>i<GZ.length-1?1.8:+(0.9+(eave-GZ[GZ.length-1])/2).toFixed(2));
  const PXh=[];for(let x=P.purlinSp;x<W/2-1e-6;x+=P.purlinSp)PXh.push(+x.toFixed(3));
  const PX=[...PXh,...PXh.map(x=>+(W-x).toFixed(3))].sort((a,b)=>a-b);
  const allx=[...new Set([0,W/2,W,...PX])].sort((a,b)=>a-b);
  const bigZ = sp>7;
  const ZN=bigZ?'"Z 250x75x20x3.0"':'"Z 150x50x20x2.5"';
  const aStrip=Math.max(0.9,Math.min(0.1*W,0.4*hbar));
  const STR=[["1.4 D + N",[["DEAD",1.4],["S.IMP",1.4],["NDX",1.4],["NDY",1.4],["NSX",1.4],["NSY",1.4]]],
   ["1.2 D + 1.6 Lr + 0.5 WX+ + N",[["DEAD",1.2],["S.IMP",1.2],["Lr",1.6],["WX+",0.5],["NDX",1.2],["NDY",1.2],["NSX",1.2],["NSY",1.2],["NLX",1.6],["NLY",1.6]]],
   ["1.2 D + 1.6 Lr + 0.5 WX- + N",[["DEAD",1.2],["S.IMP",1.2],["Lr",1.6],["WX-",0.5],["NDX",1.2],["NDY",1.2],["NSX",1.2],["NSY",1.2],["NLX",1.6],["NLY",1.6]]],
   ["1.2 D + 1.0 WX+ + 0.5 Lr",[["DEAD",1.2],["S.IMP",1.2],["WX+",1],["Lr",0.5]]],
   ["1.2 D + 1.0 WX- + 0.5 Lr",[["DEAD",1.2],["S.IMP",1.2],["WX-",1],["Lr",0.5]]],
   ["1.2 D + 1.0 WY+ + 0.5 Lr",[["DEAD",1.2],["S.IMP",1.2],["WY+",1],["Lr",0.5]]],
   ["1.2 D + 1.0 WY- + 0.5 Lr",[["DEAD",1.2],["S.IMP",1.2],["WY-",1],["Lr",0.5]]],
   ["1.2 D + 1.0 EQX",[["DEAD",1.2],["S.IMP",1.2],["EQX",1]]],
   ["1.2 D + 1.0 EQY",[["DEAD",1.2],["S.IMP",1.2],["EQY",1]]],
   ["0.9 D + 1.0 WX+",[["DEAD",0.9],["S.IMP",0.9],["WX+",1]]],
   ["0.9 D + 1.0 WX-",[["DEAD",0.9],["S.IMP",0.9],["WX-",1]]],
   ["0.9 D + 1.0 WY+",[["DEAD",0.9],["S.IMP",0.9],["WY+",1]]],
   ["0.9 D + 1.0 WY-",[["DEAD",0.9],["S.IMP",0.9],["WY-",1]]],
   ["0.9 D + 1.0 EQX",[["DEAD",0.9],["S.IMP",0.9],["EQX",1]]],
   ["0.9 D + 1.0 EQY",[["DEAD",0.9],["S.IMP",0.9],["EQY",1]]]];
  const SVC=[["D + Lr (Service)",[["DEAD",1],["S.IMP",1],["Lr",1]]],
   ["D + 0.6 WX+ (Service)",[["DEAD",1],["S.IMP",1],["WX+",0.6]]],["D + 0.6 WX- (Service)",[["DEAD",1],["S.IMP",1],["WX-",0.6]]],
   ["D + 0.6 WY+ (Service)",[["DEAD",1],["S.IMP",1],["WY+",0.6]]],["D + 0.6 WY- (Service)",[["DEAD",1],["S.IMP",1],["WY-",0.6]]]];
  const L=[];const p=x=>L.push(x);
  p('File SteelModeler_R8.s2k');p('');
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
  const secs=[...new Set([colSec,rafSec,intSec])];
  secs.forEach(n=>p(secRow(n,DB)));
  p('   SectionName=SHS120X5   Material=MAIN   Shape="Box/Tube"   t3=0.12   t2=0.12   tf=0.005   tw=0.005   Area=0.002270   TorsConst=7.54E-06   I33=4.981E-06   I22=4.981E-06   AS2=0.0012   AS3=0.0012   S33=8.302E-05   S22=8.302E-05 _');
  p('        Z33=9.839E-05   Z22=9.839E-05   R33=0.0468   R22=0.0468   FromFile=No');
  p('   SectionName=ROD24   Material=MAIN   Shape=Circle   t3=0.024   Area=0.000452   TorsConst=3.26E-08   I33=1.629E-08   I22=1.629E-08   S33=1.357E-06   S22=1.357E-06   Z33=2.304E-06   Z22=2.304E-06   R33=0.006   R22=0.006   FromFile=No');
  if(bigZ) p('   SectionName="Z 250x75x20x3.0"   Material=A653SQGr50   Shape="Cold Formed Z"   t3=0.25   t2=0.095   tw=0.003   Radius=0.00635   LipDepth=0.02   LipAngle=45   Area=0.0013020   TorsConst=3.91E-09 _\n        I33=1.230E-05   I22=1.62E-06   I23=-2.95E-06   AS2=0.00075   AS3=0.00045   S33Top=9.84E-05   S33Bot=9.84E-05   FromFile=No');
  else p('   SectionName="Z 150x50x20x2.5"   Material=A653SQGr50   Shape="Cold Formed Z"   t3=0.15   t2=0.06   tw=0.0025   Radius=0.00635   LipDepth=0.02   LipAngle=45   Area=0.00073937749035729   TorsConst=1.54036977157769E-09 _\n        I33=2.58831051241001E-06   I22=7.37993214156867E-07   I23=-1.04148378941824E-06   AS2=0.00033075   AS3=0.000237421049864991   S33Top=3.45108068321335E-05   S33Bot=3.45108068321335E-05   FromFile=No');
  p('');
  p('TABLE:  "FRAME PROPERTY MODIFIERS"');
  secs.forEach(n=>p(`   SectionName=${n}   AMod=0.8   A2Mod=1   A3Mod=1   JMod=1   I2Mod=0.8   I3Mod=0.8   MMod=1   WMod=1   Notes="DAM reduced stiffness 0.8 (AISC C2.3)"`));
  p('');
  p('TABLE:  "LOAD PATTERN DEFINITIONS"');
  p('   LoadPat=DEAD   DesignType=Dead   SelfWtMult=1');
  p('   LoadPat=S.IMP   DesignType="Super Dead"   SelfWtMult=0');
  p('   LoadPat=Lr   DesignType="Roof Live"   SelfWtMult=0');
  ["WX+","WX-","WY+","WY-"].forEach(n=>p(`   LoadPat=${n}   DesignType=Wind   SelfWtMult=0   AutoLoad=None`));
  ["EQX","EQY"].forEach(n=>p(`   LoadPat=${n}   DesignType=Quake   SelfWtMult=0   AutoLoad=None`));
  [["NDX","DEAD","X"],["NDY","DEAD","Y"],["NSX","S.IMP","X"],["NSY","S.IMP","Y"],["NLX","Lr","X"],["NLY","Lr","Y"]]
    .forEach(([n,b2,d])=>p(`   LoadPat=${n}   DesignType=Notional   SelfWtMult=0   NotBasePat=${b2}   NotRatio=0.002   NotDir="Global ${d}"`));
  p('');
  const pats=["DEAD","S.IMP","Lr","WX+","WX-","WY+","WY-","EQX","EQY","NDX","NDY","NSX","NSY","NLX","NLY"];
  const dtyp={DEAD:"Dead","S.IMP":'"Super Dead"',Lr:'"Roof Live"',"WX+":"Wind","WX-":"Wind","WY+":"Wind","WY-":"Wind",EQX:"Quake",EQY:"Quake"};
  p('TABLE:  "LOAD CASE DEFINITIONS"');
  pats.forEach(n=>p(`   Case=${n}   Type=LinStatic   InitialCond=Zero   DesTypeOpt="Prog Det"   DesignType=${dtyp[n]||"Notional"}   DesActOpt="Prog Det"   DesignAct=Non-Composite   AutoType=None   RunCase=Yes`));
  STR.forEach(([cn])=>p(`   Case="NL ${cn}"   Type=NonStatic   InitialCond=Zero   DesTypeOpt="Prog Det"   DesignType=Other   DesActOpt="Prog Det"   DesignAct=Other   AutoType=None   RunCase=Yes`));
  p('');
  p('TABLE:  "CASE - STATIC 1 - LOAD ASSIGNMENTS"');
  pats.forEach(n=>p(`   Case=${n}   LoadType="Load pattern"   LoadName=${n}   LoadSF=1`));
  STR.forEach(([cn,terms])=>terms.forEach(([pt,f])=>p(`   Case="NL ${cn}"   LoadType="Load pattern"   LoadName=${pt}   LoadSF=${f}`)));
  p('');
  p('TABLE:  "CASE - STATIC 2 - NONLINEAR LOAD APPLICATION"');
  STR.forEach(([cn])=>p(`   Case="NL ${cn}"   LoadApp="Full Load"   MonitorDispl="DOF"   MonitorDOF=U1   MonitorJt=2`));
  p('');
  p('TABLE:  "CASE - STATIC 4 - NONLINEAR PARAMETERS"');
  STR.forEach(([cn])=>p(`   Case="NL ${cn}"   Unloading="Unload Entire"   GeoNonLin="P-Delta"   ResultsSave="Final State"   MaxNullSteps=50   MaxTotalSteps=400   MaxIterCS=10   MaxIterNR=40   ItConvTol=0.0001   UseEventStepping=No`));
  p('');
  p('TABLE:  "JOINT COORDINATES"');
  let jid=0;const J={};
  const addj=(k,x,y,z)=>{jid++;J[k]=jid;p(`   Joint=${jid}   CoordSys=GLOBAL   CoordType=Cartesian   XorR=${+x.toFixed(4)}   Y=${+y.toFixed(4)}   Z=${+z.toFixed(4)}`);};
  for(let f=0;f<nF;f++){const y=f*sp;
    [0,W/2,W].forEach(x=>addj(`b${f}_${x}`,x,y,0));
    [0,W].forEach(x=>GZ.forEach(z=>addj(`g${f}_${x}_${z}`,x,y,z)));
    allx.forEach(x=>addj(`t${f}_${x}`,x,y,topY(x)));}
  p('');
  p('TABLE:  "CONNECTIVITY - FRAME"');
  let fid=0;const colsE=[],colsI=[],rafs=[],struts=[],purl=[],girts=[],rods=[];
  const addf=(lst,i,j)=>{fid++;lst.push(fid);p(`   Frame=${fid}   JointI=${J[i]}   JointJ=${J[j]}`);};
  const nseg=GZ.length+1;
  for(let f=0;f<nF;f++){
    [0,W].forEach(x=>{const ch=[`b${f}_${x}`,...GZ.map(z=>`g${f}_${x}_${z}`),`t${f}_${x}`];
      for(let i=0;i<ch.length-1;i++)addf(colsE,ch[i],ch[i+1]);});
    addf(colsI,`b${f}_${W/2}`,`t${f}_${W/2}`);
    for(let i=0;i<allx.length-1;i++)addf(rafs,`t${f}_${allx[i]}`,`t${f}_${allx[i+1]}`);}
  for(let f=0;f<nF-1;f++){
    [0,W/2,W].forEach(x=>addf(struts,`t${f}_${x}`,`t${f+1}_${x}`));
    PX.forEach(x=>addf(purl,`t${f}_${x}`,`t${f+1}_${x}`));
    [0,W].forEach(x=>GZ.forEach(z=>addf(girts,`g${f}_${x}_${z}`,`g${f+1}_${x}_${z}`)));}
  const bb=[1,nB-2];
  bb.forEach(b2=>{
    [0,W].forEach(x=>{addf(rods,`b${b2}_${x}`,`t${b2+1}_${x}`);addf(rods,`b${b2+1}_${x}`,`t${b2}_${x}`);});
    [[0,W/2],[W/2,W]].forEach(([xa,xb])=>{addf(rods,`t${b2}_${xa}`,`t${b2+1}_${xb}`);addf(rods,`t${b2}_${xb}`,`t${b2+1}_${xa}`);});});
  p('');
  p('TABLE:  "JOINT RESTRAINT ASSIGNMENTS"');
  const RR=P.fixedBase?"Yes":"No";
  for(let f=0;f<nF;f++)[0,W/2,W].forEach(x=>p(`   Joint=${J[`b${f}_${x}`]}   U1=Yes   U2=Yes   U3=Yes   R1=${RR}   R2=${RR}   R3=${RR}`));
  p('');
  p('TABLE:  "FRAME SECTION ASSIGNMENTS"');
  colsE.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${colSec}   MatProp=Default`));
  colsI.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${intSec}   MatProp=Default`));
  rafs.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${rafSec}   MatProp=Default`));
  struts.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=SHS120X5   MatProp=Default`));
  purl.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${ZN}   MatProp=Default`));
  girts.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${ZN}   MatProp=Default`));
  rods.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=ROD24   MatProp=Default`));
  p('');
  p('TABLE:  "FRAME INSERTION POINT ASSIGNMENTS"');
  purl.forEach(f=>p(`   Frame=${f}   CardinalPt=1   Mirror2=No   StiffTransform=Yes`));
  p('');
  p('TABLE:  "FRAME RELEASE ASSIGNMENTS 1 - GENERAL"');
  rods.forEach(f=>p(`   Frame=${f}   PI=No   V2I=No   V3I=No   TI=Yes   M2I=Yes   M3I=Yes   PJ=No   V2J=No   V3J=No   TJ=No   M2J=Yes   M3J=Yes`));
  p('');
  p('TABLE:  "FRAME TENSION AND COMPRESSION LIMITS"');
  rods.forEach(f=>p(`   Frame=${f}   TensLimit=No   CompLimit=Yes   Compression=0`));
  p('');
  p('TABLE:  "FRAME LOADS - DISTRIBUTED"');
  const tribS=P.purlinSp/c, sdl=P.cladding+P.services;
  const dist=(f,pat,d,v)=>p(`   Frame=${f}   LoadPat=${pat}   CoordSys=GLOBAL   Type=Force   Dir=${d}   DistType=RelDist   RelDistA=0   RelDistB=1   FOverLA=${v.toFixed(4)}   FOverLB=${v.toFixed(4)}`);
  const GCPR={1:-0.8,2:-1.3,3:-2.0},GCPWP=0.75,GCPW={4:-0.90,5:-1.05};
  const rzone=(x,bay)=>{const near=x<=aStrip||x>=W-aStrip||Math.abs(x-W/2)<=aStrip;
    const endb=bay===0||bay===nB-1;return near&&endb?3:(near||endb?2:1);};
  purl.forEach(f=>{dist(f,'S.IMP','Gravity',sdl*tribS);dist(f,'Lr','Gravity',P.Lr*P.purlinSp);});
  struts.forEach((f,k)=>{const x=[0,W/2,W][k%3];
    if(x===W/2){dist(f,'S.IMP','Gravity',sdl*tribS);dist(f,'Lr','Gravity',P.Lr*P.purlinSp);}
    else{dist(f,'S.IMP','Gravity',sdl*tribS/2);dist(f,'Lr','Gravity',P.Lr*P.purlinSp/2);}});
  [["WX+",0.18],["WX-",-0.18],["WY+",0.18],["WY-",-0.18]].forEach(([pat,gi])=>{
    purl.forEach((f,k)=>{const bay=Math.floor(k/PX.length),x=PX[k%PX.length];
      const zn=rzone(x,bay),pu=qh*(Math.abs(GCPR[zn])+gi);
      const nx=x<W/2?-s:s;dist(f,pat,'X',pu*tribS*nx);dist(f,pat,'Z',pu*tribS*c);});
    struts.forEach((f,k)=>{const bay=Math.floor(k/3),x=[0,W/2,W][k%3];
      const zn=rzone(x,bay),pu=qh*(Math.abs(GCPR[zn])+gi);
      if(x===W/2)dist(f,pat,'Z',pu*tribS*c);
      else{const nx=x===0?-s:s;dist(f,pat,'X',pu*tribS/2*nx);dist(f,pat,'Z',pu*tribS/2*c);}});});
  girts.forEach((f,k)=>{const perW=2*GZ.length,bay=Math.floor(k/perW);
    const x=(k%perW)<GZ.length?0:W;const zi=k%GZ.length;const trib=GT[zi];
    const endb=bay===0||bay===nB-1,zw=endb?5:4;
    dist(f,'S.IMP','Gravity',0.10*trib);
    [["WX+",0.18],["WX-",-0.18]].forEach(([pat,gi])=>{
      if(x===0)dist(f,pat,'X',qh*(GCPWP-gi)*trib);
      else dist(f,pat,'X',qh*(Math.abs(GCPW[zw])+gi)*trib);});
    [["WY+",0.18],["WY-",-0.18]].forEach(([pat,gi])=>{
      const pn=qh*(Math.abs(GCPW[zw])+gi);dist(f,pat,'X',(x===0?-pn:pn)*trib);});});
  [["WY+",1],["WY-",-1]].forEach(([pat,sgn])=>{
    [[0,0.8],[nF-1,0.5]].forEach(([f,cp])=>{
      [0,W/2,W].forEach((x,xi)=>{const trib=x===W/2?W/2:W/4;
        const wv=sgn*qh*(0.85*cp+0.18)*trib;
        if(x===W/2)dist(colsI[f],pat,'Y',wv);
        else{const base=f*2*nseg+(x===0?0:nseg);
          for(let sg=0;sg<nseg;sg++)dist(colsE[base+sg],pat,'Y',wv);}});});});
  p('');
  p('TABLE:  "JOINT LOADS - FORCE"');
  const sdead=sdl*W*sp/3+0.4*W;
  for(let f=0;f<nF;f++){const fac=(f>0&&f<nF-1)?1:0.5;
    [0,W/2,W].forEach(x=>{
      p(`   Joint=${J[`t${f}_${x}`]}   LoadPat=EQX   CoordSys=GLOBAL   F1=${(0.01*sdead*fac).toFixed(3)}   F2=0   F3=0   M1=0   M2=0   M3=0`);
      p(`   Joint=${J[`t${f}_${x}`]}   LoadPat=EQY   CoordSys=GLOBAL   F1=0   F2=${(0.01*sdead*fac).toFixed(3)}   F3=0   M1=0   M2=0   M3=0`);});}
  p('');
  p('TABLE:  "COMBINATION DEFINITIONS"');
  STR.forEach(([cn])=>p(`   ComboName="${cn}"   ComboType="Linear Add"   AutoDesign=No   CaseName="NL ${cn}"   ScaleFactor=1   SteelDesign=Strength   ConcDesign=None   AlumDesign=None   ColdDesign=Strength`));
  SVC.forEach(([cn,terms])=>{const[p0,f0]=terms[0];
    p(`   ComboName="${cn}"   ComboType="Linear Add"   AutoDesign=No   CaseName=${p0}   ScaleFactor=${f0}   SteelDesign=Deflection   ConcDesign=None   AlumDesign=None   ColdDesign=Deflection`);
    terms.slice(1).forEach(([pt,f])=>p(`   ComboName="${cn}"   CaseName=${pt}   ScaleFactor=${f}`));});
  p('');
  p('TABLE:  "MASS SOURCE"');p('   MassSource=MSSSRC1   Elements=Yes   Masses=Yes   Loads=No   IsDefault=Yes');p('');
  p('TABLE:  "PREFERENCES - STEEL DESIGN - AISC 360-16"');
  p('   THDesign=Envelopes   FrameType=OMF   PatLLF=0.75   SRatioLimit=0.95   MaxIter=1   SDC=A   SeisCode=No   SeisLoad=No   ImpFactor=1   SystemRho=1   SystemSds=0.5   SystemR=8   SystemCd=5.5   Omega0=3   Provision=LRFD _');
  p('        AMethod="Direct Analysis"   SOMethod="General 2nd Order"   SRMethod="Tau-b Fixed"   NLCoeff=0.002   PhiB=0.9   PhiC=0.9   PhiTY=0.9   PhiTF=0.75   PhiV=0.9   PhiVRolledI=1   PhiVT=0.9   PlugWeld=Yes   HSSWelding=ERW   HSSReduceT=No _');
  p('        CheckDefl=Yes   DLRat=120   SDLAndLLRat=120   LLRat=240   TotalRat=180   NetRat=240');
  p('');p('END TABLE DATA');
  return L.join("\r\n");
}
const s2kR3=s2kR8;

/* ============ IFC WRITER (Tekla-safe: Brep secondary/connections, extruded hot-rolled) ============ */
function ifcWrite(P,R){
 const W=P.baysShort*P.spacing*1000, sp=P.spacing*1000, nB=P.baysLong, nF=nB+1;
 const eave=P.eave*1000, ridge=P.ridge*1000;
 const colSec=R.col, rafSec=R.raf, dC=DIM[colSec], dR=DIM[rafSec];
 const TH=Math.atan((ridge-eave)/(W/2)), CS=Math.cos(TH), SN=Math.sin(TH);
 const topZ=x=>eave+(ridge-eave)*(1-Math.abs(2*x/W-1));
 const GZ=[];for(let z=1800;z<eave-1100;z+=1800)GZ.push(z);
 const PXh=[];for(let x=P.purlinSp*1000;x<W/2-1;x+=P.purlinSp*1000)PXh.push(x);
 const PX=[...PXh,...PXh.map(x=>W-x)].sort((a,b)=>a-b);
 const bigZ=P.spacing>7, ZD=bigZ?250:150, ZF=bigZ?75:50, ZT=bigZ?3:2.5, ZN2=bigZ?"Z250*75*3.0":"Z150*97.5*2.5";
 const BP=20, RS=dC[0]/2+20, hR=(dR[0]/2)/CS;
 const CTE=topZ(RS)+hR+10, CTI=topZ(W/2-dC[0]/2-20)+hR+10;
 const HD=dR[0]-12, HL=Math.min(0.1*W,1500), EPH=Math.round(dR[0]+HD+60);
 let nid=0; const L=[]; const w=s=>{nid++;L.push(`#${nid}= ${s}`);return nid;};
 const AL="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
 const guid=()=>{let g="";for(let i=0;i<22;i++)g+=AL[Math.floor(Math.random()*64)];return g;};
 const pers=w("IFCPERSON($,'SteelModeler',$,$,$,$,$,$);"),org=w("IFCORGANIZATION($,'SteelModeler',$,$,$);");
 const po=w(`IFCPERSONANDORGANIZATION(#${pers},#${org},$);`),ap=w(`IFCAPPLICATION(#${org},'0.3','SteelModeler','SM');`);
 const oh=w(`IFCOWNERHISTORY(#${po},#${ap},$,.ADDED.,$,$,$,0);`);
 const o=w("IFCCARTESIANPOINT((0.,0.,0.));"),dx=w("IFCDIRECTION((1.,0.,0.));"),dz=w("IFCDIRECTION((0.,0.,1.));");
 const wcs=w(`IFCAXIS2PLACEMENT3D(#${o},#${dz},#${dx});`);
 const ctx=w(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${wcs},$);`);
 const sub=w(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${ctx},$,.MODEL_VIEW.,$);`);
 const us=["IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);","IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);","IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);","IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);","IFCSIUNIT(*,.MASSUNIT.,.KILO.,.GRAM.);"].map(w);
 const ua=w(`IFCUNITASSIGNMENT((${us.map(u=>"#"+u).join(",")}));`);
 const proj=w(`IFCPROJECT('${guid()}',#${oh},'SteelModeler Building',$,$,$,$,(#${ctx}),#${ua});`);
 const sp0=w(`IFCLOCALPLACEMENT($,#${wcs});`),site=w(`IFCSITE('${guid()}',#${oh},'Site',$,$,#${sp0},$,$,.ELEMENT.,$,$,$,$,$);`);
 const bp2=w(`IFCLOCALPLACEMENT(#${sp0},#${wcs});`),bld=w(`IFCBUILDING('${guid()}',#${oh},'Warehouse',$,$,#${bp2},$,$,.ELEMENT.,$,$,$);`);
 const stp=w(`IFCLOCALPLACEMENT(#${bp2},#${wcs});`),sto=w(`IFCBUILDINGSTOREY('${guid()}',#${oh},'GF',$,$,#${stp},$,$,.ELEMENT.,0.);`);
 w(`IFCRELAGGREGATES('${guid()}',#${oh},$,$,#${proj},(#${site}));`);
 w(`IFCRELAGGREGATES('${guid()}',#${oh},$,$,#${site},(#${bld}));`);
 w(`IFCRELAGGREGATES('${guid()}',#${oh},$,$,#${bld},(#${sto}));`);
 const p2o=w("IFCCARTESIANPOINT((0.,0.));"),p2d=w("IFCDIRECTION((1.,0.));"),pos2=w(`IFCAXIS2PLACEMENT2D(#${p2o},#${p2d});`);
 const PROF={};
 PROF[colSec]=w(`IFCISHAPEPROFILEDEF(.AREA.,'${colSec}',#${pos2},${dC[1].toFixed(1)},${dC[0].toFixed(1)},${dC[3].toFixed(2)},${dC[2].toFixed(2)},15.);`);
 if(rafSec!==colSec)PROF[rafSec]=w(`IFCISHAPEPROFILEDEF(.AREA.,'${rafSec}',#${pos2},${dR[1].toFixed(1)},${dR[0].toFixed(1)},${dR[3].toFixed(2)},${dR[2].toFixed(2)},12.);`);
 PROF.SHS=w(`IFCRECTANGLEHOLLOWPROFILEDEF(.AREA.,'SHS120*120*5.0',#${pos2},120.,120.,5.,5.,7.5);`);
 PROF.D24=w(`IFCCIRCLEPROFILEDEF(.AREA.,'D24',#${pos2},12.);`);
 const mA36=w("IFCMATERIAL('STEEL/A36');");
 w(`IFCMECHANICALSTEELMATERIALPROPERTIES(#${mA36},$,200000.,76923.,0.3,1.17E-05,${P.Fy}.,${P.Fy===250?400:450}.,$,$,$,$,$);`);
 const mZ=w("IFCMATERIAL('STEEL/A653-GR50');");
 w(`IFCMECHANICALSTEELMATERIALPROPERTIES(#${mZ},$,203395.,78229.,0.3,1.17E-05,345.,450.,$,$,$,$,$);`);
 const mats={A36:[],Z:[]}; const allel=[];
 const CONN={};let CNO=100;
 const conn=(k,...s2)=>{const key=k+"-"+s2.join("-");if(!CONN[key]){CNO++;CONN[key]={no:CNO,n:0};}CONN[key].n++;return [key,CONN[key].no];};
 const place=(Pt,ax,rf)=>{const pt=w(`IFCCARTESIANPOINT((${Pt[0].toFixed(2)},${Pt[1].toFixed(2)},${Pt[2].toFixed(2)}));`);
  const da=w(`IFCDIRECTION((${ax[0].toFixed(6)},${ax[1].toFixed(6)},${ax[2].toFixed(6)}));`);
  const dr=w(`IFCDIRECTION((${rf[0].toFixed(6)},${rf[1].toFixed(6)},${rf[2].toFixed(6)}));`);
  const a3=w(`IFCAXIS2PLACEMENT3D(#${pt},#${da},#${dr});`);return w(`IFCLOCALPLACEMENT(#${stp},#${a3});`);};
 const EXO=w("IFCCARTESIANPOINT((0.,0.,0.));"),EXP=w(`IFCAXIS2PLACEMENT3D(#${EXO},$,$);`),EXD=w("IFCDIRECTION((0.,0.,1.));");
 const body=(pf,ln)=>{const sol=w(`IFCEXTRUDEDAREASOLID(#${pf},#${EXP},#${EXD},${ln.toFixed(1)});`);
  const sh=w(`IFCSHAPEREPRESENTATION(#${sub},'Body','SweptSolid',(#${sol}));`);return w(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${sh}));`);};
 const IDENT=w(`IFCLOCALPLACEMENT(#${stp},#${wcs});`);
 const prismB=(poly,orig,aD,bD,axis,ln)=>{
  const base=poly.map(([a,b])=>[0,1,2].map(k=>orig[k]+a*aD[k]+b*bD[k]));
  const top=base.map(p3=>[0,1,2].map(k=>p3[k]+ln*axis[k]));
  const V=[...base,...top],n=poly.length,F=[];
  for(let i=1;i<n-1;i++)F.push([0,i+1,i]);
  for(let i=1;i<n-1;i++)F.push([n,n+i,n+i+1]);
  for(let i=0;i<n;i++){const j=(i+1)%n;F.push([i,j,n+j]);F.push([i,n+j,n+i]);}
  return [V,F];};
 const brep=(V,F)=>{const pts=V.map(v=>w(`IFCCARTESIANPOINT((${v[0].toFixed(2)},${v[1].toFixed(2)},${v[2].toFixed(2)}));`));
  const fids=F.map(t=>{const lp=w(`IFCPOLYLOOP((${t.map(i=>"#"+pts[i]).join(",")}));`);
   const ob=w(`IFCFACEOUTERBOUND(#${lp},.T.);`);return w(`IFCFACE((#${ob}));`);});
  const sh=w(`IFCCLOSEDSHELL((${fids.map(f=>"#"+f).join(",")}));`);
  const br=w(`IFCFACETEDBREP(#${sh});`);
  const rep=w(`IFCSHAPEREPRESENTATION(#${sub},'Body','Brep',(#${br}));`);
  return w(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}));`);};
 const pset=(el,mark,no,secn)=>{const ids=[w(`IFCPROPERTYSINGLEVALUE('ConnectionMark',$,IFCLABEL('${mark}'),$);`),
   w(`IFCPROPERTYSINGLEVALUE('ConnectionNo',$,IFCINTEGER(${no}),$);`),
   w(`IFCPROPERTYSINGLEVALUE('Section',$,IFCLABEL('${secn}'),$);`)];
  const ps=w(`IFCPROPERTYSET('${guid()}',#${oh},'SteelModeler_Connections',$,(${ids.map(i=>"#"+i).join(",")}));`);
  w(`IFCRELDEFINESBYPROPERTIES('${guid()}',#${oh},$,$,(#${el}),#${ps});`);};
 const partX=(cls,name,pf,ln,Pt,ax,rf,mat,cs,ce)=>{
  const el=w(`IFC${cls}('${guid()}',#${oh},'${name}','${pf}','${pf}',#${place(Pt,ax,rf)},#${body(PROF[pf==='SHS120*120*5.0'?'SHS':pf==='D24'?'D24':pf],ln)},'${name}');`);
  pset(el,cs[0]+" / "+ce[0],cs[1],pf);mats[mat].push(el);allel.push(el);return el;};
 const partB=(cls,name,secn,V,F,mat,key,no)=>{
  const el=w(`IFC${cls}('${guid()}',#${oh},'${name}','${secn}','${secn}',#${IDENT},#${brep(V,F)},'${name}');`);
  pset(el,key,no,secn);mats[mat].push(el);allel.push(el);return el;};
 const zpoly=(D,F2,t)=>[[ -D/2,-t/2],[-D/2,F2-t/2],[t-D/2,F2-t/2],[t-D/2,t/2],[D/2,t/2],[D/2,t/2-F2],[D/2-t,t/2-F2],[D/2-t,-t/2]];
 const box=(cx,cy,cz,dx2,dy2,dz2,key,no,secn)=>{const V=[],F=[];
  for(const sx of[-1,1])for(const sy of[-1,1])for(const sz of[-1,1])V.push([cx+sx*dx2/2,cy+sy*dy2/2,cz+sz*dz2/2]);
  const faces=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]];
  faces.forEach(q=>{F.push([q[0],q[1],q[2]]);F.push([q[0],q[2],q[3]]);});
  return partB("PLATE","PLATE",secn,V,F,"A36",key,no);};
 // ===== members =====
 let cN=0,rN=0;
 for(let f=0;f<nF;f++){const y=f*sp;
  for(const x of[0,W]){cN++;
   partX("COLUMN",`C${cN}`,colSec,CTE-BP,[x,y,BP],[0,0,1],[0,-1,0],"A36",conn("BP",colSec),conn("KN",rafSec,colSec));}
  cN++;partX("COLUMN",`C${cN}`,colSec,CTI-BP,[W/2,y,BP],[0,0,1],[0,-1,0],"A36",conn("BPI",colSec),conn("AP",rafSec,colSec));
  const x0=RS,x1=W/2-dC[0]/2-20;
  const A0=[x0,y,topZ(x0)],B0=[x1,y,topZ(x1)],ax0=[(B0[0]-A0[0]),0,(B0[2]-A0[2])];
  const l0=Math.hypot(ax0[0],ax0[2]);ax0[0]/=l0;ax0[2]/=l0;
  rN++;partX("BEAM",`RF${rN}`,rafSec,l0,A0,ax0,[0,1,0],"A36",conn("KN",rafSec,colSec),conn("AP",rafSec,colSec));
  const A1=[W-x0,y,topZ(x0)],ax1=[-(ax0[0]),0,ax0[2]];
  rN++;partX("BEAM",`RF${rN}`,rafSec,l0,A1,ax1,[0,1,0],"A36",conn("KN",rafSec,colSec),conn("AP",rafSec,colSec));}
 let sN=0,pN=0,gN=0,bN=0;
 for(let b=0;b<nB;b++){const y0=b*sp;
  for(const x of[0,W/2,W]){sN++;
   partX("BEAM",`ST${sN}`,"SHS120*120*5.0",sp,[x,y0,topZ(x)],[0,1,0],[-1,0,0],"A36",conn("SC","SHS",colSec),conn("SC","SHS",colSec));}
  for(const x of PX){pN++;const sgn=x<W/2?-1:1;
   const nrm=[sgn*SN,0,CS],tng=[CS,0,-sgn*SN];
   const z=topZ(x)+hR+(ZD/2)*CS;
   const [V,F]=prismB(zpoly(ZD,ZF,ZT),[x,y0,z],nrm,tng,[0,1,0],sp);
   const [k2,n2]=conn("PC",ZN2,rafSec);
   partB("MEMBER",`PU${pN}`,ZN2,V,F,"Z",k2,n2);}
  for(const x of[0,W]){const xo=x===0?-(dC[0]/2+ZD/2):x+dC[0]/2+ZD/2;
   const aD=x===0?[-1,0,0]:[1,0,0],bD=x===0?[0,0,-1]:[0,0,1];
   for(const z of GZ){gN++;
    const [V,F]=prismB(zpoly(ZD,ZF,ZT),[xo,y0,z],aD,bD,[0,1,0],sp);
    const [k2,n2]=conn("GC",ZN2,colSec);
    partB("MEMBER",`GI${gN}`,ZN2,V,F,"Z",k2,n2);}}}
 for(const b of[1,nB-2]){const y0=b*sp,y1=(b+1)*sp;
  const pn=[[[0,y0,BP],[0,y1,eave]],[[0,y1,BP],[0,y0,eave]],[[W,y0,BP],[W,y1,eave]],[[W,y1,BP],[W,y0,eave]],
   [[0,y0,eave],[W/2,y1,ridge]],[[W/2,y0,ridge],[0,y1,eave]],[[W/2,y0,ridge],[W,y1,eave]],[[W,y0,eave],[W/2,y1,ridge]]];
  for(const[A2,B2]of pn){bN++;const v=[B2[0]-A2[0],B2[1]-A2[1],B2[2]-A2[2]];
   const l2=Math.hypot(...v);const ax=[v[0]/l2,v[1]/l2,v[2]/l2];
   const rf=Math.abs(ax[2])<0.9?[0,0,1]:[1,0,0];
   const d2=rf[0]*ax[0]+rf[1]*ax[1]+rf[2]*ax[2];
   const rr=[rf[0]-d2*ax[0],rf[1]-d2*ax[1],rf[2]-d2*ax[2]];
   const [k2,n2]=conn("RE","D24",colSec);
   partX("MEMBER",`BR${bN}`,"D24",l2,A2,ax,rr,"A36",[k2,n2],[k2,n2]);}}
 // ===== connections (Brep) =====
 const cyl=(r)=>{const pts=[];for(let i=0;i<12;i++)pts.push([r*Math.cos(i*Math.PI/6),r*Math.sin(i*Math.PI/6)]);return pts;};
 const rb=topZ(RS)-hR;
 for(let f=0;f<nF;f++){const y=f*sp;
  for(const x of[0,W]){const[k2,n2]=conn("BP",colSec);
   box(x,y,BP/2,dC[0]+60,dC[1]+60,BP,k2,n2,`PL20*${dC[1]+60}`);
   for(const su of[-1,1])for(const sv of[-1,1]){
    const [V,F]=prismB(cyl(10),[x+su*dC[0]*0.19,y+sv*45,-30],[1,0,0],[0,1,0],[0,0,1],63);
    partB("MECHANICALFASTENER","Bolt assembly","",V,F,"A36",k2,n2);}}
  const[ki,ni]=conn("BPI",colSec);
  box(W/2,y,BP/2,dC[0]+60,dC[1]+60,BP,ki,ni,`PL20*${dC[1]+60}`);
  for(const x of[0,W]){const sgn=x===0?1:-1;const[k2,n2]=conn("KN",rafSec,colSec);
   const xf=x+sgn*dC[0]/2;
   box(xf+sgn*10,y,CTE-EPH/2,20,dR[1]+10,EPH,k2,n2,`FLT20*${dR[1]+10}`);
   const xs=x+sgn*RS;
   const tri=[[0,0],[sgn*HL,HL*Math.tan(TH)],[0,-HD]];
   const [V,F]=prismB(tri,[xs,y+dR[1]/2,rb],[1,0,0],[0,0,1],[0,-1,0],dR[1]);
   partB("MEMBER","HAUNCH",rafSec,V,F,"A36",k2,n2);
   for(const zs of[rb-HD,rb,topZ(RS)+hR-11])for(const ys of[-1,1])
    box(x,y+ys*(dC[3]/2+27),zs,dC[0]-2*dC[2],50,10,k2,n2,"FLT10*50");
   for(const zb of[CTE-EPH+140,CTE-EPH+360])for(const su of[-1,1])for(const sv of[-1,1]){
    const [V2,F2]=prismB(cyl(8),[xf-sgn*20,y+sv*30,zb+su*40],[0,1,0],[0,0,1],[sgn,0,0],65);
    partB("MECHANICALFASTENER","Bolt assembly","",V2,F2,"A36",k2,n2);}}
  const[ka,na]=conn("AP",rafSec,colSec);
  const rbA=topZ(W/2-dC[0]/2-20)-hR;
  for(const sgn of[1,-1]){const xf=W/2-sgn*dC[0]/2, x1=sgn>0?W/2-dC[0]/2-20:W/2+dC[0]/2+20;
   box(xf-sgn*10,y,CTI-EPH/2,20,dR[1]+10,EPH,ka,na,`FLT20*${dR[1]+10}`);
   const tri=[[-sgn*HL,-HL*Math.tan(TH)],[0,0],[0,-HD]];
   const [V,F]=prismB(tri,[x1,y+dR[1]/2,rbA],[1,0,0],[0,0,1],[0,-1,0],dR[1]);
   partB("MEMBER","HAUNCH",rafSec,V,F,"A36",ka,na);
   for(const zb of[CTI-EPH+140,CTI-EPH+360])for(const sv of[-1,1]){
    const [V2,F2]=prismB(cyl(8),[xf-sgn*20,y+sv*30,zb],[0,1,0],[0,0,1],[-sgn,0,0],65);
    partB("MECHANICALFASTENER","Bolt assembly","",V2,F2,"A36",ka,na);}}
  for(const zs of[CTI-EPH+140,CTI-EPH+360])for(const ys of[-1,1])
   box(W/2,y+ys*(dC[3]/2+27),zs,dC[0]-2*dC[2],50,20,ka,na,"FLT20*50");}
 w(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',#${oh},$,$,(${allel.map(m=>"#"+m).join(",")}),#${sto});`);
 w(`IFCRELASSOCIATESMATERIAL('${guid()}',#${oh},$,$,(${mats.A36.map(m=>"#"+m).join(",")}),#${mA36});`);
 if(mats.Z.length)w(`IFCRELASSOCIATESMATERIAL('${guid()}',#${oh},$,$,(${mats.Z.map(m=>"#"+m).join(",")}),#${mZ});`);
 const hdr="ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition[CoordinationView_V2.0]','ExchangeRequirement[Structural]'),'2;1');\n"+
  "FILE_NAME('SteelModeler.ifc','2026-07-12T12:00:00',('SteelModeler'),('SteelModeler'),'SteelModeler IFC 0.3','SteelModeler WebApp','');\nFILE_SCHEMA(('IFC2X3'));\nENDSEC;\nDATA;\n";
 return hdr+L.join("\r\n")+"\r\nENDSEC;\r\nEND-ISO-10303-21;\r\n";
}

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
              <button onClick={()=>dl(s2kR8(P,R),`Industrial_${R.W}x${R.Lb}_R8.s2k`)} style={{padding:"12px 18px",background:T.ink,color:"#fff",border:"none",borderRadius:2,fontWeight:800,fontSize:13,cursor:"pointer"}}>Download .s2k (SAP2000, R8)</button>
              <button onClick={()=>dl(ifcWrite(P,R),`Industrial_${R.W}x${R.Lb}.ifc`)} style={{padding:"12px 18px",marginLeft:8,background:T.hot,color:"#fff",border:"none",borderRadius:2,fontWeight:800,fontSize:13,cursor:"pointer"}}>Download .ifc (Tekla)</button>
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
