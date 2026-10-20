"""The sprite manifest's semantics in Python (10 §15.7): flatten, axis lookup, the drawing programs, the projection.

The renderer implements the same in TypeScript; both run test/fixtures/sprites/cases.json (10 §15.7 "Fixtures and
versions"), so a disagreement shows in one of the two suites. The asset build uses this for its checks, contact
sheets and previews: nothing else computes frame ids.

Conventions (10 §15.4, §15.7): world x east and y south in tiles; Direction 0-15 (north 0, east 4, south 8, west
12); phases, orientations and theta are turns x 65,536 from north, clockwise; positions of entities are x2, y2 in
half tiles (the footprint centre), of objects and movers in 1/256 tile, of resource tiles in whole tiles.

Interpretations this file fixes where 10 §15.7 is silent (recorded in pm/reports/C6.md):
  * a part's `frame` axis takes its index from the set's clock wherever the part is: DYN.phase for entities,
    and for belts (whose base carries the frame axis) 10 §6.8's rule with the set's framesPerTile;
  * a set without `base` (none today) draws nothing for it; an empty table entry draws the greybox;
  * a part P's shadow is the part `P_shadow`, except `base`, whose shadow is `shadow` (10 §15.7's example);
  * the inserter's shadows rotate like its parts about the shoulder's shadow, anchor + shadowShoulder (shadow
    array px), the hand's shadow at that point plus r S (sin 2 pi theta, -cos 2 pi theta);
  * `orientation` rounds half up: floor(o n / 65,536 + 1/2) mod n.
"""

import math

AXES = ('dir', 'mask', 'shape', 'stage', 'band', 'light', 'orientation', 'frame')
AXES_VERSION = 1
MAP_SIZES = {'dir': 16, 'mask': 256, 'stage': 5}
PX_PER_TILE = 32
HEIGHT_SCALE = 1
BELT_ITEM_SIZE = 0.5


def u32(v):
    return v & 0xFFFFFFFF


def imul(a, b):
    """Math.imul: the low 32 bits of the product of two int32s, as an int32."""
    r = (u32(a) * u32(b)) & 0xFFFFFFFF
    return r - (1 << 32) if r & 0x80000000 else r


def pos_hash(x, y):
    """10 §15.7's position hash: x, y as i32 (1/256 tile for objects, tile coordinates for resources)."""
    h = imul(x, 0x27d4eb2d) ^ imul(y, 0x165667b1)
    h = u32(h)
    h ^= h >> 15
    h = u32(imul(h, 0x85ebca77))
    h ^= h >> 13
    return u32(h)


def flatten(shape, idx):
    """Row-major over the axes, the last fastest: the one flatten function (TypeScript has its twin)."""
    i = 0
    for n, k in zip(shape, idx):
        if not 0 <= k < n:
            raise IndexError(f'index {list(idx)} outside shape {list(shape)}')
        i = i * n + k
    return i


def axis_index(part, axis, value, n):
    m = (part.get('map') or {}).get(axis)
    if m is not None:
        return m[value]
    if axis == 'orientation':
        return int(math.floor(value * n / 65536 + 0.5)) % n
    if axis == 'frame':
        return int(math.floor(value * n / 65536)) % n
    if axis == 'shape':
        return value % n
    return value


def lookup(part, values, frame_index=None):
    """values: axis -> packet value (orientation and phase as turns x 65,536; shape as the position hash).
    frame_index, when given, is the frame axis's index itself (movers' clocks and belts' rule)."""
    idx = [frame_index % n if (a == 'frame' and frame_index is not None) else axis_index(part, a, values[a], n)
           for a, n in zip(part['axes'], part['shape'])]
    return list(part['table'][flatten(part['shape'], idx)])


# --------------------------------------------------------------------------------------------------------------
# Projection (10 §15.7)
# --------------------------------------------------------------------------------------------------------------

def scale(cam):
    return PX_PER_TILE * cam['zoom'] * cam['dpr']


def quad(man, fid, cam, ex, ey):
    """The device-pixel quad [left, top, w, h] of frame fid anchored at world (ex, ey) (tiles), from the canvas
    centre; and its uv rectangle [u0, v0, u1, v1] in the page at level 0."""
    a, layer, x, y, w, h, ax, ay = man['frames'][fid]
    arr = man['arrays'][a]
    S = scale(cam)
    k = S / arr['pxPerTile']
    left = (ex - cam['cx']) * S - ax * k
    top = (ey - cam['cy']) * S - ay * k
    P = arr['pageSize']
    return [left, top, w * k, h * k], [x / P, y / P, (x + w) / P, (y + h) / P]


