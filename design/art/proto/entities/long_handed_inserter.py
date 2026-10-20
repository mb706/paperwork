"""long-handed-inserter (1x1): 'red arm with a long reach'."""
from entities._inserter import build_inserter, hand_pos  # noqa: F401

META = dict(size=(1, 1), height=0.8, directions=['S'], frames=1, variants=6, margin=1.6, rotate_footprint=False)


def build(P, direction='S', frame=0, variant=0, state='working'):
    return build_inserter(P, variant, 'arm_red', reach=1.92, state=state)
