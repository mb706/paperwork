#!/usr/bin/env python3
"""Round-4 data revision (R4-data). Reads the round-3 data from the scratch backup and writes the
round-4 list files to design/spec/data. meta.yaml, tiles.yaml and world.yaml are hand-written.
Re-runnable: always starts from the backup."""
import copy
import re
import sys
from pathlib import Path

import yaml

SCR = Path(__file__).resolve().parent
SRC = SCR / 'backup' / 'data'
DST = Path('/home/mewse/browsergame/design/spec/data')
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else DST


def load(name):
    lines = (SRC / f'{name}.yaml').read_text().splitlines(keepends=True)
    header = ''
    while lines and lines[0].startswith('#'):
        header += lines.pop(0)
    return header, yaml.safe_load(''.join(lines))


def dump(name, header, obj):
    body = yaml.dump(obj, sort_keys=False, allow_unicode=True, default_flow_style=None, width=4096)
    (OUT / f'{name}.yaml').write_text(header + body)


def reorder(d, order):
    out = {k: d[k] for k in order if k in d}
    for k, v in d.items():
        if k not in out:
            out[k] = v
    return out


def by_id(lst):
    return {x['id']: x for x in lst}


# ------------------------------------------------------------------ renames
TECH_RENAME = {
    'zone-refining': ('regenerative-furnace', 'Regenerative furnace'),      # coherence M10
    'penetration-testing': ('terminal-ballistics', 'Terminal ballistics'),  # coherence M11
    'reference-monitor': ('threat-monitoring', 'Threat monitoring'),        # accuracy §2.3
    'mobile-robotics': ('mobile-automata', 'Mobile automata'),              # accuracy §2.4, coherence m2
    'context-length-1': ('lift-capacity-1', 'Lift capacity 1'),             # coherence m18, accuracy §2.3
    'context-length-2': ('lift-capacity-2', 'Lift capacity 2'),
    'context-length-3': ('lift-capacity-3', 'Lift capacity 3'),
    'tank': ('half-track', 'Half-track'),                                   # DECISIONS §38, coherence M14
}
THING_RENAME = {'tank': 'half-track'}   # item, entity and recipe ids

# ------------------------------------------------------------------ items
ITEM_DESC = {   # non-building items that keep a description (DECISIONS §34; coherence §2.1 tier A + keep-list)
    'records': 'Boxes of records. Finite.',
    'water': 'Boils into steam. In data recipes it is the cooling.',
    'crawl': 'Raw. Mostly copies.',
    'junk': 'Not nothing. Can be denoised.',
    'quartz': 'Silicon dioxide. Silica is 60% of the continental crust.',
    'token': 'One instance of one type.',
    'logic-board': 'Gates on a board. Relays, then tubes, then transistors.',
    'processor': 'Executes stored programs. Binned by clock speed.',
    'accelerator': 'Multiplies matrices.',
    'drone-frame': 'A body. Loaded with a planner or with weights.',
    'rack': '19 inches wide, 42 U high. Battery backup.',
    'dataset': 'Deduplicated. Smaller than what went in.',
    'benchmark': 'Held out. Used once.',
    'checkpoint': 'Weights on a drive. Copying recipes return it.',
    'researcher': 'Staffs a Seminar. Four accelerators and a frontier checkpoint; the checkpoint is returned.',
    'run-shard': 'One training step of a hundred.',
    'frontier-checkpoint': 'Weights a frontier run returned. A copy takes a blank drive.',
    'final-report': 'Due under the charter.',
    'post-training-payload': 'Preference data and a reward model.',
    'landfill': "Turns water into ground. The lake's cooling goes with it.",
    'memo': 'Typed, carbon-copied, filed.',
    'report': 'Numbered, bound, mailed on request.',
    'article': 'Refereed.',
    'proceedings': 'Presented once, then printed.',
    'preprint': 'Posted. Not reviewed. Cited.',
    'model-card': 'States what the model was tested on.',
    'system-card': 'Not written by anyone.',
    'coprocessor': "More arithmetic for the machine's control loop.",
    'learned-controller': 'Weights copied from a checkpoint.',
    'distilled-controller': 'Most of the teacher at a fraction of the watts.',
    'distilled-controller-2': 'A smaller student of the same teacher.',
    'distilled-controller-3': 'The smallest student that still passes.',
    'comparator': 'Checks each output; some pass a grade higher.',
    'ratings': 'Pairs of answers, one marked better.',
    'baseline': 'Was state of the art.',
    'significant-result': 'p < 0.05.',
    'null-result': 'p ≥ 0.05.',
    'evaluation-set': 'Held-out tasks. A Monitor uses one per clean.',
    'adversarial-set': 'Inputs chosen to be answered wrong.',
}
ITEM_SPRITE = {   # FUN-09 legibility; DECISIONS §37–§38 renames
    'dataset': 'one tape reel with an ice-cyan label',
    'checkpoint': 'bare orange hexagon chip, no drive body',
    'frontier-checkpoint': 'bare gold hexagon chip, no drive body',
    'significant-result': 'single sheet with a bright green band across the top',
    'null-result': 'plain single sheet, no band',
    'baseline': 'the significant-result sheet with its green band grayed',
    'decider-combinator': 'ISO decider combinator; the display shows a comparison sign',
    'half-track': 'grey half-track: wheels in front, tracks behind, an open cargo bed, no turret',
}
PLACES_TILE = {'concrete': 'concrete', 'hazard-concrete': 'hazard-concrete', 'refined-concrete': 'refined-concrete',
               'refined-hazard-concrete': 'refined-hazard-concrete', 'landfill': 'landfill'}
