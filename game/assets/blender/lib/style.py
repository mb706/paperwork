"""Style tables for the sprite pipeline (10 §9.1; design/art/DIRECTION.md, cited as A3 §n).

Pure Python: no bpy, no numpy, so the Blender scripts, the numpy post steps and the build's planner all
import it. Every colour is an sRGB hex string; Blender code converts to linear.

A *style* is a complete look: the material table (semantic key -> surface), the light rig, the ink and
hatch parameters and the paper. Model scripts never name colours; they name material keys
(`steel_paint`, `paper_manila`, ...) and the style decides. *Survey* ships (IMPL-5). The realism variant
(*Kodachrome*, A3's direction A) stays a one-table switch: its table and the PBR material builder are kept,
but the build's post steps (ink, hatching) are Survey's.
"""

import math

PIPELINE_STYLE = 'survey'

# --------------------------------------------------------------------------------------------------------
# Projection (10 §9.1, §15.7). Ground metres (x east, y north, z up; 1 tile = 1 m) map to sprite pixels as
#     col = ax + PX * x,    row = ay - PX * (y + z)
# where (ax, ay) is the anchor: the footprint centre on the ground. The camera is orthographic, pitched
# 45 degrees, from the south, rendered with pixel_aspect_x = sqrt(2) so that ground tiles are square and
# heights read 1:1 (A3 §2; the calibration test checks it).
# --------------------------------------------------------------------------------------------------------
PX_HIGH = 64          # px per tile at level 0 (High)
PX_NORMAL = 32        # level 1 (Normal); shadows are rendered and stored here
PX_LIGHT = 16         # the glow sprites (light array)
PITCH_DEG = 45.0
PIXEL_ASPECT_X = math.sqrt(2.0)


def norm(v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v)


def hex_to_srgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(h):
    return tuple(srgb_to_linear(c) for c in hex_to_srgb(h))


# --------------------------------------------------------------------------------------------------------
# Light directions: vectors pointing FROM the scene TO the light (x E, y N, z up). The shading key comes from
# the west-south-west so the south faces we look at are lit; the shadow light from the west-north-west so
# cast shadows fall east-south-east as in Factorio (A3 §4, decision 2; 10 §9.1).
# --------------------------------------------------------------------------------------------------------
KEY_DIR = norm((-0.62, -0.30, 0.73))
SHADOW_DIR = norm((-0.80, 0.22, 0.56))
# Ground offset of a point's shadow per metre of height, in tiles (east +, north +): 1.43 east, 0.39 south.
SHADOW_REACH = (-SHADOW_DIR[0] / SHADOW_DIR[2], -SHADOW_DIR[1] / SHADOW_DIR[2])

