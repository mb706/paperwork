"""The model-script contract (10 §9.1, §15.7), shared by the Blender renderer and the build's planner. No bpy.

A model script exports META and functions by kind. Every distance is in metres (= tiles); x east, y north,
z up; the model stands on its footprint centre at the origin.

kind 'entity' (machines, chests, belts, greyboxes):
    META: size (w, h tiles at direction north), height (m), dirs (the Direction values 0-15 that get art,
          e.g. [8]), dir_alias ({value: value with art}, e.g. {8: 0, 12: 4} for a two-way set), variants
          (int, or a dict name -> mask list for connection masks), states (['working'] or
          ['working', 'idle']), layers ([{parts: [...], frames: n}]), light (emitters present), smoke
          (chimney points, m, at direction south), margin, ink ('machine', 'archive', 'ore', 'decorative'),
          anim_shadow, full_frame (the whole sprite animates: belts), rotate_footprint (default: w != h),
          cut (the piece is modelled past its tile and cut by self_region(variant) with the position pass),
          shadow_samples (default 64; greyboxes 16).
    build(P, dir, variant, state) -> {name: object}  every animated part named
    pose(parts, layer, frame)                         moves one layer's parts by transform alone
kind 'inserter':
    META: size, height, platform_dirs, shoulder (m, height of the arm's pivot), arm_length (m, pivot to tip as
          modelled), margin, ink
    build_platform(P, dir), build_arm(P), build_hand(P, closed) -> {name: object}; the arm points north from
    the pivot at (0, 0, shoulder); a hand's pivot (the wrist) is at the origin.
kind 'resource':
    META: shapes, bands (8), margin, ink, height
    build(P, shape) -> list of pieces in removal order (the last removed first is the list's end);
    pieces(band) -> how many of them band 0-7 keeps (band 7 is the full pile)
kind 'mover' (the character):
    META: size, height, orientations (8 or 16), clips {name: {frames, fps | cycle_tiles}}, margin, ink
    build(P) -> {name: object} with a root named 'root'; pose(parts, clip, frame) sets one frame's pose.
kind 'icon':
    build(P) -> list of objects (an item model), rendered by render_icons.py.
"""

# 10 §15.7's closed axis vocabulary, versioned by axesVersion (the renderer refuses another version).
AXES_VERSION = 1
AXES = ('dir', 'mask', 'shape', 'stage', 'band', 'light', 'orientation', 'frame')
DIRECTIONS = 16
KINDS = ('entity', 'inserter', 'object', 'resource', 'mover', 'icon')
STATES = ('working', 'idle')


def dir_map(dirs, alias=None):
    """The 16-entry `map.dir` (value -> index) and the axis size. Values with no art map to one extra index
    whose table entries are empty lists (10 §15.7: "a four-way set ... holds empty entries elsewhere");
    a set drawn from one direction maps every value to 0."""
    # keys arrive as strings from a record's JSON
    alias = {int(k): int(v) for k, v in (alias or {}).items()}
    dirs = list(dirs)
    if len(dirs) == 1:
        return [0] * DIRECTIONS, 1
    m = []
    empty = len(dirs)
    used_empty = False
    for v in range(DIRECTIONS):
        if v in dirs:
            m.append(dirs.index(v))
        elif v in alias and alias[v] in dirs:
            m.append(dirs.index(alias[v]))
        else:
            m.append(empty)
            used_empty = True
    return m, len(dirs) + (1 if used_empty else 0)


def footprint(size, d, rotate=None):
    """(w, h) of the footprint at Direction d: east and west swap a non-square footprint."""
    w, h = size
    if rotate is None:
        rotate = w != h
    if rotate and d % 8 == 4:
        return h, w
    return w, h


def normalize(meta, kind=None):
    m = dict(meta)
    m['kind'] = kind or m.get('kind', 'entity')
    if m['kind'] not in KINDS:
        raise ValueError(f'unknown kind {m["kind"]!r}')
    m.setdefault('margin', 0.5)
    m.setdefault('ink', 'machine')
    m.setdefault('extra', (0, 0, 0, 0))
    if m['kind'] == 'entity':
        m.setdefault('dirs', [8])
        m.setdefault('dir_alias', {})
        m.setdefault('variants', 1)
        m.setdefault('states', ['working'])
        m.setdefault('layers', [])
        m.setdefault('light', False)
        m.setdefault('smoke', [])
        m.setdefault('anim_shadow', False)
        m.setdefault('full_frame', False)
        m.setdefault('rotate_footprint', m['size'][0] != m['size'][1])
        for s in m['states']:
            if s not in STATES:
                raise ValueError(f'unknown state {s!r}')
        if m['full_frame'] and len(m['layers']) != 1:
            raise ValueError('a full-frame set has exactly one layer (its frame count)')
    elif m['kind'] == 'inserter':
        m.setdefault('platform_dirs', [0, 4, 8, 12])
    elif m['kind'] == 'resource':
        m.setdefault('shapes', 6)
        m.setdefault('bands', 8)
    elif m['kind'] == 'mover':
        m.setdefault('orientations', 8)
    return m


def variant_list(meta):
    """[(variant index, name)] of an entity set."""
    v = meta.get('variants', 1)
    if isinstance(v, dict):
        return list(enumerate(v.keys()))
    return [(i, str(i)) for i in range(int(v))]
