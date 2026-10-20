"""Camera, canvas, light rig and render passes (Blender 5.2.2, Cycles CPU; 10 §9.1). Ported from A3's prototype.

The projection: orthographic, pitched 45 degrees, viewed from the south, rendered with pixel_aspect_x = sqrt(2)
so a ground tile is 64 x 64 px at High and a 1 m vertical edge is 64 px tall (A3 measured it; the calibration
test test/assets/projection.py checks it on every build of the rig).

A canvas is chosen per sprite set from its footprint, its height and the shadow's reach, rounded out to half
tiles (32 px at High), so the anchor (the footprint centre on the ground) sits on a pixel corner that is a
multiple of 32 px:   col = ax + PX * x,   row = ay - PX * (y + z).

Passes (10 §9.1's table; A3 §13.3's settings: Standard view transform, transparent film, fixed threads, seed 7,
adaptive threshold 0.02, no denoiser):
  colour   the washes, 16 samples, High
  normal   world normal as (n + 1) / 2, 8-bit, 1 sample, filter 0.01, 2x High (crease lines and hatching)
  aux      material id (R, G), object id or the organic flag (B); 1 sample, filter 0.01, 2x High
  light    emitters only, everything else black; 4 samples, High
  shadow   a shadow catcher; the model invisible to the camera and to bounce rays (a pure occluder); a 1-degree
           sun, no sky; 64 samples (greyboxes 16), Normal
  pos      (sets with a self_region) the position in a reference object's frame as (p / 4 + 1/2), 16-bit, 2x,
           1 sample: the post step cuts a piece exactly at its tile's edges with it
A border render (`border=(x0, y0, x1, y1)` in High px of the canvas) renders and crops exactly that rectangle:
Blender truncates border x canvas size to whole pixels, so the edges are offset by a quarter pixel.
"""

import math

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

from . import materials as M
from . import style as S

CAM_DIST = 60.0
SEED = 7


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def setup_render(scene, style_name, threads=16, samples=None):
    st = S.STYLES[style_name]
    r = scene.render
    r.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples or st['samples']
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = st['render'] == 'pbr'
    if st['render'] == 'pbr':
        scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    scene.cycles.max_bounces = 6
    scene.cycles.transparent_max_bounces = 16
    scene.cycles.seed = SEED
    scene.cycles.use_animated_seed = False
    # no metadata stamps in the PNGs (date, times); Cycles' own render statistics are stripped after writing
    for attr in dir(scene.render):
        if attr.startswith('use_stamp'):
            setattr(scene.render, attr, False)
    scene.cycles.film_transparent_glass = True
    scene.cycles.film_transparent_roughness = 0.1
    r.film_transparent = True
    r.threads_mode = 'FIXED'
    r.threads = threads
    r.pixel_aspect_x = S.PIXEL_ASPECT_X
    r.pixel_aspect_y = 1.0
    r.resolution_percentage = 100
    r.dither_intensity = 0.0
    r.use_compositing = False
    r.use_sequencer = False
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGBA'
    r.image_settings.color_depth = '8'
    r.image_settings.compression = 15
    vs = scene.view_settings
    vs.view_transform = 'Standard'
    vs.look = 'None'
    vs.exposure = 0.0
    vs.gamma = 1.0
    scene.display_settings.display_device = 'sRGB'
    scene.sequencer_colorspace_settings.name = 'sRGB'


def make_camera(scene):
    cam_data = bpy.data.cameras.new('sprite_cam')
    cam_data.type = 'ORTHO'
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.clip_start = 0.1
    cam_data.clip_end = 400.0
    cam = bpy.data.objects.new('sprite_cam', cam_data)
    scene.collection.objects.link(cam)
    cam.rotation_euler = (math.radians(S.PITCH_DEG), 0.0, 0.0)
    scene.camera = cam
    return cam


def _half_out(v, up):
    return (math.ceil(v * 2 - 1e-9) / 2) if up else (math.floor(v * 2 + 1e-9) / 2)


class Canvas:
    """A sprite canvas in tiles, relative to the anchor (footprint centre on the ground), rounded to half tiles.

    xmin..xmax runs west to east; umin..umax is screen-up (u = y + z). The shadow's reach (A3 §2: 1.43 x
    height east, 0.39 x height south) and a margin for the ink and overhangs are included."""

    def __init__(self, w, h, height, margin=0.5, shadow=True, extra=(0, 0, 0, 0)):
        sx, sy = S.SHADOW_REACH
        reach_e = height * sx if shadow else 0.0
        reach_s = -height * sy if shadow else 0.0
        ex_w, ex_e, ex_s, ex_n = extra
        self.xmin = _half_out(-w / 2 - margin - ex_w, False)
        self.xmax = _half_out(w / 2 + margin + max(0.0, reach_e) + ex_e, True)
        self.umin = _half_out(-h / 2 - margin - max(0.0, reach_s) - ex_s, False)
        self.umax = _half_out(h / 2 + height + margin + ex_n, True)

    def size_px(self, px):
        return int(round((self.xmax - self.xmin) * px)), int(round((self.umax - self.umin) * px))

    def anchor_px(self, px):
        return int(round(-self.xmin * px)), int(round(self.umax * px))

    def as_dict(self):
        return dict(xmin=self.xmin, xmax=self.xmax, umin=self.umin, umax=self.umax)


