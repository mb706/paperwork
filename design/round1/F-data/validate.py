import numpy as np
DT=64/60; RATIO=0.02; MIN=15.0; C=20.0
def run(base_emit, kappa, compute_mask, amb, hours=1.5, towers=None, n=64, floor=0.5, Tth=35.0, span=50.0):
    """compute_mask: fraction of each chunk's emission that is compute (throttles)."""
    H=np.zeros((n,n)); m=np.ones((n,n))
    for s in range(int(hours*3600/DT)):
        T = amb + H/C
        m = np.clip(1-(T-Tth)/span, floor, 1.0)
        e = base_emit*(1-compute_mask) + base_emit*compute_mask*m
        H += e*DT
        out=np.where(H>=MIN,RATIO*H,0.0); H-=4*out
        H[1:,:]+=out[:-1,:]; H[:-1,:]+=out[1:,:]; H[:,1:]+=out[:,:-1]; H[:,:-1]+=out[:,1:]
        H -= (kappa*H+0.002)*DT
        if towers is not None: H -= towers*np.clip(H/C/5.0,0,1)*DT
        np.maximum(H,0,out=H)
    return amb+H/C, m
def sq(n,x,y,w,h,v): a=np.zeros((n,n)); a[y:y+h,x:x+w]=v; return a
n=64; k=np.full((n,n),0.005)
hall=sq(n,31,31,2,2,12.5); cm=(hall>0).astype(float)
for amb,name in ((15,'temperate 15C'),(28,'hot 28C'),(-5,'cold -5C')):
    T,m=run(hall,k,cm,amb); print(f"50 MW hall, {name}: T={T[31,31]:.1f}C speed={m[31,31]:.2f}")
T,m=run(hall,k,cm,28,towers=sq(n,31,31,2,2,10.0)); print(f"50 MW hall, hot 28C + 4 towers(40MW): T={T[31,31]:.1f}C speed={m[31,31]:.2f}")
kc=k.copy(); kc[25:40,25:40]=0.005*0.3
T,m=run(hall,kc,cm,15); print(f"50 MW hall on concrete (x0.3), temperate: T={T[31,31]:.1f}C speed={m[31,31]:.2f}")
kw=k.copy(); kw[20:44,33:50]=0.02
T,m=run(hall,kw,cm,15); print(f"50 MW hall on a lakeshore (water x4), temperate: T={T[31,31]:.1f}C speed={m[31,31]:.2f}")
# 1 GW campus 7x7, all compute
camp=sq(n,28,28,7,7,1000/49); cmc=(camp>0).astype(float)
T,m=run(camp,k,cmc,15); print(f"1 GW campus air-cooled, temperate: T={T[31,31]:.1f}C speed(centre)={m[31,31]:.2f} mean={m[28:35,28:35].mean():.2f}")
T,m=run(camp*0.1,k,cmc,15); print(f"1 GW campus 90% liquid-cooled (100 MW to air): T={T[31,31]:.1f}C speed={m[31,31]:.2f}")
T,m=run(camp,k,cmc,15,towers=sq(n,28,28,7,7,10.0)); print(f"1 GW campus air + 1 tower/chunk (490 MW): T={T[31,31]:.1f}C mean speed={m[28:35,28:35].mean():.2f}")
T,m=run(camp,k,cmc,15,towers=sq(n,28,28,7,7,20.0)); print(f"1 GW campus air + 2 towers/chunk (980 MW): T={T[31,31]:.1f}C mean speed={m[28:35,28:35].mean():.2f}")
# early steam plant 10 boilers (18 MW waste) in 2 chunks, institute 1 chunk away
pl=sq(n,30,32,2,1,9.0); inst=sq(n,33,32,1,1,0.3); e=pl+inst; cm2=(inst>0).astype(float)
for amb in (15,28):
    T,m=run(e,k,cm2,amb); print(f"early: 10 boilers + institute 1 chunk away, amb {amb}C: plant {T[32,30]:.1f}C, institute {T[32,33]:.1f}C speed {m[32,33]:.2f}")
