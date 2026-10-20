"""B2 budget model check (codex B2-r1 finding 13): the model's per-unit render costs against a complete layered
build of A3's prototype set (every entity, direction and variant; render_layers.py --all --shadow-normal --full-base).

    gamedev-python -I design/asset-study/render/validate_model.py design/art/out/layers-build-all.log

Prints, per entity and in total, the measured seconds of each part and what budget_model.py's unit costs predict
from the measured canvas and rectangle sizes; then budget_model.canvas_px (the rig's canvas from size, height and
margin) against the measured canvases, and the model's whole prediction from META alone.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'design', 'art', 'proto'))


def canvas_px(w, h, H, margin):
    sys.path.insert(0, HERE)
    from budget_model import canvas_px as f
    return f(w, h, H, margin)


def meta(entity):
    import ast
    src = open(os.path.join(ROOT, 'design', 'art', 'proto', 'entities', entity.replace('-', '_') + '.py')).read()
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], 'id', '') == 'META':
            call = node.value
            out = {}
            for kw in call.keywords:
                try:
                    out[kw.arg] = ast.literal_eval(kw.value)
                except ValueError:
                    pass
            return out
    return {}


def main():
    rows = [json.loads(l[len('[build] '):]) for l in open(sys.argv[1]) if l.startswith('[build] ')]
    seen = {}
    for r in rows:
        seen[r['entity']] = r          # the last run of an entity wins (the belt was rerun)
    tot = dict(meas_base=0, meas_shadow=0, meas_anim=0, pred_base=0, pred_shadow=0, pred_anim=0, meas_total=0,
               canvas_meas=0, canvas_pred=0)
    print(f"{'entity':24} {'combos':>6} {'frames':>6} {'base m/p':>12} {'shadow m/p':>12} {'anim m/p':>12} {'canvas m/p (kpx)':>18}")
    for e, r in sorted(seen.items()):
        c, f = r['combos'], r['frames']
        ps = r['parts_s']
        cp = c * canvas_px(*(m0 := meta(e)).get('size', (1, 1)), m0.get('height', 1.0), m0.get('margin', 0.5))
        tot['pred_meta'] = tot.get('pred_meta', 0) + c * 0.15 + 15.1e-6 * cp + (
            (c * f * 0.10 + 3.0e-6 * r['rect_px'] * f) if r['rect_px'] else 0.0)
        pb = c * 0.10 + 2.6e-6 * r['canvas_px']
        psh = c * 0.05 + 12.5e-6 * r['canvas_px']
        pa = (c * f * 0.10 + 3.0e-6 * r['rect_px'] * f) if r['rect_px'] else 0.0
        mb, msh, ma = ps['base_passes_s'], ps['base_shadow_s'], ps['anim_frames_s'] + ps['pose_all_frames_s']
        m = meta(e)
        w, h = m.get('size', (1, 1))
        H = m.get('height', 1.0)
        canvas_pred = c * canvas_px(w, h, H, m.get('margin', 0.5))
        for k, v in (('meas_base', mb), ('meas_shadow', msh), ('meas_anim', ma), ('pred_base', pb), ('pred_shadow', psh),
                     ('pred_anim', pa), ('meas_total', r['total_s']), ('canvas_meas', r['canvas_px']), ('canvas_pred', canvas_pred)):
            tot[k] += v
        print(f"{e:24} {c:6d} {f:6d} {mb:5.1f}/{pb:5.1f} {msh:6.1f}/{psh:5.1f} {ma:6.1f}/{pa:5.1f} {r['canvas_px']/1e3:9.0f}/{canvas_pred/1e3:7.0f}")
    print(f"{'TOTAL':24} {'':6} {'':6} {tot['meas_base']:5.1f}/{tot['pred_base']:5.1f} {tot['meas_shadow']:6.1f}/{tot['pred_shadow']:5.1f} "
          f"{tot['meas_anim']:6.1f}/{tot['pred_anim']:5.1f} {tot['canvas_meas']/1e3:9.0f}/{tot['canvas_pred']/1e3:7.0f}")
    meas = tot['meas_base'] + tot['meas_shadow'] + tot['meas_anim']
    pred = tot['pred_base'] + tot['pred_shadow'] + tot['pred_anim']
    print(json.dumps(dict(entities=len(seen), measured_render_s=round(meas, 1), predicted_render_s=round(pred, 1),
                          ratio=round(meas / pred, 3), predicted_from_meta_s=round(tot['pred_meta'], 1),
                          ratio_meta=round(meas / tot['pred_meta'], 3), measured_wall_s=round(tot['meas_total'], 1),
                          canvas_ratio=round(tot['canvas_meas'] / tot['canvas_pred'], 3))))


main()