def icon_quad(man, fid, cam, ex, ey, size_tiles):
    a, layer, x, y, w, h, ax, ay = man['frames'][fid]
    arr = man['arrays'][a]
    S = scale(cam)
    k = S * size_tiles / arr['pxPerTile']
    left = (ex - cam['cx']) * S - ax * k
    top = (ey - cam['cy']) * S - ay * k
    P = arr['pageSize']
    return [left, top, w * k, h * k], [x / P, y / P, (x + w) / P, (y + h) / P]


def pass_of(man, fid):
    return man['arrays'][man['frames'][fid][0]]['kind']


def draws_for(man, part_name, frames, cam, ex, ey, extra=None):
    out = dict(part=part_name, frames=frames, quads=[], uvs=[], passes=[])
    for f in frames:
        q, uv = quad(man, f, cam, ex, ey)
        out['quads'].append([round(v, 4) for v in q])
        out['uvs'].append([round(v, 6) for v in uv])
        out['passes'].append(pass_of(man, f))
    if extra:
        out.update(extra)
    return out


# --------------------------------------------------------------------------------------------------------------
# Drawing programs (10 §15.7 "Drawing programs")
# --------------------------------------------------------------------------------------------------------------

def draw_entity(man, name, view, cam, tick=0, belt_speed=0):
    """view: {x2, y2, dir, variant, dyn: {state, phase, light} or None}."""
    s = man['sets'][name]
    parts = s['parts']
    ex, ey = view['x2'] / 2, view['y2'] / 2
    dyn = view.get('dyn')
    phase = dyn['phase'] if dyn else 0
    fidx = None
    if 'framesPerTile' in s:
        # belts (10 §6.8): frame = (tick x speed x framesPerTile / 256) mod frames
        fidx = tick * belt_speed * s['framesPerTile'] // 256
    values = dict(dir=view.get('dir', 0), mask=view.get('variant', 0), frame=phase)
    working = dyn is not None and dyn['state'] == 1
    out = []
    if working or 'idle' not in parts or dyn is None:
        if 'base' in parts:
            out.append(draws_for(man, 'base', lookup(parts['base'], values, fidx), cam, ex, ey))
        for i, L in enumerate(parts.get('layers', [])):
            out.append(draws_for(man, f'layers[{i}]', lookup(L, values, fidx), cam, ex, ey))
    else:
        out.append(draws_for(man, 'idle', lookup(parts['idle'], values), cam, ex, ey))
    if 'light' in parts:
        alpha = (dyn['light'] / 255) if dyn else 0.0
        out.append(draws_for(man, 'light', lookup(parts['light'], values), cam, ex, ey, dict(alpha=round(alpha, 6))))
    if 'shadow' in parts:
        out.append(draws_for(man, 'shadow', lookup(parts['shadow'], values, fidx), cam, ex, ey))
    return out