ITEM_ORDER = ['id', 'name', 'type', 'stack', 'tier', 'mirrors', 'sprite', 'fuel_value', 'fuel_category',
              'default_temperature', 'max_temperature', 'heat_capacity_kj_per_k', 'places', 'places_tile',
              'module', 'ammo', 'armor', 'equipment', 'staff', 'spoil', 'tags', 'desc']


def do_items(items):
    out = []
    for it in items:
        it = copy.deepcopy(it)
        if it['id'] in THING_RENAME:
            it['id'] = THING_RENAME[it['id']]
        if it.get('places') in THING_RENAME:
            it['places'] = THING_RENAME[it['places']]
        if it['id'] == 'half-track':
            it['name'] = 'Half-track'
            it['mirrors'] = 'tank (unarmed: B L14)'
        if it['id'] == 'decider-combinator':
            it['name'] = 'Decision unit'                       # accuracy M1; DECISIONS §37 refined
        if it['id'] in ITEM_SPRITE:
            it['sprite'] = ITEM_SPRITE[it['id']]
        # descriptions: building items share their entity's desc; other items only from the keep-list
        it.pop('desc', None)
        if not it.get('places') and it['id'] in ITEM_DESC:
            it['desc'] = ITEM_DESC[it['id']]
        if it['id'] in PLACES_TILE:
            it['places_tile'] = PLACES_TILE[it['id']]
        if it['id'] in ('water', 'steam'):
            it['heat_capacity_kj_per_k'] = 0.2                  # J3 / P2 (2.0 values)
        q = {'coprocessor': -0.01, 'coprocessor-2': -0.015, 'coprocessor-3': -0.025}   # accuracy §2.3 (2.0.7)
        if it['id'] in q:
            it['module']['quality'] = q[it['id']]
        if it['id'] == 'researcher':
            it['staff'] = {'fully_staffs': True, 'kw': 500, 'heat_class': 'accelerator', 'liquid_cooling': True,
                           'interruptible': True, 'deploys': True, 'model_tier': 4, 'draws': 'while the Seminar is working',
                           'energy_scaled_by': ['compute-energy-floor']}
        out.append(reorder(it, ITEM_ORDER))
    # new building item: Terminal (DECISIONS §23d)
    term = {'id': 'terminal', 'name': 'Terminal', 'type': 'item', 'stack': 50, 'tier': 'report',
            'mirrors': 'new (DECISIONS §23d: a time-sharing terminal on a data line)',
            'sprite': 'teletype terminal on a small steel desk, paper roll on top, one data-line socket at the back',
            'places': 'terminal', 'tags': ['building']}
    idx = next(i for i, x in enumerate(out) if x['id'] == 'data-lake') + 1
    out.insert(idx, term)
    return out