# --------------------------------------------------------------------------------------------------------
# Material tables: key -> (base hex, roughness, metallic, extra). Survey ignores roughness and metallic.
# extra: flat=True for emitters and ink (unbanded); the PBR table's keys drive A3's realism builder.
# --------------------------------------------------------------------------------------------------------
SURVEY_MATS = {
    'steel_paint':      ('#9fb2b3', 0, 0, {}),
    'steel_paint_alt':  ('#7f9598', 0, 0, {}),
    'steel_bare':       ('#b0b8bd', 0, 0, {}),
    'steel_dark':       ('#727a80', 0, 0, {}),
    'cast_iron':        ('#5d6166', 0, 0, {}),
    'iron_chest':       ('#80878b', 0, 0, {}),
    'brass':            ('#d6ad55', 0, 0, {}),
    'copper':           ('#c27648', 0, 0, {}),
    'enamel_cream':     ('#f3ead2', 0, 0, {}),
    'enamel_blue':      ('#7d9fc0', 0, 0, {}),
    'enamel_red':       ('#c9533d', 0, 0, {}),
    'enamel_green':     ('#8aab7c', 0, 0, {}),
    'bakelite':         ('#4d4038', 0, 0, {}),
    'rubber':           ('#6e6a64', 0, 0, {}),       # belt deck L* 45: coal (31) and paper (84+) both separate
    'leather':          ('#7a5a44', 0, 0, {}),
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
    'arm_dark':         ('#76797c', 0, 0, {}),
    'plate_steel':      ('#949ca1', 0, 0, {}),        # inserter base plates: machines stay <= 60 % darker
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
    'report_card':      ('#d6e8c8', 0, 0, {}),        # pale green card stock, L* 90
    'string':           ('#cdb88f', 0, 0, {}),
    'leaf':             ('#9cb878', 0, 0, {}),
    'leaf_dark':        ('#86a668', 0, 0, {}),
    'conifer':          ('#6f9670', 0, 0, {}),
    'bark':             ('#8a7158', 0, 0, {}),
    'rock':             ('#c8c0b0', 0, 0, {}),
    'rock_quartz':      ('#f4efe9', 0, 0, {}),
    'ore_iron':         ('#8496a8', 0, 0, {}),
    'ore_iron_dark':    ('#6c7f93', 0, 0, {}),
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
    # calibration targets (test/assets/projection.py): flat, unbanded, so edges are exact
    'calib_top':        ('#d9534f', 0, 0, dict(flat=True)),
    'calib_south':      ('#5bc0de', 0, 0, dict(flat=True)),
    'calib_side':       ('#5cb85c', 0, 0, dict(flat=True)),
}

# A3's realism direction ("Kodachrome"), kept as the one-table switch of IMPL-5 (PBR, grime, wear).
KODACHROME_MATS = {
    'steel_paint':      ('#6c777d', 0.52, 0.0, dict(grime=0.6, wear=0.4, noise=0.30)),
    'steel_paint_alt':  ('#464e53', 0.55, 0.0, dict(grime=0.6, wear=0.35, noise=0.25)),
    'steel_bare':       ('#9a9fa4', 0.38, 1.0, dict(grime=0.40, noise=0.25)),
    'steel_dark':       ('#3b3e42', 0.50, 0.6, dict(grime=0.50, noise=0.25)),
    'cast_iron':        ('#2f3032', 0.78, 0.35, dict(grime=0.30, noise=0.35)),
    'iron_chest':       ('#45494d', 0.55, 0.5, dict(grime=0.45, wear=0.3, noise=0.3)),
    'brass':            ('#b8923f', 0.32, 1.0, dict(grime=0.45, noise=0.20)),
    'copper':           ('#b86a3e', 0.34, 1.0, dict(grime=0.40, noise=0.20)),
    'enamel_cream':     ('#e2d5b5', 0.32, 0.0, dict(grime=0.35, wear=0.15, noise=0.15)),
    'enamel_blue':      ('#4f6f8e', 0.36, 0.0, dict(grime=0.35, wear=0.20, noise=0.15)),
    'enamel_red':       ('#a83a2c', 0.40, 0.0, dict(grime=0.40, wear=0.25, noise=0.20)),
    'enamel_green':     ('#4e6b44', 0.40, 0.0, dict(grime=0.40, wear=0.25, noise=0.20)),
    'bakelite':         ('#2b1e16', 0.28, 0.0, dict(noise=0.1)),
    'rubber':           ('#34312e', 0.95, 0.0, dict(noise=0.25, grime=0.3)),
    'leather':          ('#4a3326', 0.70, 0.0, dict(noise=0.2)),
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
    'plate_steel':      ('#55595d', 0.50, 0.6, dict(grime=0.50, noise=0.25)),
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
    'report_card':      ('#c8dbb8', 0.6, 0.0, {}),
    'string':           ('#c2ad84', 0.9, 0.0, {}),
    'leaf':             ('#4e6c2c', 0.80, 0.0, dict(noise=0.55, leaf=1.0)),
    'leaf_dark':        ('#3a5424', 0.80, 0.0, dict(noise=0.55, leaf=1.0)),
    'conifer':          ('#2f4a2c', 0.80, 0.0, dict(noise=0.5, leaf=1.0)),
    'bark':             ('#4a3b2e', 0.90, 0.0, dict(noise=0.5)),
    'rock':             ('#8a8478', 0.85, 0.0, dict(noise=0.6, rocky=1.0)),
    'rock_quartz':      ('#e3ddd8', 0.55, 0.0, dict(noise=0.4, rocky=1.0)),
    'ore_iron':         ('#646c76', 0.62, 0.3, dict(noise=0.55, rocky=1.0)),
    'ore_iron_dark':    ('#4d555e', 0.62, 0.3, dict(noise=0.55, rocky=1.0)),
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
    'calib_top':        ('#d9534f', 0.5, 0.0, dict(emission=1.0)),
    'calib_south':      ('#5bc0de', 0.5, 0.0, dict(emission=1.0)),
    'calib_side':       ('#5cb85c', 0.5, 0.0, dict(emission=1.0)),
}

