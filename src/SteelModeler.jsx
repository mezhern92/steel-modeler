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
// Cold-formed Z purlin range (A m², Ix m⁴, S m³ effective, mass kg/m). R-factor ~0.7 applied to Mn for uplift.
const ZTAB=[
  {n:"Z 150x50x20x2.5",D:150,A:7.39e-4,Ix:2.588e-6,S:3.45e-5,w:5.80},
  {n:"Z 200x65x20x2.5",D:200,A:9.10e-4,Ix:5.70e-6,S:5.70e-5,w:7.15},
  {n:"Z 250x75x20x3.0",D:250,A:13.02e-4,Ix:1.230e-5,S:9.84e-5,w:10.22},
  {n:"Z 300x100x25x3.0",D:300,A:16.8e-4,Ix:2.35e-5,S:1.567e-4,w:13.2},
  {n:"Z 350x100x25x3.5",D:350,A:21.5e-4,Ix:3.95e-5,S:2.257e-4,w:16.9},
];
const ZFy=344.7;
// Tension rod range for X-bracing (mm diameter → area mm²)
const RODTAB=[16,20,24,30,36,42,48].map(d=>({d,n:"Ø"+d,A:Math.PI*d*d/4}));

/* ============ NL PARSER ============ */
function parseText(t){
  const s=t.toLowerCase().replace(/diaphram/g,"diaphragm"); const warn=[]; const note=[];
  const M="m(?:eters?|tr?s?)?\\.?";
  const num=(res,d,label)=>{ for(const re of res){const m=s.match(re); if(m) return parseFloat(m[1]);}
    if(label) warn.push(label+" not found — using default "+d); return d; };
  // eave / ridge (edge, eaves, apex, middle, centre; number before or after)
  const eave=num([new RegExp("(?:height\\s*)?(?:at\\s*)?(?:the\\s*)?eaves?(?:\\s+(?:height|level|of|is|at|the|will|shall|be))*\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)"),
                  /eave\s*(?:height\s*)?(?:of\s*|is\s*|=\s*)?(\d+(?:\.\d+)?)/,
                  new RegExp("(\\d+(?:\\.\\d+)?)\\s*(?:"+M+")?[^.,;\\d]{0,24}?(?:from|at|in at)\\s*(?:the\\s*)?e(?:dge|ave)s?"),
                  new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"\\s*eaves?\\b")],6,"eave height");
  const ridge=num([new RegExp("(?:ridge|apex)(?:\\s+(?:height|level|of|is|at|the|will|shall|be))*\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)"),
                   new RegExp("(\\d+(?:\\.\\d+)?)\\s*(?:"+M+")?[^.,;\\d]{0,24}?(?:from|at)\\s*(?:the\\s*)?(?:middle|cent(?:re|er)|ridge|apex)"),
                   new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"\\s*(?:ridge|apex)\\b")],8,"ridge height");
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
                     /(?:frame|bay)\s*spacings?\s*(?:of\s*|is\s*|=\s*)?(\d+(?:\.\d+)?)/,
                     /spacings?\s*(?:of\s*|is\s*|=\s*)?(\d+(?:\.\d+)?)/],0);
  let baysShort=num([/(\d+)\s*bays?\s*(?:in\s*)?(?:the\s*)?short/,
                     /(?:width|short\s*span)[^.;]{0,30}?\((\d+)\s*bays?\)/],0);
  let baysLong =num([/(\d+)\s*bays?\s*(?:in\s*)?(?:the\s*)?long/,
                     /(?:length|long\s*span)[^.;]{0,40}?\((\d+)\s*bays?\)/],0);
  const bracedCount=num([/bracings?\s*(?:in\s*)?(\d+)/,/(\d+)\s*braced\s*bays?/],0);
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
  const vs=s.match(/wind\s*(?:speed|velocity)?\s*(?:is\s*|of\s*|=\s*)?(\d+(?:\.\d+)?)\s*m\s*\/?\s*s/);
  if(vs){ const vv=parseFloat(vs[1]);
    if(vv>=20&&vv<=95){ V=vv; note.push(`Explicit wind speed ${vv} m/s from input — overrides the Risk Category map`); }
    else warn.push(`wind speed ${vv} m/s outside plausible range 20–95 — ignored, using V=${V}`); }
  else if(!rc) note.push("Risk Category II assumed (not stated) → V = 42 m/s");
  const ll=s.match(/live\s*load\s*(?:is\s*|of\s*|=\s*)?(\d+(?:\.\d+)?)/);
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
  const clearSpan=/(no|without|free\s*of|remove|eliminate)\s*(middle|mid|internal|interior|central|centre|center)?\s*column/.test(s)
    || /clear\s*span/.test(s) || /column[- ]?free/.test(s) || /single\s*span/.test(s);
  if(clearSpan) note.push("Clear-span frame requested — no interior column; rafters designed to span the full width");
  const braceTube=/brac\w*[^.;]{0,50}?(shs|rhs|tube|hollow|box)/.test(s)||/(shs|rhs|tube)s?[^.;]{0,25}brac/.test(s);
  const purlinTube=/no\s*z[- ]?purlins?/.test(s)||/(tube|rhs|shs)\s*purlins?/.test(s)||/purlins?[^.;]{0,25}(tube|rhs|shs)/.test(s);
  if(braceTube) note.push("Bracing: SHS 100x100x5 tubes — BOTH tension and compression (no tension-only limits); X-crossing connected, KL=0.5L in design overwrites");
  else note.push("Bracing: Ø24 rods, tension-only (Compression=0) — assumed default; write 'SHS bracing' for tube braces");
  if(purlinTube) note.push("Purlins/girts: RHS 100x50x5 tubes (no Z) — sag tubes at midspan required (KL/r 250→125, set in design overwrites)");
  let Fy=250, grade="A36";
  if(/a992|gr\.?\s*50|s355/.test(s)){Fy=345;grade="A992/S355";}
  if(/a36/.test(s)){Fy=250;grade="A36";}
  const Lr=ll?parseFloat(ll[1]):0.96;
  if(ll) note.push(`Roof live load ${Lr} kN/m² from input (default 0.96)`);
  if(bracedCount) note.push(`${bracedCount} braced bays requested — rod X-bracing distributed evenly along the length`);
  return {eave,ridge,baysShort,baysLong,spacing,width:width||0,bracedCount,clearSpan,braceTube,purlinTube,Fy,grade,V,riskCat,exposure,fixedBase,flexDiaphragm,dam:true,
          cladding:0.15,services:0.10,Lr,driftLim:100,deflLim:240,purlinSp:1.0,warnings:warn,notes:note};
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
  const W=(P.width||P.baysShort*P.spacing), Lb=P.baysLong*P.spacing, nF=P.baysLong+1;
  const slope=Math.atan((P.ridge-P.eave)/(W/2)), trib=P.spacing, cs=Math.cos(slope);
  const clear=!!P.clearSpan;
  // column x-positions: clear-span → only the two eave columns; else evenly spaced incl. mid
  const colX=[]; if(clear){colX.push(0,W);} else {for(let i=0;i<=P.baysShort;i++)colX.push(i*W/P.baysShort);}
  const nodes=[],supports=[],colEls=[],rafEls=[];
  const topY=x=>P.eave+(P.ridge-P.eave)*(1-Math.abs(2*x/W-1));
  colX.forEach(x=>{supports.push(nodes.length);nodes.push([x,0]);nodes.push([x,topY(x)]);});
  const topN=i=>2*i+1;
  colX.forEach((x,i)=>colEls.push([2*i,topN(i)]));
  if(clear){
    // eave-to-apex-to-eave: split each rafter into 3 segments for a realistic moment diagram
    const apex=nodes.length; nodes.push([W/2,topY(W/2)]);
    const segs=3;
    const chain=(a,b)=>{let prev=a;for(let k=1;k<segs;k++){const t=k/segs;const m=nodes.length;
      nodes.push([nodes[a][0]+t*(nodes[b][0]-nodes[a][0]),nodes[a][1]+t*(nodes[b][1]-nodes[a][1])]);
      rafEls.push([prev,m]);prev=m;} rafEls.push([prev,b]);};
    chain(topN(0),apex); chain(apex,topN(1));
  } else {
    for(let i=0;i<colX.length-1;i++){
      const a=topN(i),b=topN(i+1);
      const m=nodes.length; nodes.push([(nodes[a][0]+nodes[b][0])/2,(nodes[a][1]+nodes[b][1])/2]);
      rafEls.push([a,m]); rafEls.push([m,b]);
    }
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
  let raf=DB[6], col=DB[6], out=null;  // start mid-range (IPE300) not IPE160
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
    const pr=pick(need.rM,need.rP,clear?P.spacing:P.purlinSp), pc=pick(need.cM,need.cP,1.8);
    if(pr.s.n===raf.n&&pc.s.n===col.n){
      const elems2=[...colEls.map(e=>[...e,col]),...rafEls.map(e=>[...e,raf])];
      const rl=solve(nodes,elems2,supports,cases.Lr.el);
      const wd=solve(nodes,elems2,supports,cases["W+"].el);
      let dv=0; for(let i2=2*colX.length;i2<nodes.length;i2++)dv=Math.max(dv,Math.abs(rl.u[3*i2+1]));
      // ---- PURLIN: select from ZTAB by strength (R=0.7 uplift) AND deflection L/240 ----
      const spanP=trib;
      const wU=1.2*(P.cladding*P.purlinSp/cs)+1.6*P.Lr*P.purlinSp;   // kN/m (self-wt added per section below)
      const MuP=()=>0; // placeholder
      let purlin=null;
      for(const z of ZTAB){
        const wu=1.2*(P.cladding*P.purlinSp/cs+z.w*9.81/1000)+1.6*P.Lr*P.purlinSp;
        const Mu=wu*spanP*spanP/10;                    // continuous
        const phiMn=0.9*0.7*ZFy*1000*z.S;              // R=0.7 for uplift/free flange
        const wS=P.Lr*P.purlinSp;
        const defl=wS*Math.pow(spanP,4)/(145*203.4e6*z.Ix)*1000;
        const deflLim=spanP*1000/240;
        const utz=Math.max(Mu/phiMn, defl/deflLim);
        if(utz<=1.0){ purlin={z,ut:utz,Mu,phiMn,defl,deflLim,gov:Mu/phiMn>=defl/deflLim?"strength (R=0.7)":"deflection L/240"}; break; }
      }
      if(!purlin){const z=ZTAB[ZTAB.length-1];
        const wu=1.2*(P.cladding*P.purlinSp/cs+z.w*9.81/1000)+1.6*P.Lr*P.purlinSp;
        const Mu=wu*spanP*spanP/10, phiMn=0.9*0.7*ZFy*1000*z.S;
        const wS=P.Lr*P.purlinSp, defl=wS*Math.pow(spanP,4)/(145*203.4e6*z.Ix)*1000, deflLim=spanP*1000/240;
        purlin={z,ut:Math.max(Mu/phiMn,defl/deflLim),Mu,phiMn,defl,deflLim,gov:"exceeds largest Z — reduce spacing"};}
      // ---- RODS: longitudinal wind to braced bays, select Ø from RODTAB ----
      const nbr=Math.max(2,Math.min(P.baysLong-2,P.bracedCount||2));
      const sideQ=qh;                                   // kN/m²
      const dragCf=0.8+0.5;                              // windward+leeward on gable
      const Fdrag=sideQ*dragCf*(W*((P.eave+P.ridge)/2))*0.5; // total longitudinal, half to each end wall side
      const perBay=Fdrag/nbr;
      const rodAngle=Math.atan(P.eave/P.spacing);
      const rodT=perBay/Math.cos(rodAngle);             // tension per diagonal
      let rod=null;
      for(const rr of RODTAB){const phiTn=0.9*P.Fy*rr.A/1000; if(phiTn>=rodT){rod={d:rr.d,n:rr.n,phiTn,T:rodT,ut:rodT/phiTn};break;}}
      if(!rod){const rr=RODTAB[RODTAB.length-1];rod={d:rr.d,n:rr.n,phiTn:0.9*P.Fy*rr.A/1000,T:rodT,ut:rodT/(0.9*P.Fy*rr.A/1000)};}
      out={W,Lb,nF,slope:deg,raf:pr.s,col:pc.s,utR:pr.ut,utC:pc.ut,gov:{r:need.gr,c:need.gc},qh,clear,
        combosA,service,colX,topYf:topY,
        purlin:{ut:purlin.ut,defl:purlin.defl,deflLim:purlin.deflLim,Mu:purlin.Mu,phiMn:purlin.phiMn,sec:purlin.z.n,gov:purlin.gov,lines:2*(Math.ceil(W/2/P.purlinSp)-1)},
        rod:{n:rod.n,d:rod.d,ut:rod.ut,T:rod.T,phiTn:rod.phiTn},
        bracedBays:[2,Math.max(2,P.baysLong-1)],
        checks:{defl:dv*1000,deflLim:(clear?W:W/P.baysShort)*1000/P.deflLim,drift:Math.abs(wd.u[3*topN(0)])*1000,driftLim:P.eave*1000/P.driftLim},
        tonnage:0};
      out.tonnage=((pc.s.w*P.eave*colX.length+pr.s.w*(W/cs))*nF+purlin.z.w*out.purlin.lines*Lb/1000)/1000;
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
  const W=P.width||P.baysShort*P.spacing, sp=P.spacing, nB=P.baysLong, nF=nB+1, eave=P.eave, ridge=P.ridge;
  const th=Math.atan((ridge-eave)/(W/2)), c=Math.cos(th), s=Math.sin(th);
  const topY=x=>eave+(ridge-eave)*(1-Math.abs(2*x/W-1));
  const colSec=(R.col&&R.col.n)||R.col, rafSec=(R.raf&&R.raf.n)||R.raf, intSec=colSec;
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
  if(P.braceTube) p('   SectionName=SHS100X100X5   Material=SEC   Shape="Box/Tube"   t3=0.1   t2=0.1   tf=0.005   tw=0.005   Area=0.001900   TorsConst=4.71E-06   I33=2.923E-06   I22=2.923E-06   AS2=0.001000   AS3=0.001000   S33=5.85E-05   S22=5.85E-05   Z33=6.99E-05   Z22=6.99E-05   R33=0.0392   R22=0.0392   FromFile=No');
  if(P.purlinTube) p('   SectionName=RHS100X50X5   Material=SEC   Shape="Box/Tube"   t3=0.1   t2=0.05   tf=0.005   tw=0.005   Area=0.001400   TorsConst=1.28E-06   I33=1.740E-06   I22=5.61E-07   AS2=0.001000   AS3=0.000500   S33=3.48E-05   S22=2.25E-05   Z33=4.40E-05   Z22=2.77E-05   R33=0.0353   R22=0.0200   FromFile=No');
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
  const nbr=Math.max(2,Math.min(nB-2,P.bracedCount||2));
  const bb=[...new Set(Array.from({length:nbr},(_,i)=>Math.max(1,Math.min(nB-2,Math.round(1+i*(nB-3)/Math.max(1,nbr-1))))))];
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
  const secPG=P.purlinTube?"RHS100X50X5":ZN;
  purl.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${secPG}   MatProp=Default`));
  girts.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${secPG}   MatProp=Default`));
  rods.forEach(f=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${P.braceTube?'SHS100X100X5':'ROD24'}   MatProp=Default`));
  p('');
  p('TABLE:  "FRAME INSERTION POINT ASSIGNMENTS"');
  purl.forEach(f=>p(`   Frame=${f}   CardinalPt=1   Mirror2=No   StiffTransform=Yes`));
  p('');
  p('TABLE:  "FRAME RELEASE ASSIGNMENTS 1 - GENERAL"');
  rods.forEach(f=>p(`   Frame=${f}   PI=No   V2I=No   V3I=No   TI=Yes   M2I=Yes   M3I=Yes   PJ=No   V2J=No   V3J=No   TJ=No   M2J=Yes   M3J=Yes`));
  p('');
  if(!P.braceTube){
    p('TABLE:  "FRAME TENSION AND COMPRESSION LIMITS"');
    rods.forEach(f=>p(`   Frame=${f}   TensLimit=No   CompLimit=Yes   Compression=0`));
    p('');
  }
  if(P.braceTube||P.purlinTube){
    p('TABLE:  "OVERWRITES - STEEL DESIGN - AISC 360-16"');
    if(P.purlinTube){purl.forEach(f=>p(`   Frame=${f}   DesignSect="Program Determined"   XLMajor=1   XLMinor=0.5   XLLTB=0.5   Notes="sag tube at midspan"`));
      girts.forEach(f=>p(`   Frame=${f}   DesignSect="Program Determined"   XLMajor=1   XLMinor=0.5   XLLTB=0.5   Notes="sag tube at midspan"`));}
    if(P.braceTube)rods.forEach(f=>p(`   Frame=${f}   DesignSect="Program Determined"   XLMajor=0.5   XLMinor=0.5   XLLTB=0.5   Notes="X-crossing connected"`));
    p('');
  }
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
 const W=(P.width||P.baysShort*P.spacing)*1000, sp=P.spacing*1000, nB=P.baysLong, nF=nB+1;
 const eave=P.eave*1000, ridge=P.ridge*1000;
 const colSec=(R.col&&R.col.n)||R.col, rafSec=(R.raf&&R.raf.n)||R.raf, dC=DIM[colSec], dR=DIM[rafSec];
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
 const nbr2=Math.max(2,Math.min(nB-2,P.bracedCount||2));
 const bbI=[...new Set(Array.from({length:nbr2},(_,i)=>Math.max(1,Math.min(nB-2,Math.round(1+i*(nB-3)/Math.max(1,nbr2-1))))))];
 for(const b of bbI){const y0=b*sp,y1=(b+1)*sp;
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

/* ============ E2K WRITER (ETABS, beta — geometry + sections + basic loads) ============ */
function e2k(P,R){
  const W=P.width||P.baysShort*P.spacing, sp=P.spacing, nB=P.baysLong, nF=nB+1;
  const eave=P.eave, ridge=P.ridge;
  const topY=x=>eave+(ridge-eave)*(1-Math.abs(2*x/W-1));
  const colSec=(R.col&&R.col.n)||R.col, rafSec=(R.raf&&R.raf.n)||R.raf;
  const L=[]; const p=x=>L.push(x);
  p("$ PROGRAM INFORMATION");
  p('  PROGRAM "ETABS"  VERSION "21.0.0"');
  p("$ CONTROLS");
  p('  UNITS "kN" "m" "C"');
  p("$ MATERIAL PROPERTIES");
  p(`  MATERIAL "A36"  TYPE "Steel"  E ${(200e6).toFixed(0)}  U 0.3  FY ${(P.Fy*1000).toFixed(0)}  FU ${(P.Fy===250?400000:450000)}`);
  p("$ FRAME SECTIONS");
  [colSec,rafSec].filter((v,i,a)=>a.indexOf(v)===i).forEach(n=>{
    const d=DIM[n];
    p(`  FRAMESECTION "${n}"  MATERIAL "A36"  SHAPE "I/Wide Flange"  D ${(d[0]/1000).toFixed(4)}  B ${(d[1]/1000).toFixed(4)}  TF ${(d[2]/1000).toFixed(4)}  TW ${(d[3]/1000).toFixed(4)}`);
  });
  p('  FRAMESECTION "SHS120X5"  MATERIAL "A36"  SHAPE "Box/Tube"  D 0.12  B 0.12  TF 0.005  TW 0.005');
  p('  FRAMESECTION "ROD24"  MATERIAL "A36"  SHAPE "Circle"  D 0.024');
  p("$ POINT COORDINATES");
  let pid=0; const J={};
  const addp=(k,x,y,z)=>{pid++;J[k]=pid;p(`  POINT "${pid}"  ${(+x).toFixed(3)} ${(+y).toFixed(3)} ${(+z).toFixed(3)}`);};
  for(let f=0;f<nF;f++){const y=f*sp;[0,W/2,W].forEach(x=>addp(`b${f}_${x}`,x,y,0));[0,W/2,W].forEach(x=>addp(`t${f}_${x}`,x,y,topY(x)));}
  p("$ LINE CONNECTIVITY");
  let lid=0; const lines=[];
  const addl=(i,j,sec)=>{lid++;lines.push([lid,sec]);p(`  LINE "${lid}"  FRAME  "${J[i]}" "${J[j]}"  1`);};
  for(let f=0;f<nF;f++){
    [0,W].forEach(x=>addl(`b${f}_${x}`,`t${f}_${x}`,colSec));
    addl(`b${f}_${W/2}`,`t${f}_${W/2}`,colSec);
    addl(`t${f}_0`,`t${f}_${W/2}`,rafSec); addl(`t${f}_${W/2}`,`t${f}_${W}`,rafSec);
  }
  for(let f=0;f<nF-1;f++)[0,W/2,W].forEach(x=>addl(`t${f}_${x}`,`t${f+1}_${x}`,"SHS120X5"));
  p("$ LINE ASSIGNS");
  lines.forEach(([id,sec])=>p(`  LINEASSIGN "${id}"  SECTION "${sec}"`));
  p("$ RESTRAINTS");
  const RR=P.fixedBase?"1 1 1 1 1 1":"1 1 1 0 0 0";
  for(let f=0;f<nF;f++)[0,W/2,W].forEach(x=>p(`  POINTASSIGN "${J[`b${f}_${x}`]}"  RESTRAINT ${RR}`));
  p("$ STATIC LOADS");
  p('  LOADPATTERN "DEAD"  TYPE "Dead"  SELFWEIGHT 1');
  p('  LOADPATTERN "Lr"  TYPE "Roof Live"  SELFWEIGHT 0');
  p('  LOADPATTERN "WX"  TYPE "Wind"  SELFWEIGHT 0');
  p("$ END");
  p("$ NOTE: ETABS export is a geometry+section starter model (beta). Full R8 load model, DAM cases and C&C wind are in the .s2k export.");
  return L.join("\r\n");
}

// ---- CRC32 + store-only ZIP (real .docx, zero deps) ----
const CRCT=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=CRCT[(c^bytes[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function strBytes(s){const o=[];for(let i=0;i<s.length;i++){let c=s.charCodeAt(i);
  if(c<128)o.push(c);else if(c<2048){o.push(192|c>>6,128|c&63);}else{o.push(224|c>>12,128|c>>6&63,128|c&63);}}return o;}
function u16(n){return[n&255,n>>8&255];} function u32(n){return[n&255,n>>8&255,n>>16&255,n>>24&255];}
function zip(files){ // files:[{name,data(bytes)}]
  let cent=[],out=[],off=0;
  for(const f of files){const c=crc32(f.data),n=strBytes(f.name);
    const lh=[...u32(0x04034b50),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(c),...u32(f.data.length),...u32(f.data.length),...u16(n.length),...u16(0),...n,...f.data];
    out.push(...lh);
    cent.push([...u32(0x02014b50),...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(c),...u32(f.data.length),...u32(f.data.length),...u16(n.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(off),...n]);
    off+=lh.length;}
  const cs=off,cd=cent.flat();
  const eocd=[...u32(0x06054b50),...u16(0),...u16(0),...u16(files.length),...u16(files.length),...u32(cd.length),...u32(cs),...u16(0)];
  return new Uint8Array([...out,...cd,...eocd]);
}
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function docx(title,subtitle,sections){
  // sections:[{h,rows:[[k,v,tag]]}] or {h,para:"text"}
  const CT='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
  const RELS='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const DRELS='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const STYLES='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    +'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/></w:rPr></w:style>'
    +'<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="120"/><w:pBdr><w:bottom w:val="single" w:sz="18" w:color="1F3864"/></w:pBdr></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:color w:val="1F3864"/><w:sz w:val="34"/></w:rPr></w:style>'
    +'<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="220" w:after="80"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="1F3864"/></w:pBdr></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="24"/></w:rPr></w:style></w:styles>';
  let body='';
  body+=`<w:p><w:pStyle w:val="Title"/><w:r><w:t xml:space="preserve">${esc(title)}</w:t></w:r></w:p>`;
  body+=`<w:p><w:r><w:rPr><w:color w:val="666666"/><w:sz w:val="16"/></w:rPr><w:t xml:space="preserve">${esc(subtitle)}</w:t></w:r></w:p>`;
  for(const s of sections){
    body+=`<w:p><w:pStyle w:val="Heading1"/><w:r><w:t xml:space="preserve">${esc(s.h)}</w:t></w:r></w:p>`;
    if(s.para){ body+=`<w:p><w:r><w:t xml:space="preserve">${esc(s.para)}</w:t></w:r></w:p>`; continue; }
    body+='<w:tbl><w:tblPr><w:tblW w:w="9600" w:type="dxa"/><w:tblBorders><w:insideH w:val="single" w:sz="4" w:color="DDDDDD"/><w:bottom w:val="single" w:sz="4" w:color="DDDDDD"/></w:tblBorders></w:tblPr>'
      +'<w:tblGrid><w:gridCol w:w="2900"/><w:gridCol w:w="5100"/><w:gridCol w:w="1600"/></w:tblGrid>';
    for(const [k,v,tag] of s.rows){
      const red=tag&&(tag.includes('assumed')||tag.includes('verify'));
      const cell=(txt,w,opt={})=>`<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr>${opt.b?'<w:b/>':''}${opt.c?`<w:color w:val="${opt.c}"/>`:''}<w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(txt)}</w:t></w:r></w:p></w:tc>`;
      body+=`<w:tr>${cell(k,2900,{b:true})}${cell(v,5100)}${cell('['+(tag||'')+']',1600,{c:red?'B3261E':'888888'})}</w:tr>`;
    }
    body+='</w:tbl>';
  }
  const DOC=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>`;
  return zip([
    {name:'[Content_Types].xml',data:strBytes(CT)},
    {name:'_rels/.rels',data:strBytes(RELS)},
    {name:'word/document.xml',data:strBytes(DOC)},
    {name:'word/_rels/document.xml.rels',data:strBytes(DRELS)},
    {name:'word/styles.xml',data:strBytes(STYLES)},
  ]);
}


