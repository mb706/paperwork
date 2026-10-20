"""burner-inserter (1x1): Factorio's burner inserter: an iron firebox on the pickup side, its mouth glowing, a
bare-steel column and a dark boom (the platform is 59 % darker than the paper, inside A3's 25-60 %). The parts and
their contract are in _inserter.py (10 §15.7's inserter program)."""

from entities import _inserter as IN

META = IN.meta()
ARM = 'arm_dark'


def build_platform(P, d):
    return IN.platform(P, d, ARM, burner=True)


def build_arm(P):
    return IN.arm(P, ARM)


def build_hand(P, closed):
    return IN.hand(P, closed)
