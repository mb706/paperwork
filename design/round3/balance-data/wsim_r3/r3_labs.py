"""R3: does Seminar capacity (and so the Researcher) matter in the takeoff? Fix L_cap (no 'labs' builds)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'round2', 'W-sim'))
from dataclasses import replace
import r2w_full as F, r2w_takeoff as R, takeoff as T
from takeoff import Params, summary
T.tech_list = F.tech_list; T.apply_tech = R.patched_apply
orig_choose = T.choose_task
def run(Lcap=None, **kw):
    p = replace(Params(), **R.OVERHANG['medium'], **kw)
    if Lcap is not None:
        p = replace(p, L_cap0=Lcap, task_labs=(180.0, 0.0))
    return summary(R._simulate(p, 2.0))
print('reference (labs grow by builds)', run())
for L in (1.0, 1.5, 2.2, 3.2, 4.3, 6.3, 13.5, 20):
    s = run(L)
    print(f'L_cap fixed {L:5.1f} cards/s: takeoff {s["t_end_min"]:6.1f} min, bind {s["bind"]}')
