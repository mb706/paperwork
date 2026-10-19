#!/usr/bin/env python3
"""R3 implementability: regression checks for the cross-file findings in R3-implementability.md.

Each check prints PASS or FAIL with its evidence. Re-run after the round-4 revision:
    gamedev-python design/round3/impl-data/r3_checks.py [SPEC_DIR]
Checks are deliberately literal (field names, ids, phrases); if a revision fixes an issue by a
different route, update the check rather than the spec.
"""
import re
import sys
from pathlib import Path

import yaml

SPEC = Path(sys.argv[1] if len(sys.argv) > 1 else '/home/mewse/browsergame/design/spec')
D = SPEC / 'data'
KINDS = ['items', 'recipes', 'entities', 'technologies', 'resources', 'enemies']
data = {k: yaml.safe_load((D / f'{k}.yaml').read_text()) for k in KINDS}
by = {k: {x['id']: x for x in v} for k, v in data.items()}
meta = yaml.safe_load((D / 'meta.yaml').read_text())
md = {p.name[:2]: p.read_text() for p in SPEC.glob('[0-9][0-9]-*.md')}
schema = (D / 'SCHEMA.md').read_text()
results = []


def check(cid, title, ok, evidence):
    results.append((cid, ok))
    print(f'{"PASS" if ok else "FAIL"}  {cid}  {title}')
    if not ok:
        for line in evidence if isinstance(evidence, list) else [evidence]:
            print(f'        {line}')


# --- M1 data ------------------------------------------------------------------------------
boiler = by['entities']['boiler']
hx = by['entities']['heat-exchanger']
ratio_keys = {'water_per_s', 'water_per_steam', 'steam_per_water'}
check('C01', 'Boiler and heat exchanger state their water consumption (data, not a removed pseudo-recipe)',
      bool(ratio_keys & set(boiler.get('extra', {}))) and bool(ratio_keys & set(hx.get('extra', {})))
      or 'boil-steam' in by['recipes'],
      [f'boiler.extra = {boiler.get("extra")}', f'heat-exchanger.extra = {hx.get("extra")}',
       '10 §5.8/G11 assume 1 water : 10 steam; 09 §2.3 names `boil-steam`; 02 §9 #7 removed it'])

sal = meta['start']['salvage']
want = {'radar': 1, 'logic-board': 10, 'copper-cable': 20}
crate = sal.get('crate', sal.get('contents', {}))
check('C02', 'Salvage contents match 01 §9 / 09 §4 (6 pieces × 5 iron plates; crate: 1 radar, 10 logic boards, 20 cables)',
      all(crate.get(k) == v for k, v in want.items()) and 'iron-gear-wheel' not in crate,
      [f'meta.start.salvage = {sal}'])
check('C03', 'Salvage display name is "Laboratory salvage" (00 §9 #12, 08 §10.4)',
      'Radar laboratory' not in str(sal.get('entity', '')) and 'Rad Lab' not in md['10'],
      [f'meta: {sal.get("entity")!r}', '10 §5.18 stage 10 says "The Rad Lab salvage"'])

tiles_present = (D / 'tiles.yaml').exists() or 'tiles' in meta
check('C04', 'Tile prototypes exist (ids, κ, buildable, walking speed, map colour, placed-by item)',
      tiles_present, ['no tiles.yaml and no meta.tiles; concrete, hazard-concrete and landfill items '
                      'have no `places` field; meta.heat.loss.kappa_per_s is keyed by terrain class'])

world_obj = (D / 'world.yaml').exists() or 'world_objects' in meta
check('C05', 'World objects have prototypes (trees, rocks, wreck pieces, crate, town buildings, campus)',
      world_obj, 'none in data; yields are "ISO" prose (01 §2, §9)')

techs = data['technologies']
check('C06', 'Every technology states its citation regime (cited | infrastructure | beyond; 08 §9.3)',
      all('regime' in t for t in techs),
      f'{sum("regime" not in t for t in techs)} of {len(techs)} technologies lack `regime`; '
      'E-data/tree.json had it (L/H/F)')
def _structured(c):  # DECISIONS §35: citation {authors, year, title, ...} or a list of them
    one = lambda x: isinstance(x, dict) and 'year' in x and ('authors' in x or 'author' in x)
    return one(c) or (isinstance(c, list) and bool(c) and all(one(x) for x in c))


