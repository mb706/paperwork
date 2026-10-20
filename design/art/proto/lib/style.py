"""Style definitions shared by the Blender scripts and the numpy/SVG tools.

Pure Python: no bpy, no numpy. Every colour is an sRGB hex string; Blender code converts to linear.

A *style* is a complete look: the material table (semantic material key -> surface), the light rig,
the terrain palette, the item palette, the post-process grade and the UI skin. Entity scripts never
name colours; they name material keys (`steel_paint`, `paper_manila`, ...) and the style decides.

Three exploration styles live here (A3, 2026-10-20):
  kodachrome  period industrial realism, graded like 1940s Kodachrome
  survey      ink-and-wash technical illustration on survey paper
  model       clean museum / architect's site model (diorama)
and the recommended synthesis:
  charter     see design/art/DIRECTION.md
"""

import math

# --------------------------------------------------------------------------------------------
# Projection constants (10 §9.1). Ground (x east, y north, z up, metres = tiles) maps to sprite
# pixels as  col = ax + PX*x,  row = ay - PX*(y + z)  where (ax, ay) is the sprite's anchor.
# --------------------------------------------------------------------------------------------
PX_HIGH = 64          # px per tile, High sprites
PX_NORMAL = 32        # px per tile, Normal sprites
PITCH_DEG = 45.0
PIXEL_ASPECT_X = math.sqrt(2.0)


def norm(v):
    l = math.sqrt(sum(c * c for c in v))
    return tuple(c / l for c in v)


def hex_to_srgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(h):
    return tuple(srgb_to_linear(c) for c in hex_to_srgb(h))


# --------------------------------------------------------------------------------------------
# Light directions: vectors pointing FROM the scene TO the light, Blender axes (x E, y N, z up).
# The shading key comes from the west-south-west so the south faces we look at are lit; the
# shadow light comes from the west-north-west so cast shadows fall east-south-east (07 §23,
# 10 §6.7). Separating the two is common sprite-game practice; at 45° the mismatch is invisible.
# --------------------------------------------------------------------------------------------
KEY_DIR = norm((-0.62, -0.30, 0.73))
SHADOW_DIR = norm((-0.80, 0.22, 0.56))
RIM_DIR = norm((0.45, 0.85, 0.30))

# --------------------------------------------------------------------------------------------
# Material table entries: (base hex, roughness, metallic, extra)
# extra keys: emission (strength), transmission, grime (0..1), wear (0..1), noise (0..1 colour
# variation), clearcoat. Blender's materials.py interprets them per style.
# --------------------------------------------------------------------------------------------

