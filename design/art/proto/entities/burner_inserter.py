"""burner-inserter (1x1): 'dark arm on a small firebox base'."""
from entities._inserter import build_inserter, hand_pos  # noqa: F401

META = dict(size=(1, 1), height=0.75, directions=['S'], frames=1, variants=6, margin=0.6, rotate_footprint=False)


def build(P, direction='S', frame=0, variant=0, state='working'):
    return build_inserter(P, variant, 'arm_dark', burner=True, state=state)
