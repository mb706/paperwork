"""UI chrome for mocks: Factorio's HUD layout (I §4.1, 07 §2), skinned per style. SVG -> resvg.

The layout never changes between skins (07 keeps Factorio's UI): research widget, World strip,
side-menu buttons, minimap, docked entity info top right; two quickbar rows bottom centre with the
shortcut bar to their right; the crafting queue bottom left. Only colours, type, rules, corners and
textures change. Every string is from the text canon or the data (no ad-hoc player-facing text).

    png = hud(style, minimap_rgb, out_path)       # 1920x1080 RGBA overlay
"""

import base64
import io
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import post  # noqa: E402

FONTS = os.path.join(HERE, '..', 'out', 'fonts')
ICONS = os.path.join(HERE, '..', 'out', 'sprites')

SKINS = {
    'kodachrome': dict(
        font='Titillium Web', font_head='Titillium Web', font_mono='Titillium Web', head_weight=700,
        frame='#3b3834', frame_edge='#5a554e', frame_dark='#1f1d1b', deep='#262422', shallow='#4a4640',
        text='#f2ede4', text_dim='#b8b0a4', head='#ffe6b8', accent='#e8a33d', good='#6dbb46', bad='#d9502f',
        slot='#55504a', slot_edge='#2a2724', bar_bg='#1c1b19', radius=2, texture=None, rule='#5f5a52',
        caps=False, title_size=17, body_size=14,
    ),
    'model': dict(
        font='IBM Plex Sans', font_head='IBM Plex Sans', font_mono='IBM Plex Mono', head_weight=600,
        frame='#f3f1ec', frame_edge='#ffffff', frame_dark='#c9c4ba', deep='#e4e0d7', shallow='#faf8f4',
        text='#2b2c31', text_dim='#6a6b72', head='#1f2024', accent='#2f6fd0', good='#3f9a52', bad='#d24a3a',
        slot='#ffffff', slot_edge='#cfc9be', bar_bg='#d9d4ca', radius=7, texture=None, rule='#d8d3c9',
        caps=False, title_size=16, body_size=13.5, shadow=True,
    ),
    'charter': dict(
        font='Libre Franklin', font_head='Libre Franklin', font_mono='Courier Prime', font_typed='Courier Prime',
        head_weight=800, frame='#cdb27a', frame_edge='#e6d3a2', frame_dark='#6f5a36', deep='#f4ecd8',
        shallow='#e9dcba', text='#2b2723', text_dim='#5d5345', head='#2b2723', accent='#b5352a', good='#4f7a3c',
        bad='#b5352a', slot='#f8f2e1', slot_edge='#8f7f62', bar_bg='#e6d8b6', radius=1, texture='paper',
        rule='#8c7b5f', caps=True, title_size=14.5, body_size=13.5, typed_size=14.0, ledger='#a9bfd0',
    ),
    'survey-v1': dict(
        font='Courier Prime', font_head='Libre Franklin', font_mono='Courier Prime', head_weight=800,
        frame='#d9c08a', frame_edge='#ecd9ab', frame_dark='#8f7848', deep='#f3ead3', shallow='#efe3c3',
        text='#2b2723', text_dim='#6b6153', head='#2b2723', accent='#b5352a', good='#4f7a3c', bad='#b5352a',
        slot='#f7f0dc', slot_edge='#8f7f62', bar_bg='#e6d8b6', radius=1, texture='paper', rule='#7d6e57',
        caps=True, title_size=15, body_size=14.5,
    ),
}


