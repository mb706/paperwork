"""Shared loader for the round-3 balance scripts (reads design/spec/data).

Round 5: technologies no longer carry a `year` field. DECISIONS §35 replaced it with a structured
`citation` list and a `regime`, and the year is derived. Without the derivation below, pacing.py's
publication term (Y_pub, 01 §12.1) silently stayed at 1945, because every `t.get('year')` returned None.
The loader now restores `year` with 01 §12.1's meaning: the latest citation year, for `regime: cited`
technologies only (infrastructure and beyond technologies publish nothing). The round-4 sims in
design/round4/world-sim derive the same value themselves and are unaffected.

Status: the round-3 scripts here are historical evidence for R3-balance.md. Their staffing model
(T0 x (1 + W/50), a starting college of 8) predates DECISIONS §23; the current numbers come from
design/round4/world-sim/ (staffing_r4.py, arc_r4.py, takeoff_r4.py), which import pacing.py's research
lists and order from here."""
import os

import yaml

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'spec', 'data')


def L(n):
    return yaml.safe_load(open(os.path.join(D, n + '.yaml')))


items = L('items'); recipes = L('recipes'); ents = L('entities'); techs = L('technologies'); meta = L('meta')
res = L('resources'); enemies = L('enemies')
for _t in techs:
    if 'year' not in _t:
        _years = [c['year'] for c in (_t.get('citation') or []) if isinstance(c, dict) and c.get('year')]
        _t['year'] = max(_years) if _years and _t.get('regime', 'cited') == 'cited' else None
I = {x['id']: x for x in items}; R = {x['id']: x for x in recipes}; E = {x['id']: x for x in ents}
T = {x['id']: x for x in techs}
