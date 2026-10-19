"""Heat calibration under B's laws: plant loss = 2x electrical output; throttled machines keep full power
(no feedback); per-tier thermal limits (tube 45, computer 40, cluster 35, accelerator hall 25 C; liquid-cooled +15)."""
import numpy as np
DT=64/60; RATIO=0.02; MIN=15.0; C=20.0
def field(emit, kappa, hours=1.5, towers=None, n=64):
    H=np.zeros((n,n))
    for s in range(int(hours*3600/DT)):
        H += emit*DT
        out=np.where(H>=MIN,RATIO*H,0.0); H-=4*out
        H[1:,:]+=out[:-1,:]; H[:-1,:]+=out[1:,:]; H[:,1:]+=out[:,:-1]; H[:,:-1]+=out[:,1:]
        H -= (kappa*H+0.002)*DT
        if towers is not None: H -= towers*np.clip(H/C/5.0,0,1)*DT
        np.maximum(H,0,out=H)
    return H/C
def m(T, lim): return float(np.clip(1-(T-lim)/50,0.5,1))
def sq(n,x,y,w,h,v): a=np.zeros((n,n)); a[y:y+h,x:x+w]=v; return a
n=64; k=np.full((n,n),0.005)
# early: 10 boilers -> 18 MW electric, loss 36 MW in 2 chunks; consumers 18 MW over 3x3; tube-era computer (lim 45) 1 chunk from plant
e=sq(n,28,32,2,1,18.0)+sq(n,31,30,3,3,2.0)
for amb in (15,28):
    dT=field(e,k); Tp=amb+dT[32,28]; Tc=amb+dT[32,31]
    print(f"early 10 boilers, amb {amb}: plant {Tp:.0f}C; computer next to plant {Tc:.0f}C -> tube-era speed {m(Tc,45):.2f}, cluster-tier speed {m(Tc,35):.2f}")
# mid: 150 MW over 6x6 (solar) and with 300 MW steam loss in 2x2 beside it; cluster tier (lim 35)
b=sq(n,29,29,6,6,150/36)
for name,e in (("solar",b),("steam",b+sq(n,25,31,2,2,75.0))):
    dT=field(e,k); T=15+dT[31,31]; print(f"mid 150 MW {name}: centre {T:.0f}C -> cluster speed {m(T,35):.2f}, accelerator-hall speed {m(T,25):.2f}")
# 50 MW accelerator hall 2x2 (lim 25; liquid +15 -> 40)
h=sq(n,31,31,2,2,12.5)
for amb,name in ((15,'temperate'),(28,'hot'),(-5,'cold')):
    T=amb+field(h,k)[31,31]; print(f"50 MW hall air, {name}: {T:.0f}C speed {m(T,25):.2f}")
T=15+field(h,k,towers=sq(n,31,31,2,2,10.0))[31,31]; print(f"50 MW hall + 4 towers, temperate: {T:.0f}C speed {m(T,25):.2f}")
T=15+field(h*0.3,k)[31,31]; print(f"50 MW hall 70% liquid, temperate: {T:.0f}C speed {m(T,40):.2f} (limit 40)")
T=28+field(h*0.3,k)[31,31]; print(f"50 MW hall 70% liquid, hot: {T:.0f}C speed {m(T,40):.2f}")
kc=k.copy(); kc[25:40,25:40]=0.0015
T=15+field(h,kc)[31,31]; print(f"50 MW hall on concrete, temperate: {T:.0f}C speed {m(T,25):.2f}")
# 1 GW campus 7x7
c=sq(n,28,28,7,7,1000/49)
T=15+field(c,k)[31,31]; print(f"1 GW air: {T:.0f}C speed {m(T,25):.2f}")
T=15+field(c*0.1,k)[31,31]; print(f"1 GW 90% liquid: {T:.0f}C speed {m(T,40):.2f}")
T=15+field(c*0.1,k,towers=sq(n,28,28,7,7,2.0))[31,31]; print(f"1 GW 90% liquid + 1 tower per 5 chunks: {T:.0f}C")
T=-5+field(c*0.3,k)[31,31]; print(f"1 GW 70% liquid in tundra (-5C): {T:.0f}C speed {m(T,40):.2f}")
