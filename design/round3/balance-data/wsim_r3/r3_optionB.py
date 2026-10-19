"""R3 option B: hard staffing rule + T0(start) 12 + 60 s per takeoff unit. Human Seminar capacity at closure
(W ~ 63, T = T0 (1 + W/50)): staff x lab speed 3.5 / 60 s. Researchers = the 'labs' builds (slower: 300 s per +5 cards/s)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'round2', 'W-sim'))
from dataclasses import replace
import r2w_full as F, r2w_takeoff as R, takeoff as T
from takeoff import Params, summary
T.tech_list = F.tech_list; T.apply_tech = R.patched_apply
mult = 1 + 63 / 50
for label, staff in (('start college only', 12 * mult), ('+1 college claim', 18 * mult), ('+college +town', 28 * mult), ('+college +2 towns', 38 * mult)):
    for unit in (30, 60):
        human = staff * 3.5 / unit
        with_r = summary(R._simulate(replace(Params(), **R.OVERHANG['medium'], L_cap0=human, task_labs=(300.0 if unit == 60 else 180.0, 5.0)), 2.0))
        without = summary(R._simulate(replace(Params(), **R.OVERHANG['medium'], L_cap0=human, task_labs=(180.0, 0.0)), 2.0))
        print(f"{label:20s} staff {staff:5.1f}, {unit} s/unit: human {human:4.1f} cards/s | with Researchers {with_r['t_end_min']:5.1f} min | none {without['t_end_min']:5.1f} min")
