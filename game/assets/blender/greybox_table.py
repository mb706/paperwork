"""Greybox parameters for every entity (10 §9.2 "Placeholders"): footprint from entities.yaml, height and family.

No bpy: the build's planner imports it. Heights are the modelled heights of 10 §9.6's budget model and A3's
scripts (metres; a tile is a metre): a greybox is height-correct, so placement, sorting and shadows behave as the
real model's will. The family colour follows Factorio's coding where it exists (belt and inserter tiers, logistic
chest colours) and the entity's type elsewhere. A greybox is drawn once per footprint orientation: a non-square
rotatable footprint (game/data/engine/defaults.yaml) twice, north-south and east-west; every other one once
(greybox.py says why).
"""

import os

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULTS = os.path.join(HERE, '..', '..', 'data', 'engine', 'defaults.yaml')

HEIGHT = {
    'burner-mining-drill': 1.6, 'electric-mining-drill': 2.0, 'offshore-pump': 1.2, 'crawler': 3.0,
    'stone-furnace': 1.6, 'steel-furnace': 1.7, 'electric-furnace': 2.0, 'keypunch': 1.6, 'tokenizer': 2.2,
    'assembling-machine-1': 2.0, 'assembling-machine-2': 2.2, 'assembling-machine-3': 2.4, 'chemical-plant': 2.4,
    'data-refinery': 4.0, 'data-plant': 2.4, 'trainer': 2.4, 'centrifuge': 2.4, 'seminar': 2.05, 'switch': 2.0,
    'frontier-cluster': 6.0, 'boiler': 2.2, 'steam-engine': 2.45, 'solar-panel': 0.5, 'accumulator': 2.0,
    'nuclear-reactor': 3.5, 'heat-pipe': 0.3, 'heat-exchanger': 2.2, 'steam-turbine': 2.6,
    'small-electric-pole': 3.0, 'medium-electric-pole': 4.5, 'big-electric-pole': 7.0, 'substation': 5.0,
    'transport-belt': 0.26, 'fast-transport-belt': 0.26, 'express-transport-belt': 0.26,
    'underground-belt': 0.6, 'fast-underground-belt': 0.6, 'express-underground-belt': 0.6,
    'splitter': 0.8, 'fast-splitter': 0.8, 'express-splitter': 0.8,
    'burner-inserter': 0.75, 'inserter': 0.75, 'long-handed-inserter': 0.75, 'fast-inserter': 0.75,
    'bulk-inserter': 0.75, 'wooden-chest': 0.95, 'iron-chest': 0.56, 'steel-chest': 0.62,
    'active-provider-chest': 0.9, 'passive-provider-chest': 0.9, 'storage-chest': 0.9, 'buffer-chest': 0.9,
    'requester-chest': 0.9, 'pipe': 0.55, 'pipe-to-ground': 0.6, 'pump': 1.0, 'storage-tank': 2.5,
    'data-line': 0.4, 'underground-line': 0.5, 'repeater': 1.0, 'data-lake': 2.5, 'terminal': 1.8, 'rail': 0.3,
    'train-stop': 4.0, 'rail-signal': 1.5, 'rail-chain-signal': 1.5, 'locomotive': 3.0, 'cargo-wagon': 3.0,
    'fluid-wagon': 3.0, 'data-wagon': 3.0, 'agent-hub': 2.5, 'radar': 3.0, 'car': 1.6, 'small-lamp': 0.6,
    'decider-combinator': 0.8, 'arithmetic-combinator': 0.8, 'constant-combinator': 0.8,
    'selector-combinator': 0.8, 'power-switch': 1.6, 'programmable-speaker': 1.2, 'display-panel': 0.6,
    'cooling-tower': 4.0, 'dry-cooler': 1.5, 'water-exchanger': 1.5, 'monitor': 2.0, 'fence': 1.2, 'gate': 1.2,
    'gun-turret': 1.8, 'laser-turret': 1.8, 'arc-turret': 2.5, 'artillery-turret': 2.5, 'artillery-wagon': 3.0,
    'interceptor-bay': 1.8, 'land-mine': 0.2, 'half-track': 2.0, 'legged-agent': 3.0, 'endpoint': 2.4,
    'research-hall': 3.6, 'fusion-reactor': 4.0, 'fusion-generator': 2.6, 'verifier': 2.0, 'deployer': 1.0,
    'area-scanner': 0.8,
}