# ------------------------------------------------------------------ entities
ENTITY_DESC = {   # about one building in five (DECISIONS §34); keep-list lines verbatim
    'crawler': 'Placed on an exchange. Pulls whatever passes through.',
    'keypunch': 'Transcribes records into tokens, one card at a time. Burns fuel.',
    'assembling-machine-1': 'Set by plugboard.',                         # coherence M9: the controller reading
    'assembling-machine-2': 'Its recipe is held in a stored program.',
    'assembling-machine-3': 'Four controllers working as one.',
    'trainer': 'Turns datasets into weights. The crafting time is the compute.',
    'seminar': 'Consumes papers. Needs staff.',
    'switch': 'Lends its modules to every machine in range. Each additional switch counts for less.',
    'frontier-cluster': 'Takes {extra.parts_required} run shards and a payload. Progress is shown as loss.',
    'research-hall': 'Writes System cards. Runs on {extra.accelerator_slots} accelerators and a frontier checkpoint.',
    'cooling-tower': 'Absorbs heat in its chunk. Consumes water and power.',
    'dry-cooler': 'Rejects coolant heat into the air of its chunk.',
    'water-exchanger': 'Rejects coolant heat into the water it touches.',
    'data-line': 'Carries streams. Never connects to a pipe.',
    'power-switch': 'Disconnects two networks. {meta.runaways.clean.power_off_s} s without power cleans a compromised machine.',
    'monitor': 'Cleans one compromised machine in range every {extra.clean_interval_s} s.',
    'fence': 'Stops bodies, not signals.',
    'endpoint': 'Serves a checkpoint to a town. Returns ratings.',
    'verifier': "Rejects what fails. Returns {extra.returns:%} of a rejected item's ingredients.",
    'deployer': 'Builds the blueprint it holds where a circuit signal says.',
    'area-scanner': 'Reports what lies in an area as signals.',
    'terminal': 'Joins a university to a Seminar network over a data line.',
    'decider-combinator': 'Outputs while its conditions hold.',   # DECISIONS §37 (refined), R3-accuracy M1
}
ENTITY_NOTE = {
    'research-hall': 'The first System card written here closes the loop.',   # FUN-08
    'monitor': 'Runs no learned weights.',                                      # coherence m22
}
DRAIN = {'assembling-machine-1': 2.5, 'assembling-machine-2': 5, 'assembling-machine-3': 12.5, 'electric-furnace': 6,
         'tokenizer': 6, 'chemical-plant': 7, 'data-plant': 7, 'data-refinery': 14, 'centrifuge': 11.667,
         'trainer': 13.333, 'endpoint': 33.333, 'verifier': 6, 'inserter': 0.4, 'long-handed-inserter': 0.4,
         'fast-inserter': 0.5, 'bulk-inserter': 1, 'pump': 1, 'repeater': 1}
INSERTER_KJ = {'inserter': 5, 'long-handed-inserter': 5, 'fast-inserter': 7, 'bulk-inserter': 20, 'burner-inserter': 150}
EMISSION = {'boiler': {'emission': 'none'}, 'heat-exchanger': {'emission': 'none'},
            'nuclear-reactor': {'emission': 'none', 'waste_heat': True}, 'fusion-reactor': {'emission': 'none'},
            'steam-engine': {'emission': 'twice-output'}, 'steam-turbine': {'emission': 'twice-output'},
            'fusion-generator': {'emission': 'twice-output'}}
ENT_ORDER = ['id', 'name', 'type', 'size', 'item', 'energy', 'crafting_speed', 'categories', 'mining_speed',
             'module_slots', 'allowed_effects', 'effect_receiver', 'staff_slots', 'staff_demand', 'consumes', 'produces',
             'heat', 'deploys', 'placement', 'extra', 'mirrors', 'desc', 'handbook_note']


