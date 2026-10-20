"""Camera, lights and render passes for sprite rendering (Blender 5.2, Cycles CPU).

The projection is 10 §9.1's: orthographic, pitched 45°, viewed from the south, rendered with
pixel_aspect_x = √2 so a ground tile is 64×64 px at High and a 1 m vertical edge is 64 px tall.
Measured (A3): a unit cube renders 64 px wide, top face 64 px, south face 64 px.

A sprite canvas is chosen per entity from its footprint, height and the shadow's reach, rounded
to half tiles so the anchor (footprint centre on the ground) sits on a pixel corner:
    col = ax + PX*x,  row = ay - PX*(y + z)

Passes (each a PNG):
  colour   RGBA, transparent film; the ground plane is invisible to the camera but bounces light
  shadow   alpha = shadow density on a shadow-catcher ground (object invisible to the camera)
  light    emission only (night glow); optional
  normal   flat styles: world normal encoded (n+1)/2, 16-bit, 2x resolution, 1 spp, no filter
  aux      flat styles: R material id, G object random, B flat flag; 2x, 1 spp, no filter
"""

import math
import bpy
from mathutils import Vector

from . import style as S
from . import materials as M

CAM_DIST = 60.0


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    return scene


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
    scene.cycles.seed = 7
    scene.cycles.film_transparent_glass = True
    scene.cycles.film_transparent_roughness = 0.1
    r.film_transparent = True
    r.threads_mode = 'FIXED'
    r.threads = threads
    r.pixel_aspect_x = S.PIXEL_ASPECT_X
    r.pixel_aspect_y = 1.0
    r.resolution_percentage = 100
    r.dither_intensity = 0.0
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGBA'
    r.image_settings.color_depth = '8'
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


class Canvas:
    """Sprite canvas in tiles, relative to the anchor (footprint centre, ground)."""

    def __init__(self, w, h, height, margin=0.5, shadow=True, extra=(0, 0, 0, 0)):
        sd = S.SHADOW_DIR
        sx = -sd[0] / sd[2]     # ground offset per metre of height (east +)
        sy = -sd[1] / sd[2]     # (north +; negative = south)
        reach_e = height * sx if shadow else 0.0
        reach_s = -height * sy if shadow else 0.0
        ex_w, ex_e, ex_s, ex_n = extra
        self.xmin = -w / 2 - margin - ex_w
        self.xmax = w / 2 + margin + max(0.0, reach_e) + ex_e
        self.umin = -h / 2 - margin - max(0.0, reach_s) - ex_s   # screen-up units (y + z)
        self.umax = h / 2 + height + margin + ex_n
        # round outward to half tiles
        f = lambda v, up: (math.ceil(v * 2) / 2) if up else (math.floor(v * 2) / 2)
        self.xmin, self.xmax = f(self.xmin, False), f(self.xmax, True)
        self.umin, self.umax = f(self.umin, False), f(self.umax, True)

    def size_px(self, px):
        return int(round((self.xmax - self.xmin) * px)), int(round((self.umax - self.umin) * px))

    def anchor_px(self, px):
        return int(round(-self.xmin * px)), int(round(self.umax * px))


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
    return W, H


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
    """Uniform sky, or (gradient=True) a horizon-to-zenith gradient so glass and metal reflect a sky."""
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
        e[0].color = (base[0] * 0.55, base[1] * 0.55, base[2] * 0.50, 1)      # below the horizon: ground-ish
        e[1].position = 1.0
        e[1].color = (base[0] * 0.75, base[1] * 0.85, base[2] * 1.05, 1)      # zenith
        mid = e.new(0.5)
        mid.color = (min(1, base[0] * 1.45), min(1, base[1] * 1.40), min(1, base[2] * 1.30), 1)   # horizon
        hi = e.new(0.62)
        hi.color = (base[0] * 1.05, base[1] * 1.1, base[2] * 1.15, 1)
        nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    scene.world = w
    return w


class Rig:
    """Holds the lights and ground of one style and switches them per pass."""

    def __init__(self, scene, style_name):
        self.scene = scene
        self.style = style_name
        st = S.STYLES[style_name]
        self.st = st
        self.lights_colour = []
        self.light_shadow = None
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
        # ground plane: camera-invisible bounce surface in colour pass; shadow catcher in shadow pass
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
        for o in model_objs:          # lamps inside models light the colour and light passes only
            if o.type == 'LIGHT':
                o.hide_render = which not in ('colour', 'light')
        if which == 'colour':
            sc.world = self.world
            for l in self.lights_colour:
                l.hide_render = False
            self.light_shadow.hide_render = True
            g.hide_render = False
            g.visible_camera = False
            g.is_shadow_catcher = False
            for o in model_objs:
                o.visible_camera = True
                o.visible_shadow = True
        elif which == 'shadow':
            sc.world = self.world_shadow
            for l in self.lights_colour:
                l.hide_render = True
            self.light_shadow.hide_render = False
            g.hide_render = False
            g.visible_camera = True
            g.is_shadow_catcher = True
            for o in model_objs:
                o.visible_camera = False
                o.visible_shadow = True
        elif which == 'light':
            sc.world = self.world_shadow
            for l in self.lights_colour:
                l.hide_render = True
            self.light_shadow.hide_render = True
            g.hide_render = True
            for o in model_objs:
                o.visible_camera = True
        elif which in ('normal', 'aux'):
            sc.world = self.world_shadow
            for l in self.lights_colour:
                l.hide_render = True
            self.light_shadow.hide_render = True
            g.hide_render = True
            for o in model_objs:
                o.visible_camera = True
        else:
            raise ValueError(which)


def render_to(scene, path, samples=None, depth='8', filter_width=None, scale=1):
    r = scene.render
    old = (scene.cycles.samples, r.image_settings.color_depth, scene.cycles.filter_width,
           r.resolution_x, r.resolution_y, scene.cycles.use_denoising)
    if samples is not None:
        scene.cycles.samples = samples
    r.image_settings.color_depth = depth
    if filter_width is not None:
        scene.cycles.filter_width = filter_width
    if scale != 1:
        r.resolution_x *= scale
        r.resolution_y *= scale
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    (scene.cycles.samples, r.image_settings.color_depth, scene.cycles.filter_width,
     r.resolution_x, r.resolution_y, scene.cycles.use_denoising) = old