KODACHROME_MATS = {
    # machine paints (1945: grey-green machinery enamel, cream office enamel, steel blue)
    'steel_paint':      ('#6c777d', 0.52, 0.0, dict(grime=0.6, wear=0.4, noise=0.30)),
    'steel_paint_alt':  ('#464e53', 0.55, 0.0, dict(grime=0.6, wear=0.35, noise=0.25)),
    'steel_bare':       ('#9a9fa4', 0.38, 1.0, dict(grime=0.40, noise=0.25)),
    'steel_dark':       ('#3b3e42', 0.50, 0.6, dict(grime=0.50, noise=0.25)),
    'cast_iron':        ('#2f3032', 0.78, 0.35, dict(grime=0.30, noise=0.35)),
    'brass':            ('#b8923f', 0.32, 1.0, dict(grime=0.45, noise=0.20)),
    'copper':           ('#b86a3e', 0.34, 1.0, dict(grime=0.40, noise=0.20)),
    'enamel_cream':     ('#e2d5b5', 0.32, 0.0, dict(grime=0.35, wear=0.15, noise=0.15)),
    'enamel_blue':      ('#4f6f8e', 0.36, 0.0, dict(grime=0.35, wear=0.20, noise=0.15)),
    'enamel_red':       ('#a83a2c', 0.40, 0.0, dict(grime=0.40, wear=0.25, noise=0.20)),
    'bakelite':         ('#2b1e16', 0.28, 0.0, dict(noise=0.1)),
    'rubber':           ('#34312e', 0.95, 0.0, dict(noise=0.25, grime=0.3)),
    'wood':             ('#8a5a30', 0.62, 0.0, dict(grain=1.0, noise=0.3, grime=0.25)),
    'wood_pole':        ('#5d4532', 0.85, 0.0, dict(grain=1.0, noise=0.4, grime=0.2)),
    'brick':            ('#8e4430', 0.90, 0.0, dict(brick=1.0, noise=0.4, grime=0.3)),
    'quartz_stone':     ('#ddd6ca', 0.70, 0.0, dict(blocks=1.0, noise=0.35, grime=0.55)),
    'concrete':         ('#9e9a90', 0.92, 0.0, dict(noise=0.45, grime=0.4)),
    'slate':            ('#4b5058', 0.70, 0.0, dict(noise=0.3)),
    'glass':            ('#eef6f4', 0.03, 0.0, dict(transmission=1.0)),
    'glass_dark':       ('#1d272d', 0.12, 0.0, dict(noise=0.05)),
    'belt_yellow':      ('#d6a12a', 0.50, 0.0, dict(grime=0.6, wear=0.4, noise=0.2)),
    'belt_red':         ('#b23a2c', 0.50, 0.0, dict(grime=0.6, wear=0.4, noise=0.2)),
    'belt_blue':        ('#3d6aa3', 0.50, 0.0, dict(grime=0.6, wear=0.4, noise=0.2)),
    'arm_yellow':       ('#d9a42a', 0.45, 0.0, dict(grime=0.45, wear=0.3, noise=0.2)),
    'arm_red':          ('#ad3a2d', 0.45, 0.0, dict(grime=0.45, wear=0.3, noise=0.2)),
    'arm_blue':         ('#3e6ea7', 0.45, 0.0, dict(grime=0.45, wear=0.3, noise=0.2)),
    'arm_dark':         ('#36383a', 0.55, 0.3, dict(grime=0.45, noise=0.2)),
    'fire':             ('#ff7a1c', 0.5, 0.0, dict(emission=9.0)),
    'fire_dim':         ('#d4421a', 0.5, 0.0, dict(emission=2.2)),
    'lamp':             ('#ffd28a', 0.5, 0.0, dict(emission=5.0)),
    'filament':         ('#ff9a3a', 0.5, 0.0, dict(emission=12.0)),
    'paper':            ('#f0ede4', 0.75, 0.0, dict(noise=0.08)),
    'paper_cream':      ('#ead9b0', 0.75, 0.0, dict(noise=0.10)),
    'paper_manila':     ('#d2b273', 0.80, 0.0, dict(noise=0.18, grime=0.2)),
    'ink':              ('#1e1c1a', 0.6, 0.0, {}),
    'red_band':         ('#b3302a', 0.6, 0.0, {}),
    'green_cover':      ('#3d7744', 0.6, 0.0, {}),
    'string':           ('#c2ad84', 0.9, 0.0, {}),
    'leaf':             ('#4e6c2c', 0.80, 0.0, dict(noise=0.55, leaf=1.0)),
    'leaf_dark':        ('#3a5424', 0.80, 0.0, dict(noise=0.55, leaf=1.0)),
    'conifer':          ('#2f4a2c', 0.80, 0.0, dict(noise=0.5, leaf=1.0)),
    'bark':             ('#4a3b2e', 0.90, 0.0, dict(noise=0.5)),
    'rock':             ('#8a8478', 0.85, 0.0, dict(noise=0.6, rocky=1.0)),
    'rock_quartz':      ('#e3ddd8', 0.55, 0.0, dict(noise=0.4, rocky=1.0)),
    'ore_iron':         ('#646c76', 0.62, 0.3, dict(noise=0.55, rocky=1.0)),
    'ore_copper':       ('#b06a42', 0.60, 0.3, dict(noise=0.6, rocky=1.0)),
    'coal':             ('#232325', 0.50, 0.0, dict(noise=0.4, rocky=1.0)),
    'quartz_item':      ('#ecdfe0', 0.30, 0.0, dict(noise=0.3)),
    'cloth_white':      ('#e6e2d6', 0.85, 0.0, dict(noise=0.1)),
    'cloth_dark':       ('#3b3b42', 0.85, 0.0, dict(noise=0.1)),
    'cloth_tie':        ('#7a2a2a', 0.7, 0.0, {}),
    'skin':             ('#d6a07c', 0.6, 0.0, {}),
    'hair':             ('#3a2a20', 0.7, 0.0, {}),
    'insulator':        ('#6fa58a', 0.15, 0.0, dict(noise=0.1)),
    'board_green':      ('#4f6a34', 0.55, 0.0, dict(noise=0.2)),
    'lawn':             ('#55743a', 0.9, 0.0, dict(noise=0.5)),
    'asphalt':          ('#4a4845', 0.9, 0.0, dict(noise=0.4)),
    'roof_tile':        ('#5b4a44', 0.8, 0.0, dict(noise=0.35)),
    'trim_white':       ('#e5e0d4', 0.6, 0.0, dict(noise=0.15, grime=0.3)),
    'water_steel':      ('#3f5560', 0.4, 0.5, dict(grime=0.5)),
    'archive_box':      ('#7a6a55', 0.85, 0.0, dict(noise=0.3, grime=0.3)),
    'iron_plate':       ('#8f9aa5', 0.42, 0.45, dict(noise=0.15)),
    'copper_plate':     ('#c27a4c', 0.38, 0.5, dict(noise=0.15)),
    'lamp_green':       ('#9dff7a', 0.5, 0.0, dict(emission=6.0)),
    'chalk':            ('#e8e6df', 0.9, 0.0, {}),
    'blackboard':       ('#26302b', 0.7, 0.0, dict(noise=0.2)),
    'felt_green':       ('#3f5a3c', 0.9, 0.0, dict(noise=0.2)),
}