def do_entities(ents):
    out = []
    for e in ents:
        e = copy.deepcopy(e)
        eid = e['id'] = THING_RENAME.get(e['id'], e['id'])
        e['item'] = THING_RENAME.get(e['item'], e['item'])
        e.pop('desc', None)
        if eid in ENTITY_DESC:
            e['desc'] = ENTITY_DESC[eid]
        if eid in ENTITY_NOTE:
            e['handbook_note'] = ENTITY_NOTE[eid]
        en = e.get('energy') or {}
        if eid in DRAIN:
            en['drain_kw'] = DRAIN[eid]
        if eid in INSERTER_KJ:
            en['per_movement_kj'] = en['per_rotation_kj'] = INSERTER_KJ[eid]
            if eid == 'burner-inserter':
                en.pop('kw', None)       # J4: burner energy per movement and rotation ×3 (DECISIONS §18); no fixed draw
        if eid in EMISSION:
            e['heat'] = dict(EMISSION[eid])
        if eid == 'boiler':
            e['extra']['water_per_s'] = 6                      # J3: 1 water → 10 steam (2.0.7)
        if eid == 'heat-exchanger':
            e['extra']['water_per_s'] = 10.309
        if eid == 'switch':
            e['heat'] = {'class': 'network', 'liquid_cooling': True}   # DECISIONS §26 (R4-world: NEBS gear, 40 °C)
            e['extra']['throttle'] = 'transmitted effects × m, before the 1/√n profile; draw unchanged'
        if eid == 'seminar':
            e['heat'] = {'class': 'accelerator', 'liquid_cooling': True, 'while': 'researcher'}
        if eid == 'research-hall':
            e['module_slots'] = 0                              # DECISIONS §25
            e['effect_receiver'] = {'uses_module_effects': False, 'uses_beacon_effects': False}
            x = e['extra']
            tiers = [dict(t, drain_kw=round(t['kw'] / 30, 1)) for t in x['tiers']]
            e['extra'] = {
                'accelerator_slots': 20, 'weights_slots': 1, 'weights_item': 'frontier-checkpoint',
                'tiers': tiers,
                'mixed_tiers': 'speed and draw are the mean over the 20 slots of each loaded tier; the GUI shows the lowest tier',
                'runs_when': 'all accelerator slots and the weights slot are filled (statuses Missing accelerators (n / 20), No weights)',
                'loading': 'inserters and agents insert accelerators and one frontier checkpoint, never remove them; hand transfer works both ways',
                'upgrade': 'after weight-transplant an accelerator of a higher tier inserted into a full hall replaces the loaded one of the lowest tier (ties: lowest slot); the old one goes to the output',
                'output_returns_accelerators': True,
                'accelerator_quality': 'ignored; the hall\'s own quality applies as for any crafting machine; the weights item\'s quality sets v'}
        if eid == 'frontier-cluster':
            e['extra']['payload'] = 'post-training-payload, final-report, or none (empty launch)'
        if eid in ('crawler', 'endpoint'):
            e['placement'] = {'must_be_on': 'exchange'}
        if eid in ('offshore-pump', 'water-exchanger'):
            e['placement'] = {'must_touch': 'water'}
        if eid == 'water-exchanger':
            e['extra'].pop('placement', None)
            if not e['extra']:
                e.pop('extra')
            e['heat']['into'] = 'the chunk of the water tile at its pumping position'
        if eid == 'endpoint':
            e['extra'] = {'keeps_working_on_closed_exchange': True}
        if eid == 'cooling-tower':
            e['allowed_effects'] = ['consumption']               # J20 / U49
            e['heat']['water_per_mj'] = 0.4115                   # accuracy §2.5: 2.43 MJ per unit at 30 °C
        if eid in ('dry-cooler', 'water-exchanger'):
            e['heat']['coolant_in_min_c'] = 45
        if eid == 'monitor':
            e['mirrors'] = "gun-turret (role; the flamethrower turret's tech slot)"   # J23: leading token = defaults id
        if eid == 'half-track':
            e['name'] = 'Half-track'
            e['mirrors'] = 'tank (unarmed: B L14)'
        if eid == 'decider-combinator':
            e['name'] = 'Decision unit'
        if eid == 'nuclear-reactor':
            e['extra'] = {'heat_mw': 40, 'neighbor_bonus': 1.0, 'max_temperature_c': 1000}
        if eid == 'fusion-reactor':
            x = e['extra']
            e['extra'] = {'electric_kw': x['electric_kw'], 'plasma_per_s': x['plasma_per_s'], 'plasma_mw': x['plasma_mw'],
                          'feeds_generators': x['feeds_generators'], 'neighbor_bonus': 1.0}
        if en:
            e['energy'] = en
        out.append(reorder(e, ENT_ORDER))
    term = {'id': 'terminal', 'name': 'Terminal', 'type': 'other', 'size': [2, 2], 'item': 'terminal',
            'energy': {'source': 'electric', 'kw': 30},
            'extra': {'fluid_box': 'one data-line connection (category data)',
                      'statuses': 'Working (linked), Not linked, No university in range, No power'},
            'mirrors': 'new (DECISIONS §23d; staffing link, 01 §8)', 'desc': ENTITY_DESC['terminal']}
    idx = next(i for i, x in enumerate(out) if x['id'] == 'data-lake') + 1
    out.insert(idx, reorder(term, ENT_ORDER))
    return out


# ------------------------------------------------------------------ recipes
ALLOW_PROD = {   # DECISIONS §30: Factorio 2.0's 42 eligible recipes, by mirror (balance B1), plus the experiment loop
    'iron-plate', 'copper-plate', 'steel-plate', 'silicon', 'token', 'iron-gear-wheel', 'iron-stick', 'copper-cable',
    'logic-board', 'processor', 'accelerator', 'engine-unit', 'electric-engine-unit', 'drone-frame', 'rack', 'barrel',
    'drive', 'sulfur', 'sulfuric-acid', 'lubricant', 'wafer', 'battery', 'explosives', 'deduplication',
    'quality-filtering', 'denoising', 'rephrasing', 'synthetic-data', 'dataset', 'benchmark', 'adversarial-set',
    'corpus', 'memo', 'report', 'article', 'proceedings', 'preprint', 'model-card', 'run-shard', 'experiment',
    'analysis', 'meta-analysis', 'meta-analysis-baselines', 'uranium-processing', 'kovarex-enrichment-process',
    'nuclear-fuel-reprocessing', 'uranium-fuel-cell'}
