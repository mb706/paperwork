"""inserter (1x1): items.yaml 'yellow arm' (Factorio's inserter): an electric motor housing on the pickup side, a
yellow column and boom. The parts and their contract are in _inserter.py (10 §15.7's inserter program)."""

from entities import _inserter as IN

META = IN.meta()
ARM = 'arm_yellow'


def build_platform(P, d):
    return IN.platform(P, d, ARM)


def build_arm(P):
    return IN.arm(P, ARM)


def build_hand(P, closed):
    return IN.hand(P, closed)
