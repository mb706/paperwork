"""Blender materials built from the style tables in style.py (ported from A3's prototype; 10 §9.1).

Usage (inside Blender):
    from lib import materials as M
    M.set_style('kodachrome')
    obj.data.materials.append(M.get('steel_paint'))

Every material is built from one semantic key. Three render modes:
  pbr   Principled BSDF with procedural variation: value noise, AO-driven grime in crevices,
        bevel-node edge wear, wood grain, brick and block courses. Each material has an optional
        image slot (box-projected) so that image-model textures can replace the procedural base
        colour later without touching entity scripts: M.set_texture('wood', '/path/oak.png').
  flat  The survey plate: an emission wash in three tone bands from N·L against the key light,
        plus auxiliary outputs (world normal; material/object id + depth) that the post step uses
        for ink lines and hatching. Switch outputs with M.set_output('beauty'|'normal'|'aux').
"""

import math
import hashlib
import bpy

from . import style as S

_STYLE = None
_CACHE = {}
_TEXTURES = {}       # key -> image path (optional base-colour textures)
_FLAT_NODES = {}     # material name -> dict(out=..., beauty=..., normal=..., aux=..., light=...)
ORGANIC = {'leaf', 'leaf_dark', 'conifer', 'lawn'}
EMITTERS = {'fire', 'fire_dim', 'lamp', 'lamp_green', 'filament'}


def set_style(name):
    global _STYLE
    _STYLE = name
    _CACHE.clear()
    _FLAT_NODES.clear()


def style_name():
    return _STYLE


def set_texture(key, path):
    """Register an image to replace the procedural base colour of a material key."""
    _TEXTURES[key] = path


def _lin(hexstr, a=1.0):
    r, g, b = S.hex_to_linear(hexstr)
    return (r, g, b, a)


def _id_color(name):
    h = hashlib.md5(name.encode()).digest()
    return (h[0] / 255.0, h[1] / 255.0, h[2] / 255.0)


def get(key):
    if _STYLE is None:
        raise RuntimeError('materials.set_style() first')
    if key in _CACHE:
        return _CACHE[key]
    entry = S.mat_entry(_STYLE, key)
    mode = S.STYLES[_STYLE]['render']
    if mode == 'pbr':
        m = _build_pbr(key, entry)
    else:
        m = _build_flat(key, entry)
    _CACHE[key] = m
    return m


# --------------------------------------------------------------------------------------------
# PBR
# --------------------------------------------------------------------------------------------