def aim_camera(scene, cam, canvas, px):
    W, H = canvas.size_px(px)
    scene.render.resolution_x = W
    scene.render.resolution_y = H
    cam.data.ortho_scale = W / px
    cx = (canvas.xmin + canvas.xmax) / 2
    cu = (canvas.umin + canvas.umax) / 2
    target = Vector((cx, cu, 0.0))
    view = Vector((0.0, math.cos(math.radians(S.PITCH_DEG)), -math.sin(math.radians(S.PITCH_DEG))))
    cam.location = target - view * CAM_DIST
    bpy.context.view_layer.update()              # projections (project_px, bounds_px) read the camera's matrix
    return W, H


def project_px(scene, cam, point, W, H):
    """World point -> (col, row) in High px of the canvas (row 0 at the top)."""
    p = world_to_camera_view(scene, cam, Vector(point))
    return p.x * W, (1.0 - p.y) * H


def bounds_px(scene, cam, objs, W, H):
    """Projected bounding box (x0, y0, x1, y1) in High px of the evaluated geometry of `objs` (meshes only)."""
    dg = bpy.context.evaluated_depsgraph_get()
    x0 = y0 = 1e9
    x1 = y1 = -1e9
    for o in objs:
        if o.type != 'MESH':
            continue
        oe = o.evaluated_get(dg)
        for c in oe.bound_box:
            x, y = project_px(scene, cam, oe.matrix_world @ Vector(c), W, H)
            x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x), max(y1, y)
    return x0, y0, x1, y1


def _sun(name, direction, strength, color_hex, angle_deg):
    ld = bpy.data.lights.new(name, 'SUN')
    ld.energy = strength
    ld.color = S.hex_to_linear(color_hex)
    ld.angle = math.radians(angle_deg)
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = Vector(direction).to_track_quat('Z', 'Y').to_euler()
    return ob


def make_world(scene, color_hex, strength, gradient=False):
    w = bpy.data.worlds.new('sky')
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get('Background')
    base = S.hex_to_linear(color_hex)
    bg.inputs['Strength'].default_value = strength
    if not gradient:
        bg.inputs['Color'].default_value = (*base, 1.0)
    else:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc.outputs['Generated'], sep.inputs[0])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        nt.links.new(sep.outputs[2], ramp.inputs[0])
        e = ramp.color_ramp.elements
        e[0].position = 0.0
        e[0].color = (base[0] * 0.55, base[1] * 0.55, base[2] * 0.50, 1)
        e[1].position = 1.0
        e[1].color = (base[0] * 0.75, base[1] * 0.85, base[2] * 1.05, 1)
        mid = e.new(0.5)
        mid.color = (min(1, base[0] * 1.45), min(1, base[1] * 1.40), min(1, base[2] * 1.30), 1)
        hi = e.new(0.62)
        hi.color = (base[0] * 1.05, base[1] * 1.1, base[2] * 1.15, 1)
        nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    scene.world = w
    return w


