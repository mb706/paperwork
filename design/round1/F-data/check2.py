import numpy as np
from validate import run, sq
n=64; k=np.full((n,n),0.005)
# mid base: 150 MW mixed (1/3 compute) over 6x6 + 150 MW steam waste in 2x2, temperate
base=sq(n,29,29,6,6,150/36); plant=sq(n,25,31,2,2,37.5); cm=(base>0)*0.33
T,m=run(base+plant,k,cm,15,hours=1.5); print(f"mid 150 MW + steam: plant {T[31,25]:.0f}C, base centre {T[31,31]:.0f}C, compute speed {m[31,31]:.2f}")
T,m=run(base,k,cm,15,hours=1.5); print(f"mid 150 MW solar: base centre {T[31,31]:.0f}C, compute speed {m[31,31]:.2f}")
# feral sensing: S = max over chunks within 8 of dT*0.8^d, for a colony 4 chunks from base edge
dT=T-15; cy,cx=31,39  # 4 chunks east of base edge (x=34)
S=max(dT[y,x]*0.8**max(abs(y-cy),abs(x-cx)) for y in range(cy-8,cy+9) for x in range(cx-8,cx+9))
print(f"colony 4 chunks off a 150 MW solar base: sensed {S:.1f} K -> budget {5*S:.0f}/min")