def _png_uri(rgba):
    im = Image.fromarray((np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8))
    b = io.BytesIO()
    im.save(b, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()


def _icon_uri(style, item, size):
    import scene
    return _png_uri(scene.icon(style, item, size))


def _esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


class SVG:
    def __init__(self, w, h, sk):
        self.w, self.h, self.sk = w, h, sk
        self.parts = []

    def add(self, s):
        self.parts.append(s)

    def text(self, x, y, s, size=None, color=None, weight=400, family=None, anchor='start', caps=False,
             spacing=0):
        sk = self.sk
        size = size or sk['body_size']
        color = color or sk['text']
        family = family or sk['font']
        s = s.upper() if caps else s
        self.add(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" '
                 f'fill="{color}" text-anchor="{anchor}" letter-spacing="{spacing}">{_esc(s)}</text>')

    def panel(self, x, y, w, h, kind='frame', title=None):
        sk = self.sk
        r = sk['radius']
        if kind == 'frame':
            if sk.get('shadow'):
                self.add(f'<rect x="{x + 1}" y="{y + 3}" width="{w}" height="{h}" rx="{r}" fill="#000" '
                         f'opacity="0.18" filter="url(#soft)"/>')
            self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{sk["frame"]}" '
                     f'stroke="{sk["frame_dark"]}" stroke-width="1.5"/>')
            self.add(f'<rect x="{x + 1.5}" y="{y + 1.5}" width="{w - 3}" height="{h - 3}" rx="{max(0, r - 1)}" '
                     f'fill="none" stroke="{sk["frame_edge"]}" stroke-width="1" opacity="0.6"/>')
            if sk.get('texture') == 'paper':
                self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="url(#fibre)" opacity="0.5"/>')
        else:
            self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{max(0, r - 2)}" fill="{sk["deep"]}" '
                     f'stroke="{sk["frame_dark"]}" stroke-width="1"/>')
            if sk.get('texture') == 'paper':
                # ledger rules
                for yy in range(int(y) + 18, int(y + h) - 4, 18):
                    self.add(f'<line x1="{x + 4}" y1="{yy}" x2="{x + w - 4}" y2="{yy}" '
                             f'stroke="{sk.get("ledger", "#9fb7c9")}" stroke-width="0.8" opacity="0.55"/>')
        if title:
            self.text(x + 10, y + 21, title, size=sk['title_size'], color=sk['head'], weight=sk['head_weight'],
                      family=sk['font_head'], caps=sk['caps'], spacing=(1.2 if sk['caps'] else 0))

    def slot(self, x, y, s=40, item=None, style=None, count=None, highlight=False, dim=False):
        sk = self.sk
        r = max(0, sk['radius'] - 2)
        fill = sk['slot']
        self.add(f'<rect x="{x}" y="{y}" width="{s}" height="{s}" rx="{r}" fill="{fill}" stroke="{sk["slot_edge"]}" '
                 f'stroke-width="1"/>')
        if sk.get('texture') == 'paper':
            self.add(f'<line x1="{x + 3}" y1="{y + 9}" x2="{x + s - 3}" y2="{y + 9}" stroke="{sk["bad"]}" '
                     f'stroke-width="0.7" opacity="0.5"/>')
        if highlight:
            self.add(f'<rect x="{x + 1}" y="{y + 1}" width="{s - 2}" height="{s - 2}" rx="{r}" fill="none" '
                     f'stroke="{sk["accent"]}" stroke-width="2"/>')
        if item:
            uri = _icon_uri(style, item, 32)
            op = 0.35 if dim else 1.0
            self.add(f'<image x="{x + (s - 32) / 2}" y="{y + (s - 32) / 2}" width="32" height="32" href="{uri}" '
                     f'opacity="{op}"/>')
        if count is not None:
            cc = sk['text'] if sk.get('texture') == 'paper' or sk.get('shadow') else '#ffffff'
            stroke = sk['slot'] if (sk.get('texture') == 'paper' or sk.get('shadow')) else '#000000'
            self.add(f'<text x="{x + s - 3}" y="{y + s - 3}" font-family="{sk["font_mono"]}" font-size="12.5" '
                     f'font-weight="700" fill="{cc}" stroke="{stroke}" stroke-width="2.6" paint-order="stroke" '
                     f'text-anchor="end">{count}</text>')

    def bar(self, x, y, w, h, frac, color=None, hatched=False):
        sk = self.sk
        color = color or sk['good']
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{min(3, sk["radius"])}" fill="{sk["bar_bg"]}" '
                 f'stroke="{sk["frame_dark"]}" stroke-width="1"/>')
        fill = 'url(#hatch)' if hatched else color
        self.add(f'<rect x="{x + 1}" y="{y + 1}" width="{(w - 2) * frac:.1f}" height="{h - 2}" '
                 f'rx="{min(2, sk["radius"])}" fill="{fill}"/>')

    def svg(self):
        sk = self.sk
        defs = f'''<defs>
<filter id="soft" x="-10%" y="-10%" width="120%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<rect width="6" height="6" fill="{sk['good']}" opacity="0.25"/><rect width="2.2" height="6" fill="{sk['good']}"/></pattern>
<filter id="fibrefilter"><feTurbulence type="fractalNoise" baseFrequency="0.9 0.25" numOctaves="2" seed="4"/>
<feColorMatrix values="0 0 0 0 0.35 0 0 0 0 0.28 0 0 0 0 0.18 0 0 0 0.35 0"/></filter>
<pattern id="fibre" width="256" height="256" patternUnits="userSpaceOnUse">
<rect width="256" height="256" filter="url(#fibrefilter)"/></pattern>
</defs>'''
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
                f'viewBox="0 0 {self.w} {self.h}">' + defs + ''.join(self.parts) + '</svg>')