REC_ORDER = ['id', 'name', 'category', 'time', 'ingredients', 'products', 'handcraft', 'allow_productivity',
             'amounts_by_j', 'pseudo', 'victory', 'container', 'shared_unlock', 'handbook_note', 'mirrors']


def do_recipes(recs):
    out = []
    for r in recs:
        r = copy.deepcopy(r)
        rid = r['id'] = THING_RENAME.get(r['id'], r['id'])
        for p in r['products']:
            p['id'] = THING_RENAME.get(p['id'], p['id'])
            if p.get('catalyst'):
                p['affected_by_quality'] = False                 # L5: the copied original never rolls
        times = {'experiment': 1, 'analysis': 2.4, 'meta-analysis': 12, 'meta-analysis-baselines': 12}   # §22
        if rid in times:
            r['time'] = times[rid]
        if rid in ALLOW_PROD:
            r['allow_productivity'] = True
        if 'note' in r:
            r['handbook_note'] = r.pop('note')
        if rid == 'deduplication':
            r['handbook_note'] = 'Prose follows the junk share of new writing.'      # no symbols in UI (08 §10.1)
        if rid == 'quality-filtering':
            r['handbook_note'] = 'Junk follows the junk share of new writing; text and prose share the rest.'
        if rid == 'wafer':
            r.pop('name', None)                                  # accuracy §2.3: not photolithography
        if rid == 'deployer':                                    # coherence M8: not a computing machine by recipe
            r['ingredients'] = [{'id': 'steel-chest', 'amount': 1}, {'id': 'logic-board', 'amount': 10},
                                {'id': 'decider-combinator', 'amount': 5}]
        if rid == 'area-scanner':
            r['ingredients'] = [{'id': 'radar', 'amount': 1}, {'id': 'logic-board', 'amount': 5},
                                {'id': 'copper-cable', 'amount': 5}]
        if rid == 'launch':
            r['name'] = 'Launch a frontier run'
        out.append(reorder(r, REC_ORDER))
        if rid == 'launch':
            out.append(reorder({'id': 'launch-empty', 'name': 'Launch without a payload', 'category': 'launch', 'time': 1,
                                'ingredients': [{'id': 'run-shard', 'amount': 100}],
                                'products': [{'id': 'frontier-checkpoint', 'amount': 1}],
                                'handcraft': False, 'pseudo': True,
                                'handbook_note': 'Returns the weights and no System cards.',
                                'mirrors': 'rocket launch without a satellite (coherence M7, C2)'}, REC_ORDER))
        if rid == 'data-lake':
            out.append(reorder({'id': 'terminal', 'category': 'crafting', 'time': 2,
                                'ingredients': [{'id': 'logic-board', 'amount': 5}, {'id': 'copper-cable', 'amount': 5},
                                                {'id': 'data-line', 'amount': 1}],
                                'products': [{'id': 'terminal', 'amount': 1}],
                                'mirrors': 'new (DECISIONS §23d)'}, REC_ORDER))
    return out