# Clean painted-model look: brighter, more saturated, matte, no grime.
MODEL_MATS = {
    'steel_paint':      ('#78a595', 0.70, 0.0, {}),
    'steel_paint_alt':  ('#4f7c73', 0.70, 0.0, {}),
    'steel_bare':       ('#bcc1c6', 0.55, 0.2, {}),
    'steel_dark':       ('#5c6169', 0.65, 0.0, {}),
    'cast_iron':        ('#4a4d53', 0.75, 0.0, {}),
    'brass':            ('#ddb75a', 0.45, 0.3, {}),
    'copper':           ('#d98c5a', 0.45, 0.3, {}),
    'enamel_cream':     ('#e9dfc6', 0.60, 0.0, {}),
    'enamel_blue':      ('#5d90c2', 0.60, 0.0, {}),
    'enamel_red':       ('#d4553f', 0.60, 0.0, {}),
    'bakelite':         ('#4a3a32', 0.50, 0.0, {}),
    'rubber':           ('#4a4744', 0.90, 0.0, {}),
    'wood':             ('#c48c55', 0.70, 0.0, {}),
    'wood_pole':        ('#8e6c4c', 0.80, 0.0, {}),
    'brick':            ('#c9694c', 0.85, 0.0, {}),
    'quartz_stone':     ('#e8e2d6', 0.75, 0.0, {}),
    'concrete':         ('#cbc7be', 0.85, 0.0, {}),
    'slate':            ('#6a7584', 0.75, 0.0, {}),
    'glass':            ('#cfe6ef', 0.10, 0.0, dict(transmission=0.85)),
    'glass_dark':       ('#2e4554', 0.25, 0.0, {}),
    'belt_yellow':      ('#f2bb33', 0.65, 0.0, {}),
    'belt_red':         ('#e0533c', 0.65, 0.0, {}),
    'belt_blue':        ('#4f8de0', 0.65, 0.0, {}),
    'arm_yellow':       ('#f2bb33', 0.60, 0.0, {}),
    'arm_red':          ('#e0533c', 0.60, 0.0, {}),
    'arm_blue':         ('#4f8de0', 0.60, 0.0, {}),
    'arm_dark':         ('#55595f', 0.65, 0.0, {}),
    'fire':             ('#ff8a30', 0.5, 0.0, dict(emission=6.0)),
    'fire_dim':         ('#e0562a', 0.5, 0.0, dict(emission=2.0)),
    'lamp':             ('#ffe0a0', 0.5, 0.0, dict(emission=4.0)),
    'filament':         ('#ffa040', 0.5, 0.0, dict(emission=8.0)),
    'paper':            ('#efece4', 0.80, 0.0, {}),
    'paper_cream':      ('#f2e3bd', 0.80, 0.0, {}),
    'paper_manila':     ('#e2c27f', 0.80, 0.0, {}),
    'ink':              ('#2a2a2e', 0.6, 0.0, {}),
    'red_band':         ('#d6453a', 0.6, 0.0, {}),
    'green_cover':      ('#4f9a58', 0.6, 0.0, {}),
    'string':           ('#d6c29a', 0.9, 0.0, {}),
    'leaf':             ('#73a447', 0.85, 0.0, dict(noise=0.25, leaf=1.0)),
    'leaf_dark':        ('#5a8c3c', 0.85, 0.0, dict(noise=0.25, leaf=1.0)),
    'conifer':          ('#3f7448', 0.85, 0.0, dict(noise=0.2, leaf=1.0)),
    'bark':             ('#7a5a42', 0.90, 0.0, {}),
    'rock':             ('#b3ada2', 0.85, 0.0, dict(noise=0.15)),
    'rock_quartz':      ('#e6e0db', 0.65, 0.0, dict(noise=0.1)),
    'ore_iron':         ('#7d8da0', 0.70, 0.0, dict(noise=0.15)),
    'ore_copper':       ('#d4855a', 0.70, 0.0, dict(noise=0.15)),
    'coal':             ('#3a3a3f', 0.60, 0.0, {}),
    'quartz_item':      ('#f6eaec', 0.40, 0.0, {}),
    'cloth_white':      ('#ebe7de', 0.85, 0.0, {}),
    'cloth_dark':       ('#454a58', 0.85, 0.0, {}),
    'cloth_tie':        ('#b5403a', 0.7, 0.0, {}),
    'skin':             ('#e8b08a', 0.7, 0.0, {}),
    'hair':             ('#5a4030', 0.8, 0.0, {}),
    'insulator':        ('#8cc8b0', 0.3, 0.0, {}),
    'board_green':      ('#5f8a44', 0.6, 0.0, {}),
    'lawn':             ('#7fae54', 0.9, 0.0, dict(noise=0.15)),
    'asphalt':          ('#6c6c70', 0.9, 0.0, {}),
    'roof_tile':        ('#8a6a62', 0.8, 0.0, {}),
    'trim_white':       ('#ebe6dc', 0.7, 0.0, {}),
    'water_steel':      ('#5d7a88', 0.5, 0.0, {}),
    'archive_box':      ('#a88f6e', 0.85, 0.0, {}),
    'iron_plate':       ('#a9b6c4', 0.5, 0.2, {}),
    'copper_plate':     ('#df8f5f', 0.5, 0.2, {}),
    'lamp_green':       ('#a8ff8a', 0.5, 0.0, dict(emission=5.0)),
    'chalk':            ('#ecebe6', 0.9, 0.0, {}),
    'blackboard':       ('#36463f', 0.8, 0.0, {}),
    'felt_green':       ('#5a8a56', 0.9, 0.0, {}),
}