def wrap(text, width_px, size, avg=0.52):
    """Greedy word wrap by an average glyph width (em fraction); good enough for UI mock text."""
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if len(t) * size * avg > width_px and cur:
            lines.append(cur)
            cur = w
        else:
            cur = t
    if cur:
        lines.append(cur)
    return lines


def glyph(svg, kind, x, y, s, color):
    """Small line glyphs for side and shortcut buttons (drawn, not text)."""
    c = color
    sw = max(1.5, s / 14)
    p = []
    if kind == 'flask':      # technology
        p.append(f'<path d="M{x + s * .38} {y + s * .2} h{s * .24} M{x + s * .42} {y + s * .2} v{s * .22} '
                 f'L{x + s * .22} {y + s * .78} h{s * .56} L{x + s * .58} {y + s * .42} v-{s * .22}" fill="none" '
                 f'stroke="{c}" stroke-width="{sw}" stroke-linejoin="round"/>')
    elif kind == 'globe':    # world
        p.append(f'<circle cx="{x + s / 2}" cy="{y + s / 2}" r="{s * .3}" fill="none" stroke="{c}" stroke-width="{sw}"/>')
        p.append(f'<ellipse cx="{x + s / 2}" cy="{y + s / 2}" rx="{s * .13}" ry="{s * .3}" fill="none" stroke="{c}" '
                 f'stroke-width="{sw * .8}"/>')
        p.append(f'<line x1="{x + s * .2}" y1="{y + s / 2}" x2="{x + s * .8}" y2="{y + s / 2}" stroke="{c}" '
                 f'stroke-width="{sw * .8}"/>')
    elif kind == 'book':     # handbook
        p.append(f'<path d="M{x + s * .5} {y + s * .3} q-{s * .12} -{s * .08} -{s * .28} 0 v{s * .44} '
                 f'q{s * .16} -{s * .08} {s * .28} 0 q{s * .12} -{s * .08} {s * .28} 0 v-{s * .44} '
                 f'q-{s * .16} -{s * .08} -{s * .28} 0 v{s * .44}" fill="none" stroke="{c}" stroke-width="{sw}"/>')
    elif kind == 'chart':    # production statistics
        p.append(f'<polyline points="{x + s * .2},{y + s * .72} {x + s * .38},{y + s * .5} {x + s * .55},{y + s * .6} '
                 f'{x + s * .8},{y + s * .28}" fill="none" stroke="{c}" stroke-width="{sw}"/>')
    elif kind == 'alt':      # alt-mode
        p.append(f'<rect x="{x + s * .22}" y="{y + s * .3}" width="{s * .56}" height="{s * .4}" fill="none" '
                 f'stroke="{c}" stroke-width="{sw}"/>')
        p.append(f'<path d="M{x + s * .32} {y + s * .5} h{s * .3} l-{s * .08} -{s * .07} M{x + s * .62} {y + s * .5} '
                 f'l-{s * .08} {s * .07}" fill="none" stroke="{c}" stroke-width="{sw * .8}"/>')
    elif kind == 'lights':   # status lights
        for k, col in enumerate(('#5fae3a', '#e3b440', '#d9502f')):
            p.append(f'<circle cx="{x + s * (.3 + .2 * k)}" cy="{y + s / 2}" r="{s * .08}" fill="{col}"/>')
    elif kind == 'rate':     # rate calculator
        p.append(f'<rect x="{x + s * .25}" y="{y + s * .25}" width="{s * .5}" height="{s * .5}" fill="none" '
                 f'stroke="{c}" stroke-width="{sw}" stroke-dasharray="{s * .08} {s * .05}"/>')
        p.append(f'<text x="{x + s / 2}" y="{y + s * .6}" font-size="{s * .28}" text-anchor="middle" fill="{c}" '
                 f'font-family="Titillium Web" font-weight="700">/s</text>')
    elif kind == 'wire':     # copper wire shortcut
        p.append(f'<path d="M{x + s * .2} {y + s * .7} C{x + s * .4} {y + s * .2} {x + s * .6} {y + s * .9} '
                 f'{x + s * .8} {y + s * .3}" fill="none" stroke="#c97a3a" stroke-width="{sw}"/>')
    svg.add(''.join(p))