# ------------------------------------------------------------------ technologies
TECH_DESC = {   # the definition clause only (DECISIONS §34; 08 §5.1 #11: <= 10 words, at most one technology in three)
    'switching-circuits': 'Relays and switches compute Boolean logic.',
    'basic-research': 'Research performed without thought of practical ends.',
    'tabulation': 'Machines count and sort punched cards.',
    'stored-program': 'Instructions are kept in memory alongside data.',
    'linear-programming': 'Optimize a linear objective under linear constraints.',
    'learning-curve': 'Average cost falls with each doubling of cumulative output.',
    'semaphores': 'A signal admits one occupant at a time.',
    'fire-control': 'Predict where the target will be; aim there.',
    'citation-index': 'Papers indexed by the papers that cite them.',
    'time-sharing': 'One machine, many users at once.',
    'memex': "A desk that stores a person's records.",
    'statistical-learning': 'Learning as estimation, with bounds on the error.',
    'game-theory': 'Strategy against an opponent who strategizes back.',
    'deep-learning': 'Many layers of features, learned one layer at a time.',
    'expected-utility': 'Rank gambles by their probability-weighted utility.',
    'in-context-learning': 'A trained model learns a task from its prompt.',
    'rollback-recovery': 'Restore a saved state after a fault.',
    'cluster-computing': 'Commodity machines joined into one computer.',
    'information-theory': 'Information measured in bits, apart from meaning.',
    'threat-monitoring': 'Watch the audit trail for misuse, and undo it.',
    'integrated-circuit': 'A whole circuit made in one piece of semiconductor.',
    'accelerators': 'Matrix arithmetic on hardware built for graphics.',
    'laser': 'Coherent light from stimulated emission.',
    'mobile-automata': 'A machine that plans its own movements.',
    'scaling-laws': 'Loss falls as a power law in scale.',
    'web-search': 'Pages ranked by the links that point to them.',
    'data-parallelism': 'Many machines share one job; each adds less.',
    'automated-planning': 'Search for a sequence of actions that reaches a goal.',
    'instruction-tuning': 'Models trained to follow written requests.',
    'crawling': 'A program follows links and copies what it finds.',
    'text-categorization': 'Documents are sorted by their statistics.',
    'synthetic-data': 'Data drawn from a model fitted to real data.',
    'cross-validation': 'Fit on part of the data; score on the rest.',
    'perceptron': 'Threshold units whose weights are set by example.',
    'systolic-arrays': 'Operands pulse through a grid of multiply-add cells.',
    'backpropagation': 'Errors pass backward to set every weight.',
    'convolution': 'The same weights at every position.',
    'attention': 'Every token weighs every other token.',
    'cmos': 'Logic that draws power only when it switches.',
    'model-compression': "A small model trained on a large model's outputs.",
    'quantization': 'Fewer bits per weight.',
    'embodied-agents': 'Legs coordinated by local reflexes, not a central plan.',
    'cybernetics': 'Control by feedback, computed by networks of simple units.',
    'lateral-inhibition': 'The strongest signals suppress their neighbors.',
    'rejection-sampling': 'Sample, test, keep what passes.',
    'scalable-oversight': 'Supervise work that people cannot check directly.',
    'formal-verification': 'A machine-checked proof that the program is correct.',
    'expert-iteration': 'Search finds better answers; the model learns them; repeat.',
    'artificial-intelligence': 'Proposed as a two-month, ten-man study.',
    'expert-systems': 'Rules written by hand, consulted by machine.',
    'packet-switching': 'Messages cut into packets, each routed independently.',
    'dennard-scaling-1': 'Smaller transistors, same power per area.',
    'synthetic-detection': 'Classifiers that flag machine-written text.',
    'watermarking': 'Generated text carries a signature that exchanges can filter.',
    'preference-tuning': 'Tune against a reward fitted to human comparisons.',
    'interpretability': 'Read what a trained network computes.',
    'chain-of-thought': 'Intermediate steps written out before the answer.',
    'self-play': 'The model generates its own training opponents.',
    'test-time-compute': 'Spend compute per answer instead of per model.',
    'automated-research': 'Machines do the research that improves the machines.',
    'reversible-logic': 'Computation that erases nothing, so dissipates less.',
    'research-productivity': 'Output per researcher.',
    'self-driving-labs': 'Experiments chosen, run and read by machine.',
    'process-node': 'Components per chip double at a steady rate.',
    'algorithmic-progress': 'The same loss for less compute.',
    'hypothesis-testing': 'Reject the null when chance alone rarely explains the data.',
    'meta-analysis': "Pool many studies' results into one estimate.",
    'microfluidic-cooling': 'Coolant flows through channels etched into the die.',
    'self-reproducing-automata': 'A machine that builds from a description, its own included.',
    'energy-per-operation': 'Erasing a bit dissipates at least kT ln 2.',
    # uncited (infrastructure or beyond)
    'batch-processing': 'Collect a full load, then move it at once.',
    'rural-electrification': 'The grid reaches every outpost.',
    'prior-art': 'Known before the charter.',
    'defense-in-depth': 'Layers, so that one failure is not the last.',
    'isotope-separation': 'Spinning gas sends the heavier isotope to the wall.',
    'model-generation': 'The previous generation trained this one.',
    'model-generation-25': 'The previous generation trained this one.',
    'weight-transplant': 'Weights move to new hardware without retraining.',
    'wafer-scale-integration': 'One chip the size of the wafer.',
    'photonic-interconnect': 'Light carries data between chips.',
    'sparse-inference': 'Each step runs only part of the network.',
}
TECH_NOTE = {   # one sentence after the generated effect lines (R4-ui's `note`)
    'expert-systems': 'Does not apply to machines.',
    'dennard-scaling-5': 'No further levels exist.',
    'interpretability': 'It was always there.',
}
TECH_HANDBOOK = {
    'model-generation': 'Numbered on from the Fifth Generation Computer Systems project (Moto-oka, 1982).',
    'model-generation-25': 'Numbered on from the Fifth Generation Computer Systems project (Moto-oka, 1982).',
}
BEYOND = {'model-generation', 'model-generation-25', 'wafer-scale-integration', 'fusion-power', 'photonic-interconnect',
          'research-scheduling', 'weight-transplant', 'two-phase-cooling', 'fleet-scheduling', 'sparse-inference',
          'nanofabrication'}