# Ink-and-wash plate: flat washes, three tone bands, ink lines and hatching added in post.
SURVEY_MATS = {
    'steel_paint':      ('#9fb2b3', 0, 0, {}),
    'steel_paint_alt':  ('#7f9598', 0, 0, {}),
    'steel_bare':       ('#b0b8bd', 0, 0, {}),
    'steel_dark':       ('#727a80', 0, 0, {}),
    'cast_iron':        ('#5d6166', 0, 0, {}),
    'brass':            ('#d6ad55', 0, 0, {}),
    'copper':           ('#c27648', 0, 0, {}),
    'enamel_cream':     ('#f3ead2', 0, 0, {}),
    'enamel_blue':      ('#7d9fc0', 0, 0, {}),
    'enamel_red':       ('#c9533d', 0, 0, {}),
    'bakelite':         ('#4d4038', 0, 0, {}),
    'rubber':           ('#6e6a64', 0, 0, {}),       # belt deck L* 45: coal (31) and paper (84+) both separate
    'wood':             ('#c49563', 0, 0, {}),
    'wood_pole':        ('#9b7b5a', 0, 0, {}),
    'brick':            ('#c97557', 0, 0, {}),
    'quartz_stone':     ('#f6f1e7', 0, 0, {}),
    'concrete':         ('#cdc8bb', 0, 0, {}),
    'slate':            ('#7d8790', 0, 0, {}),
    'glass':            ('#cfe2e6', 0, 0, {}),
    'glass_dark':       ('#56707e', 0, 0, {}),
    'belt_yellow':      ('#e8b748', 0, 0, {}),
    'belt_red':         ('#cf5640', 0, 0, {}),
    'belt_blue':        ('#5a8ac0', 0, 0, {}),
    'arm_yellow':       ('#e8b748', 0, 0, {}),
    'arm_red':          ('#cf5640', 0, 0, {}),
    'arm_blue':         ('#5a8ac0', 0, 0, {}),
    'arm_dark':         ('#6a6d70', 0, 0, {}),
    'fire':             ('#f6a24a', 0, 0, dict(flat=True)),
    'fire_dim':         ('#d9603a', 0, 0, dict(flat=True)),
    'lamp':             ('#f6d58e', 0, 0, dict(flat=True)),
    'filament':         ('#f39a45', 0, 0, dict(flat=True)),
    'paper':            ('#fcfaf3', 0, 0, {}),
    'paper_cream':      ('#f2e2bb', 0, 0, {}),
    'paper_manila':     ('#e8cf98', 0, 0, {}),
    'ink':              ('#2b2723', 0, 0, dict(flat=True)),
    'red_band':         ('#c9432f', 0, 0, {}),
    'green_cover':      ('#5b9161', 0, 0, {}),
    'string':           ('#cdb88f', 0, 0, {}),
    'leaf':             ('#9cb878', 0, 0, {}),
    'leaf_dark':        ('#86a668', 0, 0, {}),
    'conifer':          ('#6f9670', 0, 0, {}),
    'bark':             ('#8a7158', 0, 0, {}),
    'rock':             ('#c8c0b0', 0, 0, {}),
    'rock_quartz':      ('#f4efe9', 0, 0, {}),
    'ore_iron':         ('#8496a8', 0, 0, {}),
    'ore_copper':       ('#d58c62', 0, 0, {}),
    'coal':             ('#4a4a4c', 0, 0, {}),
    'quartz_item':      ('#f6e9ea', 0, 0, {}),
    'cloth_white':      ('#f7f3ea', 0, 0, {}),
    'cloth_dark':       ('#5c606c', 0, 0, {}),
    'cloth_tie':        ('#b94a3c', 0, 0, {}),
    'skin':             ('#e7b593', 0, 0, {}),
    'hair':             ('#6b5241', 0, 0, {}),
    'insulator':        ('#9fcfb8', 0, 0, {}),
    'board_green':      ('#7f9f5f', 0, 0, {}),
    'lawn':             ('#a9c389', 0, 0, {}),
    'asphalt':          ('#8f8c86', 0, 0, {}),
    'roof_tile':        ('#9a817a', 0, 0, {}),
    'trim_white':       ('#f8f4ea', 0, 0, {}),
    'water_steel':      ('#7f97a2', 0, 0, {}),
    'archive_box':      ('#b9a07c', 0, 0, {}),
    'iron_plate':       ('#9fb0c0', 0, 0, {}),
    'copper_plate':     ('#c47a4b', 0, 0, {}),
    'lamp_green':       ('#a8e08a', 0, 0, dict(flat=True)),
    'chalk':            ('#f4f1ea', 0, 0, {}),
    'blackboard':       ('#56625c', 0, 0, {}),
    'felt_green':       ('#87a77f', 0, 0, {}),
}