# Ink (A3 §5): line widths in 2x pixels (the normal and aux passes), so the High widths are half these.
INK = dict(
    line_sil=6.0,          # silhouette: 3.0 px at High (1.5 px on screen at 1x)
    line_in=3.2,           # material, object and crease lines: 1.6 px at High
    crease_deg=32.0,
    pen=(0.75, 0.45),      # pen pressure = 0.75 + 0.45 x slow noise: x 0.75 .. 1.20
    hatch_period=6.5,      # dark-band hatching at 45 degrees, High px
    hatch_width=1.8,
    hatch_ink=0.55,
    edge_dark=0.10,        # watercolour edge darkening within about 1.75 px of a line
    mottle=0.07,           # pigment mottle, +-3.5 %
    grain=0.05,            # paper grain
    margin=16,             # rho: the ink's reach is below this many High px (10 §9.1 step 6)
)
ICON_INK = dict(line_sil=5.0, line_in=2.2, selout=0.6)   # A3 §7: thinner, sel-out outlines
# Ink weight is importance (A3 §5; 10 §9.1 META.ink): machines 1.0, archive 0.75, ore 0.70, decoratives 0.45.
INK_WEIGHT = {'machine': 1.0, 'archive': 0.75, 'ore': 0.70, 'decorative': 0.45}

STYLES = {
    'survey': dict(
        title='Survey plate',
        mats=SURVEY_MATS,
        render='flat',
        samples=16,
        key=dict(dir=KEY_DIR),
        bands=(0.60, 0.16),          # N.L thresholds: light >= 0.60 > mid >= 0.16 > dark (hatched)
        band_values=(1.0, 0.86, 0.70),
        shadow=dict(dir=SHADOW_DIR, angle=1.0, sky=0.0),
        bevel=0.01,
        bevel_scale=0.6,
        ink='#2b2723',
        paper='#ece3cb',
    ),
    'kodachrome': dict(
        title='Kodachrome',
        mats=KODACHROME_MATS,
        render='pbr',
        samples=48,
        key=dict(dir=KEY_DIR, strength=4.6, color='#fff0d8', angle=1.2),
        rim=dict(dir=norm((0.45, 0.85, 0.30)), strength=1.6, color='#cfdcff', angle=4.0),
        sky=dict(color='#8fa6c6', strength=0.85),
        ground_bounce='#7d7462',
        shadow=dict(dir=SHADOW_DIR, angle=2.5, sky=0.35),
        bevel=0.018,
        weathering=0.55,
        ink='#1e1c1a',
        paper='#7d7462',
    ),
}


def style(name):
    return STYLES[name]


def mat_entry(style_name, key):
    mats = STYLES[style_name]['mats']
    if key not in mats:
        raise KeyError(f'material key {key!r} missing from style {style_name!r}')
    return mats[key]
