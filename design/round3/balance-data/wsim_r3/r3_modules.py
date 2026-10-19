"""R3: takeoff with modules in Research halls (G's model ignores them; 04 §3 includes them).
Efficiency: 2 x Distilled controller 2 (-40% each) hit Factorio's -80% floor: hall power x0.2, +10 accelerators
per hall in the modules. Speed: 4 x Coprocessor 3 (+200% speed, +280% power)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'round2', 'W-sim'))
from dataclasses import replace
import r2w_full as F
import r2w_takeoff as R
import takeoff as T
from takeoff import Params, summary
T.tech_list = F.tech_list; T.apply_tech = R.patched_apply
base = Params()
def run(oh='medium', **kw):
    return R._simulate(replace(Params(), **R.OVERHANG[oh], **kw), 2.0)
ref = summary(run())
print('reference                                ', round(ref['t_end_min'], 1), ref['bind'])
eff = tuple((s, p * 0.2) for s, p in base.hall_tiers)
for oh in ('small', 'medium', 'large'):
    a = summary(run(oh)); b = summary(run(oh, hall_tiers=eff, cards_per_hall=30))
    print(f'{oh:7s} no modules {a["t_end_min"]:5.1f} min | 2x Distilled-2 (power x0.2, 30 acc/hall) {b["t_end_min"]:5.1f} min  bind {b["bind"]}')
spd = tuple((s * 3.0, p * 3.8) for s, p in base.hall_tiers)
b = summary(run('medium', hall_tiers=spd, cards_per_hall=20 + 4 * 25))
print('4x Coprocessor-3 (speed x3, power x3.8; ~100 acc in modules)', round(b['t_end_min'], 1), b['bind'])
mix = tuple((s * 1.5, p * 0.2) for s, p in base.hall_tiers)
b = summary(run('medium', hall_tiers=mix, cards_per_hall=20 + 3 * 5 + 25))
print('3x Distilled-2 + 1 Coprocessor-3 (speed x1.5, power x0.2)', round(b['t_end_min'], 1), b['bind'])
for r in (1.2, 1.71, 2.0):
    m = 1.5 ** r
    a = summary(run(m=m)); b = summary(run(m=m, hall_tiers=eff, cards_per_hall=30))
    fa = summary(run(m=m, policy='frozen')); fb = summary(run(m=m, hall_tiers=eff, cards_per_hall=30, policy='frozen'))
    print(f'r={r}: active {a["t_end_min"]:.1f} -> {b["t_end_min"]:.1f} with efficiency modules; frozen {fa["t_end_min"]:.1f} -> {fb["t_end_min"]:.1f}')
