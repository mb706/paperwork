// The UI's side of the golden set (test/golden/README.md, "UI (C5)"): the projection records decode into UI state,
// and the UI records inside the golden packets and ABI traces route by sub_id with their statuses (ok, gone,
// invalid with a reason), versions across a replacement, and STATS series whole and then incremental.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePacket } from '../../src/shared/gen/packet.ts';
import {
  decodeProjection,
  ProjectionKind,
  readUiRecords,
  type StatSeries,
  type UiRecord,
} from '../../src/shared/gen/projections.ts';
import type { PrototypesJson } from '../../src/shared/gen/protos.ts';
import { characterOf } from '../../src/ui/store/game.ts';
import { Protos } from '../../src/ui/store/protos.ts';
import {
  applyStats,
  CHAR_FLAG,
  countOf,
  mergeSeries,
  type RecordOutcome,
  readRecord,
  SERIES_POINTS,
  statId,
  statKind,
} from '../../src/ui/store/records.ts';
import { Subscriptions } from '../../src/ui/store/subs.ts';
import { GAME } from '../helpers/paths.ts';

const M0 = join(GAME, 'test', 'golden', 'm0');
const KIND: Record<string, number> = {
  hud: ProjectionKind.hud,
  character: ProjectionKind.character,
  inventory: ProjectionKind.inventory,
  'entity-panel': ProjectionKind.entity_panel,
  hover: ProjectionKind.hover,
  stats: ProjectionKind.stats,
  debug: ProjectionKind.debug,
};
const kindOf = (file: string) => KIND[file.replace(/(-p?\d+|-s5|-m1|-all)?\.bin$/, '')] as number;
const body = (tick: string, file: string) =>
  new Uint8Array(readFileSync(join(M0, 'projections', `tick-${tick}`, file)));
const protos = () =>
  new Protos(JSON.parse(readFileSync(join(M0, 'protos', 'prototypes.json'), 'utf8')) as PrototypesJson, null);

describe('golden projections into UI state', () => {
  it('decodes every M0 projection record at every state tick', () => {
    let n = 0;
    for (const dir of readdirSync(join(M0, 'projections')).filter((d) => !d.endsWith('.txt')))
      for (const file of readdirSync(join(M0, 'projections', dir))) {
        const kind = kindOf(file);
        expect(kind, file).toBeDefined();
        const p = decodeProjection(kind, body(dir.slice(5), file));
        expect(p.kind.toLowerCase().replace('_', '-'), file).toBe(
          file.replace(/(-p?\d+|-s5|-m1|-all)?\.bin$/, ''),
        );
        n++;
      }
    expect(n).toBeGreaterThan(60);
  });

  it("player 0's CHARACTER at tick 600: the inventory the scenario left, an empty hand, the flags", () => {
    const p = decodeProjection(ProjectionKind.character, body('0600', 'character-p0.bin'));
    if (p.kind !== 'CHARACTER') throw new Error(p.kind);
    const c = characterOf(p);
    expect(c.present).toBe(true);
    expect(c.serial).toBe(1);
    expect(c.main).toHaveLength(80);
    expect(c.main.slice(0, 3)).toEqual([
      { key: 0, filter: 0xffff, count: 5 },
      { key: 8, filter: 0xffff, count: 33 },
      { key: 16, filter: 0xffff, count: 6 },
    ]);
    expect(c.hand).toEqual({ key: 0xffff, count: 0, origin: -1, ghost: false });
    expect(c.flags & CHAR_FLAG.online).not.toBe(0);
    expect(c.flags & CHAR_FLAG.autoSort).not.toBe(0);
    expect(c.quickbar).toEqual([]); // rule 35: M0 keeps no quickbar
    const pr = protos();
    expect(pr.itemName(8)).not.toBe('');
    expect(countOf(c.main, 8)).toBe(33);
  });

  it("a chest's INVENTORY and HOVER: slots, the limit bar, contents summed per key", () => {
    const inv = decodeProjection(ProjectionKind.inventory, body('0600', 'inventory-2.bin'));
    if (inv.kind !== 'INVENTORY') throw new Error(inv.kind);
    expect(inv.serial).toBe(2);
    expect(inv.view.slots.length).toBeGreaterThan(0);
    expect(inv.view.bar).toBeLessThanOrEqual(inv.view.slots.length);
    const hover = decodeProjection(ProjectionKind.hover, body('0600', 'hover-2.bin'));
    if (hover.kind !== 'HOVER') throw new Error(hover.kind);
    expect(hover.serial).toBe(2);
    const keys = hover.contents.map((c) => c.key);
    expect([...keys].sort((a, b) => a - b)).toEqual(keys);
  });

  it('STATS: totals per key and whole series of 300 points (rule 26)', () => {
    const p = decodeProjection(ProjectionKind.stats, body('0600', 'stats-s5.bin'));
    if (p.kind !== 'STATS') throw new Error(p.kind);
    const v = applyStats(null, p);
    expect(v.precision).toBe(0);
    expect([...v.totals.keys()]).toEqual([16777216, 16777224, 16777232]);
    expect(statKind(16777224)).toBe(1); // items
    expect(statId(16777224)).toBe(8);
    expect(v.totals.get(16777216)).toEqual({ produced: 3, consumed: 0 });
    const s = v.series.get(16777216);
    expect(s?.from).toBe(300);
    expect(s?.produced).toHaveLength(SERIES_POINTS);
    expect(s?.produced[231]).toBe(1);
  });
});