STYLES = {
    'kodachrome': dict(
        title='Kodachrome',
        subtitle='Period industrial realism, graded like 1940s colour film',
        mats=KODACHROME_MATS,
        render='pbr',
        samples=48,
        key=dict(dir=KEY_DIR, strength=4.6, color='#fff0d8', angle=1.2),
        rim=dict(dir=RIM_DIR, strength=1.6, color='#cfdcff', angle=4.0),
        sky=dict(color='#8fa6c6', strength=0.85),
        ground_bounce='#7d7462',
        shadow=dict(dir=SHADOW_DIR, angle=2.5, sky=0.35),
        shadow_opacity=0.58,
        shadow_tint='#1d2840',
        bevel=0.018,
        weathering=0.55,
        grade='kodachrome',
    ),
    'model': dict(
        title='Site model',
        subtitle="A museum or architect's model of the Site: matte paint, soft studio light",
        mats=MODEL_MATS,
        render='pbr',
        samples=48,
        key=dict(dir=KEY_DIR, strength=3.1, color='#fff6ea', angle=9.0),
        rim=None,
        sky=dict(color='#c9d6ea', strength=0.62),
        ground_bounce='#9db07a',
        shadow=dict(dir=SHADOW_DIR, angle=14.0, sky=0.6),
        shadow_opacity=0.42,
        shadow_tint='#2a3550',
        bevel=0.035,
        bevel_scale=1.6,
        grade='model',
    ),
    'survey': dict(
        title='Survey plate',
        subtitle='Ink and wash on survey paper: the land shown in the attached survey',
        mats=SURVEY_MATS,
        render='flat',
        samples=16,
        key=dict(dir=KEY_DIR),
        bands=(0.60, 0.16),          # N·L thresholds: light >= 0.60 > mid >= 0.16 > dark (hatched)
        band_values=(1.0, 0.86, 0.70),
        rim=None,
        sky=None,
        shadow=dict(dir=SHADOW_DIR, angle=1.0, sky=0.0),
        shadow_opacity=0.0,           # shadows are hatched, not darkened
        shadow_tint='#2b2723',
        bevel=0.01,
        bevel_scale=0.6,
        grade='survey',
        ink='#2b2723',
        paper='#ece3cb',
        day_glow=0.6,
    ),
}


def style(name):
    return STYLES[name]


def mat_entry(style_name, key):
    mats = STYLES[style_name]['mats']
    if key not in mats:
        raise KeyError(f'material key {key!r} missing from style {style_name!r}')
    return mats[key]