class Rig:
    """The lights and the ground of one style, switched per pass."""

    def __init__(self, scene, style_name):
        self.scene = scene
        self.style = style_name
        st = S.STYLES[style_name]
        self.st = st
        self.lights_colour = []
        if st['render'] == 'pbr':
            k = st['key']
            self.lights_colour.append(_sun('key', k['dir'], k['strength'], k['color'], k['angle']))
            if st.get('rim'):
                rr = st['rim']
                self.lights_colour.append(_sun('rim', rr['dir'], rr['strength'], rr['color'], rr['angle']))
        sh = st['shadow']
        self.light_shadow = _sun('shadow_sun', sh['dir'], 3.0, '#ffffff', sh['angle'])
        sky = st.get('sky') or dict(color='#000000', strength=0.0)
        self.world = make_world(scene, sky['color'], sky['strength'], gradient=st['render'] == 'pbr')
        self.world_shadow = make_world(scene, '#ffffff', sh.get('sky', 0.0))
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
        g = bpy.context.object
        g.name = 'ground'
        gm = bpy.data.materials.new('ground_bounce')
        gm.use_nodes = True
        b = gm.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = (*S.hex_to_linear(st.get('ground_bounce', '#808080')), 1)
        b.inputs['Roughness'].default_value = 1.0
        g.data.materials.append(gm)
        self.ground = g

    def mode(self, which, model_objs):
        sc = self.scene
        g = self.ground
        for o in model_objs:
            if o.type == 'LIGHT':
                o.hide_render = which not in ('colour', 'light')
        if which == 'colour':
            sc.world = self.world
            for lt in self.lights_colour:
                lt.hide_render = False
            self.light_shadow.hide_render = True
            g.hide_render = False
            g.visible_camera = False
            g.is_shadow_catcher = False
            for o in model_objs:
                o.visible_camera = True
                o.visible_shadow = True
                _bounce_visible(o, True)
        elif which == 'shadow':
            sc.world = self.world_shadow
            for lt in self.lights_colour:
                lt.hide_render = True
            self.light_shadow.hide_render = False
            g.hide_render = False
            g.visible_camera = True
            g.is_shadow_catcher = True
            for o in model_objs:
                o.visible_camera = False
                o.visible_shadow = True
                # a pure occluder: the flat washes are emission, and a model visible to the ground's diffuse
                # rays lights its own shadow, noisily (measured: 3-5x the noise of A3's masks, 27 dB after ETC1S)
                _bounce_visible(o, False)
        elif which in ('light', 'normal', 'aux', 'pos'):
            sc.world = self.world_shadow
            for lt in self.lights_colour:
                lt.hide_render = True
            self.light_shadow.hide_render = True
            g.hide_render = True
            for o in model_objs:
                o.visible_camera = True
                _bounce_visible(o, True)
        else:
            raise ValueError(which)


_PNG_DROP = (b'tEXt', b'zTXt', b'iTXt', b'tIME', b'eXIf')


def strip_png_metadata(path):
    """Rewrite a PNG without its text, time and EXIF chunks: Cycles writes its render times into every file
    ('cycles.ViewLayer.render_time' and so on), so identical pixels would differ byte for byte between runs."""
    import struct
    with open(path, 'rb') as f:
        data = f.read()
    out, i = [data[:8]], 8
    while i < len(data):
        n = struct.unpack('>I', data[i:i + 4])[0]
        kind = data[i + 4:i + 8]
        if kind not in _PNG_DROP:
            out.append(data[i:i + 12 + n])
        i += 12 + n
    with open(path, 'wb') as f:
        f.write(b''.join(out))


def _bounce_visible(o, on):
    """Whether an object takes part in light transport beyond camera and shadow rays."""
    o.visible_diffuse = on
    o.visible_glossy = on
    o.visible_transmission = on
    o.visible_volume_scatter = on


def render_pass(scene, rig, which, objs, path, border=None, pos_ref=None, shadow_samples=64):
    """Render one pass of the current scene to `path` (PNG). `border` = (x0, y0, x1, y1) in High px of the
    canvas crops the render to that rectangle (at the pass's own scale). Returns the expected (w, h)."""
    st = rig.st
    flat = st['render'] == 'flat'
    r = scene.render
    W, H = r.resolution_x, r.resolution_y
    old = (scene.cycles.samples, r.image_settings.color_depth, scene.cycles.filter_width, r.resolution_x,
           r.resolution_y, r.resolution_percentage)
    rig.mode(which, objs)
    scale = 1.0
    if which == 'colour':
        pass
    elif which == 'light':
        scene.cycles.samples = 4
    elif which in ('normal', 'aux', 'pos'):
        scene.cycles.samples = 1
        scene.cycles.filter_width = 0.01
        r.resolution_x, r.resolution_y = W * 2, H * 2
        if which == 'pos':
            r.image_settings.color_depth = '16'
        scale = 2.0
    elif which == 'shadow':
        scene.cycles.samples = shadow_samples if flat else max(16, st['samples'] // 2)
        r.resolution_percentage = 50          # Normal resolution (10 §9.1)
        scale = 0.5
    if flat and which in ('normal', 'aux', 'light', 'pos'):
        M.set_output(which, ref=pos_ref)
    if border is not None:
        x0, y0, x1, y1 = border
        r.use_border = True
        r.use_crop_to_border = True
        r.border_min_x = (x0 + 0.25) / W
        r.border_max_x = (x1 + 0.25) / W
        r.border_min_y = (H - y1 + 0.25) / H
        r.border_max_y = (H - y0 + 0.25) / H
        size = (int(round((x1 - x0) * scale)), int(round((y1 - y0) * scale)))
    else:
        r.use_border = False
        r.use_crop_to_border = False
        size = (int(round(W * scale)), int(round(H * scale)))
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    strip_png_metadata(path)
    if flat and which in ('normal', 'aux', 'light', 'pos'):
        M.set_output('beauty')
    r.use_border = False
    r.use_crop_to_border = False
    (scene.cycles.samples, r.image_settings.color_depth, scene.cycles.filter_width, r.resolution_x,
     r.resolution_y, r.resolution_percentage) = old
    return size