check('C07', 'Cited technologies carry structured long-form citations (08 §9.2–§9.3)',
      all(_structured(t.get('citation')) or isinstance(t.get('cite'), list)
          for t in techs if t.get('regime') == 'cited' or ('regime' not in t and t.get('citation'))),
      'only a short `citation` string exists; the References block, Handbook references and '
      'credits (09 §6, §9) cannot be generated')

wt = meta.get('world_text', {})
need = ['v0', 'beta', 'publication_lag_s', 'y_pub_start', 'world_sigma_per_field_year']
check('C08', 'W model parameters are data (v₀, β, lag, Y_pub start, world σ term; 01 §12, 01 §13)',
      all(k in wt or k in meta.get('world', {}) for k in need),
      [f'missing: {[k for k in need if k not in wt and k not in meta.get("world", {})]}',
       '01 §13 and 10 App. B call the block `meta.world`; the data calls it `world_text`'])

check('C09', '08 text placeholders resolve ({heat.tree_damage_c}, {staffing.radius})',
      'tree_damage_c' in meta['heat'] and 'radius' in meta['staffing'],
      'data has heat.loss.tree_damage_above_c and staffing.radius_tiles')

check('C10', 'Ambient θ at spawn: one range everywhere (01 §3, §9 and 09 §4 say 11–17 °C)',
      '10–18' not in meta['heat']['ambient'], f'meta.heat.ambient = {meta["heat"]["ambient"]!r}')

# --- 09 against data and DECISIONS ---------------------------------------------------------
t9 = md['09']
check('C11', '09 lists the DECISIONS §17 veteran tools as IN the slice',
      'Not in the slice** (I\'s M2 remainder, R2-A\'s M1.5): smart belt dragging' not in t9,
      '09 §6 "Not in the slice: smart belt dragging, fast-replace, copy and paste ..., undo and redo" '
      'and 09 §7.2 defers F1–F3, F7, F13, F16, F17, F24; 10 §12 M1a includes them')
check('C12', '09 and 10 name the same reference machine',
      not ('i5-1240P' in t9 and 'UHD 620' in md['10']),
      '09 §8: 2022 i5-1240P/Iris Xe 16 GB; 10 §11: 2019–2020 UHD 620 8 GB ("2022" is the target)')
check('C13', '10 §11 quotes 09 §8 correctly (tick ≤ 1 ms, heap ≤ 150 MB, stall ≤ 100 ms)',
      'tick ≤ 4 ms mean' not in md['10'],
      '10 §11 says 09 §8 includes "tick ≤ 4 ms mean, ≤ 8 ms p99, heap ≤ 1 GB, stall ≤ 50 ms, '
      'download ≤ 60 MB"; none of these are in 09 §8')
check('C14', 'Heat golden reference script is the one 03 §1.6 names (calib3.py, C = 20 MJ/K)',
      'heatsim2.py' not in md['10'],
      '10 G15 cites round1/F-data/heatsim2.py (C = 100 MJ/K, κ 0.001–0.002); 03 §1.6 cites calib3.py')

# --- later milestones -------------------------------------------------------------------------
mt = meta['runaways']['model_tier']
check('C15', 'Research-hall leak tier agrees (03 §3.1 and 10 §5.17: tier 4)',
      str(mt.get('research-hall')).strip() in ('4', '4.0'),
      [f'meta.runaways.model_tier.research-hall = {mt.get("research-hall")!r}',
       '02 Objection 9 asks 03 to confirm; leak_est.py used tier 4'])
vr = meta['quality']['verifier_rule']
check('C16', 'Verifier ladder: data and 10 §5.16 pick the same Comparator ("lowest" vs "highest")',
      not ('lowest' in vr and 'highest verifier tier' in md['10']),
      [f'meta: {vr}', '10 §5.16: "maximum output tier = 1 + the highest verifier tier"'])
check('C17', 'Rollback consumes a checkpoint or a frontier checkpoint (03 §3.4)',
      'frontier' in str(meta['runaways']['clean']['rollback']),
      f'meta.runaways.clean.rollback = {meta["runaways"]["clean"]["rollback"]}')
check('C18', 'Escape path agrees with 03 §3.6 (logistic agents required for the agent-hub path)',
      'Logistic' in str(meta['runaways']['escape_path']) or 'logistic' in str(meta['runaways']['escape_path']),
      f'meta.runaways.escape_path = {meta["runaways"]["escape_path"]!r}')