TECH_ORDER = ['id', 'name', 'code', 'era', 'regime', 'prerequisites', 'trigger', 'cost', 'count_formula', 'first_level',
              'max_level', 'unlocks', 'essential', 'upgrade', 'branch', 'mirrors', 'field_year', 'citation', 'desc',
              'note', 'handbook_note']


CITE_FIX = {   # verifier recommendations applied after the merge (APA: original title, English in brackets, Latin script)
    ('pipelining', 'Buchholz', 1962): {'role': 'editor'},
    ('backpropagation', 'Linnainmaa', 1970): {'title': 'Algoritmin kumulatiivinen pyöristysvirhe yksittäisten pyöristysvirheiden Taylor-kehitelmänä [The representation of the cumulative rounding error of an algorithm as a Taylor expansion of the local rounding errors]'},
    ('statistical-learning', 'Vapnik', 1968): {'title': 'O ravnomernoi skhodimosti chastot poiavleniia sobytii k ikh veroiatnostiam [The uniform convergence of frequencies of the appearance of events to their probabilities]'},
    ('embodied-agents', 'Brooks', 1989): {'title': 'A robot that walks; emergent behaviors from a carefully evolved network'},
    ('crawling', 'Eichmann', 1994): {'title': 'The RBSE spider — balancing effective search against Web load'},
    ('linear-programming', 'Kantorovich', 1939): {'title': 'Matematicheskie metody organizatsii i planirovaniia proizvodstva [Mathematical methods of organizing and planning production]', 'venue': 'Leningrad State University Press (in Russian); English translation in Management Science, 6(4), 366–422, 1960'},
    ('linear-programming', 'Dantzig', 1949): {'title': 'Programming of interdependent activities: II mathematical model'},
}


def load_citations():
    """Verified long forms where available, else the draft."""
    cites = yaml.safe_load((SCR / 'cites_v2.yaml').read_text())
    for n in (1, 2, 3, 4):
        f = SCR / f'verified_batch{n}.yaml'
        if f.exists():
            cites.update(yaml.safe_load(f.read_text()) or {})
    out = {}
    for tid, lst in cites.items():
        ents = []
        for e in lst:
            e = {k: v for k, v in e.items() if k != 'note'}
            e.update(CITE_FIX.get((tid, e['authors'][0].split(',')[0], e['year']), {}))
            ents.append(reorder(e, ['authors', 'more_authors', 'role', 'year', 'title', 'venue', 'kind', 'url']))
        out[tid] = ents
    for lv in range(1, 6):
        out[f'dennard-scaling-{lv}'] = out['dennard-scaling']
    out.pop('dennard-scaling')
    return out


def do_techs(techs):
    cites = load_citations()
    out = []
    for t in techs:
        t = copy.deepcopy(t)
        if t['id'] in TECH_RENAME:
            t['id'], t['name'] = TECH_RENAME[t['id']]
        t['prerequisites'] = [TECH_RENAME.get(p, (p,))[0] for p in t['prerequisites']]
        tid = t['id']
        u = t['unlocks']
        u['recipes'] = [THING_RENAME.get(r, r) for r in u.get('recipes', [])]
        # citations and regime (DECISIONS §35)
        t.pop('citation', None)
        t.pop('year', None)
        t.pop('desc', None)
        if tid in cites:
            t['regime'] = 'cited'
            t['citation'] = copy.deepcopy(cites[tid])
        elif tid in BEYOND:
            t['regime'] = 'beyond'
            t['field_year'] = '2025+0.5*(L-5)' if tid == 'model-generation' else (2035 if tid == 'model-generation-25' else 2025)
        else:
            t['regime'] = 'infrastructure'
        if tid in TECH_DESC:
            t['desc'] = TECH_DESC[tid]
        if tid in TECH_NOTE:
            t['note'] = TECH_NOTE[tid]
        if tid in TECH_HANDBOOK:
            t['handbook_note'] = TECH_HANDBOOK[tid]
        # takeoff technologies: 60 s per unit (DECISIONS §23c; every System-card-only technology)
        c = t.get('cost')
        if c and set(c['packs']) == {'system-card'}:
            c['time'] = 60
        # effects
        effs = u.get('effects') or []
        for ef in effs:
            if ef.get('type') == 'research-per-paper':          # J14: m = 1.5^r from the world setting
                ef.pop('multiplier', None)
                ef.pop('note', None)
                ef['multiplier_from'] = 'returns_to_research'
        if tid == 'packet-switching':
            u['effects'] = [ef for ef in effs if ef['type'] != 'exchange-taps']     # J22
        if tid == 'nanofabrication':
            effs[0]['recipes'] = ['accelerator']                 # DECISIONS §30 / balance B1
        if tid == 'microfluidic-cooling':
            effs[0]['entities'] = ['dry-cooler', 'water-exchanger']   # accuracy §2.3: a tower never touches coolant
        if tid == 'explosive-yield-1':
            u['effects'] = [{'type': 'ammo-damage', 'category': 'landmine', 'value': 0.25}]   # N21
        if tid == 'energy-per-operation':
            u['effects'] = [{'type': 'compute-energy-floor', 'multiplier': 0.9, 'floor_temperature_k': 4800}]
        if tid == 'interpretability':
            u['effects'] = [{'type': 'hollow-work-free'}, {'type': 'show-model-quality'}]
        if tid == 'time-sharing':
            t['prerequisites'] = ['citation-index', 'packet-switching']       # DECISIONS §23d; gateway rule
            u['recipes'] = ['terminal']
        if tid == 'rocketry':
            t['prerequisites'] = ['explosives', 'game-theory']     # coherence m19
        if tid == 'scaling-laws':
            u['recipes'] = u['recipes'] + ['launch-empty']
        if tid == 'wearable-computing':
            t['regime'] = 'infrastructure'
        if not u.get('effects'):
            u.pop('effects', None)
        t['unlocks'] = u
        out.append(reorder(t, TECH_ORDER))
    return out