def hud(style, minimap, out_png, W=1920, H=1080, research=('report', 'Linear programming', 0.62)):
    sk = SKINS[style]
    s = SVG(W, H, sk)
    # ---------- right column ----------
    cw = 252
    cx = W - cw - 14
    y = 12
    s.panel(cx, y, cw, 66, 'frame')
    s.slot(cx + 8, y + 8, 48, research[0], style)
    s.text(cx + 66, y + 27, research[1], size=sk['body_size'] + 1, color=sk['head'], weight=600,
           family=sk['font_head'] if not sk['caps'] else sk['font'])
    s.bar(cx + 66, y + 38, cw - 76, 14, research[2], hatched=(style == 'survey'))
    s.text(cx + cw - 12, y + 50, f'{int(research[2] * 100)}%', size=11.5, color=sk['text'], anchor='end', weight=700,
           family=sk.get('font_typed') or sk['font'])
    y += 72
    # world strip (07 §4.1): in the slice only Field shows
    s.panel(cx, y, cw, 28, 'frame')
    if sk.get('font_typed'):
        s.text(cx + 10, y + 19, 'Field', size=sk['body_size'], color=sk['text_dim'], weight=600)
        s.text(cx + 52, y + 19.5, '1951', size=sk.get('typed_size', 14), color=sk['text'], weight=700,
               family=sk['font_typed'])
    else:
        s.text(cx + 10, y + 19, 'Field 1951', size=sk['body_size'], color=sk['text'], weight=600)
    y += 34
    # side-menu buttons
    bs = 38
    gap = (cw - 6 * bs) / 7
    kinds = ['flask', 'chart', 'book', 'globe', None, None]
    for i, k in enumerate(kinds):
        bx = cx + gap + i * (bs + gap)
        s.add(f'<rect x="{bx}" y="{y}" width="{bs}" height="{bs}" rx="{sk["radius"]}" fill="{sk["shallow"]}" '
              f'stroke="{sk["frame_dark"]}" stroke-width="1" opacity="{1.0 if k else 0.35}"/>')
        if k:
            glyph(s, k, bx, y, bs, sk['text'])
    y += bs + 8
    # minimap
    mm = cw
    s.panel(cx, y, cw, cw, 'frame')
    if minimap is not None:
        uri = _png_uri(post.resize(np.concatenate([minimap, np.ones(minimap.shape[:2] + (1,))], -1),
                                   (mm - 12) / minimap.shape[0]))
        s.add(f'<image x="{cx + 6}" y="{y + 6}" width="{mm - 12}" height="{mm - 12}" href="{uri}"/>')
        s.add(f'<rect x="{cx + 6}" y="{y + 6}" width="{mm - 12}" height="{mm - 12}" fill="none" '
              f'stroke="{sk["frame_dark"]}" stroke-width="1.5"/>')
        # the view rectangle (60x34 tiles at 2 px per tile, centred)
        vw, vh = 60 * (mm - 12) / 120, 34 * (mm - 12) / 120
        s.add(f'<rect x="{cx + 6 + (mm - 12 - vw) / 2}" y="{y + 6 + (mm - 12 - vh) / 2}" width="{vw}" height="{vh}" '
              f'fill="none" stroke="{"#ffffff" if style != "survey" else "#b5352a"}" stroke-width="1.2" opacity="0.8"/>')
    y += cw + 6
    # docked entity info: the Keypunch (entities.yaml desc; 3.2 s recipe at speed 1 -> 0.31/s)
    th = 236
    s.panel(cx, y, cw, th, 'frame', title='Keypunch')
    yy = y + 32
    s.panel(cx + 8, yy, cw - 16, th - 40, 'deep')
    tx = cx + 16
    typed = sk.get('font_typed')
    vfam = typed or sk['font']
    vsize = sk.get('typed_size', sk['body_size'] - 0.5)
    desc = 'Transcribes records into tokens, one card at a time. Burns fuel.'
    lines = wrap(desc, cw - 40, sk['body_size'] - 1, 0.50 if not typed else 0.50)
    for k, line in enumerate(lines[:3]):
        s.text(tx, yy + 20 + 17 * k, line, size=sk['body_size'] - 1, color=sk['text_dim'])
    oy = 17 * (len(lines[:3]) - 2)
    s.add(f'<circle cx="{tx + 6}" cy="{yy + 58 + oy}" r="5" fill="{sk["good"]}"/>')
    s.text(tx + 18, yy + 63 + oy, 'Working', size=sk['body_size'], color=sk['text'], weight=600)
    # throughput line: [records] 0.31 => [token] 0.31 /s
    rec = _icon_uri(style, 'records', 24)
    tok = _icon_uri(style, 'token', 24)
    ly = yy + 76 + oy
    s.add(f'<image x="{tx}" y="{ly}" width="24" height="24" href="{rec}"/>')
    s.text(tx + 28, ly + 17, '0.31', size=vsize, color=sk['text'], family=vfam)
    # the 'yields' arrow is drawn, not typed: not every UI face carries U+21D2
    ax0, ay0 = tx + 66, ly + 12
    s.add(f'<path d="M{ax0} {ay0 - 3} h14 M{ax0} {ay0 + 3} h14 M{ax0 + 10} {ay0 - 7} l6 7 l-6 7" fill="none" '
          f'stroke="{sk["text"]}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>')
    s.add(f'<image x="{tx + 92}" y="{ly}" width="24" height="24" href="{tok}"/>')
    s.text(tx + 120, ly + 17, '0.31 /s', size=vsize, color=sk['text'], family=vfam)
    s.add(f'<line x1="{tx}" y1="{ly + 34}" x2="{cx + cw - 16}" y2="{ly + 34}" stroke="{sk["rule"]}" stroke-width="1"/>')
    rows = [('Crafting speed:', '1', None), ('Products finished:', '412', None), ('Consumes burnable fuel:', '4', 'coal')]
    for k, (lab, val, ic) in enumerate(rows):
        yv = ly + 54 + 20 * k
        s.text(tx, yv, lab, size=sk['body_size'] - 0.5, color=sk['text_dim'])
        s.text(cx + cw - 18, yv, val, size=vsize, color=sk['text'], anchor='end', weight=700, family=vfam)
        if ic:
            s.add(f'<image x="{cx + cw - 52}" y="{yv - 16}" width="22" height="22" href="{_icon_uri(style, ic, 22)}"/>')

    # ---------- bottom: quickbar (2 rows x 10), shortcut bar ----------
    row1 = [('transport-belt', 184), ('inserter', 23), ('small-electric-pole', 12), ('stone-furnace', 6),
            ('keypunch', 4), ('assembling-machine-1', 3), ('seminar', 2), ('electric-mining-drill', 5),
            ('wooden-chest', 8), (None, None)]
    row2 = [('iron-plate', 126), ('iron-gear-wheel', 40), ('copper-cable', 66), ('logic-board', 18), ('coal', 37),
            ('records', 50), ('token', 12), ('memo', 9), ('wood', 20), (None, None)]
    ss = 40
    qw = 10 * ss + 9 * 2 + 30 + 16
    qx = (W - qw) // 2 - 60
    qy = H - 2 * ss - 2 - 16 - 8
    s.panel(qx, qy, qw, 2 * ss + 2 + 16, 'frame')
    for r, row in enumerate((row1, row2)):
        ry = qy + 8 + r * (ss + 2)
        s.add(f'<rect x="{qx + 8}" y="{ry}" width="24" height="{ss}" rx="{sk["radius"]}" fill="{sk["shallow"]}" '
              f'stroke="{sk["frame_dark"]}" stroke-width="1"/>')
        s.text(qx + 20, ry + 26, str(r + 1), size=13, color=sk['text'], anchor='middle', weight=700)
        for i, (it, n) in enumerate(row):
            s.slot(qx + 38 + i * (ss + 2), ry, ss, it, style, n, highlight=(r == 0 and i == 0))
    # shortcut bar
    sx = qx + qw + 10
    s.panel(sx, qy, 3 * ss + 16 + 4, 2 * ss + 2 + 16, 'frame')
    for i, k in enumerate(('alt', 'lights', 'rate')):
        bx = sx + 8 + i * (ss + 2)
        on = k == 'lights'
        s.add(f'<rect x="{bx}" y="{qy + 8}" width="{ss}" height="{ss}" rx="{sk["radius"]}" '
              f'fill="{sk["accent"] if on else sk["shallow"]}" stroke="{sk["frame_dark"]}" stroke-width="1" '
              f'opacity="{0.9 if on else 1}"/>')
        glyph(s, k, bx, qy + 8, ss, sk['text'] if not on else sk['frame_dark'])
    bx = sx + 8
    s.add(f'<rect x="{bx}" y="{qy + 8 + ss + 2}" width="{ss}" height="{ss}" rx="{sk["radius"]}" fill="{sk["shallow"]}" '
          f'stroke="{sk["frame_dark"]}" stroke-width="1"/>')
    glyph(s, 'wire', bx, qy + 8 + ss + 2, ss, sk['text'])

    # ---------- crafting queue (bottom left) ----------
    s.panel(14, H - 70, 2 * ss + 18, ss + 16, 'frame')
    s.slot(22, H - 62, ss, 'inserter', style, 4)
    s.slot(22 + ss + 2, H - 62, ss, 'transport-belt', style, 10)
    s.add(f'<rect x="23" y="{H - 62 + ss - 6}" width="{(ss - 2) * 0.4}" height="4" fill="{sk["good"]}"/>')

    svg_path = out_png.replace('.png', '.svg')
    open(svg_path, 'w').write(s.svg())
    subprocess.run(['resvg', '--use-fonts-dir', FONTS, '--skip-system-fonts', svg_path,
                    out_png], check=True)
    return post.read_png(out_png)