run = by['enemies']['runaway']
check('C19', 'enemies.yaml runaway targets list all four links of 03 §3.3 and both controller kinds',
      all(w in run['targets'] for w in ('exchange', 'logistic', 'Distilled')),
      f'targets: {run["targets"]!r}')
ep = by['entities']['endpoint']
serving = [r for r in data['recipes'] if r['category'] == 'serving']
check('C20', 'Endpoint tier text matches its recipe (no frontier checkpoint can be served)',
      '4 for a frontier checkpoint' not in str(ep.get('extra')) or
      any(i['id'] == 'frontier-checkpoint' for r in serving for i in r['ingredients']),
      [f'endpoint.extra.model_tier = {ep["extra"].get("model_tier")!r}',
       f'serving recipes: {[r["id"] for r in serving]} (checkpoint only; 03 §9 #3: tier 1–3)'])
check('C21', 'Reactor emission in 10 matches DECISIONS §18a (2 × heat passed on)',
      'fuel energy in minus heat out to the pipes' not in md['10'],
      '10 §5.7 says reactors emit "fuel energy in minus heat out"; data: nuclear-reactor emission twice-output')
check('C22', 'Dennard scaling is an energy cut everywhere (03 §1.4, data), not a T* offset',
      'T\\* offsets (Dennard)' not in md['10'],
      '10 §5.12 lists "T* offsets (Dennard)" among effects')
check('C23', 'Sparse inference scope agrees (04 §5: Research halls only; meta.effects.hall-energy: halls and Researchers)',
      'Researchers' not in meta['effects']['hall-energy'] or 'Research hall power ×0.75' not in md['04'],
      [f'meta.effects.hall-energy = {meta["effects"]["hall-energy"]!r}', '04 §5 #12 and §3.1 apply it to halls only'])
check('C24', 'Weight transplant means the same thing in 04 and the data',
      'keeps its weights' not in meta['effects']['weight-transplant'],
      [f'meta: {meta["effects"]["weight-transplant"]!r}',
       '04 §2.3: without it loaded accelerators cannot be swapped; with it higher tiers swap in place'])
check('C25', 'Product rules: one mechanism (10 §5.5 registry `world-text-mix` vs data `amounts_by_j` expressions)',
      'world-text-mix' not in md['10'] or not any('amounts_by_j' in r for r in data['recipes']),
      '10 §5.5: "There is no expression language in the data"; recipes deduplication and '
      'quality-filtering carry expression strings')
check('C26', 'SCHEMA heat.emission vocabulary matches the data (conversion, twice-output, none)',
      'loss_factor' not in schema,
      'SCHEMA: `emission: loss` with `loss_factor: 2`; data: conversion / twice-output / none')
check('C27', 'Research-per-paper multiplier follows the world setting, not a literal 2.0',
      not any(e.get('type') == 'research-per-paper' and e.get('multiplier') == 2.0
              for t in techs for e in t['unlocks'].get('effects', [])),
      'model-generation and model-generation-25 carry multiplier: 2.0 with a note "m = 1.5^r"')
check('C28', 'Staff slot rules allow rollback delivery (03 §3.4 / 07 §10.4) or rollback avoids the slot',
      'Inserters do not insert into it' not in md['07'] or 'staff slot' not in md['03'].split('**Rollback**')[1][:600],
      '07 §6.2: staff slot accepts only staff items and inserters never insert; 03 §3.4: a frontier '
      'checkpoint goes in "through ... the Seminar\'s staff slot", by inserter or agent')
check('C29', 'Scooped availability agrees (00 §6, 03 §5: opt-in setting, forced on in Race)',
      'only in Race' not in md['06'], '06 §3.3: "the base game\'s single spoiling item is Scooped\'s, and only in Race"')
check('C30', 'Exchange resource has no min_yield, or the floor rule says it is ignored (01 §13)',
      'min_yield' not in by['resources']['exchange'] or 'ignored' in str(by['resources']['exchange']),
      f'resources.exchange.min_yield = {by["resources"]["exchange"].get("min_yield")}')

n_fail = sum(1 for _, ok in results if not ok)
print(f'\n{len(results) - n_fail} passed, {n_fail} failed')