describe('STATS series: whole, then incremental (§15.5, rule 26)', () => {
  const series = (from: number, produced: number[]): StatSeries => ({
    key: 1,
    from,
    produced: Float32Array.from(produced) as unknown as number[],
    consumed: Float32Array.from(produced.map(() => 0)) as unknown as number[],
  });
  it('appends a continuation and keeps the newest 300 points', () => {
    let held = mergeSeries(
      undefined,
      series(
        10,
        Array.from({ length: 300 }, (_, i) => i),
      ),
    );
    expect(held.from).toBe(10);
    held = mergeSeries(held, series(310, [1000, 1001]));
    expect(held.produced).toHaveLength(300);
    expect(held.from).toBe(12);
    expect(held.produced.slice(-3)).toEqual([299, 1000, 1001]);
  });
  it('replaces on anything else: a new subscription, a parameter change, the all ring doubling', () => {
    const held = mergeSeries(undefined, series(10, [1, 2, 3]));
    const replaced = mergeSeries(held, series(5, [7, 7]));
    expect(replaced).toEqual({ from: 5, produced: [7, 7], consumed: [0, 0] });
  });
  it('wraps the point index at 65,536', () => {
    const held = mergeSeries(undefined, series(65534, [1, 2]));
    expect(mergeSeries(held, series(0, [3])).produced).toEqual([1, 2, 3]);
  });
});

/** The UI records of an ABI trace's sim_extract outputs, in order. */
function traceRecords(trace: string): UiRecord[][] {
  const dir = join(M0, 'abi', 'traces', trace);
  return readdirSync(dir)
    .filter((f) => f.endsWith('-sim_extract.out.bin'))
    .sort()
    .map((f) => {
      const p = decodePacket(new Uint8Array(readFileSync(join(dir, f))));
      const ui = p.sections.find((s) => s.name === 'UI');
      return ui ? readUiRecords(ui.bytes, ui.count) : [];
    });
}

describe('routing the golden traces by sub_id (§15.5)', () => {
  it('packet-transitions: a chest window goes gone when the chest is mined; a replacement keeps counting', () => {
    const subs = new Subscriptions();
    const seen = new Map<number, string[]>();
    const log = (id: number) => (o: RecordOutcome, r: UiRecord) => {
      const list = seen.get(id) ?? [];
      list.push(`${o.status}:${r.version}:${o.status === 'ok' ? o.projection.kind : ''}`);
      seen.set(id, list);
    };
    // The trace subscribes sub 1 (CHARACTER, later replaced by a HUD), 10 (INVENTORY) and 11 (ENTITY_PANEL).
    const ids: number[] = [];
    for (let i = 1; i <= 11; i++) ids.push(subs.subscribe(ProjectionKind.hud, {}, log(i)));
    for (const id of ids) if (id !== 1 && id !== 10 && id !== 11) subs.unsubscribe(id);
    subs.onHover(log(0));
    for (const records of traceRecords('packet-transitions')) subs.route(records);
    expect(seen.get(10)?.at(0)).toBe('ok:1:INVENTORY');
    expect(seen.get(10)?.at(-1)).toMatch(/^gone:/);
    expect(seen.get(11)?.at(-1)).toMatch(/^gone:/);
    expect(subs.has(10)).toBe(false);
    expect(subs.has(11)).toBe(false);
    const one = seen.get(1) ?? [];
    const firstHud = one.findIndex((x) => x.endsWith('HUD'));
    expect(firstHud).toBeGreaterThan(0);
    const versions = one.map((x) => Number(x.split(':')[1]));
    expect(versions).toEqual([...versions].sort((a, b) => a - b)); // counted across the replacement
    expect(seen.get(0)?.some((x) => x.startsWith('gone:'))).toBe(true);
  });

  it('subscriptions: invalid records carry their developer reason and end the subscription', () => {
    const outcomes: RecordOutcome[] = [];
    for (const records of traceRecords('subscriptions'))
      for (const r of records) {
        const o = readRecord(r);
        if (o.status === 'invalid') outcomes.push(o);
      }
    const reasons = new Set(outcomes.map((o) => (o.status === 'invalid' ? o.reason : 0)));
    expect(reasons).toEqual(new Set([1, 2, 3])); // unsupported, bad parameters, over a limit
  });
});