SKINS['survey'] = SKINS['charter']     # the recommended direction uses the filled-in-form skin

CHART = {
    # tile colours by style: the data's map_color for the Factorio-like chart; a topographic sheet for survey
    'survey': {'grass': '#ece3cb', 'dirt': '#e6d8bb', 'sand': '#efe2bf', 'water': '#bcd6e2', 'deep-water': '#a9c9da',
               'town-street': '#f1ebdd', 'town-block': '#e9c9be'},
    'model': {'grass': '#86b05a', 'dirt': '#b8966a', 'sand': '#e4d2a6', 'water': '#5aa3c2', 'deep-water': '#4282aa',
              'town-street': '#9a9898', 'town-block': '#c9b9a6'},
}
RES = {'kodachrome': {'iron-ore': '#6a8bb5', 'copper-ore': '#d46a3a', 'coal': '#151515', 'quartz': '#d8d2cc',
                      'archive': '#d9b968'},
       'model': {'iron-ore': '#7d95b8', 'copper-ore': '#e07a4a', 'coal': '#2a2a2e', 'quartz': '#f2ece6',
                 'archive': '#f0d080'},
       'survey': {'iron-ore': '#7f8fa3', 'copper-ore': '#c98058', 'coal': '#4a4a4a', 'quartz': '#cfc7bd',
                  'archive': '#d7b86e'}}
