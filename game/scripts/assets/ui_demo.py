"""QC page for the UI skin: a Factorio-layout entity window and HUD pieces drawn with public/sheets/ui-skin.css.

    gamedev-python game/scripts/assets/ui_demo.py         # writes .cache/assets/qc/www/qc-ui.html

Only for review (screenshots by shoot.mjs at device pixel ratios 1 and 2): the UI package builds the real screens.
Every string is a data name or description (design/spec/data), so nothing here is invented player-facing text.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as K  # noqa: E402


def main():
    ui = K.load_json(os.path.join(K.CACHE, 'ui.json'))
    man = K.load_json(os.path.join(K.PUBLIC, 'atlases', 'sprites.json'))
    sheets = man['dom']['icons']['core']
    idx = man['dom']['iconSheets']['core']
    cols = idx['columns']

    def icon(name, size=32):
        if name not in idx['names']:
            name = 'fx/missing' if 'fx/missing' in idx['names'] else idx['names'][0]
        i = idx['names'].index(name)
        r, q = divmod(i, cols)
        sheet = sheets[1]           # the 64 px sheet, scaled to 32 CSS px: crisp at dpr 2
        n_rows = -(-len(idx['names']) // cols)
        return (f'<span class="icon" style="width:{size}px;height:{size}px;background-image:url(\'{sheet}\');'
                f'background-size:{cols * size}px {n_rows * size}px;background-position:-{q * size}px -{r * size}px">'
                f'</span>')

    inv = [('item/iron-plate', 126), ('item/iron-chest', 8), ('item/iron-ore', 50), ('item/memo', 9),
           ('item/token', 12), ('item/records', 50), ('item/coal', 37), ('item/copper-plate', 66)]
    slots = []
    for i in range(30):
        if i < len(inv):
            n, c = inv[i]
            cls = 'pw-slot-selected' if i == 0 else 'pw-slot-hover' if i == 3 else 'pw-slot'
            slots.append(f'<div class="slot {cls}">{icon(n)}<span class="count">{c}</span></div>')
        elif i == 29:
            slots.append('<div class="slot pw-slot-disabled"></div>')
        else:
            slots.append('<div class="slot pw-slot"></div>')
    desc = 'Transcribes records into tokens, one card at a time. Burns fuel.'
    html = f'''<!doctype html><html><head><meta charset="utf-8"><title>UI skin QC</title>
<link rel="stylesheet" href="{ui['css']}">
<style>
body {{ margin: 0; background: #ece3cb; font-family: 'Libre Franklin', sans-serif; color: var(--pw-c-text);
       font-size: 13.5px; }}
.win {{ position: absolute; display: flex; flex-direction: column; gap: 6px; padding: 2px 6px 6px 6px; }}
.win .fib {{ position: absolute; inset: 0; pointer-events: none; opacity: .55; }}
.title {{ display: flex; align-items: center; gap: 8px; height: 28px; position: relative; }}
.title h1 {{ margin: 0; font-weight: 800; font-size: 14.5px; letter-spacing: 1.2px; text-transform: uppercase; }}
.title .drag {{ flex: 1; height: 24px; }}
.title button {{ width: 24px; height: 24px; padding: 0; display: grid; place-items: center; }}
.grid {{ display: grid; grid-template-columns: repeat(10, 40px); gap: 2px; padding: 6px; position: relative; }}
.slot {{ box-sizing: border-box; width: 40px; height: 40px; position: relative; display: grid; place-items: center; }}
.slot .icon {{ position: absolute; left: -6px; top: -6px; }}
.icon {{ display: inline-block; vertical-align: middle; }}
.count {{ position: absolute; right: -8px; bottom: -12px; font: 700 12.5px 'Courier Prime', monospace;
          color: var(--pw-c-text); -webkit-text-stroke: 3px var(--pw-c-slot); paint-order: stroke; }}
.tabs {{ display: flex; gap: 2px; padding: 0 6px; margin-bottom: -6px; position: relative; }}
.tab {{ box-sizing: border-box; width: 64px; height: 50px; display: grid; place-items: center; }}
.card {{ padding: 6px 10px; position: relative; line-height: 18px; }}
.row {{ display: flex; gap: 6px; align-items: center; }}
.btn {{ box-sizing: border-box; min-width: 96px; height: 28px; display: grid; place-items: center;
        font-weight: 600; font-size: 13.5px; color: var(--pw-c-text); }}
.typed {{ font-family: 'Courier Prime', monospace; font-size: 14px; }}
.bar {{ box-sizing: border-box; width: 240px; height: 14px; position: relative; }}
.bar .fill {{ position: absolute; left: 1px; top: 1px; bottom: 1px; }}
svg.g {{ width: 18px; height: 18px; color: var(--pw-c-text); }}
.tip {{ position: absolute; padding: 6px 10px; max-width: 260px; line-height: 18px; }}
.mm {{ position: absolute; width: 180px; height: 180px; box-sizing: border-box; background: #e6dcc3; }}
</style></head><body>
<div class="win pw-frame" style="left:16px; top:16px; width:434px">
  <div class="fib pw-fibre"></div>
  <div class="title"><h1>Iron chest</h1><div class="drag pw-title-rule"></div>
    <button class="pw-button"><svg class="g"><use href="{ui['glyphs']}#g-close"/></svg></button></div>
  <div class="grid pw-panel">{''.join(slots)}</div>
</div>
<div class="win pw-frame" style="left:470px; top:16px; width:440px">
  <div class="fib pw-fibre"></div>
  <div class="title"><h1>Keypunch</h1><div class="drag pw-title-rule"></div>
    <button class="pw-button"><svg class="g"><use href="{ui['glyphs']}#g-close"/></svg></button></div>
  <div class="tabs"><div class="tab pw-tab-selected">{icon('item/iron-chest')}</div><div class="tab pw-tab">{icon('item/iron-gear-wheel')}</div>
    <div class="tab pw-tab">{icon('item/iron-plate')}</div><div class="tab pw-tab">{icon('item/memo')}</div></div>
  <div class="card pw-panel">
    <div>{desc}</div>
    <div class="row" style="margin-top:6px">{icon('item/records', 24)}<span class="typed">0.31</span>
      <svg class="g"><use href="{ui['glyphs']}#g-yields"/></svg>{icon('item/token', 24)}<span class="typed">0.31 /s</span></div>
    <div class="row" style="margin-top:8px"><div class="bar pw-progress-track"><div class="fill pw-progress-fill" style="width:62%"></div></div>
      <span class="typed">62%</span></div>
    <div class="row" style="margin-top:8px"><span class="pw-checkbox-checked"></span><span>Keypunch</span>
      <span class="pw-radio-checked" style="margin-left:16px"></span><span class="pw-radio"></span></div>
  </div>
  <div class="row" style="justify-content:space-between">
    <div class="btn pw-button-red">{icon('item/coal', 24)}</div>
    <div class="btn pw-button">{icon('item/iron-ore', 24)}</div>
    <div class="btn pw-button-pressed">{icon('item/iron-plate', 24)}</div>
    <div class="btn pw-button-confirm"><svg class="g"><use href="{ui['glyphs']}#g-arrow-right"/></svg></div>
  </div>
</div>
<div class="tip pw-tooltip" style="left:60px; top:330px">
  <div style="font-weight:800; letter-spacing:1px; text-transform:uppercase; font-size:13px">Iron plate</div>
  <div class="row">{icon('item/iron-ore', 24)}<span class="typed">1</span><svg class="g"><use href="{ui['glyphs']}#g-yields"/></svg>
    {icon('item/iron-plate', 24)}<span class="typed">1</span><span class="typed" style="margin-left:8px">3.2 s</span></div>
</div>
<div class="mm pw-minimap-frame" style="left:930px; top:16px"></div>
<div class="row" style="position:absolute; left:930px; top:210px; gap:4px">
  <div class="pw-button" style="width:38px;height:38px;box-sizing:border-box;display:grid;place-items:center"><svg class="g" style="width:24px;height:24px"><use href="{ui['glyphs']}#g-technology"/></svg></div>
  <div class="pw-button" style="width:38px;height:38px;box-sizing:border-box;display:grid;place-items:center"><svg class="g" style="width:24px;height:24px"><use href="{ui['glyphs']}#g-statistics"/></svg></div>
  <div class="pw-button" style="width:38px;height:38px;box-sizing:border-box;display:grid;place-items:center"><svg class="g" style="width:24px;height:24px"><use href="{ui['glyphs']}#g-handbook"/></svg></div>
  <div class="pw-button" style="width:38px;height:38px;box-sizing:border-box;display:grid;place-items:center"><svg class="g" style="width:24px;height:24px"><use href="{ui['glyphs']}#g-world"/></svg></div>
</div>
</body></html>
'''
    www = os.path.join(K.CACHE, 'qc', 'www')        # served over public/ by shoot.mjs; public/ holds build outputs only
    os.makedirs(www, exist_ok=True)
    with open(os.path.join(www, 'qc-ui.html'), 'w') as f:
        f.write(html)
    print('[qc] .cache/assets/qc/www/qc-ui.html', flush=True)


if __name__ == '__main__':
    main()
