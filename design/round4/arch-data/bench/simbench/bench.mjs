// Rough per-entity cost of Factorio-style hot loops in SoA typed arrays (V8, this host).
function time(name, n, ticks, fn) { fn(10); const t0 = performance.now(); fn(ticks); const dt = performance.now() - t0; console.log(`${name.padEnd(46)} ${(dt/ticks).toFixed(3)} ms/tick  ${(dt/ticks/n*1e6).toFixed(1)} ns/entity`); }
// 1. Transport lines: gap-encoded, O(1) per line per tick + item handoff
{ const L = 40000, CAP = 64; const gaps = new Int32Array(L*CAP), count = new Int32Array(L), frontGap = new Int32Array(L), activeGap = new Int32Array(L), next = new Int32Array(L), backGap = new Int32Array(L);
  for (let l=0;l<L;l++){ count[l]=CAP/2; for(let i=0;i<CAP;i++) gaps[l*CAP+i]= (i%5)*16; frontGap[l]=256; next[l]=(l*7919)%L; activeGap[l]=0; backGap[l]=512; }
  time('transport lines (40k lines, 32 items each)', L, 600, (T)=>{ for(let t=0;t<T;t++){ for(let l=0;l<L;l++){ const sp=8; if (frontGap[l]>=sp){ frontGap[l]-=sp; backGap[l]+=sp; }
        else { const n=next[l]; if (count[l]>0 && backGap[n]>=64 && count[n]<CAP){ count[l]--; count[n]++; backGap[n]-=64; frontGap[l]+=64; }
               else { let a=activeGap[l]; const base=l*CAP; while(a<count[l] && gaps[base+a]===0) a++; activeGap[l]=a; if(a<count[l]){ gaps[base+a]=Math.max(0,gaps[base+a]-sp);} } } } } }); }
// 2. Inserters: polar hand, state machine; 50% sleeping (skipped via active list)
{ const N = 30000; const ang=new Float64Array(N), tgt=new Float64Array(N), ext=new Float64Array(N), st=new Uint8Array(N), held=new Int32Array(N), rot=new Float64Array(N).fill(0.014);
  const active=new Int32Array(N/2); for(let i=0;i<N/2;i++) active[i]=i*2;
  time('inserters (30k, 15k active)', N/2, 600, (T)=>{ for(let t=0;t<T;t++){ for(let k=0;k<active.length;k++){ const i=active[k]; let d=tgt[i]-ang[i]; if(d>0.5)d-=1; else if(d<-0.5)d+=1; const r=rot[i];
      if (d>r) ang[i]+=r; else if (d<-r) ang[i]-=r; else { ang[i]=tgt[i]; if(st[i]===0){st[i]=1; held[i]=1; tgt[i]=0.5;} else {st[i]=0; held[i]=0; tgt[i]=0;} }
      if (ang[i]>=1) ang[i]-=1; else if (ang[i]<0) ang[i]+=1; ext[i]+=0.0; } } }); }
// 3. Crafting machines: progress += speed*satisfaction; finish -> consume/produce slot counts
{ const N=10000, ING=3; const prog=new Float64Array(N), speed=new Float64Array(N).fill(0.75), sat=new Float64Array(N).fill(1), inp=new Int32Array(N*ING).fill(1000), out=new Int32Array(N), need=new Int32Array(ING).fill(2), energy=new Float64Array(N).fill(1e6);
  time('crafting machines (10k)', N, 600, (T)=>{ for(let t=0;t<T;t++){ for(let i=0;i<N;i++){ const s=speed[i]*sat[i]; prog[i]+=s/60/0.5; energy[i]-=2500*sat[i]; if(prog[i]>=1){ prog[i]-=1; out[i]++; for(let k=0;k<ING;k++) inp[i*ING+k]-=need[k]; } } } }); }
// 4. Electric network: 60k consumers, 2 priority classes, satisfaction + buffer fill (two passes)
{ const N=60000; const buf=new Float64Array(N), cap=new Float64Array(N).fill(5000), cls=new Uint8Array(N); for(let i=0;i<N;i++) cls[i]= i%10===0?1:0;
  time('electric network (60k consumers, 2-pass)', N, 600, (T)=>{ for(let t=0;t<T;t++){ let d0=0,d1=0; for(let i=0;i<N;i++){ const want=cap[i]-buf[i]; if(cls[i]===0) d0+=want; else d1+=want; }
      const supply=0.8*(d0+d1); const s0=Math.min(1,supply/(d0||1)); const s1=Math.min(1,Math.max(0,supply-d0)/(d1||1));
      for(let i=0;i<N;i++){ const want=cap[i]-buf[i]; buf[i]+= want*(cls[i]===0?s0:s1); buf[i]-=1200; if(buf[i]<0)buf[i]=0; } } }); }
// 5. Heat field: 4096 chunks, 1/64 per tick diffusion + Newton cooling
{ const W=64, N=W*W; const H=new Float64Array(N).fill(100), dH=new Float64Array(N), kap=new Float64Array(N).fill(0.005);
  time('heat field (4096 chunks, 1/64 per tick)', N/64, 6400, (T)=>{ for(let t=0;t<T;t++){ const b=t&63; for(let i=b;i<N;i+=64){ const x=i%W,y=(i/W)|0; const h=H[i]; if(h>=15){ const q=0.02*h; H[i]-=4*q; if(x>0)dH[i-1]+=q; if(x<W-1)dH[i+1]+=q; if(y>0)dH[i-W]+=q; if(y<W-1)dH[i+W]+=q; } H[i]-= (kap[i]*h+0.002)*64/60; } if(b===63){ for(let i=0;i<N;i++){H[i]+=dH[i]; dH[i]=0;} } } }); }