ENT = {'kodachrome': ('#d3b24b', '#5c7088', '#2f4a22'), 'model': ('#f2bb33', '#4c6a80', '#4f8a3c'),
       'survey': ('#8a6d2c', '#2b2723', '#9fbb84')}


def minimap(layout, style, centre, tiles=120, px=2):
    """Chart image (Factorio's minimap): tile colours, resources, entity footprints, per style."""
    import terrain as T
    import yaml
    data = yaml.safe_load(open(os.path.join(HERE, '..', '..', 'spec', 'data', 'tiles.yaml')))
    mc = {t['id']: post.hexc(t['map_color']) for t in data}
    for k, v in CHART.get(style, {}).items():
        mc[k] = post.hexc(v)
    cx, cy = centre
    x0, y0 = int(cx - tiles / 2), int(cy - tiles / 2)
    img = np.zeros((tiles, tiles, 3), np.float32)
    for j in range(tiles):
        for i in range(tiles):
            x, y = x0 + i, y0 + j
            if layout.x0 <= x < layout.x0 + layout.w and layout.y0 <= y < layout.y0 + layout.h:
                tid = layout.tiles[y - layout.y0, x - layout.x0]
                img[j, i] = mc.get(T.TILES[tid], post.hexc('#4f6b2b'))
    belt_c, obj_c, tree_c = ENT[style]
    for e in layout.ents:
        i, j = int(e.cx - e.w / 2) - x0, int(e.cy - e.h / 2) - y0
        if e.layer == 'resource':
            c = RES[style].get(e.eid)
        elif e.layer in ('decor', 'high') or e.eid in ('campus', 'town-block', 'character'):
            continue
        elif e.eid == 'tree':
            c = tree_c
        elif e.layer == 'belt':
            c = belt_c
        else:
            c = obj_c
        if c is None:
            continue
        i0, j0, i1, j1 = max(0, i), max(0, j), min(tiles, i + e.w), min(tiles, j + e.h)
        if i1 > i0 and j1 > j0:
            img[j0:j1, i0:i1] = post.hexc(c)
    return np.repeat(np.repeat(img, px, 0), px, 1)
