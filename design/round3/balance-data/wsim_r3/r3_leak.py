"""R3: expected compromises during the reference takeoff under the two hall-tier rules in the spec:
03 §3.1 (halls always tier 4) vs meta.yaml runaways.model_tier (min(4, 1 + floor((L-5)/5)) at Model generation L)."""
import math
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'round2', 'W-sim'))
from dataclasses import replace
import r2w_full as F, r2w_takeoff as R, takeoff as T
from takeoff import Params, summary
T.tech_list = F.tech_list; T.apply_tech = R.patched_apply
for oh in ('small', 'medium', 'large', 'huge'):
    res = R._simulate(replace(Params(), **R.OVERHANG[oh]), 2.0)
    log = res['log']
    hh4 = hhG = 0.0; hh = 0.0
    for a, b in zip(log[:-1], log[1:]):
        dt = (b['t'] - a['t']) / 3600
        L = 6 + a['G'] - 1 if a['G'] > 0 else 5
        tierG = min(4, 1 + max(0, (L + 1 - 5)) // 5)  # level being researched is G+6; researched levels -> use current researched L
        hh += a['halls'] * dt
        hh4 += a['halls'] * dt * 4
        hhG += a['halls'] * dt * tierG
    t = res['t_end'] / 60
    for lab, v, O in (('Standard O=0', 0, 0), ('Standard O=3 (typical: RS, BS, MCTS)', 0, 3), ('Verified O=2', 0.5, 2)):
        k = 0.01 * (1 - v) * (1 - 0.2 * O)
        print(f'{oh:6s} {t:5.1f} min, {hh:6.1f} hall-h | {lab:38s}: tier-4 rule {k*hh4:5.2f}, MG-level rule {k*hhG:5.2f} compromises')