def _node(nt, kind, loc=(0, 0), **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def _math(nt, op, a, b=None, loc=(0, 0), clamp=False):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = clamp
    n.location = loc
    if isinstance(a, (int, float)):
        n.inputs[0].default_value = a
    else:
        nt.links.new(a, n.inputs[0])
    if b is not None:
        if isinstance(b, (int, float)):
            n.inputs[1].default_value = b
        else:
            nt.links.new(b, n.inputs[1])
    return n.outputs[0]


def _mix_rgb(nt, blend, fac, a, b, loc=(0, 0)):
    n = nt.nodes.new('ShaderNodeMix')
    n.data_type = 'RGBA'
    n.blend_type = blend
    n.location = loc
    if isinstance(fac, (int, float)):
        n.inputs['Factor'].default_value = fac
    else:
        nt.links.new(fac, n.inputs['Factor'])
    for sock, val in ((n.inputs[6], a), (n.inputs[7], b)):
        if isinstance(val, tuple):
            sock.default_value = val
        else:
            nt.links.new(val, sock)
    return n.outputs[2]


def _box_uv(nt, obj_co):
    """2D coordinates for 2D procedural textures: walls get (x + y, z), roofs and tops (x, y)."""
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(obj_co, sep.inputs[0])
    u = _math(nt, 'ADD', sep.outputs[0], sep.outputs[1])
    wall = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(u, wall.inputs[0])
    nt.links.new(sep.outputs[2], wall.inputs[1])
    top = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(sep.outputs[0], top.inputs[0])
    nt.links.new(sep.outputs[1], top.inputs[1])
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sn = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Normal'], sn.inputs[0])
    nz = _math(nt, 'ABSOLUTE', sn.outputs[2])
    is_top = _math(nt, 'GREATER_THAN', nz, 0.7)
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'VECTOR'
    nt.links.new(is_top, mix.inputs[0])
    nt.links.new(wall.outputs[0], mix.inputs[4])
    nt.links.new(top.outputs[0], mix.inputs[5])
    return mix.outputs[1]


def _build_pbr(key, entry):
    hexc, rough, metal, extra = entry
    st = S.STYLES[_STYLE]
    m = bpy.data.materials.new(f'{_STYLE}:{key}')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = _node(nt, 'ShaderNodeOutputMaterial', (900, 0))
    bsdf = _node(nt, 'ShaderNodeBsdfPrincipled', (600, 0))
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal

    base = _lin(hexc)
    coord = _node(nt, 'ShaderNodeTexCoord', (-1400, 0))
    obj_co = coord.outputs['Object']

    # Base colour: image (box-projected) if registered, else the flat style colour.
    if key in _TEXTURES:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.location = (-900, 300)
        tex.image = bpy.data.images.load(_TEXTURES[key], check_existing=True)
        tex.projection = 'BOX'
        tex.projection_blend = 0.25
        mapping = _node(nt, 'ShaderNodeMapping', (-1150, 300))
        mapping.inputs['Scale'].default_value = (1.0, 1.0, 1.0)
        nt.links.new(obj_co, mapping.inputs['Vector'])
        nt.links.new(mapping.outputs[0], tex.inputs['Vector'])
        col = _mix_rgb(nt, 'MULTIPLY', 1.0, tex.outputs['Color'], base, (-600, 300))
    else:
        col = None

    noise_amt = extra.get('noise', 0.0)
    if col is None:
        # Patchy value variation: two noise scales.
        n1 = _node(nt, 'ShaderNodeTexNoise', (-1100, 200))
        n1.inputs['Scale'].default_value = 3.5
        n1.inputs['Detail'].default_value = 6.0
        n1.inputs['Roughness'].default_value = 0.6
        nt.links.new(obj_co, n1.inputs['Vector'])
        # map noise 0..1 -> 1 - amt/2 .. 1 + amt/2 brightness multiplier
        v = _math(nt, 'SUBTRACT', n1.outputs['Fac'], 0.5, (-900, 200))
        v = _math(nt, 'MULTIPLY', v, noise_amt * 0.9, (-750, 200))
        v = _math(nt, 'ADD', v, 1.0, (-600, 200))
        bright = nt.nodes.new('ShaderNodeCombineColor')
        bright.location = (-450, 200)
        for i in range(3):
            nt.links.new(v, bright.inputs[i])
        col = _mix_rgb(nt, 'MULTIPLY', 1.0, base, bright.outputs[0], (-300, 200))

        if extra.get('grain'):
            # Wood grain: stretched wave texture along local Z/X.
            wave = _node(nt, 'ShaderNodeTexWave', (-1100, -100))
            wave.wave_type = 'BANDS'
            wave.bands_direction = 'Z'
            wave.inputs['Scale'].default_value = 7.0
            wave.inputs['Distortion'].default_value = 6.0
            wave.inputs['Detail'].default_value = 3.0
            nt.links.new(obj_co, wave.inputs['Vector'])
            g = _math(nt, 'MULTIPLY', wave.outputs['Fac'], 0.22, (-900, -100))
            g = _math(nt, 'SUBTRACT', 1.0, g, (-750, -100))
            gc = nt.nodes.new('ShaderNodeCombineColor')
            gc.location = (-600, -100)
            for i in range(3):
                nt.links.new(g, gc.inputs[i])
            col = _mix_rgb(nt, 'MULTIPLY', 1.0, col, gc.outputs[0], (-150, 100))
        if extra.get('brick') or extra.get('blocks'):
            br = _node(nt, 'ShaderNodeTexBrick', (-1100, -350))
            if extra.get('brick'):
                br.inputs['Scale'].default_value = 1.0
                br.inputs['Brick Width'].default_value = 0.21
                br.inputs['Row Height'].default_value = 0.07
                br.inputs['Mortar Size'].default_value = 0.012
                br.inputs['Mortar'].default_value = _lin('#b3a690')
            else:
                br.inputs['Scale'].default_value = 1.0
                br.inputs['Brick Width'].default_value = 0.42
                br.inputs['Row Height'].default_value = 0.21
                br.inputs['Mortar Size'].default_value = 0.014
                br.inputs['Mortar'].default_value = _lin('#8d877c')
            br.inputs['Color1'].default_value = (1, 1, 1, 1)
            br.inputs['Color2'].default_value = (0.86, 0.86, 0.86, 1)
            # box projection: courses run horizontally on walls -> (x + y, z); plan (x, y) on tops
            nt.links.new(_box_uv(nt, obj_co), br.inputs['Vector'])
            col = _mix_rgb(nt, 'MULTIPLY', 1.0, col, br.outputs['Color'], (-50, -100))

    # Grime: darken crevices (AO) and add dirt patches.
    grime = extra.get('grime', 0.0)
    if grime > 0:
        ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
        ao.location = (-600, -300)
        ao.samples = 4
        ao.inputs['Distance'].default_value = 0.35
        occl = _math(nt, 'SUBTRACT', 1.0, ao.outputs['AO'], (-450, -300))
        dn = _node(nt, 'ShaderNodeTexNoise', (-900, -500))
        dn.inputs['Scale'].default_value = 1.8
        dn.inputs['Detail'].default_value = 8.0
        nt.links.new(obj_co, dn.inputs['Vector'])
        patch = _math(nt, 'MULTIPLY', dn.outputs['Fac'], 0.55, (-600, -500))
        fac = _math(nt, 'ADD', occl, patch, (-300, -400))
        fac = _math(nt, 'MULTIPLY', fac, grime * 0.75, (-150, -400), clamp=True)
        col = _mix_rgb(nt, 'MULTIPLY', fac, col, _lin('#4a4034'), (100, -200))

    # Edge wear: lighten/bare metal on convex edges (bevel normal vs true normal).
    wear = extra.get('wear', 0.0)
    if wear > 0:
        bev = nt.nodes.new('ShaderNodeBevel')
        bev.location = (-600, -700)
        bev.samples = 4
        bev.inputs['Radius'].default_value = 0.025
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        geo.location = (-600, -850)
        dot = nt.nodes.new('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        dot.location = (-400, -750)
        nt.links.new(bev.outputs[0], dot.inputs[0])
        nt.links.new(geo.outputs['Normal'], dot.inputs[1])
        e = _math(nt, 'SUBTRACT', 1.0, dot.outputs['Value'], (-250, -750))
        e = _math(nt, 'MULTIPLY', e, 14.0 * wear, (-100, -750), clamp=True)
        col = _mix_rgb(nt, 'MIX', e, col, _lin('#8e8a82'), (250, -300))

    # realism weathering (style flag): dirt rising from the ground, vertical run-off streaks on paint
    if st.get('weathering') and not extra.get('emission') and not extra.get('transmission'):
        geo_w = nt.nodes.new('ShaderNodeNewGeometry')
        sepw = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(geo_w.outputs['Position'], sepw.inputs[0])
        # ground grime: 1 at z = 0, 0 above 0.35 m, broken up by noise
        gz = _math(nt, 'MULTIPLY', sepw.outputs[2], -1 / 0.35)
        gz = _math(nt, 'ADD', gz, 1.0, clamp=True)
        gn = _node(nt, 'ShaderNodeTexNoise')
        gn.inputs['Scale'].default_value = 6.0
        nt.links.new(geo_w.outputs['Position'], gn.inputs['Vector'])
        gz = _math(nt, 'MULTIPLY', gz, gn.outputs['Fac'])
        gz = _math(nt, 'MULTIPLY', gz, st['weathering'] * 1.2, clamp=True)
        col = _mix_rgb(nt, 'MIX', gz, col, _lin('#4b3f30'))
        if key.startswith('steel_paint') or key in ('enamel_blue', 'enamel_cream', 'enamel_red', 'belt_yellow',
                                                   'arm_yellow', 'cast_iron', 'steel_dark', 'water_steel'):
            mp = nt.nodes.new('ShaderNodeMapping')
            mp.inputs['Scale'].default_value = (14.0, 14.0, 1.2)
            nt.links.new(geo_w.outputs['Position'], mp.inputs['Vector'])
            sn = _node(nt, 'ShaderNodeTexNoise')
            sn.inputs['Scale'].default_value = 1.0
            sn.inputs['Detail'].default_value = 4.0
            nt.links.new(mp.outputs[0], sn.inputs['Vector'])
            st_ = _math(nt, 'SUBTRACT', sn.outputs['Fac'], 0.58)
            st_ = _math(nt, 'MULTIPLY', st_, 3.0 * st['weathering'], clamp=True)
            col = _mix_rgb(nt, 'MIX', st_, col, _lin('#6a4a32'))
    nt.links.new(col, bsdf.inputs['Base Color'])

    if extra.get('transmission'):
        bsdf.inputs['Transmission Weight'].default_value = extra['transmission']
        bsdf.inputs['IOR'].default_value = 1.45
    if extra.get('emission'):
        bsdf.inputs['Emission Color'].default_value = base
        bsdf.inputs['Emission Strength'].default_value = extra['emission']
    if extra.get('leaf') or extra.get('rocky'):
        # foliage / rock tooth: a fine voronoi bump so canopies read as leaves, not plastic
        vor = nt.nodes.new('ShaderNodeTexVoronoi')
        vor.location = (100, -600)
        vor.inputs['Scale'].default_value = 26.0 if extra.get('leaf') else 9.0
        nt.links.new(obj_co, vor.inputs['Vector'])
        bump = nt.nodes.new('ShaderNodeBump')
        bump.location = (350, -600)
        bump.inputs['Strength'].default_value = 0.55 if extra.get('leaf') else 0.35
        nt.links.new(vor.outputs['Distance'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        if extra.get('leaf'):
            # darker gaps between leaf clusters
            g = _math(nt, 'MULTIPLY', vor.outputs['Distance'], 1.6, (100, -800), clamp=True)
            gc = nt.nodes.new('ShaderNodeCombineColor')
            for i in range(3):
                nt.links.new(g, gc.inputs[i])
            mixn = nt.nodes.new('ShaderNodeMix')
            mixn.data_type = 'RGBA'
            mixn.blend_type = 'MULTIPLY'
            mixn.inputs['Factor'].default_value = 0.6
            nt.links.new(bsdf.inputs['Base Color'].links[0].from_socket, mixn.inputs[6])
            nt.links.new(gc.outputs[0], mixn.inputs[7])
            nt.links.new(mixn.outputs[2], bsdf.inputs['Base Color'])
    return m


# --------------------------------------------------------------------------------------------
# Flat (survey plate)
# --------------------------------------------------------------------------------------------

def _build_flat(key, entry):
    hexc, _r, _m, extra = entry
    st = S.STYLES[_STYLE]
    m = bpy.data.materials.new(f'{_STYLE}:{key}')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = _node(nt, 'ShaderNodeOutputMaterial', (1000, 0))
    base = _lin(hexc)

    geo = nt.nodes.new('ShaderNodeNewGeometry')
    geo.location = (-800, 0)

    # --- beauty: banded wash ---
    if extra.get('flat'):
        beauty_col = base
        em = _node(nt, 'ShaderNodeEmission', (600, 200))
        em.inputs['Color'].default_value = base
        em.inputs['Strength'].default_value = 1.0
    else:
        dot = nt.nodes.new('ShaderNodeVectorMath')
        dot.operation = 'DOT_PRODUCT'
        dot.location = (-600, 0)
        nt.links.new(geo.outputs['Normal'], dot.inputs[0])
        dot.inputs[1].default_value = st['key']['dir']
        b0, b1 = st['bands']
        v0, v1, v2 = st['band_values']
        # value = v2 + (v1-v2)*[d>=b1] + (v0-v1)*[d>=b0]
        g1 = _math(nt, 'GREATER_THAN', dot.outputs['Value'], b1, (-400, 100))
        g0 = _math(nt, 'GREATER_THAN', dot.outputs['Value'], b0, (-400, -100))
        t1 = _math(nt, 'MULTIPLY', g1, v1 - v2, (-250, 100))
        t0 = _math(nt, 'MULTIPLY', g0, v0 - v1, (-250, -100))
        val = _math(nt, 'ADD', t1, t0, (-100, 0))
        val = _math(nt, 'ADD', val, v2, (50, 0))
        cc = nt.nodes.new('ShaderNodeCombineColor')
        cc.location = (200, 0)
        for i in range(3):
            nt.links.new(val, cc.inputs[i])
        col = _mix_rgb(nt, 'MULTIPLY', 1.0, base, cc.outputs[0], (400, 0))
        em = _node(nt, 'ShaderNodeEmission', (600, 200))
        nt.links.new(col, em.inputs['Color'])
        em.inputs['Strength'].default_value = 1.0

    # --- normal: world normal encoded (n+1)/2; flat materials (ink, fire) write black as a flag ---
    em_n = nt.nodes.new('ShaderNodeEmission')
    em_n.location = (600, -400)
    if extra.get('flat'):
        em_n.inputs['Color'].default_value = (0.0, 0.0, 0.0, 1.0)
    else:
        nrm = nt.nodes.new('ShaderNodeVectorMath')
        nrm.operation = 'MULTIPLY_ADD'
        nrm.location = (-300, -400)
        nt.links.new(geo.outputs['Normal'], nrm.inputs[0])
        nrm.inputs[1].default_value = (0.5, 0.5, 0.5)
        nrm.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(nrm.outputs[0], em_n.inputs['Color'])

    # --- aux: R, G = two bytes of the material id; B = object random scaled to 0..0.5, or 1.0 for
    #     organic materials (foliage), whose blobs must not be inked against each other ---
    oi = nt.nodes.new('ShaderNodeObjectInfo')
    oi.location = (-300, -700)
    idc = _id_color(key)
    comb = nt.nodes.new('ShaderNodeCombineColor')
    comb.location = (200, -700)
    comb.inputs[0].default_value = S.srgb_to_linear(idc[0])
    comb.inputs[1].default_value = S.srgb_to_linear(idc[1])
    if key in ORGANIC:
        comb.inputs[2].default_value = 1.0
    else:
        half = _math(nt, 'MULTIPLY', oi.outputs['Random'], 0.2)
        nt.links.new(half, comb.inputs[2])
    em_a = nt.nodes.new('ShaderNodeEmission')
    em_a.location = (600, -700)
    nt.links.new(comb.outputs[0], em_a.inputs['Color'])

    # --- pos: the shading point in a reference object's frame, p / 4 + 1/2 (set_output('pos', ref=...) sets it) ---
    tc = nt.nodes.new('ShaderNodeTexCoord')
    tc.location = (-300, -1300)
    mad = nt.nodes.new('ShaderNodeVectorMath')
    mad.operation = 'MULTIPLY_ADD'
    nt.links.new(tc.outputs['Object'], mad.inputs[0])
    mad.inputs[1].default_value = (0.25, 0.25, 0.25)
    mad.inputs[2].default_value = (0.5, 0.5, 0.5)
    em_p = nt.nodes.new('ShaderNodeEmission')
    em_p.location = (600, -1300)
    nt.links.new(mad.outputs[0], em_p.inputs['Color'])
    # --- light: emitters (fire, lamps) in their colour, everything else opaque black (occludes) ---
    em_l = nt.nodes.new('ShaderNodeEmission')
    em_l.location = (600, -1000)
    em_l.inputs['Color'].default_value = base if key in EMITTERS else (0.0, 0.0, 0.0, 1.0)
    if key == 'glass':
        # glass is a faint wash you see through; invisible to the line passes so the interior is inked
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mix = nt.nodes.new('ShaderNodeMixShader')
        mix.inputs['Fac'].default_value = 0.22
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        tr2 = nt.nodes.new('ShaderNodeBsdfTransparent')
        tr3 = nt.nodes.new('ShaderNodeBsdfTransparent')
        tr4 = nt.nodes.new('ShaderNodeBsdfTransparent')
        tr5 = nt.nodes.new('ShaderNodeBsdfTransparent')
        em, em_n, em_a, em_l, em_p = mix, tr2, tr3, tr4, tr5
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    _FLAT_NODES[m.name] = dict(out=out, beauty=em, normal=em_n, aux=em_a, light=em_l, pos=em_p, pos_tc=tc)
    return m


def set_output(which, ref=None):
    """Flat style only: route every material's output to 'beauty', 'normal', 'aux', 'light' or 'pos' (the
    position in `ref`'s frame)."""
    for name, d in _FLAT_NODES.items():
        mat = bpy.data.materials.get(name)
        if mat is None:
            continue
        nt = mat.node_tree
        for link in list(d['out'].inputs['Surface'].links):
            nt.links.remove(link)
        if which == 'pos':
            d['pos_tc'].object = ref
        nt.links.new(d[which].outputs[0], d['out'].inputs['Surface'])
