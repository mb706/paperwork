"""sigma at the first frontier run and at closure, by how much of the tree the player researches (Ratings = Model cards/3 + 100 per run)."""
from load import *
from tiers import closure
import collections
def mc(ids):
    return sum(T[x]['cost']['count'] * T[x]['cost']['packs'].get('model-card', 0) for x in ids if T[x].get('cost') and 'count' in T[x]['cost'])
fin = [t['id'] for t in techs if t.get('cost') and 'count' in t['cost']]
white = {'chain-of-thought', 'self-play', 'test-time-compute', 'automated-research', 'formal-verification'}
yellowM = [x for x in fin if 'model-card' in T[x]['cost']['packs'] and x not in white]
nonM = [x for x in yellowM if 'proceedings' not in T[x]['cost']['packs']]
path = [x for x in closure('in-context-learning') if x in fin]
cases = {
  'path only (first-run closure)': mc(path),
  'main yellow tier minus Scalable oversight': mc(nonM) - 5000,
  'main yellow tier (non-M)': mc(nonM),
  'everything incl. Branch M': mc(yellowM),
}
def sig(S): return 0.9 * S / (1 + S)
print(f"{'case':44s} {'MC before run':>13s} | sigma@run a=3e-4 (wm) | a=2e-4 (wm) | closure a=3e-4 / 2e-4 (+8,000 MC, 6 runs)")
for k, v in cases.items():
    R1 = v / 3 + 100
    Rc = (v + 8000) / 3 + 600
    print(f"{k:44s} {v:13,d} | {sig(3e-4*R1):.2f} ({sig(1.5e-4*R1):.2f})        | {sig(2e-4*R1):.2f} ({sig(1e-4*R1):.2f}) | {sig(3e-4*Rc):.2f} / {sig(2e-4*Rc):.2f}")
