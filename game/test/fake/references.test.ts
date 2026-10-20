// GATE-r1 finding 12: over a long run with a player at work (building, mining, transfers, crafting, refusals),
// a moving view, the hover and every projection, every reference the fake's packets make resolves in its own
// build, including tree species and working-sound ids.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Action } from '../../src/shared/gen/actions.ts';
import type { ViewRequest } from '../../src/shared/gen/packet.ts';
import { InventoryType, MiningTarget } from '../../src/shared/gen/types.ts';
import { decodeAll } from '../helpers/packets.ts';
import { fakeProtos, Harness } from './harness.ts';
import { ReferenceChecker } from './references.ts';

const VIEW: ViewRequest = {
  view_seq: 1,
  surface: 0,
  flags: 1 << 3,
  x0: -32,
  y0: -24,
  x1: 40,
  y1: 24,
  zoom: 1,
  hovered_serial: 92,
  audio_half_range: 32,
  chart_x0: 0,
  chart_y0: 0,
  chart_x1: 0,
  chart_y1: 0,
};
const sub = (sub_id: number, kind: number, target: number, p0 = 0, p1 = 0, p2 = 0) => ({
  sub_id,
  kind,
  flags: 0,
  target,
  p0,
  p1,
  p2,
  p3: 0,
});

beforeAll(() => {
  fakeProtos();
}, 60_000);

describe('the fake sim’s references', () => {
  it('all resolve in its build over 2,400 ticks of play', async () => {
    const p = fakeProtos();
    const h = new Harness();
    await h.start();
    await h.send({ t: 'view', gen: 1, v: VIEW });
    await h.send({
      t: 'sub',
      gen: 1,
      subs: [
        sub(1, 2, 0),
        sub(2, 2, 1),
        sub(3, 1, 0),
        sub(4, 7, 0, 0, 0, 1),
        sub(5, 7, 0, 8, 0, 1),
        sub(6, 10, 0),
        sub(7, 3, 73, InventoryType.chest),
        sub(8, 4, 71),
        sub(9, 4, 92),
      ],
    });
    const item = (name: string) => p.item.findIndex((x) => x.name === name) * 8;
    const me = () => h.sim.snapshot()?.chars.find((c) => c.player === 0);
    const slot = (name: string) => me()?.main.findIndex((s) => s.key === item(name) && s.count > 0) ?? -1;
    const main = (i: number) => ({ owner: { a: 0, b: 0, tag: 0 }, inv: InventoryType.main, slot: i });
    let seq = 0;
    const send = async (...actions: Action[]) => {
      await h.act(1, ...actions);
      seq += actions.length;
    };
    const build = (x2: number, y2: number): Action => ({
      type: 'build',
      item: item('iron-chest'),
      pos: { x2, y2 },
      dir: 0,
      flip: false,
      mode: 0,
      flags: 0,
      drag_id: 0,
    });
    const created = (s: number) => ({ a: s, b: 0, tag: 2 });

    await send({ type: 'cursor_transfer', slot: main(slot('iron-chest')) });
    await send(build(5, 1));
    const chest = created(seq);
    await send(build(5, -5), build(101, 1)); // in the way of the wooden chest; out of reach
    await send({ type: 'clear_cursor' });
    await h.step(1);
    await send({ type: 'inventory_transfer', from: main(slot('iron-plate')), to: chest });
    await send({ type: 'set_inventory_bar', target: chest, inv: InventoryType.chest, bar: 2 });
    await send({ type: 'stack_transfer', from: main(slot('copper-plate')), to: chest });
    await send({ type: 'fast_entity_transfer', target: chest });
    await send({ type: 'craft', recipe: p.recipe.findIndex((r) => r.name === 'iron-gear-wheel'), count: 5 });
    await send({ type: 'craft', recipe: p.recipe.findIndex((r) => r.name === 'wooden-chest'), count: 1 });
    await h.step(5);
    await send({ type: 'begin_mining', input_gen: 0, target: chest });
    await h.step(40);
    // Walk north-west towards the iron patch, then mine the nearest ore tile in reach.
    await send({ type: 'start_walking', input_gen: 0, dir: 14 });
    await h.step(50);
    await send({ type: 'stop_walking', input_gen: 0 });
    await h.step(1);
    const at = me() as { x: number; y: number };
    const snap = h.sim.snapshot();
    let best: { x: number; y: number; d: number } | null = null;
    for (const ch of snap?.chunks ?? []) void ch; // modified chunks only; resources come from the world below
    for (let ty = Math.floor(at.y) - 3; ty <= Math.floor(at.y) + 3; ty++)
      for (let tx = Math.floor(at.x) - 3; tx <= Math.floor(at.x) + 3; tx++) {
        const dx = at.x < tx ? tx - at.x : at.x > tx + 1 ? at.x - tx - 1 : 0;
        const dy = at.y < ty ? ty - at.y : at.y > ty + 1 ? at.y - ty - 1 : 0;
        const d = dx * dx + dy * dy;
        if (d <= 2.7 * 2.7 && (!best || d < best.d)) best = { x: tx, y: ty, d };
      }
    expect(best).not.toBeNull();
    await send({
      type: 'begin_mining_terrain',
      input_gen: 0,
      kind: MiningTarget.resource_tile,
      pos: { x: (best as { x: number }).x * 256 + 128, y: (best as { y: number }).y * 256 + 128 },
    });
    await h.step(400);
    await send({ type: 'craft', recipe: p.recipe.findIndex((r) => r.name === 'iron-gear-wheel'), count: 0 });
    await h.step(100);
    await send({ type: 'cancel_craft', index: 0, count: 3 });
    // The view moves away (chunks leave the held set) and comes back (they re-enter it).
    await h.step(500);
    await h.send({ t: 'view', gen: 1, v: { ...VIEW, view_seq: 2, x0: 64, x1: 136, hovered_serial: 0 } });
    await h.step(300);
    await h.send({ t: 'view', gen: 1, v: { ...VIEW, view_seq: 3 } });
    await h.step(1000);

    const checker = new ReferenceChecker(p);
    for (const [i, v] of [
      VIEW,
      { ...VIEW, view_seq: 2, x0: 64, x1: 136 },
      { ...VIEW, view_seq: 3 },
    ].entries())
      checker.views.set(i + 1, v);
    const kinds = new Set<string>();
    const events = new Set<string>();
    for (const b of h.packets) {
      checker.check(b);
      for (const s of decodeAll(b).sections) {
        kinds.add(s.name);
        if (s.name === 'EVENTS')
          for (const e of s.records as { payload: { type: string } }[]) events.add(e.payload.type);
      }
    }
    expect(checker.problems).toEqual([]);
    expect([...kinds].sort()).toEqual(
      expect.arrayContaining(['AUDIO_WORKING', 'CHUNK_OBJECTS', 'EVENTS', 'HANDS', 'UI', 'BELT_ITEMS']),
    );
    expect([...events].sort()).toEqual(
      expect.arrayContaining([
        'action_failed',
        'entity_built',
        'entity_mined',
        'flying_text',
        'item_crafted',
      ]),
    );
    for (const k of [
      'tree species',
      'sound',
      'dyn serial',
      'built serial',
      'mined serial',
      'stat item',
      'refusal serial',
    ])
      expect(checker.checked.get(k), k).toBeGreaterThan(0);
  }, 120_000);
});