def draw_inserter(man, name, hands, cam):
    """hands: {x2, y2, dir, theta, ext (tiles x 4,096), held (0xFFFF none)}: platform, arm, hand and shadows."""
    s = man['sets'][name]
    parts = s['parts']
    S = scale(cam)
    ex, ey = hands['x2'] / 2, hands['y2'] / 2
    th = hands['theta'] / 65536
    r = hands['ext'] / 4096
    ang = 2 * math.pi * th
    out = [draws_for(man, 'platform', lookup(parts['platform'], dict(dir=hands['dir'])), cam, ex, ey),
           draws_for(man, 'platform_shadow', lookup(parts['platform_shadow'], dict(dir=hands['dir'])), cam, ex, ey)]
    ax0, ay0 = (ex - cam['cx']) * S, (ey - cam['cy']) * S         # the anchor, device px from the canvas centre
    hand = 'hand_closed' if hands['held'] != 0xFFFF else 'hand_open'
    for shadow in (False, True):
        arr_kind = 'shadow' if shadow else 'colour'
        P = next(a['pxPerTile'] for a in man['arrays'] if a['kind'] == arr_kind)
        k = S / P
        sh = s['shadowShoulder'] if shadow else s['shoulder']
        qx, qy = ax0 + sh[0] * k, ay0 + sh[1] * k
        hx, hy = qx + r * S * math.sin(ang), qy - r * S * math.cos(ang)
        suffix = '_shadow' if shadow else ''
        arm = parts['arm' + suffix]
        afid = arm['table'][0][0]
        _, _, _, _, aw, ah, _, _ = man['frames'][afid]
        length = parts['arm']['length']
        stretch = math.hypot(hx - qx, hy - qy) / (length * (S / next(a['pxPerTile'] for a in man['arrays']
                                                                     if a['kind'] == 'colour')))
        out.append(dict(part='arm' + suffix, frames=[afid], pass_=arr_kind, pivot=arm['pivot'], at=[round(qx, 4),
                        round(qy, 4)], rotation_turns=round(th, 6), stretch=round(stretch, 6), scale=round(k, 6)))
        hp = parts[hand + suffix]
        out.append(dict(part=hand + suffix, frames=[hp['table'][0][0]], pass_=arr_kind, pivot=hp['pivot'],
                        at=[round(hx, 4), round(hy, 4)], rotation_turns=round(th, 6), scale=round(k, 6)))
        if not shadow and hands['held'] != 0xFFFF:
            out.append(dict(part='held', item=hands['held'], at=[round(hx, 4), round(hy, 4)],
                            size_tiles=BELT_ITEM_SIZE))
    for d in out:
        if 'pass_' in d:
            d['pass'] = d.pop('pass_')
    return out


def draw_object(man, name, obj, cam):
    """obj: {x, y (1/256 tile), variant}: trees [shape, stage], others [shape]; shadows [shape]."""
    s = man['sets'][name]
    parts = s['parts']
    h = pos_hash(obj['x'], obj['y'])
    values = dict(shape=h, stage=obj.get('variant', 0))
    ex, ey = obj['x'] / 256, obj['y'] / 256
    out = [draws_for(man, 'base', lookup(parts['base'], values), cam, ex, ey)]
    if 'shadow' in parts:
        out.append(draws_for(man, 'shadow', lookup(parts['shadow'], values), cam, ex, ey))
    return out


def draw_resource(man, name, tile, cam):
    """tile: {tx, ty (tile coordinates), band}: [shape, band], anchored at the tile's centre."""
    s = man['sets'][name]
    parts = s['parts']
    values = dict(shape=pos_hash(tile['tx'], tile['ty']), band=tile['band'])
    ex, ey = tile['tx'] + 0.5, tile['ty'] + 0.5
    out = [draws_for(man, 'base', lookup(parts['base'], values), cam, ex, ey)]
    if 'shadow' in parts:
        out.append(draws_for(man, 'shadow', lookup(parts['shadow'], values), cam, ex, ey))
    return out


def mover_clip(mover):
    if mover['flags'] & 1:
        return 'mine'
    if mover['vx'] != 0 or mover['vy'] != 0:
        return 'run'
    return 'idle'


def draw_mover(man, name, mover, cam):
    """mover: {x, y (1/256 tile), vx, vy, flags, orientation, distance (tiles, the renderer's integral along the
    path), seconds (since base_tick)}: the character's clips (10 §15.7)."""
    s = man['sets'][name]
    parts = s['parts']
    clip = mover_clip(mover)
    p = parts[clip]
    n = p['shape'][p['axes'].index('frame')]
    if clip == 'run':
        f = int(math.floor(mover['distance'] / p['cycleTiles'] * n)) % n
    else:
        f = int(math.floor(mover['seconds'] * p['fps'])) % n
    values = dict(orientation=mover['orientation'])
    ex, ey = mover['x'] / 256, mover['y'] / 256
    out = [draws_for(man, clip, lookup(p, values, f), cam, ex, ey)]
    out.append(draws_for(man, clip + '_shadow', lookup(parts[clip + '_shadow'], values, f), cam, ex, ey))
    return out


def draw_icon(man, name, at, cam, size_tiles=BELT_ITEM_SIZE):
    s = man['sets'].get(name) or man['sets']['fx/missing']
    fid = s['parts']['icon']['table'][0][0]
    q, uv = icon_quad(man, fid, cam, at[0], at[1], size_tiles)
    return [dict(part='icon', frames=[fid], quads=[[round(v, 4) for v in q]], uvs=[[round(v, 6) for v in uv]],
                 passes=['icon'])]