# ------------------------------------------------------------------ resources and enemies
RES_AUTOPLACE = {
    'iron-ore-patch': 'ISO (01 §4). Starting patch 600,000 ±20%, inside the starting college\'s coverage square (01 §9; DECISIONS §32)',
    'copper-ore-patch': 'ISO (01 §4). Starting patch 500,000 ±20%, inside the starting college\'s coverage square (01 §9)',
    'coal-patch': 'ISO (01 §4). Starting patch 400,000 ±20%, inside the starting college\'s coverage square (01 §9)',
    'quartz-patch': 'ISO with stone (01 §4); favours coasts and sand. Starting patch 300,000 ±20%, inside the starting college\'s coverage square (01 §9)',
    'archive': 'At towns (01 §5.4, §6): library stacks beside the footprint; records stores in old mines beyond 512 tiles. Totals and the per-tile rule: meta.world.archives. The starting college\'s library holds 80,000 records, inside its coverage square (01 §9). Finite; never synthetic (low-background data)',
    'uranium-ore-patch': 'ISO: never within 512 tiles of spawn; 1 sulfuric acid per ore (01 §4)',
    'exchange': 'At towns (01 §5.4, §7): 1–4 taps per exchange, like an oil cluster. A tap holds a Crawler (Crawling) or an Endpoint (Deep learning). Yield, floor and closing to crawlers: meta.world.exchange; Endpoints keep working on a closed exchange',
    'water': 'ISO lakes and coast (01 §2)',
}


def do_resources(res):
    out = []
    for r in res:
        r = copy.deepcopy(r)
        if r['id'] == 'trees':
            continue                      # trees are world objects now (world.yaml, J9)
        r.pop('min_yield', None)          # N8: superseded by the floor (01 §7.2)
        if r['id'] in RES_AUTOPLACE:
            r['autoplace'] = RES_AUTOPLACE[r['id']]
        out.append(r)
    return out


def do_enemies(en):
    out = []
    for e in en:
        e = copy.deepcopy(e)
        if e['id'] == 'runaway':
            e['targets'] = ('susceptible machines (computing machines, Researcher Seminars, anything holding a Learned or '
                            'Distilled controller) linked to an infected machine by a data-line network, an exchange, one '
                            "Switch's area, or one agent hub's logistic area whose network holds a logistic agent; never "
                            'circuit or power wires, belts, pipes, inserters or trains')
            e['spread'] = 'per infection: one copy per interval into the nearest linked target (meta.runaways.spread)'
            e['effect'] = 'the compromised machine stops working for you; it keeps its full working draw and heat'
        if e.get('kind') == 'spawner':
            e['desc'] = 'Copy of {checkpoint}, tier {tier}.'     # runtime placeholders
        out.append(e)
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    h, items = load('items')
    dump('items', h, do_items(items))
    h, ents = load('entities')
    dump('entities', h, do_entities(ents))
    h, recs = load('recipes')
    dump('recipes', h, do_recipes(recs))
    h, techs = load('technologies')
    dump('technologies', '# Technologies: E\'s tree with D\'s ids; regime and long-form citations per DECISIONS §35 (05-research.md lists every change).\n', do_techs(techs))
    h, res = load('resources')
    dump('resources', h, do_resources(res))
    h, en = load('enemies')
    dump('enemies', h, do_enemies(en))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