FAMILY_BY_ID = {
    'transport-belt': 'belt_yellow', 'underground-belt': 'belt_yellow', 'splitter': 'belt_yellow',
    'fast-transport-belt': 'belt_red', 'fast-underground-belt': 'belt_red', 'fast-splitter': 'belt_red',
    'express-transport-belt': 'belt_blue', 'express-underground-belt': 'belt_blue', 'express-splitter': 'belt_blue',
    'burner-inserter': 'arm_dark', 'inserter': 'arm_yellow', 'long-handed-inserter': 'arm_red',
    'fast-inserter': 'arm_blue', 'bulk-inserter': 'enamel_green',
    'wooden-chest': 'wood', 'iron-chest': 'iron_chest', 'steel-chest': 'steel_bare',
    'active-provider-chest': 'enamel_red', 'passive-provider-chest': 'enamel_red', 'storage-chest': 'brass',
    'buffer-chest': 'enamel_green', 'requester-chest': 'enamel_blue',
    'keypunch': 'enamel_blue', 'seminar': 'enamel_cream', 'research-hall': 'enamel_cream',
    'stone-furnace': 'quartz_stone', 'small-electric-pole': 'wood_pole', 'medium-electric-pole': 'steel_dark',
    'big-electric-pole': 'steel_dark', 'substation': 'steel_dark', 'solar-panel': 'glass_dark',
}
FAMILY_BY_TYPE = {
    'mining-drill': 'steel_paint_alt', 'offshore-pump': 'steel_paint_alt', 'pumpjack': 'steel_paint_alt',
    'furnace': 'steel_paint', 'assembler': 'steel_paint', 'lab': 'enamel_cream', 'beacon': 'steel_paint',
    'rocket-silo': 'steel_paint', 'boiler': 'copper', 'generator': 'copper', 'solar-panel': 'glass_dark',
    'accumulator': 'copper', 'reactor': 'copper', 'heat-pipe': 'copper', 'heat-exchanger': 'copper',
    'electric-pole': 'wood_pole', 'pipe': 'cast_iron', 'pipe-to-ground': 'cast_iron', 'pump': 'cast_iron',
    'storage-tank': 'cast_iron', 'rail': 'steel_dark', 'train-stop': 'steel_dark', 'rail-signal': 'steel_dark',
    'locomotive': 'steel_dark', 'cargo-wagon': 'steel_dark', 'fluid-wagon': 'steel_dark', 'roboport': 'enamel_cream',
    'radar': 'steel_paint', 'lamp': 'board_green', 'combinator': 'board_green', 'cooler': 'concrete',
    'turret': 'arm_dark', 'wall': 'concrete', 'gate': 'concrete', 'other': 'steel_paint',
    'belt': 'belt_yellow', 'underground-belt': 'belt_yellow', 'splitter': 'belt_yellow', 'inserter': 'arm_yellow',
    'chest': 'wood', 'logistic-chest': 'brass',
}
# data infrastructure carries information: the enamel blue of the office machines (keypunch, terminal)
DATA_IDS = {'data-line', 'underground-line', 'repeater', 'data-lake', 'terminal', 'data-wagon'}


def _defaults():
    with open(DEFAULTS) as f:
        return yaml.safe_load(f)['entity_types']


def params(entity):
    """The greybox parameters of one entities.yaml record (JSON-safe; hashed into the set's cache key)."""
    eid, etype = entity['id'], entity.get('type', 'other')
    d = _defaults()
    rot = d.get(etype, {}).get('rotatable', d['_all'].get('rotatable', True))
    if eid in DATA_IDS:
        fam = 'enamel_blue'
    else:
        fam = FAMILY_BY_ID.get(eid) or FAMILY_BY_TYPE.get(etype, 'steel_paint')
    w, h = entity['size']
    return dict(id=eid, type=etype, size=[w, h], height=HEIGHT.get(eid, 1.5), family=fam, rotatable=bool(rot))
