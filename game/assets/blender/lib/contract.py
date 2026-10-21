"""The model-script contract (10 §9.1, §15.7), shared by the Blender renderer and the build's planner. No bpy.

A model script exports META and functions by kind. Every distance is in metres (= tiles); x east, y north,
z up; the model stands on its footprint centre at the origin. Scripts import their helpers with plain import
statements (`from entities import _inserter`): the planner follows them into the render key, and the renderer
fails a job that loads a model file the plan does not declare (assets/blender/jobs.py).

kind 'entity' (machines, chests, belts, greyboxes):
    META: size (w, h tiles at direction north), height (m), dirs (the Direction values 0-15 that get art,
          e.g. [8]), dir_alias ({value: value with art}, e.g. {8: 0, 12: 4} for a two-way set), variants
          (int, or a dict name -> mask list for connection masks), states (['working'] or
          ['working', 'idle']), layers ([{parts: [...], frames: n}]), light (emitters present), smoke
          (chimney points, m, at direction south), margin, ink ('machine', 'archive', 'ore', 'decorative'),
          anim_shadow (the shadow follows the animation: rendered per frame; needs layers or full_frame, and all
          layer slots of one length), full_frame (the whole sprite animates: belts), rotate_footprint (default:
          w != h), cut (the piece is modelled past its tile and cut by self_region(variant) with the position
          pass), shadow_samples (default 64; greyboxes 16).
          A layer whose parts carry an emitter material (fire, lamps) moves its light: the light is then
          rendered per frame (10 §9.1 step 7) and the manifest marks the set animLight.
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
    pieces(band, n) -> how many of the n pieces band 0-7 keeps: band 0 is the full pile (CHUNK_RESOURCES.band in
    Factorio's stage order, the golden model's rule 24: band 0 the richest tile, band 7 the poorest)
kind 'object' (trees, rocks, decoratives, town buildings; 10 §15.7's `object` program):
    META: size (w, h tiles of its footprint, default 1 x 1), height (m), shapes (pictures the position hash picks
          from, default 1), stages (default 1; trees 5: the leaf stages left, 0 bare to 4 full), shadow_stage
          (the stage whose shadow every stage shares, 10 §15.7 "shadows [shape]"; default the last), margin, ink
          (default 'decorative'), extra
    build(P, shape, stage) -> {name: object} or a list; the object stands on its position at the origin.
    An authoring example is test/assets/examples/object_rock.py (rendered and checked by test/assets/
    examples.py).
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
# the kinds the renderer and the post step implement (render.py, render_icons.py, post.py check against it)
RENDERED = ('entity', 'inserter', 'object', 'resource', 'mover', 'icon')
STATES = ('working', 'idle')
FUNCTIONS = {
    'entity': ('build',),
    'inserter': ('build_platform', 'build_arm', 'build_hand'),
    'resource': ('build', 'pieces'),
    'object': ('build',),
    'mover': ('build', 'pose'),
    'icon': ('build',),
}


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
    if m['kind'] not in RENDERED:
        raise ValueError(f'kind {m["kind"]!r} has no renderer')
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
        if m['anim_shadow'] and not m['layers']:
            raise ValueError('anim_shadow needs an animation (layers or full_frame)')
        if m['anim_shadow'] and not m['full_frame'] and len({L['frames'] for L in m['layers']}) > 1:
            raise ValueError('anim_shadow needs all layers of one frame count (the shadow has one frame axis)')
    elif m['kind'] == 'inserter':
        m.setdefault('platform_dirs', [0, 4, 8, 12])
    elif m['kind'] == 'resource':
        m.setdefault('shapes', 6)
        m.setdefault('bands', 8)
    elif m['kind'] == 'object':
        m.setdefault('size', (1, 1))
        m.setdefault('shapes', 1)
        m.setdefault('stages', 1)
        m.setdefault('shadow_stage', m['stages'] - 1)
        m['ink'] = meta.get('ink', 'decorative')
        if not 0 <= m['shadow_stage'] < m['stages']:
            raise ValueError(f'shadow_stage {m["shadow_stage"]} outside 0..{m["stages"] - 1}')
        if m['stages'] not in (1, 5):
            raise ValueError('an object has 1 stage or 5 (10 §15.7: a tree\'s leaf stages 0 bare to 4 full)')
    elif m['kind'] == 'mover':
        m.setdefault('orientations', 8)
    return m


def capability_errors(mod, kind):
    """Plan-time validation (codex C6-r1 finding 11): the kind has a renderer, META normalises, and the script
    has the functions its kind calls. Returns error strings."""
    errs = []
    try:
        meta = normalize(getattr(mod, 'META', {}), kind)
    except (ValueError, KeyError, TypeError) as e:
        return [f'META: {e}']
    for fn in FUNCTIONS[kind]:
        if not callable(getattr(mod, fn, None)):
            errs.append(f'no {fn}() for kind {kind}')
    if kind == 'entity':
        if meta['layers'] and not callable(getattr(mod, 'pose', None)):
            errs.append('layers without pose()')
        if meta.get('cut') and not callable(getattr(mod, 'self_region', None)):
            errs.append('cut without self_region()')
        if len(variant_list(meta)) > 1 and not callable(getattr(mod, 'mask_variants', None)):
            errs.append('several variants without mask_variants(mask)')
    return errs


def variant_list(meta):
    """[(variant index, name)] of an entity set."""
    v = meta.get('variants', 1)
    if isinstance(v, dict):
        return list(enumerate(v.keys()))
    return [(i, str(i)) for i in range(int(v))]