# --------------------------------------------------------------------------------------------------------------
# Semantic validation (beyond the JSON schema)
# --------------------------------------------------------------------------------------------------------------

REQUIRED = {
    'entity': ('base',),
    'inserter': ('platform', 'arm', 'hand_open', 'hand_closed', 'platform_shadow', 'arm_shadow',
                 'hand_open_shadow', 'hand_closed_shadow'),
    'resource': ('base',),
    'object': ('base',),
    'icon': ('icon',),
}


def all_parts(s):
    for name, p in s['parts'].items():
        if isinstance(p, list):
            for i, q in enumerate(p):
                yield f'{name}[{i}]', q
        else:
            yield name, p


def validate(man):
    """Errors as strings: tables complete, maps sized, ids valid, frames inside their pages, kinds complete."""
    errs = []
    nf = len(man['frames'])
    for i, f in enumerate(man['frames']):
        a, layer, x, y, w, h = f[:6]
        if not 0 <= a < len(man['arrays']):
            errs.append(f'frame {i}: array {a}')
            continue
        P = man['arrays'][a]['pageSize']
        if not 0 <= layer < len(man['pages'][a]):
            errs.append(f'frame {i}: layer {layer} of {len(man["pages"][a])}')
        if x < 0 or y < 0 or x + w > P or y + h > P or w <= 0 or h <= 0:
            errs.append(f'frame {i}: rectangle {x},{y} {w}x{h} outside a {P} page')
    for name, s in man['sets'].items():
        kind = s['kind']
        for req in REQUIRED.get(kind, ()):
            if req not in s['parts']:
                errs.append(f'{name}: {kind} set without part {req}')
        if kind == 'inserter':
            for k in ('shoulder', 'shadowShoulder'):
                if k not in s:
                    errs.append(f'{name}: inserter without {k}')
            for k in ('arm', 'hand_open', 'hand_closed'):
                if k in s['parts'] and 'pivot' not in s['parts'][k]:
                    errs.append(f'{name}: {k} without pivot')
            if 'arm' in s['parts'] and 'length' not in s['parts']['arm']:
                errs.append(f'{name}: arm without length')
        if kind == 'mover':
            for clip in ('idle', 'run', 'mine'):
                if clip in s['parts']:
                    p = s['parts'][clip]
                    if clip == 'run' and 'cycleTiles' not in p:
                        errs.append(f'{name}: run without cycleTiles')
                    if clip != 'run' and 'fps' not in p:
                        errs.append(f'{name}: {clip} without fps')
        for pname, p in all_parts(s):
            if len(p['axes']) != len(p['shape']):
                errs.append(f'{name}.{pname}: {len(p["axes"])} axes, {len(p["shape"])} sizes')
                continue
            total = 1
            for ax, n in zip(p['axes'], p['shape']):
                if ax not in AXES:
                    errs.append(f'{name}.{pname}: unknown axis {ax}')
                if n < 1:
                    errs.append(f'{name}.{pname}: axis {ax} of size {n}')
                total *= n
            if len(p['table']) != total:
                errs.append(f'{name}.{pname}: table of {len(p["table"])} entries for shape {p["shape"]}')
            for ax, m in (p.get('map') or {}).items():
                if ax not in p['axes']:
                    errs.append(f'{name}.{pname}: map for absent axis {ax}')
                    continue
                n = p['shape'][p['axes'].index(ax)]
                if ax in MAP_SIZES and len(m) != MAP_SIZES[ax]:
                    errs.append(f'{name}.{pname}: map.{ax} has {len(m)} entries, not {MAP_SIZES[ax]}')
                if any(not 0 <= v < n for v in m):
                    errs.append(f'{name}.{pname}: map.{ax} points outside 0..{n - 1}')
            for ax in p['axes']:
                if ax in ('dir', 'mask', 'stage', 'light') and ax not in (p.get('map') or {}):
                    errs.append(f'{name}.{pname}: axis {ax} needs a map')
            for e in p['table']:
                for fid in e:
                    if not 0 <= fid < nf:
                        errs.append(f'{name}.{pname}: frame id {fid} of {nf}')
    return errs
