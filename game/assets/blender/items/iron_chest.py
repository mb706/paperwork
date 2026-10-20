"""Icon of item iron-chest: a building's icon is its entity model in the default state (A3 §7)."""

from entities.iron_chest import build as _entity


def build(P):
    return list(_entity(P, dir=8, variant=0, state='working').values())
