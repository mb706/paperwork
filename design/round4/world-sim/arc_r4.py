"""R4-world: the whole-game arc at balance's competent pace (00 §4, 01 §8.8, §12, 03 §2.3, §7, 04 §11).

Pre-closure research: round3/balance-data/pacing.py's 8-h competent profile (6-h and 12-h for range),
with the staffing rule (staffing_r4.simulate: hard rule, T = T0 x min(2, 1 + 0.08 W) from meta.staffing.supply since
round 5; round 4 used 1 + W/25, output kept as arc_r4.out.orig), the starting
college plus one college linked by Terminal at max(Time-sharing, Packet switching) + 0.3 h).
After the white techs' lab time: the frontier runs (balance m7: six runs, 20-35 min each; the first
starts ~0.5 h after yellow ends), then the 50-min takeoff (takeoff_r4.py), then the final run (~15 min).
W after the pacing sim: dW/dt = v0 (publication saturated: Literature 2024 at the end of yellow).
sigma: balance's sigma.py counts with a = 2e-4 (DECISIONS §29); Ratings = Model cards / 3 + 100 per run.
Run: gamedev-python design/round4/world-sim/arc_r4.py
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', '..', 'round3', 'balance-data'))
import staffing_r4 as S  # noqa: E402
from pacing import factorio_list, linear  # noqa: E402
from staffing_r4 import our_list  # noqa: E402  (citation years per DECISIONS §35)

G = S.g_data   # the data's supply law (01 §8.1)


def j_of(W):
    if W <= 49:
        return 0.30
    if W <= 59:
        return 0.30 + 0.15 * (W - 49) / 10
    if W <= 67:
        return 0.45 + 0.10 * (W - 59) / 8
    return 0.55


def sig(S_):
    return 0.9 * S_ / (1 + S_)


def arc(hours, runs=6, run_min=25.0, takeoff_min=50.0, final_min=15.0, v0=2.0):
    fl = factorio_list(); ol = our_list(); tot = sum(x['ls'] for x in fl)
    k = 2 * tot / (hours * hours * 3600)
    te0, tr0, ra0, _ = S.simulate(ol, linear(k), S.g_old, [(0.0, 1e9)])
    tTerm = max(ra0['time-sharing'], ra0['packet-switching']) + 0.3
    te, tr, ra, claims = S.simulate(ol, linear(k), G, [(0.0, 12), (tTerm, 8)], v0=v0)
    lit = {}
    year_by_id = {x['id']: x['year'] for x in ol if x['year']}
    def lit_at(h):
        ys = [year_by_id[i] for i, t in ra.items() if t <= h and i in year_by_id]
        return max(ys) if ys else None
    def W_at(h):
        if h <= tr[-1]['t']:
            return min(tr, key=lambda r: abs(r['t'] - h))['W']
        return tr[-1]['W'] + v0 * (h - tr[-1]['t'])
    first_run = te['model-card'] + 0.5
    closure = max(te['system-card'], first_run + runs * run_min / 60)
    capstone = closure + takeoff_min / 60
    victory = capstone + final_min / 60
    rows = [('1 h', 1.0), ('3 h', 3.0), ('Memo end', te['memo']), ('Report end', te['report']), ('Article end', te['article']),
            ('Preprint end', te['preprint']), ('Model card end', te['model-card']), ('first run', first_run),
            ('white lab time done', te['system-card']), ('closure', closure), ('capstone', capstone), ('victory', victory)]
    print(f'\n### {hours:.0f}-h competent profile (Terminal college at {tTerm:.2f} h); v0 {v0}')
    for lab, h in rows:
        W = W_at(h)
        print(f'  {lab:20s} {h:5.2f} h  W {W:6.2f}  Field {1945 + int(W)}  Literature {lit_at(h)}  j {j_of(W):.2f}  staff(start+college) {(12 + (8 if h >= tTerm else 0)) * G(W):5.1f}')
    return dict(closure=closure, capstone=capstone, victory=victory, W=W_at)


if __name__ == '__main__':
    for hours in (6.0, 8.0, 12.0):
        a = arc(hours)
    # race: W = 90 once publication saturates: (90 - 39.5 - 1.74 v0-free field takeoff) ...
    print('\nRace (publication saturated, +39.5): W = 80 at 40.5/v0 h; W = 90 at (40.5 + 1.738)/v0 h')
    for v0 in (2.0, 2.9, 3.4):
        print(f'  v0 {v0}: W 80 at {40.5 / v0:.1f} h, W 90 at {(40.5 + 1.738) / v0:.1f} h')
    # sigma at a = 2e-4 (balance sigma.py cases), first run and closure (+8,000 Model cards and 6 runs)
    print('\nsigma (a = 2e-4; with Watermarking all along in parentheses):')
    for lab, mc in (('path only', 1200), ('main yellow without Scalable oversight', 8700), ('whole main yellow', 13700), ('incl. Branch M', 33450)):
        R1 = mc / 3 + 100; Rc = (mc + 8000) / 3 + 600
        print(f'  {lab:40s} first run {sig(2e-4 * R1):.2f} ({sig(1e-4 * R1):.2f})  closure {sig(2e-4 * Rc):.2f} ({sig(1e-4 * Rc):.2f})')