// Minimal multi-page PDF writer (Helvetica), dependency-free. Supports headings, key/value rows, wrapped paragraphs.
function pdfReport(title,subtitle,sections){
  const PW=595,PH=842,ML=54,MR=54,TOP=792,BOT=54;
  const WIDTHS={}; // use fixed avg char width for Helvetica ~0.5*size
  const pages=[]; let cur=[]; let yy=TOP;
  const esc=s=>String(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const charW=(s,sz)=>s.length*sz*0.5;
  const wrap=(s,sz,maxw)=>{const words=String(s).split(/\s+/);const lines=[];let ln='';
    for(const w of words){const t=ln?ln+' '+w:w; if(charW(t,sz)>maxw&&ln){lines.push(ln);ln=w;}else ln=t;} if(ln)lines.push(ln); return lines;};
  const newpage=()=>{if(cur.length)pages.push(cur);cur=[];yy=TOP;};
  const need=h=>{if(yy-h<BOT)newpage();};
  const text=(x,y,s,sz,rgb,bold)=>{cur.push(`BT /${bold?'F2':'F1'} ${sz} Tf ${rgb} rg ${x} ${y} Td (${esc(s)}) Tj ET`);};
  const line=(x1,y1,x2,y2,rgb)=>{cur.push(`${rgb} RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);};
  // title
  need(40); text(ML,yy,title,17,'0.12 0.22 0.39',true); yy-=6; line(ML,yy,PW-MR,yy,'0.12 0.22 0.39'); yy-=16;
  for(const l of wrap(subtitle,9,PW-ML-MR)){text(ML,yy,l,9,'0.4 0.4 0.4',false);yy-=12;}
  yy-=6;
  for(const s of sections){
    need(30); text(ML,yy,s.h,12,'0.12 0.22 0.39',true); yy-=4; line(ML,yy,PW-MR,yy,'0.12 0.22 0.39'); yy-=14;
    if(s.para){ for(const l of wrap(s.para,9.5,PW-ML-MR)){need(13);text(ML,yy,l,9.5,'0.1 0.1 0.1',false);yy-=13;} yy-=6; continue; }
    for(const [k,v,tag] of s.rows){
      const vlines=wrap(v,9,300), tagred=tag&&(tag.includes('assumed')||tag.includes('verify'));
      const rh=Math.max(vlines.length*11,12)+3; need(rh);
      text(ML,yy,k,9,'0.1 0.1 0.1',true);
      vlines.forEach((l,i)=>text(ML+150,yy-i*11,l,9,'0.15 0.15 0.15',false));
      if(tag)text(PW-MR-90,yy,'['+tag+']',8,tagred?'0.70 0.15 0.12':'0.53 0.53 0.53',false);
      yy-=rh; line(ML,yy+3,PW-MR,yy+3,'0.87 0.87 0.87');
    }
    yy-=6;
  }
  if(cur.length)pages.push(cur);
  // assemble PDF
  let obj=[],xref=[]; const enc=s=>s;
  const objs=[]; const add=s=>{objs.push(s);return objs.length;};
  const fontH=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontB=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const kids=[]; const contentIds=[];
  const pageObjIds=[];
  const pagesId=objs.length+1+pages.length*2+1; // rough; we will fix by ordering
  // We'll build: for each page a content stream obj + page obj
  const streamIds=[];
  pages.forEach(pc=>{const stream=pc.join('\n');const s=`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;streamIds.push(add(s));});
  const pagesObjId=objs.length+1+pages.length+1; // placeholder
  const realPageIds=[];
  pages.forEach((pc,i)=>{realPageIds.push(add(`<< /Type /Page /Parent PAGES_ID 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${fontH} 0 R /F2 ${fontB} 0 R >> >> /Contents ${streamIds[i]} 0 R >>`));});
  const pagesObj=add(`<< /Type /Pages /Kids [${realPageIds.map(i=>i+' 0 R').join(' ')}] /Count ${realPageIds.length} >>`);
  const catalog=add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  // patch PAGES_ID
  for(let i=0;i<objs.length;i++)objs[i]=objs[i].replace(/PAGES_ID/g,pagesObj);
  let pdf='%PDF-1.4\n'; const offs=[];
  objs.forEach((o,i)=>{offs.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xrefPos=pdf.length;
  pdf+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
  offs.forEach(o=>{pdf+=String(o).padStart(10,'0')+' 00000 n \n';});
  pdf+=`trailer\n<< /Size ${objs.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  const bytes=[];for(let i=0;i<pdf.length;i++)bytes.push(pdf.charCodeAt(i)&255);
  return new Uint8Array(bytes);
}



/* ============ DYNAMIC REPORT MODEL (assembled live from P + R) ============ */
function reportModel(P,R){
  const W=(P.width||P.baysShort*P.spacing), Wp=W, Lp=P.baysLong*P.spacing;
  const slope=(Math.atan((P.ridge-P.eave)/(W/2))*180/Math.PI).toFixed(1);
  const hbar=((P.eave+P.ridge)/2);
  const zg=P.exposure==="D"?213.36:274.32, al=P.exposure==="D"?11.5:9.5;
  const Kz=Math.max(0.85,2.01*Math.pow(hbar/zg,2/al));
  const qh=0.613*Kz*0.85*P.V*P.V/1000;
  const aStrip=Math.max(0.9,Math.min(0.1*W,0.4*hbar)).toFixed(1);
  const nbr=P.bracedCount||2;
  const colN=(R&&R.col&&R.col.n)||"(sizing)", rafN=(R&&R.raf&&R.raf.n)||"(sizing)";
  const bigZ=P.spacing>7?"Z 250x75x20x3.0":"Z 150x50x20x2.5";
  const title="INPUT & ASSUMPTIONS REPORT - INDUSTRIAL STEEL BUILDING";
  const sub=`SteelModeler v0.3  |  ${Wp} m x ${Lp} m  |  generated ${new Date().toISOString().slice(0,10)}  |  SBC 301-2018 loads  |  AISC 360-16 (LRFD)  |  Direct Analysis Method`;
  const sections=[
   {h:"Introduction",para:"This report documents every input and engineering assumption used to convert the natural-language brief into an analysis-ready model (.s2k / .e2k) and detailing model (.ifc). Values tagged [input] were taken from the brief; [computed] are derived by code; [assumed] and [assumed - verify] must be confirmed by the engineer of record before the model is used for design."},
   {h:"1. Geometry (from brief)",rows:[
     ["Plan dimensions",`${Wp} m wide x ${Lp} m long`,"input"],
     ["Frames",`${P.baysLong+1} frames @ ${P.spacing} m; interior column at ridge line`,"input / typology"],
     ["Eave / ridge height",`${P.eave} m / ${P.ridge} m (roof slope ${slope} deg)`,"input"],
     ["Purlin spacing",`${P.purlinSp} m on plan; section ${bigZ}`,P.spacing>7?"computed":"assumed default"],
     ["Girt levels",`every 1.8 m up each wall`,"assumed default"]]},
   {h:"2. Materials",rows:[
     ["Primary steel",`${P.grade}, Fy = ${P.Fy} MPa`,"input"],
     ["Columns / rafters",`${colN} / ${rafN}`,R?"sized":"pending sizing"],
     ["Secondary (purlins/girts)","A653 SS Gr50 cold-formed Z, Fy = 345 MPa","assumed default"]]},
   {h:"3. Gravity loads",rows:[
     ["Dead","member self-weight (SAP SelfWtMult = 1)","assumed"],
     ["Superimposed dead",`roof ${P.cladding} + services ${P.services} = ${(P.cladding+P.services).toFixed(2)} kN/m2; walls 0.10 kN/m2`,"assumed default"],
     ["Roof live Lr",`${P.Lr} kN/m2, applied on plan projection via purlins`,P.Lr!==0.96?"input":"assumed default"],
     ["No double counting","surface loads applied on purlins/girts only, delivered to frames","locked rule"]]},
   {h:"4. Wind (SBC 301-2018 / ASCE 7)",rows:[
     ["Risk Category",`${P.riskCat}`,"input"],
     ["Basic wind speed V",`${P.V} m/s`,"input"],
     ["Exposure",`${P.exposure}`,"derived from site"],
     ["Kz @ mean roof ht",`${Kz.toFixed(3)} at ${hbar.toFixed(1)} m`,"computed"],
     ["Kzt / Kd / G","1.0 / 0.85 / 0.85","assumed"],
     ["GCpi (enclosure)","+/-0.18 (enclosed)","assumed"],
     ["qh",`${qh.toFixed(3)} kN/m2`,"computed"],
     ["C&C zoning",`roof -0.8/-1.3/-2.0, walls -0.90/-1.05, edge strip a = ${aStrip} m`,"code Ch.30"],
     ["C&C load path","zoned C&C carried through purlins/girts to main frames (conservative)","locked decision"],
     ["Gable wind","distributed on end-frame columns; corner columns biaxial","method"],
     ["Diaphragm",P.flexDiaphragm?"flexible - tributary; long. wind to braced bays":"flexible (default)","input"]]},
   {h:"5. Seismic",rows:[
     ["SDC","A assumed (Riyadh): min lateral force 0.01W. Verify Ss/S1 - western/Tabuk can be higher","assumed - verify"]]},
   {h:"6. Stability & analysis",rows:[
     ["Method","Direct Analysis: NL P-Delta, 0.8 EA & 0.8 EI, tau-b, K = 1","locked rule"],
     ["Notional loads","0.002 x (D, SDL, Lr) in X and Y","code"],
     ["Base fixity",P.fixedBase?"FIXED (eave >= 9 m or requested) - foundations resist moment":"PINNED","rule / input"],
     ["Bracing",`Ø24 tension-only rod X-bracing in ${nbr} bays; SHS eave/ridge struts`,"assumed default"]]},
   {h:"7. Serviceability (hard constraints)",rows:[
     ["Eave drift",`H/${P.driftLim} under D + 0.6W`,"limit"],
     ["Member deflection",`live L/${P.deflLim}`,"limit"]]},
  ];
  if(P.notes&&P.notes.length) sections.push({h:"8. Automatic decisions",rows:P.notes.map(n=>["-",n,"auto"])});
  if(P.warnings&&P.warnings.length) sections.push({h:"9. Parse warnings",rows:P.warnings.map(w=>["!",w,"verify"])});
  return {title,sub,sections};
}

/* ============ PARKING SHADE (cantilever flagpole) — parser + engine + s2k + ifc ============ */
function parseShade(t){
  const s=t.toLowerCase(); const warn=[],note=[];
  const M="m(?:eters?|tr?s?)?\\.?";
  const num=(res,d)=>{for(const re of res){const m=s.match(re);if(m)return parseFloat(m[1]);}return d;};
  const cant=num([new RegExp("cantilever\\s*(?:of\\s*|is\\s*)?(\\d+(?:\\.\\d+)?)\\s*"+M),
                  new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"\\s*cantilever"),
                  new RegExp("(?:reach|arm|boom|projection)\\s*(?:of\\s*)?(\\d+(?:\\.\\d+)?)")],7.7);
  const spacing=num([new RegExp("spacings?\\s*(?:of\\s*|is\\s*)?(\\d+(?:\\.\\d+)?)\\s*"+M),
                     new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"\\s*(?:spacing|bays?)"),
                     new RegExp("every\\s*(\\d+(?:\\.\\d+)?)\\s*"+M)],5);
  const nbay=num([/(\d+)\s*bays?/,/(\d+)\s*spans?/],4);
  const height=num([new RegExp("(?:column\\s*)?height\\s*(?:of\\s*|is\\s*)?(\\d+(?:\\.\\d+)?)"),
                    new RegExp("(\\d+(?:\\.\\d+)?)\\s*"+M+"\\s*(?:high|height|clear)")],3.3);
  const rise=num([new RegExp("rise\\s*(?:of\\s*)?(\\d+(?:\\.\\d+)?)"),new RegExp("slope\\s*rise\\s*(\\d+(?:\\.\\d+)?)")],0.5);
  let V=44,exposure="D",loc="Yanbu (coastal)";
  if(/riyadh/.test(s)){V=42;exposure="C";loc="Riyadh";}
  else if(/jeddah|yanbu|jubail|dammam|khobar|dhahran|coastal|red\s*sea/.test(s)){V=44;exposure="D";loc="Coastal (Exp D)";}
  const vs=s.match(/wind\s*(?:speed|velocity)?\s*(?:is\s*|of\s*|=\s*)?(\d+(?:\.\d+)?)\s*m\s*\/?\s*s/);
  if(vs){V=parseFloat(vs[1]);note.push("Explicit wind speed "+V+" m/s");}
  let sdc="A"; if(/sdc\s*b|category\s*b/.test(s)){sdc="B";}
  const dead=num([/dead\s*(?:load\s*)?(?:of\s*|is\s*|=\s*)?(\d+(?:\.\d+)?)/,/(\d+(?:\.\d+)?)\s*kpa/],0.15);
  const live=num([/live\s*(?:load\s*)?(?:of\s*|is\s*|=\s*)?(\d+(?:\.\d+)?)/],0.75);
  note.push("Open monoslope free roof — SBC 301 / ASCE 7-16 Fig 27.4-4 (CN Case A down, Case B uplift)");
  note.push("Fixed-base flagpole → nonlinear P-Delta required");
  note.push("SDC "+sdc+" assumed — verify Ss/S1 for the site");
  note.push("Roof live "+live+" kN/m² (inaccessible canopy) — verify");
  return {typ:"shade",cant,spacing,nbay,height,rise,V,exposure,loc,sdc,dead,live,Fy:345,warnings:warn,notes:note};
}
function shadeEngine(P){
  const hbar=P.height+P.rise/2, zg=P.exposure==="D"?213.36:274.32, al=P.exposure==="D"?11.5:9.5;
  const Kz=Math.max(0.85,2.01*Math.pow(hbar/zg,2/al)), qh=0.613*Kz*0.85*P.V*P.V/1000;
  const theta=Math.atan(P.rise/P.cant)*180/Math.PI;
  const areaTrib=P.cant*P.spacing;
  // governing base moment (down 1.2D+1.6Lr, and uplift 0.9D+W)
  const wDn=1.2*P.dead+1.6*P.live, Mdn=wDn*areaTrib*P.cant/2;
  const pUp=qh*0.85*1.1, Mup=(pUp*areaTrib - 0.9*P.dead*areaTrib)*P.cant/2;
  // pick column & boom from DB by moment (φMn), start IPE330
  const pick=M=>{for(const x of DB){const phiMn=0.9*P.Fy*1000*x.Zx/1e6;if(phiMn>=M*1.05)return {n:x.n,phiMn,ut:M/phiMn};}const x=DB[DB.length-1];return {n:x.n,phiMn:0.9*P.Fy*1000*x.Zx/1e6,ut:M/(0.9*P.Fy*1000*x.Zx/1e6)};};
  const Mgov=Math.max(Mdn,Math.abs(Mup));
  const boom=pick(Mgov), col=pick(Mgov*1.05);
  return {qh,Kz,theta,areaTrib,Mdn,Mup:Math.abs(Mup),Mgov,boom,col,nF:P.nbay+1,
    Ly:P.nbay*P.spacing,hbar};
}
function shadeS2K(P,R){
  const H=P.height*1000,cant=P.cant*1000,rise=P.rise*1000,sp=P.spacing*1000;
  const nF=P.nbay+1, frames=Array.from({length:nF},(_,i)=>i*sp);
  const Ymin=-800,Ymax=P.nbay*sp+2300;
  const purlX=[0,0.1667,0.3333,0.5,0.6667,0.8333,1.0].map(f=>f*cant);
  const boomZ=x=>H+rise*x/cant;
  const L=[];const p=x=>L.push(x);
  const col=(R.col&&R.col.n)||"HEB240", boom=(R.boom&&R.boom.n)||"IPE360";
  p('File Parking_Shade.s2k');p('');
  p('TABLE:  "PROGRAM CONTROL"');p('   ProgramName=SAP2000   Version=25.1.0   CurrUnits="KN, m, C"   SteelCode="AISC 360-16"');p('');
  p('TABLE:  "ACTIVE DEGREES OF FREEDOM"');p('   UX=Yes   UY=Yes   UZ=Yes   RX=Yes   RY=Yes   RZ=Yes');p('');
  p('TABLE:  "MATERIAL PROPERTIES 01 - GENERAL"');p('   Material=A992Fy50   Type=Steel   SymType=Isotropic');p('   Material=A653Gr50   Type=ColdFormed   SymType=Isotropic');p('');
  p('TABLE:  "MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES"');
  p('   Material=A992Fy50   UnitWeight=76.9729   E1=199948000   G12=76903000   U12=0.3   A1=1.17E-05');
  p('   Material=A653Gr50   UnitWeight=76.9729   E1=203395000   G12=78228846   U12=0.3   A1=1.17E-05');p('');
  p('TABLE:  "MATERIAL PROPERTIES 03A - STEEL DATA"');p(`   Material=A992Fy50   Fy=${P.Fy*1000}   Fu=448159   SSHysType=Kinematic`);p(`   Material=A653Gr50   Fy=${P.Fy*1000}   Fu=448159   SSHysType=Kinematic`);p('');
  p('TABLE:  "FRAME SECTION PROPERTIES 01 - GENERAL"');
  [col,boom].filter((v,i,a)=>a.indexOf(v)===i).forEach(nm=>{const d=DIM[nm]||[360,170,12.7,8];const e=DB.find(x=>x.n===nm)||DB[8];
    p(`   SectionName=${nm}   Material=A992Fy50   Shape="I/Wide Flange"   t3=${(d[0]/1000).toFixed(4)}   t2=${(d[1]/1000).toFixed(4)}   tf=${(d[2]/1000).toFixed(4)}   tw=${(d[3]/1000).toFixed(4)}   Area=${(e.A/1e4).toFixed(6)}   I33=${(e.Ix/1e8).toExponential(4)}   Z33=${(e.Zx/1e6).toExponential(4)}   R33=${(e.rx/100).toFixed(4)}   R22=${(e.ry/100).toFixed(4)}   FromFile=No`);});
  p('   SectionName=PUR_Z   Material=A653Gr50   Shape="Cold Formed Z"   t3=0.2   t2=0.065   tw=0.0025   LipDepth=0.02   LipAngle=45   Area=0.000910   I33=5.70E-06   S33Top=5.70E-05   FromFile=No');p('');
  p('TABLE:  "FRAME PROPERTY MODIFIERS"');[col,boom].filter((v,i,a)=>a.indexOf(v)===i).forEach(nm=>p(`   SectionName=${nm}   AMod=0.8   I2Mod=0.8   I3Mod=0.8   Notes="DAM 0.8"`));p('');
  p('TABLE:  "LOAD PATTERN DEFINITIONS"');
  p('   LoadPat=DEAD   DesignType=Dead   SelfWtMult=1');p('   LoadPat=SDL   DesignType="Super Dead"   SelfWtMult=0');p('   LoadPat=LIVE   DesignType="Roof Live"   SelfWtMult=0');
  ["WIND_DN","WIND_UP","WINDY"].forEach(n=>p(`   LoadPat=${n}   DesignType=Wind   SelfWtMult=0`));
  ["EQX","EQY"].forEach(n=>p(`   LoadPat=${n}   DesignType=Quake   SelfWtMult=0`));
  [["NDX","DEAD","X"],["NDY","DEAD","Y"],["NLX","LIVE","X"],["NLY","LIVE","Y"]].forEach(([n,b,d])=>p(`   LoadPat=${n}   DesignType=Notional   SelfWtMult=0   NotBasePat=${b}   NotRatio=0.002   NotDir="Global ${d}"`));p('');
  let jid=0;const J={};const jt=(x,y,z)=>{const k=x.toFixed(2)+','+y.toFixed(2)+','+z.toFixed(2);if(J[k])return J[k];jid++;J[k]=jid;return jid;};
  const jrows=[];const emit=(x,y,z)=>{const id=jt(x,y,z);jrows[id]=`   Joint=${id}   CoordSys=GLOBAL   CoordType=Cartesian   XorR=${(x/1000).toFixed(4)}   Y=${(y/1000).toFixed(4)}   Z=${(z/1000).toFixed(4)}`;return id;};
  const FR=[];let fid=0;const fr=(i,j,sec,grp)=>{fid++;FR.push([fid,i,j,sec,grp]);return fid;};
  const bases=[];
  frames.forEach(y=>{const b=emit(0,y,0),tp=emit(0,y,H);bases.push(b);
    fr(b,tp,col,"COL");let prev=tp;purlX.slice(1).forEach(x=>{const n=emit(x,y,boomZ(x));fr(prev,n,boom,"BOOM");prev=n;});});
  const allY=[Ymin,...frames,Ymax];
  purlX.forEach(x=>{allY.slice(0,-1).forEach((a,i)=>{fr(emit(x,a,boomZ(x)),emit(x,allY[i+1],boomZ(x)),"PUR_Z","PUR");});});
  frames.slice(0,-1).forEach((a,i)=>fr(emit(0,a,H),emit(0,frames[i+1],H),boom,"TIE"));
  p('TABLE:  "JOINT COORDINATES"');for(let i=1;i<=jid;i++)p(jrows[i]);p('');
  p('TABLE:  "CONNECTIVITY - FRAME"');FR.forEach(([f,i,j])=>p(`   Frame=${f}   JointI=${i}   JointJ=${j}   IsCurved=No`));p('');
  p('TABLE:  "JOINT RESTRAINT ASSIGNMENTS"');bases.forEach(b=>p(`   Joint=${b}   U1=Yes   U2=Yes   U3=Yes   R1=Yes   R2=Yes   R3=Yes`));p('');
  p('TABLE:  "FRAME SECTION ASSIGNMENTS"');FR.forEach(([f,i,j,sec])=>p(`   Frame=${f}   AutoSelect=N.A.   AnalSect=${sec}   MatProp=Default`));p('');
  p('TABLE:  "FRAME RELEASE ASSIGNMENTS 1 - GENERAL"');FR.forEach(([f,i,j,sec,grp])=>{if(grp==="PUR"||grp==="TIE")p(`   Frame=${f}   TI=No   M2I=Yes   M3I=Yes   M2J=Yes   M3J=Yes`);});p('');
  const hbar=(H+rise)/1000/2+P.height/2, Kz=R.Kz, qh=R.qh, G=0.85, pw=cant/6/1000;
  p('TABLE:  "FRAME LOADS - DISTRIBUTED"');
  FR.filter(f=>f[4]==="PUR").forEach(([f])=>{
    p(`   Frame=${f}   LoadPat=SDL   CoordSys=GLOBAL   Type=Force   Dir=Gravity   DistType=RelDist   RelDistA=0   RelDistB=1   FOverLA=${(P.dead*pw).toFixed(4)}   FOverLB=${(P.dead*pw).toFixed(4)}`);
    p(`   Frame=${f}   LoadPat=LIVE   CoordSys=GLOBAL   Type=Force   Dir=Gravity   DistType=RelDist   RelDistA=0   RelDistB=1   FOverLA=${(P.live*pw).toFixed(4)}   FOverLB=${(P.live*pw).toFixed(4)}`);
    p(`   Frame=${f}   LoadPat=WIND_DN   CoordSys=GLOBAL   Type=Force   Dir=Gravity   DistType=RelDist   RelDistA=0   RelDistB=1   FOverLA=${(qh*G*1.2*pw).toFixed(4)}   FOverLB=${(qh*G*1.2*pw).toFixed(4)}`);
    p(`   Frame=${f}   LoadPat=WIND_UP   CoordSys=GLOBAL   Type=Force   Dir=Z   DistType=RelDist   RelDistA=0   RelDistB=1   FOverLA=${(qh*G*1.1*pw).toFixed(4)}   FOverLB=${(qh*G*1.1*pw).toFixed(4)}`);
  });p('');
  p('TABLE:  "JOINT LOADS - FORCE"');
  const Wseis=P.dead*P.cant*P.spacing;
  frames.forEach((y,i)=>{const tp=jt(0,y,H);const fac=(i===0||i===nF-1)?0.5:1;
    p(`   Joint=${tp}   LoadPat=EQX   CoordSys=GLOBAL   F1=${(0.01*Wseis*fac).toFixed(3)}   F2=0   F3=0`);
    p(`   Joint=${tp}   LoadPat=EQY   CoordSys=GLOBAL   F1=0   F2=${(0.01*Wseis*fac).toFixed(3)}   F3=0`);
    p(`   Joint=${tp}   LoadPat=WINDY   CoordSys=GLOBAL   F1=0   F2=${(qh*G*1.3*P.height*0.24*fac).toFixed(3)}   F3=0`);});p('');
  const STR=[["1.4D",[["DEAD",1.4],["SDL",1.4],["NDX",1.4],["NDY",1.4]]],
    ["1.2D+1.6Lr+0.5Wd",[["DEAD",1.2],["SDL",1.2],["LIVE",1.6],["WIND_DN",0.5],["NDX",1.2],["NLX",1.6]]],
    ["1.2D+1.0Wd+0.5Lr",[["DEAD",1.2],["SDL",1.2],["WIND_DN",1],["LIVE",0.5]]],
    ["1.2D+1.0Wup+0.5Lr",[["DEAD",1.2],["SDL",1.2],["WIND_UP",1],["LIVE",0.5]]],
    ["1.2D+1.0Wy+0.5Lr",[["DEAD",1.2],["SDL",1.2],["WINDY",1],["LIVE",0.5]]],
    ["1.2D+1.0EQX",[["DEAD",1.2],["SDL",1.2],["EQX",1]]],["1.2D+1.0EQY",[["DEAD",1.2],["SDL",1.2],["EQY",1]]],
    ["0.9D+1.0Wup",[["DEAD",0.9],["SDL",0.9],["WIND_UP",1]]],["0.9D+1.0Wy",[["DEAD",0.9],["SDL",0.9],["WINDY",1]]],
    ["0.9D+1.0EQX",[["DEAD",0.9],["SDL",0.9],["EQX",1]]],["0.9D+1.0EQY",[["DEAD",0.9],["SDL",0.9],["EQY",1]]]];
  const SVC=[["D+Lr(Svc)",[["DEAD",1],["SDL",1],["LIVE",1]]],["D+0.6Wup(Svc)",[["DEAD",1],["SDL",1],["WIND_UP",0.6]]],["D+0.6Wy(Svc)",[["DEAD",1],["SDL",1],["WINDY",0.6]]]];
  const allpat=["DEAD","SDL","LIVE","WIND_DN","WIND_UP","WINDY","EQX","EQY","NDX","NDY","NLX","NLY"];
  const dt={DEAD:"Dead",SDL:'"Super Dead"',LIVE:'"Roof Live"',WIND_DN:"Wind",WIND_UP:"Wind",WINDY:"Wind",EQX:"Quake",EQY:"Quake"};
  p('TABLE:  "LOAD CASE DEFINITIONS"');allpat.forEach(n=>p(`   Case=${n}   Type=LinStatic   InitialCond=Zero   DesignType=${dt[n]||"Notional"}   RunCase=Yes`));
  STR.forEach(([nm])=>p(`   Case="NL ${nm}"   Type=NonStatic   InitialCond=Zero   DesignType=Other   RunCase=Yes`));p('');
  p('TABLE:  "CASE - STATIC 1 - LOAD ASSIGNMENTS"');allpat.forEach(n=>p(`   Case=${n}   LoadType="Load pattern"   LoadName=${n}   LoadSF=1`));
  STR.forEach(([nm,terms])=>terms.forEach(([pt,f])=>p(`   Case="NL ${nm}"   LoadType="Load pattern"   LoadName=${pt}   LoadSF=${f}`)));p('');
  p('TABLE:  "CASE - STATIC 4 - NONLINEAR PARAMETERS"');STR.forEach(([nm])=>p(`   Case="NL ${nm}"   GeoNonLin="P-Delta"   ResultsSave="Final State"   MaxTotalSteps=200   ItConvTol=0.0001`));p('');
  p('TABLE:  "COMBINATION DEFINITIONS"');
  STR.forEach(([nm])=>p(`   ComboName="${nm}"   ComboType="Linear Add"   CaseName="NL ${nm}"   ScaleFactor=1   SteelDesign=Strength`));
  SVC.forEach(([nm,terms])=>{const[p0,f0]=terms[0];p(`   ComboName="${nm}"   ComboType="Linear Add"   CaseName=${p0}   ScaleFactor=${f0}   SteelDesign=Deflection`);terms.slice(1).forEach(([pt,f])=>p(`   ComboName="${nm}"   CaseName=${pt}   ScaleFactor=${f}`));});p('');
  p('TABLE:  "PREFERENCES - STEEL DESIGN - AISC 360-16"');p(`   FrameType=OMF   SRatioLimit=0.95   SDC=${P.sdc}   Provision=LRFD   AMethod="Direct Analysis"   SRMethod="Tau-b Fixed"   NLCoeff=0.002   CheckDefl=Yes   TotalRat=180`);p('');
  p('END TABLE DATA');
  return L.join("\r\n");
}

/* ============ UI ============ */
const T={ink:"#15222C",paper:"#F2F5F6",line:"#C9D3D8",blue:"#23577F",hot:"#D14E12",ok:"#1D7A4F",bad:"#B3261E",mono:"'JetBrains Mono',ui-monospace,'SF Mono',Consolas,monospace"};
const Lbl=({c})=><div style={{fontSize:10,letterSpacing:"0.14em",textTransform:"uppercase",color:T.blue,fontWeight:700,marginBottom:4}}>{c}</div>;

export default function App(){
  const [text,setText]=useState("I want an industrial steel building with 6 meters height in at edges and 8 m at centre, 2 bays in short direction and 8 bays in longitudinal direction, each bay shall have spacing 6 m, A36 steel, design per SBC 301 and AISC.");
  const [typ,setTyp]=useState("industrial");
  const [P,setP]=useState(()=>parseText("6 meters at edges 8 m at centre 2 bays in short 8 bays in long spacing 6 a36"));
  const [tab,setTab]=useState("model");
  const R=useMemo(()=>{try{return typ==="shade"?shadeEngine(P):engine(P);}catch(e){return null;}},[P,typ]);
  const [msg,setMsg]=useState("");
  const dl=(txt,name)=>{
    const b=new Blob([txt],{type:"application/octet-stream"});
    const url=URL.createObjectURL(b);
    const a=document.createElement("a");
    a.href=url; a.download=name; a.rel="noopener"; a.style.display="none";
    document.body.appendChild(a);   // required by Firefox / some sandboxes
    a.click();
    setTimeout(()=>{document.body.removeChild(a); URL.revokeObjectURL(url);},1500);
  };
  const dlSafe=(fn,name)=>{
    if(!R){ setMsg("⚠ Generate a model first (press GENERATE MODEL)."); return; }
    try{ const t=fn(); if(!t||!t.length){ setMsg("⚠ Export produced no data."); return; }
      dl(t,name); setMsg("✓ "+name+" downloaded ("+(t.length/1024).toFixed(0)+" KB). Check your browser's Downloads folder.");
    }catch(e){ setMsg("✗ Export failed: "+(e&&e.message||e)); console.error(e); }
  };
  const dlBin=(fn,name)=>{
    if(!R){ setMsg("⚠ Generate a model first (press GENERATE MODEL)."); return; }
    try{ const bytes=fn(); const b=new Blob([bytes],{type:name.endsWith(".pdf")?"application/pdf":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
      const url=URL.createObjectURL(b); const a=document.createElement("a"); a.href=url; a.download=name; a.style.display="none";
      document.body.appendChild(a); a.click(); setTimeout(()=>{document.body.removeChild(a);URL.revokeObjectURL(url);},1500);
      setMsg("✓ "+name+" downloaded ("+(bytes.length/1024).toFixed(0)+" KB).");
    }catch(e){ setMsg("✗ Report export failed: "+(e&&e.message||e)); console.error(e); }
  };
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
      <div style={{fontSize:11,color:T.blue,fontFamily:T.mono}}>v0.3 · NL parser v2 · R8 s2k + Tekla IFC + input report · SBC 301-2018 · AISC 360 DAM</div>
    </div>

    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
      {typs.map(([k,l])=>{const active=k==="industrial"||k==="shade";return <button key={k}
        onClick={()=>{if(!active)return; setTyp(k);
          if(k==="shade"){const dt="parking shade in Yanbu, 5 m spacing, 4 bays, 7.7 m cantilever, column height 3.3 m, dead 0.15 kpa, live 0.75, SDC A"; setText(dt); setP(parseShade(dt)); setTab("model");}
          else {const dt="industrial building 6 m eave 8 m ridge 2 bays short 8 bays long spacing 6 m a36"; setText(dt); setP(parseText(dt)); setTab("model");}}}
        style={{padding:"6px 12px",fontSize:12,fontWeight:700,border:`1.5px solid ${typ===k?T.hot:active?T.ink:T.line}`,background:typ===k?T.hot:"#fff",color:typ===k?"#fff":active?T.ink:"#98A6AE",borderRadius:2,cursor:active?"pointer":"not-allowed"}}>
        {l}{!active&&<span style={{fontWeight:400}}> · soon</span>}</button>;})}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"minmax(280px,380px) 1fr",gap:14,alignItems:"start"}}>
      <div>
        <Lbl c="Describe the building"/>
        <textarea value={text} onChange={e=>setText(e.target.value)} rows={5}
          style={{width:"100%",padding:10,border:`1px solid ${T.line}`,borderRadius:2,fontFamily:T.mono,fontSize:12.5,lineHeight:1.5,background:"#fff",color:T.ink,resize:"vertical"}}/>
        <button onClick={()=>setP(typ==="shade"?parseShade(text):({...parseText(text),purlinSp:P.purlinSp}))}
          style={{marginTop:8,width:"100%",padding:"10px 0",background:T.hot,color:"#fff",border:"none",borderRadius:2,fontWeight:800,fontSize:13,letterSpacing:"0.08em",cursor:"pointer"}}>GENERATE MODEL</button>
        <div style={{marginTop:8,fontFamily:T.mono,fontSize:11.5,lineHeight:1.6}}>
          <div style={{color:T.ink}}>PARSED&nbsp;&nbsp;W {P.width||P.baysShort*P.spacing} m × L {P.baysLong*P.spacing} m · eave {P.eave} m · ridge {P.ridge} m · {P.baysLong} bays @ {P.spacing} m · Risk Cat {P.riskCat} (V={P.V} m/s) · {P.grade}{P.flexDiaphragm?" · flexible diaphragm":""} · DAM</div>
          {(P.warnings||[]).map((w,i)=><div key={i} style={{color:"#B3261E"}}>⚠ {w}</div>)}
          {R&&<div style={{color:"#1B7A2F",fontWeight:700,marginTop:4}}>✓ Model generated — Input report, .s2k (SAP2000 R8), .e2k (ETABS) and .ifc (Tekla) are ready. Open the Export and Input report tabs to download.</div>}
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
          {R&&tab==="report"&&(()=>{const RM=reportModel(P,R);return <div style={{fontFamily:T.mono,fontSize:12}}>
            <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
              <button onClick={()=>dlBin(()=>docx(RM.title,RM.sub,RM.sections),`Input_Report_${R.W}x${R.Lb}.docx`)} style={{padding:"12px 18px",background:T.blue,color:"#fff",border:"none",borderRadius:2,fontWeight:800,fontSize:13,cursor:"pointer"}}>Download .docx (Word)</button>
              <button onClick={()=>dlBin(()=>pdfReport(RM.title,RM.sub,RM.sections),`Input_Report_${R.W}x${R.Lb}.pdf`)} style={{padding:"12px 18px",background:T.hot,color:"#fff",border:"none",borderRadius:2,fontWeight:800,fontSize:13,cursor:"pointer"}}>Download .pdf</button>
            </div>
            {msg&&<div style={{marginBottom:12,fontFamily:T.mono,fontSize:12,fontWeight:700,color:msg[0]==="✓"?T.ok:msg[0]==="✗"?T.bad:T.blue}}>{msg}</div>}
            <div style={{border:`1px solid ${T.line}`,padding:20,maxHeight:520,overflow:"auto",background:"#fff"}}>
              <div style={{fontWeight:800,fontSize:16,color:T.blue,borderBottom:`2px solid ${T.blue}`,paddingBottom:4}}>{RM.title}</div>
              <div style={{color:"#666",fontSize:11,margin:"6px 0 4px"}}>{RM.sub}</div>
              {RM.sections.map((s,i)=><div key={i} style={{marginTop:12}}>
                <div style={{fontWeight:800,color:T.blue,borderBottom:`1px solid ${T.blue}`,paddingBottom:2,marginBottom:4}}>{s.h}</div>
                {s.para?<div style={{fontSize:11.5,lineHeight:1.6}}>{s.para}</div>:
                 <table style={{width:"100%",borderCollapse:"collapse"}}><tbody>
                  {s.rows.map((r,j)=><tr key={j} style={{borderBottom:"1px solid #eee"}}>
                    <td style={{padding:"3px 6px",width:"28%",fontWeight:700,verticalAlign:"top"}}>{r[0]}</td>
                    <td style={{padding:"3px 6px"}}>{r[1]}</td>
                    <td style={{padding:"3px 6px",width:"16%",color:(r[2]&&(r[2].includes("assumed")||r[2].includes("verify")))?"#B3261E":"#888",whiteSpace:"nowrap"}}>[{r[2]}]</td></tr>)}
                 </tbody></table>}
              </div>)}
            </div>
            <div style={{marginTop:8,fontSize:11,color:"#5B6B74"}}>This report regenerates automatically from the current model above. Red [assumed - verify] items require the engineer of record's confirmation.</div>
          </div>;})()}
          {R&&tab==="export"&&<div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              <button onClick={()=>dlSafe(()=>typ==="shade"?shadeS2K(P,R):s2kR8(P,R),typ==="shade"?`Parking_Shade_${P.cant}m.s2k`:`Industrial_${R.W}x${R.Lb}_R8.s2k`)} style={{padding:"12px 18px",background:T.ink,color:"#fff",border:"none",borderRadius:2,fontWeight:800,fontSize:13,cursor:"pointer"}}>Download .s2k (SAP2000, R8)</button>
              <button onClick={()=>dlSafe(()=>ifcWrite(P,R),`Industrial_${R.W}x${R.Lb}.ifc`)} style={{padding:"12px 18px",marginLeft:8,background:T.hot,color:"#fff",border:"none",borderRadius:2,fontWeight:800,fontSize:13,cursor:"pointer"}}>Download .ifc (Tekla)</button>
              <button onClick={()=>dlSafe(()=>e2k(P,R),`Industrial_${R.W}x${R.Lb}.e2k`)} style={{padding:"12px 18px",background:"#fff",color:T.ink,border:`2px solid ${T.ink}`,borderRadius:2,fontWeight:800,fontSize:13,cursor:"pointer"}}>Download .e2k (ETABS, beta)</button>
              {msg&&<div style={{marginTop:10,fontFamily:T.mono,fontSize:12,fontWeight:700,color:msg[0]==="✓"?T.ok:msg[0]==="✗"?T.bad:T.blue}}>{msg}</div>}
            </div>
            <div style={{marginTop:12,fontFamily:T.mono,fontSize:12,lineHeight:1.9,color:"#40525C"}}>
              .s2k contents: {R.nF} frames · {R.purlin.lines} purlin lines ({P.purlinTube?'RHS 100x50x5 tubes, sag tubes at midspan':'Z cold-formed, continuous, cardinal pt 1'}) · eave/ridge SHS struts · {P.braceTube?'SHS100x100x5 X-bracing (tension AND compression, crossing connected)':'Ø24 tension-only rod X-bracing'} in bays {R.bracedBays[0]} & {R.bracedBays[1]} (walls + roof) · loads on purlins only · 13 strength + 4 service combos, self-describing names · notionals inline (NotBasePat) · AutoLoad=None on wind/quake · Compression=0 on rods · DAM steel preferences.
            </div>
          </div>}
        </div>
      </div>
    </div>
  </div>);
}
